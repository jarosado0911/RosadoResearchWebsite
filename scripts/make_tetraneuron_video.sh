#!/usr/bin/env bash
# public/video/tetraneuron-grow.{mp4,webm} and its poster, from the frames of scripts/record_tetraneuron.py
set -euo pipefail
FRAMES=${1:?usage: make_tetraneuron_video.sh <frames folder>}
OUT=$(cd "$(dirname "$0")/.." && pwd)/public/video
ffmpeg -y -loglevel error -framerate 30 -i "$FRAMES/f%05d.png" -an -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p -movflags +faststart "$OUT/tetraneuron-grow.mp4"
ffmpeg -y -loglevel error -framerate 30 -i "$FRAMES/f%05d.png" -an -c:v libvpx-vp9 -b:v 0 -crf 33 -row-mt 1 -deadline good -cpu-used 2 -pix_fmt yuv420p "$OUT/tetraneuron-grow.webm"
ffmpeg -y -loglevel error -ss 15 -i "$OUT/tetraneuron-grow.mp4" -frames:v 1 -q:v 3 "$OUT/tetraneuron-grow-poster.jpg"
ls -la "$OUT"/tetraneuron-grow*
