// "What moves the calcium" (spines page): the components of the calcium model in 3D, after the model's schematic.
// A cell (cytosol inside its plasma membrane) with the ER inside it; IP3R and RyR release Ca2+ from the ER, SERCA
// pumps it back; PMCA and NCX clear it from the cell, VDCC lets it in; a synapse adds Ca2+ and IP3. Ca2+, IP3 and
// the buffer calbindin drift through the cytosol, and Ca2+ streams through every channel and pump in its direction.
// Drag to turn; pointing at a part names it (raycasting); "Show labels" names them all.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const CELL = { x: 3.8, y: 2.3, z: 1.5 };          // half extents of the cell
const ER = { y: -0.25, r: 0.95, half: 1.75 };      // the ER: a capsule along x
const COLOR = {
  membrane: 0x7f8de8, er: 0x7fe0a0, ca: 0xff5a4a, ip3: 0xc8ceff, calb: 0x3fcf6f, synapse: 0xe86aa6,
  ip3r: 0xe08a3c, ryr: 0xb455c8, serca: 0xe8de5a, pmca: 0xe8de5a, ncx: 0xf0a030, vdcc: 0x5f86ff,
};

// what each part is (the hover text)
const INFO = {
  cytosol: ['Cytosol', 'The fluid inside the cell. At rest its free Ca²⁺ is only about 50–100 nM, so small fluxes make big signals.'],
  er: ['Endoplasmic reticulum (ER)', 'The cell\'s internal calcium store, at hundreds of µM. It reaches into many spines as the spine apparatus.'],
  ip3r: ['IP3 receptor (IP3R)', 'A Ca²⁺ release channel in the ER membrane, opened by IP3 together with Ca²⁺.'],
  ryr: ['Ryanodine receptor (RyR)', 'A Ca²⁺ release channel in the ER membrane, opened by Ca²⁺ itself: calcium-induced calcium release.'],
  serca: ['SERCA pump', 'Sarco/endoplasmic reticulum Ca²⁺-ATPase: uses ATP to pump Ca²⁺ from the cytosol back into the ER.'],
  pmca: ['PMCA pump', 'Plasma membrane Ca²⁺-ATPase: uses ATP to pump Ca²⁺ out of the cell.'],
  ncx: ['Na⁺/Ca²⁺ exchanger (NCX)', 'Removes one Ca²⁺ from the cell for every three Na⁺ it lets in.'],
  vdcc: ['Voltage-dependent Ca²⁺ channel (VDCC)', 'Opens when the membrane depolarizes and lets Ca²⁺ flow into the cell.'],
  synapse: ['Synapse', 'Synaptic input: Ca²⁺ enters (for example through NMDA receptors) and IP3 is made (through metabotropic glutamate receptors).'],
  ca: ['Calcium ion (Ca²⁺)', 'The signal itself. Free ions diffuse through the cytosol until they are buffered, pumped out or stored.'],
  ip3: ['IP3 (inositol trisphosphate)', 'A messenger made at the synapse that diffuses to the ER and opens IP3 receptors.'],
  calb: ['Calbindin (CalB)', 'A mobile buffer protein that binds Ca²⁺ (up to four ions), slowing and shaping the signal.'],
  membrane: ['Plasma membrane', 'The cell\'s outer membrane, with the pumps and channels that exchange Ca²⁺ with the outside.'],
};

const rand = (() => { let s = 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
const insideER = (p, pad = 0) => {
  const dx = Math.max(0, Math.abs(p.x) - ER.half);
  return Math.hypot(dx, p.y - ER.y, p.z) < ER.r + pad;
};
const insideCell = (p, pad = 0) => Math.abs(p.x) < CELL.x - 0.55 - pad && Math.abs(p.y) < CELL.y - 0.45 - pad && Math.abs(p.z) < CELL.z - 0.4 - pad;
function cytosolPoint() {
  const p = new THREE.Vector3();
  do p.set((rand() * 2 - 1) * (CELL.x - 0.7), (rand() * 2 - 1) * (CELL.y - 0.6), (rand() * 2 - 1) * (CELL.z - 0.55));
  while (insideER(p, 0.15));
  return p;
}
function erPoint() {
  const p = new THREE.Vector3();
  do p.set((rand() * 2 - 1) * (ER.half + ER.r * 0.6), ER.y + (rand() * 2 - 1) * ER.r * 0.8, (rand() * 2 - 1) * ER.r * 0.8);
  while (!insideER(p, -0.15));
  return p;
}

/** A transporter in a membrane: a body across it, and a cone showing which way Ca2+ goes */
function transporter(key, pos, normal, pump, inward) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: COLOR[key], roughness: 0.45, metalness: 0.1, emissive: COLOR[key], emissiveIntensity: 0.12 });
  const body = new THREE.Mesh(pump ? new THREE.CylinderGeometry(0.22, 0.22, 0.42, 20) : new THREE.CylinderGeometry(0.15, 0.2, 0.5, 18), mat);
  g.add(body);
  if (pump) {                              // pumps: a ring that turns
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 10, 28), mat);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    g.userData.ring = ring;
  } else {                                 // channels: a pore
    const pore = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.52, 10), new THREE.MeshBasicMaterial({ color: 0x0b1020 }));
    g.add(pore);
  }
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 14), mat);
  cone.position.y = inward ? -0.42 : 0.42;   // the cone points the way Ca2+ moves (local +y = the normal)
  if (inward) cone.rotation.x = Math.PI;
  g.add(cone);
  g.position.copy(pos);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone().normalize());
  g.traverse((o) => { o.userData.part = key; });
  return g;
}

export function startCalcium3D(root, { reducedMotion = false } = {}) {
  const canvas = root.querySelector('canvas'), tip = root.querySelector('.ca3d-tip'), labelsBox = root.querySelector('.ca3d-labels');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (e) { root.classList.add('sg-failed'); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a2238, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(4, 6, 5); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(1.2, 2.6, 12.5);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, enablePan: false, enableZoom: false, autoRotate: !reducedMotion, autoRotateSpeed: 0.5 });
  controls.minPolarAngle = 0.35; controls.maxPolarAngle = Math.PI - 0.35;

  const model = new THREE.Group();
  model.position.x = -1.1;                 // center the cell and its synapse together
  scene.add(model);
  const pickable = [];                     // what the pointer can name, nearest first wins (membranes last)

  // the cell: a see-through rounded box, edges brighter (two passes: back faces, then front)
  const cellGeo = new RoundedBoxGeometry(CELL.x * 2, CELL.y * 2, CELL.z * 2, 6, 0.9);
  const cellBack = new THREE.Mesh(cellGeo, new THREE.MeshStandardMaterial({ color: COLOR.membrane, transparent: true, opacity: 0.08, side: THREE.BackSide, depthWrite: false }));
  const cellFront = new THREE.Mesh(cellGeo, new THREE.MeshPhysicalMaterial({ color: COLOR.membrane, transparent: true, opacity: 0.16, roughness: 0.2, depthWrite: false, side: THREE.FrontSide }));
  cellFront.userData.part = 'membrane'; cellBack.userData.part = 'cytosol';
  const cellEdges = new THREE.LineSegments(new THREE.EdgesGeometry(cellGeo, 25), new THREE.LineBasicMaterial({ color: COLOR.membrane, transparent: true, opacity: 0.35 }));
  model.add(cellBack, cellFront, cellEdges);

  // the ER
  const erGeo = new THREE.CapsuleGeometry(ER.r, ER.half * 2, 10, 32);
  erGeo.rotateZ(Math.PI / 2);
  const er = new THREE.Mesh(erGeo, new THREE.MeshPhysicalMaterial({ color: COLOR.er, transparent: true, opacity: 0.34, roughness: 0.3, depthWrite: false, emissive: COLOR.er, emissiveIntensity: 0.08 }));
  er.position.y = ER.y; er.userData.part = 'er'; er.renderOrder = 1;
  model.add(er);

  // transporters, where the schematic has them
  const erTop = ER.y + ER.r, bottom = -CELL.y;
  const parts = [
    { key: 'ip3r', pos: new THREE.Vector3(-1.3, erTop, 0), n: new THREE.Vector3(0, 1, 0), pump: false, inward: false },
    { key: 'serca', pos: new THREE.Vector3(0, erTop, 0), n: new THREE.Vector3(0, 1, 0), pump: true, inward: true },
    { key: 'ryr', pos: new THREE.Vector3(1.3, erTop, 0), n: new THREE.Vector3(0, 1, 0), pump: false, inward: false },
    { key: 'pmca', pos: new THREE.Vector3(-2.1, bottom, 0), n: new THREE.Vector3(0, -1, 0), pump: true, inward: false },
    { key: 'vdcc', pos: new THREE.Vector3(0, bottom, 0), n: new THREE.Vector3(0, -1, 0), pump: false, inward: true },
    { key: 'ncx', pos: new THREE.Vector3(2.1, bottom, 0), n: new THREE.Vector3(0, -1, 0), pump: true, inward: false },
  ];
  const meshes = {};
  for (const t of parts) {
    const g = transporter(t.key, t.pos, t.n, t.pump, t.inward);
    model.add(g); meshes[t.key] = g; pickable.push(g);
  }

  // the synapse: a presynaptic bouton outside the right wall, and the postsynaptic density on it
  const synMat = new THREE.MeshStandardMaterial({ color: COLOR.synapse, roughness: 0.4, emissive: COLOR.synapse, emissiveIntensity: 0.15 });
  const syn = new THREE.Group();
  const bouton = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.3, 32), synMat);
  bouton.rotation.z = Math.PI / 2; bouton.position.x = CELL.x + 0.85;
  const axon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 12), synMat);
  axon.rotation.z = Math.PI / 2; axon.position.x = CELL.x + 2.1;
  const psd = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 32), new THREE.MeshStandardMaterial({ color: COLOR.synapse, transparent: true, opacity: 0.7 }));
  psd.rotation.z = Math.PI / 2; psd.position.x = CELL.x - 0.04;
  syn.add(bouton, axon, psd);
  syn.position.y = 0.35;
  syn.traverse((o) => { o.userData.part = 'synapse'; });
  model.add(syn); pickable.push(syn);

  // molecules: instanced spheres
  const sphere = (r) => new THREE.SphereGeometry(r, 14, 10);
  const mol = (n, r, color, key, glow = 0.4) => {
    const m = new THREE.InstancedMesh(sphere(r), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: glow, roughness: 0.35 }), n);
    m.userData.part = key; m.frustumCulled = false; model.add(m); pickable.push(m);
    return m;
  };
  const NCA = 90, NER = 70, NIP3 = 40, NCALB = 16, NFLUX = 36;
  const caM = mol(NCA + NER + NFLUX, 0.065, COLOR.ca, 'ca', 0.6);
  const ip3M = mol(NIP3, 0.06, COLOR.ip3, 'ip3', 0.25);
  const calbM = mol(NCALB, 0.15, COLOR.calb, 'calb', 0.2);
  const ca = Array.from({ length: NCA }, cytosolPoint), caER = Array.from({ length: NER }, erPoint);
  const ip3 = Array.from({ length: NIP3 }, () => ({ p: cytosolPoint(), age: rand() }));
  const calb = Array.from({ length: NCALB }, cytosolPoint);
  // Ca2+ streams: for every transporter a few ions moving along its axis, the way it carries them
  const synIn = { pos: new THREE.Vector3(CELL.x, 0.35, 0), n: new THREE.Vector3(-1, 0, 0) };
  const streams = [...parts.map((t) => ({ from: t.pos.clone().addScaledVector(t.n, t.inward ? 0.9 : -0.9), to: t.pos.clone().addScaledVector(t.n, t.inward ? -0.9 : 0.9) })),
    { from: synIn.pos.clone().addScaledVector(synIn.n, -0.6), to: synIn.pos.clone().addScaledVector(synIn.n, 1.3) }];
  const flux = Array.from({ length: NFLUX }, (_, i) => ({ s: i % streams.length, phase: rand() }));

  const M = new THREE.Matrix4(), tmp = new THREE.Vector3(), q = new THREE.Quaternion();
  const setAt = (mesh, i, p, s = 1) => { M.compose(p, q, tmp.set(s, s, s)); mesh.setMatrixAt(i, M); };
  let flowOn = true;
  function step(dt) {
    // a random-walk step; a step that leaves the molecule's region is undone
    const walk = (p, sigma, keep) => {
      const o = p.clone();
      p.x += (rand() - 0.5) * sigma; p.y += (rand() - 0.5) * sigma; p.z += (rand() - 0.5) * sigma;
      if (!keep(p)) p.copy(o);
    };
    const cyto = (p) => insideCell(p) && !insideER(p, 0.12);
    ca.forEach((p, i) => { walk(p, 0.09, cyto); setAt(caM, i, p); });
    caER.forEach((p, i) => { walk(p, 0.06, (x) => insideER(x, -0.12)); setAt(caM, NCA + i, p); });
    ip3.forEach((m, i) => {                // IP3 leaves the synapse, drifts toward the ER, fades and starts again
      m.age += dt * 0.08;
      if (m.age > 1) { m.age = 0; m.p.set(CELL.x - 0.7, 0.35 + (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.6); }
      const o = m.p.clone(); m.p.x -= dt * 0.45 * (0.5 + rand()); if (!cyto(m.p)) m.p.copy(o); walk(m.p, 0.07, cyto);
      setAt(ip3M, i, m.p, 1 - m.age * 0.6);
    });
    calb.forEach((p, i) => { walk(p, 0.025, cyto); setAt(calbM, i, p); });
    flux.forEach((f, i) => {
      f.phase = (f.phase + dt * 0.5) % 1;
      const s = streams[f.s];
      if (flowOn) setAt(caM, NCA + NER + i, tmp.copy(s.from).lerp(s.to, f.phase), Math.sin(Math.PI * f.phase) * 1.15);
      else setAt(caM, NCA + NER + i, s.from, 0.0001);
    });
    caM.instanceMatrix.needsUpdate = ip3M.instanceMatrix.needsUpdate = calbM.instanceMatrix.needsUpdate = true;
    for (const k of ['serca', 'pmca', 'ncx']) if (meshes[k].userData.ring) meshes[k].userData.ring.rotation.z += dt * 2.2;
  }
  step(0.016);

  // ---- labels (toggle) and hover names ----
  const anchors = {
    cytosol: new THREE.Vector3(-2.6, 1.7, 0), er: new THREE.Vector3(-2.4, ER.y - 0.2, 0), ip3r: parts[0].pos, serca: parts[1].pos, ryr: parts[2].pos,
    pmca: parts[3].pos, vdcc: parts[4].pos, ncx: parts[5].pos, synapse: new THREE.Vector3(CELL.x + 1.2, 1.15, 0),
  };
  const labelEls = Object.entries(anchors).map(([k, v]) => {
    const d = document.createElement('span'); d.textContent = INFO[k][0].replace(/ \(.*\)/, '').replace(' pump', '');
    if (k === 'ip3r') d.textContent = 'IP3R'; if (k === 'ryr') d.textContent = 'RyR'; if (k === 'er') d.textContent = 'ER';
    if (k === 'ncx') d.textContent = 'NCX'; if (k === 'vdcc') d.textContent = 'VDCC';
    labelsBox.appendChild(d); return { d, v };
  });
  const showLabels = root.querySelector('.ca3d-show-labels');
  showLabels.addEventListener('change', () => root.classList.toggle('labels-on', showLabels.checked));
  root.querySelector('.ca3d-flow').addEventListener('change', (e) => { flowOn = e.target.checked; });

  // where a part is on screen (client px), for checking the hover names
  root.partOnScreen = (key) => {
    const r = canvas.getBoundingClientRect(), a = (anchors[key] || new THREE.Vector3()).clone().add(model.position).project(camera);
    return [r.left + ((a.x + 1) / 2) * r.width, r.top + ((1 - a.y) / 2) * r.height];
  };
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let hovered = null, pointerIn = false, dragging = false;
  const highlight = (key, on) => {
    const target = meshes[key] || (key === 'synapse' ? syn : key === 'er' ? er : null);
    if (!target) return;
    target.traverse((o) => { if (o.material && o.material.emissiveIntensity !== undefined) o.material.emissiveIntensity = on ? 0.55 : (key === 'er' ? 0.08 : 0.12); });
    if (meshes[key]) meshes[key].scale.setScalar(on ? 1.25 : 1);
  };
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    // parts and molecules first; then the ER, then the membrane / cytosol behind them
    let hit = ray.intersectObjects(pickable, true)[0];
    if (!hit) hit = ray.intersectObject(er)[0];
    if (!hit) {                            // inside the cell: the membrane only near its outline (seen edge-on)
      const h = ray.intersectObject(cellFront)[0];
      if (h) hit = { object: { userData: { part: Math.abs(h.face.normal.dot(ray.ray.direction)) < 0.35 ? 'membrane' : 'cytosol' } } };
    }
    let key = null;
    if (hit) { let o = hit.object; while (o && !o.userData.part) o = o.parent; key = o ? o.userData.part : null; }
    if (key !== hovered) { if (hovered) highlight(hovered, false); hovered = key; if (key) highlight(key, true); }
    if (key) {
      tip.innerHTML = `<b>${INFO[key][0]}</b><span>${INFO[key][1]}</span>`;
      const x = e.clientX - r.left, y = e.clientY - r.top;
      tip.style.left = `${Math.min(r.width - 270, x + 16)}px`; tip.style.top = `${Math.min(r.height - 110, y + 14)}px`;
      tip.classList.add('on'); canvas.style.cursor = dragging ? 'grabbing' : 'help';
    } else { tip.classList.remove('on'); canvas.style.cursor = dragging ? 'grabbing' : 'grab'; }
  }
  canvas.addEventListener('pointermove', (e) => { pointerIn = true; if (!dragging) pick(e); });
  canvas.addEventListener('pointerleave', () => { pointerIn = false; tip.classList.remove('on'); if (hovered) highlight(hovered, false); hovered = null; });
  controls.addEventListener('start', () => { dragging = true; tip.classList.remove('on'); });
  controls.addEventListener('end', () => { dragging = false; });
  // touch: a tap names what is under the finger
  canvas.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') pick(e); });

  const zoomBy = (f) => { const d = camera.position.length(); const nd = THREE.MathUtils.clamp(d * f, 7, 34); camera.position.multiplyScalar(nd / d); };
  root.querySelector('.ca3d-zoom-in').addEventListener('click', () => zoomBy(0.85));
  root.querySelector('.ca3d-zoom-out').addEventListener('click', () => zoomBy(1.18));

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    // far enough that the cell and its synapse (about 11 wide) fit across the card, at any shape
    camera.position.setLength(Math.max(12.8, 6 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect)));
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  const clock = new THREE.Clock();
  const v = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!visible) return;
    controls.autoRotate = !reducedMotion && !pointerIn;
    if (!reducedMotion) { step(dt); model.position.y = Math.sin(clock.elapsedTime * 0.8) * 0.12; }   // a gentle float
    controls.update();
    renderer.render(scene, camera);
    if (root.classList.contains('labels-on')) {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      labelEls.forEach(({ d, v: a }) => {
        v.copy(a).add(model.position).project(camera);
        d.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -140%)`;
      });
    }
  });
}
