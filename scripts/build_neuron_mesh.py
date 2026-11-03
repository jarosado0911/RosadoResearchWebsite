#!/usr/bin/env python3
"""Converts the home page's cell (the CA1 surface by NeuronMesh with 400 real spines welded in by SpineBuilder,
data/ca1/ca1_spines_web.ugx.gz) into what the background renderer loads.

Every vertex gets its path distance from the soma surface along NeuronMesh's 1D skeleton
(data/ca1/ca1_neuronmesh_1d.swc, distance of the nearest skeleton point): the action potential front follows it.
Output: public/neuron/ca1_mesh.json (counts, byte offsets, somaRadius, maxDist, bounds, spines) and
        public/neuron/ca1_mesh.bin (float32 xyz [um], float32 path distance [um], uint32 triangle indices).
Usage:  python3 scripts/build_neuron_mesh.py
"""
import gzip, json, re
from collections import deque
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
s = gzip.open(ROOT / "data/ca1/ca1_spines_web.ugx.gz", "rt").read()
V = np.array(re.search(r'<vertices coords="3">([^<]*)</vertices>', s).group(1).split(), float).reshape(-1, 3)
T = np.array(re.search(r"<triangles>([^<]*)</triangles>", s).group(1).split(), int).reshape(-1, 3)

# the 1D skeleton: path distance of every node from the soma (node 1)
rows = [l.split() for l in (ROOT / "data/ca1/ca1_neuronmesh_1d.swc").read_text().splitlines() if l.strip() and not l.startswith("#")]
ids = {int(r[0]): k for k, r in enumerate(rows)}
X = np.array([[float(v) for v in r[2:5]] for r in rows])
R = np.array([float(r[5]) for r in rows])
par = np.array([ids.get(int(r[6]), -1) for r in rows])
kind = np.array([int(r[1]) for r in rows])
kids = [[] for _ in rows]
for i, p in enumerate(par):
    if p >= 0: kids[p].append(i)
root = int(np.flatnonzero(par < 0)[0])
dist = np.zeros(len(rows)); q = deque([root])
while q:
    u = q.popleft()
    for v in kids[u]:
        dist[v] = dist[u] + np.linalg.norm(X[v] - X[u]); q.append(v)
somaR = float(R[kind == 1].max()) if (kind == 1).any() else float(R[root])

# nearest skeleton node of every vertex (in chunks)
near = np.empty(len(V), int)
for a in range(0, len(V), 4000):
    d2 = ((V[a:a + 4000, None, :] - X[None, :, :]) ** 2).sum(-1)
    near[a:a + 4000] = d2.argmin(1)
D = np.maximum(0.0, dist[near] - somaR).astype(np.float32)

spines = sum(1 for l in (ROOT / "data/ca1/ca1_spines.log").read_text().splitlines() if l.startswith("syn"))
p, i = V.astype(np.float32), T.astype(np.uint32).ravel()
doc = {"name": "CA1 pyramidal neuron (A-Slide-3-section-2-neuron-1), meshed by NeuronMesh, spines by SpineBuilder",
       "vertices": len(V), "triangles": len(T), "spines": spines,
       "positions": 0, "distances": p.nbytes, "indices": p.nbytes + D.nbytes,
       "somaRadius": round(somaR, 3), "maxDist": round(float(D.max()), 1),
       "bounds": [np.round(V.min(0), 1).tolist(), np.round(V.max(0), 1).tolist()]}
dst = ROOT / "public/neuron"
(dst / "ca1_mesh.bin").write_bytes(p.tobytes() + D.tobytes() + i.tobytes())
(dst / "ca1_mesh.json").write_text(json.dumps(doc, indent=1))
print(f"{len(V)} vertices, {len(T)} triangles, {spines} spines, soma r {somaR:.2f}, max path {doc['maxDist']} um, "
      f"bounds {doc['bounds']}, {(dst / 'ca1_mesh.bin').stat().st_size / 1024:.0f} KB")
