#!/usr/bin/env python3
"""Drives the SpineBuilder application (its three tabs) and saves the screenshots and .ugx meshes the
spinebuilder.html page uses. Only needed to make them again; the page itself uses the copies in this project.

Run with the application's Python on a private X display, so your own desktop and settings are untouched:

  Xvfb :78 -screen 0 1600x960x24 &
  cd ~/projects/SpineBuilder/spine-builder-application
  ANAMORPH=~/projects/AnaMorph HOME=/tmp/sbhome XDG_CONFIG_HOME=/tmp/sbhome/.config DISPLAY=:78 \
      .venv/bin/python ~/projects/RosadoResearchWebsite/scripts/spinebuilder_screens.py OUT_DIR

OUT_DIR gets ideal_*.png, process_*.png, cell_*.png and ideal.ugx, process_tubes.ugx, cell_membranes.ugx,
cell_spines.ugx (the cell with 10 spines, each with its real spine apparatus joined to the ER) and
cell_spines_web.ugx (the same with the ER reduced to a quarter of its triangles, for the web page).
Nothing is tetrahedralized (TetGen is left out on purpose). --cell-only: only the Cell Builder tab.
"""
import shutil, sys
from pathlib import Path

import numpy as np
from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication, QFileDialog

from spinebuilder_app.gui import MainWindow

APP = Path.cwd()
SPINEBUILDER = APP.parent
OUT = Path(sys.argv[1]).resolve()
OUT.mkdir(parents=True, exist_ok=True)
KASTHURI = SPINEBUILDER / "data/Kasthuri/Kasthuri__0001_Spines.D4_B1_Spine_1_A.obj"

# the ideal spine as a surface .ugx (the app's own .ugx export is tetrahedral, so it is written here)
from dataclasses import replace
from spinebuilder_app.geometry import build_surface
from spinebuilder_app.params import SpineParams
from spinebuilder_app.process_spine import write_surface_ugx
from spinebuilder_app.subsets import ER_MEMBRANE, MEMBRANE, SA_MEMBRANE, SYNAPSE

s = build_surface(replace(SpineParams(), er=True, sa=True, spineRim=16, dendRim=16, erRim=12, saRim=8))
write_surface_ugx(s.vertices, [(name, [s.triangles[s.labels == k]]) for name, k in
                               (("pm", MEMBRANE), ("syn", SYNAPSE), ("erm", ER_MEMBRANE), ("sam", SA_MEMBRANE))
                               if (s.labels == k).any()], OUT / "ideal.ugx")
print("saved ideal", flush=True)
if "--ideal-only" in sys.argv:
    sys.exit(0)

app = QApplication(sys.argv)
win = MainWindow()
win.move(0, 0)
win.resize(1600, 960)
win.show()
ideal, real, cell = win.spine_tab, win.real_tab, win.cell_tab

save_to = {"path": None}   # the file the next "Save .ugx…" dialog answers with
QFileDialog.getSaveFileName = staticmethod(lambda *a, **k: (str(save_to["path"]), ""))


def shot(name):
    app.primaryScreen().grabWindow(0).save(str(OUT / f"{name}.png"))
    print("shot", name, flush=True)


def save(fn, name):
    save_to["path"] = OUT / f"{name}.ugx"
    fn()
    print("saved", name, flush=True)


def base_picks(points):
    """The narrow end of the spine along its long axis (where it met the dendrite)."""
    c = points.mean(0)
    _, _, vt = np.linalg.svd(points - c, full_matrices=False)
    t = (points - c) @ vt[0]
    span = t.max() - t.min()
    ends = []
    for sign in (1, -1):
        s = sign * t
        near = s > s.max() - 0.12 * span
        q = points[near] - c
        spread = np.linalg.norm(q - np.outer(q @ vt[0], vt[0]), axis=1).mean()
        ends.append((spread, sign))
    sign = min(ends)[1]
    s = sign * t
    cap = np.argsort(-s)[:40]          # the 40 vertices nearest the end
    return [points[i][None, :] for i in cap]


def web_copy(src, dst, er_reduction=0.75):
    """src with its er subset reduced (VTK's decimate_pro, keeping the er's boundary, where the SAs join it,
    and its topology), every other subset as it is."""
    import pyvista as pv
    from spinebuilder_app.mesh_io import read_mesh
    m = read_mesh(src)
    pts = np.asarray(m.points, float)
    subsets = []
    for sub in m.subsets:
        faces = [f for f in sub.faces if len(f)]
        if not faces: continue
        tris = np.vstack(faces)
        if sub.name == "er":
            poly = pv.PolyData(pts, np.hstack([np.full((len(tris), 1), 3), tris]).ravel()).clean()
            low = poly.decimate_pro(er_reduction, preserve_topology=True, boundary_vertex_deletion=False)
            low = low.triangulate().clean()
            k = len(pts)
            pts = np.vstack([pts, np.asarray(low.points, float)])
            tris = low.faces.reshape(-1, 4)[:, 1:] + k
            print(f"er: {len(np.vstack(faces))} -> {len(tris)} triangles", flush=True)
        subsets.append((sub.name, [tris]))
    used, inv = np.unique(np.vstack([t for _, (t,) in subsets]), return_inverse=True)   # drop unused vertices
    new = np.full(len(pts), -1); new[used] = np.arange(len(used))
    write_surface_ugx(pts[used], [(name, [new[t]]) for name, (t,) in subsets], dst, first_wins=True)
    print("saved", dst.name, flush=True)


def busy():
    return getattr(cell, "_job_kind", "") != ""


def ideal_steps():
    # ---- Ideal Spine Builder ----
    win.tabs.setCurrentIndex(0)
    ideal.er_box.setChecked(True)
    ideal.sa_box.setChecked(True)
    ideal.syn_box.setChecked(True)
    ideal.show_edges.setChecked(True)
    ideal.pm_opacity.setValue(35)
    yield 2.5
    shot("ideal_er_sa")
    ideal.out_surface.setChecked(False)
    ideal.out_volume.setChecked(False)
    ideal.out_ugx.setChecked(False)


def process_steps():
    # ---- Process Spine ----
    win.tabs.setCurrentIndex(1)
    folder = OUT / "_kasthuri"
    folder.mkdir(exist_ok=True)
    shutil.copy(KASTHURI, folder)
    real.folder.setText(str(folder))
    real.scan_folder()
    yield 2.0
    shot("process_1_loaded")
    real._picks = base_picks(np.asarray(real._mesh.points, float))
    real.draw_base()
    yield 1.0
    shot("process_1_base")
    real.reorient(animate=True)
    yield 3.0
    shot("process_1_reoriented")
    real.steps.setCurrentIndex(1)
    yield 1.0
    real.process()
    yield 4.0
    shot("process_2_processed")
    real.steps.setCurrentIndex(2)
    yield 1.0
    sp = real._processed
    top = sp.points[np.argmax(sp.points[:, 1])]
    real.place_synapse(top)
    yield 1.5
    shot("process_3_synapse")
    real.steps.setCurrentIndex(3)
    yield 3.0
    shot("process_4_sa")
    real.steps.setCurrentIndex(4)
    yield 4.0
    shot("process_5_tubes")
    save(lambda: real.save_ugx(4), "process_tubes")


def cell_steps():
    # ---- Cell Builder (AnaMorph) ----
    win.tabs.setCurrentIndex(2)
    cell.swc_path.setText(str(APP / "samples/0-2a.CNG.swc"))
    cell.load_swc()
    cell.er.setChecked(True)
    cell.ratio.setValue(0.25)
    yield 1.0
    cell.build()
    yield 2.0
    while busy():
        yield 1.0
    yield 2.0
    shot("cell_1_membranes")
    save(cell.save, "cell_membranes")
    cell.steps.setCurrentIndex(1)
    cell.n_spines.setValue(10)
    cell.apparatus.setChecked(True)      # each spine's real SA, joined to the er
    yield 1.0
    cell.scatter()
    yield 2.0
    while busy():
        yield 1.0
    yield 2.0
    shot("cell_2_spines")
    save(cell.save_scattered, "cell_spines")
    web_copy(OUT / "cell_spines.ugx", OUT / "cell_spines_web.ugx")
    cell.goto_spine.setValue(3)
    cell.go_to_spine()
    yield 2.5
    shot("cell_3_spine_closeup")


def steps():
    if "--cell-only" not in sys.argv:
        yield from ideal_steps()
        yield from process_steps()
    yield from cell_steps()
    win.close()


seq = steps()


def tick():
    try:
        wait = next(seq)
    except StopIteration:
        return
    QTimer.singleShot(int(wait * 1000), tick)


QTimer.singleShot(4000, tick)
app.exec()
