#!/usr/bin/env python3
"""The whole-cell page (wholecell.html): the 100 ms ug4 run of SpineBuilder's ca_ug4_cell_test (the 0-2a cell with
ER, one synapse, RyR 3.5, IP3R 34.6, positivity guard), from its VTK output.

Output in public/wholecell/:
  cell.json   frames, color ranges, byte offsets into the .bin files, anchors (soma, syn1, the soma cut, the six
              primary dendrites as polylines) and the kymograph layout. Coordinates [um] are centered on the soma
              and turned to the video's view (x along the cell, y up, z toward the viewer).
  mesh.bin    the plasma membrane and ER membrane, decimated; per vertex up to 3 "patches" (about 1 um of membrane,
              0.4 um near the soma and syn1) with weights, and the cut level used to open the soma; the soma cut
              itself (cytosol and ER lumen triangles from the tetrahedra) and the membrane outlines on it; the SWC
              skeleton with its own patches, drawn when the dendrites are thinner than a pixel.
  values.bin  uint8, frame-major, every 0.5 ms: PM patches (cytosolic Ca, log 0.05-100 uM), ER patches (ER Ca,
              linear 0-260 uM), cut cytosol vertices (log), cut ER vertices (linear).
  kymo.bin    uint8 [field][dendrite][frame][1 um bin]: PM max (log), near-ER cytosol (log), ER (linear).

Usage:  ~/.venvs/website/bin/python scripts/build_wholecell.py [RUN_DIR]
        RUN_DIR defaults to ~/projects/SpineBuilder/ca_ug4_cell_test (needs output/vtk and output/video/*.npz).
Needs numpy, scipy, trimesh and fast-simplification. Reads 201 frames x 4 subsets of a 73 GB run: about 10 minutes.
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
OUT = ROOT / "public/wholecell"
RUN = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "projects/SpineBuilder/ca_ug4_cell_test")
V = RUN / "output/vtk"
NAME = "all_ryr3.5_ip3r34.6_noVDCC_er0.4_soma0.7_pm0.45_syn030_q15s_splitConv_posguard_run100ms"
SWC = RUN.parent / "anamorph_meshes/0-2a.CNG_er0.4loc.swc"
DT_MS, T_END_MS = 0.5, 100.0
CYT = (5e-8, 1e-4)        # [M] log color range of cytosolic Ca (the video's)
ER_HI = 260e-6            # [M] linear color range of ER Ca, 0..ER_HI
PM_KEEP, ER_KEEP = 0.23, 0.22   # fraction of triangles kept by the decimation
H_FINE, H = 0.4, 0.9      # [um] patch size near the soma and syn1, elsewhere
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


def read_mesh(path):
    """points (n, 3) and cell connectivity (m, k) of a .pvtu, parts concatenated in order"""
    pts, conn, base, k = [], [], 0, None
    for part in _parts(path):
        arrs = _ARR.findall(part.read_text())
        p = _decode(*arrs[0][::2]).reshape(-1, 3)
        if not len(p):
            continue
        d = {name: _decode(dt, txt) for dt, name, txt in arrs[1:] if name}
        c, o = d["connectivity"], d["offsets"]
        k = int(o[0])
        assert np.all(np.diff(o) == k), f"{part}: mixed cells"
        pts.append(p.astype(np.float64))
        conn.append(c.reshape(-1, k) + base)
        base += len(p)
    return np.concatenate(pts), np.concatenate(conn)


def read_field(path, name):
    pat = re.compile(rf'<DataArray type="(\w+)" Name="{name}"[^>]*>\s*([A-Za-z0-9+/=\s]*?)\s*</DataArray>', re.S)
    out = []
    for part in _parts(path):
        m = pat.search(part.read_text())
        if m:
            out.append(_decode(*m.groups()).astype(np.float64))
    return np.concatenate(out)


# ---------- the run ----------
Z = np.load(RUN / f"output/video/wave_{NAME}.npz")
SOMA_C, SYN0, TIP = (np.asarray(Z[k], np.float64) for k in ("soma_c", "syn0", "tip_past_xyz"))
pvd = (V / "result.pvd").read_text()
steps = sorted({(round(float(t) * 1e3, 4), int(f)) for t, f in re.findall(r'timestep="([^"]+)" part="1" file="result_s1_t(\d+)\.pvtu"', pvd)})
want = np.arange(0, T_END_MS + 1e-9, DT_MS)
FRAMES = [min(steps, key=lambda s: abs(s[0] - t))[1] for t in want]
assert all(abs(dict((f, t) for t, f in steps)[f] - t) < 1e-6 for f, t in zip(FRAMES, want)), "frame times"
first = f"t{steps[1][1]:04d}"

P, T = read_mesh(V / f"result_s1_{first}.pvtu")       # plasma membrane
PE, TE = read_mesh(V / f"result_s2_{first}.pvtu")     # ER membrane
P0, T0 = read_mesh(V / f"result_s0_{first}.pvtu")     # syn1 (a patch of the PM)
PC, TC = read_mesh(V / f"result_s3_{first}.pvtu")     # cytosol tetrahedra
PL, TL = read_mesh(V / f"result_s4_{first}.pvtu")     # ER lumen tetrahedra
print(f"PM {len(P)}/{len(T)}, ERM {len(PE)}/{len(TE)}, cytosol {len(PC)}/{len(TC)}, ER {len(PL)}/{len(TL)}, frames {len(FRAMES)}", flush=True)

# the video's view: x along the cell's long axis, y across it, z toward the viewer; origin at the soma center
c0 = P.mean(0)
_, _, VT = np.linalg.svd(P - c0, full_matrices=False)
for k in (0, 1):
    if (TIP - SOMA_C) @ VT[k] < 0:
        VT[k] = -VT[k]
VT[2] = np.cross(VT[0], VT[1])
rot = lambda X: (np.asarray(X, np.float64) - SOMA_C) @ VT.T  # noqa: E731

# ---------- the soma cut (as in the video's right pane): the plane through the soma center containing the incoming
# dendrite's entry segment, bent by up to ~0.6 um to follow the dendrite's centerline down to syn1 ----------
nodes = {}
for line in open(SWC):
    if line.startswith("#") or not line.strip():
        continue
    i, t_, x, y, z, r, p = line.split()[:7]
    nodes[int(i)] = (int(t_), np.array([float(x), float(y), float(z)]), float(r), int(p))
ids = list(nodes)
NP_ = np.array([nodes[i][1] for i in ids])
path = [ids[int(np.argmin(np.linalg.norm(NP_ - SYN0, axis=1)))]]
while nodes[path[-1]][3] in nodes and nodes[path[-1]][0] != 1:
    path.append(nodes[path[-1]][3])
D = np.array([nodes[i][1] for i in path if nodes[i][0] != 1] + [SOMA_C])
CL = np.concatenate([np.linspace(D[a], D[a + 1], max(2, int(np.linalg.norm(D[a + 1] - D[a]) / 0.1) + 1)) for a in range(len(D) - 1)])
axis = D[-2] - SOMA_C
axis /= np.linalg.norm(axis)
Xc = CL - SOMA_C
e2 = np.linalg.svd(Xc - np.outer(Xc @ axis, axis), full_matrices=False)[2][0]
e2 -= (e2 @ axis) * axis
e2 /= np.linalg.norm(e2)
NRM = np.cross(axis, e2)
if NRM @ VT[2] < 0:
    NRM = -NRM
OFF = Xc @ NRM
down = (SYN0 - SOMA_C) - ((SYN0 - SOMA_C) @ NRM) * NRM
down /= np.linalg.norm(down)
SY = -down                    # up on the cut: the soma on top, syn1 at the bottom
SXV = np.cross(SY, NRM)
cl_tree = cKDTree(CL)
CUT_NEAR, CUT_FAR = 1.0, 2.5


def level(X):
    """signed distance to the (bent) cut; > 0 on the viewer's side"""
    dist, idx = cl_tree.query(X, distance_upper_bound=CUT_FAR)
    ok = np.isfinite(dist)
    off = np.zeros(len(X))
    s = np.clip((CUT_FAR - dist[ok]) / (CUT_FAR - CUT_NEAR), 0, 1)
    off[ok] = OFF[idx[ok]] * s * s * (3 - 2 * s)
    return (X - SOMA_C) @ NRM - off


to2d = lambda X: np.stack([(X - SOMA_C) @ SXV, (X - SOMA_C) @ SY], -1)  # noqa: E731
cl2 = to2d(CL)
ext = np.vstack([cl2, [[-5.5, -5.5], [5.5, 5.5]]])
LO2, HI2 = ext.min(0) - 1.5, ext.max(0) + 1.5
in_win = lambda xy, m=0.0: ((xy[..., 0] > LO2[0] - m) & (xy[..., 0] < HI2[0] + m) & (xy[..., 1] > LO2[1] - m) & (xy[..., 1] < HI2[1] + m))  # noqa: E731
EDGES = np.array([(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)])


def cut_tets(Pts, conn):
    """tetrahedra crossing the cut -> triangles over shared vertices; a vertex is a point on a tet edge (i, j, w)"""
    f = level(Pts)
    fv = f[conn]
    npos = (fv >= 0).sum(1)
    m = (npos > 0) & (npos < 4) & in_win(to2d(Pts[conn].mean(1)), 2.0)
    C, F = conn[m], fv[m]
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
            xy = to2d(Pts[ii] * (1 - ww[..., None]) + Pts[jj] * ww[..., None])
            ang = np.arctan2(*(xy - xy.mean(1, keepdims=True)).transpose(2, 0, 1)[::-1])
            o = np.argsort(ang, 1)
            ii, jj, ww = (np.take_along_axis(a, o, 1) for a in (ii, jj, ww))
            ii, jj, ww = (np.concatenate([a[:, [0, 1, 2]], a[:, [0, 2, 3]]]) for a in (ii, jj, ww))
        out.append((ii, jj, ww))
    ii, jj, ww = (np.concatenate(a) for a in zip(*out))
    keep = in_win(to2d(Pts[ii] * (1 - ww[..., None]) + Pts[jj] * ww[..., None]).mean(1))
    ii, jj, ww = ii[keep], jj[keep], ww[keep]
    # shared vertices: one per crossing edge
    lo, hi = np.minimum(ii, jj), np.maximum(ii, jj)
    wl = np.where(ii <= jj, ww, 1 - ww)                  # weight from lo toward hi
    key = lo.astype(np.int64) * len(Pts) + hi
    uk, first_, tri = np.unique(key.ravel(), return_index=True, return_inverse=True)
    vi, vj, vw = lo.ravel()[first_], hi.ravel()[first_], wl.ravel()[first_]
    pos = Pts[vi] * (1 - vw[:, None]) + Pts[vj] * vw[:, None]
    return dict(i=vi, j=vj, w=vw, pos=pos, tri=tri.reshape(-1, 3))


def cut_tris(Pts, Tri):
    """membrane triangles crossing the cut -> 3D line segments"""
    f = level(Pts)
    fv = f[Tri]
    npos = (fv >= 0).sum(1)
    m = (npos > 0) & (npos < 3)
    C, F = Tri[m], fv[m]
    xs, ps = [], []
    for a, b in ((0, 1), (0, 2), (1, 2)):
        x = (F[:, a] >= 0) != (F[:, b] >= 0)
        w = np.where(x, F[:, a] / np.where(x, F[:, a] - F[:, b], 1.0), 0.0)
        xs.append(x)
        ps.append(Pts[C[:, a]] * (1 - w[:, None]) + Pts[C[:, b]] * w[:, None])
    xs, ps = np.stack(xs, 1), np.stack(ps, 1)
    ok = xs.sum(1) == 2
    seg = ps[ok][xs[ok]].reshape(-1, 2, 3)
    return seg[in_win(to2d(seg.mean(1)))]


CUT_C, CUT_E = cut_tets(PC, TC), cut_tets(PL, TL)
SEG_PM = np.concatenate([cut_tris(P, T), cut_tris(P0, T0)])
SEG_ER = cut_tris(PE, TE)
print(f"cut: cytosol {len(CUT_C['tri'])} tris / {len(CUT_C['pos'])} verts, ER {len(CUT_E['tri'])} / {len(CUT_E['pos'])}; "
      f"outline segments PM {len(SEG_PM)}, ER {len(SEG_ER)}", flush=True)


# ---------- decimated membranes, and the patches their colors come from ----------
def patches(Pts, Tri):
    """Group the full-resolution vertices into patches: one voxel (H_FINE near the soma and syn1, else H) and one
    connected piece of membrane inside it. Returns the patch of every vertex, the patch count and centers."""
    near = (np.linalg.norm(Pts - SOMA_C, axis=1) < 13) | (np.linalg.norm(Pts - SYN0, axis=1) < 9)
    h = np.where(near, H_FINE, H)
    key = np.concatenate([near[:, None], np.floor(Pts / h[:, None])], 1).astype(np.int64)
    _, vox = np.unique(key, axis=0, return_inverse=True)
    e = np.concatenate([Tri[:, [0, 1]], Tri[:, [1, 2]], Tri[:, [2, 0]]])
    e = e[vox[e[:, 0]] == vox[e[:, 1]]]
    g = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(Pts), len(Pts)))
    n, lab = connected_components(g, directed=False)
    cnt = np.bincount(lab, minlength=n)
    cen = np.stack([np.bincount(lab, Pts[:, k], n) for k in range(3)], 1) / cnt[:, None]
    return lab, n, cnt, cen, h


def decimate(Pts, Tri, keep):
    """weld the MPI partitions' duplicated seam vertices, wind every triangle the same way, decimate, wind again
    (consistent winding makes smooth normals and two-sided lighting work)"""
    m = trimesh.Trimesh(Pts, Tri, process=True)
    trimesh.repair.fix_winding(m)
    p, t = fast_simplification.simplify(m.vertices.astype(np.float32), m.faces.astype(np.int32), target_reduction=1 - keep)
    m = trimesh.Trimesh(p.astype(np.float64), t, process=True)
    trimesh.repair.fix_winding(m)
    return np.asarray(m.vertices, np.float64), np.asarray(m.faces, np.int64)


def weights(Q, Pts, lab, cen, h):
    """up to 3 patches per decimated vertex: those of the full-resolution vertices within 1.2 h, Gaussian in the
    distance to each patch's center"""
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
    q8[:, 0] += 255 - q8.sum(1)                          # exact sums of 255
    return ids, q8.astype(np.uint8)


def clip_level(Q):
    """the cut level where the soma cut opens the membranes (inside its window), else a large negative number"""
    lv = level(Q)
    return np.where(in_win(to2d(Q)), lv, -1e3)


def skeleton():
    """The SWC tree (every node and segment) for the far view, where the dendrites are thinner than a pixel. Each node
    takes up to 3 PM patches: those of the membrane vertices within its radius + 0.5 um, weighted by vertex count."""
    order = sorted(nodes)
    at = {i: k for k, i in enumerate(order)}
    X = np.array([nodes[i][1] for i in order])
    seg = np.array([(at[i], at[nodes[i][3]]) for i in order if nodes[i][3] in nodes])
    tree = cKDTree(P)
    ids = np.zeros((len(X), 3), np.int64)
    w8 = np.zeros((len(X), 3), np.int64)
    for k, (x, i) in enumerate(zip(X, order)):
        near = tree.query_ball_point(x, nodes[i][2] + 0.5)
        if len(near) < 3:
            near = tree.query(x, 24)[1]
        lab, cnt = np.unique(PM_LAB[near], return_counts=True)
        o = np.argsort(-cnt)[:3]
        w = cnt[o] / cnt[o].sum()
        ids[k, :len(o)], w8[k, :len(o)] = lab[o], np.round(w * 255)
        w8[k, 0] += 255 - w8[k].sum()
    return X, seg, ids, w8.astype(np.uint8)


PM_LAB, PM_N, PM_CNT, PM_CEN, PM_H = patches(P, T)
ER_LAB, ER_N, ER_CNT, ER_CEN, ER_H = patches(PE, TE)
DP, DT_ = decimate(P, T, PM_KEEP)
DE, DTE = decimate(PE, TE, ER_KEEP)
PM_W = weights(DP, P, PM_LAB, PM_CEN, PM_H)
ER_W = weights(DE, PE, ER_LAB, ER_CEN, ER_H)
assert PM_N < 65536 and ER_N < 65536
print(f"decimated PM {len(DP)}/{len(DT_)}, ER {len(DE)}/{len(DTE)}; patches PM {PM_N}, ER {ER_N}", flush=True)


# ---------- the values, every 0.5 ms ----------
def q_log(c):
    lg = np.log10(np.clip(c, *CYT))
    return np.round((lg - np.log10(CYT[0])) / (np.log10(CYT[1]) - np.log10(CYT[0])) * 255).astype(np.uint8)


def q_lin(e):
    return np.round(np.clip(e / ER_HI, 0, 1) * 255).astype(np.uint8)


def frame(item):
    j, f = item
    ca = read_field(V / f"result_s1_t{f:04d}.pvtu", "ca_cyt")
    ce = read_field(V / f"result_s2_t{f:04d}.pvtu", "ca_er")
    vc = read_field(V / f"result_s3_t{f:04d}.pvtu", "ca_cyt")
    ve = read_field(V / f"result_s4_t{f:04d}.pvtu", "ca_er")
    assert len(ca) == len(P) and len(ce) == len(PE) and len(vc) == len(PC) and len(ve) == len(PL), f"frame {f}"
    pm = np.bincount(PM_LAB, ca, PM_N) / PM_CNT
    er = np.bincount(ER_LAB, ce, ER_N) / ER_CNT
    lc = np.log10(np.clip(vc, CYT[0], None))
    cc = 10 ** ((1 - CUT_C["w"]) * lc[CUT_C["i"]] + CUT_C["w"] * lc[CUT_C["j"]])   # along the edge in log, as the video
    cl = (1 - CUT_E["w"]) * ve[CUT_E["i"]] + CUT_E["w"] * ve[CUT_E["j"]]
    return j, np.concatenate([q_log(pm), q_lin(er), q_log(cc), q_lin(cl)]).tobytes(), float(vc.min()), float(ca.max())


# ---------- kymographs from the run's profiles (1 um bins along each primary dendrite) ----------
PR = np.load(RUN / f"output/video/profiles_{NAME}.npz")
GEO = np.load(RUN / f"output/video/geom_{NAME}.npz")
fields = list(PR["fields"])
KYMO_BINS = 182
kt = np.array([int(np.argmin(np.abs(PR["t"] * 1e3 - t))) for t in want])


def fill(a):
    """NaN bins (no mesh nodes there) take the nearest valid bin's value"""
    a = a.copy()
    for row in a:
        ok = np.isfinite(row)
        if ok.any() and not ok.all():
            idx = np.arange(len(row))
            row[~ok] = row[ok][np.abs(idx[~ok, None] - idx[None, ok]).argmin(1)]
    return np.nan_to_num(a, nan=CYT[0])


kymo = []
for fname, q in (("pm_max", q_log), ("erm_cyt", q_log), ("erm_mean", q_lin)):
    blk = PR["PROF"][kt, fields.index(fname), :, :KYMO_BINS].astype(np.float64)   # (frame, dendrite, bin)
    kymo.append(np.stack([q(fill(blk[:, d, :])) for d in range(blk.shape[1])]))   # (dendrite, frame, bin)
kymo = np.stack(kymo)


# ---------- anchors: the six primary dendrites as polylines (the longest path in each), every 2 um ----------
kids = {i: [] for i in nodes}
for i, n_ in nodes.items():
    if n_[3] in nodes:
        kids[n_[3]].append(i)
depth = {}
for i in sorted(nodes, key=lambda k: -k):   # SWC ids grow away from the soma
    depth[i] = max([depth[k] + np.linalg.norm(nodes[k][1] - nodes[i][1]) for k in kids[i]], default=0.0)
dends = []
for d, root in enumerate(int(r) for r in PR["roots"]):
    pts = [SOMA_C, nodes[root][1]]
    u = root
    while kids[u]:
        u = max(kids[u], key=lambda k: depth[k] + np.linalg.norm(nodes[k][1] - nodes[u][1]))
        pts.append(nodes[u][1])
    pts = np.array(pts)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    si = np.arange(0, s[-1], 2.0)
    line = np.stack([np.interp(si, s, pts[:, k]) for k in range(3)], 1)
    dends.append(dict(root=root, length=round(float(GEO["length"][d]), 1), swcType=int(GEO["swc_type"][d]),
                      path=np.round(rot(line), 2).ravel().tolist()))

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    stride = PM_N + ER_N + len(CUT_C["pos"]) + len(CUT_E["pos"])
    vals = bytearray(stride * len(FRAMES))
    vmin, vmax = 1.0, 0.0
    with Pool(NPROC) as pool:
        for n, (j, b, lo, hi) in enumerate(pool.imap_unordered(frame, enumerate(FRAMES))):
            vals[j * stride:(j + 1) * stride] = b
            vmin, vmax = min(vmin, lo), max(vmax, hi)
            if n % 20 == 0:
                print(f"frame {n}/{len(FRAMES)}", flush=True)
    (OUT / "values.bin").write_bytes(bytes(vals))
    kymo.tofile(OUT / "kymo.bin")

    # mesh.bin: named, 4-byte-aligned sections
    sections, blob = {}, bytearray()

    def put(name, a, dtype):
        a = np.ascontiguousarray(a, dtype)
        while len(blob) % 4:
            blob.append(0)
        sections[name] = dict(offset=len(blob), count=int(a.size), type=np.dtype(dtype).name)
        blob.extend(a.tobytes())

    for nm, Q, Tq, (ids_, w8) in (("pm", DP, DT_, PM_W), ("er", DE, DTE, ER_W)):
        put(f"{nm}.position", rot(Q), np.float32)
        put(f"{nm}.index", Tq, np.uint32)
        put(f"{nm}.patch", ids_, np.uint16)
        put(f"{nm}.weight", w8, np.uint8)
        put(f"{nm}.cut", clip_level(Q), np.float32)
    for nm, cut in (("cutCyt", CUT_C), ("cutEr", CUT_E)):
        put(f"{nm}.position", rot(cut["pos"]), np.float32)
        put(f"{nm}.index", cut["tri"], np.uint32)
    SK_X, SK_SEG, SK_IDS, SK_W = skeleton()
    put("skel.position", rot(SK_X), np.float32)
    put("skel.index", SK_SEG, np.uint32)
    put("skel.patch", SK_IDS, np.uint16)
    put("skel.weight", SK_W, np.uint8)
    put("outlinePm", rot(SEG_PM.reshape(-1, 3)), np.float32)
    put("outlineEr", rot(SEG_ER.reshape(-1, 3)), np.float32)
    (OUT / "mesh.bin").write_bytes(bytes(blob))

    R3 = VT  # the turn, applied to directions too
    lo3, hi3 = rot(P).min(0), rot(P).max(0)
    win_c = SOMA_C + SXV * (LO2[0] + HI2[0]) / 2 + SY * (LO2[1] + HI2[1]) / 2
    json.dump(dict(
        frames=len(FRAMES), dtMs=DT_MS,
        cytRangeUM=[CYT[0] * 1e6, CYT[1] * 1e6], erRangeUM=[0, ER_HI * 1e6],
        values=dict(stride=stride, pm=[0, PM_N], er=[PM_N, ER_N], cutCyt=[PM_N + ER_N, len(CUT_C["pos"])],
                    cutEr=[PM_N + ER_N + len(CUT_C["pos"]), len(CUT_E["pos"])]),
        mesh=sections,
        bounds=[np.round(lo3, 1).tolist(), np.round(hi3, 1).tolist()],
        soma=dict(center=[0, 0, 0], radius=4.79, erRadius=3.36),
        syn1=np.round(rot(P0.mean(0)), 2).tolist(),
        cut=dict(normal=np.round(R3 @ NRM, 4).tolist(), up=np.round(R3 @ SY, 4).tolist(), right=np.round(R3 @ SXV, 4).tolist(),
                 center=np.round(rot(win_c), 2).tolist(), size=np.round(HI2 - LO2, 2).tolist()),
        dendrites=dends,
        kymo=dict(fields=["pm_max", "erm_cyt", "erm_mean"], dendrites=len(dends), frames=len(FRAMES), bins=KYMO_BINS, binUm=1.0),
    ), open(OUT / "cell.json", "w"), separators=(",", ":"))
    print(f"min cytosol {vmin * 1e9:.0f} nM, max PM {vmax * 1e6:.1f} uM;",
          {p.name: f"{p.stat().st_size / 1e6:.2f} MB" for p in sorted(OUT.iterdir())}, flush=True)
