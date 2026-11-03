# new-website

Personal site (consulting + research) with a live WebGL background: a reconstructed CA1 pyramidal neuron
(from the Neuro-VISOR calcium project) with an illustrative back-propagating action potential.

## Run locally

```bash
npm install          # once
npm run dev          # http://localhost:5173  (live reload; placeholders to fill in are outlined)
npm run build        # static site in dist/
npm run preview      # http://localhost:4173  (serves dist/, what a host would serve)
```

Debug URL parameters: `?t=0.9` freezes the background 0.9 s after a spike; `?scroll=0.5` jumps half way down (`?scroll=spine-gallery` jumps to the gallery).

## Where things are

| What | Where |
|---|---|
| All page text | `index.html` (elements with class `todo` are placeholders) |
| Colors, fonts, layout | `src/style.css` (`:root` variables at the top) |
| Neuron look and spike timing | `LOOK` at the top of `src/neuron.js` |
| Neuron data | `public/neuron/ca1.json`, made from `data/ca1_graph.txt` by `npm run neuron` |
| Spine gallery look | `COLORS` at the top of `src/spines.js`; layout under "spine gallery" in `src/style.css` |
| Fly-through video (spines page) | `public/video/`, recolored from the original (see below) |
| Calcium wave video (spines page) | `public/video/calcium-wave.*`, from `geometrylong.mp4` by `scripts/make_wave_video.sh`; the step texts under it are in `spines.html` (`data-from`/`data-to` = seconds of the video) |
| Spine data | `public/spines/`, made from SpineBuilder's `output/plasma_membranes_er/Spine_*_Vlachos.ugx` by `npm run spines` |

Users who set "reduce motion" in their OS get a still frame instead of the animation.

## Going live later

`npm run build` makes a plain static folder (`dist/`) that any static host can serve
(Netlify, Vercel, Cloudflare Pages, GitHub Pages, or your own server); point the domain at it.

## The fly-through video

`public/video/spine-cell.{webm,mp4}` and the poster were made from the original `Video Project.mp4`:
the axis marker removed, recolored to the site's blues, the silent audio dropped, fades added for the loop.
The ffmpeg commands are in `scripts/make_video.sh`.
