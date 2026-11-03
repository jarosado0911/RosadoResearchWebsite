#!/usr/bin/env python3
"""Exports the 10 reconstructed Vlachos spines from SpineBuilder for the website's spine gallery.

Input:  <SpineBuilder>/output/plasma_membranes_er/Spine_*_Vlachos.ugx (bin/build_membranes -er): one closed surface
        per spine in a common frame (dendrite along z from 0 to 10 um, radius 0.45, spine at z = 5 pointing +y),
        subsets syn (synapse), spine, dend, sa (spine apparatus), er (dendritic ER).
Output: public/spines/index.json (list with names and measurements) and public/spines/<id>.json, each with
        parts pm (spine + dendrite membrane), syn, sa, er as {p: flat xyz [um], i: triangle indices}.
The dendrite and its ER are cut to |z - 5| < CROP um around the spine; coordinates are moved so that the spine's
base on the dendrite axis is at the origin.

Usage: python3 scripts/build_spines.py [path/to/SpineBuilder]
"""
import json, re, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SB = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "projects/SpineBuilder"
SRC = SB / "output/plasma_membranes_er"
DST = ROOT / "public/spines"
CROP = 1.8

# spine id -> (label, type), from the folder names in SpineBuilder/data/RealSpines
SPINES = {
    "0005": ("Spine 5", "Mushroom"), "0006": ("Spine 6", "Stubby"), "0009": ("Spine 9", "Thin"),
    "0011": ("Spine 11", "Mushroom"), "0131": ("Spine 13.1", "Stubby"), "0132": ("Spine 13.2", "Mushroom"),
    "0014": ("Spine 14", "Mushroom"), "0016": ("Spine 16", "Mushroom"), "0017": ("Spine 17", "Thin"),
    "0018": ("Spine 18", "Branched (FIB-SEM)"),
}
ORDER = ["0005", "0132", "0014", "0016", "0011", "0009", "0017", "0006", "0131", "0018"]


def part_of(name):
    if name.startswith("spine") or name.startswith("dend"): return "pm"
    if name.startswith("syn"): return "syn"
    if name.startswith("sa"): return "sa"
    if name.startswith("er"): return "er"
    return None


def area(V, T):
    if len(T) == 0: return 0.0
    a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    return float(0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1).sum())


DST.mkdir(parents=True, exist_ok=True)
index = []
for sid in ORDER:
    f = SRC / f"Spine_{sid}_Vlachos.ugx"
    s = f.read_text()
    V = np.array(re.search(r'<vertices coords="3">([^<]*)</vertices>', s).group(1).split(), float).reshape(-1, 3)
    T = np.array(re.search(r"<triangles>([^<]*)</triangles>", s).group(1).split(), int).reshape(-1, 3)
    V = V - np.array([0.0, 0.0, 5.0])
    parts = {}
    for name, body in re.findall(r'<subset name="([^"]*)"[^>]*>(.*?)</subset>', s, re.S):
        p = part_of(name)
        m = re.search(r"<faces>([^<]*)</faces>", body)
        if p is None or not m: continue
        faces = np.array(m.group(1).split(), int)
        if name.startswith("dend") or name.startswith("er"):   # crop the long dendrite and its ER around the spine
            z = V[T[faces]][:, :, 2]
            faces = faces[(z.max(1) < CROP) & (z.min(1) > -CROP)]
        parts.setdefault(p, []).append(faces)
    out, meas = {}, {}
    for p, lists in parts.items():
        tris = T[np.concatenate(lists)]
        used, inv = np.unique(tris, return_inverse=True)
        out[p] = {"p": np.round(V[used], 4).ravel().tolist(), "i": inv.reshape(-1).tolist()}
        meas[p] = area(V, tris)
    spineTop = float(V[np.unique(T[np.concatenate(parts["pm"])])][:, 1].max())
    label, kind = SPINES[sid]
    doc = {"id": sid, "name": label, "type": kind, "parts": out}
    (DST / f"{sid}.json").write_text(json.dumps(doc, separators=(",", ":")))
    index.append({"id": sid, "name": label, "type": kind,
                  "length": round(spineTop - 0.45, 2),          # [um] from the dendrite surface (radius 0.45)
                  "psdArea": round(meas.get("syn", 0.0), 3),     # [um^2]
                  "saArea": round(meas.get("sa", 0.0), 2)})      # [um^2]
    print(sid, label, kind, {k: len(v["i"]) // 3 for k, v in out.items()}, "tris;",
          f"{(DST / f'{sid}.json').stat().st_size / 1024:.0f} KB", index[-1])
(DST / "index.json").write_text(json.dumps(index, indent=1))
