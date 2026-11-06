#!/usr/bin/env python3
"""public/tetraneuron/cell.json for the TetraNeuron teaser: the raw reconstruction and its regularized centerlines.

Only centerlines go on the site. For each regularized point: where it starts on the raw neuron (the nearest point of the
raw polyline, for the morph) and how far it is from the soma along the dendrites (for the growth)."""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/neuronmesh/0-2a.CNG.swc"
REGULARIZED = ROOT / "data/tetraneuron/0-2a_regularized.swc"
OUT = ROOT / "public/tetraneuron/cell.json"


def read_swc(path):
    rows = np.array([line.split() for line in path.read_text().splitlines() if line.strip() and not line.startswith("#")], float)
    ids = {int(i): k for k, i in enumerate(rows[:, 0])}
    parent = np.array([ids.get(int(p), -1) for p in rows[:, 6]])
    return rows, parent


def nearest_on_polyline(points, a, b):
    d = b - a
    t = points @ d.T - np.einsum("ij,ij->i", a, d)
    t = np.clip(t / np.maximum(np.einsum("ij,ij->i", d, d), 1e-12), 0, 1)
    near = a[None] + t[..., None] * d[None]
    best = np.argmin(np.sum((near - points[:, None]) ** 2, axis=2), axis=1)
    return near[np.arange(len(points)), best]


def main():
    raw, raw_parent = read_swc(RAW)
    reg, reg_parent = read_swc(REGULARIZED)
    has_parent = raw_parent >= 0
    start = nearest_on_polyline(reg[:, 2:5], raw[raw_parent[has_parent], 2:5], raw[has_parent, 2:5])

    along = np.zeros(len(reg))
    for i in range(len(reg)):      # parents come first in the file
        p = reg_parent[i]
        if p >= 0:
            assert p < i
            along[i] = along[p] + np.linalg.norm(reg[i, 2:5] - reg[p, 2:5])

    doc = {
        "raw": {"rows": [[int(r[0]), int(r[1]), *map(float, r[2:6]), int(r[6])] for r in raw], "parent": raw_parent.tolist()},
        "regularized": {
            "position": np.round(reg[:, 2:5], 3).ravel().tolist(),
            "radius": np.round(reg[:, 5], 3).tolist(),
            "parent": reg_parent.tolist(),
            "start": np.round(start, 3).ravel().tolist(),
            "along": np.round(along, 2).tolist(),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size // 1024} kB, {len(raw)} raw points, {len(reg)} regularized, "
          f"soma radius {reg[0, 5]:.2f}, farthest along the dendrites {along.max():.0f}")


if __name__ == "__main__":
    main()
