#!/usr/bin/env python3
"""The CalcSim page's 3D background: the cell and its calcium wave, from data/calcsim/n7_cs.npz
(scripts/export_calcsim_run.py).

Output: public/calcsim/cell.json (the graph centered at the soma [um]: xyz, radius, type per node, the unbranched
        runs as node lists, synapse and probe positions, frame times) and public/calcsim/wave.bin (uint8, frame-major:
        for every frame first c_cyt then c_ER at every node, on the video's log scales, 0.05-40 uM and 10-300 uM).
Frames every 1 ms over the run's 1 s.
Usage:  python3 scripts/build_calcsim_cell.py
"""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public/calcsim"
CC, CE = (0.05, 40.0), (10.0, 300.0)  # [uM] the log color ranges

d = np.load(ROOT / "data/calcsim/n7_cs.npz")
X, r, types, e = d["coord"].astype(float), d["radius"].astype(float), d["types"], d["edges"]
soma = X[types == 1].mean(axis=0)
X -= soma
n = len(X)
nb = [[] for _ in range(n)]
for i, j in e:
    nb[i].append(int(j))
    nb[j].append(int(i))

# unbranched runs: from every node that is not a plain pass-through (degree != 2) along each of its edges
key = lambda k: len(nb[k]) != 2  # noqa: E731
runs, seen = [], set()
for a in range(n):
    if not key(a):
        continue
    for b in nb[a]:
        if (a, b) in seen:
            continue
        run = [a, b]
        while not key(run[-1]):
            nxt = [k for k in nb[run[-1]] if k != run[-2]][0]
            run.append(nxt)
        for p, q in zip(run[:-1], run[1:]):
            seen.add((p, q))
            seen.add((q, p))
        runs.append(run)

# every 1 ms; log10 [uM] mapped to 0..255
step = int(round(1e-3 / float(d["snap_t"][1] - d["snap_t"][0])))
fr = np.arange(0, len(d["snap_t"]), step)
q = lambda lg, lo, hi: np.clip(np.round((lg - np.log10(lo)) / (np.log10(hi) - np.log10(lo)) * 255), 0, 255).astype(np.uint8)  # noqa: E731
cc = q(d["log_cc"][fr].astype(float), *CC)
ce = q(d["log_ce"][fr].astype(float), *CE)
OUT.mkdir(parents=True, exist_ok=True)
np.stack([cc, ce], axis=1).tofile(OUT / "wave.bin")  # (frame, 2, node)
r3 = lambda a: [round(float(v), 3) for v in a]  # noqa: E731
json.dump(dict(
    n=n, frames=len(fr), dt_ms=step * float(d["snap_t"][1] - d["snap_t"][0]) * 1e3, cc_range=CC, ce_range=CE,
    xyz=r3(X.ravel()), radius=r3(r), soma=[int(k) for k in np.flatnonzero(types == 1)], runs=runs,
    synapse=r3(d["synapse"] - soma), probes=[r3(p - soma) for p in d["probes"]],
    pulse=dict(t0_ms=20, duration_ms=10, period_ms=200),
), open(OUT / "cell.json", "w"), separators=(",", ":"))
print(len(runs), "runs,", len(fr), "frames;", {p.name: p.stat().st_size // 1024 for p in OUT.iterdir()}, "kB")
