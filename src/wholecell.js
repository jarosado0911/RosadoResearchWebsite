// The whole-cell page (wholecell.html): SpineBuilder's 100 ms ug4 run of the 0-2a cell, replayed from its own output
// (public/wholecell/, made by scripts/build_wholecell.py).
//
// - The background: the plasma membrane as glass glowing with cytosolic calcium, the ER inside it bright while it
//   holds calcium. The story card in the middle of the screen picks the scene (camera, time window, labels); the soma
//   scene opens the membranes and shows the cut through the cytosol and ER lumen, as in the video.
// - The HUD plays, pauses and scrubs the 100 ms. Calcium frames stream in, so playback starts before they all arrive.
// - The kymographs: every primary dendrite, distance against time; point to read, click to send the cell there.
import * as THREE from 'three';
import { renderMath } from './math.js';

const BASE = import.meta.env.BASE_URL + 'wholecell/';
const FOV = 32;
const STILL_MS = 16;   // reduced motion: fronts leaving the soma

const GLSL = /* glsl */ `
vec3 jet(float v) {
  v = clamp(v, 0.0, 1.0);
  return clamp(vec3(1.5 - abs(4.0 * v - 3.0), 1.5 - abs(4.0 * v - 2.0), 1.5 - abs(4.0 * v - 1.0)), 0.0, 1.0);
}
// the ER's calcium: dark when empty, teal, mint green when full
vec3 store(float v) {
  v = clamp(v, 0.0, 1.0);
  vec3 a = vec3(0.10, 0.11, 0.26), b = vec3(0.16, 0.50, 0.78), c = vec3(0.52, 0.98, 0.72);
  return v < 0.5 ? mix(a, b, v * 2.0) : mix(b, c, v * 2.0 - 1.0);
}`;

const VERT = /* glsl */ `
attribute float val;
attribute float cut;
varying float vVal;
varying float vCut;
varying vec3 vN;
varying vec3 vV;
void main() {
  vVal = val;
  vCut = cut;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

// the plasma membrane: faint glass with a bright rim, glowing in the color map where the cytosol holds calcium
const membrane = () => new THREE.ShaderMaterial({
  uniforms: { uCut: { value: 1e3 }, uGlass: { value: 1 } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
${GLSL}
uniform float uCut;
uniform float uGlass;
varying float vVal;
varying float vCut;
varying vec3 vN;
varying vec3 vV;
void main() {
  if (vCut > uCut) discard;
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float glow = smoothstep(0.1, 0.62, vVal);
  vec3 glass = vec3(0.5, 0.68, 1.0) * (0.03 + 0.34 * rim) * uGlass;
  gl_FragColor = vec4(glass * (1.0 - 0.5 * glow) + jet(vVal) * glow * (0.22 + 0.7 * rim), 1.0);
}`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

// the ER membrane: an opaque lit surface in the store's colors
const erSurface = () => new THREE.ShaderMaterial({
  uniforms: { uCut: { value: 1e3 } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
${GLSL}
uniform float uCut;
varying float vVal;
varying float vCut;
varying vec3 vN;
varying vec3 vV;
void main() {
  if (vCut > uCut) discard;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float l = 0.38 + 0.62 * max(dot(n, normalize(vec3(0.35, 0.8, 0.5))), 0.0);
  float rim = pow(1.0 - abs(dot(n, normalize(vV))), 3.0);
  gl_FragColor = vec4(store(vVal) * l + 0.12 * rim, 1.0);
}`,
  side: THREE.DoubleSide,
});

// the cut: the calcium inside the volume, unlit
const cutFace = (map) => new THREE.ShaderMaterial({
  uniforms: { uOpacity: { value: 0 } },
  vertexShader: /* glsl */ `
attribute float val;
varying float vVal;
void main() { vVal = val; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
${GLSL}
uniform float uOpacity;
varying float vVal;
void main() { gl_FragColor = vec4(${map}(vVal), uOpacity); }`,
  side: THREE.DoubleSide, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});

// the far view: the SWC skeleton as lines and round points, which stay visible where the dendrites themselves are
// thinner than a pixel
const skeletonLines = (points = false) => new THREE.ShaderMaterial({
  uniforms: { uOpacity: { value: 1 }, uSize: { value: 2.6 } },
  vertexShader: /* glsl */ `
uniform float uSize;
attribute float val;
varying float vVal;
void main() { vVal = val; gl_PointSize = uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
${GLSL}
uniform float uOpacity;
varying float vVal;
void main() {
  ${points ? 'vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.25, 0.08, dot(q, q));' : 'float a = 1.0;'}
  float glow = smoothstep(0.1, 0.62, vVal);
  vec3 base = vec3(0.35, 0.5, 0.9) * ${points ? '0.22' : '0.4'};
  gl_FragColor = vec4((base * (1.0 - glow) + jet(vVal) * glow * ${points ? '0.9' : '1.25'}) * uOpacity * a, 1.0);
}`,
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
});

const TYPED = { float32: Float32Array, uint32: Uint32Array, uint16: Uint16Array, uint8: Uint8Array };
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// ---------- data ----------
async function load() {
  const [meta, buf] = await Promise.all([
    fetch(`${BASE}cell.json`).then((r) => r.json()),
    fetch(`${BASE}mesh.bin`).then((r) => r.arrayBuffer()),
  ]);
  const get = (name) => { const s = meta.mesh[name]; return new TYPED[s.type](buf, s.offset, s.count); };
  return { meta, get };
}

/** values.bin, frame by frame as it arrives; state.loaded counts the complete frames */
function streamValues(meta, state) {
  const { stride } = meta.values;
  state.values = new Uint8Array(stride * meta.frames);
  state.loaded = 0;
  return fetch(`${BASE}values.bin`).then(async (r) => {
    if (!r.body || !r.body.getReader) {
      state.values.set(new Uint8Array(await r.arrayBuffer()));
      state.loaded = meta.frames;
      return;
    }
    const reader = r.body.getReader();
    let off = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      state.values.set(value.subarray(0, Math.max(0, state.values.length - off)), off);
      off += value.length;
      state.loaded = Math.min(meta.frames, Math.floor(off / stride));
    }
    state.loaded = meta.frames;
  });
}

/** one of the two membranes (or the skeleton's lines): geometry, and the patches (with weights) its colors come from */
function membraneMesh(get, name, material, Kind = THREE.Mesh) {
  const g = new THREE.BufferGeometry();
  const pos = get(`${name}.position`);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(get(`${name}.index`), 1));
  const n = pos.length / 3;
  g.setAttribute('val', new THREE.BufferAttribute(new Float32Array(n), 1));
  if (Kind === THREE.Mesh) {
    g.computeVertexNormals();
    g.setAttribute('cut', new THREE.BufferAttribute(get(`${name}.cut`), 1));
  }
  const w8 = get(`${name}.weight`), w = new Float32Array(w8.length);
  for (let k = 0; k < w8.length; k++) w[k] = w8[k] / (255 * 255);   // value bytes are 0..255 too
  return { mesh: new Kind(g, material), patch: get(`${name}.patch`), weight: w, n };
}

function cutMesh(get, name, map) {
  const g = new THREE.BufferGeometry();
  const pos = get(`${name}.position`);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(get(`${name}.index`), 1));
  g.setAttribute('val', new THREE.BufferAttribute(new Float32Array(pos.length / 3), 1));
  const m = new THREE.Mesh(g, cutFace(map));
  m.renderOrder = 1;
  return m;
}

/** a point on dendrite d, um along its longest path from the soma center */
function along(meta, d, um) {
  const p = meta.dendrites[d].path, k = Math.min(p.length / 3 - 1, Math.max(0, Math.round(um / 2)));
  return new THREE.Vector3(p[3 * k], p[3 * k + 1], p[3 * k + 2]);
}

// ---------- the scenes the story cards pick ----------
function scenes(meta) {
  const lo = v3(meta.bounds[0]), hi = v3(meta.bounds[1]);
  const box = new THREE.Box3(lo, hi), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const syn = v3(meta.syn1), cut = meta.cut, n = v3(cut.normal);
  // the whole cell: its length across the part of the screen right of the text (all of it on narrow screens)
  const wholeDist = () => {
    const aspect = window.innerWidth / window.innerHeight, across = aspect > 1.1 ? 0.5 : 0.9;
    return Math.max((size.x * 0.5) / (tan * aspect * across), (size.y * 0.5) / (tan * 0.85)) + size.z * 0.5;
  };
  const whole = { target: center, dist: wholeDist, el: 0.05, az: 0, sway: 0.2 };
  const dl = (d, um, text) => ({ at: along(meta, d, um), text });
  const DLABELS = [dl(0, 70, 'd0'), dl(1, 80, 'd1'), dl(2, 75, 'd2'), dl(3, 60, 'd3'), dl(4, 70, 'd4'), dl(5, 120, 'd5 · thick apical')];
  return {
    intro: { name: 'The whole cell, 0–100 ms', view: whole, t: [0, 100], rate: 14, labels: [] },
    cell: { name: 'The cell', view: whole, t: [0, 100], rate: 14, labels: [{ at: new THREE.Vector3(), text: 'soma' }, { at: syn, text: 'syn1' }, ...DLABELS] },
    syn: { name: 'syn1 opens, 0–12 ms', view: { target: syn.clone(), dist: 34, el: 0.35, az: -0.25, sway: 0.25 }, t: [0, 12], rate: 1.8, labels: [{ at: syn, text: 'syn1' }, { at: new THREE.Vector3(), text: 'soma' }] },
    soma: { name: 'The soma, 4–24 ms', view: { target: new THREE.Vector3(-2, 0, 0), dist: 40, el: 0.3, az: 0.35, sway: 0.4 }, t: [4, 24], rate: 3, labels: [{ at: new THREE.Vector3(0, 5.6, 0), text: 'soma' }] },
    cut: {
      name: 'Cut through the soma, 6–100 ms',
      view: { target: v3(cut.center).addScaledVector(v3(cut.up), -2.5), dist: (cut.size[1] * 0.72) / tan, el: Math.asin(n.y), az: Math.atan2(n.x, n.z), sway: 0, up: v3(cut.up) },
      t: [6, 100], rate: 9, open: true, labels: [{ at: syn.clone().addScaledVector(n, 0.5), text: 'syn1' }, { at: v3(cut.up).multiplyScalar(1.2), text: 'ER lumen' }, { at: v3(cut.up).multiplyScalar(-4.2).addScaledVector(v3(cut.right), 3.4), text: 'cytosol' }],
    },
    thin: { name: 'Thin dendrites, 8–80 ms', view: { target: along(meta, 3, 35).lerp(along(meta, 0, 35), 0.5), dist: 150, el: 0.15, az: 0.2, sway: 0.3 }, t: [8, 80], rate: 9, labels: [dl(0, 50, 'd0'), dl(1, 50, 'd1'), dl(3, 50, 'd3'), dl(2, 50, 'd2')] },
    thick: { name: 'The thick apical dendrite d5, 6–60 ms', view: { target: along(meta, 5, 15), dist: 54, el: 0.42, az: -0.5, sway: 0.3 }, t: [6, 60], rate: 4, labels: [{ at: along(meta, 5, 27), text: 'front stops, 25–28 µm' }, { at: along(meta, 5, 8), text: 'd5' }, { at: new THREE.Vector3(), text: 'soma' }] },
    late: { name: 'The whole cell, 60–100 ms', view: whole, t: [60, 100], rate: 8, labels: DLABELS },
  };
}

// ---------- the background ----------
async function startBackground(canvas, data, { reducedMotion }) {
  const { meta, get } = data;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch (e) {
    document.body.classList.add('no-webgl'); return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 6000);

  const pm = membraneMesh(get, 'pm', membrane());
  const er = membraneMesh(get, 'er', erSurface());
  const sk = membraneMesh(get, 'skel', skeletonLines(), THREE.LineSegments);
  const skDots = new THREE.BufferGeometry();
  skDots.setAttribute('position', sk.mesh.geometry.attributes.position);
  skDots.setAttribute('val', sk.mesh.geometry.attributes.val);
  const skPts = new THREE.Points(skDots, skeletonLines(true));
  skPts.material.uniforms.uSize.value = 3 * renderer.getPixelRatio();
  pm.mesh.renderOrder = 3;
  sk.mesh.renderOrder = skPts.renderOrder = 5;
  const cutC = cutMesh(get, 'cutCyt', 'jet'), cutE = cutMesh(get, 'cutEr', 'store');
  const outline = (name, color) => {
    const g = new THREE.BufferGeometry();
    const p = get(name).slice(), nrm = v3(meta.cut.normal);
    for (let k = 0; k < p.length; k += 3) { p[k] += nrm.x * 0.03; p[k + 1] += nrm.y * 0.03; p[k + 2] += nrm.z * 0.03; }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 }));
    l.renderOrder = 2;
    return l;
  };
  const olPm = outline('outlinePm', 0xf2f6ff), olEr = outline('outlineEr', 0x05070d);
  const cutParts = [cutC, cutE, olPm, olEr];
  cutParts.forEach((o) => { o.visible = false; });

  // syn1: a bead, and a soft glow while it lets calcium in (the first 10 ms)
  const syn = v3(meta.syn1);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,240,200,1)'); r.addColorStop(0.25, 'rgba(255,200,110,0.55)'); r.addColorStop(1, 'rgba(255,160,60,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  bead.position.copy(syn); halo.position.copy(syn);
  bead.renderOrder = halo.renderOrder = 4;
  scene.add(er.mesh, cutC, cutE, olPm, olEr, pm.mesh, sk.mesh, skPts, bead, halo);
  [er.mesh, pm.mesh, sk.mesh, skPts, cutC, cutE].forEach((m) => { m.frustumCulled = false; });

  // ---- calcium -> colors at time ms (between two 0.5 ms frames) ----
  const state = { values: null, loaded: 0 };
  const loading = streamValues(meta, state).catch((e) => console.error(e));
  const V = meta.values;
  const pmPatch = new Float32Array(V.pm[1]), erPatch = new Float32Array(V.er[1]);
  function patchesAt(dst, off, f) {
    const i = Math.floor(f), w = f - i, a = i * V.stride + off, b = Math.min(i + 1, state.loaded - 1) * V.stride + off;
    const v = state.values;
    for (let k = 0; k < dst.length; k++) dst[k] = (1 - w) * v[a + k] + w * v[b + k];
  }
  function spread(m, patches) {
    const val = m.mesh.geometry.attributes.val.array, p = m.patch, w = m.weight;
    for (let v = 0, k = 0; v < m.n; v++, k += 3) val[v] = w[k] * patches[p[k]] + w[k + 1] * patches[p[k + 1]] + w[k + 2] * patches[p[k + 2]];
    m.mesh.geometry.attributes.val.needsUpdate = true;
  }
  function cutAt(mesh, [off, n], f) {
    const val = mesh.geometry.attributes.val.array;
    const i = Math.floor(f), w = f - i, a = i * V.stride + off, b = Math.min(i + 1, state.loaded - 1) * V.stride + off;
    const v = state.values;
    for (let k = 0; k < n; k++) val[k] = ((1 - w) * v[a + k] + w * v[b + k]) / 255;
    mesh.geometry.attributes.val.needsUpdate = true;
  }
  let shownF = -1;
  function setTime(ms) {
    if (!state.loaded) return;
    const f = Math.min(state.loaded - 1, Math.max(0, ms / meta.dtMs));
    if (Math.abs(f - shownF) < 1e-4) return;
    shownF = f;
    patchesAt(pmPatch, V.pm[0], f); spread(pm, pmPatch); spread(sk, pmPatch);
    patchesAt(erPatch, V.er[0], f); spread(er, erPatch);
    if (cutC.visible) { cutAt(cutC, V.cutCyt, f); cutAt(cutE, V.cutEr, f); }
    const s = ms < 10 ? 1 - ms / 10 : 0;
    bead.material.opacity = 0.5 + 0.5 * s;
    halo.material.opacity = 0.85 * s;
    halo.scale.setScalar(2 + 5 * s);
  }

  // ---- scenes ----
  const SC = scenes(meta);
  const steps = [...document.querySelectorAll('[data-scene]')];
  const story = document.getElementById('story');
  const label = document.getElementById('sb-scene-name');
  function currentScene() {
    const mid = window.innerHeight * 0.5;
    let best = null;
    for (const s of steps) if (s.getBoundingClientRect().top < mid) best = s;
    const r = story.getBoundingClientRect();
    if (!best || r.bottom < mid * 0.6) return 'intro';
    return best.dataset.scene;
  }

  // ---- labels pinned to the cell ----
  const layer = document.getElementById('wc-labels');
  let tags = [];
  function setLabels(list) {
    layer.replaceChildren();
    tags = list.map(({ at, text }) => {
      const el = document.createElement('span');
      el.className = 'wc-label';
      el.innerHTML = `<i></i><b></b>`;
      el.querySelector('b').textContent = text;
      layer.appendChild(el);
      return { at, el };
    });
  }
  const proj = new THREE.Vector3();
  function placeLabels() {
    const w = window.innerWidth, h = window.innerHeight;
    for (const t of tags) {
      proj.copy(t.at).project(camera);
      const on = proj.z < 1 && Math.abs(proj.x) < 1.05 && Math.abs(proj.y) < 1.05;
      t.el.style.opacity = on ? '' : '0';
      if (on) t.el.style.transform = `translate(${((proj.x + 1) / 2) * w}px, ${((1 - proj.y) / 2) * h}px)`;
    }
  }

  // ---- the user's turn (drag where there is no text; events reach the body) ----
  const user = { az: 0, el: 0 };
  const onMesh = (e) => e.target === canvas || e.target === document.body || e.target === document.documentElement;
  let drag = null;
  window.addEventListener('pointerdown', (e) => {
    if (!onMesh(e) || e.pointerType === 'touch') return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY };
    document.body.classList.add('sb-dragging');
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    user.az -= (e.clientX - drag.x) * 0.006;
    user.el = THREE.MathUtils.clamp(user.el + (e.clientY - drag.y) * 0.005, -1.2, 1.2);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const end = () => { drag = null; document.body.classList.remove('sb-dragging'); };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('dblclick', (e) => { if (onMesh(e)) { user.az = 0; user.el = 0; } });

  let wide = true;
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight; wide = camera.aspect > 1.1;
  }
  resize();
  window.addEventListener('resize', resize);

  // ---- the clock and the player ----
  const params = new URLSearchParams(location.search);
  const frozen = params.has('wct') ? Number(params.get('wct')) : null;     // debug: ?wct=16 freezes 16 ms
  const forced = params.get('scene');                                      // debug: ?scene=cut
  const player = { ms: frozen ?? (reducedMotion ? STILL_MS : 0), paused: frozen != null || reducedMotion, hold: 0.8 };
  const playBtn = document.querySelector('.wc-play'), scrub = document.querySelector('.wc-scrub'), timeOut = document.querySelector('.wc-time');
  const showPlay = () => {
    playBtn.textContent = player.paused ? '▶' : '❚❚';
    playBtn.setAttribute('aria-label', player.paused ? 'Play' : 'Pause');
  };
  playBtn.addEventListener('click', () => { player.paused = !player.paused; player.hold = 0; showPlay(); });
  scrub.addEventListener('input', () => { player.ms = +scrub.value; player.paused = true; showPlay(); });
  showPlay();

  let sceneKey = null, cutT = 9;   // the cut level the membranes are peeled to: 9 um (closed) .. 0 (open)
  const cam = { target: new THREE.Vector3(), logDist: 0, el: 0, az: 0, up: new THREE.Vector3(0, 1, 0), ready: false };
  const clock = new THREE.Clock();
  let clockT = 0, lastText = '';
  document.body.classList.add('sb-ready');

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    clockT += dt;
    const key = forced && SC[forced] ? forced : currentScene();
    const sc = SC[key];
    if (key !== sceneKey) {
      sceneKey = key;
      label.textContent = sc.name;
      steps.forEach((el) => el.classList.toggle('active', el.dataset.scene === key));
      setLabels(sc.labels);
      if (!player.paused) { player.ms = sc.t[0]; player.hold = 0.6; }
    }
    // time: loop the scene's window
    if (!player.paused && state.loaded) {
      if (player.hold > 0) player.hold -= dt;
      else {
        player.ms += dt * sc.rate;
        const tEnd = Math.min(sc.t[1], (state.loaded - 1) * meta.dtMs);
        if (player.ms >= tEnd) {
          if (tEnd < sc.t[1]) player.ms = tEnd;                       // still streaming: wait for the frames
          else { player.ms = sc.t[0]; player.hold = 1.0; }
        }
      }
    }
    // the cut: the membranes peel back to the plane, then the cut fades in
    cutT += ((sc.open ? 0 : 9) - cutT) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 1.6));
    const open = cutT < 8.9;
    const opacity = THREE.MathUtils.clamp(1 - cutT / 1.2, 0, 1);
    pm.mesh.material.uniforms.uCut.value = open ? cutT : 1e3;
    er.mesh.material.uniforms.uCut.value = open ? cutT : 1e3;
    const show = opacity > 0.01;
    if (show && !cutC.visible) shownF = -1;                             // fill the cut's colors now
    cutParts.forEach((o) => { o.visible = show; });
    cutC.material.uniforms.uOpacity.value = cutE.material.uniforms.uOpacity.value = opacity;
    olPm.material.opacity = 0.9 * opacity; olEr.material.opacity = 0.75 * opacity;
    pm.mesh.material.uniforms.uGlass.value = 1 - 0.55 * opacity;
    setTime(player.ms);

    // the camera: fly to the scene, sway gently, add the user's turn
    const goal = sc.view;
    const k = cam.ready && !reducedMotion ? 1 - Math.exp(-dt * 2.2) : 1;
    cam.target.lerp(goal.target, k);
    cam.logDist += (Math.log(typeof goal.dist === 'function' ? goal.dist() : goal.dist) - cam.logDist) * k;
    cam.el += (goal.el - cam.el) * k;
    cam.az += (goal.az - cam.az) * k;
    cam.up.lerp(goal.up ?? new THREE.Vector3(0, 1, 0), k).normalize();
    cam.ready = true;
    const sway = reducedMotion || drag ? 0 : goal.sway * Math.sin(clockT * 0.17);
    const d = Math.exp(cam.logDist), az = cam.az + sway + user.az, el = THREE.MathUtils.clamp(cam.el + user.el, -1.45, 1.45);
    camera.up.copy(cam.up);
    camera.position.set(cam.target.x + d * Math.cos(el) * Math.sin(az), cam.target.y + d * Math.sin(el), cam.target.z + d * Math.cos(el) * Math.cos(az));
    camera.near = d * 0.02; camera.far = d * 40 + 2000;
    sk.mesh.material.uniforms.uOpacity.value = skPts.material.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(d, 140, 480);
    camera.lookAt(cam.target);
    const w = window.innerWidth, h = window.innerHeight;
    if (wide) camera.setViewOffset(w, h, -0.2 * w, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    placeLabels();

    // the HUD
    const text = state.loaded < meta.frames
      ? `t = ${player.ms.toFixed(1)} ms · loading ${Math.round((100 * state.loaded) / meta.frames)}%`
      : `t = ${player.ms.toFixed(1)} ms`;
    if (text !== lastText) { timeOut.textContent = text; lastText = text; }
    if (document.activeElement !== scrub) scrub.value = player.ms.toFixed(1);
  });

  return {
    get ms() { return player.ms; },
    seek(ms) { player.ms = ms; player.paused = true; showPlay(); },
    loading,
  };
}

// ---------- the kymographs ----------
const JET = (v) => [1.5 - Math.abs(4 * v - 3), 1.5 - Math.abs(4 * v - 2), 1.5 - Math.abs(4 * v - 1)].map((x) => Math.round(255 * Math.min(1, Math.max(0, x))));
const STORE = (v) => {
  const a = [0.10, 0.11, 0.26], b = [0.16, 0.50, 0.78], c = [0.52, 0.98, 0.72];
  const [p, q, s] = v < 0.5 ? [a, b, v * 2] : [b, c, v * 2 - 1];
  return p.map((x, i) => Math.round(255 * (x + (q[i] - x) * s)));
};
const LUT = (fn) => { const t = new Uint8Array(256 * 3); for (let i = 0; i < 256; i++) t.set(fn(i / 255), 3 * i); return t; };

async function startKymographs(root, meta, bg) {
  const K = meta.kymo;
  const kymo = new Uint8Array(await fetch(`${BASE}kymo.bin`).then((r) => r.arrayBuffer()));
  const luts = [LUT(JET), LUT(JET), LUT(STORE)];
  const [lc0, lc1] = meta.cytRangeUM.map(Math.log10);
  const fmt = [
    (b) => `${(10 ** (lc0 + (b / 255) * (lc1 - lc0))).toPrecision(2)} µM`,
    (b) => `${(10 ** (lc0 + (b / 255) * (lc1 - lc0))).toPrecision(2)} µM`,
    (b) => `${Math.round((b / 255) * meta.erRangeUM[1])} µM`,
  ];
  let field = 0;
  const panels = [...root.querySelectorAll('.wc-kymo')];
  const readout = root.querySelector('.wc-readout');
  panels.forEach((panel) => {
    const d = +panel.dataset.d, len = Math.min(K.bins, Math.floor(meta.dendrites[d].length));
    const cv = panel.querySelector('canvas');
    cv.width = K.frames; cv.height = len;
    panel.style.setProperty('--len', len / K.bins);
    panel._draw = () => {
      const ctx = cv.getContext('2d'), img = ctx.createImageData(K.frames, len), lut = luts[field];
      const base = ((field * K.dendrites + d) * K.frames) * K.bins;
      for (let f = 0; f < K.frames; f++) {
        for (let b = 0; b < len; b++) {
          const v = kymo[base + f * K.bins + b], o = 4 * ((len - 1 - b) * K.frames + f);
          img.data[o] = lut[3 * v]; img.data[o + 1] = lut[3 * v + 1]; img.data[o + 2] = lut[3 * v + 2]; img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };
    panel._draw();
    const at = (e) => {
      const r = cv.getBoundingClientRect();
      const f = Math.min(K.frames - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (K.frames - 1))));
      const b = Math.min(len - 1, Math.max(0, Math.floor((1 - (e.clientY - r.top) / r.height) * len)));
      return { f, b };
    };
    cv.addEventListener('pointermove', (e) => {
      const { f, b } = at(e);
      const v = kymo[((field * K.dendrites + d) * K.frames + f) * K.bins + b];
      readout.textContent = `d${d} · ${b + 0.5} µm from the soma center · t = ${(f * meta.dtMs).toFixed(1)} ms · ${fmt[field](v)}`;
    });
    cv.addEventListener('pointerleave', () => { readout.textContent = readout.dataset.idle; });
    cv.addEventListener('click', (e) => { if (bg) bg.seek(at(e).f * meta.dtMs); });
  });
  root.querySelectorAll('[data-field]').forEach((btn) => btn.addEventListener('click', () => {
    field = +btn.dataset.field;
    root.querySelectorAll('[data-field]').forEach((b) => b.classList.toggle('active', b === btn));
    root.classList.toggle('wc-er', field === 2);
    panels.forEach((p) => p._draw());
  }));
  readout.dataset.idle = readout.textContent;
  // the background's clock as a line on every panel
  if (bg) {
    const tick = () => {
      root.style.setProperty('--now', (bg.ms / 100).toFixed(4));
      requestAnimationFrame(tick);
    };
    tick();
  }
}

export async function startWholeCellPage(canvas, { reducedMotion = false } = {}) {
  renderMath();
  const data = await load();
  const bg = await startBackground(canvas, data, { reducedMotion });
  const k = document.getElementById('wc-kymos');
  if (k) {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); startKymographs(k, data.meta, bg).catch((e) => console.error(e)); }
    }, { rootMargin: '500px 0px' });
    io.observe(k);
  }
}
