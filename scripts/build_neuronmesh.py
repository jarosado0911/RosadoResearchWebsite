#!/usr/bin/env python3
"""Converts the meshes in data/neuronmesh/ (made by scripts/make_neuronmesh_meshes.sh) into what the
neuronmesh.html page loads, and measures both meshes.

Input  (data/neuronmesh/): 0-2a.CNG.swc (the NeuroMorpho cell), neuronmesh_0-2a.ugx + neuronmesh_0-2a_1d.swc
       (NeuronMesh), python_0-2a.ugx (PythonNeuronMeshes), <name>_crossings.txt (TetGen -d: crossing triangle
       pairs, 0-based).
Output (public/neuronmesh/):
  mesh/<name>.json + .bin  parts (float32 xyz [um], then uint32 triangle indices): surface, clip (the triangles
                           that cross another triangle) and open (the boundary edges, as uint32 index pairs)
  cell.json                the SWC and the 1D skeleton (points with radius and parent), the stats of both meshes,
                           and the comparison spots (worst branch points for PythonNeuronMeshes, the soma)
Usage: python3 scripts/build_neuronmesh.py
"""
import json, re
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data/neuronmesh"
DST = ROOT / "public/neuronmesh"
MESHES = {"python": "python_0-2a.ugx", "neuronmesh": "neuronmesh_0-2a.ugx"}


def read_ugx(path):
    s = path.read_text()
    V = np.array(re.search(r'<vertices coords="3">([^<]*)</vertices>', s).group(1).split(), float).reshape(-1, 3)
    T = np.array(re.search(r"<triangles>([^<]*)</triangles>", s).group(1).split(), int).reshape(-1, 3)
    return V, T


def read_swc(path):
    rows = [l.split() for l in path.read_text().splitlines() if l.strip() and not l.startswith("#")]
    ids = [int(r[0]) for r in rows]
    index = {i: k for k, i in enumerate(ids)}
    pts = np.array([[float(v) for v in r[2:6]] for r in rows])              # x y z r
    kind = np.array([int(r[1]) for r in rows])
    parent = np.array([index.get(int(r[6]), -1) for r in rows])
    return pts, kind, parent


def edges(T):
    e = np.sort(np.vstack([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]), axis=1)
    return np.unique(e, axis=0, return_counts=True)


def stats(V, T, crossings):
    used = np.unique(T)
    ue, cnt = edges(T)
    p = np.arange(len(V))                                                   # pieces: union-find over edges
    def find(a):
        while p[a] != a:
            p[a] = p[p[a]]; a = p[a]
        return a
    for a, b in ue:
        ra, rb = find(a), find(b)
        if ra != rb: p[ra] = rb
    return {"vertices": int(len(used)), "triangles": int(len(T)), "pieces": len({find(i) for i in used}),
            "openEdges": int((cnt == 1).sum()), "nonManifoldEdges": int((cnt > 2).sum()),
            "euler": int(len(used) - len(ue) + len(T)),
            "crossingPairs": int(len(crossings)), "crossingTriangles": int(len(np.unique(crossings)))}


def part_blob(blob, name, V, idx):
    used, inv = np.unique(idx, return_inverse=True)
    p = V[used].astype(np.float32); i = inv.reshape(-1).astype(np.uint32)
    meta = {"name": name, "vertices": len(p), "count": len(i), "positions": len(blob), "indices": len(blob) + p.nbytes}
    blob += p.tobytes() + i.tobytes()
    return meta


DST.joinpath("mesh").mkdir(parents=True, exist_ok=True)
swc, kind, parent = read_swc(SRC / "0-2a.CNG.swc")
oned, _, oned_parent = read_swc(SRC / "neuronmesh_0-2a_1d.swc")
soma = swc[kind == 1][:, :3].mean(0)
somaR = float(swc[kind == 1][:, 3].max())

data, centroids = {}, {}
for name, file in MESHES.items():
    V, T = read_ugx(SRC / file)
    cr = np.loadtxt(SRC / f"{name}_crossings.txt", dtype=int).reshape(-1, 2)
    ue, cnt = edges(T)
    clip = np.unique(cr)
    blob = bytearray()
    parts = [part_blob(blob, "surface", V, T), part_blob(blob, "clip", V, T[clip]) if len(clip) else None,
             part_blob(blob, "open", V, ue[cnt == 1]) if (cnt == 1).any() else None]
    st = stats(V, T, cr)
    (DST / "mesh" / f"{name}.bin").write_bytes(bytes(blob))
    (DST / "mesh" / f"{name}.json").write_text(json.dumps({"name": name, "source": file, "unit": "um",
                                                         "parts": [p for p in parts if p]}, indent=1))
    data[name] = st
    centroids[name] = (V[T[clip]].mean(1) if len(clip) else np.zeros((0, 3)),
                       V[ue[cnt == 1]].mean(1) if (cnt == 1).any() else np.zeros((0, 3)))
    print(name, st, f"{len(blob) / 1024:.0f} KB")


def near(points, c, r):
    return int((np.linalg.norm(points - c, axis=1) < r).sum()) if len(points) else 0


# comparison spots: the branch points (2+ children, outside the soma) where PythonNeuronMeshes clips most
children = np.bincount(parent[parent >= 0], minlength=len(swc))
bps = [i for i in range(len(swc)) if children[i] >= 2 and kind[i] != 1 and np.linalg.norm(swc[i, :3] - soma) > somaR * 1.5]
scored = sorted(bps, key=lambda i: -near(centroids["python"][0], swc[i, :3], max(10.0, 4 * swc[i, 3])))
spots = []
for i in scored:
    if all(np.linalg.norm(swc[i, :3] - np.array(s["c"])) > 25 for s in spots):
        spots.append({"kind": "branch", "c": swc[i, :3].round(3).tolist(), "r": round(float(swc[i, 3]), 3)})
    if len(spots) == 3: break
spots.append({"kind": "soma", "c": soma.round(3).tolist(), "r": round(somaR, 3)})
for s in spots:
    c, r = np.array(s["c"]), (somaR * 2.2 if s["kind"] == "soma" else max(10.0, 4 * s["r"]))   # about what the view shows
    s["radius"] = round(float(r), 2)
    for name in MESHES:
        s[name] = {"crossing": near(centroids[name][0], c, r), "open": near(centroids[name][1], c, r)}

cell = {
    "swc": {"points": swc.round(3).tolist(), "parent": parent.tolist(), "kind": kind.tolist()},
    "skeleton": {"points": oned.round(3).tolist(), "parent": oned_parent.tolist()},
    "soma": {"c": soma.round(3).tolist(), "r": round(somaR, 3)},
    "stats": data, "spots": spots,
}
(DST / "cell.json").write_text(json.dumps(cell, separators=(",", ":")))
print("spots:", json.dumps(spots))
