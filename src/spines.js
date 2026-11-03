// The dendritic spine gallery: the 10 reconstructed Vlachos spines from SpineBuilder (public/spines/, made by
// scripts/build_spines.py), each with its spine apparatus (the spine's ER), the dendritic ER and the synapse,
// seen through a translucent membrane. Drag to rotate; the strip below switches spines.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---- look (tweak here) ----
const COLORS = {
  membrane: 0x9fc4ff,
  syn: 0xffa53a,      // synapse (postsynaptic density): the site's accent
  sa: 0x46e3a0,       // spine apparatus
  er: 0x2a8fd0,       // dendritic ER
};
const MEMBRANE_OPACITY = [0.1, 0.75];   // facing the camera, at the silhouette

const BASE = import.meta.env.BASE_URL + 'spines/';

const solidVS = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = -mv.xyz; vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;

const solidFS = /* glsl */ `
  uniform vec3 uColor; uniform float uGlow; uniform float uAlpha;
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec3 N = normalize(vN); vec3 V = normalize(vV);
    if (!gl_FrontFacing) N = -N;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    vec3 L1 = normalize(vec3(0.5, 0.8, 0.6)), L2 = normalize(vec3(-0.6, -0.2, 0.4));
    float d = max(dot(N, L1), 0.0) * 0.8 + max(dot(N, L2), 0.0) * 0.25;
    float spec = pow(max(dot(N, normalize(L1 + V)), 0.0), 40.0) * 0.35;
    vec3 col = uColor * (0.22 + d) + spec + uColor * fres * 0.5 + uColor * uGlow;
    gl_FragColor = vec4(col, uAlpha);
  }`;

const membraneFS = /* glsl */ `
  uniform vec3 uColor; uniform vec2 uOpacity;
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec3 N = normalize(vN); vec3 V = normalize(vV);
    if (!gl_FrontFacing) N = -N;
    float fres = pow(1.0 - abs(dot(N, V)), 2.2);
    float a = mix(uOpacity.x, uOpacity.y, fres);
    vec3 L = normalize(vec3(0.5, 0.8, 0.6));
    vec3 col = uColor * (0.35 + 0.65 * max(dot(N, L), 0.0)) + uColor * fres * 0.6;
    gl_FragColor = vec4(col, a);
  }`;

function solid(color, glow = 0, alpha = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: solidVS, fragmentShader: solidFS,
    uniforms: { uColor: { value: new THREE.Color(color) }, uGlow: { value: glow }, uAlpha: { value: alpha } },
    transparent: alpha < 1, depthWrite: alpha >= 1,
  });
}

function membrane(side) {
  return new THREE.ShaderMaterial({
    vertexShader: solidVS, fragmentShader: membraneFS, transparent: true, depthWrite: false, side,
    uniforms: { uColor: { value: new THREE.Color(COLORS.membrane) }, uOpacity: { value: new THREE.Vector2(...MEMBRANE_OPACITY) } },
  });
}

function geometry(part) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(part.p, 3));
  g.setIndex(part.i);
  g.computeVertexNormals();
  return g;
}

const MATERIALS = {
  syn: solid(COLORS.syn, 0.35),
  sa: solid(COLORS.sa, 0.08),
  er: solid(COLORS.er, 0.0, 0.55),
  pmBack: membrane(THREE.BackSide),
  pmFront: membrane(THREE.FrontSide),
};

/** One spine as a group: organelles first, then the membrane (back faces, then front faces) */
function buildSpine(doc) {
  const group = new THREE.Group();
  for (const k of ['sa', 'syn', 'er']) {
    if (!doc.parts[k]) continue;
    const m = new THREE.Mesh(geometry(doc.parts[k]), MATERIALS[k]);
    if (k === 'er') m.renderOrder = 1;
    group.add(m);
  }
  if (doc.parts.pm) {
    const g = geometry(doc.parts.pm);
    const back = new THREE.Mesh(g, MATERIALS.pmBack); back.renderOrder = 2;
    const front = new THREE.Mesh(g, MATERIALS.pmFront); front.renderOrder = 3;
    group.add(back, front);
  }
  // frame on the spine (the membrane above the dendrite surface at y = 0.45) and the top of the dendrite under it
  const box = new THREE.Box3().expandByPoint(new THREE.Vector3(0, -0.2, 0));
  const p = doc.parts.pm.p, v = new THREE.Vector3();
  for (let k = 0; k < p.length; k += 3) if (p[k + 1] > 0.5) box.expandByPoint(v.set(p[k], p[k + 1], p[k + 2]));
  box.expandByScalar(0.15);
  group.userData.sphere = box.getBoundingSphere(new THREE.Sphere());
  return group;
}

const cache = new Map();
function load(id) {
  if (!cache.has(id)) cache.set(id, fetch(`${BASE}${id}.json`).then((r) => r.json()).then(buildSpine));
  return cache.get(id);
}

/**
 * Starts the gallery in root (see #spine-gallery in index.html).
 */
export async function startSpineGallery(root, { reducedMotion = false } = {}) {
  const canvas = root.querySelector('canvas.sg-canvas');
  const strip = root.querySelector('.sg-strip');
  const info = root.querySelector('.sg-info');
  const scaleBar = root.querySelector('.sg-scale span');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) {
    root.classList.add('sg-failed');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const index = await (await fetch(`${BASE}index.json`)).json();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = false;          // the page scrolls with the wheel; zoom with the buttons
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 1.2;
  let zoom = 1, fitDist = 5;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // the strip of spines
  const buttons = index.map((s, k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sg-thumb';
    b.setAttribute('role', 'tab');
    b.innerHTML = `<canvas width="160" height="160" aria-hidden="true"></canvas><span class="sg-name">${s.name}</span><span class="sg-type">${s.type}</span>`;
    b.addEventListener('click', () => show(k));
    strip.appendChild(b);
    return b;
  });
  strip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const k = (current + (e.key === 'ArrowRight' ? 1 : index.length - 1)) % index.length;
    show(k);
    buttons[k].focus();
  });
  root.querySelector('.sg-prev').addEventListener('click', () => show((current + index.length - 1) % index.length));
  root.querySelector('.sg-next').addEventListener('click', () => show((current + 1) % index.length));
  root.querySelector('.sg-zoom-in').addEventListener('click', () => { zoom = Math.max(0.45, zoom / 1.25); place(false); });
  root.querySelector('.sg-zoom-out').addEventListener('click', () => { zoom = Math.min(2.2, zoom * 1.25); place(false); });

  let current = -1, shown = null, token = 0;
  function place(reset) {
    const dir = reset ? new THREE.Vector3(1.0, 0.45, 1.3).normalize() : camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, fitDist * zoom);
  }
  async function show(k) {
    if (k === current) return;
    current = k;
    const my = ++token;
    buttons.forEach((b, j) => { b.classList.toggle('active', j === k); b.setAttribute('aria-selected', j === k); });
    const s = index[k];
    info.innerHTML = `<p class="tag">${s.type}</p><h3>${s.name}</h3>
      <dl><div><dt>Length</dt><dd>${s.length.toFixed(2)} µm</dd></div>
      <div><dt>Synapse area</dt><dd>${s.psdArea.toFixed(2)} µm²</dd></div>
      <div><dt>Spine apparatus area</dt><dd>${s.saArea.toFixed(2)} µm²</dd></div></dl>`;
    root.classList.add('sg-loading');
    const group = await load(s.id);
    if (my !== token) return;
    root.classList.remove('sg-loading');
    if (shown) scene.remove(shown);
    shown = group;
    scene.add(group);
    const sph = group.userData.sphere;
    controls.target.copy(sph.center);
    fitDist = sph.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
    zoom = 1;
    place(true);
    load(index[(k + 1) % index.length].id);   // prefetch the next one
  }

  // thumbnails: render each spine once with a small second renderer, then drop it
  async function thumbnails() {
    let tr;
    try { tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (e) { return; }
    tr.setPixelRatio(1);
    tr.setSize(160, 160, false);
    tr.setClearColor(0x000000, 0);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
    for (let k = 0; k < index.length; k++) {
      const g = await load(index[k].id);
      const sc = new THREE.Scene();
      sc.add(g.clone());
      const sph = g.userData.sphere;
      cam.position.copy(sph.center).addScaledVector(new THREE.Vector3(1.0, 0.45, 1.3).normalize(), sph.radius / Math.sin(THREE.MathUtils.degToRad(15)));
      cam.lookAt(sph.center);
      tr.render(sc, cam);
      const ctx = buttons[k].querySelector('canvas').getContext('2d');
      ctx.clearRect(0, 0, 160, 160);
      ctx.drawImage(tr.domElement, 0, 0);
    }
    tr.dispose();
    tr.forceContextLoss();
  }

  // the 1 um scale bar, at the distance of the target
  function updateScale() {
    const d = camera.position.distanceTo(controls.target);
    const pxPerUm = canvas.clientHeight / (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    scaleBar.style.width = `${pxPerUm.toFixed(1)}px`;
  }

  // render only while the gallery is on screen
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  renderer.setAnimationLoop(() => {
    if (!visible) return;
    controls.update();
    updateScale();
    renderer.render(scene, camera);
  });

  await show(0);
  thumbnails();
}
