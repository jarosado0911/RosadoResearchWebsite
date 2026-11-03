#!/usr/bin/env python3
"""Converts the SpineBuilder meshes in data/spinebuilder/ (.ugx, saved from the app by spinebuilder_screens.py)
into the compact binary meshes the spinebuilder.html page loads, and copies the small .ugx files for download.

Input  (data/spinebuilder/): ideal.ugx (Ideal Spine Builder), process_tubes.ugx (Process Spine, step 5),
       cell_spines_web.ugx.gz (Cell Builder: the AnaMorph cell with 10 spines welded in, each with its real spine
       apparatus joined to the ER; the ER reduced to a quarter of its triangles, see spinebuilder_screens.py;
       cell_spines.ugx.gz next to it is the app's full-resolution file).
Output (public/spinebuilder/mesh/): <name>.json (parts with their byte offsets, synapse centers and spine axes, bounds) and <name>.bin
       (per part: float32 xyz [um], then uint32 triangle indices); public/spinebuilder/downloads/*.ugx.

Usage: python3 scripts/build_spinebuilder.py
"""
import gzip, json, re, shutil
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data/spinebuilder"
DST = ROOT / "public/spinebuilder/mesh"
DL = ROOT / "public/spinebuilder/downloads"

# mesh -> {web part: [ugx subsets]}; a part's subsets are merged
MESHES = {
    "ideal": ("ideal.ugx", {"pm": ["pm"], "syn": ["syn"], "er": ["erm"], "sa": ["sam"]}),
    "process": ("process_tubes.ugx", {"pm": ["spine", "dend"], "syn": ["PSD"], "er": ["er"], "sa": ["SA"]}),
    "cell": ("cell_spines_web.ugx.gz", {"pm": ["pm"], "syn": [f"syn{i}" for i in range(1, 11)], "er": ["er"], "sa": ["sa"]}),
}


def read_ugx(path):
    s = (gzip.open(path, "rt") if path.suffix == ".gz" else open(path)).read()
    V = np.array(re.search(r'<vertices coords="3">([^<]*)</vertices>', s).group(1).split(), float).reshape(-1, 3)
    tri = re.search(r"<triangles>([^<]*)</triangles>", s)
    quad = re.search(r"<quadrilaterals>([^<]*)</quadrilaterals>", s)
    T = np.array(tri.group(1).split(), int).reshape(-1, 3) if tri else np.zeros((0, 3), int)
    Q = np.array(quad.group(1).split(), int).reshape(-1, 4) if quad else np.zeros((0, 4), int)
    # faces are numbered triangles first, then quadrilaterals; a quad is two triangles
    faces = list(T) + [None] * len(Q)
    subsets = {}
    for name, body in re.findall(r'<subset name="([^"]*)"[^>]*>(.*?)</subset>', s, re.S):
        m = re.search(r"<faces>([^<]*)</faces>", body)
        if not m: continue
        ids = np.array(m.group(1).split(), int)
        t = [T[ids[ids < len(T)]]]
        q = Q[ids[ids >= len(T)] - len(T)]
        if len(q): t += [q[:, [0, 1, 2]], q[:, [0, 2, 3]]]
        subsets[name] = np.vstack(t)
    return V, subsets


DST.mkdir(parents=True, exist_ok=True)
DL.mkdir(parents=True, exist_ok=True)
for name, (file, parts) in MESHES.items():
    V, subsets = read_ugx(SRC / file)
    blob, meta, used_all = bytearray(), [], []
    for part, names in parts.items():
        tris = [subsets[n] for n in names if n in subsets and len(subsets[n])]
        if not tris: continue
        tris = np.vstack(tris)
        used, inv = np.unique(tris, return_inverse=True)
        used_all.append(used)
        p = V[used].astype(np.float32)
        i = inv.reshape(-1).astype(np.uint32)
        meta.append({"name": part, "vertices": len(p), "triangles": len(i) // 3,
                     "positions": len(blob), "indices": len(blob) + p.nbytes})
        blob += p.tobytes() + i.tobytes()
    P = V[np.unique(np.concatenate(used_all))]
    # the synapses (one per spine): where the page's camera flies to, center and the spine's axis n (from the
    # middle of the membrane within 3 um, i.e. the dendrite under the spine, to the synapse)
    pm = V[np.unique(np.vstack([subsets[n] for n in parts["pm"] if n in subsets]))]
    spots = []
    for n in parts["syn"]:
        if n not in subsets or not len(subsets[n]): continue
        c = V[np.unique(subsets[n])].mean(0)
        near = pm[np.linalg.norm(pm - c, axis=1) < 3.0]
        a = c - near.mean(0)
        spots.append({"c": np.round(c, 4).tolist(), "n": np.round(a / np.linalg.norm(a), 4).tolist()})
    doc = {"name": name, "source": file, "unit": "um", "parts": meta, "spots": spots,
           "bounds": [np.round(P.min(0), 4).tolist(), np.round(P.max(0), 4).tolist()]}
    (DST / f"{name}.bin").write_bytes(bytes(blob))
    (DST / f"{name}.json").write_text(json.dumps(doc, indent=1))
    print(name, {m["name"]: m["triangles"] for m in meta}, f"{len(blob) / 1024:.0f} KB", doc["bounds"])

for f in ("ideal.ugx", "process_tubes.ugx"):
    shutil.copy(SRC / f, DL / f"spinebuilder_{f}")
