#!/usr/bin/env python3
"""The CalcSim page's video, from data/calcsim/n7_cs.npz (scripts/export_calcsim_run.py): one synapse at the tip of
NMO_150605 starts a calcium wave that crosses the cell. Left the cytosol, right the ER, each over its traces at four
points (soma, synapse tip, middle, far tip). Log color scales with jet (the page draws the color bars), the page's
dark background, linear trace axes. 0.5 ms per frame up to 300 ms, then 2 ms per frame.
Output: public/video/calcsim-wave.{mp4,webm} and calcsim-wave-poster.jpg (1600 x 900, 40 fps).
Usage:  ~/.venvs/calcium/bin/python scripts/make_calcsim_video.py
"""
import subprocess
from pathlib import Path

import imageio_ffmpeg
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.collections import LineCollection  # noqa: E402
from matplotlib.colors import LogNorm  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public/video"
BG, FG, MUTED, GRID = "#0a1120", "#e9eef7", "#9aa6bc", "#1c2638"
NORM = dict(cc=LogNorm(0.05, 40.0), ce=LogNorm(10.0, 300.0))  # [uM]
# the probes drawn on the cells and as traces: (index in the file, label, color)
PROBES = [(1, "synapse tip", "#d95926"), (3, "middle", "#3987e5"), (0, "soma", "#199e70"), (4, "far tip", "#9085e9")]
W, H, FPS = 1600, 900, 40
SLOW_UNTIL = 300.0  # [ms] 0.5 ms per frame up to here, 2 ms per frame after

d = np.load(ROOT / "data/calcsim/n7_cs.npz")
st = d["snap_t"] * 1e3
frames = [i for i, t in enumerate(st) if t <= SLOW_UNTIL or round(t * 2) % 4 == 0]
vals = dict(cc=10 ** d["log_cc"].astype(float), ce=10 ** d["log_ce"].astype(float))
tt, traces = d["trace_t"], dict(cc=d["trace_cc"], ce=d["trace_ce"])

# the cell in the plane of its two largest principal axes, long axis horizontal
X = d["coord"].astype(float)
mean = X.mean(axis=0)
_, _, vt = np.linalg.svd(X - mean, full_matrices=False)
P = lambda p: (np.asarray(p, float) - mean) @ vt[:2].T  # noqa: E731
xy = P(X)
e = d["edges"]
segs = np.stack([xy[e[:, 0]], xy[e[:, 1]]], axis=1)
r = d["radius"].astype(float)
soma = (d["types"][e[:, 0]] == 1) & (d["types"][e[:, 1]] == 1)
widths = np.where(soma, 9.0, 1.8 + 2.2 * np.minimum(0.5 * (r[e[:, 0]] + r[e[:, 1]]), 1.5))
order = np.argsort(soma)  # the soma on top

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 15, "text.color": FG, "axes.labelcolor": MUTED,
                     "xtick.color": MUTED, "ytick.color": MUTED, "axes.edgecolor": GRID})
fig = plt.figure(figsize=(W / 100, H / 100), dpi=100, facecolor=BG)
lines, cursors, curves = {}, [], []
tlabel = fig.text(0.5, 0.955, "", ha="center", va="center", fontsize=24, color=FG,
                                          family="DejaVu Sans Mono")
speed = fig.text(0.5, 0.915, "", ha="center", va="center", fontsize=14, color=MUTED)
for col, (f, name) in enumerate((("cc", "Cytosol"), ("ce", "ER lumen"))):
    x0 = 0.03 + col * 0.5
    ax = fig.add_axes([x0, 0.33, 0.44, 0.56], facecolor=BG)
    ax.set_aspect("equal")
    ax.axis("off")
    lc = LineCollection(segs[order], linewidths=widths[order], cmap="jet", norm=NORM[f], capstyle="round")
    lc.set_array(np.zeros(len(e)))
    ax.add_collection(lc)
    pad = 4.0
    ax.set_xlim(xy[:, 0].min() - pad, xy[:, 0].max() + pad)
    ax.set_ylim(xy[:, 1].min() - pad, xy[:, 1].max() + pad)
    for k, _, c in PROBES:
        p = P(d["probes"][k])
        ax.plot(*p, "o", ms=11, mfc="none", mec=c, mew=2.4, zorder=5)
    s = P(d["synapse"])
    ax.plot(*s, marker="*", ms=22, color="white", mec=BG, mew=1.0, zorder=6)
    ax.annotate("synapse", s, xytext=(0, 18), textcoords="offset points", ha="center", color=FG, fontsize=13)
    ax.text(0.0, 0.98, name, transform=ax.transAxes, fontsize=21, color=FG, weight="bold")
    lines[f] = lc
    # traces
    tx = fig.add_axes([x0 + 0.045, 0.08, 0.38, 0.2], facecolor=BG)
    for t0 in np.arange(20.0, 1000.0, 200.0):
        tx.axvspan(t0, t0 + 10.0, color="white", alpha=0.10, lw=0)
    for k, lab, c in PROBES:
        curves.append((tx.plot(tt, traces[f][:, k], color=c, lw=2.0, label=lab)[0], traces[f][:, k]))
    tx.set_xlim(0, 1000)
    tx.set_ylim(0, 40 if f == "cc" else 270)
    tx.set_ylabel("Ca²⁺ [µM]")
    tx.set_xlabel("time [ms]")
    tx.grid(color=GRID, lw=0.8)
    for sp in ("top", "right"):
        tx.spines[sp].set_visible(False)
    if col == 0:
        tx.legend(loc="upper right", frameon=False, fontsize=12, ncol=2, labelcolor=FG)
    cursors.append(tx.axvline(0, color=FG, lw=1.4))


def mean_edge(v):
    return (0.5 * (v[e[:, 0]] + v[e[:, 1]]))[order]


def draw(i):
    t = st[i]
    for f in ("cc", "ce"):
        lines[f].set_array(mean_edge(vals[f][i]))
    n = int(np.searchsorted(tt, t, side="right"))
    for ln, y in curves:
        ln.set_data(tt[:n], y[:n])
    for c in cursors:
        c.set_xdata([t, t])
    tlabel.set_text(f"t = {t:6.1f} ms")
    on = (t - 20.0) % 200.0 <= 10.0 and t >= 20.0
    speed.set_text(("synapse open  ·  " if on else "") + ("0.5 ms per frame" if t <= SLOW_UNTIL else
                                                           "2 ms per frame (4× faster)"))
    fig.canvas.draw()
    return np.asarray(fig.canvas.buffer_rgba())[:, :, :3]


OUT.mkdir(parents=True, exist_ok=True)
ff = imageio_ffmpeg.get_ffmpeg_exe()
# one encoder pass writes both formats from the frames piped in
enc = subprocess.Popen([ff, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                        "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags",
                        "+faststart", str(OUT / "calcsim-wave.mp4"), "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf",
                        "34", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-pix_fmt", "yuv420p",
                        str(OUT / "calcsim-wave.webm")], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
for i in frames:
    enc.stdin.write(draw(i).tobytes())
    if i == int(np.searchsorted(st, 60.0)):
        plt.savefig(OUT / "calcsim-wave-poster.png", facecolor=BG)
enc.stdin.close()
assert enc.wait() == 0
subprocess.run([ff, "-y", "-i", str(OUT / "calcsim-wave-poster.png"), "-q:v", "3", str(OUT / "calcsim-wave-poster.jpg")],
               check=True, capture_output=True)
(OUT / "calcsim-wave-poster.png").unlink()
print(len(frames), "frames,", len(frames) / FPS, "s;", {p.name: p.stat().st_size // 1024 for p in OUT.glob("calcsim*")})
