// "Try it": the ideal spine of SpineBuilder's first tab, rebuilt in the browser from the same parameters.
// The rings and the validity rules are those of the app (spinebuilder_app/params.py: spine_profile, sa_profile,
// validate); the mesh itself is simpler (lathed polygons, not one welded membrane), for drawing only.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { membraneMaterial, solidMaterial, COLORS } from './sbmaterials.js';

// [key, label, default, min, max, step] in um
const SLIDERS = [
  ['neckLen', 'Neck length', 0.7, 0.1, 1.6, 0.01],
  ['neckRad', 'Neck radius', 0.08, 0.03, 0.4, 0.005],
  ['headLen', 'Head length', 0.58, 0.1, 1.2, 0.01],
  ['headRad', 'Head radius', 0.29, 0.05, 0.6, 0.005],
  ['erRad', 'ER radius', 0.11, 0.03, 0.45, 0.005],
  ['appRad', 'SA radius', 0.025, 0.01, 0.12, 0.001],
  ['appLen', 'SA length', 0.5, 0.1, 2.0, 0.01],
];
const FIXED = { cytRad: 0.45, dendLen: 10, spinePos: 5, erMargin: 1, dendRim: 8, spineRim: 16, erRim: 8, saRim: 8 };

/** (y, r) rings of the spine, as spine_profile() */
function spineProfile(p) {
  const h0 = p.cytRad + p.neckLen, h = p.headLen;
  const rings = [[p.cytRad, p.neckRad], [p.cytRad + p.neckLen / 2, p.neckRad], [h0, p.neckRad], [h0 + h / 3, p.headRad]];
  for (const i of [1, 2, 3]) rings.push([h0 + h / 3 + (i * h) / 9, p.headRad]);
  rings.push([h0 + h, p.neckRad]);
  return rings;
}

function radiusAt(rings, y) {
  if (y <= rings[0][0]) return rings[0][1];
  for (let k = 0; k + 1 < rings.length; k++) {
    const [y0, r0] = rings[k], [y1, r1] = rings[k + 1];
    if (y <= y1) return y1 === y0 ? r0 : r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return rings[rings.length - 1][1];
}

/** The app's checks (params.validate), as messages */
function validate(p) {
  const e = [];
  const { cytRad: R, dendRim: n, erRim: ne } = p;
  if (p.headRad < p.neckRad) e.push('The head radius must be at least the neck radius.');
  if (p.neckRad >= R * Math.sin((2 * Math.PI) / n))
    e.push(`The neck opening doesn't fit on the dendrite: neck radius < R·sin(2π/n) = ${(R * Math.sin((2 * Math.PI) / n)).toFixed(3)} µm.`);
  if (p.er && p.erRad >= R * Math.cos(Math.PI / n))
    e.push(`The ER doesn't fit inside the dendrite: ER radius < R·cos(π/n) = ${(R * Math.cos(Math.PI / n)).toFixed(3)} µm.`);
  if (p.er && p.sa) {
    if (p.appRad >= p.erRad * Math.sin((2 * Math.PI) / ne))
      e.push(`The SA opening doesn't fit on the ER: SA radius < r_er·sin(2π/n_er) = ${(p.erRad * Math.sin((2 * Math.PI) / ne)).toFixed(3)} µm.`);
    const tip = p.erRad + p.appLen, top = p.cytRad + p.neckLen + p.headLen;
    if (tip >= top) e.push('The spine apparatus must end inside the spine.');
    else {
      const rings = spineProfile(p);
      const lim = Math.cos(Math.PI / p.spineRim);
      for (let y = Math.max(p.cytRad, p.erRad); y <= tip; y += 0.005)
        if (p.appRad >= radiusAt(rings, y) * lim) { e.push('The spine apparatus must be narrower than the spine at every height.'); break; }
    }
  }
  return e;
}

/** A lathed polygonal tube along +y through rings [(y, r)], n sides, a vertex at angle 0; cap: close the top */
function lathe(rings, n, { capTop = false, capBottom = false } = {}) {
  const pos = [], idx = [];
  for (const [y, r] of rings)
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      pos.push(r * Math.sin(a), y, r * Math.cos(a));
    }
  for (let k = 0; k + 1 < rings.length; k++)
    for (let j = 0; j < n; j++) {
      const a = k * n + j, b = k * n + ((j + 1) % n);
      idx.push(a, b, a + n, b, b + n, a + n);
    }
  const fan = (ring, y, flip) => {
    const c = pos.length / 3;
    pos.push(0, y, 0);
    for (let j = 0; j < n; j++) {
      const a = ring * n + j, b = ring * n + ((j + 1) % n);
      flip ? idx.push(a, c, b) : idx.push(a, b, c);
    }
  };
  if (capTop) fan(rings.length - 1, rings[rings.length - 1][0], false);
  if (capBottom) fan(0, rings[0][0], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();   // flat faces: the polygons show, as in the app
  flat.computeVertexNormals();
  return flat;
}

/** A polygonal prism along z (a vertex on top, +y), closed by flat caps */
function prism(r, n, z0, z1) {
  const g = lathe([[z0, r], [z1, r]], n, { capTop: true, capBottom: true });
  g.rotateX(Math.PI / 2);          // +y -> +z
  g.rotateZ(Math.PI);              // vertex on top
  return g;
}

/** Area of the regular n-gon of circumradius r, and the exact volume of the spine above the dendrite */
const ngon = (r, n) => 0.5 * n * r * r * Math.sin((2 * Math.PI) / n);
function spineVolume(p) {
  const rings = spineProfile(p);
  let v = 0;
  for (let k = 0; k + 1 < rings.length; k++) {
    const h = rings[k + 1][0] - rings[k][0], a0 = ngon(rings[k][1], p.spineRim), a1 = ngon(rings[k + 1][1], p.spineRim);
    v += (h / 3) * (a0 + Math.sqrt(a0 * a1) + a1);
  }
  return v;
}

function buildGroup(p, mats) {
  const group = new THREE.Group();
  const n = p.dendRim;
  // the spine starts a little inside the dendrite, where its faces next to the top vertex lie under the neck
  const yBase = p.cytRad - p.neckRad * Math.tan(Math.PI / n) * 1.05;
  const rings = spineProfile(p);
  rings[0] = [yBase, p.neckRad];
  const spine = lathe(rings, p.spineRim);
  const tip = rings[rings.length - 1];
  const syn = lathe([[tip[0] - 0.0005, tip[1]], [tip[0], tip[1]]], p.spineRim, { capTop: true });
  const dend = prism(p.cytRad, n, 0, p.dendLen);
  for (const g of [spine, syn]) g.translate(0, 0, p.spinePos);
  for (const [g, m] of [[dend, 'pmBack'], [spine, 'pmBack'], [dend, 'pmFront'], [spine, 'pmFront']]) {
    const mesh = new THREE.Mesh(g, mats[m]);
    mesh.renderOrder = m === 'pmBack' ? 2 : 3;
    group.add(mesh);
  }
  group.add(new THREE.Mesh(syn, mats.syn));
  if (p.er) {
    const er = prism(p.erRad, p.erRim, p.erMargin, p.dendLen - p.erMargin);
    const m = new THREE.Mesh(er, mats.er); m.renderOrder = 1;
    group.add(m);
    if (p.sa) {
      const y0 = p.erRad - p.appRad * Math.tan(Math.PI / p.erRim) * 1.05;
      const sa = lathe([[y0, p.appRad], [p.erRad + p.appLen, p.appRad]], p.saRim, { capTop: true });
      sa.translate(0, 0, p.spinePos);
      group.add(new THREE.Mesh(sa, mats.sa));
    }
  }
  return group;
}

export function startIdealBuilder(root, { reducedMotion = false } = {}) {
  const canvas = root.querySelector('.builder-canvas');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) {
    root.classList.add('builder-failed');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.8;
  controls.target.set(0, 0.9, 5);
  camera.position.set(3.1, 2.1, 8.4);

  const mats = {
    pmBack: membraneMaterial(THREE.BackSide), pmFront: membraneMaterial(THREE.FrontSide),
    syn: solidMaterial(COLORS.syn, 0.35), er: solidMaterial(COLORS.er, 0, 0.6), sa: solidMaterial(COLORS.sa, 0.08),
  };

  const p = { ...FIXED, er: true, sa: true };
  const sliders = root.querySelector('.builder-sliders');
  const out = root.querySelector('.builder-out');
  const errors = root.querySelector('.builder-errors');
  const inputs = {};
  for (const [key, label, def, min, max, step] of SLIDERS) {
    p[key] = def;
    const row = document.createElement('label');
    row.className = 'builder-row';
    row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${def}" /><output></output>`;
    const input = row.querySelector('input'), o = row.querySelector('output');
    const show = () => { o.textContent = `${(+input.value).toFixed(step < 0.01 ? 3 : 2)} µm`; };
    input.addEventListener('input', () => { p[key] = +input.value; show(); rebuild(); });
    show();
    inputs[key] = { input, show, def };
    sliders.appendChild(row);
  }
  root.querySelectorAll('[data-opt]').forEach((box) => box.addEventListener('change', () => {
    p[box.dataset.opt] = box.checked;
    if (box.dataset.opt === 'er' && !box.checked) { p.sa = false; root.querySelector('[data-opt="sa"]').checked = false; }
    if (box.dataset.opt === 'sa' && box.checked && !p.er) { p.er = true; root.querySelector('[data-opt="er"]').checked = true; }
    rebuild();
  }));
  root.querySelector('[data-reset]').addEventListener('click', () => {
    for (const [key, { input, show, def }] of Object.entries(inputs)) { input.value = def; p[key] = def; show(); }
    rebuild();
  });

  let group = null;
  function rebuild() {
    const errs = validate(p);
    errors.innerHTML = errs.map((m) => `<li>${m}</li>`).join('');
    root.classList.toggle('builder-invalid', errs.length > 0);
    if (group) {
      scene.remove(group);
      group.traverse((o) => o.geometry && o.geometry.dispose());
    }
    group = buildGroup(p, mats);
    scene.add(group);
    const top = p.cytRad + p.neckLen + p.headLen;
    const psd = ngon(p.neckRad, p.spineRim);
    out.innerHTML = `<div><dt>Spine length</dt><dd>${(top - p.cytRad).toFixed(2)} µm</dd></div>
      <div><dt>Spine volume</dt><dd>${spineVolume(p).toFixed(3)} µm³</dd></div>
      <div><dt>Synapse area</dt><dd>${psd.toFixed(4)} µm²</dd></div>`;
    controls.target.y = 0.2 + top / 2;
  }
  rebuild();

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  renderer.setAnimationLoop(() => {
    if (!visible) return;
    controls.update();
    renderer.render(scene, camera);
  });
}
