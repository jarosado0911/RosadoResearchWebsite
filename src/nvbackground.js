// The background of the two Neuro-VISOR pages: the CA1 cell (public/neurovisor/cell.json) replaying a real
// simulation of it, frame by frame.
//   electrical: three Hodgkin-Huxley runs (hh.bin, scripts/hh_harness), each a 1 ms touch at a different place;
//               the membrane glows with the voltage
//   calcium:    Neuro-VISOR's calcium model with its 3D soma lattice (ca.bin, scripts/ca_harness), a click held for
//               20 ms on the apical trunk; the glass membrane shows cytosolic calcium, the ER tube inside it
//               (at the model's radius ratio) shows ER calcium
// The data are packed by scripts/pack_nv_frames.py.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const BASE = import.meta.env.BASE_URL + 'neurovisor/';
const FOV = 32;
const RING = 10;
const MIN_R = 0.6;             // [um] dendrites drawn at least this thick, to be visible
const ER_RATIO = 0.625;        // the calcium model's ER radius / dendrite radius (CalciumParameters.erRadiusRatio)

// playback (seconds of animation per ms of simulation)
const PLAY = {
  electrical: { msPerSec: 2.4, holdSec: 0.9, stillMs: 3.2 },
  calcium: { msPerSec: 42, holdSec: 1.6, stillMs: 160 },
};

// color maps: v in [0, 1]
const VOLT = /* glsl */ `
vec3 cmap(float v) {          // -80 .. +50 mV: deep blue at rest, cyan, white, amber at the peak
  vec3 c = mix(vec3(0.05, 0.16, 0.42), vec3(0.18, 0.62, 1.0), smoothstep(0.05, 0.35, v));
  c = mix(c, vec3(0.85, 0.95, 1.0), smoothstep(0.35, 0.62, v));
  return mix(c, vec3(1.0, 0.62, 0.18), smoothstep(0.62, 1.0, v));
}`;
const JET = /* glsl */ `
vec3 cmap(float v) {
  v = clamp(v, 0.0, 1.0);
  return clamp(vec3(1.5 - abs(4.0 * v - 3.0), 1.5 - abs(4.0 * v - 2.0), 1.5 - abs(4.0 * v - 1.0)), 0.0, 1.0);
}`;

const VERT = /* glsl */ `
attribute float val;
varying float vVal;
varying vec3 vN;
varying vec3 vV;
void main() {
  vVal = val;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

function voltageMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
${VOLT}
varying float vVal; varying vec3 vN; varying vec3 vV;
void main() {
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  float ndv = max(dot(N, normalize(vV)), 0.0), rim = pow(1.0 - ndv, 2.4);
  float wrap = pow(dot(N, normalize(vec3(0.45, 0.7, 0.55))) * 0.5 + 0.5, 1.5);
  float hot = smoothstep(0.42, 1.0, vVal);
  vec3 c = cmap(vVal);
  vec3 col = c * (0.16 + 0.6 * wrap) + c * rim * 0.9 + c * hot * (0.7 + 0.9 * rim);
  gl_FragColor = vec4(col, 1.0);
}`,
  });
}

// calcium: a faint glass membrane that glows in the color map where the cytosol holds calcium (additive)
function membraneMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
${JET}
varying float vVal; varying vec3 vN; varying vec3 vV;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float glow = smoothstep(0.22, 0.9, vVal);
  vec3 glass = vec3(0.55, 0.72, 1.0) * (0.03 + 0.4 * rim);
  gl_FragColor = vec4(glass * (1.0 - 0.6 * glow) + cmap(vVal) * glow * (0.3 + 0.9 * rim), 1.0);
}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
function erMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
${JET}
varying float vVal; varying vec3 vN; varying vec3 vV;
void main() {
  vec3 N = normalize(vN);
  float d = max(dot(N, normalize(vec3(0.4, 0.8, 0.5))), 0.0) * 0.7 + 0.3;
  gl_FragColor = vec4(cmap(vVal) * d * 0.85, 1.0);
}`,
  });
}

/** tubes along the runs (radius scale k), plus spheres at the given points; every vertex knows its point */
function tubes(cell, rad, k, spheres) {
  const pos = [], nor = [], pt = [], idx = [];
  const P = (i) => new THREE.Vector3(cell.x[i], cell.y[i], cell.z[i]);
  for (const run of cell.runs) {
    const pts = run.map(P);
    const T = pts.map((p, i) => P(run[Math.min(i + 1, run.length - 1)]).sub(P(run[Math.max(i - 1, 0)])).normalize());
    const u = new THREE.Vector3(0, 1, 0);
    if (Math.abs(u.dot(T[0])) > 0.9) u.set(1, 0, 0);
    u.sub(T[0].clone().multiplyScalar(u.dot(T[0]))).normalize();
    const base = pos.length / 3;
    pts.forEach((p, i) => {
      if (i > 0) {   // parallel transport
        u.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i]));
        u.sub(T[i].clone().multiplyScalar(u.dot(T[i]))).normalize();
      }
      const w = new THREE.Vector3().crossVectors(T[i], u);
      const r = rad(run[i]) * k;
      for (let j = 0; j < RING; j++) {
        const a = (j / RING) * Math.PI * 2;
        const nrm = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a));
        pos.push(p.x + nrm.x * r, p.y + nrm.y * r, p.z + nrm.z * r);
        nor.push(nrm.x, nrm.y, nrm.z);
        pt.push(run[i]);
      }
    });
    for (let i = 0; i + 1 < pts.length; i++)
      for (let j = 0; j < RING; j++) {
        const a = base + i * RING + j, b = base + i * RING + ((j + 1) % RING);
        idx.push(a, a + RING, b, b, a + RING, b + RING);
      }
  }
  const sph = new THREE.IcosahedronGeometry(1, 4);
  for (const [i, r] of spheres) {
    const base = pos.length / 3, p = P(i), sp = sph.attributes.position;
    for (let v = 0; v < sp.count; v++) {
      const n = new THREE.Vector3().fromBufferAttribute(sp, v);
      pos.push(p.x + n.x * r * k, p.y + n.y * r * k, p.z + n.z * r * k);
      nor.push(n.x, n.y, n.z);
      pt.push(i);
    }
    for (let v = 0; v < sp.count; v += 3) idx.push(base + v, base + v + 1, base + v + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('val', new THREE.Float32BufferAttribute(new Float32Array(pt.length), 1));
  g.setIndex(idx);
  return { geometry: g, pt: Int32Array.from(pt) };
}

/**
 * Starts the background. onFrame({ label, ms, run }) is called as the playback moves (for the page's caption).
 */
export async function startNeuroVisorBackground(canvas, { mode = 'electrical', reducedMotion = false, still = null, onFrame = () => {} } = {}) {
  // still: { run, ms } draws one frame (the ?nvt=run:ms debug parameter); reduced motion draws a fixed one
  const calcium = mode === 'calcium';
  const [cell, meta, frames] = await Promise.all([
    fetch(`${BASE}cell.json`).then((r) => r.json()),
    fetch(`${BASE}${calcium ? 'ca' : 'hh'}.json`).then((r) => r.json()),
    fetch(`${BASE}${calcium ? 'ca' : 'hh'}.bin`).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
  ]);

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) {
    document.body.classList.add('no-webgl'); return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 5, 8000);

  const n = cell.n;
  const rad = (i) => Math.max(cell.radius[i], MIN_R);
  const soma = [[0, cell.somaRadius]];
  const pivot = new THREE.Group();
  const layers = [];
  if (calcium) {
    const mem = tubes(cell, rad, 1, soma), er = tubes(cell, rad, ER_RATIO, soma);
    const memMesh = new THREE.Mesh(mem.geometry, membraneMaterial());
    memMesh.renderOrder = 1;
    pivot.add(new THREE.Mesh(er.geometry, erMaterial()), memMesh);
    layers.push({ t: mem, off: 0 }, { t: er, off: n });
  } else {
    const mem = tubes(cell, rad, 1, soma);
    pivot.add(new THREE.Mesh(mem.geometry, voltageMaterial()));
    layers.push({ t: mem, off: 0 });
  }

  // the touch: a bead that flashes while the stimulus is on
  const bead = new THREE.Mesh(new THREE.SphereGeometry(3, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  pivot.add(bead, halo);

  const box = new THREE.Box3().setFromBufferAttribute(layers[0].t.geometry.attributes.position);
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  pivot.position.copy(center).negate();
  const model = new THREE.Group();
  model.add(pivot);
  scene.add(model);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), calcium ? 0.55 : 0.6, 0.35, calcium ? 0.5 : 0.62));
  composer.addPass(new OutputPass());

  let wide = true;
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    wide = camera.aspect > 1.1;
  }
  resize();
  window.addEventListener('resize', resize);

  // ---- playback ----
  const runs = calcium ? [{ frames: meta.frames, stimPoint: meta.stimPoint, label: 'Calcium wave', on: meta.holdMs }]
    : meta.runs.map((r) => ({ ...r, on: r.clampMs }));
  const per = calcium ? 2 * n : n;                      // bytes per frame
  const runStart = []; let acc = 0;
  for (const r of runs) { runStart.push(acc); acc += r.frames * per; }
  const point = new Float32Array(per);
  function show(run, ms) {
    const r = runs[run];
    const f = Math.min(r.frames - 1.001, Math.max(0, ms / meta.frameMs));
    const i = Math.floor(f), w = f - i, a = runStart[run] + i * per, b = a + per;
    for (let k = 0; k < per; k++) point[k] = ((1 - w) * frames[a + k] + w * frames[b + k]) / 255;
    for (const { t, off } of layers) {
      const v = t.geometry.attributes.val.array;
      for (let j = 0; j < v.length; j++) v[j] = point[off + t.pt[j]];
      t.geometry.attributes.val.needsUpdate = true;
    }
    const p = r.stimPoint;
    bead.position.set(cell.x[p], cell.y[p], cell.z[p]);
    halo.position.copy(bead.position);
    const on = ms >= r.on[0] && ms < r.on[1];
    const fade = on ? 1 : Math.max(0, 1 - (ms - r.on[1]) / (calcium ? 40 : 1.5));
    bead.material.opacity = ms < r.on[0] ? 0.25 : 0.25 + 0.75 * fade;
    halo.material.opacity = 0.32 * fade;
    halo.scale.setScalar(4 + (calcium ? 10 : 14) * fade);
    onFrame({ label: r.label, ms, run });
  }

  // ---- camera: the whole cell, right of the text on wide screens, turning slowly, following the pointer a little
  const pointer = new THREE.Vector2(), smooth = new THREE.Vector2();
  window.addEventListener('pointermove', (e) => pointer.set(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5));
  function place(dt, spin) {
    smooth.lerp(pointer, 1 - Math.exp(-dt * 2.5));
    if (!drag) model.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin * dt));
    const R = 0.5 * Math.max(size.y, 0.8 * size.x);
    const fit = R / Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * 1.25;
    const side = wide ? -0.56 * fit * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect : 0;   // the cell at ~78% of the width
    camera.position.set(side + smooth.x * 40, -smooth.y * 30 + 0.04 * R, fit);
    camera.lookAt(side, 0, 0);
  }

  // the user's hand: drag where there is no text to turn the cell, double-click to put it back (as the other pages)
  const onBg = (e) => e.target === canvas || e.target === document.body || e.target === document.documentElement;
  let drag = null;
  const home = model.quaternion.clone();
  window.addEventListener('pointerdown', (e) => {
    if (!onBg(e) || e.pointerType === 'touch') return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY };
    document.body.classList.add('sb-dragging');
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const q = new THREE.Quaternion();
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (e.clientX - drag.x) * 0.007);
    model.quaternion.premultiply(q);
    q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (e.clientY - drag.y) * 0.007);
    model.quaternion.premultiply(q);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const end = () => { drag = null; document.body.classList.remove('sb-dragging'); };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('dblclick', (e) => { if (onBg(e)) model.quaternion.copy(home); });

  const { msPerSec, holdSec, stillMs } = PLAY[mode];
  if (reducedMotion || still) {
    const draw = () => { show(still ? still.run : 0, still ? still.ms : stillMs); place(0, 0); composer.render(); };
    draw();
    document.body.classList.add('sb-ready');
    window.addEventListener('resize', draw);
    return { still: true };
  }
  const clock = new THREE.Clock();
  let run = 0, t = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    t += dt;
    const dur = (runs[run].frames - 1) * meta.frameMs / msPerSec;
    if (t > dur + holdSec) { t = 0; run = (run + 1) % runs.length; }
    show(run, Math.min(t, dur) * msPerSec);
    place(dt, 0.05);
    composer.render();
  });
  document.body.classList.add('sb-ready');
  return { still: false };
}
