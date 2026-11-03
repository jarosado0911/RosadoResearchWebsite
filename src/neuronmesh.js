// The NeuronMesh page (neuronmesh.html). Its data (public/neuronmesh/, from scripts/build_neuronmesh.py) is one
// NeuroMorpho cell, 0-2a.CNG.swc, as both of my generators mesh it.
//
// - The background walks the cell through the pipeline: the SWC, the B-spline skeleton, its rotation-minimizing
//   frames and rings (computed here from the skeleton, as NeuronMesh does), the tubes alone (the
//   PythonNeuronMeshes mesh), then the NeuronMesh surface. The step card in the middle of the screen sets it.
// - "Choose a frame": a tube swept along one curve with the Frenet frame, the rotation method of
//   PythonNeuronMeshes or the double reflection method of NeuronMesh.
// - "Then and now": both meshes side by side, one camera, with their crossing triangles and open edges.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { solidMaterial } from './sbmaterials.js';
import { renderMath } from './math.js';

const BASE = import.meta.env.BASE_URL + 'neuronmesh/';
const FOV = 32;
const COLOR = { python: 0xb4a8ff, neuronmesh: 0x7cc4ff, swc: 0x9aa6bc, skeleton: 0xffa53a, r: 0xff5a4e, s: 0x46e3a0, ring: 0x7cc4ff, clip: 0xff3b30, open: 0xffe14d };
const STAGES = {
  swc: { name: 'The SWC reconstruction', view: 'whole' },
  spline: { name: 'The B-spline skeleton', view: 'whole' },
  frames: { name: 'Rotation-minimizing frames', view: 'branch' },
  rings: { name: 'Rings', view: 'branch' },
  tubes: { name: 'Tubes alone (PythonNeuronMeshes)', view: 'branch' },
  junctions: { name: 'Branch points (NeuronMesh)', view: 'branch' },
  weld: { name: 'The soma weld (NeuronMesh)', view: 'soma' },
  cell: { name: 'One closed surface (NeuronMesh)', view: 'whole' },
};

// ---------- data ----------
async function loadMesh(name) {
  const [doc, buf] = await Promise.all([
    fetch(`${BASE}mesh/${name}.json`).then((r) => r.json()),
    fetch(`${BASE}mesh/${name}.bin`).then((r) => r.arrayBuffer()),
  ]);
  const parts = {};
  for (const p of doc.parts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, p.positions, p.vertices * 3), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, p.indices, p.count), 1));
    if (p.name !== 'open') g.computeVertexNormals();
    parts[p.name] = g;
  }
  return parts;
}

/** The trunks of a tree given by parent indices: runs of points between branch points, tips and the root */
function trunks(parent) {
  const n = parent.length, kids = Array.from({ length: n }, () => []);
  parent.forEach((p, i) => p >= 0 && kids[p].push(i));
  const out = [];
  for (let i = 0; i < n; i++) {
    if (parent[i] >= 0 && kids[parent[i]].length === 1 && parent[parent[i]] >= 0) continue;   // not a trunk start
    if (parent[i] < 0) continue;
    const run = [parent[i], i];
    while (kids[run[run.length - 1]].length === 1) run.push(kids[run[run.length - 1]][0]);
    out.push(run);
  }
  return out;
}

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** Tangents (central differences) and the rotation-minimizing frame by double reflection (Wang et al. 2008) */
function rmf(P) {
  const n = P.length, T = [], R = [];
  for (let i = 0; i < n; i++) T.push(P[Math.min(i + 1, n - 1)].clone().sub(P[Math.max(i - 1, 0)]).normalize());
  const a = Math.abs(T[0].x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  R.push(a.addScaledVector(T[0], -a.dot(T[0])).normalize());
  for (let i = 0; i + 1 < n; i++) {
    const v1 = P[i + 1].clone().sub(P[i]), c1 = v1.dot(v1);
    if (c1 < 1e-12) { R.push(R[i].clone()); continue; }
    const rL = R[i].clone().addScaledVector(v1, (-2 / c1) * v1.dot(R[i]));
    const tL = T[i].clone().addScaledVector(v1, (-2 / c1) * v1.dot(T[i]));
    const v2 = T[i + 1].clone().sub(tL), c2 = v2.dot(v2);
    R.push(c2 < 1e-12 ? rL : rL.addScaledVector(v2, (-2 / c2) * v2.dot(rL)).normalize());
  }
  return { T, R, S: T.map((t, i) => t.clone().cross(R[i])) };
}

function lines(pos, color, opacity = 1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

function solid(geometry, color) {
  const m = new THREE.Mesh(geometry, solidMaterial(color, 0.02));
  m.material.side = THREE.DoubleSide;
  return m;
}

// ---------- the background ----------
async function startBackground(canvas, cell, meshes, { reducedMotion }) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch (e) {
    document.body.classList.add('no-webgl'); return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 5000);

  // the SWC: segments to the parent, and the skeleton (NeuronMesh's B-spline points)
  const swcP = cell.swc.points, skP = cell.skeleton.points;
  const seg = (pts, parent) => parent.flatMap((p, i) => (p < 0 ? [] : [...pts[i].slice(0, 3), ...pts[p].slice(0, 3)]));
  const objects = {
    swc: lines(seg(swcP, cell.swc.parent), COLOR.swc, 0.9),
    skeleton: lines(seg(skP, cell.skeleton.parent), COLOR.skeleton, 1),
  };
  const dots = new THREE.BufferGeometry();
  dots.setAttribute('position', new THREE.Float32BufferAttribute(swcP.flatMap((p) => p.slice(0, 3)), 3));
  objects.swcDots = new THREE.Points(dots, new THREE.PointsMaterial({ color: 0xe9eef7, size: 3, sizeAttenuation: false, transparent: true }));
  const skDots = new THREE.BufferGeometry();
  skDots.setAttribute('position', new THREE.Float32BufferAttribute(skP.flatMap((p) => p.slice(0, 3)), 3));
  objects.skDots = new THREE.Points(skDots, new THREE.PointsMaterial({ color: COLOR.skeleton, size: 3.5, sizeAttenuation: false, transparent: true }));

  // frames and rings along every trunk of the skeleton
  const fr = [], fs = [], ring = [];
  for (const run of trunks(cell.skeleton.parent)) {
    const P = run.map((i) => v3(skP[i])), rad = run.map((i) => skP[i][3]);
    const { R, S } = rmf(P);
    P.forEach((p, k) => {
      const L = Math.max(1.5, 1.8 * rad[k]);
      fr.push(p.x, p.y, p.z, p.x + R[k].x * L, p.y + R[k].y * L, p.z + R[k].z * L);
      fs.push(p.x, p.y, p.z, p.x + S[k].x * L, p.y + S[k].y * L, p.z + S[k].z * L);
      for (let j = 0; j < 12; j++) {
        const a0 = (j / 12) * Math.PI * 2, a1 = ((j + 1) / 12) * Math.PI * 2, q = [];
        for (const a of [a0, a1]) q.push(p.clone().addScaledVector(R[k], rad[k] * Math.cos(a)).addScaledVector(S[k], rad[k] * Math.sin(a)));
        ring.push(q[0].x, q[0].y, q[0].z, q[1].x, q[1].y, q[1].z);
      }
    });
  }
  objects.frameR = lines(fr, COLOR.r);
  objects.frameS = lines(fs, COLOR.s);
  objects.rings = lines(ring, COLOR.ring, 0.9);
  objects.python = solid(meshes.python.surface, COLOR.python);
  objects.neuronmesh = solid(meshes.neuronmesh.surface, COLOR.neuronmesh);
  Object.values(objects).forEach((o) => { o.visible = false; o.frustumCulled = false; scene.add(o); });

  const SHOW = {
    swc: ['swc', 'swcDots'], spline: ['swc', 'skeleton', 'skDots'], frames: ['skeleton', 'frameR', 'frameS'],
    rings: ['skeleton', 'rings'], tubes: ['python'], junctions: ['neuronmesh'], weld: ['neuronmesh'], cell: ['neuronmesh'],
  };

  // views: the whole cell, a branch point (the cleanest one for NeuronMesh among Python's worst), the soma
  const box = new THREE.Box3().setFromPoints(swcP.map((p) => v3(p)));
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const branch = cell.spots.filter((s) => s.kind === 'branch').sort((a, b) => a.neuronmesh.crossing - b.neuronmesh.crossing)[0];
  const VIEW = {
    whole: () => ({ target: center.clone(), dist: (size.y * 0.58) / Math.tan(THREE.MathUtils.degToRad(FOV / 2)), el: 0.08 }),
    branch: () => ({ target: v3(branch.c), dist: 34, el: 0.25 }),
    soma: () => ({ target: v3(cell.soma.c), dist: 95, el: 0.35 }),
  };

  const steps = [...document.querySelectorAll('[data-stage]')];
  const label = document.getElementById('sb-scene-name');
  function currentStage() {
    const mid = window.innerHeight * 0.5;
    let best = null;
    for (const s of steps) {
      const r = s.getBoundingClientRect();
      if (r.top < mid) best = s;
    }
    const pipe = document.getElementById('pipeline').getBoundingClientRect();
    if (pipe.bottom < mid * 0.6) return 'cell';
    return best ? best.dataset.stage : 'swc';
  }

  // the user's turn (drag where there is no text; the canvas lies behind the page, so events reach the body)
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

  let aspect = 1, wide = true;
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    aspect = window.innerWidth / window.innerHeight; camera.aspect = aspect; wide = aspect > 1.1;
  }
  resize();
  window.addEventListener('resize', resize);

  let stage = null, spin = 0;
  const cam = { target: new THREE.Vector3(), logDist: 0, el: 0, ready: false };
  const clock = new THREE.Clock();
  document.body.classList.add('sb-ready');
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const s = currentStage();
    if (s !== stage) {
      stage = s;
      Object.values(objects).forEach((o) => { o.visible = false; });
      SHOW[s].forEach((k) => { objects[k].visible = true; });
      objects.swc.material.opacity = s === 'spline' ? 0.25 : 0.9;
      objects.skeleton.material.opacity = s === 'rings' ? 0.35 : 1;
      steps.forEach((el) => el.classList.toggle('active', el.dataset.stage === s));
      label.textContent = STAGES[s].name;
    }
    if (!reducedMotion && !drag) spin += dt * 0.08;
    const goal = VIEW[STAGES[stage].view]();
    const k = cam.ready ? 1 - Math.exp(-dt * 2.5) : 1;
    cam.target.lerp(goal.target, k);
    cam.logDist += (Math.log(goal.dist) - cam.logDist) * k;
    cam.el += (goal.el - cam.el) * k;
    cam.ready = true;
    const d = Math.exp(cam.logDist), az = spin + user.az, el = THREE.MathUtils.clamp(cam.el + user.el, -1.3, 1.3);
    camera.position.set(cam.target.x + d * Math.cos(el) * Math.sin(az), cam.target.y + d * Math.sin(el), cam.target.z + d * Math.cos(el) * Math.cos(az));
    camera.near = d * 0.02; camera.far = d * 30 + 2000;
    camera.lookAt(cam.target);
    const w = window.innerWidth, h = window.innerHeight;
    if (wide) camera.setViewOffset(w, h, -0.2 * w, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  });
}

// ---------- "Choose a frame" ----------
function startFrames(root, { reducedMotion }) {
  const canvas = root.querySelector('canvas');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (e) { root.classList.add('builder-failed'); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 5, 4);
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x223044, 1.6), sun);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  camera.position.set(0, 4, 17);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, enablePan: false, enableZoom: false, autoRotate: !reducedMotion, autoRotateSpeed: 0.6 });

  const NOTES = {
    frenet: 'The normal follows the curvature. Where the curve bends the other way it has to swing round: the stripe spins and the tube pinches.',
    rotation: 'My 2023 method: rotate the normal by the angle between consecutive tangents. No spin about the curve, one rotation matrix per point.',
    reflection: 'NeuronMesh: two reflections per point give the same rotation-minimizing frame, to fourth order, without trigonometry.',
  };
  let kind = 'reflection', lift = 0.25, group = null;
  const N = 220, SIDES = 16, RAD = 0.32;

  function curve() {
    const P = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      P.push(new THREE.Vector3(10 * t - 5, 1.9 * Math.sin(2 * Math.PI * t), 3.2 * lift * Math.sin(Math.PI * t) * Math.cos(Math.PI * t * 1.5)));
    }
    return P;
  }
  function frames(P) {
    const n = P.length;
    const T = P.map((_, i) => P[Math.min(i + 1, n - 1)].clone().sub(P[Math.max(i - 1, 0)]).normalize());
    if (kind === 'reflection') return rmf(P);
    const R = [];
    if (kind === 'frenet') {
      for (let i = 0; i < n; i++) {
        const dT = T[Math.min(i + 1, n - 1)].clone().sub(T[Math.max(i - 1, 0)]);
        const nrm = dT.addScaledVector(T[i], -dT.dot(T[i]));
        R.push(nrm.lengthSq() > 1e-10 ? nrm.normalize() : (R[i - 1] ? R[i - 1].clone() : new THREE.Vector3(0, 1, 0)));
      }
    } else {
      // the rotation method of PythonNeuronMeshes (get_UVT): v0 = (t_y, -t_x, 0), then rotate by the tangent turn
      R.push(new THREE.Vector3(T[0].y, -T[0].x, 0).normalize());
      for (let i = 0; i + 1 < n; i++) {
        const b = T[i].clone().cross(T[i + 1]);
        if (b.length() < 1e-5) { R.push(R[i].clone()); continue; }
        const phi = Math.acos(THREE.MathUtils.clamp(T[i].dot(T[i + 1]), -1, 1));
        R.push(R[i].clone().applyAxisAngle(b.normalize(), phi));
      }
    }
    return { T, R, S: T.map((t, i) => t.clone().cross(R[i])) };
  }
  /** Roll of the frame about the tangent, against the rotation-minimizing frame: largest step and total, degrees */
  function roll(F, ref) {
    const ang = F.R.map((r, i) => Math.atan2(r.dot(ref.S[i]), r.dot(ref.R[i])));
    let max = 0, total = 0;
    for (let i = 1; i < ang.length; i++) {
      const d = Math.abs(Math.atan2(Math.sin(ang[i] - ang[i - 1]), Math.cos(ang[i] - ang[i - 1])));
      max = Math.max(max, d); total += d;
    }
    return [THREE.MathUtils.radToDeg(max), THREE.MathUtils.radToDeg(total)];
  }

  const out = root.querySelector('.frame-out'), note = root.querySelector('.frame-note');
  function build() {
    if (group) { scene.remove(group); group.traverse((o) => o.geometry && o.geometry.dispose()); }
    group = new THREE.Group();
    const P = curve(), F = frames(P), ref = rmf(P);
    const pos = [], col = [], idx = [];
    const stripe = new THREE.Color(0xffa53a), body = new THREE.Color(0x3d7fd0);
    P.forEach((p, i) => {
      for (let j = 0; j < SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const q = p.clone().addScaledVector(F.R[i], RAD * Math.cos(a)).addScaledVector(F.S[i], RAD * Math.sin(a));
        pos.push(q.x, q.y, q.z);
        const c = j <= 1 ? stripe : body;
        col.push(c.r, c.g, c.b);
      }
    });
    for (let i = 0; i + 1 < N; i++)
      for (let j = 0; j < SIDES; j++) {
        const a = i * SIDES + j, b = i * SIDES + ((j + 1) % SIDES);
        idx.push(a, b, a + SIDES, b, b + SIDES, a + SIDES);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide })));
    const fr = [], fs = [];
    for (let i = 0; i < N; i += 11) {
      const p = P[i], L = 0.85;
      fr.push(p.x, p.y, p.z, ...p.clone().addScaledVector(F.R[i], L).toArray());
      fs.push(p.x, p.y, p.z, ...p.clone().addScaledVector(F.S[i], L).toArray());
    }
    group.add(lines(fr, COLOR.r), lines(fs, COLOR.s));
    scene.add(group);
    const [max, total] = roll(F, ref);
    out.innerHTML = `<div><dt>Largest spin between neighbors</dt><dd>${max.toFixed(1)}°</dd></div>
      <div><dt>Total spin about the curve</dt><dd>${total.toFixed(1)}°</dd></div>`;
    note.textContent = NOTES[kind];
    root.querySelectorAll('[data-frame]').forEach((b) => b.classList.toggle('active', b.dataset.frame === kind));
  }
  root.querySelectorAll('[data-frame]').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.frame; build(); }));
  const slider = root.querySelector('[data-lift]'), sOut = slider.parentElement.querySelector('output');
  const showLift = () => { sOut.textContent = `${Math.round(lift * 100)}%`; };
  slider.addEventListener('input', () => { lift = +slider.value; showLift(); build(); });
  showLift();
  build();

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  renderer.setAnimationLoop(() => { if (visible) { controls.update(); renderer.render(scene, camera); } });
}

// ---------- "Then and now" ----------
function startCompare(root, cell, meshes) {
  const canvas = root.querySelector('canvas');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch (e) { root.classList.add('builder-failed'); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setScissorTest(true);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 5000);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, enableZoom: false, screenSpacePanning: true });

  const sides = {};
  for (const name of ['python', 'neuronmesh']) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(name === 'python' ? 0x0b0d1a : 0x08101c);
    const m = meshes[name];
    const surface = solid(m.surface, COLOR[name]);
    surface.material.polygonOffset = true; surface.material.polygonOffsetFactor = 1; surface.material.polygonOffsetUnits = 1;
    scene.add(surface);
    const extra = {};
    if (m.clip) {
      extra.clip = new THREE.Mesh(m.clip, new THREE.MeshBasicMaterial({ color: COLOR.clip, side: THREE.DoubleSide }));
      scene.add(extra.clip);
    }
    if (m.open) {
      extra.open = new THREE.LineSegments(m.open, new THREE.LineBasicMaterial({ color: COLOR.open }));
      scene.add(extra.open);
    }
    extra.wire = new THREE.LineSegments(new THREE.WireframeGeometry(m.surface), new THREE.LineBasicMaterial({ color: 0x0a1424, transparent: true, opacity: 0.45 }));
    extra.wire.visible = false;
    scene.add(extra.wire);
    sides[name] = { scene, extra };
  }

  // the places to go: the branch points where PythonNeuronMeshes clips most, the soma, the whole cell
  const box = new THREE.Box3().setFromPoints(cell.swc.points.map((p) => v3(p)));
  const whole = { target: box.getCenter(new THREE.Vector3()), dist: box.getSize(new THREE.Vector3()).y * 1.05 };
  const places = [];
  cell.spots.forEach((s) => {
    const n = places.filter((p) => p.spot && p.spot.kind === s.kind).length + 1;
    places.push({ label: s.kind === 'soma' ? 'The soma' : `Branch point ${n}`, spot: s, target: v3(s.c), dist: s.kind === 'soma' ? 70 : 24 });
  });
  places.push({ label: 'Whole cell', ...whole });
  const bar = root.querySelector('.compare-spots');
  const count = { python: root.querySelector('#count-python'), neuronmesh: root.querySelector('#count-neuronmesh') };
  let fly = null;
  function go(k) {
    const p = places[k];
    const dir = camera.position.clone().sub(controls.target).normalize();
    fly = { t: 0, from: [controls.target.clone(), camera.position.clone()], to: [p.target.clone(), p.target.clone().addScaledVector(dir, p.dist)] };
    bar.querySelectorAll('button').forEach((b, j) => b.classList.toggle('active', j === k));
    for (const name of ['python', 'neuronmesh']) {
      if (!p.spot) { const st = cell.stats[name]; count[name].textContent = `${st.crossingTriangles} crossing triangles · ${st.openEdges} open edges · ${st.pieces} piece${st.pieces > 1 ? 's' : ''}`; continue; }
      const c = p.spot[name];
      count[name].textContent = `within ${Math.round(p.spot.radius)} µm: ${c.crossing} crossing triangles · ${c.open} open edges`;
    }
  }
  places.forEach((p, k) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = p.label;
    b.addEventListener('click', () => go(k));
    bar.appendChild(b);
  });
  root.querySelectorAll('[data-show]').forEach((box) => box.addEventListener('change', () => {
    for (const s of Object.values(sides)) if (s.extra[box.dataset.show]) s.extra[box.dataset.show].visible = box.checked;
  }));
  // zoom with buttons (the page scrolls with the wheel)
  const zoomBy = (f) => { camera.position.sub(controls.target).multiplyScalar(f).add(controls.target); };
  root.querySelector('[data-zoom="in"]').addEventListener('click', () => zoomBy(0.8));
  root.querySelector('[data-zoom="out"]').addEventListener('click', () => zoomBy(1.25));

  camera.position.set(0, 0, 1);
  controls.target.copy(places[0].target);
  camera.position.copy(places[0].target).add(new THREE.Vector3(0.55, 0.35, 1).normalize().multiplyScalar(places[0].dist));
  go(0);
  fly = null;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = (w / 2) / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!visible) return;
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / 1.1);
      const f = THREE.MathUtils.smootherstep(fly.t, 0, 1);
      controls.target.lerpVectors(fly.from[0], fly.to[0], f);
      camera.position.lerpVectors(fly.from[1], fly.to[1], f);
      if (fly.t >= 1) fly = null;
    }
    controls.update();
    const d = camera.position.distanceTo(controls.target);
    camera.near = d * 0.01; camera.far = d * 20 + 2000; camera.updateProjectionMatrix();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ['python', 'neuronmesh'].forEach((name, k) => {
      const x = k === 0 ? 0 : Math.ceil(w / 2) + 1;
      renderer.setViewport(x, 0, Math.floor(w / 2), h);
      renderer.setScissor(x, 0, Math.floor(w / 2), h);
      renderer.render(sides[name].scene, camera);
    });
  });
}

function fillStats(cell) {
  const rows = [
    ['Triangles', 'triangles'], ['Separate pieces', 'pieces'], ['Open edges', 'openEdges'],
    ['Edges in more than two triangles', 'nonManifoldEdges'], ['Crossing triangle pairs', 'crossingPairs'],
    ['Triangles that cross another', 'crossingTriangles'], ['Euler characteristic', 'euler'],
  ];
  const fmt = (n) => n.toLocaleString('en-US');
  document.getElementById('stats-body').innerHTML = rows.map(([label, key]) =>
    `<tr><th>${label}</th><td>${fmt(cell.stats.python[key])}</td><td>${fmt(cell.stats.neuronmesh[key])}</td></tr>`).join('') +
    '<tr><th>Closed surface</th><td>no</td><td>yes</td></tr><tr><th>Time for the cell</th><td>0.9 s</td><td>0.3 s</td></tr>';
}

export async function startNeuronMeshPage(canvas, { reducedMotion = false } = {}) {
  renderMath();
  const [cell, python, neuronmesh] = await Promise.all([
    fetch(`${BASE}cell.json`).then((r) => r.json()), loadMesh('python'), loadMesh('neuronmesh'),
  ]);
  const meshes = { python, neuronmesh };
  fillStats(cell);
  startBackground(canvas, cell, meshes, { reducedMotion });
  const lazy = (el, start) => {
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '400px 0px' });
    io.observe(el);
  };
  lazy(document.getElementById('frames-demo'), () => startFrames(document.getElementById('frames-demo'), { reducedMotion }));
  lazy(document.getElementById('compare-view'), () => startCompare(document.getElementById('compare-view'), cell, meshes));
}
