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
| Spine data | `public/spines/`, made from `data/spines/Spine_*_Vlachos.ugx` (copied from SpineBuilder's `output/plasma_membranes_er/`) by `npm run spines` |
| SpineBuilder page | `spinebuilder.html`; background, explore mode and scroll flights in `src/spinebuilder.js` (camera views in `VIEWS`), the "Try it" builder in `src/idealspine.js`, shared materials and colors in `src/sbmaterials.js`; math typeset with KaTeX |
| SpineBuilder meshes | `public/spinebuilder/mesh/`, made from `data/spinebuilder/*.ugx` (saved from the SpineBuilder app; the cell from `cell_spines_web.ugx.gz`, its ER reduced to a quarter) by `npm run spinebuilder`; the downloadable `.ugx` files go to `public/spinebuilder/downloads/` |
| SpineBuilder screenshots | `public/spinebuilder/img/`, taken by `scripts/spinebuilder_screens.py` (drives the app on a hidden X display; also saves the `.ugx` files) |
| NeuronMesh page | `neuronmesh.html`; background pipeline, frame demo and side-by-side comparison in `src/neuronmesh.js`; data in `public/neuronmesh/`, made from `data/neuronmesh/` by `npm run neuronmesh`; the source meshes (both generators on `0-2a.CNG.swc`, and their crossing triangles from TetGen `-d`) by `scripts/make_neuronmesh_meshes.sh`, which needs `~/projects/neuronmesh` and `~/projects/PythonNeuronMeshes`; figures in `public/neuronmesh/img/` are from their docs |
| SpineBuilder videos | `public/spinebuilder/video/`, cut from `data/spinebuilder/process_spine_tour.mp4` by `scripts/make_spinebuilder_videos.sh`; the step texts under them are in `spinebuilder.html` (`data-from`/`data-to`) |

Users who set "reduce motion" in their OS get a still frame instead of the animation.

Everything the pages need is in this project: `data/` holds the sources (the CA1 graph, the spine meshes, the
SpineBuilder `.ugx` files and screen recording), `public/` what the site serves. Only remaking the SpineBuilder
screenshots needs the SpineBuilder application itself.

## Going live later

`npm run build` makes a plain static folder (`dist/`) that any static host can serve
(Netlify, Vercel, Cloudflare Pages, GitHub Pages, or your own server); point the domain at it.

## The fly-through video

`public/video/spine-cell.{webm,mp4}` and the poster were made from the original `Video Project.mp4`:
the axis marker removed, recolored to the site's blues, the silent audio dropped, fades added for the loop.
The ffmpeg commands are in `scripts/make_video.sh`.
