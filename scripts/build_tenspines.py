#!/usr/bin/env python3
"""The ten-spine page (tenspines.html): the 100 ms ug4 run of the 0-2a cell with ten spines (job 55734167 on SDSC
Expanse, 14 Nov 2026; the neurox mesh 0-2a.CNG_er0.5_n10_s1_tets.ugx, every spine with a spine apparatus joined to the
ER, all 10 synapses stimulated at t = 0), from its VTK output.

Subsets: s00 cyt, s01 er (tetrahedra), s02..s11 syn1..syn10, s12 pm, s13 sam (spine apparatus membrane), s14 erm.

Output in public/tenspines/:
  cell.json   frames, color ranges, byte offsets into the .bin files, the ten spines (synapse, spine apparatus, the
              frame each close-up is seen in, the ball it is drawn at full resolution in, its measured numbers), the
              released fractions of the ER over time. Coordinates [um] are centered on the soma and turned so that x
              runs along the cell (syn7's apical dendrite to the left), y up, z toward the viewer.
  mesh.bin    plasma membrane and ER membrane (spine apparatus included): decimated for the whole cell ("pm", "er"),
              at full resolution inside the ten spine balls ("fpm", "fer", with each vertex's ball and its level
              against that spine's cut plane); per vertex up to 3 "patches" with weights (0.2 um patches in the
              spines, 0.5 um at the soma, 1 um elsewhere); the cut through each spine along its axis (cytosol and ER
              lumen triangles from the tetrahedra, membrane outlines); the synapse outlines; the SWC skeleton.
  values.bin  uint8, frame-major, every 1 ms: PM patches (cytosolic Ca, log 0.05-100 uM), ER patches (ER Ca, linear
              20-260 uM), cut cytosol vertices (log), cut ER vertices (linear).
  traces.bin  uint8 [spine][sample]: Ca at each synapse every 0.05 ms (ug4's own measurement, log 0.05-100 uM).

Usage:  ~/.venvs/website/bin/python scripts/build_tenspines.py [RUN_DIR]
        RUN_DIR defaults to ~/projects/tmp/fullcell_10spines_100ms_output (needs output/vtk and output/meas).
Needs numpy, scipy, trimesh and fast-simplification. Reads 101 frames of a 5.7 GB run: a few minutes.
"""
import base64
import json
import os
import re
import sys
from multiprocessing import Pool
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public/tenspines"
RUN = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "projects/tmp/fullcell_10spines_100ms_output")
V = RUN / "output/vtk"
SWC = ROOT / "data/neuronmesh/0-2a.CNG.swc"   # the mesh was built on this SWC, same coordinates
NS = 10
CYT = (5e-8, 1e-4)        # [M] log color range of cytosolic Ca (the video's)
ER = (2e-5, 2.6e-4)       # [M] linear color range of ER Ca (the video's)
HALF = 1.25e-4            # [M] "released": below half of the resting 250 uM, as in the report
PM_KEEP, ER_KEEP = 0.25, 0.25    # fraction of triangles kept by the decimation
H_SPINE, H_SOMA, H = 0.2, 0.5, 1.0   # [um] patch size in the spine balls, at the soma, elsewhere
BALL_PAD = 0.9            # [um] around the spine apparatus, the synapse and the spine's foot
TRACE_EVERY = 10          # meas rows (5 us apart) per trace sample: 0.05 ms
PM_SUBSETS, ER_SUBSETS = [12] + list(range(2, 12)), [14, 13]
NPROC = int(os.environ.get("NPROC", 6))

# ---------- reading ug4's inline-base64 .vtu/.pvtu ----------
_DT = {"Float32": np.float32, "Float64": np.float64, "Int32": np.int32, "Int8": np.int8, "UInt8": np.uint8, "Int64": np.int64}
_ARR = re.compile(r'<DataArray type="(\w+)"(?: Name="(\w+)")?[^>]*>\s*([A-Za-z0-9+/=\s]*?)\s*</DataArray>', re.S)


def _decode(dtype, txt):
    txt = "".join(txt.split())
    raw = base64.b64decode(txt)
    n = int(np.frombuffer(raw[:4], np.uint32)[0])
    if len(raw) >= 4 + n:
        return np.frombuffer(raw[4:4 + n], _DT[dtype])
    return np.frombuffer(base64.b64decode(txt[8:])[:n], _DT[dtype])   # header and data encoded separately


def _parts(path):
    return [path.parent / p for p in re.findall(r'Source="([^"]+)"', path.read_text())]


def read_parts(path):
    """per piece of a .pvtu, in order: points (n, 3) and cell connectivity (m, k); empty pieces kept"""
    out = []
    for part in _parts(path):
        arrs = _ARR.findall(part.read_text())
        p = _decode(*arrs[0][::2]).reshape(-1, 3).astype(np.float64)
        if not len(p):
            out.append((p, np.zeros((0, 3), np.int64)))
            continue
        d = {name: _decode(dt, txt) for dt, name, txt in arrs[1:] if name}
        c, o = d["connectivity"], d["offsets"]
        k = int(o[0])
        assert np.all(np.diff(o) == k), f"{part}: mixed cells"
        out.append((p, c.reshape(-1, k).astype(np.int64)))
    return out


def read_mesh(path):
    pts, conn, base = [], [], 0
    for p, c in read_parts(path):
        if len(p):
            pts.append(p)
            conn.append(c + base)
            base += len(p)
    return np.concatenate(pts), np.concatenate(conn)


def read_field(path, name, only=None):
    """a point field of a .pvtu, pieces concatenated in order; only: the piece indices to read"""
    pat = re.compile(rf'<DataArray type="(\w+)" Name="{name}"[^>]*>\s*([A-Za-z0-9+/=\s]*?)\s*</DataArray>', re.S)
    out = []
    for n, part in enumerate(_parts(path)):
        if only is not None and n not in only:
            continue
        m = pat.search(part.read_text())
        if m:
            out.append(_decode(*m.groups()).astype(np.float64))
    return np.concatenate(out)


# ---------- the run's frames: one per ms ----------
pvd = (V / "result.pvd").read_text()
steps = sorted({(round(float(t) * 1e3, 6), int(f)) for t, f in re.findall(r'timestep="([^"]+)" part="12" file="result_s12_t(\d+)\.pvtu"', pvd)})
FRAMES = [f for _, f in steps]
assert len(FRAMES) == 101 and all(abs(t - k) < 1e-6 for k, (t, _) in enumerate(steps)), "expected 101 frames, 1 ms apart"


# ---------- the membranes, welded (the MPI pieces repeat their seam vertices) and consistently wound ----------
def surface(subsets):
    P, T, sub, base = [], [], [], 0
    for s in subsets:
        p, t = read_mesh(V / f"result_s{s:02d}_t0000.pvtu")
        P.append(p)
        T.append(t + base)
        sub.append(np.full(len(t), s))
        base += len(p)
    return np.concatenate(P), np.concatenate(T), np.concatenate(sub)


def weld(Pts, Tri, sub):
    """returns the welded vertices, triangles, each triangle's subset, and for each welded vertex one raw index"""
    _, first, inv = np.unique(np.round(Pts * 1e5).astype(np.int64), axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    W, Tw = Pts[first], inv[Tri]
    ok = (Tw[:, 0] != Tw[:, 1]) & (Tw[:, 1] != Tw[:, 2]) & (Tw[:, 2] != Tw[:, 0])
    m = trimesh.Trimesh(W, Tw[ok], process=False)
    trimesh.repair.fix_winding(m)
    F = np.asarray(m.faces, np.int64)
    assert len(F) == ok.sum()
    return W, F, sub[ok], first


P_RAW, T_RAW, PM_SUB = surface(PM_SUBSETS)
E_RAW, TE_RAW, ER_SUB = surface(ER_SUBSETS)
N_PM_RAW, N_ER_RAW = len(P_RAW), len(E_RAW)
P, T, PM_SUB, PM_FIRST = weld(P_RAW, T_RAW, PM_SUB)
E, TE, ER_SUB, ER_FIRST = weld(E_RAW, TE_RAW, ER_SUB)
print(f"PM {len(P)} vertices / {len(T)} triangles, ER membrane {len(E)} / {len(TE)} "
      f"(spine apparatus {(ER_SUB == 13).sum()} triangles); frames {len(FRAMES)}", flush=True)

# ---------- the SWC skeleton (path distances from the soma) ----------
nodes = {}
for line in open(SWC):
    if line.startswith("#") or not line.strip():
        continue
    i, t_, x, y, z, r, p = line.split()[:7]
    nodes[int(i)] = (int(t_), np.array([float(x), float(y), float(z)]), float(r), int(p))
SOMA_C = np.mean([n_[1] for n_ in nodes.values() if n_[0] == 1], axis=0)
dist = {}
for i in sorted(nodes):   # SWC ids grow away from the soma
    t_, x, _, p = nodes[i]
    dist[i] = 0.0 if t_ == 1 or p not in nodes else dist[p] + float(np.linalg.norm(x - nodes[p][1]))
seg = [(p, i) for i, (t_, _, _, p) in nodes.items() if p in nodes and t_ != 1]
SA_ = np.array([nodes[p][1] for p, _ in seg])
SB_ = np.array([nodes[i][1] for _, i in seg])
SD0 = np.array([dist[p] for p, _ in seg])


def on_tree(x):
    """the nearest point of the skeleton to x: its path distance from the soma, and the segment's direction"""
    d = SB_ - SA_
    s = np.clip(((x - SA_) * d).sum(1) / np.maximum((d * d).sum(1), 1e-12), 0, 1)
    q = SA_ + s[:, None] * d
    k = int(np.argmin(np.linalg.norm(q - x, axis=1)))
    L = float(np.linalg.norm(d[k]))
    return SD0[k] + s[k] * L, d[k] / L


r_pm = np.linalg.norm(P - SOMA_C, axis=1)
SOMA_R = float(np.median(r_pm[r_pm < 15.0]))

# the view: x along the cell's long axis (syn7's dendrite to the left), y up (the longer side), z toward the viewer
_, _, VT = np.linalg.svd(P - P.mean(0), full_matrices=False)
rot = lambda X: (np.asarray(X, np.float64) - SOMA_C) @ VT.T  # noqa: E731
dirn = lambda v: VT @ np.asarray(v, np.float64)  # noqa: E731


# ---------- the ten spines ----------
def area_centre(Tri, Pts):
    t = Pts[Tri]
    a = 0.5 * np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1)
    return float(a.sum()), (t.mean(1) * a[:, None]).sum(0) / a.sum()


syn = {k: area_centre(T[PM_SUB == k + 1], P) for k in range(1, NS + 1)}
c7 = syn[7][1]
if (c7 - SOMA_C) @ VT[0] > 0:
    VT[0] = -VT[0]
Y = (P - SOMA_C) @ VT[1]
if Y.max() < -Y.min():
    VT[1] = -VT[1]
VT[2] = np.cross(VT[0], VT[1])

sa_tri = TE[ER_SUB == 13]
g = coo_matrix((np.ones(sa_tri.size), (sa_tri.ravel(), np.roll(sa_tri, 1, axis=1).ravel())), shape=(len(E), len(E)))
_, sa_lab = connected_components(g, directed=False)
SA_V = np.unique(sa_tri)
sa_tree = cKDTree(E[SA_V])
SPINES = []
for k in range(1, NS + 1):
    area, c = syn[k]
    comp = sa_lab[SA_V[sa_tree.query(c)[1]]]
    sav = SA_V[sa_lab[SA_V] == comp]
    X_sa = E[sav]
    foot = X_sa[np.argmax(np.linalg.norm(X_sa - c, axis=1))]   # where the spine apparatus joins the dendritic ER
    up = c - foot
    up /= np.linalg.norm(up)
    d_um, dend = on_tree(foot)
    synv = np.unique(T[PM_SUB == k + 1])
    X = np.vstack([X_sa, P[synv], [c, foot]])
    w, ev = np.linalg.eigh(np.cov((X - X.mean(0)).T))
    n = ev[:, 0]                                             # the plane the spine (apparatus) lies in, if it has one
    if w[1] < 2.5 * w[0]:
        n = np.cross(dend, up)                               # otherwise: look across the dendrite
    n -= (n @ up) * up
    n /= np.linalg.norm(n)
    if n @ VT[2] < 0:
        n = -n                                               # face the whole-cell view's viewer
    right = np.cross(up, n)
    B = np.vstack([X_sa, P[synv], [foot - 0.8 * up]])
    bc = (B.min(0) + B.max(0)) / 2
    br = float(np.linalg.norm(B - bc, axis=1).max()) + BALL_PAD
    SPINES.append(dict(k=k, area=area, c=c, foot=foot, up=up, right=right, n=n, p0=X_sa.mean(0), sav=sav, synv=synv,
                       bc=bc, br=br, dist=d_um, comp=comp))
assert len({s["comp"] for s in SPINES}) == NS, "two synapses share a spine apparatus"
BC = np.array([s["bc"] for s in SPINES])
BR = np.array([s["br"] for s in SPINES])
for s in SPINES:
    print(f"syn{s['k']:<2d} {s['dist']:6.1f} um from the soma, synapse {s['area']:.3f} um2, spine apparatus "
          f"{len(s['sav'])} vertices, ball r = {s['br']:.2f} um", flush=True)
ov = [(a + 1, b + 1) for a in range(NS) for b in range(a + 1, NS) if np.linalg.norm(BC[a] - BC[b]) < BR[a] + BR[b]]
print("overlapping balls:", ov or "none", flush=True)


def ball_of(X, pad=0.0):
    """index of the ball each point lies in (the most central one when two overlap), -1 outside all"""
    d = np.linalg.norm(X[:, None, :] - BC[None], axis=2)
    inside = d < BR + pad
    b = np.argmin(np.where(inside, d / (BR + pad), np.inf), 1)
    b[~inside.any(1)] = -1
    return b


# ---------- patches: the full-resolution vertices grouped, and the decimated and fine meshes' weights on them ----------
def patches(Pts, Tri):
    """one voxel (H_SPINE in the spine balls, H_SOMA at the soma, else H) and one connected piece of membrane in it"""
    cls = np.zeros(len(Pts), np.int64)
    cls[np.linalg.norm(Pts - SOMA_C, axis=1) < SOMA_R + 3] = 1
    cls[ball_of(Pts, 0.4) >= 0] = 2
    h = np.array([H, H_SOMA, H_SPINE])[cls]
    key = np.concatenate([cls[:, None], np.floor(Pts / h[:, None])], 1).astype(np.int64)
    _, vox = np.unique(key, axis=0, return_inverse=True)
    vox = vox.ravel()
    e = np.concatenate([Tri[:, [0, 1]], Tri[:, [1, 2]], Tri[:, [2, 0]]])
    e = e[vox[e[:, 0]] == vox[e[:, 1]]]
    n, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(Pts), len(Pts))), directed=False)
    cnt = np.bincount(lab, minlength=n)
    cen = np.stack([np.bincount(lab, Pts[:, k], n) for k in range(3)], 1) / cnt[:, None]
    return lab, n, cnt, cen, h


def decimate(Pts, Tri, keep):
    p, t = fast_simplification.simplify(Pts.astype(np.float32), Tri.astype(np.int32), target_reduction=1 - keep)
    m = trimesh.Trimesh(p.astype(np.float64), t, process=True)
    trimesh.repair.fix_winding(m)
    return np.asarray(m.vertices, np.float64), np.asarray(m.faces, np.int64)


def weights(Q, Pts, lab, cen, h):
    """up to 3 patches per vertex: those of the full-resolution vertices within 1.2 h, Gaussian in the distance to each
    patch's center; weights in 1/255, summing to exactly 255"""
    tree = cKDTree(Pts)
    hq = h[tree.query(Q)[1]]
    ids = np.zeros((len(Q), 3), np.int64)
    wts = np.zeros((len(Q), 3))
    for v, (q, hv) in enumerate(zip(Q, hq)):
        cand = np.unique(lab[tree.query_ball_point(q, 1.2 * hv)])
        if not len(cand):
            cand = lab[[tree.query(q)[1]]]
        w = np.exp(-(np.linalg.norm(cen[cand] - q, axis=1) / (0.75 * hv)) ** 2) + 1e-12
        o = np.argsort(-w)[:3]
        ids[v, :len(o)], wts[v, :len(o)] = cand[o], w[o] / w[o].sum()
    q8 = np.round(wts * 255).astype(np.int64)
    q8[:, 0] += 255 - q8.sum(1)
    return ids, q8.astype(np.uint8)


def fine(Pts, Tri):
    """the full-resolution triangles that reach into a spine ball, each vertex's ball and its level against that
    spine's cut plane (> 0 on the viewer's side)"""
    inb = ball_of(Pts, 0.3) >= 0
    tri = Tri[inb[Tri].any(1)]
    used = np.unique(tri)
    remap = np.full(len(Pts), -1)
    remap[used] = np.arange(len(used))
    X = Pts[used]
    b = ball_of(X, 0.3)
    b[b < 0] = np.argmin(np.linalg.norm(X[b < 0, None, :] - BC[None], axis=2), 1)
    P0 = np.array([s["p0"] for s in SPINES])
    N0 = np.array([s["n"] for s in SPINES])
    lv = ((X - P0[b]) * N0[b]).sum(1)
    return X, remap[tri], used, b, lv


PM_LAB, PM_N, PM_CNT, PM_CEN, PM_H = patches(P, T)
ER_LAB, ER_N, ER_CNT, ER_CEN, ER_H = patches(E, TE)
assert PM_N < 65536 and ER_N < 65536
DP, DT_ = decimate(P, T, PM_KEEP)
DE, DTE = decimate(E, TE, ER_KEEP)
FP, FT, FP_USED, FP_BALL, FP_LV = fine(P, T)
FE, FTE, FE_USED, FE_BALL, FE_LV = fine(E, TE)
PM_W, ER_W = weights(DP, P, PM_LAB, PM_CEN, PM_H), weights(DE, E, ER_LAB, ER_CEN, ER_H)
FPM_W, FER_W = weights(FP, P, PM_LAB, PM_CEN, PM_H), weights(FE, E, ER_LAB, ER_CEN, ER_H)
print(f"patches PM {PM_N}, ER {ER_N}; decimated PM {len(DP)}/{len(DT_)}, ER {len(DE)}/{len(DTE)}; "
      f"full resolution in the balls PM {len(FP)}/{len(FT)}, ER {len(FE)}/{len(FTE)}", flush=True)


# ---------- the cut through each spine along its axis: tetrahedra -> triangles, membranes -> outlines ----------
class Tets:
    def __init__(self, s):
        parts = read_parts(V / f"result_s{s:02d}_t0000.pvtu")
        self.n = np.array([len(p) for p, _ in parts])
        self.off = np.concatenate([[0], np.cumsum(self.n)])
        self.P = np.concatenate([p for p, _ in parts if len(p)])
        self.T = np.concatenate([c + self.off[i] for i, (p, c) in enumerate(parts) if len(p)])
        self.cen = self.P[self.T].mean(1)

    def compact(self, idx):
        """global vertex indices -> the pieces to read each frame, and the indices after reading only those"""
        piece = np.searchsorted(self.off, idx, side="right") - 1
        use = np.unique(piece)
        start = np.zeros(len(self.n), np.int64)
        start[use] = np.concatenate([[0], np.cumsum(self.n[use])[:-1]])
        return set(int(u) for u in use), start[piece] + (idx - self.off[piece]), int(self.n[use].sum())


EDGES = np.array([(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)])


def cut_tets(tets, s):
    """tetrahedra in spine s's ball crossing its plane -> triangles over shared vertices (a point on a tet edge)"""
    m = np.linalg.norm(tets.cen - s["bc"], axis=1) < s["br"]
    C = tets.T[m]
    f = (tets.P - s["p0"]) @ s["n"]
    F = f[C]
    npos = (F >= 0).sum(1)
    C, F = C[(npos > 0) & (npos < 4)], F[(npos > 0) & (npos < 4)]
    I, J = C[:, EDGES[:, 0]], C[:, EDGES[:, 1]]
    Fi, Fj = F[:, EDGES[:, 0]], F[:, EDGES[:, 1]]
    X = (Fi >= 0) != (Fj >= 0)
    W = np.where(X, Fi / np.where(X, Fi - Fj, 1.0), 0.0)
    k = X.sum(1)
    out = []
    for kk in (3, 4):
        r = k == kk
        cols = np.nonzero(X[r])[1].reshape(-1, kk)
        rows = np.arange(r.sum())[:, None]
        ii, jj, ww = I[r][rows, cols], J[r][rows, cols], W[r][rows, cols]
        if kk == 4:   # order the quad's corners around its center, then two triangles
            q = tets.P[ii] * (1 - ww[..., None]) + tets.P[jj] * ww[..., None]
            q = q - q.mean(1, keepdims=True)
            ang = np.arctan2(q @ s["up"], q @ s["right"])
            o = np.argsort(ang, 1)
            ii, jj, ww = (np.take_along_axis(a, o, 1) for a in (ii, jj, ww))
            ii, jj, ww = (np.concatenate([a[:, [0, 1, 2]], a[:, [0, 2, 3]]]) for a in (ii, jj, ww))
        out.append((ii, jj, ww))
    ii, jj, ww = (np.concatenate(a) for a in zip(*out))
    lo, hi = np.minimum(ii, jj), np.maximum(ii, jj)
    wl = np.where(ii <= jj, ww, 1 - ww)
    _, first, tri = np.unique((lo.astype(np.int64) * len(tets.P) + hi).ravel(), return_index=True, return_inverse=True)
    vi, vj, vw = lo.ravel()[first], hi.ravel()[first], wl.ravel()[first]
    pos = tets.P[vi] * (1 - vw[:, None]) + tets.P[vj] * vw[:, None]
    return dict(i=vi, j=vj, w=vw, pos=pos, tri=tri.reshape(-1, 3))


def cut_tris(Pts, Tri, s):
    """membrane triangles in the ball crossing the plane -> line segments"""
    Tri = Tri[np.linalg.norm(Pts[Tri].mean(1) - s["bc"], axis=1) < s["br"]]
    f = (Pts - s["p0"]) @ s["n"]
    F = f[Tri]
    npos = (F >= 0).sum(1)
    C, F = Tri[(npos > 0) & (npos < 3)], F[(npos > 0) & (npos < 3)]
    xs, ps = [], []
    for a, b in ((0, 1), (0, 2), (1, 2)):
        x = (F[:, a] >= 0) != (F[:, b] >= 0)
        w = np.where(x, F[:, a] / np.where(x, F[:, a] - F[:, b], 1.0), 0.0)
        xs.append(x)
        ps.append(Pts[C[:, a]] * (1 - w[:, None]) + Pts[C[:, b]] * w[:, None])
    xs, ps = np.stack(xs, 1), np.stack(ps, 1)
    ok = xs.sum(1) == 2
    return ps[ok][xs[ok]].reshape(-1, 2, 3)


def outline(Tri):
    """boundary edges of a triangle patch (the synapse) as segments"""
    e = np.sort(np.concatenate([Tri[:, [0, 1]], Tri[:, [1, 2]], Tri[:, [2, 0]]]), 1)
    u, cnt = np.unique(e, axis=0, return_counts=True)
    return P[u[cnt == 1]]


CYT_T, ERL_T = Tets(0), Tets(1)
CUTS_C = [cut_tets(CYT_T, s) for s in SPINES]
CUTS_E = [cut_tets(ERL_T, s) for s in SPINES]
OL_PM = [cut_tris(P, T, s) for s in SPINES]
OL_ER = [cut_tris(E, TE, s) for s in SPINES]
SYN_OL = [outline(T[PM_SUB == s["k"] + 1]) for s in SPINES]


def concat_cuts(cuts):
    """all spines' cut vertices in one array; triangles re-indexed; per spine [vertex offset, count, index offset, count]"""
    pos, tri, i, j, w, rng, vb, ib = [], [], [], [], [], [], 0, 0
    for c in cuts:
        pos.append(c["pos"]); tri.append(c["tri"] + vb); i.append(c["i"]); j.append(c["j"]); w.append(c["w"])
        rng.append([vb, len(c["pos"]), ib, c["tri"].size])
        vb += len(c["pos"])
        ib += c["tri"].size
    return dict(pos=np.concatenate(pos), tri=np.concatenate(tri), i=np.concatenate(i), j=np.concatenate(j),
                w=np.concatenate(w), rng=rng)


def compact_cut(tets, cut):
    """the pieces to read each frame for this cut's edge ends (i and j together), and their indices after reading"""
    use, idx, n = tets.compact(np.concatenate([cut["i"], cut["j"]]))
    cut["ci"], cut["cj"] = idx[:len(cut["i"])], idx[len(cut["i"]):]
    return use, n


CUT_C, CUT_E = concat_cuts(CUTS_C), concat_cuts(CUTS_E)
CYT_USE, CYT_LEN = compact_cut(CYT_T, CUT_C)
ERL_USE, ERL_LEN = compact_cut(ERL_T, CUT_E)
print(f"cuts: cytosol {len(CUT_C['pos'])} vertices / {len(CUT_C['tri'])} triangles ({len(CYT_USE)} pieces read), "
      f"ER lumen {len(CUT_E['pos'])} / {len(CUT_E['tri'])} ({len(ERL_USE)} pieces); per spine (cyt/ER vertices): "
      + ", ".join(f"syn{s['k']} {a[1]}/{b[1]}" for s, a, b in zip(SPINES, CUT_C["rng"], CUT_E["rng"])), flush=True)


# ---------- the values, every 1 ms ----------
def q_log(c):
    lg = np.log10(np.clip(c, *CYT))
    return np.round((lg - np.log10(CYT[0])) / (np.log10(CYT[1]) - np.log10(CYT[0])) * 255).astype(np.uint8)


def q_lin(e):
    return np.round(np.clip((e - ER[0]) / (ER[1] - ER[0]), 0, 1) * 255).astype(np.uint8)


def frame(item):
    j, f = item
    ca = np.concatenate([read_field(V / f"result_s{s:02d}_t{f:04d}.pvtu", "ca_cyt") for s in PM_SUBSETS])
    ce = np.concatenate([read_field(V / f"result_s{s:02d}_t{f:04d}.pvtu", "ca_er") for s in ER_SUBSETS])
    vc = read_field(V / f"result_s00_t{f:04d}.pvtu", "ca_cyt", CYT_USE)
    ve = read_field(V / f"result_s01_t{f:04d}.pvtu", "ca_er", ERL_USE)
    assert len(ca) == N_PM_RAW and len(ce) == N_ER_RAW and len(vc) == CYT_LEN and len(ve) == ERL_LEN, f"frame {f}"
    ca, ce = ca[PM_FIRST], ce[ER_FIRST]
    pm = np.bincount(PM_LAB, ca, PM_N) / PM_CNT
    er = np.bincount(ER_LAB, ce, ER_N) / ER_CNT
    lc = np.log10(np.clip(vc, CYT[0], None))
    cc = 10 ** ((1 - CUT_C["w"]) * lc[CUT_C["ci"]] + CUT_C["w"] * lc[CUT_C["cj"]])   # along the edge in log
    cl = (1 - CUT_E["w"]) * ve[CUT_E["ci"]] + CUT_E["w"] * ve[CUT_E["cj"]]
    sa = [float(ce[s["sav"]].mean()) for s in SPINES]
    return j, np.concatenate([q_log(pm), q_lin(er), q_log(cc), q_lin(cl)]).tobytes(), ce.astype(np.float32), sa


def skeleton():
    """the SWC tree for the far view, where the dendrites are thinner than a pixel: each node takes up to 3 PM patches
    and 3 ER patches, those of the membrane vertices within its radius + 0.5 um, weighted by vertex count"""
    order = sorted(nodes)
    at = {i: k for k, i in enumerate(order)}
    X = np.array([nodes[i][1] for i in order])
    sg = np.array([(at[i], at[nodes[i][3]]) for i in order if nodes[i][3] in nodes])
    out = []
    for Pts, LAB in ((P, PM_LAB), (E, ER_LAB)):
        tree = cKDTree(Pts)
        ids = np.zeros((len(X), 3), np.int64)
        w8 = np.zeros((len(X), 3), np.int64)
        for k, (x, i) in enumerate(zip(X, order)):
            near = tree.query_ball_point(x, nodes[i][2] + 0.5)
            if len(near) < 3:
                near = tree.query(x, 24)[1]
            lab, cnt = np.unique(LAB[near], return_counts=True)
            o = np.argsort(-cnt)[:3]
            ids[k, :len(o)], w8[k, :len(o)] = lab[o], np.round(cnt[o] / cnt[o].sum() * 255)
            w8[k, 0] += 255 - w8[k].sum()
        out.append((ids, w8.astype(np.uint8)))
    return X, sg, out


def crossing(t, y, level):
    """first time y falls below level, linear between samples; None if never"""
    b = np.nonzero(y < level)[0]
    if not len(b):
        return None
    k = b[0]
    return float(t[0]) if k == 0 else float(t[k - 1] + (y[k - 1] - level) / (y[k - 1] - y[k]) * (t[k] - t[k - 1]))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    stride = PM_N + ER_N + len(CUT_C["pos"]) + len(CUT_E["pos"])
    vals = bytearray(stride * len(FRAMES))
    ET = np.zeros((len(FRAMES), len(E)), np.float32)
    SA = np.zeros((len(FRAMES), NS))
    with Pool(NPROC) as pool:
        for n, (j, b, ce, sa) in enumerate(pool.imap_unordered(frame, enumerate(FRAMES))):
            vals[j * stride:(j + 1) * stride] = b
            ET[j], SA[j] = ce, sa
            if n % 10 == 0:
                print(f"frame {n}/{len(FRAMES)}", flush=True)
    (OUT / "values.bin").write_bytes(bytes(vals))

    # released fractions of the ER membrane (vertices below HALF at any time up to t)
    tms = np.arange(len(FRAMES), dtype=np.float64)
    gone = np.minimum.accumulate(ET, axis=0) < HALF
    is_sa = np.zeros(len(E), bool)
    is_sa[SA_V] = True
    in_soma = np.linalg.norm(E - SOMA_C, axis=1) < SOMA_R - 1
    groups = dict(all=np.ones(len(E), bool), sa=is_sa, dend=~is_sa & ~in_soma, soma=in_soma)
    frac = {g_: np.round(gone[:, m].mean(1), 4).tolist() for g_, m in groups.items()}
    rel = np.array([crossing(tms, ET[:, v], HALF) if gone[-1, v] else np.nan for v in range(len(E))])

    def when(m, q):
        """the time by which q % of these vertices had released (never released counts as never)"""
        v = float(np.percentile(np.where(np.isnan(rel[m]), np.inf, rel[m]), q, method="nearest"))
        return round(v, 1) if np.isfinite(v) else None

    # the synapses: ug4's own measurement every 5 us
    traces, synpk = [], []
    for s in SPINES:
        m = np.loadtxt(RUN / f"output/meas/data_syn{s['k']}_ca_cyt")
        traces.append(q_log(m[::TRACE_EVERY, 1]))
        synpk.append((float(m[:, 1].max()), float(m[np.argmax(m[:, 1]), 0])))
    np.stack(traces).tofile(OUT / "traces.bin")

    # mesh.bin: named, 4-byte-aligned sections
    sections, blob = {}, bytearray()

    def put(name, a, dtype):
        a = np.ascontiguousarray(a, dtype)
        while len(blob) % 4:
            blob.append(0)
        sections[name] = dict(offset=len(blob), count=int(a.size), type=np.dtype(dtype).name)
        blob.extend(a.tobytes())

    for nm, Q, Tq, (ids_, w8) in (("pm", DP, DT_, PM_W), ("er", DE, DTE, ER_W), ("fpm", FP, FT, FPM_W), ("fer", FE, FTE, FER_W)):
        put(f"{nm}.position", rot(Q), np.float32)
        put(f"{nm}.index", Tq, np.uint32)
        put(f"{nm}.patch", ids_, np.uint16)
        put(f"{nm}.weight", w8, np.uint8)
    for nm, b_, lv in (("fpm", FP_BALL, FP_LV), ("fer", FE_BALL, FE_LV)):
        put(f"{nm}.ball", b_, np.uint8)
        put(f"{nm}.level", lv, np.float32)
    for nm, cut in (("cutCyt", CUT_C), ("cutEr", CUT_E)):
        put(f"{nm}.position", rot(cut["pos"]), np.float32)
        put(f"{nm}.index", cut["tri"], np.uint32)
    rngs = {}
    for nm, segs in (("olPm", OL_PM), ("olEr", OL_ER), ("synOutline", SYN_OL)):
        a = [rot(sg_.reshape(-1, 3)) for sg_ in segs]
        rngs[nm] = np.concatenate([[0], np.cumsum([len(x) for x in a])]).tolist()
        put(nm, np.concatenate(a), np.float32)
    SK_X, SK_SEG, ((SK_PI, SK_PW), (SK_EI, SK_EW)) = skeleton()
    put("skel.position", rot(SK_X), np.float32)
    put("skel.index", SK_SEG, np.uint32)
    put("skel.patch", SK_PI, np.uint16)
    put("skel.weight", SK_PW, np.uint8)
    put("skel.erPatch", SK_EI, np.uint16)
    put("skel.erWeight", SK_EW, np.uint8)
    (OUT / "mesh.bin").write_bytes(bytes(blob))

    spines = []
    for i, s in enumerate(SPINES):
        sa_t = SA[:, i]
        spines.append(dict(
            name=f"syn{s['k']}", k=s["k"], distUm=round(s["dist"], 1), synAreaUm2=round(s["area"], 3),
            synPeakUM=round(synpk[i][0] * 1e6, 1), synPeakMs=round(synpk[i][1] * 1e3, 2),
            saHalfMs=None if crossing(tms, sa_t, HALF) is None else round(crossing(tms, sa_t, HALF), 2),
            saMinUM=round(float(sa_t.min()) * 1e6, 1), saEndUM=round(float(sa_t[-1]) * 1e6, 1),
            sa=np.round(sa_t * 1e6, 1).tolist(),
            syn=np.round(rot(s["c"]), 3).tolist(), foot=np.round(rot(s["foot"]), 3).tolist(),
            saCenter=np.round(rot(s["p0"]), 3).tolist(),
            up=np.round(dirn(s["up"]), 5).tolist(), right=np.round(dirn(s["right"]), 5).tolist(),
            normal=np.round(dirn(s["n"]), 5).tolist(),
            ball=np.round(rot(s["bc"]), 3).tolist() + [round(s["br"], 3)],
            cut=dict(cyt=CUT_C["rng"][i], er=CUT_E["rng"][i], olPm=rngs["olPm"][i:i + 2], olEr=rngs["olEr"][i:i + 2]),
            outline=rngs["synOutline"][i:i + 2],
        ))
    lo3, hi3 = rot(P).min(0), rot(P).max(0)
    meta = dict(
        frames=len(FRAMES), dtMs=1.0,
        cytRangeUM=[CYT[0] * 1e6, CYT[1] * 1e6], erRangeUM=[ER[0] * 1e6, ER[1] * 1e6],
        values=dict(stride=stride, pm=[0, PM_N], er=[PM_N, ER_N], cutCyt=[PM_N + ER_N, len(CUT_C["pos"])],
                    cutEr=[PM_N + ER_N + len(CUT_C["pos"]), len(CUT_E["pos"])]),
        mesh=sections,
        traces=dict(spines=NS, samples=len(traces[0]), dtMs=TRACE_EVERY * 5e-3),
        bounds=[np.round(lo3, 1).tolist(), np.round(hi3, 1).tolist()],
        soma=dict(center=[0, 0, 0], radius=round(SOMA_R, 2)),
        spines=spines,
        order=[s["k"] for s in sorted(SPINES, key=lambda s: s["dist"])],
        released=frac,
        releaseMs=dict(all50=when(groups["all"], 50), all90=when(groups["all"], 90), soma1=when(in_soma, 1),
                       soma50=when(in_soma, 50), soma99=when(in_soma, 99), sa50=when(is_sa, 50)),
        erMeanUM=np.round(ET.mean(1) * 1e6, 1).tolist(),
    )
    json.dump(meta, open(OUT / "cell.json", "w"), separators=(",", ":"))
    print("released at 50 % / 90 % of the ER membrane:", meta["releaseMs"])
    print("fractions at 2, 10, 25, 40, 50, 70 ms:", {g_: [frac[g_][t] for t in (2, 10, 25, 40, 50, 70)] for g_ in frac})
    for s in spines:
        print(f"  {s['name']:5s} {s['distUm']:6.1f} um  synapse peak {s['synPeakUM']:5.1f} uM at {s['synPeakMs']:5.2f} ms"
              f"  SA half {s['saHalfMs']} ms, min {s['saMinUM']} uM, end {s['saEndUM']} uM")
    print("ER mean at 0 / 100 ms:", meta["erMeanUM"][0], meta["erMeanUM"][-1], "uM")
    print({p.name: f"{p.stat().st_size / 1e6:.2f} MB" for p in sorted(OUT.iterdir())}, flush=True)
