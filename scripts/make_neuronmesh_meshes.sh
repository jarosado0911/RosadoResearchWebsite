#!/usr/bin/env bash
# The source meshes of the NeuronMesh page (data/neuronmesh/), made from one NeuroMorpho cell (0-2a.CNG.swc)
# by both of my mesh generators, plus each mesh's self-intersecting triangles (TetGen -d only detects them; no
# tetrahedra are made). Only needed to make them again; the page uses the copies in data/ and public/.
#
# Needs: ~/projects/neuronmesh (built: bin/neuronmesh), ~/projects/PythonNeuronMeshes and a Python with numpy,
# scipy, networkx and matplotlib (PYTHON=...), and TetGen (TETGEN=..., e.g. the one built with ug4).
# Usage: PYTHON=/path/to/python TETGEN=/path/to/tetgen scripts/make_neuronmesh_meshes.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="$ROOT/data/neuronmesh"; mkdir -p "$OUT"
NM="${NEURONMESH:-$HOME/projects/neuronmesh}"; PNM="${PYTHONNEURONMESHES:-$HOME/projects/PythonNeuronMeshes}"
PYTHON="${PYTHON:-python3}"; TETGEN="${TETGEN:-$HOME/projects/ug4/bin/tetgen}"
SWC="$NM/data/0-2a.CNG.swc"            # the same file for both tools
cp "$SWC" "$OUT/0-2a.CNG.swc"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# NeuronMesh: cubic B-spline at 4 um, 12 sides, soma repaired and welded, finer rings at branch points
( cd "$NM" && /usr/bin/time -f "neuronmesh: %e s" ./bin/neuronmesh -i "$SWC" --mesh --method BS --p 3 --delta 4 --sides 12 \
    --repair --sphere-weld --junction-refine 0.5 --1d --ugx -o "$WORK/nm.ugx" )
cp "$WORK/nm.ugx" "$OUT/neuronmesh_0-2a.ugx"; cp "$WORK/nm1d.swc" "$OUT/neuronmesh_0-2a_1d.swc"

# PythonNeuronMeshes: scipy spline at 4 um (one level), 12 contour points, soma sphere 10 x 16
( cd "$WORK" && /usr/bin/time -f "PythonNeuronMeshes: %e s" "$PYTHON" -c "
import sys; sys.path.insert(0, '$PNM/src')
import neuronmeshgenerator as nmg
nmg.make_meshes('$SWC', 4.0, 1, 12, 10, 16)" )
cp "$WORK/0-2a.CNG.mesh/0-2a.CNG_3d_mesh_refinment0.ugx" "$OUT/python_0-2a.ugx"
cp "$WORK/0-2a.CNG.mesh/0-2a.CNG_1d_refinement0.ugx" "$OUT/python_0-2a_1d.ugx"

# self-intersections: TetGen -d on each surface (as .off); the crossing pairs, 0-based triangle numbers
for name in neuronmesh python; do
  "$PYTHON" - "$OUT/${name}_0-2a.ugx" "$WORK/$name.off" <<'EOF'
import re, sys, numpy as np
s = open(sys.argv[1]).read()
V = np.array(re.search(r'<vertices coords="3">([^<]*)</vertices>', s).group(1).split(), float).reshape(-1, 3)
T = np.array(re.search(r"<triangles>([^<]*)</triangles>", s).group(1).split(), int).reshape(-1, 3)
with open(sys.argv[2], "w") as f:
    f.write(f"OFF\n{len(V)} {len(T)} 0\n"); np.savetxt(f, V, fmt="%.6f"); np.savetxt(f, np.hstack([np.full((len(T), 1), 3), T]), fmt="%d")
EOF
  ( cd "$WORK" && "$TETGEN" -d "$name.off" > "$name.tetgen.log" 2>&1 || true )
  grep -o "Facet #[0-9]* intersects facet #[0-9]*" "$WORK/$name.tetgen.log" \
    | awk '{gsub("#", ""); print $2 - 1, $5 - 1}' > "$OUT/${name}_crossings.txt"
  echo "$name: $(wc -l < "$OUT/${name}_crossings.txt") crossing triangle pairs"
done
