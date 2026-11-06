#!/usr/bin/env python3
"""public/nemotms/ for the NeMo-TMS page, from data/nemotms/ (scripts/make_nemotms_run.sh). Numpy only.

run.json + replay.bin: the sample cell, its voltage and calcium per node every 50 us (uint8; voltage linear, calcium log).
The saved voltage ends at 2.975 ms; after that each node relaxes to its rest (an approximation, also used by the run). morph_*.json: three morphologies thinned for the browser. waveforms.json: the two pulse shapes."""
import gzip
import json
import shutil
import sys
import tarfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA, OUT = ROOT / "data/nemotms", ROOT / "public/nemotms"
FRAME_S = 25e-6      # the sample's frames are taken to be one 25 us step apart (see the page's note)
OUT_EVERY = 2        # frames kept per stored frame: 50 us
TOTAL_MS = 12.0
TAIL_TAU_MS = 5.0
CA_TOP_UM = 0.3      # the color scale's top; the soma goes above it
V_RANGE = (-90.0, 50.0)
MORPHS = {"ca1": ("cell_1.swc", 2600), "l23": ("Aberra_human_L23.swc", 3200), "l5": ("Aberra_human_L5.swc", 3600)}


def read_swc(path):
    rows = np.array([l.split() for l in Path(path).read_text().splitlines() if l.strip() and not l.startswith("#")], float)
    index = {int(i): k for k, i in enumerate(rows[:, 0])}
    return rows, np.array([index.get(int(p), -1) for p in rows[:, 6]])


def nearest(points, query):
    return np.array([np.argmin(((points - q) ** 2).sum(1)) for q in query])


def voltage():
    """x, y, z and the voltage of every frame: the saved frames, then a relaxation of each node to its own rest"""
    with tarfile.open(DATA / "voltage_frames.tar.gz") as tar:
        members = sorted((m for m in tar.getmembers() if m.name.endswith(".dat")), key=lambda m: m.name)
        saved = np.array([np.loadtxt(tar.extractfile(m)) for m in members])
    V, rest = saved[:, :, 3], saved[:8, :, 3].mean(0)
    n = int(round(TOTAL_MS * 1e-3 / FRAME_S)) + 2
    tail = np.arange(1, n - len(V) + 1)[:, None] * FRAME_S * 1e3 / TAIL_TAU_MS
    return saved[0, :, :3], np.vstack([V, rest + (V[-1] - rest) * np.exp(-tail)]), len(V)


def write_frames(folder):
    X, V, _ = voltage()
    folder = Path(folder)
    for old in folder.glob("vm_*.dat"):
        old.unlink()
    for f, v in enumerate(V):
        np.savetxt(folder / f"vm_{f:07d}.dat", np.column_stack([X, v]), fmt="%.4f %.4f %.4f %.2f")


def run():
    X, volt, saved_frames = voltage()
    with gzip.open(DATA / "fullCalciumData.txt.gz", "rt") as f:
        calcium = np.loadtxt(f) * 1e6       # uM
    times = np.loadtxt(DATA / "timeSteps.txt")
    nodes = np.loadtxt(DATA / "outDom.txt")[:, 1:]    # the order of the calcium columns
    swc, parent = read_swc(DATA / "outDom.swc")       # a different order: match by position
    from_swc = nearest(swc[:, 2:5], nodes)
    assert np.abs(swc[from_swc, 2:5] - nodes).max() < 1e-3
    to_node = np.empty(len(swc), int)
    to_node[from_swc] = np.arange(len(nodes))
    types = swc[from_swc, 1].astype(int)
    radius = swc[from_swc, 5]
    parents = np.array([to_node[parent[i]] if parent[i] >= 0 else -1 for i in from_swc])
    soma = int(np.argmax(types == 1)) if parents[0] >= 0 else 0
    soma = int(np.flatnonzero(parents < 0)[0])

    frames = int(round(times[-1] / FRAME_S)) + 1
    grid = np.arange(frames) * FRAME_S
    V = volt[:frames][:, nearest(X, nodes)]
    # adaptive steps: interpolate onto the voltage frames
    Ca = np.array([np.interp(grid, times, calcium[:, i]) for i in range(calcium.shape[1])]).T

    ca_low = float(Ca.min())
    v8 = np.clip((V - V_RANGE[0]) / (V_RANGE[1] - V_RANGE[0]), 0, 1)
    ca8 = np.clip((np.log(Ca) - np.log(ca_low)) / (np.log(CA_TOP_UM) - np.log(ca_low)), 0, 1)
    kept = slice(None, None, OUT_EVERY)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "replay.bin").write_bytes(np.round(v8[kept] * 255).astype(np.uint8).tobytes() + np.round(ca8[kept] * 255).astype(np.uint8).tobytes())

    children = np.bincount(parents[parents >= 0], minlength=len(nodes))
    above_zero = V[:saved_frames] > 0
    first_frame = int(np.flatnonzero(above_zero.any(1))[0])
    first_node = int(above_zero[first_frame].argmax())
    dist = np.linalg.norm(nodes - nodes[soma], axis=1)
    soma_cross = int(np.argmax(V[:, soma] > 0))
    stats = {
        "axonCaMedianPeakUm": float(np.median(Ca[:, types == 2].max(0))), "axonCaHalfRiseMs": float(grid[int(np.argmax(np.median(Ca[:, types == 2], axis=1) >= ca_low + (np.median(Ca[:, types == 2], axis=1).max() - ca_low) / 2))] * 1e3),
        "somaHalfRiseMs": float(grid[int(np.argmax(Ca[:, soma] >= ca_low + (Ca[:, soma].max() - ca_low) / 2))] * 1e3),
        "axonRisenFraction": float((Ca[:, types == 2].max(0) > 2 * ca_low).mean()),
        "dendriteVPeakByDistance": {f"{a}-{b}": float(np.median(V[:saved_frames][:, np.isin(types, (3, 4)) & (dist >= a) & (dist < b)].max(0))) for a, b in ((0, 60), (60, 150), (150, 400))},
        "dendriteCaPeakByDistance": {f"{a}-{b}": float(np.median(Ca[:, np.isin(types, (3, 4)) & (dist >= a) & (dist < b)].max(0))) for a, b in ((0, 60), (60, 150), (150, 400))},
        "at5msUm": {"soma": float(Ca[int(round(5e-3 / FRAME_S)), soma]), "axonMedian": float(np.median(Ca[int(round(5e-3 / FRAME_S)), types == 2]))},
        "at12msUm": {"soma": float(Ca[-1, soma]), "axonMedian": float(np.median(Ca[-1, types == 2]))},
        "firstSpikeMs": first_frame * FRAME_S * 1e3, "firstSpikeType": int(types[first_node]), "firstSpikeTip": bool(children[first_node] == 0),
        "firstSpikeDistUm": float(dist[first_node]), "somaSpikeMs": soma_cross * FRAME_S * 1e3, "somaPeakMv": float(V[:, soma].max()),
        "somaCaPeakUm": float(Ca[:, soma].max()), "somaCaPeakMs": float(grid[Ca[:, soma].argmax()] * 1e3), "somaCaEndUm": float(Ca[-1, soma]),
        "caRestUm": ca_low, "caMaxUm": float(Ca.max()),
        "byType": {str(t): {"nodes": int((types == t).sum()), "vPeakMv": float(V[:, types == t].max()), "caPeakUm": float(Ca[:, types == t].max()),
                            "caMedianPeakUm": float(np.median(Ca[:, types == t].max(0))), "caOver0p06": int((Ca[:, types == t].max(0) > 0.06).sum())}
                   for t in np.unique(types)},
    }
    doc = {
        "frames": int(v8[kept].shape[0]), "frameMs": FRAME_S * OUT_EVERY * 1e3, "vEndMs": (saved_frames - 1) * FRAME_S * 1e3, "vRange": V_RANGE, "caRange": [ca_low, CA_TOP_UM], "soma": soma,
        "position": np.round(nodes, 2).ravel().tolist(), "parent": parents.tolist(), "type": types.tolist(), "radius": np.round(radius, 3).tolist(),
        "somaV": np.round(V[kept, soma], 2).tolist(), "somaCa": np.round(Ca[kept, soma], 4).tolist(),
        "axonCa": np.round(np.median(Ca[kept][:, types == 2], axis=1), 4).tolist(), "stats": stats,
    }
    (OUT / "run.json").write_text(json.dumps(doc, separators=(",", ":")))
    print(json.dumps(stats, indent=1))


def thin(rows, parent, target):
    """Keeps the soma, branch points, tips and every k-th point between them"""
    children = np.bincount(parent[parent >= 0], minlength=len(rows))
    fixed = (parent < 0) | (children != 1)
    free = int((~fixed).sum())
    k = max(1, int(np.ceil(free / max(target - int(fixed.sum()), 1))))
    keep, count = np.zeros(len(rows), bool), 0
    for i in range(len(rows)):
        count += 1
        if fixed[i] or count % k == 0:
            keep[i] = True
    new = -np.ones(len(rows), int)
    new[keep] = np.arange(keep.sum())
    out = []
    for i in np.flatnonzero(keep):
        p = parent[i]
        while p >= 0 and not keep[p]:
            p = parent[p]
        out.append(int(new[p]) if p >= 0 else -1)
    return keep, out


def morphologies():
    for key, (name, target) in MORPHS.items():
        rows, parent = read_swc(DATA / "morphos" / name)
        keep, parents = thin(rows, parent, target)
        kept = rows[keep]
        soma = kept[kept[:, 1] == 1, 2:5].mean(0)
        axon = (kept[:, 1] == 2) | (kept[:, 1] >= 5)    # Aberra's files split the axon into hillock, myelin, nodes
        doc = {"position": np.round(kept[:, 2:5] - soma, 1).ravel().tolist(), "parent": parents, "axon": axon.astype(int).tolist()}
        (OUT / f"morph_{key}.json").write_text(json.dumps(doc, separators=(",", ":")))
        print(key, len(rows), "->", len(kept), "extent", np.round(np.ptp(kept[:, 2:5], axis=0)).tolist(), "axon nodes", int(axon.sum()))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--frames":
        write_frames(sys.argv[2])
        sys.exit()
    run()
    morphologies()
    shutil.copy(DATA / "waveforms.json", OUT / "waveforms.json")
