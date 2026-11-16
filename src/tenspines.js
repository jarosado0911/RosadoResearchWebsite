// The ten-spine page (tenspines.html): the 100 ms ug4 run of the 0-2a cell with ten spines, every one with a spine
// apparatus joined to the ER and all ten synapses opened at t = 0, replayed from its own output (public/tenspines/,
// made by scripts/build_tenspines.py).
//
// - The background: the whole cell, its plasma membrane glass that glows with cytosolic calcium, its ER inside in the
//   same jet scale by the calcium it stores. The membranes are decimated except in a ball around each spine, where the
//   full-resolution mesh takes over (each mesh discards what the other draws). The story card in the middle of the
//   screen picks the scene; the spine scenes open the membranes along the spine's axis and show the cut through the
//   cytosol and the spine apparatus' lumen.
// - The spine wall: all ten spines in one canvas (a scissor box per tile) on one clock, each turning on its own axis,
//   with its synapse and its spine apparatus over the whole run as two jet ribbons.
// - The race: how much of the spine apparatus, the dendritic ER and the soma ER has released, on the background's clock.
// Calcium comes in frames 1 ms apart, blended with a cubic that never leaves the range of its two neighboring frames.
import * as THREE from 'three';

const BASE = import.meta.env.BASE_URL + 'tenspines/';
const FOV = 32;
const STILL_MS = 3;   // reduced motion: the spine apparatuses half empty, the dendritic ER below them starting
const FEATURE = 'syn8', BRANCHED = 'syn10', RINGING = 'syn3';

const GLSL = /* glsl */ `
// jet without its darkest navy (the video's color map), for the cytosol and the ER alike
vec3 jet(float v) {
  v = 0.1 + 0.9 * clamp(v, 0.0, 1.0);
  return clamp(vec3(1.5 - abs(4.0 * v - 3.0), 1.5 - abs(4.0 * v - 2.0), 1.5 - abs(4.0 * v - 1.0)), 0.0, 1.0);
}`;

// which part of the membranes a mesh draws: uKeep -2 everything outside the spine balls (the decimated mesh), -1
// everything inside them (the full-resolution mesh), k only ball k (a tile of the spine wall). uCutBall/uCutLevel open
// that ball's spine along its cut plane.
const CLIP = /* glsl */ `
uniform vec4 uBalls[10];
uniform float uKeep;
uniform float uCutBall;
uniform float uCutLevel;
varying vec3 vW;
#ifdef FINE
varying float vBall;
varying float vLevel;
#endif
bool inBall(vec3 p, vec4 b) { vec3 d = p - b.xyz; return dot(d, d) < b.w * b.w; }
bool hidden() {
  bool any = false;
  for (int k = 0; k < 10; k++) {
    bool i = inBall(vW, uBalls[k]);
    if (uKeep > -0.5 && abs(float(k) - uKeep) < 0.5) return !i;
    any = any || i;
  }
#ifdef FINE
  if (abs(vBall - uCutBall) < 0.5 && vLevel > uCutLevel) return true;
#endif
  return uKeep < -1.5 ? any : !any;
}`;

const VERT = /* glsl */ `
attribute float val;
varying float vVal;
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
#ifdef FINE
attribute float ball;
attribute float level;
varying float vBall;
varying float vLevel;
#endif
void main() {
  vVal = val;
  vW = position;
#ifdef FINE
  vBall = ball;
  vLevel = level;
#endif
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const ballUniforms = (meta) => ({
  uBalls: { value: meta.spines.map((s) => new THREE.Vector4(...s.ball)) },
  uKeep: { value: -2 }, uCutBall: { value: -1 }, uCutLevel: { value: 1e3 },
});

// the plasma membrane: faint glass with a bright rim that glows in jet where the cytosol holds calcium (uTint 0), or a
// jet-tinted glass shell at every level, as in the close-ups (uTint 1)
const membraneMat = (meta, fine) => new THREE.ShaderMaterial({
  defines: fine ? { FINE: '' } : {},
  uniforms: { ...ballUniforms(meta), uGlass: { value: 1 }, uTint: { value: 0 }, uDim: { value: 1 } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
${GLSL}
${CLIP}
uniform float uGlass;
uniform float uTint;
uniform float uDim;
varying float vVal;
varying vec3 vN;
varying vec3 vV;
void main() {
  if (hidden()) discard;
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float glow = smoothstep(0.1, 0.62, vVal);
  vec3 glass = vec3(0.5, 0.68, 1.0) * (0.03 + 0.34 * rim) * uGlass;
  vec3 bg = glass * (1.0 - 0.5 * glow) + jet(vVal) * glow * (0.22 + 0.7 * rim);
  vec3 shell = jet(vVal) * (0.07 + 0.5 * rim);
  gl_FragColor = vec4(mix(bg, shell, uTint) * uDim, 1.0);
}`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

// the ER membrane (the spine apparatus included): an opaque lit surface in jet
const erMat = (meta, fine) => new THREE.ShaderMaterial({
  defines: fine ? { FINE: '' } : {},
  uniforms: { ...ballUniforms(meta), uDim: { value: 1 } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
${GLSL}
${CLIP}
uniform float uDim;
varying float vVal;
varying vec3 vN;
varying vec3 vV;
void main() {
  if (hidden()) discard;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float l = 0.4 + 0.6 * max(dot(n, normalize(vec3(0.35, 0.8, 0.5))), 0.0);
  float rim = pow(1.0 - abs(dot(n, normalize(vV))), 3.0);
  gl_FragColor = vec4((jet(vVal) * l + 0.1 * rim) * uDim, 1.0);
}`,
  side: THREE.DoubleSide,
});

// the cut through a spine: the calcium inside the cytosol and the ER lumen, unlit
const cutMat = () => new THREE.ShaderMaterial({
  uniforms: { uOpacity: { value: 0 } },
  vertexShader: /* glsl */ `
attribute float val;
varying float vVal;
void main() { vVal = val; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
${GLSL}
uniform float uOpacity;
varying float vVal;
void main() { gl_FragColor = vec4(jet(vVal), uOpacity); }`,
  side: THREE.DoubleSide, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});

// the far view: the SWC skeleton, colored by its ER (full red, emptied blue) and glowing with its cytosol's calcium
const skeletonMat = (points = false) => new THREE.ShaderMaterial({
  uniforms: { uOpacity: { value: 1 }, uSize: { value: 2.6 } },
  vertexShader: /* glsl */ `
uniform float uSize;
attribute float val;
attribute float valE;
varying float vVal;
varying float vValE;
void main() { vVal = val; vValE = valE; gl_PointSize = uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
${GLSL}
uniform float uOpacity;
varying float vVal;
varying float vValE;
void main() {
  ${points ? 'vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.25, 0.08, dot(q, q));' : 'float a = 1.0;'}
  float glow = smoothstep(0.1, 0.62, vVal);
  vec3 c = jet(vValE) * ${points ? '0.32' : '0.62'} + jet(vVal) * glow * ${points ? '0.8' : '0.9'};
  gl_FragColor = vec4(c * uOpacity * a, 1.0);
}`,
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
});

const TYPED = { float32: Float32Array, uint32: Uint32Array, uint16: Uint16Array, uint8: Uint8Array };
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// ---------- data ----------
async function load() {
  const [meta, buf, tr] = await Promise.all([
    fetch(`${BASE}cell.json`).then((r) => r.json()),
    fetch(`${BASE}mesh.bin`).then((r) => r.arrayBuffer()),
    fetch(`${BASE}traces.bin`).then((r) => r.arrayBuffer()),
  ]);
  const get = (name) => { const s = meta.mesh[name]; return new TYPED[s.type](buf, s.offset, s.count); };
  return { meta, get, traces: new Uint8Array(tr), state: { values: null, loaded: 0 } };
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

/** the colors of one view's meshes at a time between frames: patches -> vertices, and the cut vertices */
function makePainter(meta, state) {
  const V = meta.values, S = V.stride;
  const patches = { pm: new Float32Array(V.pm[1]), er: new Float32Array(V.er[1]) };
  const spreads = [], cuts = [];
  let shown = -1;
  // cubic (Catmull-Rom) through the frames around f, kept between the two frames it lies between: smooth, no overshoot
  function sample(dst, off, f, scale) {
    const L = state.loaded, i = Math.floor(f), w = f - i, w2 = w * w, w3 = w2 * w;
    const a0 = Math.max(0, i - 1) * S + off, a1 = i * S + off, a2 = Math.min(L - 1, i + 1) * S + off, a3 = Math.min(L - 1, i + 2) * S + off;
    const v = state.values;
    for (let k = 0; k < dst.length; k++) {
      const p0 = v[a0 + k], p1 = v[a1 + k], p2 = v[a2 + k], p3 = v[a3 + k];
      const x = p1 + 0.5 * w * (p2 - p0) + w2 * (p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3) + w3 * (1.5 * (p1 - p2) + 0.5 * (p3 - p0));
      const lo = p1 < p2 ? p1 : p2, hi = p1 < p2 ? p2 : p1;
      dst[k] = (x < lo ? lo : x > hi ? hi : x) * scale;
    }
  }
  return {
    spread(attr, patch, weight, src) { spreads.push({ attr, patch, weight, src }); },
    cut(attr, off, on) { cuts.push({ attr, off, on }); },
    invalidate() { shown = -1; },
    set(ms) {
      if (!state.loaded) return;
      const f = Math.min(state.loaded - 1, Math.max(0, ms / meta.dtMs));
      if (Math.abs(f - shown) < 1e-4) return;
      shown = f;
      sample(patches.pm, V.pm[0], f, 1 / 255);
      sample(patches.er, V.er[0], f, 1 / 255);
      for (const { attr, patch: p, weight: w, src } of spreads) {
        const val = attr.array, P = patches[src];
        for (let v = 0, k = 0; v < val.length; v++, k += 3) val[v] = w[k] * P[p[k]] + w[k + 1] * P[p[k + 1]] + w[k + 2] * P[p[k + 2]];
        attr.needsUpdate = true;
      }
      for (const c of cuts) {
        if (!c.on()) continue;
        sample(c.attr.array, c.off, f, 1 / 255);
        c.attr.needsUpdate = true;
      }
    },
  };
}

// patch weights are bytes summing to 255
const toWeights = (w8) => { const w = new Float32Array(w8.length); for (let k = 0; k < w8.length; k++) w[k] = w8[k] / 255; return w; };
const weightsOf = (get, name) => toWeights(get(`${name}.weight`));

/** one of the membranes: geometry, and the patches its colors come from */
function membrane(get, name, material, painter, src, fine = false) {
  const g = new THREE.BufferGeometry();
  const pos = get(`${name}.position`);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(get(`${name}.index`), 1));
  const val = new THREE.BufferAttribute(new Float32Array(pos.length / 3), 1);
  g.setAttribute('val', val);
  if (fine) {
    g.setAttribute('ball', new THREE.BufferAttribute(get(`${name}.ball`), 1));
    g.setAttribute('level', new THREE.BufferAttribute(get(`${name}.level`), 1));
  }
  g.computeVertexNormals();
  painter.spread(val, get(`${name}.patch`), weightsOf(get, name), src);
  const m = new THREE.Mesh(g, material);
  m.frustumCulled = false;
  return m;
}

/** the cut through every spine (one mesh per spine over shared vertices), its membrane outlines */
function spineCuts(get, meta, painter, on) {
  const out = meta.spines.map(() => ({}));
  for (const [name, key, off] of [['cutCyt', 'cyt', meta.values.cutCyt[0]], ['cutEr', 'er', meta.values.cutEr[0]]]) {
    const pos = new THREE.BufferAttribute(get(`${name}.position`), 3);
    const val = new THREE.BufferAttribute(new Float32Array(pos.count), 1);
    const idx = get(`${name}.index`), mat = cutMat();
    painter.cut(val, off, on);
    meta.spines.forEach((s, i) => {
      const [, , io, ic] = s.cut[key];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', pos);
      g.setAttribute('val', val);
      g.setIndex(new THREE.BufferAttribute(idx.subarray(io, io + ic), 1));
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 1;
      m.frustumCulled = false;
      out[i][key] = m;
    });
  }
  const lines = (name, color, opacity) => {
    const p = get(name), mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
    mat.userData.max = opacity;
    return meta.spines.map((s) => {
      const [a, b] = s.cut[name];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.subarray(3 * a, 3 * b), 3));
      const l = new THREE.LineSegments(g, mat);
      l.renderOrder = 2;
      l.frustumCulled = false;
      return l;
    });
  };
  const olPm = lines('olPm', 0xf2f6ff, 0.9), olEr = lines('olEr', 0x05070d, 0.8);
  out.forEach((o, i) => { o.olPm = olPm[i]; o.olEr = olEr[i]; o.parts = [o.cyt, o.er, o.olPm, o.olEr]; o.parts.forEach((m) => { m.visible = false; }); });
  // opacity of the whole cut (both faces and outlines share their materials across spines)
  out.setOpacity = (a) => {
    out[0].cyt.material.uniforms.uOpacity.value = out[0].er.material.uniforms.uOpacity.value = a;
    olPm[0].material.opacity = olPm[0].material.userData.max * a;
    olEr[0].material.opacity = olEr[0].material.userData.max * a;
  };
  return out;
}

/** each synapse patch's outline, one line object per spine sharing one material */
function synapseOutlines(get, meta) {
  const p = get('synOutline'), mat = new THREE.LineBasicMaterial({ color: 0xffd48a, transparent: true, opacity: 0.9, depthWrite: false });
  return meta.spines.map((s) => {
    const [a, b] = s.outline;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.subarray(3 * a, 3 * b), 3));
    const l = new THREE.LineSegments(g, mat);
    l.renderOrder = 4;
    l.frustumCulled = false;
    return l;
  });
}

/** one tracer per synapse: calcium at the synapse in uM, at time ms (ug4's measurement every 0.05 ms) */
function synapseCalcium(meta, traces) {
  const { samples, dtMs } = meta.traces;
  const [l0, l1] = meta.cytRangeUM.map(Math.log10);
  return (i, ms) => {
    const x = Math.min(samples - 1, Math.max(0, ms / dtMs)), j = Math.floor(x), w = x - j, j2 = Math.min(samples - 1, j + 1);
    const b = (1 - w) * traces[i * samples + j] + w * traces[i * samples + j2];
    return { byte: b, uM: 10 ** (l0 + (b / 255) * (l1 - l0)) };
  };
}
const saCalcium = (s, ms) => {
  const x = Math.min(s.sa.length - 1, Math.max(0, ms)), j = Math.floor(x), w = x - j;
  return (1 - w) * s.sa[j] + w * s.sa[Math.min(s.sa.length - 1, j + 1)];
};
const fmtUM = (u) => `${u < 1 ? u.toPrecision(2) : u < 100 ? u.toPrecision(3) : Math.round(u)} µM`;

// ---------- the scenes the story cards pick ----------
function scenes(meta) {
  const lo = v3(meta.bounds[0]), hi = v3(meta.bounds[1]);
  const size = new THREE.Box3(lo, hi).getSize(new THREE.Vector3()), center = lo.clone().add(hi).multiplyScalar(0.5);
  const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const S = Object.fromEntries(meta.spines.map((s) => [s.name, s]));
  // a radius r on the part of the screen right of the text (all of it on narrow screens)
  const fit = (r) => () => {
    const aspect = window.innerWidth / window.innerHeight, across = aspect > 1.1 ? 0.5 : 0.9;
    return Math.max(r / (tan * aspect * across), r / (tan * 0.85));
  };
  const wholeDist = () => {
    const aspect = window.innerWidth / window.innerHeight, across = aspect > 1.1 ? 0.5 : 0.9;
    return Math.max((size.x * 0.5) / (tan * aspect * across), (size.y * 0.5) / (tan * 0.85)) + size.z * 0.5;
  };
  const whole = { target: center, dist: wholeDist, el: 0.05, az: 0, sway: 0.2 };
  const group = (list, pad, el, az) => {
    const c = list.reduce((a, s) => a.add(v3(s.syn)), new THREE.Vector3()).divideScalar(list.length);
    const r = Math.max(...list.map((s) => c.distanceTo(v3(s.syn)))) + pad;
    return { target: c, dist: fit(r), el, az, sway: 0.25 };
  };
  // a spine seen across its own plane, its axis up
  const spineView = (s, zoom = 1.1) => {
    const n = v3(s.normal);
    return { target: v3(s.ball), dist: fit(s.ball[3] * zoom), el: Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)), az: Math.atan2(n.x, n.z), sway: 0.22, up: v3(s.up) };
  };
  const tag = (s) => ({ at: v3(s.syn), text: s.name });
  const inside = (s) => [
    { at: v3(s.syn), text: 'synapse' },
    { at: v3(s.saCenter), text: 'spine apparatus' },
    { at: v3(s.foot).addScaledVector(v3(s.up), -0.55), text: 'dendritic ER' },
  ];
  const near = meta.spines.filter((s) => s.distUm < 45), mid = meta.spines.filter((s) => s.distUm >= 45 && s.distUm < 150);
  const soma = { at: new THREE.Vector3(0, meta.soma.radius * 0.9, 0), text: 'soma' };
  const ALL = meta.spines.map(tag);
  return {
    intro: { name: 'Ten spines, 0–100 ms', view: whole, t: [0, 100], rate: 8, labels: [] },
    cell: { name: 'The cell and its ten spines', view: whole, t: [0, 100], rate: 8, labels: [soma, ...ALL] },
    fire: { name: 'All ten synapses open, 0–10 ms', view: group(near, 9, 0.3, -0.3), t: [0, 10], rate: 1.0, tint: 0.35, labels: [soma, ...near.map(tag)] },
    inside: { name: `Inside ${FEATURE}, 0–8 ms`, view: spineView(S[FEATURE]), t: [0, 8], rate: 0.5, tint: 1, spine: true, open: S[FEATURE], labels: inside(S[FEATURE]) },
    branched: { name: `${BRANCHED}, two heads, 0–10 ms`, view: spineView(S[BRANCHED], 1.0), t: [0, 10], rate: 0.6, tint: 1, spine: true, open: S[BRANCHED], labels: inside(S[BRANCHED]) },
    dendrite: { name: 'Into the dendrite, 2–40 ms', view: group(mid, 10, 0.25, 0.2), t: [2, 40], rate: 3, tint: 0.2, labels: mid.map(tag) },
    soma: { name: 'The soma, 8–60 ms', view: { target: new THREE.Vector3(), dist: fit(meta.soma.radius * 1.6), el: 0.3, az: 0.35, sway: 0.4 }, t: [8, 60], rate: 5, labels: [soma] },
    tree: { name: 'Out to the tips, 15–75 ms', view: whole, t: [15, 75], rate: 8, labels: [soma] },
    ring: { name: `${RINGING} keeps ringing, 20–80 ms`, view: spineView(S[RINGING], 1.15), t: [20, 80], rate: 4, tint: 1, spine: true, labels: [{ at: v3(S[RINGING].syn), text: RINGING }] },
    late: { name: 'The whole cell, 70–100 ms', view: whole, t: [70, 100], rate: 6, labels: ALL },
  };
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,240,200,1)'); r.addColorStop(0.25, 'rgba(255,200,110,0.55)'); r.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ---------- the background ----------
function startBackground(canvas, data, { reducedMotion }) {
  const { meta, get, traces, state } = data;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch (e) {
    document.body.classList.add('no-webgl'); return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 6000);
  const painter = makePainter(meta, state);

  const pmMat = membraneMat(meta, false), fpmMat = membraneMat(meta, true), erM = erMat(meta, false), ferM = erMat(meta, true);
  fpmMat.uniforms.uKeep.value = ferM.uniforms.uKeep.value = -1;
  const pm = membrane(get, 'pm', pmMat, painter, 'pm'), er = membrane(get, 'er', erM, painter, 'er');
  const fpm = membrane(get, 'fpm', fpmMat, painter, 'pm', true), fer = membrane(get, 'fer', ferM, painter, 'er', true);
  pm.renderOrder = fpm.renderOrder = 3;
  // the skeleton for the far view
  const skg = new THREE.BufferGeometry();
  skg.setAttribute('position', new THREE.BufferAttribute(get('skel.position'), 3));
  skg.setIndex(new THREE.BufferAttribute(get('skel.index'), 1));
  const skVal = new THREE.BufferAttribute(new Float32Array(skg.attributes.position.count), 1);
  const skValE = new THREE.BufferAttribute(new Float32Array(skg.attributes.position.count), 1);
  skg.setAttribute('val', skVal);
  skg.setAttribute('valE', skValE);
  painter.spread(skVal, get('skel.patch'), weightsOf(get, 'skel'), 'pm');
  painter.spread(skValE, get('skel.erPatch'), toWeights(get('skel.erWeight')), 'er');
  const skLines = new THREE.LineSegments(skg, skeletonMat());
  const skPts = new THREE.Points(skg, skeletonMat(true));
  skPts.material.uniforms.uSize.value = 3 * renderer.getPixelRatio();
  skLines.renderOrder = skPts.renderOrder = 5;
  let cutOn = false;
  const cuts = spineCuts(get, meta, painter, () => cutOn);
  const synLines = synapseOutlines(get, meta);
  // a glow at every synapse that follows the calcium ug4 measured there
  const tex = glowTexture(), synCa = synapseCalcium(meta, traces);
  const halos = meta.spines.map((s) => {
    const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    h.position.copy(v3(s.syn));
    h.renderOrder = 6;
    return h;
  });
  scene.add(er, fer, pm, fpm, skLines, skPts, ...synLines, ...halos, ...cuts.flatMap((c) => c.parts));
  [er, fer, pm, fpm, skLines, skPts].forEach((m) => { m.frustumCulled = false; });

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
  const layer = document.getElementById('ts-labels');
  let tags = [];
  function setLabels(list) {
    layer.replaceChildren();
    tags = list.map(({ at, text }) => {
      const el = document.createElement('span');
      el.className = 'wc-label';
      el.innerHTML = '<i></i><b></b>';
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
  const frozen = params.has('tst') ? Number(params.get('tst')) : null;     // debug: ?tst=2 freezes 2 ms
  const forced = params.get('scene');                                      // debug: ?scene=inside
  const player = { ms: frozen ?? (reducedMotion ? STILL_MS : 0), paused: frozen != null || reducedMotion, hold: 0.8 };
  const playBtn = document.querySelector('.ts-hud .wc-play'), scrub = document.querySelector('.ts-hud .wc-scrub'), timeOut = document.querySelector('.ts-hud .wc-time');
  const showPlay = () => {
    playBtn.textContent = player.paused ? '▶' : '❚❚';
    playBtn.setAttribute('aria-label', player.paused ? 'Play' : 'Pause');
  };
  playBtn.addEventListener('click', () => { player.paused = !player.paused; player.hold = 0; showPlay(); });
  scrub.addEventListener('input', () => { player.ms = +scrub.value; player.paused = true; showPlay(); });
  showPlay();

  let sceneKey = null, cutT = 1, openSpine = null, tint = 0, dim = 1;   // cutT: 1 closed .. 0 open
  const cam = { target: new THREE.Vector3(), logDist: 0, el: 0, az: 0, up: new THREE.Vector3(0, 1, 0), ready: false };
  const clock = new THREE.Clock();
  let clockT = 0, lastText = '', hidden = false;
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
    // the wall covers the screen: no need to draw behind it
    if (document.body.classList.contains('ts-wall-on')) { hidden = true; return; }
    if (hidden) { hidden = false; painter.invalidate(); }

    // a spine scene: the membranes peel back to its plane, then the cut fades in
    const k = cam.ready && !reducedMotion ? 1 - Math.exp(-dt * 1.6) : 1;
    if (sc.open && openSpine !== sc.open) {
      if (openSpine && cutT < 0.98) cutT += (1 - cutT) * k;            // close the previous one first
      else { openSpine = sc.open; cutT = 1; }
    }
    const goalCut = sc.open && openSpine === sc.open ? 0 : 1;
    cutT += (goalCut - cutT) * k;
    if (!sc.open && cutT > 0.98) openSpine = null;
    const i = openSpine ? meta.spines.indexOf(openSpine) : -1;
    fpmMat.uniforms.uCutBall.value = ferM.uniforms.uCutBall.value = i;
    fpmMat.uniforms.uCutLevel.value = ferM.uniforms.uCutLevel.value = openSpine ? cutT * openSpine.ball[3] : 1e3;
    const opacity = THREE.MathUtils.clamp(1 - cutT / 0.25, 0, 1);
    const wasOn = cutOn;
    cutOn = opacity > 0.01;
    if (cutOn && !wasOn) painter.invalidate();                          // fill the cut's colors now
    cuts.forEach((c, j) => c.parts.forEach((m) => { m.visible = cutOn && j === i; }));
    cuts.setOpacity(opacity);
    tint += ((sc.tint ?? 0) - tint) * k;
    pmMat.uniforms.uTint.value = fpmMat.uniforms.uTint.value = tint;
    // a spine scene: the rest of the cell (outside the spine balls) dims, so the spine stands out
    dim += ((sc.spine ? 0.2 : 1) - dim) * k;
    pmMat.uniforms.uDim.value = erM.uniforms.uDim.value = dim;
    painter.set(player.ms);

    // the synapse glows
    halos.forEach((h, j) => {
      const b = synCa(j, player.ms).byte / 255, s = THREE.MathUtils.smoothstep(b, 0.3, 0.85);
      h.material.opacity = s * (0.9 - 0.6 * tint);
      h.scale.setScalar(THREE.MathUtils.clamp(Math.exp(cam.logDist) * 0.05, 0.9, 16) * (0.5 + s));
    });

    // the camera: fly to the scene, sway gently, add the user's turn
    const goal = sc.view;
    const kc = cam.ready && !reducedMotion ? 1 - Math.exp(-dt * 2.0) : 1;
    cam.target.lerp(goal.target, kc);
    cam.logDist += (Math.log(typeof goal.dist === 'function' ? goal.dist() : goal.dist) - cam.logDist) * kc;
    let daz = goal.az - cam.az;
    daz -= Math.round(daz / (2 * Math.PI)) * 2 * Math.PI;              // turn the short way round
    cam.az += daz * kc;
    cam.el += (goal.el - cam.el) * kc;
    cam.up.lerp(goal.up ?? new THREE.Vector3(0, 1, 0), kc).normalize();
    cam.ready = true;
    const sway = reducedMotion || drag ? 0 : goal.sway * Math.sin(clockT * 0.17);
    const d = Math.exp(cam.logDist), az = cam.az + sway + user.az, el = THREE.MathUtils.clamp(cam.el + user.el, -1.45, 1.45);
    camera.up.copy(cam.up);
    camera.position.set(cam.target.x + d * Math.cos(el) * Math.sin(az), cam.target.y + d * Math.sin(el), cam.target.z + d * Math.cos(el) * Math.cos(az));
    camera.near = d * 0.02; camera.far = d * 40 + 2000;
    skLines.material.uniforms.uOpacity.value = skPts.material.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(d, 140, 480);
    synLines[0].material.opacity = 0.9 * (1 - THREE.MathUtils.smoothstep(d, 30, 90));
    camera.lookAt(cam.target);
    const w = window.innerWidth, h = window.innerHeight;
    if (wide) camera.setViewOffset(w, h, -0.2 * w, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    placeLabels();

    // the HUD
    const text = state.loaded < meta.frames
      ? `t = ${player.ms.toFixed(1)} ms · loading ${Math.round((100 * state.loaded) / meta.frames)}%`
      : `t = ${player.ms.toFixed(player.ms < 10 ? 2 : 1)} ms`;
    if (text !== lastText) { timeOut.textContent = text; lastText = text; }
    if (document.activeElement !== scrub) scrub.value = player.ms.toFixed(2);
  });

  return {
    get ms() { return player.ms; },
    seek(ms) { player.ms = ms; player.paused = true; showPlay(); },
  };
}

// ---------- the spine wall: ten close-ups in one canvas ----------
const jetRGB = (v) => {
  v = 0.1 + 0.9 * Math.min(1, Math.max(0, v));
  return [1.5 - Math.abs(4 * v - 3), 1.5 - Math.abs(4 * v - 2), 1.5 - Math.abs(4 * v - 1)].map((x) => Math.round(255 * Math.min(1, Math.max(0, x))));
};

function startWall(root, data, { reducedMotion }) {
  const { meta, get, traces, state } = data;
  const canvas = root.querySelector('.ts-wall-canvas');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (e) {
    root.classList.add('ts-wall-failed'); return;
  }
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 400);
  const painter = makePainter(meta, state);
  const fpmMat = membraneMat(meta, true), ferM = erMat(meta, true);
  fpmMat.uniforms.uTint.value = 1;
  const fpm = membrane(get, 'fpm', fpmMat, painter, 'pm', true), fer = membrane(get, 'fer', ferM, painter, 'er', true);
  fpm.renderOrder = 3;
  let mode = 'surface', cutT = 1;
  const cuts = spineCuts(get, meta, painter, () => cutT < 0.95);
  const synLines = synapseOutlines(get, meta);
  scene.add(fer, fpm, ...synLines, ...cuts.flatMap((c) => c.parts));

  // the tiles, nearest to farthest from the soma
  const synCa = synapseCalcium(meta, traces);
  const grid = root.querySelector('.ts-tiles');
  const tan = Math.tan(THREE.MathUtils.degToRad(15));
  const tiles = meta.order.map((k, n) => {
    const i = meta.spines.findIndex((s) => s.k === k), s = meta.spines[i];
    const fig = document.createElement('figure');
    fig.className = 'ts-tile';
    fig.innerHTML = `<figcaption><b>${s.name}</b><small>${Math.round(s.distUm)} µm from the soma</small></figcaption>
      <div class="ts-view" role="img" aria-label="3D close-up of spine ${s.name}: its membrane colored by the calcium in the cytosol, its spine apparatus by the calcium it stores; drag to turn"></div>
      <dl class="ts-read"><div><dt>synapse</dt><dd data-syn></dd></div><div><dt>spine apparatus</dt><dd data-sa></dd></div></dl>
      <div class="ts-ribbons" aria-hidden="true"><canvas data-row="syn"></canvas><canvas data-row="sa"></canvas><i class="ts-now"></i></div>`;
    grid.appendChild(fig);
    // the ribbons: the whole 100 ms of this synapse (max per 0.5 ms) and this spine apparatus (1 ms frames)
    const [cs, ca] = fig.querySelectorAll('canvas');
    const T = meta.traces.samples, W = 200;
    cs.width = W; cs.height = 1;
    let img = cs.getContext('2d').createImageData(W, 1);
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let j = Math.floor((x * T) / W); j < Math.floor(((x + 1) * T) / W); j++) m = Math.max(m, traces[i * T + j]);
      img.data.set([...jetRGB(m / 255), 255], 4 * x);
    }
    cs.getContext('2d').putImageData(img, 0, 0);
    ca.width = s.sa.length; ca.height = 1;
    img = ca.getContext('2d').createImageData(s.sa.length, 1);
    const [e0, e1] = meta.erRangeUM;
    s.sa.forEach((u, x) => img.data.set([...jetRGB((u - e0) / (e1 - e0)), 255], 4 * x));
    ca.getContext('2d').putImageData(img, 0, 0);
    const view = fig.querySelector('.ts-view');
    const tile = { i, s, fig, view, az: 0, el: 0.12, phase: n * 0.7, dSyn: fig.querySelector('[data-syn]'), dSa: fig.querySelector('[data-sa]'), last: '' };
    // drag turns this spine
    let drag = null;
    view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId); tile.user = true; });
    view.addEventListener('pointermove', (e) => {
      if (!drag) return;
      tile.az -= (e.clientX - drag.x) * 0.012;
      tile.el = THREE.MathUtils.clamp(tile.el + (e.clientY - drag.y) * 0.01, -1.2, 1.2);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    view.addEventListener('pointerup', () => { drag = null; });
    view.addEventListener('dblclick', () => { tile.az = 0; tile.el = 0.12; tile.user = false; });
    return tile;
  });

  // the clock: the first milliseconds, when the spine apparatuses empty, play at a third of the speed
  const held = new URLSearchParams(location.search).get('tsw');           // debug: ?tsw=2 holds the wall at 2 ms
  const clock = { ms: held != null ? +held : reducedMotion ? STILL_MS : 0, paused: held != null || reducedMotion, speed: 2, hold: 0.6 };
  const playBtn = root.querySelector('.wc-play'), scrub = root.querySelector('.wc-scrub'), timeOut = root.querySelector('.wc-time');
  const showPlay = () => { playBtn.textContent = clock.paused ? '▶' : '❚❚'; playBtn.setAttribute('aria-label', clock.paused ? 'Play' : 'Pause'); };
  playBtn.addEventListener('click', () => { clock.paused = !clock.paused; showPlay(); });
  scrub.addEventListener('input', () => { clock.ms = +scrub.value; clock.paused = true; showPlay(); });
  showPlay();
  root.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    clock.speed = +b.dataset.speed;
    root.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('active', x === b));
  }));
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    root.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('active', x === b));
    root.classList.toggle('ts-cut', mode === 'cut');
  }));

  const pos = new THREE.Vector3(), n = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3(), c = new THREE.Vector3();
  const t0 = performance.now();
  let last = t0, lastText = '';
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1), tt = (now - t0) / 1000;
    last = now;
    if (!clock.paused && state.loaded) {
      if (clock.hold > 0) clock.hold -= dt;
      else {
        const slow = clock.ms < 6 ? 1 / 3 : clock.ms < 12 ? 1 / 3 + ((clock.ms - 6) / 6) * (2 / 3) : 1;
        clock.ms += dt * clock.speed * slow;
        const tEnd = (state.loaded - 1) * meta.dtMs;
        if (clock.ms >= tEnd) {
          if (state.loaded < meta.frames) clock.ms = tEnd;
          else { clock.ms = 0; clock.hold = 1.2; }
        }
      }
    }
    cutT += ((mode === 'cut' ? 0 : 1) - cutT) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 2.4));
    cuts.setOpacity(THREE.MathUtils.clamp(1 - cutT / 0.25, 0, 1));
    painter.set(clock.ms);

    // the canvas covers the whole wall; only the tiles' views are drawn
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio, 2, 4000 / Math.max(W, H));
    if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
    const sz = renderer.getSize(new THREE.Vector2());
    if (sz.x !== W || sz.y !== H) renderer.setSize(W, H, false);
    renderer.setScissor(0, 0, W, H);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    const cr = canvas.getBoundingClientRect();
    for (const t of tiles) {
      const r = t.view.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || r.width < 2) continue;
      const x = r.left - cr.left, y = cr.bottom - r.bottom;
      renderer.setViewport(x, y, r.width, r.height);
      renderer.setScissor(x, y, r.width, r.height);
      renderer.setClearColor(0x070b15, 1);
      renderer.clear();
      fpmMat.uniforms.uKeep.value = ferM.uniforms.uKeep.value = t.i;
      fpmMat.uniforms.uCutBall.value = ferM.uniforms.uCutBall.value = cutT < 0.999 ? t.i : -1;
      fpmMat.uniforms.uCutLevel.value = ferM.uniforms.uCutLevel.value = cutT * t.s.ball[3];
      cuts.forEach((cc, j) => cc.parts.forEach((m) => { m.visible = cutT < 0.95 && j === t.i; }));
      synLines.forEach((l, j) => { l.visible = j === t.i; });
      // the camera turns around the spine's axis
      const s = t.s, aspect = r.width / r.height;
      c.fromArray(s.ball); n.fromArray(s.normal); up.fromArray(s.up); right.fromArray(s.right);
      const amp = mode === 'cut' ? 0.32 : 0.85;
      const a = t.az + (reducedMotion || t.user ? 0 : amp * Math.sin(tt * 0.3 + t.phase));
      const d = (s.ball[3] * 0.86) / (tan * Math.min(1, aspect));
      pos.copy(n).multiplyScalar(Math.cos(a)).addScaledVector(right, Math.sin(a)).multiplyScalar(Math.cos(t.el)).addScaledVector(up, Math.sin(t.el));
      camera.position.copy(c).addScaledVector(pos, d);
      camera.up.copy(up);
      camera.aspect = aspect;
      camera.near = d * 0.05; camera.far = d * 10;
      camera.lookAt(c);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      // the readouts
      const text = `${fmtUM(synCa(t.i, clock.ms).uM)}|${fmtUM(saCalcium(s, clock.ms))}`;
      if (text !== t.last) { const [a1, b1] = text.split('|'); t.dSyn.textContent = a1; t.dSa.textContent = b1; t.last = text; }
    }
    root.style.setProperty('--now', (clock.ms / 100).toFixed(4));
    // the wall fills the screen: the background rests, its HUD steps aside
    const wr = root.getBoundingClientRect(), covers = wr.top < window.innerHeight * 0.3 && wr.bottom > window.innerHeight * 0.7;
    if (covers !== document.body.classList.contains('ts-wall-on')) document.body.classList.toggle('ts-wall-on', covers);
    const tx = `t = ${clock.ms.toFixed(clock.ms < 10 ? 2 : 1)} ms`;
    if (tx !== lastText) { timeOut.textContent = tx; lastText = tx; }
    if (document.activeElement !== scrub) scrub.value = clock.ms.toFixed(2);
  }

  // run only while the wall is on screen
  let running = false;
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !running) { running = true; last = performance.now(); painter.invalidate(); renderer.setAnimationLoop(frame); }
    else if (!e.isIntersecting && running) { running = false; renderer.setAnimationLoop(null); document.body.classList.remove('ts-wall-on'); }
  }).observe(root);
}

// ---------- the race: released fractions of the three stores, against the background's clock ----------
const RACE = [
  { key: 'sa', name: 'Spine apparatus', color: '#3987e5' },
  { key: 'dend', name: 'Dendritic ER', color: '#d95926' },
  { key: 'soma', name: 'Soma ER', color: '#199e70' },
];

function startRace(root, meta, bg) {
  const svg = root.querySelector('svg'), tip = root.querySelector('.ts-race-tip');
  const NSV = 'http://www.w3.org/2000/svg';
  const W = 720, H = 300, m = { l: 46, r: 120, t: 14, b: 34 };
  const x = (ms) => m.l + (ms / 100) * (W - m.l - m.r), y = (f) => m.t + (1 - f) * (H - m.t - m.b);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const el = (tag, attrs, parent = svg) => { const e = document.createElementNS(NSV, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent.appendChild(e); return e; };
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(f), y2: y(f), class: 'ts-grid' });
    el('text', { x: m.l - 8, y: y(f) + 4, class: 'ts-tick', 'text-anchor': 'end' }).textContent = `${f * 100}%`;
  }
  for (const t of [0, 20, 40, 60, 80, 100]) el('text', { x: x(t), y: H - m.b + 20, class: 'ts-tick', 'text-anchor': 'middle' }).textContent = `${t}`;
  el('text', { x: W - m.r, y: H - 4, class: 'ts-tick', 'text-anchor': 'end' }).textContent = 'ms';
  const now = el('line', { y1: m.t, y2: H - m.b, class: 'ts-race-now' });
  const series = RACE.map((s) => {
    const f = meta.released[s.key];
    el('path', { d: f.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    return { ...s, f };
  });
  // direct labels at the line ends, nudged apart
  const ends = series.map((s) => ({ s, y: y(s.f[s.f.length - 1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 15);
  ends.forEach(({ s, y: yy }) => { el('text', { x: W - m.r + 8, y: yy + 4, class: 'ts-race-label' }).textContent = s.name; });
  const cross = el('line', { y1: m.t, y2: H - m.b, class: 'ts-race-cross', visibility: 'hidden' });
  const dots = series.map((s) => el('circle', { r: 4.5, fill: s.color, stroke: '#0a0f1b', 'stroke-width': 2, visibility: 'hidden' }));
  const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent', class: 'ts-race-hit' });
  const at = (e) => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    return Math.round(Math.min(100, Math.max(0, ((px - m.l) / (W - m.l - m.r)) * 100)));
  };
  hit.addEventListener('pointermove', (e) => {
    const t = at(e);
    cross.setAttribute('x1', x(t)); cross.setAttribute('x2', x(t)); cross.setAttribute('visibility', 'visible');
    series.forEach((s, i) => { dots[i].setAttribute('cx', x(t)); dots[i].setAttribute('cy', y(s.f[t])); dots[i].setAttribute('visibility', 'visible'); });
    tip.innerHTML = `<b>t = ${t} ms</b>` + series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}<em>${Math.round(s.f[t] * 100)}%</em></span>`).join('');
    const r = svg.getBoundingClientRect();
    tip.style.left = `${Math.min(r.width - 190, ((x(t) / W) * r.width) + 14)}px`;
    tip.classList.add('on');
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); tip.classList.remove('on'); });
  hit.addEventListener('click', (e) => { if (bg) bg.seek(at(e)); });
  // the table view
  const body = root.querySelector('tbody');
  for (const t of [0, 1, 2, 3, 5, 10, 20, 30, 40, 50, 60, 70, 100]) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th>${t} ms</th>` + series.map((s) => `<td>${Math.round(s.f[t] * 100)}%</td>`).join('');
    body.appendChild(tr);
  }
  if (bg) {
    const tick = () => { const xx = x(Math.min(100, bg.ms)); now.setAttribute('x1', xx); now.setAttribute('x2', xx); requestAnimationFrame(tick); };
    tick();
  }
}

export async function startTenSpinesPage(canvas, { reducedMotion = false } = {}) {
  const data = await load();
  streamValues(data.meta, data.state).catch((e) => console.error(e));
  const bg = startBackground(canvas, data, { reducedMotion });
  const near = (el, fn) => {
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '500px 0px' });
    io.observe(el);
  };
  const wall = document.getElementById('ts-wall');
  near(wall, () => { try { startWall(wall, data, { reducedMotion }); } catch (e) { console.error(e); wall.classList.add('ts-wall-failed'); } });
  const race = document.getElementById('ts-race');
  near(race, () => startRace(race, data.meta, bg));
}
