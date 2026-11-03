// The animated background: a reconstructed CA1 pyramidal neuron (public/neuron/ca1.json, made by
// scripts/build_neuron.py) with an action potential spreading from the soma through the dendrites.
//
// - The dendrites are tubes along the reconstructed branches, with the reconstructed radii.
// - Spines are placed at random along the thinner dendrites (they are not in the reconstruction).
// - Every vertex knows its path distance from the soma (aDist); the shader lights up a front moving outward
//   at uSpeed, with a sharp leading edge, a decaying tail and an amplitude that falls off with distance
//   (back-propagating action potentials attenuate in distal dendrites).
// - Bloom makes the spike glow; fog and two faded copies further back give depth.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ---- look and feel (tweak here) ----
const LOOK = {
  background: 0x05070d,
  membrane: 0x2b5d8a,      // body color of the membrane
  rim: 0x58c4f0,           // edge glow (fresnel)
  spike: 0xff8a1f,         // action potential
  spikeSpeed: 240,         // [um per second of animation] (a real bAP is ~1000x faster)
  spikeFront: 9,           // [um] width of the leading edge
  spikeTail: 55,           // [um] decay length behind the front
  spikeEvery: [3.2, 5.5],  // [s] random interval between spikes
  spineDensity: 0.9,       // spines per um of dendrite thinner than spineMaxRadius
  spineMaxRadius: 1.3,     // [um]
  radialSegments: 10,
  bloom: { strength: 0.95, radius: 0.32, threshold: 0.6 },
  rotationSpeed: 0.045,    // [rad/s]
};

const MAX_SPIKES = 4;

const vertexShader = /* glsl */ `
  attribute float aDist;
  varying vec3 vN;
  varying vec3 vViewPos;
  varying float vDist;
  void main() {
    vec4 p = vec4(position, 1.0);
    vec3 n = normal;
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
      n = mat3(instanceMatrix) * n;
    #endif
    vec4 mv = modelViewMatrix * p;
    vViewPos = mv.xyz;
    vN = normalize(normalMatrix * n);
    vDist = aDist;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uSpikes[${MAX_SPIKES}];
  uniform float uSpeed, uFront, uTail, uMaxDist, uIntensity;
  uniform vec3 uBase, uRim, uSpike, uFog;
  uniform float uFogNear, uFogFar;
  varying vec3 vN;
  varying vec3 vViewPos;
  varying float vDist;

  // membrane potential glow at path distance d: [0, 1] for each spike, summed
  vec2 spikeAt(float d) {
    float glow = 0.0, core = 0.0;
    for (int i = 0; i < ${MAX_SPIKES}; i++) {
      float t = uTime - uSpikes[i];
      if (t < 0.0 || t > 30.0) continue;
      float x = d - t * uSpeed;                       // > 0: not reached yet
      float g = x > 0.0 ? exp(-x * x / (uFront * uFront)) : exp(x / uTail);
      // bAPs attenuate with distance; the soma (d ~ 0, a big surface) only lights up softly
      float atten = mix(1.0, 0.3, smoothstep(0.0, uMaxDist, d)) * mix(0.3, 1.0, smoothstep(0.0, 18.0, d));
      glow += g * atten;
      core += exp(-x * x / (0.25 * uFront * uFront)) * atten;
    }
    return vec2(glow, core);
  }

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(-vViewPos);
    if (!gl_FrontFacing) N = -N;
    float ndv = max(dot(N, V), 0.0);
    float fres = pow(1.0 - ndv, 2.6);
    vec3 L = normalize(vec3(0.45, 0.7, 0.55));
    float wrap = pow(dot(N, L) * 0.5 + 0.5, 1.6);
    vec3 col = uBase * (0.10 + 0.55 * wrap) + uRim * (fres * 0.42 + 0.015);

    vec2 s = spikeAt(vDist) * uIntensity;
    // depolarized membrane takes the spike color (blended, not added, so it stays amber instead of going white)
    float e = clamp(s.x, 0.0, 1.0);
    col = mix(col, uSpike * (0.55 + 0.6 * fres), e * 0.8);
    col += uSpike * s.x * (0.7 + 0.8 * fres) + vec3(1.0, 0.78, 0.45) * s.y * 0.55;

    float fog = smoothstep(uFogNear, uFogFar, -vViewPos.z);
    col = mix(col, uFog, fog);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeMaterial(maxDist) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uSpikes: { value: new Array(MAX_SPIKES).fill(-100) },
      uSpeed: { value: LOOK.spikeSpeed },
      uFront: { value: LOOK.spikeFront },
      uTail: { value: LOOK.spikeTail },
      uMaxDist: { value: maxDist },
      uIntensity: { value: 1 },
      uBase: { value: new THREE.Color(LOOK.membrane) },
      uRim: { value: new THREE.Color(LOOK.rim) },
      uSpike: { value: new THREE.Color(LOOK.spike) },
      uFog: { value: new THREE.Color(LOOK.background) },
      uFogNear: { value: 600 },
      uFogFar: { value: 2200 },
    },
  });
}

// a seeded random generator, so the spines are the same on every load
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Tubes along every branch, one merged geometry with aDist per vertex */
function buildDendrites(branches) {
  const S = LOOK.radialSegments;
  const pos = [], nrm = [], dist = [], idx = [];
  const t = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3(), tmp = new THREE.Vector3();

  for (const flat of branches) {
    const m = flat.length / 5;
    let P = [], R = [], D = [];
    for (let k = 0; k < m; k++) {
      P.push(new THREE.Vector3(flat[5 * k], flat[5 * k + 1], flat[5 * k + 2]));
      R.push(Math.max(flat[5 * k + 3], 0.3));
      D.push(flat[5 * k + 4]);
    }
    // light smoothing of the polyline (keeps the ends)
    for (let it = 0; it < 2; it++) {
      const Q = P.map((p) => p.clone());
      for (let k = 1; k < m - 1; k++) Q[k].copy(P[k - 1]).add(P[k + 1]).multiplyScalar(0.25).addScaledVector(P[k], 0.5);
      P = Q;
    }

    const base = pos.length / 3;
    // parallel-transport frames
    for (let k = 0; k < m; k++) {
      t.copy(P[Math.min(k + 1, m - 1)]).sub(P[Math.max(k - 1, 0)]).normalize();
      if (k === 0) {
        tmp.set(Math.abs(t.x) < 0.9 ? 1 : 0, Math.abs(t.x) < 0.9 ? 0 : 1, 0);
        n.crossVectors(t, tmp).normalize();
      } else {
        n.addScaledVector(t, -n.dot(t)).normalize();
      }
      b.crossVectors(t, n);
      for (let j = 0; j < S; j++) {
        const a = (j / S) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        tmp.copy(n).multiplyScalar(c).addScaledVector(b, s);
        pos.push(P[k].x + R[k] * tmp.x, P[k].y + R[k] * tmp.y, P[k].z + R[k] * tmp.z);
        nrm.push(tmp.x, tmp.y, tmp.z);
        dist.push(D[k]);
      }
    }
    for (let k = 0; k < m - 1; k++)
      for (let j = 0; j < S; j++) {
        const a = base + k * S + j, b2 = base + k * S + ((j + 1) % S);
        idx.push(a, a + S, b2, b2, a + S, b2 + S);
      }
    // rounded tip at the far end
    const tip = pos.length / 3;
    t.copy(P[m - 1]).sub(P[m - 2]).normalize();
    pos.push(P[m - 1].x + t.x * R[m - 1] * 0.8, P[m - 1].y + t.y * R[m - 1] * 0.8, P[m - 1].z + t.z * R[m - 1] * 0.8);
    nrm.push(t.x, t.y, t.z);
    dist.push(D[m - 1]);
    const last = base + (m - 1) * S;
    for (let j = 0; j < S; j++) idx.push(last + j, tip, last + ((j + 1) % S));
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
  g.setIndex(idx);
  return g;
}

/** A pyramidal soma: a sphere drawn out toward the apical trunk (+y) with a little irregularity */
function buildSoma(R) {
  const g = new THREE.IcosahedronGeometry(1, 5);
  const p = g.attributes.position, v = new THREE.Vector3();
  const dist = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const up = Math.max(0, v.y);
    let r = R * (1 + 0.9 * up ** 3 - 0.12 * Math.max(0, -v.y) ** 2);
    r *= 1 + 0.04 * Math.sin(5 * v.x + 3 * v.z) * Math.cos(4 * v.y);
    const narrow = 1 - 0.45 * up ** 2;                     // taper into the trunk
    v.set(v.x * r * narrow, v.y * r, v.z * r * narrow);
    p.setXYZ(i, v.x, v.y, v.z);
    dist[i] = Math.max(0, v.length() - R) * 0.6;
  }
  g.computeVertexNormals();
  g.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
  return g;
}

/** Mushroom spines along the thinner dendrites, as one instanced mesh */
function buildSpines(branches, material) {
  const neck = new THREE.CylinderGeometry(0.09, 0.12, 1.0, 6, 1, true).translate(0, 0.5, 0);
  const head = new THREE.SphereGeometry(0.32, 8, 6).scale(1, 0.85, 1).translate(0, 1.15, 0);
  neck.deleteAttribute('uv'); head.deleteAttribute('uv');
  const spine = mergeGeometries([neck, head]);

  const rand = rng(7);
  const mats = [], dists = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), t = new THREE.Vector3(), dir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), s = new THREE.Vector3(), M = new THREE.Matrix4();
  for (const flat of branches) {
    const m = flat.length / 5;
    for (let k = 0; k < m - 1; k++) {
      const r = flat[5 * k + 3], d = flat[5 * k + 4];
      if (r > LOOK.spineMaxRadius || d < 20) continue;
      a.set(flat[5 * k], flat[5 * k + 1], flat[5 * k + 2]);
      b.set(flat[5 * k + 5], flat[5 * k + 6], flat[5 * k + 7]);
      const len = a.distanceTo(b);
      let count = len * LOOK.spineDensity;
      while (count > 0) {
        if (count < 1 && rand() > count) break;
        count -= 1;
        const f = rand();
        t.copy(b).sub(a).normalize();
        // a random direction perpendicular to the dendrite, tilted a little along it
        dir.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).addScaledVector(t, -0.0);
        dir.addScaledVector(t, -dir.dot(t)).normalize().addScaledVector(t, (rand() - 0.5) * 0.6).normalize();
        const pos = a.clone().lerp(b, f).addScaledVector(dir, r * 0.85);
        q.setFromUnitVectors(up, dir);
        const sc = 0.7 + rand() * 0.8;
        s.set(sc, sc * (0.8 + rand() * 0.7), sc);
        M.compose(pos, q, s);
        mats.push(M.clone());
        dists.push(d + f * (flat[5 * k + 9] - d));
      }
    }
  }
  const mesh = new THREE.InstancedMesh(spine, material, mats.length);
  mats.forEach((m, i) => mesh.setMatrixAt(i, m));
  spine.setAttribute('aDist', new THREE.InstancedBufferAttribute(new Float32Array(dists), 1));
  mesh.frustumCulled = false;
  return mesh;
}

/** Faint drifting specks for depth */
function buildDust(count, spread) {
  const rand = rng(11);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[3 * i] = (rand() - 0.5) * spread;
    pos[3 * i + 1] = (rand() - 0.5) * spread;
    pos[3 * i + 2] = (rand() - 0.5) * spread;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  const mat = new THREE.PointsMaterial({
    size: 3.2, map: new THREE.CanvasTexture(c), color: 0x5f8fbf, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  return new THREE.Points(g, mat);
}

/**
 * Starts the background in a canvas. Returns { fire() } to trigger a spike, or null without WebGL.
 */
export async function startNeuron(canvas, { reducedMotion = false, stillTime = null } = {}) {
  // stillTime [s]: draw one frame that long after a spike (?t=1.2 in the address; also used for reduced motion)
  if (stillTime == null && reducedMotion) stillTime = 0.8;
  const still = stillTime != null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const data = await (await fetch(`${import.meta.env.BASE_URL}neuron/ca1.json`)).json();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LOOK.background);
  const camera = new THREE.PerspectiveCamera(32, 1, 5, 6000);

  // the cell, plus two faded copies further back (their own materials, so they spike on their own)
  const cells = [];
  const dendrites = buildDendrites(data.branches);
  const soma = buildSoma(data.somaRadius);
  const makeCell = (withSpines) => {
    const mat = makeMaterial(data.maxDist);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(dendrites, mat));
    group.add(new THREE.Mesh(soma, mat));
    if (withSpines) group.add(buildSpines(data.branches, mat));
    const cell = { group, mat, next: 0, slot: 0 };
    cells.push(cell);
    return cell;
  };
  const main = makeCell(true);
  const pivot = new THREE.Group();          // rotates the main cell about its own axis
  pivot.add(main.group);
  scene.add(pivot);

  const back1 = makeCell(false), back2 = makeCell(false);
  back1.group.position.set(-900, -260, -1500); back1.group.rotation.set(0.15, 1.9, -0.25);
  back2.group.position.set(640, 120, -1300); back2.group.rotation.set(-0.1, -2.4, 0.3);
  back1.mat.uniforms.uIntensity.value = 0.45;
  back2.mat.uniforms.uIntensity.value = 0.5;
  scene.add(back1.group, back2.group);

  const dust = buildDust(1400, 2400);
  scene.add(dust);

  // the cell's middle (the apical tree makes it tall); the camera frames it and moves toward the soma on scroll
  const [lo, hi] = data.bounds;
  const center = new THREE.Vector3(0, (lo[1] + hi[1]) / 2, 0);
  const height = hi[1] - lo[1];

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), LOOK.bloom.strength, LOOK.bloom.radius, LOOK.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let wide = true;
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    wide = w / h > 1.1;
  }
  resize();
  window.addEventListener('resize', resize);

  // spikes
  const clock = new THREE.Clock();
  const rand = Math.random;
  function fire(cell, at) {
    cell.mat.uniforms.uSpikes.value[cell.slot] = at;
    cell.slot = (cell.slot + 1) % MAX_SPIKES;
  }
  const [e0, e1] = LOOK.spikeEvery;
  main.next = 0.6;
  back1.next = 2.0 + rand() * 3;
  back2.next = 3.5 + rand() * 3;

  // pointer parallax and scroll
  const pointer = new THREE.Vector2(), smooth = new THREE.Vector2();
  window.addEventListener('pointermove', (e) => {
    pointer.set(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5);
  });
  let scrollT = 0;
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    scrollT = max > 0 ? Math.min(1, window.scrollY / max) : 0;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  let scrollSmooth = scrollT;

  const look = new THREE.Vector3(), camPos = new THREE.Vector3();
  function frame(t, dt) {
    for (const c of cells) {
      c.mat.uniforms.uTime.value = t;
      if (!still && t >= c.next) {
        fire(c, t);
        c.next = t + e0 + rand() * (e1 - e0) * (c === main ? 1 : 1.6);
      }
    }
    if (!still) {
      pivot.rotation.y += LOOK.rotationSpeed * dt;
      back1.group.rotation.y -= LOOK.rotationSpeed * 0.5 * dt;
      back2.group.rotation.y += LOOK.rotationSpeed * 0.4 * dt;
      dust.rotation.y += 0.004 * dt;
    }
    smooth.lerp(pointer, 1 - Math.exp(-dt * 2.5));
    scrollSmooth += (scrollT - scrollSmooth) * (1 - Math.exp(-dt * 3));

    // framing: whole cell at the top of the page, closer to the soma and apical trunk further down
    const s = THREE.MathUtils.smoothstep(scrollSmooth, 0, 1);
    const fit = (height * 0.62) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = THREE.MathUtils.lerp(fit, fit * 0.32, s);
    look.copy(center).lerp(new THREE.Vector3(0, 40, 0), s);
    // on wide screens the cell sits right of the text
    const side = wide ? THREE.MathUtils.lerp(-height * 0.3, -height * 0.08, s) : 0;
    camPos.set(side + smooth.x * 60, look.y - smooth.y * 40 + 30, dist);
    camera.position.copy(camPos);
    camera.lookAt(look.x + side, look.y, 0);
    for (const c of cells) {
      c.mat.uniforms.uFogNear.value = dist * 0.75;
      c.mat.uniforms.uFogFar.value = dist + 1500;
    }
    composer.render();
  }

  if (still) {
    // one still frame, a spike stillTime after it left the soma
    main.mat.uniforms.uSpikes.value[0] = 0;
    const draw = () => { scrollSmooth = scrollT; smooth.set(0, 0); frame(stillTime, 0); };
    draw();
    window.addEventListener('resize', draw);
    window.addEventListener('scroll', draw, { passive: true });
  } else {
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1);
      frame(clock.elapsedTime, dt);
    });
  }

  return {
    fire: () => {
      const t = still ? 0 : clock.elapsedTime;
      fire(main, t);
      main.next = t + e0;
    },
  };
}
