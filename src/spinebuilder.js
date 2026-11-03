// The SpineBuilder page (spinebuilder.html): its background is the mesh of the section being read, loaded from
// public/spinebuilder/mesh/ (made from the app's .ugx files by scripts/build_spinebuilder.py).
//
// - Each section names its mesh (data-scene: ideal, process, cell); switching fades one out and the next in.
// - Scrolling through a section flies the camera along that mesh's views: in the Cell Builder section from the
//   whole cell down to one of its spines.
// - Dragging where there is no text turns the mesh; "Explore in 3D" hides the page and adds zoom, panning,
//   the choice of mesh and parts, and a flight from spine to spine.
import * as THREE from 'three';
import { membraneMaterial, solidMaterial, COLORS } from './sbmaterials.js';
import { renderMath } from './math.js';

const BASE = import.meta.env.BASE_URL + 'spinebuilder/mesh/';
const NAMES = { ideal: 'Ideal spine', process: 'Processed Kasthuri spine', cell: 'Cell with 10 spines' };
const FOV = 32;

// camera views per mesh [um]: target, distance, azimuth and elevation [rad]; 'spot' = at the synapse, looking
// at it from outside (along its normal). Scrolling through the section goes from the first view to the last.
const VIEWS = {
  ideal: [
    { target: [0, 0.55, 5], dist: 10.5, az: 0.75, el: 0.32 },
    { target: [0, 1.05, 5], dist: 3.6, az: 1.35, el: 0.18 },
  ],
  process: [
    { target: [0, 0.6, 0], dist: 11.5, az: 0.9, el: 0.3 },
    { target: [-0.2, 1.4, 0.1], dist: 4.2, az: 1.6, el: 0.12 },
  ],
  cell: [
    { whole: true, az: 0, el: 0.05 },
    { whole: true, az: 0.4, el: 0.08, zoom: 0.55 },
    { spot: true, dist: 6.5 },
  ],
};

function partGeometry(buf, part) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, part.positions, part.vertices * 3), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, part.indices, part.triangles * 3), 1));
  g.computeVertexNormals();
  return g;
}

async function loadScene(name) {
  const [doc, buf] = await Promise.all([
    fetch(`${BASE}${name}.json`).then((r) => r.json()),
    fetch(`${BASE}${name}.bin`).then((r) => r.arrayBuffer()),
  ]);
  const mats = {
    pmBack: membraneMaterial(THREE.BackSide), pmFront: membraneMaterial(THREE.FrontSide),
    syn: solidMaterial(COLORS.syn, 0.4), er: solidMaterial(COLORS.er, 0, 0.6), sa: solidMaterial(COLORS.sa, 0.1),
  };
  const group = new THREE.Group();
  const parts = {};
  for (const part of doc.parts) {
    const g = partGeometry(buf, part);
    const meshes = part.name === 'pm'
      ? [Object.assign(new THREE.Mesh(g, mats.pmBack), { renderOrder: 2 }), Object.assign(new THREE.Mesh(g, mats.pmFront), { renderOrder: 3 })]
      : [Object.assign(new THREE.Mesh(g, mats[part.name]), { renderOrder: part.name === 'er' ? 1 : 0 })];
    meshes.forEach((m) => { m.frustumCulled = false; group.add(m); });
    parts[part.name] = meshes;
  }
  group.visible = false;
  const [lo, hi] = doc.bounds;
  const center = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  // the spot to fly to first: the synapse that faces the camera of the first view (+z) best
  const spots = doc.spots.map((s) => ({ c: new THREE.Vector3(...s.c), n: new THREE.Vector3(...s.n) }));
  const spot = spots.reduce((best, s, i) => (s.n.z > spots[best].n.z ? i : best), 0);
  return { name, doc, group, parts, mats: Object.values(mats), pm: [mats.pmBack, mats.pmFront], center, size,
    height: hi[1] - lo[1], spots, spot };
}

/** The view {target, logDist, az, el} of one keyframe of a scene */
function viewOf(sc, key, aspect) {
  if (key.whole) {
    const half = THREE.MathUtils.degToRad(FOV / 2);
    const fit = Math.max(sc.height * 0.55, (sc.size * 0.55) / Math.max(aspect, 0.6)) / Math.tan(half);
    return { target: sc.center.clone(), logDist: Math.log(fit * (key.zoom ?? 1)), az: key.az, el: key.el };
  }
  if (key.spot) {
    // the spine from the side, a little from above its head: s.n is its axis, from the dendrite to the synapse
    const s = sc.spots[sc.spot];
    const side = new THREE.Vector3().crossVectors(s.n, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 0.04) side.set(1, 0, 0);
    const v = side.normalize().multiplyScalar(0.92).addScaledVector(s.n, 0.4).normalize();
    return { target: s.c.clone().addScaledVector(s.n, -0.4), logDist: Math.log(key.dist),
      az: Math.atan2(v.x, v.z), el: THREE.MathUtils.clamp(Math.asin(v.y), -0.9, 0.9) };
  }
  return { target: new THREE.Vector3(...key.target), logDist: Math.log(key.dist), az: key.az, el: key.el };
}

/** Views along a path of keyframes at t in [0, 1] */
function viewAt(sc, t, aspect) {
  const keys = VIEWS[sc.name];
  const x = THREE.MathUtils.clamp(t, 0, 1) * (keys.length - 1);
  const k = Math.min(Math.floor(x), keys.length - 2), f = THREE.MathUtils.smoothstep(x - k, 0, 1);
  const a = viewOf(sc, keys[k], aspect), b = viewOf(sc, keys[k + 1], aspect);
  let daz = b.az - a.az;                       // turn the short way round
  daz = Math.atan2(Math.sin(daz), Math.cos(daz));
  return { target: a.target.lerp(b.target, f), logDist: a.logDist + (b.logDist - a.logDist) * f,
    az: a.az + daz * f, el: a.el + (b.el - a.el) * f };
}

function startBuilderWhenNear(reducedMotion) {
  const root = document.getElementById('builder');
  if (!root) return;
  const near = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    near.disconnect();
    import('./idealspine.js')
      .then(({ startIdealBuilder }) => startIdealBuilder(root, { reducedMotion }))
      .catch((e) => { console.error(e); root.classList.add('builder-failed'); });
  }, { rootMargin: '500px 0px' });
  near.observe(root);
}

/**
 * Starts the page: the background in canvas, the HUD, the math and the "Try it" builder.
 */
export async function startSpineBuilderPage(canvas, { reducedMotion = false } = {}) {
  renderMath();
  startBuilderWhenNear(reducedMotion);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e) {
    document.body.classList.add('no-webgl');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1000);

  const hud = document.getElementById('sb-hud');
  const sceneName = document.getElementById('sb-scene-name');
  const exploreBtn = document.getElementById('sb-explore');
  const nextSpine = document.getElementById('sb-next-spine');
  const sections = [...document.querySelectorAll('[data-scene].sb-tab')];

  const scenes = {};
  const loading = {};
  const get = (name) => (loading[name] ??= loadScene(name).then((sc) => { scenes[name] = sc; scene.add(sc.group); applyParts(); return sc; }));

  // which parts are shown (all meshes)
  const partBoxes = [...hud.querySelectorAll('[data-part]')];
  function applyParts() {
    for (const sc of Object.values(scenes))
      for (const box of partBoxes) (sc.parts[box.dataset.part] || []).forEach((m) => { m.visible = box.checked; });
  }
  partBoxes.forEach((b) => b.addEventListener('change', applyParts));

  // the shown scene, and the one asked for (fade out, switch, fade in)
  let current = null, wanted = 'ideal', fade = 0;
  let exploring = false, exploreScene = null;

  // the camera: the view of the scroll position (or the explore view), plus the user's turn, zoom and pan
  const user = { az: 0, el: 0, zoom: 0, pan: new THREE.Vector3() };
  const cam = { target: new THREE.Vector3(), logDist: 0, az: 0, el: 0, ready: false };
  let spin = 0, offset = 0, wide = true, aspect = 1, lastT = 0;
  let exploreT = 0;                    // explore: 0 = the scene's first view, 1 = flying to a spine (cell)

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    aspect = w / h;
    camera.aspect = aspect;
    wide = aspect > 1.1;
  }
  resize();
  window.addEventListener('resize', resize);

  function activeSection() {
    const mid = window.innerHeight * 0.5;
    for (const s of sections) {
      const r = s.getBoundingClientRect();
      if (r.top <= mid && r.bottom >= mid) return { name: s.dataset.scene, t: (mid - r.top) / r.height };
    }
    const first = sections[0].getBoundingClientRect();
    return first.top > mid ? { name: sections[0].dataset.scene, t: 0 } : null;
  }

  // ---- pointer: drag turns; in explore mode also wheel zooms and right-drag pans ----
  // The canvas lies behind the page, so the events reach the body (where the page lets them through, see
  // ".sb main" in style.css) rather than the canvas: a press on the body, the root or the canvas is on the mesh.
  const onMesh = (e) => e.target === canvas || e.target === document.body || e.target === document.documentElement;
  let drag = null;
  window.addEventListener('pointerdown', (e) => {
    if (!onMesh(e)) return;
    if (e.pointerType === 'touch' && !exploring) return;      // touch scrolls the page
    e.preventDefault();                                         // no text selection while turning
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey, id: e.pointerId };
    document.body.classList.add('sb-dragging');
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan && exploring) {
      const d = Math.exp(cam.logDist + user.zoom) * 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / window.innerHeight;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      user.pan.addScaledVector(right, -dx * d).addScaledVector(up, dy * d);
    } else {
      user.az -= dx * 0.006;
      user.el = THREE.MathUtils.clamp(user.el + dy * 0.005, -1.3, 1.3);
    }
  });
  const endDrag = () => { drag = null; document.body.classList.remove('sb-dragging'); };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('contextmenu', (e) => exploring && onMesh(e) && e.preventDefault());
  window.addEventListener('wheel', (e) => {
    if (!exploring || !onMesh(e)) return;
    e.preventDefault();
    user.zoom = THREE.MathUtils.clamp(user.zoom + e.deltaY * 0.0015, -4, 2.5);
  }, { passive: false });

  // ---- explore mode ----
  function setExplore(on) {
    exploring = on;
    document.body.classList.toggle('sb-explore', on);
    exploreBtn.textContent = on ? 'Back to the page' : 'Explore in 3D';
    if (on) { exploreScene = wanted; exploreT = 0; markScene(); }
    user.zoom = 0; user.pan.set(0, 0, 0);
  }
  exploreBtn.addEventListener('click', () => setExplore(!exploring));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && exploring) setExplore(false); });
  hud.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => {
    exploreScene = b.dataset.scene; exploreT = 0;
    user.az = user.el = user.zoom = 0; user.pan.set(0, 0, 0);
    markScene();
  }));
  nextSpine.addEventListener('click', async () => {
    const sc = await get(exploreScene ?? wanted);
    if (sc.spots.length) sc.spot = (sc.spot + (exploreT === 1 ? 1 : 0)) % sc.spots.length;
    exploreT = 1;
    user.az = user.el = user.zoom = 0; user.pan.set(0, 0, 0);
  });
  function markScene() {
    const name = exploring ? exploreScene : wanted;
    hud.querySelectorAll('[data-scene]').forEach((b) => b.classList.toggle('active', b.dataset.scene === name));
    sceneName.textContent = NAMES[name];
  }

  // start with the first mesh, then fetch the others in the background
  await get('ideal');
  get('process'); get('cell');
  document.body.classList.add('sb-ready');
  markScene();

  const clock = new THREE.Clock();
  const pos = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const sec = exploring ? { name: exploreScene, t: exploreT } : activeSection();
    if (sec && sec.name !== wanted) {
      wanted = sec.name;
      user.az = user.el = 0;
      markScene();
    }
    // fade between meshes
    if (current !== wanted || !current) {
      fade -= dt / 0.35;
      fade = Math.max(fade, 0);
      if (fade <= 0 && scenes[wanted]) {
        if (current && scenes[current]) scenes[current].group.visible = false;
        current = wanted;
        scenes[current].group.visible = true;
        fade = 0;
        cam.ready = false;               // jump to the new mesh's view
      }
    } else fade = Math.min(1, fade + dt / 0.5);
    const sc = scenes[current];
    if (!sc) return;
    for (const m of sc.mats) m.uniforms.uFade.value = Math.max(0, fade);

    // the camera
    if (!reducedMotion && !drag) spin += dt * (current === 'cell' ? 0.05 : 0.09);
    if (sec && sec.name === current) lastT = sec.t;      // while fading out, the old mesh keeps its view
    else if (!sec) lastT = 1;
    const goal = viewAt(sc, lastT, aspect);
    const k = cam.ready ? 1 - Math.exp(-dt * 3.5) : 1;
    cam.target.lerp(goal.target, k);
    cam.logDist += (goal.logDist - cam.logDist) * k;
    cam.az += Math.atan2(Math.sin(goal.az - cam.az), Math.cos(goal.az - cam.az)) * k;
    cam.el += (goal.el - cam.el) * k;
    cam.ready = true;
    const dist = Math.exp(cam.logDist + user.zoom);
    const az = cam.az + user.az + spin, el = THREE.MathUtils.clamp(cam.el + user.el, -1.4, 1.4);
    const target = pos.copy(cam.target).add(user.pan);
    camera.position.set(
      target.x + dist * Math.cos(el) * Math.sin(az),
      target.y + dist * Math.sin(el),
      target.z + dist * Math.cos(el) * Math.cos(az),
    );
    // the cell's membrane: fairly opaque from far away (or its thin dendrites vanish), see-through close up,
    // where its ER and spine apparatus show
    if (current === 'cell') {
      const f = THREE.MathUtils.smoothstep(Math.log(dist), Math.log(15), Math.log(250));
      for (const m of sc.pm) m.uniforms.uOpacity.value.set(0.08 + 0.27 * f, 0.6 + 0.25 * f);
    }
    camera.near = dist * 0.02;
    camera.far = dist * 40 + sc.size * 4;
    camera.lookAt(target);
    // on wide screens the mesh sits right of the text (not while exploring)
    const goalOffset = wide && !exploring ? 0.2 : 0;
    offset += (goalOffset - offset) * (1 - Math.exp(-dt * 4));
    const w = window.innerWidth, h = window.innerHeight;
    if (offset > 0.001) camera.setViewOffset(w, h, -offset * w, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  });
}
