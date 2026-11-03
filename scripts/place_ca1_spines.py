#!/usr/bin/env python3
"""Welds real spines onto the CA1 cell's NeuronMesh surface with SpineBuilder's own scatter (the Cell Builder
tab's Spines subtab: area-weighted sites off the soma, the membrane refined around each site, a hole cut along
the neck and a collar zipped in). Only needed to make data/ca1/ca1_spines.ugx.gz again.

Run with the SpineBuilder application's Python, from its folder:
  cd ~/projects/SpineBuilder/spine-builder-application
  .venv/bin/python ~/projects/RosadoResearchWebsite/scripts/place_ca1_spines.py [-n 400] [-seed 1]
Input:  data/ca1/ca1.swc (the soma, to keep spines off it), data/ca1/ca1_neuronmesh.ugx.gz (the cell's surface)
        The scatter needs a closed surface. NeuronMesh (--sphere-weld) leaves one of this cell's five soma branches
        unwelded, its tube end open inside the soma sphere; that loop is closed here by a fan from its centroid
        before scattering (see close_loops), which changes nothing visible.
Output: data/ca1/ca1_spines_web.ugx.gz: the cell with its spines welded in, reduced for the web (VTK quadric
        decimation to --target triangles; the full-resolution result, ~2M triangles for 400 spines, is not kept),
        and data/ca1/ca1_spines.log (which spine went where)
"""
import argparse, gzip, re, shutil, sys, time
from pathlib import Path
import numpy as np

from spinebuilder_app.cell_membranes import CellgenRun, CellMembranes, Membrane, check_closed_surface
from spinebuilder_app.scatter_spines import SAMPLE_SPINES, ScatterOptions, list_spines, scatter_spines

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("-n", type=int, default=400)
ap.add_argument("-seed", type=int, default=1)
ap.add_argument("--no-check", action="store_true", help="skip the final crossing-triangle check")
ap.add_argument("--target", type=int, default=200000, help="triangles of the web copy")
args = ap.parse_args()

s = gzip.open(ROOT / "data/ca1/ca1_neuronmesh.ugx.gz", "rt").read()
V = np.array(re.search(r'<vertices coords="3">([^<]*)</vertices>', s).group(1).split(), float).reshape(-1, 3)
T = np.array(re.search(r"<triangles>([^<]*)</triangles>", s).group(1).split(), int).reshape(-1, 3)
def close_loops(V, T):
    """Every open boundary loop closed by a fan from its centroid (oriented like the triangles at it)."""
    e = np.vstack([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    key = np.sort(e, axis=1)
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    open_dir = {tuple(d) for d, c in zip(e, cnt[inv.ravel()]) if c == 1}   # directed as in their triangle
    nxt = {a: b for a, b in open_dir}
    V, new, done = list(V), [], set()
    for start in list(nxt):
        if start in done: continue
        loop, v = [], start
        while v not in done:
            done.add(v); loop.append(v); v = nxt[v]
        c = len(V); V.append(np.mean([V[i] for i in loop], axis=0))
        new += [(loop[(k + 1) % len(loop)], loop[k], c) for k in range(len(loop))]   # reversed: matches the hole
        print(f"closed an open loop of {len(loop)} edges at {np.round(V[c], 1).tolist()}", flush=True)
    return np.array(V), np.vstack([T, np.array(new, int)]) if new else T


V, T = close_loops(V, T)
report, T = check_closed_surface(V, T)          # also turns the surface outward
print(f"cell: {len(T)} triangles; {report}", flush=True)
cell = CellMembranes(ROOT / "data/ca1/ca1.swc", None, V, T, np.zeros(len(T), np.int64),
                     [Membrane("pm", CellgenRun(V, T, "NeuronMesh", None, False), report)])

spines = list_spines(SAMPLE_SPINES)
print(f"{len(spines)} spines in {SAMPLE_SPINES}", flush=True)
t0 = time.time()
r = scatter_spines(cell, spines, ScatterOptions(n=args.n, seed=args.seed, check_crossings=not args.no_check),
                   progress=lambda m: print(" ", m, flush=True))
print(f"placed {len(r.placements)} of {args.n} spines in {time.time() - t0:.0f} s ({r.tries} tries, {r.splits} edge splits); "
      f"{len(r.triangles)} triangles; crossings: {None if r.crossings is None else len(r.crossings)}", flush=True)
for w in r.warnings: print("  warning:", w)
import pyvista as pv
from spinebuilder_app.process_spine import write_surface_ugx
poly = pv.PolyData(r.points, np.hstack([np.full((len(r.triangles), 1), 3), r.triangles]).ravel())
low = poly.decimate(1 - args.target / len(r.triangles), volume_preservation=True).triangulate().clean()
lt = low.faces.reshape(-1, 4)[:, 1:]
print(f"web copy: {len(r.triangles)} -> {len(lt)} triangles", flush=True)
out = ROOT / "data/ca1/ca1_spines_web.ugx"
write_surface_ugx(np.asarray(low.points, float), [("pm", [lt])], out)
with open(out, "rb") as f, gzip.open(str(out) + ".gz", "wb", 9) as g:
    shutil.copyfileobj(f, g)
out.unlink()
names = [Path(p.file).name for p in r.placements]
(ROOT / "data/ca1/ca1_spines.log").write_text(
    f"scatter_spines n={args.n} seed={args.seed}: {len(r.placements)} placed, {len(r.triangles)} triangles\n"
    + "\n".join(f"syn{k + 1} {n} site {np.round(p.site, 2).tolist()}" for k, (n, p) in enumerate(zip(names, r.placements))) + "\n")
print("wrote", str(out) + ".gz")
