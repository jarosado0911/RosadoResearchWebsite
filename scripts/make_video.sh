#!/usr/bin/env bash
# Recolors the fly-through video for the spines page.   Usage: scripts/make_video.sh "path/to/Video Project.mp4"
set -euo pipefail
IN="$1"; OUT="$(dirname "$0")/../public/video"; mkdir -p "$OUT"
# the axis marker (bottom left): pure red/green/blue pixels in that corner become black
C="between(X,120,260)*between(Y,395,545)*(gt(r(X,Y),1.5*g(X,Y)+6)+gt(g(X,Y),1.35*r(X,Y)+6)+gt(b(X,Y),1.25*max(r(X,Y),g(X,Y))+6))"
# brightness -> the site's blues; fades at both ends for a smooth loop (the video is 31.9 s)
GRADE="format=rgb24,geq=r='if($C,0,r(X,Y))':g='if($C,0,g(X,Y))':b='if($C,0,b(X,Y))',format=gray,format=rgb24,curves=r='0/0 0.35/0.05 0.7/0.45 1/0.95':g='0/0 0.35/0.25 0.7/0.75 1/1':b='0/0 0.25/0.35 0.6/0.95 1/1',fade=t=in:st=0:d=0.8,fade=t=out:st=31.0:d=0.9,format=yuv420p"
ffmpeg -y -i "$IN" -an -vf "$GRADE" -c:v libx264 -preset slow -crf 25 -movflags +faststart "$OUT/spine-cell.mp4"
ffmpeg -y -i "$IN" -an -vf "$GRADE" -c:v libvpx-vp9 -b:v 0 -crf 38 -row-mt 1 -deadline good -cpu-used 2 "$OUT/spine-cell.webm"
ffmpeg -y -ss 30 -i "$OUT/spine-cell.mp4" -frames:v 1 -q:v 4 "$OUT/spine-cell-poster.jpg"
