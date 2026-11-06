import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './style.css';

document.getElementById('year').textContent = new Date().getFullYear();

// in development (npm run dev) placeholders to fill in are outlined; the built site never shows that
if (import.meta.env.DEV) document.body.classList.add('show-todo');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('neuron');

// the CA1 neuron background (home and spines pages)
if (canvas) import('./neuron.js')
  .then(({ startNeuron }) => startNeuron(canvas, {
    reducedMotion,
    stillTime: new URLSearchParams(location.search).has('t') ? Number(new URLSearchParams(location.search).get('t')) : null,
  }))
  .then((neuron) => {
    if (!neuron) {
      document.body.classList.add('no-webgl');
      return;
    }
    document.body.classList.add('neuron-ready');
    // ?scroll=0.5: jump half way down the page (to check the scrolled views)
    const sc = new URLSearchParams(location.search).get('scroll');
    if (sc != null) {
      document.documentElement.style.scrollBehavior = 'auto';
      const el = document.getElementById(sc);   // ?scroll=spine-gallery: jump to that element
      if (el) el.scrollIntoView();
      else window.scrollTo(0, Number(sc) * (document.documentElement.scrollHeight - window.innerHeight));
      document.querySelectorAll('.section').forEach((s) => s.classList.add('in'));
    }
    document.getElementById('fire')?.addEventListener('click', () => neuron.fire());
  })
  .catch((e) => {
    console.error(e);
    document.body.classList.add('no-webgl');
  });

// the SpineBuilder and NeuronMesh pages: their own backgrounds (the real meshes), math and viewers
const sbCanvas = document.getElementById('sb-bg');
if (sbCanvas) {
  ({
    neuronmesh: () => import('./neuronmesh.js').then(({ startNeuronMeshPage }) => startNeuronMeshPage(sbCanvas, { reducedMotion })),
    calcsim: () => import('./calcsim3d.js').then(({ startCalcSimBackground }) => startCalcSimBackground(sbCanvas, { reducedMotion })),
    wholecell: () => import('./wholecell.js').then(({ startWholeCellPage }) => startWholeCellPage(sbCanvas, { reducedMotion })),
    'nv-electrical': () => startNeuroVisor('electrical'),
    'nv-calcium': () => startNeuroVisor('calcium'),
  }[sbCanvas.dataset.page] ?? (() => import('./spinebuilder.js').then(({ startSpineBuilderPage }) => startSpineBuilderPage(sbCanvas, { reducedMotion }))))()
    .catch((e) => {
      console.error(e);
      document.body.classList.add('no-webgl');
    });
}

// the two Neuro-VISOR pages: their background replays a simulation; the caption follows it; their math
function startNeuroVisor(mode) {
  import('./math.js').then(({ renderMath }) => renderMath());
  const label = document.getElementById('nv-label'), time = document.getElementById('nv-time');
  let last = '';
  return import('./nvbackground.js').then(({ startNeuroVisorBackground }) => startNeuroVisorBackground(sbCanvas, {
    mode, reducedMotion,
    still: (() => { const v = new URLSearchParams(location.search).get('nvt'); if (!v) return null; const [r, ms] = v.split(':').map(Number); return { run: r, ms }; })(),
    onFrame: ({ label: l, ms }) => {
      if (l !== last) { label.textContent = l; last = l; }
      time.textContent = `t = ${ms.toFixed(mode === 'calcium' ? 0 : 1)} ms`;
    },
  }));
}

// the series & analysis page
if (document.body.classList.contains('mx')) {
  import('./mathematics.js').then(({ startMathPage }) => startMathPage());
}

// the CalcSim page: its equations and the diagram of the model
if (document.body.classList.contains('cs')) {
  import('./calcsim.js').then(({ startCalcSimPage }) => startCalcSimPage());
}

// the frames page (thesis and LAA paper)
if (document.body.classList.contains('fr')) {
  import('./frames.js').then(({ startFramesPage }) => startFramesPage());
}

// the résumé page
if (document.body.classList.contains('cv')) {
  import('./resume.js').then(({ startResume }) => startResume({ reducedMotion }));
}

// the 3D calcium machinery (spines page): loaded when it comes near the screen
const ca3d = document.getElementById('ca3d');
if (ca3d) {
  const near = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    near.disconnect();
    import('./calcium3d.js')
      .then(({ startCalcium3D }) => startCalcium3D(ca3d, { reducedMotion }))
      .catch((e) => { console.error(e); ca3d.classList.add('sg-failed'); });
  }, { rootMargin: '600px 0px' });
  near.observe(ca3d);
}

// the spine gallery: loaded when it comes near the screen
const gallery = document.getElementById('spine-gallery');
if (gallery) {
  const near = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    near.disconnect();
    import('./spines.js')
      .then(({ startSpineGallery }) => startSpineGallery(gallery, { reducedMotion }))
      .catch((e) => { console.error(e); gallery.classList.add('sg-failed'); });
  }, { rootMargin: '600px 0px' });
  near.observe(gallery);
}

// the videos (spines page): each plays while on screen, never on its own for reduced motion
document.querySelectorAll('.film').forEach((box) => {
  const film = box.querySelector('video');
  const toggle = box.querySelector('.film-toggle');
  let userPaused = reducedMotion;
  const label = () => {
    toggle.textContent = film.paused ? 'Play' : 'Pause';
    toggle.setAttribute('aria-label', film.paused ? 'Play the video' : 'Pause the video');
  };
  film.addEventListener('play', label);
  film.addEventListener('pause', label);
  label();
  toggle.addEventListener('click', () => {
    userPaused = !film.paused;
    if (film.paused) film.play().catch(() => {});
    else film.pause();
  });
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !userPaused) film.play().catch(() => {});
    else if (!e.isIntersecting) film.pause();
  }, { threshold: 0.25 }).observe(film);

  // steps that follow the video (data-from / data-to in seconds of the video); clicking one jumps there
  const steps = [...document.querySelectorAll(`[data-video="${box.id}"] [data-from]`)];
  if (!steps.length) return;
  const mark = () => {
    const t = film.currentTime;
    steps.forEach((s) => s.classList.toggle('active', t >= +s.dataset.from && t < +s.dataset.to));
  };
  ['timeupdate', 'seeked', 'play'].forEach((ev) => film.addEventListener(ev, mark));
  steps.forEach((s) => {
    s.addEventListener('click', () => {
      film.currentTime = +s.dataset.from + 0.05;
      if (film.paused && !userPaused) film.play().catch(() => {});
    });
  });
});

// sections fade in as they come into view
const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
  { threshold: 0.12 },
);
document.querySelectorAll('.section').forEach((s) => io.observe(s));
