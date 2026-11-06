#!/usr/bin/env bash
# The whole-cell calcium video (wholecell.html), from SpineBuilder's render of the 100 ms run
# (ca_ug4_cell_test/output/video/calcium_erjet_slice_..._posguard_run100ms.mp4, 2560 x 1080, 20 fps, 0.1 ms per frame):
# the whole layout kept (cell, soma and syn1 close-ups, color bars, the cut through the soma, the time strip), scaled to
# 1920 wide, its grey background (#444444) toned into the page's dark blue (grey pixels only, so antialiased text keeps
# its edges), the last frame held 1.5 s before the loop.
# Usage: scripts/make_wholecell_video.sh path/to/calcium_erjet_slice_..._run100ms.mp4
set -euo pipefail
IN="$1"; OUT="$(dirname "$0")/../public/video"; mkdir -p "$OUT"
# a grey pixel (r = g = b within 6) of level v: 68 -> the page color, 255 -> white, 0 -> black
G="lt(abs(r(X,Y)-g(X,Y)),7)*lt(abs(g(X,Y)-b(X,Y)),7)"
tone() { echo "if(${G},if(gte(${1}(X,Y),68),${2}+(255-${2})*(${1}(X,Y)-68)/187,${2}*${1}(X,Y)/68),${1}(X,Y))"; }
F="scale=1920:-2:flags=area,format=rgb24,geq=r='$(tone r 10)':g='$(tone g 17)':b='$(tone b 32)',
tpad=stop_mode=clone:stop_duration=1.5,fade=t=in:st=0:d=0.4,fade=t=out:st=51.05:d=0.5,format=yuv420p"
ffmpeg -y -i "$IN" -an -vf "$F" -c:v libx264 -preset slow -crf 24 -movflags +faststart "$OUT/wholecell-wave.mp4"
ffmpeg -y -i "$IN" -an -vf "$F" -c:v libvpx-vp9 -b:v 0 -crf 36 -row-mt 1 -deadline good -cpu-used 2 "$OUT/wholecell-wave.webm"
ffmpeg -y -ss 8 -i "$OUT/wholecell-wave.mp4" -frames:v 1 -q:v 4 "$OUT/wholecell-wave-poster.jpg"
