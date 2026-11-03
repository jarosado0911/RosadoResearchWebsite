#!/usr/bin/env python3
"""Copies the calcium simulation behind the CalcSim page's video into this project (data/calcsim/n7_cs.npz), so the
video can be re-rendered without the other project.

The run is study N7 of ~/projects/Neuro-VISOR-calcium-studies: the CalcSim equations as ported to C# for Neuro-VISOR
(CalciumModel.cs, checked there against NEURON rxd), on NeuroMorpho cell NMO_150605 refined 16x (split level 4,
dt 6.25 us, 1 s), with ONE synapse at the start tip of the cell's longest path (the paper's beam pulse, 10 ms from
20 ms, repeated every 200 ms). It uses the Neuro-VISOR app's settings: NCX x 5 and no voltage coupling (no VDCC or
Hodgkin-Huxley terms), so it is not the paper's exact model.

Kept: the snapshots (every 0.5 ms) at the 690 nodes of the original reconstruction (every one of them is also a node of
the refined mesh), as float16 log10 of [uM], plus the probe traces (soma, path 0/10/50/100%).
Usage:  ~/.venvs/calcium/bin/python scripts/export_calcsim_run.py [~/projects/Neuro-VISOR-calcium-studies]
"""
import json
import os
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
STUDIES = Path(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/projects/Neuro-VISOR-calcium-studies"))
sys.path[:0] = [str(STUDIES), str(STUDIES / "studies")]
import n6_cell_traces as n6  # noqa: E402
from castudy import cases, runner  # noqa: E402

CELL = "NMO_150605"
RUN = STUDIES / "output/runs/n7_single_synapse_movie" / CELL / "cs_ref4" / "cs"

g0, g = n6.original(CELL), n6.level(CELL, 4)
k = np.array([g.nearest_node(p) for p in g0.coord])
assert np.abs(g.coord[k] - g0.coord).max() < 2e-3, "original nodes must be nodes of the refined mesh"

r = runner.Result(str(RUN))
info = n6.setup(CELL)
spec = [n6.point_on(g, p) for p in info["probes"]]
nodes = sorted({a for a, b, _ in spec} | {b for a, b, _ in spec})
assert nodes == r.meta["probes"], "probe nodes of the cached run"
tr = n6.Traces(r, spec, nodes, "C#")
tip = g0.coord[n6.longest_path(g0)[0]]

lg = lambda a: np.log10(np.maximum(a, 1e-4)).astype(np.float16)  # noqa: E731
out = ROOT / "data/calcsim"
out.mkdir(parents=True, exist_ok=True)
np.savez_compressed(
    out / "n7_cs.npz",
    coord=g0.coord.astype(np.float32), radius=g0.radius.astype(np.float32), types=g0.types.astype(np.int8),
    edges=np.array(g0.edges(), dtype=np.int32), snap_t=r.snap_t.astype(np.float32),
    log_cc=lg(r.snap_cc[:, k]), log_ce=lg(r.snap_ce[:, k]),
    trace_t=tr.t[::10].astype(np.float32), trace_cc=tr.cc[::10].astype(np.float32),
    trace_ce=tr.ce[::10].astype(np.float32), probes=np.array(info["probes"], dtype=np.float32),
    synapse=tip.astype(np.float32))
(out / "n7_cs.json").write_text(json.dumps(dict(
    source="Neuro-VISOR-calcium-studies study N7, C# CalciumModel, split level 4", cell=CELL,
    probe_names=info["names"], path_length_um=info["path_len"], synapse_total_influx_mol_s=cases.beam_synapse()[0][2],
    pulse=dict(t0_ms=20, duration_ms=10, period_ms=200), solver=r.meta), indent=1))
print(out / "n7_cs.npz", os.path.getsize(out / "n7_cs.npz") // 1024, "kB")
