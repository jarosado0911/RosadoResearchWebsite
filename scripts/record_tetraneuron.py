#!/usr/bin/env python3
"""Frames of the TetraNeuron desktop app growing a neuron: only the 3D view of its Grow tab.

Moves the app's own Growth slider one frame at a time and waits for the app to finish each step, then grabs the 3D view. The
app's code is unchanged; this script hides its side panel and legend while it runs, so the view has a constant size.
The camera does what Fit soma, then Fit neuron and a slow drag would do. Opens a window on the desktop while it runs.

    cd ~/projects/TetraNeuron/app && uv run python ~/projects/new-website/scripts/record_tetraneuron.py <frames folder> [fps]
"""
import math
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("QT_API", "pyside6")

import numpy as np
from PySide6.QtCore import QSettings
from PySide6.QtTest import QTest
from PySide6.QtWidgets import QApplication, QSplitter
from tetraneuron_app import gui

SWC = Path.home() / "projects/TetraNeuron/data/0-2a.CNG.swc"
VIEW_SIZE = (1440, 810)
SOMA_END = 300                   # the slider value where the soma is whole (the app's first 30%)
SECONDS = {"start": 1.0, "soma": 12.0, "whole soma": 0.8, "dendrites": 13.0, "end": 4.0}
TURN_DEGREES = 55                # over the whole recording


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def main():
    out = Path(sys.argv[1])
    fps = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    out.mkdir(parents=True, exist_ok=True)
    gui.configure_wsl_graphics()
    QSettings.setDefaultFormat(QSettings.IniFormat)
    QSettings.setPath(QSettings.IniFormat, QSettings.UserScope, tempfile.mkdtemp())   # the user's own settings stay as they are
    app = QApplication([])
    win = gui.MainWindow()
    tab = win.soma_tab
    tab.findChild(QSplitter).widget(0).hide()
    tab.legend_label.hide()
    tab.plotter.setFixedSize(*VIEW_SIZE)
    win.show()
    QTest.qWait(400)
    win.tabs.setCurrentWidget(tab)
    win.regularize_tab.load(SWC)

    def settle():
        waited = 0
        while not tab.is_settled():
            QTest.qWait(5)
            waited += 5
            if waited > 120000:
                raise TimeoutError("the app did not finish a step")

    settle()
    camera = tab.plotter.camera
    tab.growth_slider.setValue(1000)
    settle()
    tab.fit_neuron()
    far = np.array(camera.position) - np.array(camera.focal_point), np.array(camera.focal_point)
    tab.growth_slider.setValue(0)
    settle()
    tab.fit_soma()
    near = np.array(camera.position) - np.array(camera.focal_point), np.array(camera.focal_point)
    up = np.array(camera.up)
    direction = near[0] / np.linalg.norm(near[0])
    near_d, far_d = np.linalg.norm(near[0]), np.linalg.norm(far[0])

    total = sum(SECONDS.values())
    frames = int(total * fps)
    a = SECONDS["start"]
    b = a + SECONDS["soma"]
    c = b + SECONDS["whole soma"]
    d = c + SECONDS["dendrites"]
    last_value = None
    for f in range(frames):
        t = f / fps
        if t < a:
            value = 0
        elif t < b:
            value = round(ease((t - a) / (b - a)) * SOMA_END)
        elif t < c:
            value = SOMA_END
        elif t < d:
            value = round(SOMA_END + (1000 - SOMA_END) * ease((t - c) / (d - c)))
        else:
            value = 1000
        if value != last_value:
            tab.growth_slider.setValue(value)
            settle()
            last_value = value

        # out from the soma while the dendrites grow, and slowly around the cell the whole time
        pull = ease((t - c) / (d - c) * 1.1)
        distance = math.exp(math.log(near_d) + (math.log(far_d) - math.log(near_d)) * pull)
        focus = near[1] + (far[1] - near[1]) * pull
        angle = math.radians(TURN_DEGREES) * (t / total)
        k = up / np.linalg.norm(up)
        turned = direction * math.cos(angle) + np.cross(k, direction) * math.sin(angle) + k * np.dot(k, direction) * (1 - math.cos(angle))
        camera.focal_point = tuple(focus)
        camera.position = tuple(focus + turned * distance)
        camera.up = tuple(up)
        tab.plotter.renderer.ResetCameraClippingRange()
        tab.plotter.render()
        QApplication.processEvents()
        tab.plotter.grab().save(str(out / f"f{f:05d}.png"))
        if f % 60 == 0:
            print(f"frame {f}/{frames}, slider {value}, growth {tab.growth():.2f} um", flush=True)
    win.close()
    print(f"wrote {frames} frames to {out}", flush=True)


if __name__ == "__main__":
    main()
