// The animated background: a reconstructed CA1 pyramidal neuron with an action potential spreading from the
// soma through the dendrites.
//
// - The cell's surface was made by my own tools (public/neuron/ca1_mesh.*, see scripts/build_neuron_mesh.py):
//   NeuronMesh meshed the reconstruction (B-spline tubes, junction patches, the soma welded in) and
//   SpineBuilder's scatter welded 400 real reconstructed spines onto it.
// - Every vertex knows its path distance from the soma (aDist); the shader lights up a front moving outward
//   at uSpeed, with a sharp leading edge, a decaying tail and an amplitude that falls off with distance
//   (back-propagating action potentials attenuate in distal dendrites).
// - Bloom makes the spike glow; fog and two faded copies further back give depth.
import * as THREE from 'three';
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
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vN = normalize(normalMatrix * normal);
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

// a seeded random generator, so the dust is the same on every load
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** The cell's surface (public/neuron/ca1_mesh.*): positions, path distances (aDist) and triangles */
async function loadCell() {
  const base = `${import.meta.env.BASE_URL}neuron/ca1_mesh`;
  const [doc, buf] = await Promise.all([
    fetch(`${base}.json`).then((r) => r.json()),
    fetch(`${base}.bin`).then((r) => r.arrayBuffer()),
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, doc.positions, doc.vertices * 3), 3));
  g.setAttribute('aDist', new THREE.BufferAttribute(new Float32Array(buf, doc.distances, doc.vertices), 1));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, doc.indices, doc.triangles * 3), 1));
  g.computeVertexNormals();
  return { doc, geometry: g };
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

  const { doc: data, geometry } = await loadCell();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LOOK.background);
  const camera = new THREE.PerspectiveCamera(32, 1, 5, 6000);

  // the cell, plus two faded copies further back (their own materials, so they spike on their own)
  const cells = [];
  const makeCell = () => {
    const mat = makeMaterial(data.maxDist);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, mat));
    const cell = { group, mat, next: 0, slot: 0 };
    cells.push(cell);
    return cell;
  };
  const main = makeCell();
  const pivot = new THREE.Group();          // rotates the main cell about its own axis
  pivot.add(main.group);
  scene.add(pivot);

  const back1 = makeCell(), back2 = makeCell();
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
