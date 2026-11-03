#!/usr/bin/env python3
"""Converts the CA1 1D graph (exported from Neuro-VISOR) into the compact JSON the background renderer loads.

Input  (data/ca1_graph.txt):  "n ne nsoma", then n lines "x y z r" [um], ne lines "u v length", then the soma node ids.
Output (public/neuron/ca1.json):
  somaRadius, maxDist, branches: list of flat [x, y, z, r, d, ...] polylines,
  where d [um] is the path distance from the soma surface (what the action potential front follows).
The cell is centered on the soma and rotated so that its main axis (the apical dendrite) points up (+y).

Usage: python3 scripts/build_neuron.py [spacing_um]
"""
import json, sys
from collections import deque
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SPACING = float(sys.argv[1]) if len(sys.argv) > 1 else 1.2   # [um] target point spacing along branches

lines = (ROOT / "data/ca1_graph.txt").read_text().split("\n")
n, ne, _ = map(int, lines[0].split())
P = np.array([[float(v) for v in lines[1 + i].split()] for i in range(n)])
xyz, rad = P[:, :3], P[:, 3]
adj = [[] for _ in range(n)]
for e in range(ne):
    u, v, l = lines[1 + n + e].split()
    adj[int(u)].append((int(v), float(l)))
    adj[int(v)].append((int(u), float(l)))
soma = [int(s) for s in lines[1 + n + ne].split()]
root = soma[0]
somaR = float(rad[soma].max())

# tree from the soma: parent, children, path distance
parent = np.full(n, -1); dist = np.zeros(n); children = [[] for _ in range(n)]
seen = np.zeros(n, bool); seen[root] = True; q = deque([root])
while q:
    u = q.popleft()
    for v, l in adj[u]:
        if not seen[v]:
            seen[v] = True; parent[v] = u; dist[v] = dist[u] + l; children[u].append(v); q.append(v)

# orientation: center on the soma, main axis (length-weighted PCA of the tree) -> +y, pointing to the longer side
c = xyz[root].copy()
X = xyz - c
w = np.array([dist[i] - dist[parent[i]] if parent[i] >= 0 else 0 for i in range(n)])
cov = (X * w[:, None]).T @ X / w.sum()
evals, evecs = np.linalg.eigh(cov)
axis = evecs[:, -1]
if (X @ axis * w).sum() < 0: axis = -axis
second = evecs[:, -2]
third = np.cross(second, axis)
R = np.stack([second, axis, third])          # rows: new x, y, z
X = X @ R.T

# chains between branch points, decimated
def chain_from(s):
    pts = [parent[s], s]
    while len(children[pts[-1]]) == 1:
        pts.append(children[pts[-1]][0])
    return pts

branches = []
stack = [ch for ch in children[root]]
while stack:
    s = stack.pop()
    ch = chain_from(s)
    stack.extend(children[ch[-1]])
    # drop points deep inside the soma (keep the last inside one so the tube starts within the sphere)
    inside = [np.linalg.norm(X[i]) < somaR * 0.85 for i in ch]
    k = 0
    while k + 1 < len(ch) and inside[k + 1]: k += 1
    ch = ch[k:]
    if len(ch) < 2: continue
    kept = [ch[0]]; acc = 0.0
    for a, b in zip(ch[:-1], ch[1:]):
        acc += np.linalg.norm(X[b] - X[a])
        if b == ch[-1] or acc >= SPACING or abs(rad[b] - rad[kept[-1]]) > 0.25 * rad[kept[-1]]:
            kept.append(b); acc = 0.0
    flat = []
    for j, i in enumerate(kept):
        r = rad[i] if i != root else rad[kept[1]]
        d = max(0.0, dist[i] - somaR)
        flat += [round(float(X[i, 0]), 2), round(float(X[i, 1]), 2), round(float(X[i, 2]), 2), round(float(r), 3), round(d, 1)]
    branches.append(flat)

out = {
    "name": "CA1 pyramidal neuron (A-Slide-3-section-2-neuron-1), via Neuro-VISOR",
    "somaRadius": round(somaR, 3),
    "maxDist": round(float(dist.max() - somaR), 1),
    "bounds": [[round(float(v), 1) for v in X.min(0)], [round(float(v), 1) for v in X.max(0)]],
    "branches": branches,
}
dst = ROOT / "public/neuron/ca1.json"
dst.write_text(json.dumps(out, separators=(",", ":")))
npts = sum(len(b) // 5 for b in branches)
print(f"{len(branches)} branches, {npts} points, soma r {somaR:.2f} um, max path {out['maxDist']} um, "
      f"bounds {out['bounds']}, radii {rad.min():.3f}-{np.percentile(rad, 99):.2f} um, {dst.stat().st_size / 1024:.0f} KB")
