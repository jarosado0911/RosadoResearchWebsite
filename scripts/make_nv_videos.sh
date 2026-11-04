#!/usr/bin/env bash
# The two Neuro-VISOR videos from the frames recorded in Unity by the editor scripts ElectricalVideo.cs and
# CalciumVideo.cs (Assets/Editor of each branch; they write C:/Users/JamesRosado/nv_capture/{electrical,calcium}).
# Usage: scripts/make_nv_videos.sh [electrical|calcium|both]
set -euo pipefail
CAP=/mnt/c/Users/JamesRosado/nv_capture
OUT="$(dirname "$0")/../public/video"; mkdir -p "$OUT"
BG=0x05070d
enc() {   # $1 name, then the ffmpeg input/filter arguments
  local name=$1; shift
  ffmpeg -v error -y "$@" -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart "$OUT/$name.mp4"
  ffmpeg -v error -y "$@" -c:v libvpx-vp9 -b:v 0 -crf 34 -row-mt 1 -deadline good -cpu-used 2 -pix_fmt yuv420p "$OUT/$name.webm"
}
if [[ "${1:-both}" != calcium ]]; then
  # left: the cell alone (cropped to it); right: the room as the user sees it. 0.1 ms per frame, 24 fps.
  enc nv-electrical -framerate 24 -start_number 1 -i "$CAP/electrical/cell_%04d.png" -framerate 24 -start_number 1 -i "$CAP/electrical/room_%04d.png" \
    -filter_complex "[0]crop=860:860:380:20,pad=900:900:20:20:color=$BG[l];[1]crop=1100:619:250:281,scale=700:394,pad=700:900:0:253:color=$BG[r];[l][r]hstack,tpad=stop_mode=clone:stop_duration=1.2,fade=t=in:st=0:d=0.3"
  ffmpeg -v error -y -ss 1.5 -i "$OUT/nv-electrical.mp4" -frames:v 1 -q:v 4 "$OUT/nv-electrical-poster.jpg"
fi
if [[ "${1:-both}" != electrical ]]; then
  # left: the soma close up; right: the whole cell in the room. 2 ms per frame, 24 fps.
  enc nv-calcium -framerate 24 -i "$CAP/calcium/soma_%04d.png" -framerate 24 -i "$CAP/calcium/room_%04d.png" \
    -filter_complex "[0]scale=1000:562[l];[1]crop=900:900:350:0,scale=562:562,pad=600:562:19:0:color=$BG[r];[l][r]hstack,tpad=stop_mode=clone:stop_duration=1.2,fade=t=in:st=0:d=0.3"
  ffmpeg -v error -y -ss 4 -i "$OUT/nv-calcium.mp4" -frames:v 1 -q:v 4 "$OUT/nv-calcium-poster.jpg"
fi
