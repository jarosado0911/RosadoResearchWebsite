#!/usr/bin/env python3
"""Writes the CA1 cell (data/ca1_graph.txt, exported from Neuro-VISOR) as an .swc file for NeuronMesh, in the
frame of the home page's background: centered on the soma, its main axis (the apical dendrite) along +y, as
scripts/build_neuron.py orients it.

Input:  data/ca1_graph.txt ("n ne nsoma", n lines "x y z r" [um], ne lines "u v length", the soma node ids)
Output: data/ca1/ca1.swc (soma: type 1, one point; everything else: type 3, parents toward the soma)
Usage:  python3 scripts/ca1_to_swc.py
"""
from collections import deque
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
lines = (ROOT / "data/ca1_graph.txt").read_text().split("\n")
n, ne, _ = map(int, lines[0].split())
P = np.array([[float(v) for v in lines[1 + i].split()] for i in range(n)])
xyz, rad = P[:, :3], P[:, 3]
adj = [[] for _ in range(n)]
for e in range(ne):
    u, v, l = lines[1 + n + e].split()
    adj[int(u)].append((int(v), float(l))); adj[int(v)].append((int(u), float(l)))
root = int(lines[1 + n + ne].split()[0])

# breadth-first from the soma: parents, path distances, the order the .swc needs (parents first)
parent = np.full(n, -1); dist = np.zeros(n); order = []
seen = np.zeros(n, bool); seen[root] = True; q = deque([root])
while q:
    u = q.popleft(); order.append(u)
    for v, l in adj[u]:
        if not seen[v]:
            seen[v] = True; parent[v] = u; dist[v] = dist[u] + l; q.append(v)

# the frame of build_neuron.py: length-weighted PCA, main axis -> +y toward the longer side
X = xyz - xyz[root]
w = np.array([dist[i] - dist[parent[i]] if parent[i] >= 0 else 0 for i in range(n)])
evals, evecs = np.linalg.eigh((X * w[:, None]).T @ X / w.sum())
axis = evecs[:, -1]
if (X @ axis * w).sum() < 0: axis = -axis
second = evecs[:, -2]
X = X @ np.stack([second, axis, np.cross(second, axis)]).T

ids = {u: k + 1 for k, u in enumerate(order)}
out = ["# CA1 pyramidal neuron (A-Slide-3-section-2-neuron-1), via Neuro-VISOR; written by scripts/ca1_to_swc.py",
       "# frame: centered on the soma, apical dendrite along +y (as the home page background)"]
for u in order:
    kind = 1 if u == root else 3
    out.append(f"{ids[u]} {kind} {X[u, 0]:.4f} {X[u, 1]:.4f} {X[u, 2]:.4f} {rad[u]:.4f} {ids[parent[u]] if parent[u] >= 0 else -1}")
dst = ROOT / "data/ca1/ca1.swc"
dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text("\n".join(out) + "\n")
print(f"{n} points, soma r {rad[root]:.2f} um -> {dst}")
