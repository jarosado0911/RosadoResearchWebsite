#!/usr/bin/env python3
"""Builds the geometry of the page transition (src/dive.js): a flight down a real dendrite of the CA1 cell.

Input:  public/neuron/ca1.json (the reconstruction the home page's neuron is meshed from: branches of
        x, y, z, radius, path distance [um], each starting at the end of its parent) and public/spines/*.json
        (the 10 reconstructed Vlachos spines: dendrite along z with radius 0.45 um, spine at the origin along +y).
Output: public/dive/dive.json (the route, its legs, the branches around it, the spine shapes' offsets) and
        public/dive/dive.bin (Float32 path and branch samples, Float32 spine positions, Uint16 spine triangles).

- The route: from a thin apical tip down the apical tree and trunk, over the soma, and out a basal dendrite
  (~420 um, smoothed with Catmull-Rom and resampled every STEP um). Each page change flies the next of the LEGS,
  each starting where the last one stopped: distal dendrite, branch points, the trunk, over the soma.
- The branches: the siblings that leave the route at its branch points (their first SIBLING_LENGTH um), and every
  other branch with a point within NEAR um, for the out-of-focus dendrites in the background.
- The spines: only the spine itself (the triangles off the dendrite's surface) and its synapse, base at the origin, +y
  outward; vertices from synStart on are the synapse's.

Usage: python3 scripts/build_dive.py
"""
import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DST = ROOT / "public/dive"
APICAL_TIP, BASAL_TIP = 71, 147   # branches of ca1.json: a thin apical tip 250 um out, a basal tip 151 um out
SOMA_CENTER = (0.0, 0.0, 0.0)     # the roots all start ~8.5 um from here
# the flights, in um of the route from the soma (- apical, + basal): one per page change, then round again
LEGS = [(-235, -165), (-165, -95), (-95, -25), (-25, 30)]   # the last one lingers over the soma
SIBLING_LENGTH = 30.0   # [um]
NEAR = 70.0             # [um] background branches
STEP = 0.25             # [um] resampling of the path and siblings
SPINES = ["0005", "0006", "0009", "0011", "0131", "0132", "0014", "0016", "0017"]   # 0018 (branched) is huge


def catmull_rom(points, step):
    """Smooth curve through points (centripetal-ish uniform Catmull-Rom), resampled every `step` of arc length."""
    p = np.vstack([2 * points[0] - points[1], points, 2 * points[-1] - points[-2]])
    dense = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for t in np.linspace(0, 1, 12, endpoint=False):
            t2, t3 = t * t, t * t * t
            dense.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    dense.append(points[-1])
    dense = np.array(dense)
    seg = np.linalg.norm(np.diff(dense[:, :3], axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    out = np.array([np.interp(np.arange(0, s[-1], step), s, dense[:, k]) for k in range(dense.shape[1])]).T
    return out


def main():
    cell = json.loads((ROOT / "public/neuron/ca1.json").read_text())
    B = [np.array(b, dtype=float).reshape(-1, 5) for b in cell["branches"]]
    length = [np.linalg.norm(np.diff(b[:, :3], axis=0), axis=1).sum() for b in B]
    # each branch starts at the end of its parent
    parent = []
    for i, b in enumerate(B):
        d = [np.linalg.norm(c[-1, :3] - b[0, :3]) if j != i else 1e9 for j, c in enumerate(B)]
        j = int(np.argmin(d))
        parent.append(j if d[j] < 0.5 else -1)
    children = {i: [k for k, p in enumerate(parent) if p == i] for i in range(len(B))}

    def chain_to_soma(tip):
        c, i = [], tip
        while i >= 0:
            c.append(i)
            i = parent[i]
        return c

    # the route: from the apical tip down to the soma (each branch runs proximal to distal, so reversed), through
    # the soma's center, and out to the basal tip
    up, down = chain_to_soma(APICAL_TIP), chain_to_soma(BASAL_TIP)
    pts = [B[up[0]][::-1, :4]] + [B[k][::-1, :4][1:] for k in up[1:]]
    pts.append(np.array([[*SOMA_CENTER, cell["somaRadius"]]]))
    pts += [B[k][:, :4] for k in down[::-1]]
    pts = np.vstack(pts)
    route = catmull_rom(pts, STEP)
    # through the soma the tube follows the sphere, so the camera rides up and over the cell body
    d = np.linalg.norm(route[:, :3] - np.array(SOMA_CENTER), axis=1)
    R = cell["somaRadius"] * 0.95
    route[:, 3] = np.maximum(route[:, 3], np.sqrt(np.clip(R * R - d * d, 0, None)))
    route[:, 3] = np.convolve(np.pad(route[:, 3], 8, mode="edge"), np.ones(17) / 17, mode="valid")   # smooth radii
    soma_s = float(np.argmin(d) * STEP)
    origin = np.array(SOMA_CENTER, dtype=float)

    # siblings: every branch that leaves the route (at its branch points, and the other roots on the soma)
    on_route = set(up) | set(down)
    branches = []
    for i, b in enumerate(B):
        if i in on_route or not (parent[i] in on_route or parent[i] < 0):
            continue
        sp = b[:, :4]
        ss = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(sp[:, :3], axis=0), axis=1))])
        sp = sp[ss <= SIBLING_LENGTH + 2]
        if len(sp) >= 2:
            branches.append(("sibling", catmull_rom(sp, STEP)))
    # the rest of the cell near the route (raw points; the out-of-focus background)
    for i, b in enumerate(B):
        if i in on_route:
            continue
        if np.min(np.linalg.norm(b[:, None, :3] - route[None, ::8, :3], axis=2)) < NEAR and len(b) >= 2:
            branches.append(("near", b[:, :4]))

    # spines: the spine's own surface (off the dendrite: radius from the z axis > 0.5, above it)
    spines, spos, sidx = [], [], []
    for sid in SPINES:
        pm = json.loads((ROOT / f"public/spines/{sid}.json").read_text())["parts"]["pm"]
        p = np.array(pm["p"], dtype=float).reshape(-1, 3)
        t = np.array(pm["i"], dtype=int).reshape(-1, 3)
        off = (np.hypot(p[:, 0], p[:, 1]) > 0.5) & (p[:, 1] > 0.2)   # clear of the spine file's own dendrite (r = 0.45)
        t = t[off[t].all(axis=1)]
        used = np.unique(t)
        remap = -np.ones(len(p), dtype=int)
        remap[used] = np.arange(len(used))
        q = p[used] - np.array([0, 0.45, 0])           # base on the dendrite's surface at the origin
        t = remap[t]
        # the synapse (postsynaptic density) is its own part: it closes the hole in the spine head
        parts = json.loads((ROOT / f"public/spines/{sid}.json").read_text())["parts"]
        syn_start = len(q)
        if "syn" in parts:
            sp = np.array(parts["syn"]["p"], dtype=float).reshape(-1, 3) - np.array([0, 0.45, 0])
            st = np.array(parts["syn"]["i"], dtype=int).reshape(-1, 3) + syn_start
            q, t = np.vstack([q, sp]), np.vstack([t, st])
        spines.append({"id": sid, "vertices": len(q), "triangles": len(t), "synStart": syn_start,
                       "height": round(float(q[:, 1].max()), 3)})
        spos.append(q.astype(np.float32))
        sidx.append(t.astype(np.uint16))

    # pack
    DST.mkdir(parents=True, exist_ok=True)
    blobs = []
    meta = {"origin": origin.round(3).tolist(), "step": STEP, "somaS": round(soma_s, 2),
            "legs": [[round(soma_s + a, 2), round(soma_s + b, 2)] for a, b in LEGS]}

    def add(arr):
        off = sum(x.nbytes for x in blobs)
        blobs.append(np.ascontiguousarray(arr))
        return off

    route_out = route.copy()
    route_out[:, :3] -= origin
    meta["path"] = {"offset": add(route_out.astype(np.float32)), "count": len(route_out)}
    meta["branches"] = []
    for kind, b in branches:
        b = b.copy()
        b[:, :3] -= origin
        meta["branches"].append({"kind": kind, "offset": add(b.astype(np.float32)), "count": len(b)})
    for sp, sp_pos, sp_idx in zip(spines, spos, sidx):
        sp["positions"] = add(sp_pos)
        sp["indices"] = add(sp_idx)
        if sum(x.nbytes for x in blobs) % 4:
            add(np.zeros(1, dtype=np.uint16))          # keep Float32 offsets aligned
    meta["spines"] = spines
    (DST / "dive.bin").write_bytes(b"".join(x.tobytes() for x in blobs))
    (DST / "dive.json").write_text(json.dumps(meta))
    size = (DST / "dive.bin").stat().st_size
    print(f"route {len(route)} samples ({len(route) * STEP:.0f} um, soma at {soma_s:.0f} um, radius {route[:, 3].min():.2f}-{route[:, 3].max():.2f}),"
          f" {sum(1 for k, _ in branches if k == 'sibling')} siblings, {sum(1 for k, _ in branches if k == 'near')} near branches,"
          f" {len(spines)} spines ({sum(s['vertices'] for s in spines)} vertices); dive.bin {size / 1024:.0f} kB")


if __name__ == "__main__":
    main()
