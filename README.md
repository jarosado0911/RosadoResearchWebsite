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

Debug URL parameters: `?t=0.9` freezes the background 0.9 s after a spike; `?scroll=0.5` jumps half way down (`?scroll=spine-gallery` jumps to the gallery); on `wholecell.html`, `?scene=cut&wct=30` holds the background on one scene (`cell`, `syn`, `soma`, `cut`, `thin`, `thick`, `late`) at 30 ms.

## Where things are

| What | Where |
|---|---|
| All page text | `index.html` (elements with class `todo` are placeholders) |
| Colors, fonts, layout | `src/style.css` (`:root` variables at the top) |
| Neuron look and spike timing | `LOOK` at the top of `src/neuron.js` |
| Neuron data | `public/neuron/ca1_mesh.{json,bin}` by `npm run neuron` (`scripts/build_neuron_mesh.py`, numpy only) from `data/ca1/`: `ca1.swc` (from `data/ca1_graph.txt` by `scripts/ca1_to_swc.py`), `ca1_neuronmesh.ugx.gz` + `_1d.swc` (NeuronMesh: `--mesh --method BS --p 3 --delta 2 --sides 10 --sphere-weld --junction-refine 0.5 --1d --ugx`), `ca1_spines_web.ugx.gz` (400 spines welded in by SpineBuilder's scatter, `scripts/place_ca1_spines.py`, reduced to 200k triangles). The old procedural tubes (`ca1.json`, `scripts/build_neuron.py`) are no longer used |
| 3D calcium machinery (spines page) | `src/calcium3d.js` (the model's schematic in 3D: cell, ER, IP3R, RyR, SERCA, PMCA, NCX, VDCC, synapse, Ca²⁺, IP3, calbindin; hover texts in `INFO`, colors in `COLOR`); the card is `#ca3d` in `spines.html`, styles under "3D calcium machinery" in `src/style.css` |
| Spine gallery look | `COLORS` at the top of `src/spines.js`; layout under "spine gallery" in `src/style.css` |
| Fly-through video (spines page) | `public/video/`, recolored from the original (see below) |
| Calcium wave video (spines page) | `public/video/calcium-wave.*`, from `geometrylong.mp4` by `scripts/make_wave_video.sh`; the step texts under it are in `spines.html` (`data-from`/`data-to` = seconds of the video) |
| Spine data | `public/spines/`, made from `data/spines/Spine_*_Vlachos.ugx` (copied from SpineBuilder's `output/plasma_membranes_er/`) by `npm run spines` |
| Series & analysis page | `mathematics.html` (the Rosado-Osler table of integrals, with the live "integrate without integrating" demo in `src/mathematics.js`, then talks, expository papers, the frames talks and Mathematics Vectors); the documents are copies in `public/math/` (from the old Google site's Drive files; the JMM 2015 PowerPoint converted to PDF, the Aarão study rasterized from 15.8 MB to 1.7 MB); the magazine issues stay Google Drive links |
| CalcSim page | `calcsim.html` (the SIAM 2023 resilience paper: synopsis, the CalcSim equations as implemented in `~/projects/CalcSim`, numerics, the synapse-loss protocol); its video `public/video/calcsim-wave.*` is rendered by `scripts/make_calcsim_video.py` from `data/calcsim/n7_cs.npz`, which `scripts/export_calcsim_run.py` copied from the cached C# run of study N7 in `~/projects/Neuro-VISOR-calcium-studies` (one synapse on NMO_150605; the app's settings: NCX x5, no voltage coupling). Both scripts run with `~/.venvs/calcium/bin/python` (numpy, matplotlib, imageio-ffmpeg); the step texts are in `calcsim.html` (`data-from`/`data-to` = seconds of the video) |
| CalcSim model diagram | `src/calcsim.js` (2D cut of a dendrite: plasma membrane, ER, synapse, VDCC, PM leak, PMCA, NCX, SOC, RyR, SERCA, ER leak, diffusion, calbindin/calreticulin; positions in `buildDiagram`, hover texts and terms in `INFO`, colors from the 3D card); markup `#cs-diagram` in `calcsim.html`, styles under "the 2D model diagram" in `src/style.css` |
| CalcSim 3D background | `src/calcsim3d.js` (the N7 cell in 3D: additive glass membrane colored by cytosolic Ca, the ER tube inside (radius 3/8) colored by ER Ca, replaying the wave; drag rotates, shift/right-drag moves, double-click resets; dendrites drawn at 0.9 um instead of 0.125 um); data `public/calcsim/cell.json` + `wave.bin` (uint8 log frames every 1 ms) made from `data/calcsim/n7_cs.npz` by `python3 scripts/build_calcsim_cell.py` |
| Frames page | `frames.html` (master's thesis and LAA 2017 paper); everything computed live in `src/frames.js` (harmonic frame, the thesis' split formula and n_max, the conference-matrix ETF with Algorithm 1 / random / the paper's counterexample, the bounds chart); the thesis PDF is `public/frames/Rosado_2016_Partitions_of_Finite_Frames.pdf`; the paper is linked by DOI (Elsevier's copy is not hosted here) |
| Résumé page | `resume.html` (all its text; source: `data/resume/resume.txt`, the résumé without the phone number); reveals, table of contents, counters and "Show all" in `src/resume.js`; print styles at the end of `src/style.css` |
| Résumé PDF (Download button) | `public/resume/James_Rosado_CV.pdf`, printed from the page by `npm run resume-pdf` (`scripts/make_resume_pdf.mjs`, Playwright; once per machine `npx playwright install chromium`). Run it again after editing `resume.html` |
| SpineBuilder page | `spinebuilder.html`; background, explore mode and scroll flights in `src/spinebuilder.js` (camera views in `VIEWS`), the "Try it" builder in `src/idealspine.js`, shared materials and colors in `src/sbmaterials.js`; math typeset with KaTeX |
| SpineBuilder meshes | `public/spinebuilder/mesh/`, made from `data/spinebuilder/*.ugx` (saved from the SpineBuilder app; the cell from `cell_spines_web.ugx.gz`, its ER reduced to a quarter) by `npm run spinebuilder`; the downloadable `.ugx` files go to `public/spinebuilder/downloads/` |
| SpineBuilder screenshots | `public/spinebuilder/img/`, taken by `scripts/spinebuilder_screens.py` (drives the app on a hidden X display; also saves the `.ugx` files) |
| NeuronMesh page | `neuronmesh.html`; background pipeline, frame demo and side-by-side comparison in `src/neuronmesh.js`; data in `public/neuronmesh/`, made from `data/neuronmesh/` by `npm run neuronmesh`; the source meshes (both generators on `0-2a.CNG.swc`, and their crossing triangles from TetGen `-d`) by `scripts/make_neuronmesh_meshes.sh`, which needs `~/projects/neuronmesh` and `~/projects/PythonNeuronMeshes`; figures in `public/neuronmesh/img/` are from their docs |
| NeMo-TMS page | `nemotms.html`; replay, charts, "Aim the field", pulse explorer and calcium diagram in `src/nemotms.js`, styles under "NeMo-TMS page" in `src/style.css`. Data `public/nemotms/` by `npm run nemotms` (`scripts/build_nemotms.py`, numpy only) from `data/nemotms/`, which `scripts/make_nemotms_run.sh` made: it takes the toolbox's sample cell and voltage from the git history of a NeMo-TMS clone and runs its calcium script in UG4, with the ER off and, by `scripts/nemotms_whole_cell.py`, the axon given the same calcium mechanisms as the rest of the cell so the passive calcium shows across it. Voltage after the saved 2.9 ms is an approximate relaxation to rest (`TAIL_TAU_MS`); the color scale's top is `CA_TOP_UM`. Debug: `?ntt=1.2&ntm=ca` holds that time (ms) of voltage (`v`) or calcium (`ca`) |
| TetraNeuron page | `tetraneuron.html` (a teaser: it keeps the method to itself, so only centerlines go on the site, no meshes or settings); the film in `src/tetraneuron.js` (timing in `ACT`, chapter names in `CHAPTERS`), styles under "TetraNeuron page" in `src/style.css`. Data `public/tetraneuron/cell.json` by `npm run tetraneuron` from `data/neuronmesh/0-2a.CNG.swc` and `data/tetraneuron/0-2a_regularized.swc`. Debug: `?tnt=14` holds that second of the film. The recording `public/video/tetraneuron-grow.*` is the 3D view of the app's Grow tab: frames by `scripts/record_tetraneuron.py`, encoded by `scripts/make_tetraneuron_video.sh` |
| SpineBuilder videos | `public/spinebuilder/video/`, cut from `data/spinebuilder/process_spine_tour.mp4` by `scripts/make_spinebuilder_videos.sh`; the step texts under them are in `spinebuilder.html` (`data-from`/`data-to`) |
| Whole-cell page | `wholecell.html` (SpineBuilder's 100 ms ug4 run of the 0-2a cell in `ca_ug4_cell_test`: story cards that set the background's scene, the video, kymographs, why the thick dendrite fails, the model); background, player and kymographs in `src/wholecell.js` (camera, time window and labels per card in `scenes()`), styles under "Whole-cell page" in `src/style.css`. Data `public/wholecell/` by `~/.venvs/website/bin/python scripts/build_wholecell.py`, which reads the run's output in `~/projects/SpineBuilder/ca_ug4_cell_test/output/{vtk,video}` (73 GB, not in this repo); the venv once: `python3 -m venv --system-site-packages ~/.venvs/website && ~/.venvs/website/bin/pip install fast-simplification`. Video `public/video/wholecell-wave.*` by `scripts/make_wholecell_video.sh` from SpineBuilder's `calcium_erjet_slice_..._run100ms.mp4`; its step texts in `wholecell.html` (`data-from`/`data-to` = seconds of the video) |

Users who set "reduce motion" in their OS get a still frame instead of the animation.

Everything the pages need is in this project: `data/` holds the sources (the CA1 graph, the spine meshes, the
SpineBuilder `.ugx` files and screen recording), `public/` what the site serves. Only remaking the SpineBuilder
screenshots needs the SpineBuilder application itself, and remaking the whole-cell page's data and video needs the
simulation's output in the SpineBuilder project.

## Going live later

`npm run build` makes a plain static folder (`dist/`) that any static host can serve
(Netlify, Vercel, Cloudflare Pages, GitHub Pages, or your own server); point the domain at it.

## The fly-through video

`public/video/spine-cell.{webm,mp4}` and the poster were made from the original `Video Project.mp4`:
the axis marker removed, recolored to the site's blues, the silent audio dropped, fades added for the loop.
The ffmpeg commands are in `scripts/make_video.sh`.

## The Neuro-VISOR pages (neurovisor-electrical.html, neurovisor-calcium.html)

Their backgrounds replay real simulations of the CA1 cell, made in four steps (Windows `dotnet.exe` from WSL):

```bash
python3 scripts/build_nv_cell.py                 # public/neurovisor/cell.json: the cell, thinned for the browser
D="/mnt/c/Program Files/dotnet/dotnet.exe"
# electrical: NeuroVISOR-CSharpStudies' SBDF2 Hodgkin-Huxley solver; three touches (tuft tip, basal tip 8599, soma 0)
"$D" build -c Release "$(wslpath -w scripts/hh_harness)\hh_harness.csproj" -o <bin>
"$D" <bin>\hh_harness.dll <graph> <out>\run1 0.03 2e-5 5               # touch: the farthest tip
"$D" <bin>\hh_harness.dll <graph> <out>\run2 0.03 2e-5 5 0.0005 0.001 8599
"$D" <bin>\hh_harness.dll <graph> <out>\run3 0.03 2e-5 5 0.0005 0.001 0 3   # 3 nA into the soma (a clamp there hides its spike)
# calcium: Neuro-VISOR's CalciumModel + SomaLattice from D:\other_branches\Neuro-VISOR-rosado-calcium
"$D" build -c Release "$(wslpath -w scripts/ca_harness)\harness.csproj" -o <bin2>
"$D" <bin2>\harness.dll <graph> <out2> 0.4 0.002 0.02
python3 scripts/pack_nv_frames.py <out> <out2>    # public/neurovisor/hh.* and ca.*
```

The videos are recorded in Unity by the editor scripts `Assets/Editor/ElectricalVideo.cs` (synapseVisualization
branch) and `Assets/Editor/CalciumVideo.cs` (calcium-model branch):
`Unity.exe -projectPath <project> -executeMethod ElectricalVideo.Run -logFile <log>` writes PNG frames to
`C:\Users\JamesRosado\nv_capture\`, then `scripts/make_nv_videos.sh` makes `public/video/nv-*.{mp4,webm}`.
The scripts slow the solver thread so every frame lands on an exact simulated time.

Debug: `?nvt=1:1.6` freezes the background at run 1 (0-based), 1.6 ms.
