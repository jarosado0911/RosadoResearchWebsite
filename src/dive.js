// The page transition: a journey along a real neuron. Clicking a link to another page of the site flies on along
// the CA1 cell, just above the membrane, real spines sweeping past, while a back-propagating spike runs out from the
// soma toward the camera and under it. Near the destination the view dims and blurs, and the next page fades in.
//
// - The journey: one route through the reconstructed cell (public/dive/, made by scripts/build_dive.py), from a thin
//   apical tip down the apical tree and trunk, over the soma and out a basal dendrite, in 4 legs. Each page change
//   flies the next leg, starting where the last one stopped (remembered in localStorage): distal dendrite, branch
//   points, the trunk with the soma ahead, up and over the soma into the basal dendrite; then round again (the first
//   leg dives in from above).
// - Along it: the route's real radii (the soma's sphere included), the sibling branches leaving it, the rest of the
//   cell out of focus, and SpineBuilder's reconstructed Vlachos spines with their synapses (~1.6 per um, fewer on
//   thick stretches, none on the soma; each stretch always carries the same ones).
// - The membrane's texture is a 3D noise height field in the shader (bump mapped through screen-space derivatives),
//   so tubes and spines share one continuous surface; mottled colour, a wet highlight, the site's cyan rim.
// - The new page takes over with the 'dive' view transition (src/pagetransition.js). Browser back and forward
//   keep the slide: nothing can play before those.
// - preload() fetches the data and builds the next leg ahead of time (main.js calls it when the browser is idle).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ---- look and timing (tweak here) ----
const LOOK = {
  background: 0x05070d,
  membrane: 0x2b5d8a,     // the membrane, mottled between these two
  membrane2: 0x4a7ea8,
  rim: 0x58c4f0,          // the edge light, the site's cyan
  spike: 0xff8a1f,        // the action potential, the site's amber
  syn: 0xffa53a,          // the synapse on each spine head (as in the spine gallery)
  bump: 0.9,              // depth of the membrane's texture
  spineDensity: 1.6,      // [per um]
  bloom: { strength: 0.75, radius: 0.45, threshold: 0.55 },
};
// [s] the whole flight; the last fadeOut of it dims and blurs into the next page, down to `faint` (0 clear, 1 dark)
const TIME = { total: 4.0, fadeOut: 1.3, faint: 0.6 };

const BASE = `${import.meta.env.BASE_URL}dive/`;

// ---------- the geometry ----------
function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

/** Parallel-transport frames along a polyline of [x, y, z, r] samples: tangent, normal, binormal per sample */
function frames(pts) {
  const n = pts.length, T = [], N = [], Bn = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.push(new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize());
  }
  const t0 = T[0], helper = Math.abs(t0.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  N.push(new THREE.Vector3().crossVectors(t0, helper).cross(t0).normalize().negate());
  for (let i = 1; i < n; i++) {
    const axis = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
    const nn = N[i - 1].clone();
    const s = axis.length();
    if (s > 1e-6) nn.applyAxisAngle(axis.normalize(), Math.asin(Math.min(1, s)));
    N.push(nn.sub(T[i].clone().multiplyScalar(nn.dot(T[i]))).normalize());
  }
  for (let i = 0; i < n; i++) Bn.push(new THREE.Vector3().crossVectors(T[i], N[i]));
  return { T, N, B: Bn };
}

/** A tube along samples (with their frames); along[i] goes into aAlong (the spike's coordinate) */
function tube(pts, fr, radial, along, out, { taperEnd = true } = {}) {
  const { N, B } = fr;
  const n = pts.length, base = out.pos.length / 3;
  for (let i = 0; i < n; i++) {
    let r = pts[i][3];
    if (taperEnd && i > n - 5) r *= Math.sqrt((n - 1 - i) / 4);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const nx = N[i].x * c + B[i].x * s, ny = N[i].y * c + B[i].y * s, nz = N[i].z * c + B[i].z * s;
      out.pos.push(pts[i][0] + nx * r, pts[i][1] + ny * r, pts[i][2] + nz * r);
      out.nor.push(nx, ny, nz);
      out.along.push(along[i]);
      out.kind.push(0);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = base + i * radial + j, b = base + i * radial + ((j + 1) % radial);
      const c = a + radial, d = b + radial;
      out.idx.push(a, c, b, b, c, d);
    }
  }
}

const slice = (fr, i0, i1) => ({ T: fr.T.slice(i0, i1), N: fr.N.slice(i0, i1), B: fr.B.slice(i0, i1) });

/**
 * Spines along samples i0..i1-1. Each sample decides for itself (a generator seeded by its index), so the same
 * stretch always carries the same spines, whichever flight builds it. Fewer on thick stretches, none on the soma.
 * lane: keeps the camera's side (around the frame's normal) clear, so the spines sweep past on the sides.
 */
function placeSpines(pts, fr, along, shapes, out, { seed, i0 = 0, i1 = pts.length, density, step, lane = 0 }) {
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = Math.max(i0, 4); i < Math.min(i1, pts.length - 6); i++) {
    const rand = rng(seed * 7919 + i * 104729);
    const r = pts[i][3];
    const p = density * step * THREE.MathUtils.clamp((3.5 - r) / 1.5, 0, 1);
    if (rand() > p) continue;
    const shape = shapes[Math.floor(rand() * shapes.length)];
    const ang = lane + rand() * (Math.PI * 2 - 2 * lane), c = Math.cos(ang), s = Math.sin(ang);
    const n = fr.N[i].clone().multiplyScalar(c).add(fr.B[i].clone().multiplyScalar(s));   // outward
    const t = fr.T[i].clone().applyAxisAngle(n, (rand() - 0.5) * 0.8);                     // a little twist
    const b = new THREE.Vector3().crossVectors(n, t);
    const lean = (rand() - 0.5) * 0.5;                                                    // lean along the dendrite
    n.applyAxisAngle(b, lean); t.applyAxisAngle(b, lean);
    const scale = 0.8 + rand() * 0.45;
    m.makeBasis(b, n, t).scale(v.set(scale, scale, scale));
    m.setPosition(pts[i][0] + n.x * (r - 0.12), pts[i][1] + n.y * (r - 0.12), pts[i][2] + n.z * (r - 0.12));
    nm.getNormalMatrix(m);
    const base = out.pos.length / 3;
    for (let k = 0; k < shape.pos.length; k += 3) {
      q.set(shape.pos[k], shape.pos[k + 1], shape.pos[k + 2]).applyMatrix4(m);
      out.pos.push(q.x, q.y, q.z);
      q.set(shape.nor[k], shape.nor[k + 1], shape.nor[k + 2]).applyMatrix3(nm).normalize();
      out.nor.push(q.x, q.y, q.z);
      out.along.push(along[i]);
      out.kind.push(k / 3 >= shape.synStart ? 1 : 0);
    }
    for (let k = 0; k < shape.idx.length; k++) out.idx.push(base + shape.idx[k]);
  }
}

const empty = () => ({ pos: [], nor: [], along: [], kind: [], idx: [] });
function toGeometry(out) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(out.along, 1));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(out.kind, 1));
  g.setIndex(out.idx.length > 65535 ? new THREE.Uint32BufferAttribute(out.idx, 1) : new THREE.Uint16BufferAttribute(out.idx, 1));
  return g;
}

/** The route, its legs, the spine shapes and the background (built once) */
async function load() {
  const [doc, buf] = await Promise.all([
    fetch(`${BASE}dive.json`).then((r) => r.json()),
    fetch(`${BASE}dive.bin`).then((r) => r.arrayBuffer()),
  ]);
  const samples = ({ offset, count }) => {
    const f = new Float32Array(buf, offset, count * 4), out = [];
    for (let i = 0; i < count; i++) out.push([f[4 * i], f[4 * i + 1], f[4 * i + 2], f[4 * i + 3]]);
    return out;
  };
  const shapes = doc.spines.map((s) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, s.positions, s.vertices * 3), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, s.indices, s.triangles * 3), 1));
    g.computeVertexNormals();
    return { pos: g.attributes.position.array, nor: g.attributes.normal.array, idx: g.index.array, synStart: s.synStart };
  });
  const step = doc.step;
  const route = samples(doc.path);
  const routeFrames = frames(route);
  // the spike's coordinate: minus the distance from the soma along the route (it starts at the soma, runs outward)
  const along = route.map((_, i) => -Math.abs(i * step - doc.somaS));
  const near = empty();
  const siblings = [];
  doc.branches.forEach((b, id) => {
    const pts = samples(b);
    if (b.kind === 'sibling') {
      let j = 0, best = 1e9;
      route.forEach((p, i) => {
        const d = (p[0] - pts[0][0]) ** 2 + (p[1] - pts[0][1]) ** 2 + (p[2] - pts[0][2]) ** 2;
        if (d < best) { best = d; j = i; }
      });
      siblings.push({ id, pts, j, fr: frames(pts), along: pts.map((_, i) => along[j] - i * step) });
    } else {
      tube(pts, frames(pts), 10, pts.map(() => -1e4), near);
    }
  });
  return { doc, step, route, routeFrames, along, shapes, siblings, near: toGeometry(near), legs: new Map() };
}

/** The geometry of one flight: its stretch of the route (and what is just ahead), the siblings leaving it, spines */
function legGeometry(a, k) {
  if (a.legs.has(k)) return a.legs.get(k);
  const [s0, s1] = a.doc.legs[k];
  const i0 = Math.max(0, Math.floor((s0 - 12) / a.step)), i1 = Math.min(a.route.length, Math.ceil((s1 + 40) / a.step));
  const detail = empty();
  tube(a.route.slice(i0, i1), slice(a.routeFrames, i0, i1), 48, a.along.slice(i0, i1), detail, { taperEnd: i1 === a.route.length });
  placeSpines(a.route, a.routeFrames, a.along, a.shapes, detail, { seed: 1, i0, i1, density: LOOK.spineDensity, step: a.step, lane: 0.85 });
  for (const sib of a.siblings) {
    if (sib.j < i0 - 40 || sib.j > i1 + 40) continue;
    tube(sib.pts, sib.fr, 28, sib.along, detail);
    placeSpines(sib.pts, sib.fr, sib.along, a.shapes, detail, { seed: 100 + sib.id, density: LOOK.spineDensity * 0.8, step: a.step });
  }
  const leg = { geometry: toGeometry(detail), s0, s1, i0, i1 };
  a.legs.set(k, leg);
  return leg;
}

// which flight comes next: they run in order round the route, remembered across pages (and visits)
const LEG_KEY = 'dive-leg';
function nextLeg(count) {
  try { return ((Number(localStorage.getItem(LEG_KEY)) || 0) % count + count) % count; } catch (e) { return 0; }
}

let assets = null;
/** Fetches the data and builds the next flight's geometry (call it early; dive() waits for it) */
export function preload() {
  assets ??= load().then((a) => { legGeometry(a, nextLeg(a.doc.legs.length)); return a; });
  return assets;
}

// ---------- the membrane ----------
const NOISE = /* glsl */ `
  // 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT)
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

const vertexShader = /* glsl */ `
  attribute float aAlong;
  attribute float aKind;
  varying float vKind;
  varying vec3 vWorld;
  varying vec3 vN;
  varying float vAlong;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vAlong = aAlong;
    vKind = aKind;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uBase, uBase2, uRim, uSpike, uSyn, uFog, uCam;
  varying float vKind;
  uniform float uBump, uFront, uFogDensity, uFade, uDetail;
  varying vec3 vWorld;
  varying vec3 vN;
  varying float vAlong;
  ${NOISE}

  void main() {
    vec3 p = vWorld;
    vec3 N = normalize(vN);
    vec3 V = normalize(uCam - p);
    float dist = length(uCam - p);
    float near = uDetail * clamp(1.5 - dist / 7.0, 0.0, 1.0);   // fine detail only up close (no shimmer far away)

    // the membrane's texture: blobs (~0.3 um), finer grain and pits, as a height field [um]
    float h = 0.0;
    h += 0.030 * snoise(p * 1.7);
    h += 0.010 * snoise(p * 6.0 + 3.1) * near;
    h += 0.003 * snoise(p * 19.0 - 7.0) * near;
    float pits = smoothstep(0.66, 0.92, snoise(p * 4.2 + 11.0));
    h -= 0.008 * pits * near;
    // bump mapping through screen-space derivatives (Mikkelsen's perturbNormalArb)
    vec3 dpdx = dFdx(p), dpdy = dFdy(p);
    float dhdx = dFdx(h), dhdy = dFdy(h);
    vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
    N = normalize(abs(det) * N - uBump * 3.0 * grad);

    // mottled colour, darker in the pits
    float mott = smoothstep(-0.6, 0.8, snoise(p * 0.5 + 5.0));
    vec3 base = mix(uBase, uBase2, mott * 0.5) * (0.96 + 1.1 * h) * (1.0 - 0.12 * pits * near);

    // the synapse on each spine head: the site's amber, faintly lit from within
    base = mix(base, uSyn * (0.75 + 2.0 * h), vKind * 0.85);

    // light: a key from above the camera, a cool fill, a wet highlight, the cyan rim and some translucency
    vec3 L = normalize(V + vec3(0.0, 0.6, 0.0));
    float ndl = dot(N, L);
    float diff = pow(ndl * 0.5 + 0.5, 1.8);
    float ndv = max(dot(N, V), 0.0);
    float fres = pow(1.0 - ndv, 3.0);
    float spec = pow(max(dot(N, normalize(L + V)), 0.0), 60.0);
    float spec2 = pow(max(dot(N, normalize(L + V)), 0.0), 18.0);
    vec3 col = base * (0.1 + 0.72 * diff) + vec3(0.75, 0.88, 1.0) * (spec * 0.35 + spec2 * 0.08) + uRim * fres * 0.5;
    col += base * 0.35 * pow(max(-ndl, 0.0), 2.0);
    col += uSyn * vKind * 0.18;

    // the spike: a bright front running out from the soma (vAlong: minus the distance from it), a tail behind it
    float x = vAlong - uFront;
    float g = x < 0.0 ? exp(-x * x / 4.0) : exp(-x / 6.0);
    float core = exp(-x * x / 0.6);
    col = mix(col, uSpike * (0.35 + 0.55 * fres + 0.35 * diff), clamp(g, 0.0, 1.0) * 0.7);
    col += uSpike * (g * 0.22 + core * 0.4) * (0.35 + fres);

    // depth: fog into the page's background, then the fade to the next page
    col = mix(col, uFog, 1.0 - exp(-uFogDensity * uFogDensity * dist * dist));
    col = mix(col, uFog, uFade);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function membraneMaterial(detail) {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      uBase: { value: new THREE.Color(LOOK.membrane) },
      uBase2: { value: new THREE.Color(LOOK.membrane2) },
      uRim: { value: new THREE.Color(LOOK.rim) },
      uSpike: { value: new THREE.Color(LOOK.spike) },
      uSyn: { value: new THREE.Color(LOOK.syn) },
      uFog: { value: new THREE.Color(LOOK.background) },
      uCam: { value: new THREE.Vector3() },
      uBump: { value: LOOK.bump * detail },
      uDetail: { value: detail },
      uFront: { value: 1e4 },
      uFogDensity: { value: detail ? 0.045 : 0.03 },
      uFade: { value: 0 },
    },
    side: THREE.DoubleSide,
  });
}

/** Specks drifting in the extracellular space around the path */
function dust(path, rand) {
  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = path[Math.floor(rand() * path.length)];
    const r = 1.2 + rand() * 7;
    const a = rand() * Math.PI * 2, b = (rand() - 0.5) * Math.PI;
    pos.set([p[0] + r * Math.cos(a) * Math.cos(b), p[1] + r * Math.sin(b), p[2] + r * Math.sin(a) * Math.cos(b)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d'), grd = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 32, 32);
  return new THREE.Points(g, new THREE.PointsMaterial({
    size: 0.09, map: new THREE.CanvasTexture(c), color: 0x7fb4e6, transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
}

// ---------- the flight ----------
const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);
let active = null;

/** Plays the next flight over the page, then goes to url. Any click or key skips to the end. */
export async function dive(url, { onStart } = {}) {
  if (active) return;
  const go = () => {
    try { sessionStorage.setItem('vt-dive', '1'); } catch (e) { /* private mode: no special reveal */ }
    location.href = url;
  };
  // never hold the visitor hostage: whatever happens, go after a few seconds
  const failsafe = setTimeout(go, (TIME.total + 2.5) * 1000);

  const overlay = document.createElement('div');
  overlay.className = 'dive';
  overlay.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  overlay.appendChild(canvas);
  document.body.appendChild(overlay);
  active = { overlay, renderer: null };

  let a, renderer;
  try {
    a = await preload();
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    clearTimeout(failsafe);
    go();
    return;
  }
  active.renderer = renderer;
  // this flight, and the next one after it (the journey goes on from here on the next page)
  const k = nextLeg(a.doc.legs.length);
  try { localStorage.setItem(LEG_KEY, String((k + 1) % a.doc.legs.length)); } catch (e) { /* stays on this leg */ }
  const leg = legGeometry(a, k);
  const resume = k > 0;        // the first leg dives in from above; the others pick up where the last one stopped

  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(w, h, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LOOK.background);
  const camera = new THREE.PerspectiveCamera(62, w / h, 0.02, 200);
  const mat = membraneMaterial(1), farMat = membraneMaterial(0);
  const specks = dust(a.route.slice(leg.i0, leg.i1), rng(3 + k));
  scene.add(new THREE.Mesh(leg.geometry, mat), new THREE.Mesh(a.near, farMat), specks);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), LOOK.bloom.strength, LOOK.bloom.radius, LOOK.bloom.threshold));
  composer.addPass(new OutputPass());
  composer.setSize(w, h);

  const { route, routeFrames: fr, step, doc } = a;
  const at = (s) => {
    // position, radius and frame on the route at arc length s (between samples)
    const f = THREE.MathUtils.clamp(s / step, 0, route.length - 1.001);
    const i = Math.floor(f), q = f - i;
    const p0 = route[i], p1 = route[i + 1];
    return {
      c: new THREE.Vector3(p0[0] + (p1[0] - p0[0]) * q, p0[1] + (p1[1] - p0[1]) * q, p0[2] + (p1[2] - p0[2]) * q),
      r: p0[3] + (p1[3] - p0[3]) * q,
      up: fr.N[i].clone().lerp(fr.N[i + 1], q).normalize(),
      side: fr.B[i].clone().lerp(fr.B[i + 1], q).normalize(),
    };
  };
  const { s0, s1 } = leg;
  // pacing by how fast it looks, not by distance: the surface streams past at speed / height, so while the camera
  // is still high (the first leg's dive) it covers more ground. A gentle start, a steady cruise, and a long, soft
  // slowdown as it arrives (no rush in the middle or at the end).
  const r0 = at(s0).r;
  const nominalHeight = (u) => {
    const skim = 1.05 + 0.1 * r0;
    return resume ? skim : THREE.MathUtils.lerp(4.5 + r0, skim, smoother(THREE.MathUtils.clamp(u / 0.38, 0, 1)));
  };
  const look = (u) => (0.08 + 0.92 * THREE.MathUtils.smoothstep(u, 0, 0.3)) * (1 - 0.8 * THREE.MathUtils.smoothstep(u, 0.5, 1));
  const N = 240, table = new Float32Array(N + 1);
  for (let i = 1; i <= N; i++) {
    const u = (i - 0.5) / N;
    table[i] = table[i - 1] + look(u) * nominalHeight(u);
  }
  const travel = (u) => {
    const f = THREE.MathUtils.clamp(u, 0, 1) * N, i = Math.min(Math.floor(f), N - 1);
    const c = table[i] + (table[i + 1] - table[i]) * (f - i);
    return s0 + (s1 - s0) * (c / table[N]);
  };
  const somaDist = (s) => Math.abs(s - doc.somaS);
  const meet = somaDist(travel(0.55));    // the spike reaches the camera a little past half way
  const lookAt = new THREE.Vector3();
  let blur = 0;
  function place(t) {
    const u = THREE.MathUtils.clamp(t / TIME.total, 0, 1);
    const s = travel(u);
    const here = at(s), ahead = at(s + 3.2 + here.r);
    const skim = 1.05 + 0.1 * here.r;
    // the first flight dives from a few um away down to the membrane; the others are already skimming it
    const height = resume ? skim : THREE.MathUtils.lerp(4.5 + here.r, skim, smoother(THREE.MathUtils.clamp(u / 0.38, 0, 1)));
    const sway = Math.sin(u * Math.PI * 2) * 0.18;     // zero at both ends, so one flight hands over to the next
    camera.up.copy(here.up).applyAxisAngle(ahead.c.clone().sub(here.c).normalize(), sway * 0.35);
    camera.position.copy(here.c).addScaledVector(here.up, here.r + height).addScaledVector(here.side, sway);
    lookAt.copy(ahead.c).addScaledVector(ahead.up, ahead.r * 0.35 + height * 0.25);
    camera.lookAt(lookAt);
    // the ends: out of the last flight's faint blur, and into a faint blur under the next page (never black)
    const out = THREE.MathUtils.smoothstep(t, TIME.total - TIME.fadeOut, TIME.total);
    const into = resume ? 1 - THREE.MathUtils.smoothstep(t, 0, 0.7) : 0;
    const veil = Math.max(out, into);
    blur = 7 * veil;
    // the spike leaves the soma and runs outward; it meets the camera at about 55% of the flight
    const front = -(meet + (u - 0.55) * 75);
    for (const m of [mat, farMat]) {
      m.uniforms.uCam.value.copy(camera.position);
      m.uniforms.uFront.value = front;
      m.uniforms.uFade.value = TIME.faint * veil;
    }
    specks.material.opacity = 0.5 * (1 - 0.7 * veil);
    canvas.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : '';
  }

  // first frame (compiles the shaders), then fade the overlay in and fly
  place(0);
  composer.render();
  onStart?.();
  overlay.classList.add('on');
  document.documentElement.classList.add('diving');
  let finished = false;
  // where the flight stopped, for the next page's backdrop (src/pagetransition.js blurs it behind the page):
  // a clean frame, small (it is shown blurred), then the veiled frame again for the hand-over
  const keepLocation = () => {
    try {
      const veil = mat.uniforms.uFade.value, dots = specks.material.opacity;
      for (const m of [mat, farMat]) m.uniforms.uFade.value = 0;
      specks.material.opacity = 0.5;
      composer.render();
      const shot = document.createElement('canvas');
      shot.width = 480;
      shot.height = Math.round((480 * h) / w);
      shot.getContext('2d').drawImage(renderer.domElement, 0, 0, shot.width, shot.height);
      sessionStorage.setItem('dive-backdrop', shot.toDataURL('image/jpeg', 0.8));
      for (const m of [mat, farMat]) m.uniforms.uFade.value = veil;
      specks.material.opacity = dots;
      composer.render();
    } catch (e) { /* no storage or no pixels: the next page just has its own background */ }
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(failsafe);
    renderer.setAnimationLoop(null);
    keepLocation();
    go();
  };
  overlay.addEventListener('pointerdown', finish);
  window.addEventListener('keydown', finish, { once: true });
  const start = performance.now();
  renderer.setAnimationLoop(() => {
    const t = (performance.now() - start) / 1000;
    place(t);
    composer.render();
    if (t >= TIME.total) finish();
  });
}

// back from the next page (the back/forward cache restores this one as it was): take the flight down
window.addEventListener('pageshow', (e) => {
  if (!e.persisted || !active) return;
  active.renderer?.dispose();
  active.renderer?.forceContextLoss();
  active.overlay.remove();
  document.documentElement.classList.remove('diving');
  active = null;
});
