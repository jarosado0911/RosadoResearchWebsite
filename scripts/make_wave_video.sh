#!/usr/bin/env bash
# The calcium wave video for the spines page, from the ParaView render geometrylong.mp4 (6796 x 1540, 15 fps):
# a close-up of the spine (top) over the whole dendrite (bottom, the close-up area boxed), the grey background
# replaced with the page's dark color, the color bars left out (the page draws its own legend),
# the last frame held 1.5 s before the loop.        Usage: scripts/make_wave_video.sh path/to/geometrylong.mp4
set -euo pipefail
IN="$1"; OUT="$(dirname "$0")/../public/video"; mkdir -p "$OUT"
BG="if(lt(abs(r(X,Y)-g(X,Y)),5)*lt(abs(g(X,Y)-b(X,Y)),5)*between(r(X,Y),118,160)"
F="[0]crop=5720:630:540:400,format=rgb24,geq=r='${BG},10,r(X,Y))':g='${BG},17,g(X,Y))':b='${BG},32,b(X,Y))',split[a][b];
[a]crop=1600:630:2060:0[close];
[b]scale=1600:-2:flags=area,drawbox=x=576:y=0:w=448:h=ih:color=white@0.55:t=2,pad=1600:ih+28:0:28:color=0x0a1120[strip];
[close][strip]vstack,tpad=stop_mode=clone:stop_duration=1.5,fade=t=in:st=0:d=0.4,fade=t=out:st=14.4:d=0.5,format=yuv420p"
ffmpeg -y -i "$IN" -an -filter_complex "$F" -c:v libx264 -preset slow -crf 24 -movflags +faststart "$OUT/calcium-wave.mp4"
ffmpeg -y -i "$IN" -an -filter_complex "$F" -c:v libvpx-vp9 -b:v 0 -crf 36 -row-mt 1 -deadline good -cpu-used 2 "$OUT/calcium-wave.webm"
ffmpeg -y -ss 6 -i "$OUT/calcium-wave.mp4" -frames:v 1 -q:v 4 "$OUT/calcium-wave-poster.jpg"
