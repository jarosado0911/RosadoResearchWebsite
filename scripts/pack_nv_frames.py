#!/usr/bin/env python3
"""Packs the two Neuro-VISOR simulations for the pages' backgrounds, on the points of public/neurovisor/cell.json.

  electrical: hh_harness runs (v.f32, float32 [frame][node] volts) -> public/neurovisor/hh.bin + hh.json
              uint8 [run][frame][point], -80..+50 mV linear; frames to FRAME_END_MS
  calcium:    ca_harness run (ca.f32: per frame [n] cytosol, [n] ER [mM], then the soma lattice's means)
              -> public/neurovisor/ca.bin + ca.json: uint8 [frame][cytosol points, ER points],
              cytosol on a log scale CYT_UM, ER linear 0..its resting level; the soma (point 0) shows the lattice mean

Usage: python3 scripts/pack_nv_frames.py <hh dir with run1 run2 run3> <ca run dir>
"""
import json, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public/neurovisor"
hh_dir, ca_dir = Path(sys.argv[1]), Path(sys.argv[2])
cell = json.loads((OUT / "cell.json").read_text())
src = np.array(cell["src"]); npt = cell["n"]

def meta(d):
    return {k: v for k, v in (l.split(" ", 1) for l in (d / "meta.txt").read_text().split("\n") if l)}

def point_of(node):
    """the cell point that shows a simulation node (the point on it, or the nearest one)"""
    hit = np.where(src == node)[0]
    if len(hit): return int(hit[0])
    g = (ROOT / "data/ca1_graph.txt").read_text().split("\n")
    p = np.array(g[1 + node].split()[:3], float)
    q = np.array([[float(v) for v in g[1 + s].split()[:3]] for s in src])
    return int(np.argmin(((q - p) ** 2).sum(1)))

# ---- electrical ----
VMIN, VMAX, FRAME_END_MS = -80.0, 50.0, 12.0
RUNS = [("run1", "Touch at the tip of the apical tuft"),
        ("run2", "Touch at a basal dendrite tip: the spike dies out before the soma"),
        ("run3", "3 nA injected into the soma: it charges up and fires")]
blobs, runs = [], []
for name, label in RUNS:
    m = meta(hh_dir / name); n = int(m["nodes"]); fdt = float(m["frame_dt_s"]) * 1e3
    V = np.fromfile(hh_dir / name / "v.f32", np.float32).reshape(-1, n)[: int(round(FRAME_END_MS / fdt)) + 1][:, src] * 1e3
    blobs.append(np.clip(np.round((V - VMIN) / (VMAX - VMIN) * 255), 0, 255).astype(np.uint8))
    runs.append({"label": label, "stimPoint": point_of(int(m["stim"])), "frames": len(V),
                 "clampMs": [float(m["clamp_start_s"]) * 1e3, (float(m["clamp_start_s"]) + float(m["clamp_len_s"])) * 1e3]})
(OUT / "hh.bin").write_bytes(np.concatenate(blobs).tobytes())
(OUT / "hh.json").write_text(json.dumps({"frameMs": fdt, "vmin": VMIN, "vmax": VMAX, "runs": runs}, indent=1))
print("hh:", [r["frames"] for r in runs], "frames,", (OUT / "hh.bin").stat().st_size // 1024, "KB")

# ---- calcium ----
CYT_UM = (0.05, 100.0)
m = meta(ca_dir); n = int(m["nodes"]); F = int(m["frames"])
raw = np.fromfile(ca_dir / "ca.f32", np.float32).reshape(F, 2 * n + 2)
cc, ce = raw[:, :n][:, src] * 1e3, raw[:, n:2 * n][:, src] * 1e3        # [uM]
cc[:, 0], ce[:, 0] = raw[:, 2 * n] * 1e3, raw[:, 2 * n + 1] * 1e3          # the soma: the lattice mean
erRest = float(np.median(ce[0]))
u_cc = np.log10(np.clip(cc, *CYT_UM) / CYT_UM[0]) / np.log10(CYT_UM[1] / CYT_UM[0])
u_ce = np.clip(ce / erRest, 0, 1)
blob = np.stack([u_cc, u_ce], 1)                                           # [frame][2][point]
(OUT / "ca.bin").write_bytes(np.round(blob * 255).astype(np.uint8).tobytes())
(OUT / "ca.json").write_text(json.dumps({
    "frames": F, "frameMs": float(m["frame_dt_s"]) * 1e3, "stimPoint": point_of(int(m["stim"])),
    "holdMs": [float(m["hold_start_s"]) * 1e3, (float(m["hold_start_s"]) + float(m["hold_s"])) * 1e3],
    "cytUM": CYT_UM, "erRestUM": round(erRest, 1)}, indent=1))
print(f"ca: {F} frames, cytosol {cc.min():.3f}..{cc.max():.1f} uM, ER {ce.min():.1f}..{ce.max():.1f} uM (rest {erRest:.0f}),",
      (OUT / "ca.bin").stat().st_size // 1024, "KB")
