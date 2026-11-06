#!/usr/bin/env bash
# The NeMo-TMS page's source data, in data/nemotms/. Needs a clone of github.com/OpitzLab/NeMo-TMS, UG4 with the
# neuro_collection plugin, and uv. Then: npm run nemotms
#   - the sample cell and its 120 voltage frames, from the toolbox's git history (commit 00dd8c7, removed later)
#   - the calcium run: the toolbox's vdccFullCellCalcium.lua with the axon given the same calcium mechanisms as the rest of
#     the cell (scripts/nemotms_whole_cell.py), on those frames and then a relaxation to rest (build_nemotms.py --frames),
#     with the settings of its setup app (-setting none -solver GS -minDef 1e-11 -numNewton 5) and a 25 us step
#   - the pulse shapes and three of the morphologies it ships
set -euo pipefail
NEMO=${NEMO:-$HOME/projects/NeMo-TMS}
UGSHELL=${UGSHELL:-$HOME/software/ug4/bin/ugshell}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$HERE/../data/nemotms
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
COMMIT=00dd8c7 SAMPLE=8_Calcium-Modeling/MacOS-VRL-CalciumDynamics
mkdir -p "$OUT/morphos" "$WORK/vm" "$WORK/out"
git -C "$NEMO" show "$COMMIT:$SAMPLE/geometry/sample_neuron6.swc" > "$WORK/sample_neuron6.swc"
for f in $(git -C "$NEMO" ls-tree -r --name-only "$COMMIT" -- "$SAMPLE/voltageData/sample_vmData6" | grep '\.dat$'); do
  git -C "$NEMO" show "$COMMIT:$f" > "$WORK/vm/$(basename "$f")"
done
tar -czf "$OUT/voltage_frames.tar.gz" -C "$WORK" vm
python3 "$HERE/build_nemotms.py" --frames "$WORK/vm"
python3 "$HERE/nemotms_whole_cell.py" "$NEMO/Model_Generation/TMS_package/Calcium/vdccFullCellCalcium.lua" "$WORK/calcium.lua"
(cd "$WORK" && "$UGSHELL" -ex "$WORK/calcium.lua" \
  -grid "$WORK/sample_neuron6.swc" -numRefs 0 -setting none -dt 2.5e-5 -endTime 0.012 -vmData "$WORK/vm" \
  -solver GS -minDef 1e-11 -numNewton 5 -vSampleRate 0.000025 -outName "$WORK/out" > "$WORK/run.log" 2>&1)
gzip -c "$WORK/out/fullCalciumData.txt" > "$OUT/fullCalciumData.txt.gz"
cp "$WORK/out/timeSteps.txt" "$WORK/out/outDom.txt" "$WORK/out/outDom.swc" "$OUT/"
cp "$NEMO/Model_Generation/morphos/"{cell_1,Aberra_human_L23,Aberra_human_L5}.swc "$OUT/morphos/"
(cd "$NEMO/Model_Generation/TMS_package/TMS_Waveform/original_waveforms" && uv run --no-project --with scipy python -c "
import json, sys
from scipy.io import loadmat
out = {}
for key, name in (('mono', 'TMS_mono.mat'), ('bi', 'TMS_bi.mat')):
    d = loadmat(name)
    out[key] = {'ms': [round(float(x), 4) for x in d['TMS_t'].ravel()], 'E': [round(float(x), 4) for x in d['TMS_E'].ravel()]}
json.dump(out, sys.stdout, separators=(',', ':'))") > "$OUT/waveforms.json"
echo "data/nemotms ready"
