// The TetraNeuron teaser (tetraneuron.html): one film of a real cell, a pure function of its time t, so chapters can jump
// and ?tnt=14 can hold a frame. The raw .swc is read in, its points settle, then a sphere grows the neuron from a point.
// Only centerlines come from the data (public/tetraneuron/, by scripts/build_tetraneuron.py); the tubes are drawn here.
import * as THREE from 'three';

const FOV = 32;
const ACT = { read: [0, 6.5], regularize: [6.5, 12], grow: [12, 24], done: [24, 30] };
const END = ACT.done[1];
const DIVE_END = 14;                 // the camera has reached the soma; the growth has begun a little before
const GROW_START = 13.4;
const SOMA_SHARE = 0.2;              // the part of the growth that goes to the soma itself
const NEAR_VIEW = 150, SOMA_VIEW = 62, SPHERE_VIEW = 5.2;    // camera distances, the last in growth radii
const MIN_TUBE_RADIUS = 0.6;
const TUBE_SIDES = 10;
// the shaders write these values straight to the screen, so they are not converted to linear
const shown = (hex) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);
const COLOR = { raw: shown(0xdfe6f2), deep: shown(0x2a6fc9), cyan: shown(0x6fd3ff), front: shown(0xffb347), soma: shown(0xf08a35) };
const CHAPTERS = {
  read: { name: 'Reading the raw .swc', still: 6.2 },
  regularize: { name: 'Regularizing', still: 11.6 },
  grow: { name: 'Growing from a point', still: 19 },
  done: { name: 'In development', still: 26 },
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, f) => a + (b - a) * f;
const logMix = (a, b, f) => Math.exp(mix(Math.log(a), Math.log(b), f));

function actAt(t) {
  return Object.keys(ACT).find((k) => t < ACT[k][1]) ?? 'done';
}

// ---------- shaders ----------
const MORPH_VERT = /* glsl */`
  attribute vec3 aStart; attribute float aAlong;
  uniform float uWave, uSize, uMaxAlong;
  varying float vSettled;
  void main() {
    vSettled = smoothstep(0.0, 0.22, uWave * 1.22 - sqrt(aAlong / uMaxAlong));
    vec3 p = mix(aStart, position, vSettled);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * mix(1.8, 1.0, vSettled);
  }`;
const MORPH_LINE_FRAG = /* glsl */`
  uniform float uAlpha, uGhost; uniform vec3 uFrom, uTo;
  varying float vSettled;
  void main() { gl_FragColor = vec4(mix(uFrom, uTo, vSettled), uAlpha * mix(0.12, uGhost, vSettled)); }`;
const MORPH_DOT_FRAG = /* glsl */`
  uniform float uAlpha; uniform vec3 uFrom, uTo, uFlash;
  varying float vSettled;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float flash = vSettled * (1.0 - vSettled) * 4.0;
    gl_FragColor = vec4(mix(mix(uFrom, uTo, vSettled), uFlash, flash), uAlpha * vSettled * smoothstep(1.0, 0.65, d));
  }`;

const TUBE_VERT = /* glsl */`
  attribute float aAlong, aRadius;
  uniform float uGrow, uTaper;
  varying float vAlong; varying vec3 vN, vV;
  void main() {
    vAlong = aAlong;
    // near the growing tip the tube narrows to its centerline, so it grows out rather than being cut off
    float s = smoothstep(0.0, uTaper, uGrow - aAlong);
    vec3 p = position - normal * aRadius * (1.0 - s);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalMatrix * normal; vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const TUBE_FRAG = /* glsl */`
  uniform float uGrow, uBand, uMaxAlong; uniform vec3 uDeep, uCyan, uFront;
  varying float vAlong; varying vec3 vN, vV;
  void main() {
    if (vAlong > uGrow) discard;
    vec3 n = normalize(vN), v = normalize(vV);
    if (!gl_FrontFacing) n = -n;
    float facing = max(dot(n, v), 0.0);
    float light = 0.42 + 0.58 * max(dot(n, normalize(vec3(0.35, 0.8, 0.5))), 0.0);
    vec3 c = mix(uDeep, uCyan, 0.25 + 0.75 * sqrt(vAlong / uMaxAlong)) * light;
    c += uCyan * pow(1.0 - facing, 2.5) * 0.75;
    c = mix(c, uFront * 1.2, smoothstep(uBand, uBand * 0.55, uGrow - vAlong));   // sharp: blue into amber goes through grey
    gl_FragColor = vec4(c, 1.0);
  }`;

const SOMA_FRAG = /* glsl */`
  uniform vec3 uCore, uRim;
  varying vec3 vN, vV;
  void main() {
    vec3 n = normalize(vN), v = normalize(vV);
    float facing = max(dot(n, v), 0.0);
    float light = 0.45 + 0.55 * max(dot(n, normalize(vec3(0.35, 0.8, 0.5))), 0.0);
    gl_FragColor = vec4(uCore * (0.55 + 0.6 * light) + uRim * pow(1.0 - facing, 2.5) * 0.7, 1.0);
  }`;
const SPHERE_VERT = /* glsl */`
  varying vec3 vN, vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalMatrix * normal; vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const SPHERE_FRAG = /* glsl */`
  uniform float uAlpha; uniform vec3 uColor;
  varying vec3 vN, vV;
  void main() {
    float f = 1.0 - max(dot(normalize(vN), normalize(vV)), 0.0);
    gl_FragColor = vec4(uColor, uAlpha * (0.02 + 0.45 * pow(f, 3.0) + 0.5 * pow(f, 14.0)));
  }`;

const GLOW_VERT = /* glsl */`
  attribute float aAlong;
  uniform float uGrow, uBand, uSize;
  varying float vHot;
  void main() {
    float behind = uGrow - aAlong;
    vHot = behind < 0.0 ? 0.0 : smoothstep(uBand, 0.0, behind);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * vHot;
  }`;
const GLOW_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uAlpha;
  varying float vHot;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    gl_FragColor = vec4(uColor, uAlpha * vHot * pow(max(1.0 - d, 0.0), 2.0));
  }`;
const SPARK_VERT = /* glsl */`
  uniform float uSize;
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }`;
const SPARK_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    gl_FragColor = vec4(uColor, uAlpha * pow(max(1.0 - d, 0.0), 2.4));
  }`;

// ---------- geometry ----------
function geometryOf(attributes) {
  const g = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(attributes)) g.setAttribute(name, attribute);
  return g;
}

/** Unbranched runs of a tree: each from a branch point, or the root, to the next branch point or tip */
function runs(parent) {
  const kids = parent.map(() => []);
  parent.forEach((p, i) => { if (p >= 0) kids[p].push(i); });
  const out = [];
  parent.forEach((p, i) => {
    if (p < 0 || (kids[p].length === 1 && parent[p] >= 0)) return;
    const run = [p, i];
    while (kids[run[run.length - 1]].length === 1) run.push(kids[run[run.length - 1]][0]);
    out.push(run);
  });
  return out;
}

/** Tubes along the runs; each vertex knows its distance along the dendrites and how far it is from its centerline */
function buildTubes(position, radius, parent, along, somaRadius) {
  const pos = [], nor = [], alo = [], rad = [], idx = [];
  const at = (i) => new THREE.Vector3(position[3 * i], position[3 * i + 1], position[3 * i + 2]);
  for (const run of runs(parent)) {
    const P = run.map(at);
    const first = pos.length / 3;
    // inside the soma the radii still run down from the soma's own: keep the tube thin there, or it pokes through the ball
    const exit = run.findIndex((i) => along[i] >= somaRadius * 1.15);
    const exitRadius = exit > 0 ? radius[run[exit]] : Infinity;
    let side = null;
    P.forEach((p, k) => {
      const tangent = P[Math.min(k + 1, P.length - 1)].clone().sub(P[Math.max(k - 1, 0)]).normalize();
      if (!side) side = new THREE.Vector3(Math.abs(tangent.x) < 0.9 ? 1 : 0, Math.abs(tangent.x) < 0.9 ? 0 : 1, 0);
      side.addScaledVector(tangent, -side.dot(tangent)).normalize();
      const other = tangent.clone().cross(side);
      const r = Math.max(k < exit ? Math.min(radius[run[k]], exitRadius) : radius[run[k]], MIN_TUBE_RADIUS);
      for (let j = 0; j < TUBE_SIDES; j++) {
        const a = (j / TUBE_SIDES) * Math.PI * 2;
        const n = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(other, Math.sin(a));
        pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
        nor.push(n.x, n.y, n.z);
        alo.push(along[run[k]]);
        rad.push(r);
      }
      if (k + 1 < P.length) {
        const ring = first + k * TUBE_SIDES;
        for (let j = 0; j < TUBE_SIDES; j++) {
          const a = ring + j, b = ring + (j + 1) % TUBE_SIDES;
          idx.push(a, b, a + TUBE_SIDES, b, b + TUBE_SIDES, a + TUBE_SIDES);
        }
      }
    });
  }
  const g = geometryOf({
    position: new THREE.Float32BufferAttribute(pos, 3), normal: new THREE.Float32BufferAttribute(nor, 3),
    aAlong: new THREE.Float32BufferAttribute(alo, 1), aRadius: new THREE.Float32BufferAttribute(rad, 1),
  });
  g.setIndex(idx);
  return g;
}

// ---------- the film ----------
export async function startTetraNeuronPage(canvas, { reducedMotion = false } = {}) {
  const cell = await fetch(`${import.meta.env.BASE_URL}tetraneuron/cell.json`).then((r) => r.json());
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch (e) {
    document.body.classList.add('no-webgl');
    return;
  }
  const dpr = Math.min(window.devicePixelRatio, 1.75);
  renderer.setPixelRatio(dpr);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 6000);

  const reg = cell.regularized, rows = cell.raw.rows;
  const maxAlong = Math.max(...reg.along);
  const somaRadius = reg.radius[0];
  const soma = new THREE.Vector3(reg.position[0], reg.position[1], reg.position[2]);

  // the raw neuron: revealed row by row, in file order
  const rawPos = [], segmentsBefore = [];
  rows.forEach((row, i) => {
    segmentsBefore.push(rawPos.length / 3);
    const p = cell.raw.parent[i];
    if (p >= 0) rawPos.push(row[2], row[3], row[4], rows[p][2], rows[p][3], rows[p][4]);
  });
  const rawLines = new THREE.LineSegments(
    geometryOf({ position: new THREE.Float32BufferAttribute(rawPos, 3) }),
    new THREE.LineBasicMaterial({ color: COLOR.raw, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  const rawDots = new THREE.Points(
    geometryOf({ position: new THREE.Float32BufferAttribute(rows.flatMap((r) => [r[2], r[3], r[4]]), 3) }),
    new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 4.2 * dpr }, uColor: { value: COLOR.raw }, uAlpha: { value: 1 } },
      vertexShader: SPARK_VERT,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uAlpha;
        void main() { float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(uColor, uAlpha * smoothstep(1.0, 0.6, d)); }`,
      transparent: true, depthWrite: false,
    }),
  );

  // the regularized neuron: starts on the raw polyline, settles in a wave from the soma, then stays as a faint guide
  const morph = { uWave: { value: 0 }, uMaxAlong: { value: maxAlong }, uFrom: { value: COLOR.raw }, uTo: { value: COLOR.cyan } };
  const regAttributes = {
    position: new THREE.Float32BufferAttribute(reg.position, 3),
    aStart: new THREE.Float32BufferAttribute(reg.start, 3),
    aAlong: new THREE.Float32BufferAttribute(reg.along, 1),
  };
  const regLineGeometry = geometryOf(regAttributes);
  const lineIndex = [];
  reg.parent.forEach((p, i) => { if (p >= 0) lineIndex.push(p, i); });
  regLineGeometry.setIndex(lineIndex);
  const regLines = new THREE.LineSegments(regLineGeometry, new THREE.ShaderMaterial({
    uniforms: { ...morph, uSize: { value: 1 }, uAlpha: { value: 0 }, uGhost: { value: 1 } },
    vertexShader: MORPH_VERT, fragmentShader: MORPH_LINE_FRAG, transparent: true, depthWrite: false,
  }));
  const regDots = new THREE.Points(geometryOf(regAttributes), new THREE.ShaderMaterial({
    uniforms: { ...morph, uSize: { value: 4.4 * dpr }, uAlpha: { value: 0 }, uFlash: { value: COLOR.front } },
    vertexShader: MORPH_VERT, fragmentShader: MORPH_DOT_FRAG, transparent: true, depthWrite: false,
  }));

  // the grown neuron
  const growth = { uGrow: { value: 0 }, uBand: { value: 3 }, uMaxAlong: { value: maxAlong } };
  const tubes = new THREE.Mesh(buildTubes(reg.position, reg.radius, reg.parent, reg.along, somaRadius), new THREE.ShaderMaterial({
    uniforms: { ...growth, uTaper: { value: 6 }, uDeep: { value: COLOR.deep }, uCyan: { value: COLOR.cyan }, uFront: { value: COLOR.front } },
    vertexShader: TUBE_VERT, fragmentShader: TUBE_FRAG, side: THREE.DoubleSide,
  }));
  const somaBall = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.ShaderMaterial({
    uniforms: { uCore: { value: COLOR.soma }, uRim: { value: COLOR.front } },
    vertexShader: SPHERE_VERT, fragmentShader: SOMA_FRAG,
  }));
  somaBall.position.copy(soma);

  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 0 }, uColor: { value: COLOR.front } },
    vertexShader: SPHERE_VERT, fragmentShader: SPHERE_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  sphere.position.copy(soma);

  const tips = new THREE.Points(geometryOf(regAttributes), new THREE.ShaderMaterial({
    uniforms: { ...growth, uSize: { value: 15 * dpr }, uColor: { value: COLOR.front }, uAlpha: { value: 0.75 } },
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));

  // one bright point: the row being read, then the spark the growth starts from
  const spark = new THREE.Points(
    geometryOf({ position: new THREE.Float32BufferAttribute([0, 0, 0], 3) }),
    new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 30 * dpr }, uColor: { value: COLOR.front }, uAlpha: { value: 0 } },
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );

  const film = [rawLines, rawDots, regLines, regDots, tubes, somaBall, sphere, tips, spark];
  film.forEach((o) => { o.frustumCulled = false; scene.add(o); });
  regLines.renderOrder = 1; regDots.renderOrder = 2; sphere.renderOrder = 3; tips.renderOrder = 4; spark.renderOrder = 5;

  // ---------- the views ----------
  const box = new THREE.Box3();
  for (let i = 0; i < reg.position.length; i += 3) box.expandByPoint(new THREE.Vector3(reg.position[i], reg.position[i + 1], reg.position[i + 2]));
  const size = box.getSize(new THREE.Vector3());
  // a little above the cell's middle, so the whole cell sits clear below the nav bar
  const wholeTarget = box.getCenter(new THREE.Vector3()).addScaledVector(new THREE.Vector3(0, 1, 0), size.y * 0.03);
  let wholeView = 1;
  let aspect = 1, wide = true;
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    wide = aspect > 1.1;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    wholeView = Math.max((size.y * 0.66) / tan, (size.x * 0.62) / (tan * (wide ? aspect * 0.62 : aspect)));
  }
  resize();
  window.addEventListener('resize', resize);

  /** How far the neuron has grown at time t: the soma from nothing, then out, each second covering more distance */
  function growthAt(t) {
    if (t >= ACT.grow[1]) return maxAlong * 1.05;
    const g = clamp01((t - GROW_START) / (ACT.grow[1] - GROW_START));
    if (g <= 0) return 0;
    if (g < SOMA_SHARE) return somaRadius * smooth(0, 1, g / SOMA_SHARE);
    const u = (g - SOMA_SHARE) / (1 - SOMA_SHARE);
    return somaRadius * Math.pow((maxAlong * 1.05) / somaRadius, u);
  }

  /** The camera at time t: the whole cell, nearer the soma to see the points settle, into the soma, out with the sphere */
  function viewAt(t, grow) {
    if (t < ACT.regularize[0]) return { target: wholeTarget, dist: logMix(wholeView * 1.12, wholeView, smooth(0, ACT.read[1], t)), el: 0.08 };
    if (t < ACT.grow[0]) {
      const f = smooth(ACT.regularize[0], ACT.regularize[0] + 2.4, t);
      return { target: wholeTarget.clone().lerp(soma, f), dist: logMix(wholeView, NEAR_VIEW, f), el: mix(0.08, 0.18, f) };
    }
    if (t < DIVE_END) return { target: soma, dist: logMix(NEAR_VIEW, SOMA_VIEW, smooth(ACT.grow[0], DIVE_END, t)), el: 0.18 };
    const dist = Math.min(wholeView, Math.max(SOMA_VIEW, grow * SPHERE_VIEW));
    const out = (Math.log(dist) - Math.log(SOMA_VIEW)) / (Math.log(wholeView) - Math.log(SOMA_VIEW));
    return { target: soma.clone().lerp(wholeTarget, smooth(0.15, 1, out)), dist, el: mix(0.18, 0.08, out) };
  }

  // ---------- the page around the film ----------
  const label = document.getElementById('sb-scene-name');
  const reader = document.getElementById('tn-reader');
  const chapterButtons = [...document.querySelectorAll('[data-chapter]')];
  const pauseButton = document.getElementById('tn-pause');
  let shownRow = -1, shownAct = null;

  function showRows(n) {
    if (n === shownRow) return;
    shownRow = n;
    const lines = [];
    for (let i = Math.max(0, n - 7); i < n; i++) {
      const [id, type, x, y, z, r, parent] = rows[i];
      const line = [String(id).padStart(3), type, x.toFixed(2).padStart(7), y.toFixed(2).padStart(7), z.toFixed(2).padStart(7), r.toFixed(2).padStart(5), String(parent).padStart(3)].join(' ');
      lines.push(i === n - 1 ? `<b>${line}</b>` : line);
    }
    reader.querySelector('code').innerHTML = lines.join('\n');
  }

  function showAct(t) {
    const act = actAt(t);
    if (act !== shownAct) {
      shownAct = act;
      label.textContent = CHAPTERS[act].name;
      chapterButtons.forEach((b) => {
        const on = b.dataset.chapter === act;
        b.classList.toggle('active', on);
        if (on) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      });
      reader.classList.toggle('on', act === 'read');
    }
    const [from, to] = ACT[act];
    chapterButtons.find((b) => b.dataset.chapter === act)?.style.setProperty('--p', clamp01((t - from) / (to - from)).toFixed(3));
  }

  // ---------- the user's turn: drag where there is no text ----------
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
  const endDrag = () => { drag = null; document.body.classList.remove('sb-dragging'); };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  // ---------- one frame ----------
  function draw(t) {
    // the raw neuron
    const read = clamp01((t - 0.5) / (ACT.read[1] - 1));
    const rowsRead = Math.round(read * rows.length);
    rawDots.geometry.setDrawRange(0, rowsRead);
    rawLines.geometry.setDrawRange(0, rowsRead ? segmentsBefore[rowsRead - 1] : 0);
    const rawFade = 1 - smooth(ACT.regularize[0] + 1.2, ACT.regularize[0] + 3.6, t);
    rawLines.material.opacity = 0.55 * rawFade;
    rawDots.material.uniforms.uAlpha.value = rawFade;
    rawLines.visible = rawDots.visible = rawFade > 0;
    if (t < ACT.read[1]) showRows(rowsRead);

    // the points settle
    const fadeGuide = 1 - smooth(ACT.done[0] - 2.5, ACT.done[0], t);
    morph.uWave.value = smooth(ACT.regularize[0] + 0.8, ACT.regularize[1] - 0.3, t);
    regLines.material.uniforms.uAlpha.value = smooth(ACT.regularize[0], ACT.regularize[0] + 0.6, t) * fadeGuide;
    regLines.material.uniforms.uGhost.value = mix(1, 0.22, smooth(ACT.grow[0], DIVE_END, t));
    regDots.material.uniforms.uAlpha.value = 1 - smooth(ACT.grow[0], ACT.grow[0] + 1.2, t);
    regLines.visible = t >= ACT.regularize[0] && fadeGuide > 0;
    regDots.visible = t >= ACT.regularize[0] && t < ACT.grow[0] + 1.2;

    // the growth
    const grow = growthAt(t);
    growth.uGrow.value = grow;
    growth.uBand.value = Math.max(1.8, grow * 0.04);
    tubes.material.uniforms.uTaper.value = Math.max(2, grow * 0.03);
    const growing = grow > 0;
    tubes.visible = grow > somaRadius * 0.9;
    tips.visible = grow > somaRadius && t < ACT.grow[1];
    somaBall.visible = growing;
    somaBall.scale.setScalar(Math.max(0.001, Math.min(grow, somaRadius)));
    const sphereAlong = grow / maxAlong;
    const sphereAlpha = (1 - smooth(0.62, 1, sphereAlong)) * (growing ? 1 : 0);
    sphere.visible = sphereAlpha > 0;
    sphere.scale.setScalar(Math.max(0.01, grow * 1.04));   // never on the soma's own surface, which would flicker
    sphere.material.uniforms.uAlpha.value = sphereAlpha;

    // the bright point
    if (t < ACT.read[1] && rowsRead > 0) {
      const row = rows[rowsRead - 1];
      spark.position.set(row[2], row[3], row[4]);
      spark.material.uniforms.uAlpha.value = rowsRead < rows.length ? 1 : 0;
      spark.material.uniforms.uSize.value = 26 * dpr;
    } else if (t >= DIVE_END - 1.4) {
      spark.position.copy(soma);
      const ignite = smooth(DIVE_END - 1.4, GROW_START, t) * (1 - smooth(GROW_START + 0.4, GROW_START + 1.6, t));
      spark.material.uniforms.uAlpha.value = ignite;
      spark.material.uniforms.uSize.value = mix(60, 190, smooth(DIVE_END - 1.4, GROW_START + 0.5, t)) * dpr;
    } else {
      spark.material.uniforms.uAlpha.value = 0;
    }

    // the camera; it keeps slowly turning, the same at any time of the film
    const view = viewAt(t, grow);
    const az = (reducedMotion ? 0.5 : 0.35 + t * 0.045) + user.az;
    const el = THREE.MathUtils.clamp(view.el + user.el, -1.3, 1.3);
    const d = view.dist;
    camera.position.set(
      view.target.x + d * Math.cos(el) * Math.sin(az),
      view.target.y + d * Math.sin(el),
      view.target.z + d * Math.cos(el) * Math.cos(az),
    );
    camera.near = d * 0.02; camera.far = d * 30 + 2000;
    camera.lookAt(view.target);
    const w = window.innerWidth, h = window.innerHeight;
    // wide: right of the text; narrow: below the title, in the gap the page leaves for it
    if (wide) camera.setViewOffset(w, h, -0.2 * w, 0, w, h); else camera.setViewOffset(w, h, 0, -0.06 * h, w, h);
    camera.updateProjectionMatrix();

    canvas.style.opacity = reducedMotion ? 1 : smooth(0, 0.6, t) * (1 - smooth(END - 0.9, END, t));
    showAct(t);
    renderer.render(scene, camera);
  }

  // ---------- play ----------
  const held = new URLSearchParams(location.search).get('tnt');   // ?tnt=14 holds that second of the film
  let time = held != null ? Number(held) : reducedMotion ? CHAPTERS.done.still : 0;
  let playing = held == null && !reducedMotion;
  function showPlaying() {
    pauseButton.textContent = playing ? 'Pause' : 'Play';
    pauseButton.setAttribute('aria-label', playing ? 'Pause the film' : 'Play the film');
  }
  showPlaying();
  pauseButton.addEventListener('click', () => { playing = !playing; showPlaying(); });
  chapterButtons.forEach((b) => b.addEventListener('click', () => {
    const chapter = b.dataset.chapter;
    // with reduced motion each chapter is one still; otherwise the film carries on from the chapter's start
    time = reducedMotion ? CHAPTERS[chapter].still : ACT[chapter][0] + (chapter === 'read' ? 0 : 0.01);
  }));

  const recording = document.getElementById('tn-film');
  new IntersectionObserver(([e]) => document.body.classList.toggle('tn-watching', e.isIntersecting), { threshold: 0.2 }).observe(recording);

  canvas.style.transition = 'none';
  document.body.classList.add('sb-ready');
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (playing) time = (time + dt) % END;
    draw(time);
  });
}
