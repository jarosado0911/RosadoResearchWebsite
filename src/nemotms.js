// The NeMo-TMS page (nemotms.html). Data in public/nemotms/, by scripts/build_nemotms.py.
// - The background replays one run of the toolbox's sample cell: its voltage, then the passive calcium that follows,
//   glowing across the whole cell (no ER; the same mechanisms on the axon as elsewhere; see scripts/nemotms_whole_cell.py).
// - Two charts of the soma follow the same playhead; dragging on them moves it.
// - "Aim the field": the toolbox's uniform-field formula (calcVe.hoc) on three of its morphologies, live.
// - "The pulse": its two recorded pulse shapes and the paper's rTMS protocols.
// - "The calcium model": what vdccFullCellCalcium.lua puts on the membrane, part by part.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { renderMath } from './math.js';

const BASE = `${import.meta.env.BASE_URL}nemotms/`;
const FOV = 32;
const SIDES = 8;
const PLAY_S = { v: 13, ca: 16 };   // real seconds to play each
const HOLD_S = 1.4;
const COLORS = { v: '#cc8119', ca: '#2f9fde', mono: '#cc8119', bi: '#2f9fde' };   // validated pair (dataviz validate_palette.js)
const HOT = { v: new THREE.Color(0xffb347), ca: new THREE.Color(0x6fd3ff) };
const NAME = { v: 'Membrane voltage', ca: 'Cytosolic calcium' };

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const json = (name) => fetch(BASE + name).then((r) => r.json());

// ---------- the background ----------
function buildTubes(run) {
  const n = run.parent.length;
  const kids = run.parent.map(() => []);
  run.parent.forEach((p, i) => { if (p >= 0) kids[p].push(i); });
  const at = (i) => new THREE.Vector3(run.position[3 * i], run.position[3 * i + 1], run.position[3 * i + 2]);
  const pos = [], nor = [], rad = [], node = [], idx = [];
  for (let start = 0; start < n; start++) {
    const p = run.parent[start];
    if (p < 0 || (kids[p].length === 1 && run.parent[p] >= 0)) continue;
    if (run.type[p] === 1 && run.type[start] === 1) continue;    // the soma is the ball below
    const chain = [p, start];
    while (kids[chain[chain.length - 1]].length === 1) chain.push(kids[chain[chain.length - 1]][0]);
    const P = chain.map(at), first = pos.length / 3;
    let side = null;
    P.forEach((q, k) => {
      const t = P[Math.min(k + 1, P.length - 1)].clone().sub(P[Math.max(k - 1, 0)]).normalize();
      if (!side) side = Math.abs(t.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      side.addScaledVector(t, -side.dot(t)).normalize();
      const other = t.clone().cross(side);
      for (let j = 0; j < SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const v = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(other, Math.sin(a));
        pos.push(q.x, q.y, q.z); nor.push(v.x, v.y, v.z);
        // a tube leaving the soma starts at its own radius, not the soma's
        rad.push(run.radius[run.type[chain[k]] === 1 ? chain[1] : chain[k]]); node.push(chain[k]);
      }
      if (k + 1 < P.length) {
        const ring = first + k * SIDES;
        for (let j = 0; j < SIDES; j++) {
          const a = ring + j, b = ring + (j + 1) % SIDES;
          idx.push(a, b, a + SIDES, b, b + SIDES, a + SIDES);
        }
      }
    });
  }
  const ball = new THREE.SphereGeometry(1, 32, 22), first = pos.length / 3, center = at(run.soma);
  for (let i = 0; i < ball.attributes.position.count; i++) {
    pos.push(center.x, center.y, center.z);
    nor.push(ball.attributes.normal.getX(i), ball.attributes.normal.getY(i), ball.attributes.normal.getZ(i));
    rad.push(run.radius[run.soma]); node.push(run.soma);
  }
  ball.index.array.forEach((i) => idx.push(first + i));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aRadius', new THREE.Float32BufferAttribute(rad, 1));
  const val = new THREE.BufferAttribute(new Float32Array(node.length), 1);
  val.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aVal', val);
  g.setIndex(idx);
  return { geometry: g, node, val };
}

function startBackground(canvas, run, replay, { reducedMotion, onFrame }) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch (e) {
    document.body.classList.add('no-webgl');
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 20000);

  const tubes = buildTubes(run);
  const material = new THREE.ShaderMaterial({
    uniforms: { uMinRadius: { value: 2 }, uHot: { value: HOT.v.clone() }, uFrom: { value: 0.3 } },
    vertexShader: /* glsl */`
      attribute float aRadius, aVal;
      uniform float uMinRadius;
      varying float vVal; varying vec3 vN, vV;
      void main() {
        vVal = aVal;
        vec4 mv = modelViewMatrix * vec4(position + normal * max(aRadius, uMinRadius), 1.0);
        vN = normalMatrix * normal; vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uHot; uniform float uFrom;
      varying float vVal; varying vec3 vN, vV;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float glow = smoothstep(uFrom, 1.0, vVal);
        vec3 glass = vec3(0.42, 0.56, 0.86) * (0.05 + 0.34 * rim);
        gl_FragColor = vec4(glass * (1.0 - glow) + uHot * glow * (0.7 + 0.6 * rim), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(tubes.geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const box = new THREE.Box3();
  for (let i = 0; i < run.position.length; i += 3) box.expandByPoint(new THREE.Vector3(run.position[i], run.position[i + 1], run.position[i + 2]));
  const whole = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());

  let wide = true, wholeView = 1;
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    wide = camera.aspect > 1.1;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    wholeView = Math.max((Math.max(size.y, size.z) * 0.6) / tan, (size.x * 0.6) / (tan * camera.aspect * (wide ? 0.62 : 1)));
  }
  resize();
  window.addEventListener('resize', resize);

  // drag where there is no content
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
    user.el = clamp(user.el + (e.clientY - drag.y) * 0.005, -1.2, 1.2);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const endDrag = () => { drag = null; document.body.classList.remove('sb-dragging'); };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  const n = run.parent.length, lastMs = (run.frames - 1) * run.frameMs;
  const endOf = (mode) => (mode === 'v' ? run.vEndMs : lastMs);   // voltage is only shown while it is the saved one
  const params = new URLSearchParams(location.search);
  const held = params.has('ntt');                 // ?ntt=1.2&ntm=ca holds that moment
  const film = {
    mode: params.get('ntm') === 'ca' || (reducedMotion && !held) ? 'ca' : 'v',
    ms: held ? clamp(Number(params.get('ntt')), 0, lastMs) : reducedMotion ? 2.2 : 0,
    playing: !held && !reducedMotion,
    hold: 0,
  };
  const cam = { target: whole.clone(), logDist: 0, ready: false };
  let spin = 0, shown = null;

  function setValues() {
    const f = clamp(film.ms / run.frameMs, 0, run.frames - 1);
    const a = Math.floor(f), b = Math.min(a + 1, run.frames - 1), w = f - a;
    const offset = film.mode === 'v' ? 0 : run.frames * n;
    const arr = tubes.val.array;
    for (let i = 0; i < tubes.node.length; i++) {
      const k = tubes.node[i];
      arr[i] = (replay[offset + a * n + k] * (1 - w) + replay[offset + b * n + k] * w) / 255;
    }
    tubes.val.needsUpdate = true;
  }

  const api = {
    film, lastMs,
    set(mode, ms) {
      film.mode = mode; film.ms = clamp(ms, 0, endOf(mode)); film.hold = 0;
    },
  };

  document.body.classList.add('sb-ready');
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (film.playing) {
      if (film.hold > 0) {
        film.hold -= dt;
        if (film.hold <= 0) { film.mode = film.mode === 'v' ? 'ca' : 'v'; film.ms = 0; }
      } else {
        film.ms += (dt / PLAY_S[film.mode]) * endOf(film.mode);
        if (film.ms >= endOf(film.mode)) { film.ms = endOf(film.mode); film.hold = HOLD_S; }
      }
      if (!reducedMotion && !drag) spin += dt * 0.05;
    }
    setValues();
    if (shown !== film.mode) {
      shown = film.mode;
      material.uniforms.uHot.value.copy(HOT[film.mode]);
      material.uniforms.uFrom.value = film.mode === 'v' ? 0.3 : 0.04;
    }
    const k = cam.ready ? 1 - Math.exp(-dt * 2.2) : 1;
    cam.target.lerp(whole, k);
    cam.logDist = cam.ready ? cam.logDist + (Math.log(wholeView) - cam.logDist) * k : Math.log(wholeView);
    cam.ready = true;
    const d = Math.exp(cam.logDist), az = 0.5 + spin + user.az, el = clamp(0.1 + user.el, -1.3, 1.3);
    camera.position.set(cam.target.x + d * Math.cos(el) * Math.sin(az), cam.target.y + d * Math.sin(el), cam.target.z + d * Math.cos(el) * Math.cos(az));
    camera.near = d * 0.02; camera.far = d * 30 + 3000;
    camera.lookAt(cam.target);
    const w = window.innerWidth, h = window.innerHeight;
    if (wide) camera.setViewOffset(w, h, -0.2 * w, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    material.uniforms.uMinRadius.value = (d * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * 2 * 1.1) / h;
    renderer.render(scene, camera);
    onFrame(film);
  });
  return api;
}

// ---------- charts (inline SVG: one y-axis each, 2 px lines, crosshair and tooltip) ----------
const SVG = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}

/** series: [{ label, color, y: [..] }] over shared x. onPick(x) makes a click or drag choose a time. */
function lineChart(root, { x, series, yTicks, xTicks, yLabel, xLabel, format, width = 620, height = 170, onPick, ends = false, approxFrom = null }) {
  const W = width, H = height, m = { l: 46, r: ends ? 84 : 14, t: 26, b: 28 };
  const px = (v) => m.l + ((v - x[0]) / (x[x.length - 1] - x[0])) * (W - m.l - m.r);
  const yMin = yTicks[0], yMax = yTicks[yTicks.length - 1];
  const py = (v) => H - m.b - ((v - yMin) / (yMax - yMin)) * (H - m.t - m.b);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'nt-svg', role: 'img', 'aria-label': `${yLabel} against ${xLabel}` }, root);
  yTicks.forEach((v) => {
    svgEl('line', { x1: m.l, x2: W - m.r, y1: py(v), y2: py(v), class: 'nt-grid' }, svg);
    svgEl('text', { x: m.l - 8, y: py(v) + 4, 'text-anchor': 'end', class: 'nt-axis' }, svg).textContent = v;
  });
  xTicks.forEach((v) => { svgEl('text', { x: px(v), y: H - 9, 'text-anchor': 'middle', class: 'nt-axis' }, svg).textContent = v; });
  svgEl('text', { x: W - m.r, y: H - 9, 'text-anchor': 'end', class: 'nt-axis nt-axis-unit' }, svg).textContent = xLabel;
  svgEl('text', { x: 0, y: 13, class: 'nt-axis nt-axis-unit' }, svg).textContent = yLabel;
  if (approxFrom != null) {
    svgEl('line', { x1: px(approxFrom), x2: px(approxFrom), y1: m.t, y2: H - m.b, class: 'nt-grid' }, svg);
    svgEl('text', { x: px(approxFrom) + 6, y: m.t + 11, class: 'nt-axis nt-axis-unit' }, svg).textContent = 'approximate voltage from here';
  }
  series.forEach((s) => {
    const split = approxFrom == null ? x.length : x.findIndex((v) => v >= approxFrom) + 1;
    const line = (a, b, attrs = {}) => svgEl('polyline', { points: x.slice(a, b).map((v, i) => `${px(v).toFixed(1)},${py(s.y[a + i]).toFixed(1)}`).join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', ...attrs }, svg);
    line(0, split);
    if (split < x.length) line(split - 1, x.length, { 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' });
    if (ends) svgEl('text', { x: W - m.r + 8, y: py(s.endY ?? s.y[s.y.length - 1]) + 4, class: 'nt-axis nt-label' }, svg).textContent = s.label;
  });
  const cross = svgEl('line', { y1: m.t, y2: H - m.b, class: 'nt-cross', visibility: 'hidden' }, svg);
  const head = onPick ? svgEl('line', { y1: m.t, y2: H - m.b, class: 'nt-head' }, svg) : null;
  const dots = series.map((s) => svgEl('circle', { r: 4.5, fill: s.color, stroke: '#05070d', 'stroke-width': 2, visibility: 'hidden' }, svg));
  const hit = svgEl('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H - m.b, fill: 'transparent', class: 'nt-hit' }, svg);
  const tip = document.createElement('div');
  tip.className = 'nt-tip';
  root.appendChild(tip);

  const indexAt = (e) => {
    const r = svg.getBoundingClientRect();
    const v = x[0] + (((e.clientX - r.left) * (W / r.width) - m.l) / (W - m.l - m.r)) * (x[x.length - 1] - x[0]);
    let lo = 0, hi = x.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (x[mid] < v) lo = mid; else hi = mid; }
    return v - x[lo] < x[hi] - v ? lo : hi;
  };
  function hover(e) {
    const i = indexAt(e);
    cross.setAttribute('x1', px(x[i])); cross.setAttribute('x2', px(x[i])); cross.setAttribute('visibility', 'visible');
    dots.forEach((d, k) => { d.setAttribute('cx', px(x[i])); d.setAttribute('cy', py(series[k].y[i])); d.setAttribute('visibility', 'visible'); });
    tip.innerHTML = format(i);
    tip.classList.add('on');
    const box = root.getBoundingClientRect(), r = svg.getBoundingClientRect();
    const left = (px(x[i]) / W) * r.width;
    tip.style.left = `${clamp(left + 12, 0, box.width - tip.offsetWidth)}px`;
    if (left + 12 + tip.offsetWidth > box.width) tip.style.left = `${Math.max(0, left - tip.offsetWidth - 12)}px`;
    return i;
  }
  const leave = () => {
    tip.classList.remove('on');
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
  };
  let picking = false;
  hit.addEventListener('pointermove', (e) => { const i = hover(e); if (picking && onPick) onPick(x[i]); });
  hit.addEventListener('pointerleave', () => { picking = false; leave(); });
  if (onPick) {
    hit.addEventListener('pointerdown', (e) => { picking = true; onPick(x[hover(e)]); });
    window.addEventListener('pointerup', () => { picking = false; });
  }
  return { setHead(v) { if (head) { head.setAttribute('x1', px(v)); head.setAttribute('x2', px(v)); } } };
}

function startRunCharts(run, bg) {
  const ms = run.somaV.map((_, i) => +(i * run.frameMs).toFixed(3));
  const fmtMs = (i) => `${ms[i].toFixed(2)} ms`;
  const row = (i) => `<b>${fmtMs(i)}</b><span>Soma ${run.somaV[i].toFixed(1)} mV</span><span>Soma ${run.somaCa[i].toFixed(3)} µM</span><span>Axon median ${run.axonCa[i].toFixed(3)} µM</span>`;
  const xTicks = [0, 2, 4, 6, 8, 10];
  const approxFrom = run.vEndMs;
  const pick = (mode) => (v) => {
    if (!bg) return;
    bg.film.playing = false;
    bg.set(mode, v);
    syncPause();
  };
  const v = lineChart(document.getElementById('nt-chart-v'), {
    x: ms, series: [{ label: 'Soma', color: COLORS.v, y: run.somaV }], yTicks: [-80, -40, 0, 40], ends: true, approxFrom,
    xTicks, yLabel: 'Voltage (mV)', xLabel: 'ms', format: row, onPick: pick('v'),
  });
  const ca = lineChart(document.getElementById('nt-chart-ca'), {
    x: ms, ends: true, approxFrom,
    series: [{ label: 'Soma', color: COLORS.ca, y: run.somaCa, endY: 0.16 }, { label: 'Axon', color: COLORS.mono, y: run.axonCa, endY: 0.03 }],
    yTicks: [0, 0.25, 0.5, 0.75, 1], xTicks, yLabel: 'Calcium (µM)', xLabel: 'ms', format: row, onPick: pick('ca'),
  });
  const body = document.getElementById('nt-run-table');
  body.innerHTML = ms.filter((_, i) => i % 20 === 0).map((t, j) => `<tr><td>${t.toFixed(2)}</td><td>${run.somaV[j * 20].toFixed(1)}</td><td>${run.somaCa[j * 20].toFixed(3)}</td><td>${run.axonCa[j * 20].toFixed(3)}</td></tr>`).join('');

  const pauseBtn = document.getElementById('nt-pause');
  const modeBtns = [...document.querySelectorAll('[data-nt-mode]')];
  function syncPause() {
    pauseBtn.textContent = bg?.film.playing ? 'Pause' : 'Play';
    pauseBtn.setAttribute('aria-label', bg?.film.playing ? 'Pause the replay' : 'Play the replay');
  }
  if (!bg) return { update() {}, syncPause };
  pauseBtn.addEventListener('click', () => { bg.film.playing = !bg.film.playing; syncPause(); });
  modeBtns.forEach((b) => b.addEventListener('click', () => {
    bg.set(b.dataset.ntMode, bg.film.playing ? 0 : bg.film.ms);
  }));
  syncPause();
  const label = document.getElementById('sb-scene-name'), time = document.getElementById('nt-time');
  const low = document.getElementById('nt-scale-low'), high = document.getElementById('nt-scale-high'), bar = document.getElementById('nt-scale');
  let mode = null;
  return {
    update(film) {
      v.setHead(film.ms); ca.setHead(film.ms);
      time.textContent = `t = ${film.ms.toFixed(2)} ms`;
      if (film.mode !== mode) {
        mode = film.mode;
        label.textContent = NAME[mode];
        low.textContent = mode === 'v' ? `${run.vRange[0]} mV` : `${run.caRange[0].toFixed(2)} µM`;
        high.textContent = mode === 'v' ? `+${run.vRange[1]} mV` : `${run.caRange[1].toFixed(1)}+ µM`;
        bar.dataset.mode = mode;
        modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.ntMode === mode));
      }
    },
    syncPause,
  };
}

// ---------- aim the field ----------
const MORPH_NOTE = {
  ca1: 'Rat CA1 pyramidal cell, one of ten the toolbox ships.',
  l23: 'Human layer 2/3 pyramidal cell, with its long myelinated axon.',
  l5: 'Human layer 5 pyramidal cell, the largest of the three.',
};

function startField(root) {
  const canvas = root.querySelector('canvas');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (e) { root.classList.add('builder-failed'); return; }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 30000);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, enablePan: false, enableZoom: false, autoRotate: !reduced, autoRotateSpeed: 0.5 });

  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false }));
  lines.frustumCulled = false;
  const soma = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xc7cfdd }));
  const marker = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)), new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 20 * renderer.getPixelRatio() } },
    vertexShader: 'uniform float uSize; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }',
    fragmentShader: 'void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float ring = smoothstep(0.62, 0.72, d) * smoothstep(1.0, 0.9, d); gl_FragColor = vec4(1.0, 1.0, 1.0, max(ring, smoothstep(0.3, 0.2, d))); }',
    transparent: true, depthTest: false,
  }));
  marker.frustumCulled = false;
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0xffffff);
  scene.add(lines, soma, marker, arrow);

  const state = { cell: 'ca1', tilt: 0, turn: 0, amp: 275 };
  const cache = {};
  let cell = null;
  const out = root.querySelector('.nt-field-out'), note = root.querySelector('.nt-field-note');
  const scaleHigh = root.querySelector('.nt-field-high'), scaleLow = root.querySelector('.nt-field-low');
  const sliders = {};
  root.querySelectorAll('input[data-field]').forEach((input) => {
    const key = input.dataset.field;
    sliders[key] = input;
    input.addEventListener('input', () => { state[key] = +input.value; update(); markPreset(); });
  });
  const presetBtns = [...root.querySelectorAll('[data-preset]')];
  function markPreset() {
    presetBtns.forEach((b) => b.classList.toggle('active', +b.dataset.tilt === state.tilt && +b.dataset.amp === state.amp && state.turn === 0));
  }
  presetBtns.forEach((b) => b.addEventListener('click', () => {
    Object.assign(state, { tilt: +b.dataset.tilt, amp: +b.dataset.amp, turn: 0 });
    for (const k of ['tilt', 'turn', 'amp']) sliders[k].value = state[k];
    update(); markPreset();
  }));

  function direction() {
    const t = THREE.MathUtils.degToRad(state.tilt), p = THREE.MathUtils.degToRad(state.turn);
    return new THREE.Vector3(Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p));
  }

  function prepare(doc) {
    const n = doc.parent.length, kids = new Int32Array(n);
    doc.parent.forEach((p) => { if (p >= 0) kids[p]++; });
    const tips = [];
    let max = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(doc.position[3 * i], doc.position[3 * i + 1], doc.position[3 * i + 2]);
      max = Math.max(max, r);
      if (!doc.axon[i] || kids[i] > 0) continue;
      let b = i;
      while (doc.parent[b] >= 0 && (b === i || kids[b] === 1)) b = doc.parent[b];
      tips.push({ i, r, v: [0, 1, 2].map((a) => doc.position[3 * i + a] - doc.position[3 * b + a]) });
    }
    const segs = [];
    doc.parent.forEach((p, i) => { if (p >= 0) segs.push(i, p); });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(doc.position, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setIndex(segs);
    return { doc, n, tips, max, geometry: g };
  }

  const warm = new THREE.Color(0xffb347), cool = new THREE.Color(0x4f9dff), mid = new THREE.Color(0x5d6677), c = new THREE.Color();
  warm.convertSRGBToLinear(); cool.convertSRGBToLinear(); mid.convertSRGBToLinear();
  function update() {
    root.querySelectorAll('output[data-for]').forEach((o) => {
      const k = o.dataset.for;
      o.textContent = k === 'amp' ? `${state.amp} V/m` : `${state[k]}°`;
    });
    // along the axis (tilt 0 or 180) the field has no sideways part, so turning around the axis cannot change it
    const onAxis = state.tilt === 0 || state.tilt === 180;
    sliders.turn.disabled = onAxis;
    root.querySelector('.nt-turn-row').classList.toggle('off', onAxis);
    root.querySelector('.nt-turn-hint').hidden = !onAxis;
    if (!cell) return;
    const e = direction();
    const { doc, n } = cell, colors = cell.geometry.attributes.color;
    const psi = new Float32Array(n);
    let top = 1e-6, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      // calcVe.hoc: Ve [mV] = -(E . r), with E in V/m and r in um, times 1e-3
      const v = -(e.x * doc.position[3 * i] + e.y * doc.position[3 * i + 1] + e.z * doc.position[3 * i + 2]) * state.amp * 1e-3;
      psi[i] = v;
      top = Math.max(top, Math.abs(v)); lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    for (let i = 0; i < n; i++) {
      const f = psi[i] / top;
      c.copy(mid).lerp(f > 0 ? warm : cool, Math.pow(Math.abs(f), 0.7));
      colors.setXYZ(i, c.r, c.g, c.b);
    }
    colors.needsUpdate = true;
    let best = cell.tips[0], score = -Infinity;
    for (const t of cell.tips) {
      const s = e.x * t.v[0] + e.y * t.v[1] + e.z * t.v[2];
      if (s > score) { score = s; best = t; }
    }
    if (best) marker.position.set(doc.position[3 * best.i], doc.position[3 * best.i + 1], doc.position[3 * best.i + 2]);
    const len = cell.max * 0.42;
    arrow.position.copy(e).multiplyScalar(-len * 0.5).add(new THREE.Vector3(cell.max * 0.62, 0, 0));
    arrow.setDirection(e);
    arrow.setLength(len, len * 0.2, len * 0.09);
    scaleHigh.textContent = `+${top.toFixed(0)} mV`;
    scaleLow.textContent = `−${top.toFixed(0)} mV`;
    out.innerHTML = `<div><dt>Quasipotential across the cell</dt><dd>${(hi - lo).toFixed(0)} mV</dd></div>
      <div><dt>Marked axon end, from the soma</dt><dd>${best ? `${Math.round(best.r).toLocaleString('en-US')} µm` : 'none'}</dd></div>`;
  }

  async function load(key) {
    state.cell = key;
    root.querySelectorAll('[data-cell]').forEach((b) => b.classList.toggle('active', b.dataset.cell === key));
    note.textContent = MORPH_NOTE[key];
    cache[key] ??= prepare(await json(`morph_${key}.json`));
    if (state.cell !== key) return;
    cell = cache[key];
    lines.geometry = cell.geometry;
    soma.scale.setScalar(cell.max * 0.012);
    const d = cell.max * 3.7;
    camera.near = d * 0.02; camera.far = d * 10;
    camera.position.set(d * 0.5, d * 0.12, d * 0.86);
    controls.target.set(0, 0, 0);
    update();
  }
  root.querySelectorAll('[data-cell]').forEach((b) => b.addEventListener('click', () => load(b.dataset.cell)));

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  update(); markPreset();
  load(state.cell);
  let visible = true;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(canvas);
  renderer.setAnimationLoop(() => { if (visible) { controls.update(); renderer.render(scene, camera); } });
}

// ---------- the pulse ----------
const PROTOCOLS = {
  single: {
    name: 'Single pulse', times: [0],
    text: 'In the paper\'s tissue-culture example, one biphasic pulse starts a spike at an axon terminal. It reaches the soma around 1 ms later, and the cell is back at rest after about 4 ms. Calcium outside the soma approaches rest at about 5 ms; the soma takes longer.',
  },
  ten: {
    name: '10 Hz rTMS', times: Array.from({ length: 11 }, (_, i) => i * 100),
    text: 'Calcium does not fully recover before the next pulse, so the overall level rises gradually. Initial experiments on hippocampal tissue culture showed a gradual rise in somatic calcium too, though the paper says fuller validation is still needed.',
  },
  tbs: {
    name: 'Theta burst', times: Array.from({ length: 6 }, (_, b) => [0, 20, 40].map((t) => b * 200 + t)).flat(),
    text: 'Three pulses at 50 Hz, repeated at 5 Hz. Calcium climbs higher after each burst and also decays faster than with 10 Hz, while the level stays above baseline because the bursts come so close together.',
  },
};

function startPulse(root, waves) {
  const ms = waves.mono.ms;
  lineChart(root.querySelector('.nt-chart-pulse'), {
    x: ms, width: 470, height: 230, ends: true,
    series: [
      { label: 'Monophasic', color: COLORS.mono, y: waves.mono.E, endY: 0.1 },
      { label: 'Biphasic', color: COLORS.bi, y: waves.bi.E, endY: -0.1 },
    ],
    yTicks: [-1, -0.5, 0, 0.5, 1], xTicks: [0, 0.25, 0.5, 0.75], yLabel: 'Normalized field', xLabel: 'ms',
    format: (i) => `<b>${(ms[i] * 1000).toFixed(0)} µs</b><span>Monophasic ${waves.mono.E[i].toFixed(2)}</span><span>Biphasic ${waves.bi.E[i].toFixed(2)}</span>`,
  });

  const stage = root.querySelector('.nt-train');
  const W = 470, H = 74, x = (t) => 12 + (t / 1000) * (W - 24);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'nt-svg', role: 'img', 'aria-label': 'Pulse times over one second' }, stage);
  svgEl('line', { x1: 12, x2: W - 12, y1: 44, y2: 44, class: 'nt-grid' }, svg);
  [0, 250, 500, 750, 1000].forEach((t) => { svgEl('text', { x: x(t), y: H - 6, 'text-anchor': t === 1000 ? 'end' : t === 0 ? 'start' : 'middle', class: 'nt-axis' }, svg).textContent = t === 1000 ? '1000 ms' : t; });
  const ticks = svgEl('g', {}, svg);
  const text = root.querySelector('.nt-protocol-text');
  const count = root.querySelector('.nt-protocol-count');
  const buttons = [...root.querySelectorAll('[data-protocol]')];
  function show(key) {
    const p = PROTOCOLS[key];
    ticks.textContent = '';
    p.times.forEach((t) => {
      const g = svgEl('g', {}, ticks);
      svgEl('title', {}, g).textContent = `Pulse at ${t} ms`;
      svgEl('rect', { x: x(t) - 7, y: 6, width: 14, height: 40, fill: 'transparent' }, g);
      svgEl('rect', { x: x(t) - 1.5, y: 10, width: 3, height: 34, rx: 1.5, fill: COLORS.mono }, g);
    });
    text.textContent = p.text;
    count.textContent = `${p.times.length} ${p.times.length === 1 ? 'pulse' : 'pulses'} in this second`;
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.protocol === key));
  }
  buttons.forEach((b) => b.addEventListener('click', () => show(b.dataset.protocol)));
  show('single');
}

// ---------- the calcium model ----------
const C = { membrane: '#7f8de8', er: '#7fe0a0', ca: '#ff5a4a', calb: '#3fcf6f', ryr: '#b455c8', pump: '#e8de5a', ncx: '#f0a030', vdcc: '#5f86ff', leak: '#9aa6bc', ip3: '#e86aa6', text: '#e9eef7', muted: '#9aa6bc' };
const INFO = {
  vdcc: ['Voltage-dependent calcium channel', 'L-type, Borg-Graham model, 1 per µm². This is the link between the scales: at every time step it reads the voltage NEURON saved at the nearest point.'],
  leak: ['Plasma membrane leak', 'A small steady inflow, sized so that the membrane balances at rest.'],
  pmca: ['PMCA pump', 'Pumps calcium out of the cell, 500 per µm².'],
  ncx: ['Na⁺/Ca²⁺ exchanger', 'A second way out, 15 per µm².'],
  cyt: ['Cytosol', 'Free calcium starts at 50 nM and diffuses along the tree at 220 µm²/s. One value per node of the 1D tree.'],
  clb: ['Calbindin, the buffer', 'Binds free calcium and moves about ten times slower (20 µm²/s). Total 160 µM: four times the real 40 µM, standing in for four binding sites.'],
  er: ['Endoplasmic reticulum (optional)', 'A store at 250 µM inside the dendrite. Selectable with -setting; the tutorial calls these options a prototype, and the run on this page has them off.'],
  ryr: ['Ryanodine receptor (optional)', 'Calcium-activated release from the store. Off in this page\'s run.'],
  ip3r: ['IP3 receptor (optional)', 'IP3-gated release from the store. Off in this page\'s run.'],
  serca: ['SERCA pump (optional)', 'Refills the store from the cytosol. Off in this page\'s run.'],
};

function startDiagram(root) {
  const stage = root.querySelector('.csd-stage');
  const svg = svgEl('svg', { viewBox: '0 0 1000 400', class: 'csd-svg', role: 'img', 'aria-label': 'A cut along a dendrite: the plasma membrane with its channels and pumps, the cytosol with its buffer, and the optional ER' }, stage);
  const defs = svgEl('defs', {}, svg);
  const marker = svgEl('marker', { id: 'nt-head', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
  svgEl('path', { d: 'M1 1L9 5L1 9z', fill: C.ca }, marker);
  const part = (key) => svgEl('g', { class: 'csd-part', 'data-key': key, tabindex: 0, role: 'button', 'aria-label': INFO[key][0] }, svg);
  const label = (g, x, y, s, anchor = 'middle', color = C.text, size = 14) => { svgEl('text', { x, y, 'text-anchor': anchor, fill: color, 'font-size': size, class: 'csd-sym' }, g).textContent = s; };
  const flow = (g, x, y0, y1) => svgEl('line', { x1: x, x2: x, y1: y0, y2: y1, stroke: C.ca, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-dasharray': '0.1 9', class: 'csd-flow', 'marker-end': 'url(#nt-head)' }, g);
  const hit = (g, x, y, w, h) => svgEl('rect', { x, y, width: w, height: h, fill: 'transparent' }, g);

  let g = part('cyt');
  svgEl('rect', { x: 20, y: 62, width: 960, height: 276, fill: 'rgba(127,141,232,0.06)' }, g);
  label(g, 40, 92, 'Cytosol', 'start', C.muted, 13);
  svgEl('line', { x1: 760, x2: 950, y1: 118, y2: 118, stroke: C.ca, 'stroke-width': 1.6, opacity: 0.75, 'marker-start': 'url(#nt-head)', 'marker-end': 'url(#nt-head)' }, g);
  label(g, 855, 104, 'diffusion', 'middle', C.muted, 12.5);

  for (const y of [60, 340]) svgEl('rect', { x: 20, y: y - 5, width: 960, height: 10, rx: 5, fill: C.membrane, opacity: 0.85, class: 'csd-sym' }, svg);
  label(svg, 960, 38, 'Plasma membrane', 'end', C.muted, 13);

  g = part('vdcc');
  hit(g, 130, 0, 100, 130);
  for (const s of [-1, 1]) svgEl('rect', { x: 180 + s * 9 - 5, y: 42, width: 10, height: 36, rx: 4, fill: C.vdcc, class: 'csd-body' }, g);
  flow(g, 180, 18, 118);
  label(g, 180, 150, 'VDCC');

  g = part('leak');
  hit(g, 330, 0, 90, 130);
  svgEl('rect', { x: 358, y: 45, width: 24, height: 30, rx: 8, fill: 'transparent', stroke: C.leak, 'stroke-width': 3.5, class: 'csd-body' }, g);
  flow(g, 370, 25, 105);
  label(g, 370, 134, 'Leak');

  g = part('pmca');
  hit(g, 510, 0, 90, 130);
  svgEl('circle', { cx: 555, cy: 60, r: 18, fill: '#0b1222', stroke: C.pump, 'stroke-width': 4, class: 'csd-body' }, g);
  flow(g, 555, 104, 20);
  label(g, 555, 134, 'PMCA');

  g = part('ncx');
  hit(g, 650, 0, 90, 130);
  svgEl('rect', { x: 672, y: 44, width: 46, height: 32, rx: 9, fill: '#0b1222', stroke: C.ncx, 'stroke-width': 4, class: 'csd-body' }, g);
  flow(g, 695, 104, 20);
  label(g, 695, 134, 'NCX');

  g = part('clb');
  hit(g, 60, 165, 110, 90);
  svgEl('path', { d: 'M108 228 L108 208 L92 190 M108 208 L124 190', fill: 'none', stroke: C.calb, 'stroke-width': 4, 'stroke-linecap': 'round', class: 'csd-body' }, g);
  svgEl('circle', { cx: 124, cy: 184, r: 5, fill: C.ca, class: 'csd-ion' }, g);
  label(g, 108, 250, 'Calbindin');

  const opt = { 'stroke-dasharray': '7 7', opacity: 0.7 };
  g = part('er');
  svgEl('rect', { x: 250, y: 200, width: 690, height: 92, rx: 44, fill: 'rgba(127,224,160,0.07)', stroke: C.er, 'stroke-width': 3, class: 'csd-body', ...opt }, g);
  label(g, 290, 252, 'ER', 'start', C.er, 14);
  label(g, 910, 322, 'Optional: off in this run', 'end', C.muted, 12.5);
  g = part('ryr');
  hit(g, 390, 170, 90, 130);
  for (const s of [-1, 1]) svgEl('rect', { x: 435 + s * 8 - 4.5, y: 184, width: 9, height: 32, rx: 4, fill: C.ryr, class: 'csd-body', opacity: 0.8 }, g);
  label(g, 435, 248, 'RyR');
  g = part('ip3r');
  hit(g, 540, 170, 90, 130);
  for (const s of [-1, 1]) svgEl('rect', { x: 585 + s * 8 - 4.5, y: 184, width: 9, height: 32, rx: 4, fill: C.ip3, class: 'csd-body', opacity: 0.8 }, g);
  label(g, 585, 248, 'IP3R');
  g = part('serca');
  hit(g, 690, 170, 90, 130);
  svgEl('circle', { cx: 735, cy: 200, r: 15, fill: '#0b1222', stroke: C.pump, 'stroke-width': 3.5, class: 'csd-body', opacity: 0.8 }, g);
  label(g, 735, 248, 'SERCA');

  const name = root.querySelector('.csd-name'), desc = root.querySelector('.csd-desc');
  const parts = [...svg.querySelectorAll('.csd-part')];
  let pinned = null;
  const show = (key) => {
    parts.forEach((p) => p.classList.toggle('on', p.dataset.key === key));
    svg.classList.toggle('focus', !!key);
    if (!key) { name.textContent = 'Hover or tap a channel, pump or buffer'; desc.textContent = 'Each one comes from vdccFullCellCalcium.lua, the script I wrote for this scale.'; return; }
    [name.textContent, desc.textContent] = INFO[key];
  };
  show(null);
  parts.forEach((p) => {
    p.addEventListener('pointerenter', () => { if (!pinned) show(p.dataset.key); });
    p.addEventListener('pointerleave', () => {
      if (pinned) return;
      const under = parts.find((q) => q !== p && q.matches(':hover') && !q.contains(p));
      show(under ? under.dataset.key : null);
    });
    p.addEventListener('focus', () => show(p.dataset.key));
    p.addEventListener('click', (e) => {
      e.stopPropagation();
      pinned = pinned === p.dataset.key ? null : p.dataset.key;
      show(pinned ?? p.dataset.key);
    });
  });
  svg.addEventListener('click', () => { pinned = null; show(null); });
}

// ---------- the page ----------
export async function startNeMoTMSPage(canvas, { reducedMotion = false } = {}) {
  renderMath();
  startDiagram(document.getElementById('nt-diagram'));
  const lazy = (el, start) => {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '500px 0px' });
    io.observe(el);
  };
  lazy(document.getElementById('nt-field'), () => startField(document.getElementById('nt-field')));
  const pulse = document.getElementById('nt-pulse');
  json('waveforms.json').then((w) => startPulse(pulse, w));
  const [run, replay] = await Promise.all([
    json('run.json'),
    fetch(`${BASE}replay.bin`).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
  ]);
  const quiet = ['field', 'pulse', 'calcium'].map((id) => document.getElementById(id));
  const onScreen = new Set();
  const hud = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) onScreen.add(e.target); else onScreen.delete(e.target); });
    document.body.classList.toggle('nt-quiet', onScreen.size > 0);
  }, { rootMargin: '-35% 0px -35% 0px' });
  quiet.forEach((el) => hud.observe(el));
  let charts = { update() {} };
  const bg = startBackground(canvas, run, replay, { reducedMotion, onFrame: (film) => charts.update(film) });
  charts = startRunCharts(run, bg);
  // the moment shown when frames are not played
  if (bg) charts.update(bg.film);
}
