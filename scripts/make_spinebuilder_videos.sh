#!/usr/bin/env bash
# The two videos of the SpineBuilder page, cut from the app's screen recording (1600 x 960, 86 s, with a title bar
# naming each step): the Process Spine steps (0-41 s) and the saved mesh opened in ProMesh (41-86 s).
# Usage: scripts/make_spinebuilder_videos.sh [data/spinebuilder/process_spine_tour.mp4]
set -euo pipefail
ROOT="$(dirname "$0")/.."
IN="${1:-$ROOT/data/spinebuilder/process_spine_tour.mp4}"; OUT="$ROOT/public/spinebuilder/video"; mkdir -p "$OUT"
clip() {   # name start duration poster-at
  local V="scale=1280:-2:flags=lanczos,fade=t=in:st=0:d=0.4,fade=t=out:st=$(echo "$3 - 0.5" | bc):d=0.5,format=yuv420p"
  ffmpeg -v error -y -ss "$2" -t "$3" -i "$IN" -an -vf "$V" -c:v libx264 -preset slow -crf 26 -movflags +faststart "$OUT/$1.mp4"
  ffmpeg -v error -y -ss "$2" -t "$3" -i "$IN" -an -vf "$V" -c:v libvpx-vp9 -b:v 0 -crf 40 -row-mt 1 -deadline good -cpu-used 2 "$OUT/$1.webm"
  ffmpeg -v error -y -ss "$4" -i "$OUT/$1.mp4" -frames:v 1 -q:v 4 "$OUT/$1-poster.jpg"
}
clip process-steps 0 41 13
clip promesh 41 45 30
