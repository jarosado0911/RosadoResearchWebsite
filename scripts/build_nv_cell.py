#!/usr/bin/env python3
"""The CA1 cell for the two Neuro-VISOR pages' backgrounds: the refined 1D graph (data/ca1_graph.txt, the grid the
simulations run on) thinned to points about SPACING um apart along each branch, as runs of point indices.

Writes public/neurovisor/cell.json:
  n, x, y, z, radius (per point, um), soma (point indices), runs (lists of point indices, branch point to branch point),
  src (per point: the simulation node it shows), somaRadius
Used by scripts/pack_nv_frames.py to pick the simulated values of each point.

Usage: python3 scripts/build_nv_cell.py [spacing_um]
"""
import json, sys
from collections import deque
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SPACING = float(sys.argv[1]) if len(sys.argv) > 1 else 2.0

lines = (ROOT / "data/ca1_graph.txt").read_text().split("\n")
n, ne, _ = map(int, lines[0].split())
P = np.array([[float(v) for v in lines[1 + i].split()] for i in range(n)])
xyz, rad = P[:, :3], P[:, 3]
adj = [[] for _ in range(n)]
for e in range(ne):
    u, v, l = lines[1 + n + e].split()
    adj[int(u)].append((int(v), float(l))); adj[int(v)].append((int(u), float(l)))
root = int(lines[1 + n + ne].split()[0])
somaR = float(rad[root])

# tree from the soma
parent = np.full(n, -1); children = [[] for _ in range(n)]
seen = np.zeros(n, bool); seen[root] = True; q = deque([root])
while q:
    u = q.popleft()
    for v, l in adj[u]:
        if not seen[v]:
            seen[v] = True; parent[v] = u; children[u].append(v); q.append(v)

# the same upright orientation as the home page's neuron (main axis -> +y)
X = xyz - xyz[root]
w = np.array([np.linalg.norm(X[i] - X[parent[i]]) if parent[i] >= 0 else 0 for i in range(n)])
cov = (X * w[:, None]).T @ X / w.sum()
ev, V = np.linalg.eigh(cov)
axis = V[:, -1] * (1 if (X @ V[:, -1] * w).sum() >= 0 else -1)
second = V[:, -2]
R = np.stack([second, axis, np.cross(second, axis)])
X = X @ R.T

keep = {root: 0}; pts = [root]; runs = []
def point(i):
    if i not in keep:
        keep[i] = len(pts); pts.append(i)
    return keep[i]

stack = list(children[root])
while stack:
    s = stack.pop()
    ch = [parent[s], s]
    while len(children[ch[-1]]) == 1: ch.append(children[ch[-1]][0])
    stack.extend(children[ch[-1]])
    run = [point(ch[0])]; acc = 0.0
    for a, b in zip(ch[:-1], ch[1:]):
        acc += np.linalg.norm(X[b] - X[a])
        if b == ch[-1] or acc >= SPACING:
            run.append(point(b)); acc = 0.0
    runs.append(run)

pts = np.array(pts)
out = {
    "n": len(pts),
    "x": np.round(X[pts, 0], 2).tolist(), "y": np.round(X[pts, 1], 2).tolist(), "z": np.round(X[pts, 2], 2).tolist(),
    "radius": np.round(rad[pts], 3).tolist(),
    "soma": [0], "somaRadius": round(somaR, 3),
    "runs": runs, "src": pts.tolist(),
}
dst = ROOT / "public/neurovisor"; dst.mkdir(parents=True, exist_ok=True)
(dst / "cell.json").write_text(json.dumps(out, separators=(",", ":")))
print(f"{len(pts)} points in {len(runs)} runs from {n} graph nodes; {(dst / 'cell.json').stat().st_size / 1024:.0f} KB")
