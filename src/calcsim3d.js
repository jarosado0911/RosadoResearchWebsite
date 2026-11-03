// The CalcSim page's background: the simulated neuron (NMO_150605) in 3D, the plasma membrane as glass colored by
// cytosolic calcium and the ER tube inside it colored by ER calcium, replaying the calcium wave of the page's video
// (public/calcsim/, made by scripts/build_calcsim_cell.py). It floats and turns slowly; drag where there is no text
// to rotate it, shift-drag (or right-drag) to move it, double-click to put it back.
import * as THREE from 'three';

const BASE = import.meta.env.BASE_URL + 'calcsim/';
const FOV = 34;
const RING = 14;                 // vertices around a tube
const DEND_R = 0.9;              // [um] drawn radius of the dendrites (they are 0.125 um, too thin to see)
const ER_RATIO = 15 / 40;        // the model's ER radius / dendrite radius
// playback: sim ms per real second, slow through the wave, faster after
const RATE_SLOW = 36, RATE_FAST = 180, SLOW_UNTIL = 300, HOLD_S = 1.2;
const STILL_MS = 82;             // reduced motion: the moment the wave reaches the soma

const JET = /* glsl */ `
vec3 jet(float v) {
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

// the membrane: faint glass with a bright rim, glowing in the color map where the cytosol holds calcium (additive)
const MEMBRANE = new THREE.ShaderMaterial({
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
${JET}
varying float vVal;
varying vec3 vN;
varying vec3 vV;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float glow = smoothstep(0.35, 1.0, vVal);
  vec3 glass = vec3(0.55, 0.72, 1.0) * (0.035 + 0.42 * rim);
  gl_FragColor = vec4(glass * (1.0 - 0.6 * glow) + jet(vVal) * glow * (0.35 + 0.8 * rim), 1.0);
}`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

// the ER: an opaque lit tube
const ER = new THREE.ShaderMaterial({
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
${JET}
varying float vVal;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 n = normalize(vN);
  float l = 0.35 + 0.65 * max(dot(n, normalize(vec3(0.4, 0.8, 0.6))), 0.0);
  float rim = pow(1.0 - abs(dot(n, normalize(vV))), 3.0);
  gl_FragColor = vec4(jet(vVal) * l + 0.15 * rim, 1.0);
}`,
});

/** Tubes along the cell's unbranched runs (parallel-transported rings), radius rad(node) * scale; spheres where
 *  asked. Every vertex remembers its node, so its color can follow that node's calcium. */
function tubes(cell, rad, scale, spheresAt) {
  const P = (k) => new THREE.Vector3(cell.xyz[3 * k], cell.xyz[3 * k + 1], cell.xyz[3 * k + 2]);
  const pos = [], nor = [], node = [], idx = [];
  for (const run of cell.runs) {
    const pts = run.map(P);
    const T = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      return b.clone().sub(a).normalize();
    });
    let u = new THREE.Vector3(0, 0, 1);
    if (Math.abs(u.dot(T[0])) > 0.9) u.set(1, 0, 0);
    u.sub(T[0].clone().multiplyScalar(u.dot(T[0]))).normalize();
    const base = pos.length / 3;
    pts.forEach((p, i) => {
      if (i > 0) {   // parallel transport: rotate the frame by the turn of the tangent
        const q = new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i]);
        u.applyQuaternion(q);
        u.sub(T[i].clone().multiplyScalar(u.dot(T[i]))).normalize();
      }
      const w = new THREE.Vector3().crossVectors(T[i], u);
      const r = rad(run[i]) * scale;
      for (let j = 0; j < RING; j++) {
        const a = (j / RING) * Math.PI * 2;
        const nrm = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a));
        pos.push(p.x + nrm.x * r, p.y + nrm.y * r, p.z + nrm.z * r);
        nor.push(nrm.x, nrm.y, nrm.z);
        node.push(run[i]);
      }
    });
    for (let i = 0; i + 1 < pts.length; i++) {
      for (let j = 0; j < RING; j++) {
        const a = base + i * RING + j, b = base + i * RING + ((j + 1) % RING), c = a + RING, d = b + RING;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  const sph = new THREE.SphereGeometry(1, RING, Math.round(RING / 2));
  for (const k of spheresAt) {
    const base = pos.length / 3, p = P(k), r = rad(k) * scale;
    const sp = sph.attributes.position, sn = sph.attributes.normal;
    for (let v = 0; v < sp.count; v++) {
      pos.push(p.x + sp.getX(v) * r, p.y + sp.getY(v) * r, p.z + sp.getZ(v) * r);
      nor.push(sn.getX(v), sn.getY(v), sn.getZ(v));
      node.push(k);
    }
    const si = sph.index.array;
    for (let v = 0; v < si.length; v++) idx.push(base + si[v]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('val', new THREE.Float32BufferAttribute(new Float32Array(node.length), 1));
  g.setIndex(idx);
  return { geometry: g, node: Int32Array.from(node) };
}

export async function startCalcSimBackground(canvas, { reducedMotion = false } = {}) {
  const [cell, wave] = await Promise.all([
    fetch(`${BASE}cell.json`).then((r) => r.json()),
    fetch(`${BASE}wave.bin`).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
  ]);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch (e) {
    document.body.classList.add('no-webgl'); return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 4000);

  const n = cell.n, soma = new Set(cell.soma);
  const rad = (k) => (soma.has(k) ? cell.radius[k] : Math.max(cell.radius[k], DEND_R));
  const deg = new Uint8Array(n);
  cell.runs.forEach((r) => { deg[r[0]]++; deg[r[r.length - 1]]++; });
  const joints = [...Array(n).keys()].filter((k) => deg[k] > 1);   // branch points: round the ER's joins
  const somaEnds = cell.soma.filter((k) => deg[k] === 1 || deg[k] > 1);
  const mem = tubes(cell, rad, 1, somaEnds);
  const er = tubes(cell, rad, ER_RATIO, [...new Set([...joints, ...somaEnds])]);

  const model = new THREE.Group();     // floats, turns, follows the user's hand
  const pivot = new THREE.Group();     // the cell centered on its bounding box
  const erMesh = new THREE.Mesh(er.geometry, ER), memMesh = new THREE.Mesh(mem.geometry, MEMBRANE);
  memMesh.renderOrder = 1;
  pivot.add(erMesh, memMesh);
  const box = new THREE.Box3().setFromBufferAttribute(mem.geometry.attributes.position);
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  pivot.position.copy(center).negate();

  // the synapse: a white bead that flashes while it lets calcium in
  const syn = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  syn.position.fromArray(cell.synapse);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.position.copy(syn.position);
  pivot.add(syn, halo);
  model.add(pivot);
  scene.add(model);
  // stand the cell up the way the video draws it: its long axis across the screen
  model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const home = model.quaternion.clone();

  // calcium -> vertex values, interpolated between the 1 ms frames
  const nodeCC = new Float32Array(n), nodeCE = new Float32Array(n);
  function setTime(ms) {
    const f = Math.min(cell.frames - 1.001, Math.max(0, ms / cell.dt_ms));
    const i = Math.floor(f), w = f - i, a = i * 2 * n, b = (i + 1) * 2 * n;
    for (let k = 0; k < n; k++) {
      nodeCC[k] = ((1 - w) * wave[a + k] + w * wave[b + k]) / 255;
      nodeCE[k] = ((1 - w) * wave[a + n + k] + w * wave[b + n + k]) / 255;
    }
    for (const [m, vals] of [[mem, nodeCC], [er, nodeCE]]) {
      const v = m.geometry.attributes.val.array;
      for (let j = 0; j < v.length; j++) v[j] = vals[m.node[j]];
      m.geometry.attributes.val.needsUpdate = true;
    }
    const { t0_ms: t0, duration_ms: dur, period_ms: per } = cell.pulse;
    const tp = (ms - t0) % per, on = ms >= t0 && tp <= dur;
    const s = on ? 1 - tp / dur : 0;            // the ramp-down pulse
    syn.material.opacity = 0.45 + 0.55 * s;
    halo.material.opacity = 0.35 * s;
    halo.scale.setScalar(1.5 + 6 * s);
  }

  // the user's hand (the canvas lies behind the page, so drags where there is no text reach the body)
  const onMesh = (e) => e.target === canvas || e.target === document.body || e.target === document.documentElement;
  const pan = new THREE.Vector3();
  let drag = null;
  window.addEventListener('pointerdown', (e) => {
    if (!onMesh(e) || e.pointerType === 'touch') return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, move: e.shiftKey || e.button === 2 };
    document.body.classList.add('sb-dragging');
  });
  window.addEventListener('contextmenu', (e) => { if (onMesh(e)) e.preventDefault(); });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.move) {     // move in the screen plane, as far as the pointer went
      const k = (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / window.innerHeight;
      pan.x += dx * k; pan.y -= dy * k;
    } else {             // turn about the screen's axes
      const q = new THREE.Quaternion();
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.007);
      model.quaternion.premultiply(q);
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.007);
      model.quaternion.premultiply(q);
    }
  });
  const end = () => { drag = null; document.body.classList.remove('sb-dragging'); };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('dblclick', (e) => {
    if (!onMesh(e)) return;
    pan.set(0, 0, 0);
    model.quaternion.copy(home);
  });

  let wide = true;
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; wide = camera.aspect > 1.1;
    // the whole cell in view, whichever way it is turned
    const R = 0.5 * size.length();
    const fit = Math.max(R / Math.tan(THREE.MathUtils.degToRad(FOV / 2)), R / (Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect));
    camera.position.set(0, 0, fit * (wide ? 1.15 : 1.05));
    camera.lookAt(0, 0, 0);
    if (wide) camera.setViewOffset(w, h, -0.27 * w, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  const label = document.getElementById('cs-time');
  let simMs = reducedMotion ? STILL_MS : 0, hold = HOLD_S, shown = -1, clockT = 0;
  setTime(simMs);
  const clock = new THREE.Clock();
  const yAxis = new THREE.Vector3(0, 1, 0), spinQ = new THREE.Quaternion();
  document.body.classList.add('sb-ready');
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!reducedMotion) {
      clockT += dt;
      if (hold > 0) hold -= dt;
      else {
        simMs += dt * (simMs < SLOW_UNTIL ? RATE_SLOW : RATE_FAST);
        if (simMs >= (cell.frames - 1) * cell.dt_ms) { simMs = 0; hold = HOLD_S; }
      }
      setTime(simMs);
      if (!drag) model.quaternion.premultiply(spinQ.setFromAxisAngle(yAxis, dt * 0.09));
    }
    // floating: a slow drift and bob around where the user put it
    const fx = reducedMotion ? 0 : Math.sin(clockT * 0.31) * size.length() * 0.018;
    const fy = reducedMotion ? 0 : Math.sin(clockT * 0.47 + 1.3) * size.length() * 0.022;
    model.position.set(pan.x + fx, pan.y + fy, 0);
    const ms = Math.round(simMs);
    if (label && ms !== shown) { shown = ms; label.textContent = `t = ${ms} ms`; }
    renderer.render(scene, camera);
  });
}
