import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Local only: http://localhost:5173 (npm run dev) and http://localhost:4173 (npm run preview, the built site)
export default defineConfig({
  // relative URLs everywhere, so the built site works at any address: a GitHub Pages sub-folder
  // (https://jarosado0911.github.io/RosadoResearchWebsite/) or the root of your own domain later
  base: './',
  server: { host: 'localhost', port: 5173, strictPort: true },
  preview: { host: 'localhost', port: 4173, strictPort: true },
  build: {
    chunkSizeWarningLimit: 600,   // three.js is ~510 kB (130 kB gzipped), loaded after the page
    // every page of the site
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        spines: resolve(import.meta.dirname, 'spines.html'),
        spinebuilder: resolve(import.meta.dirname, 'spinebuilder.html'),
        neuronmesh: resolve(import.meta.dirname, 'neuronmesh.html'),
        resume: resolve(import.meta.dirname, 'resume.html'),
        frames: resolve(import.meta.dirname, 'frames.html'),
        mathematics: resolve(import.meta.dirname, 'mathematics.html'),
        calcsim: resolve(import.meta.dirname, 'calcsim.html'),
        wholecell: resolve(import.meta.dirname, 'wholecell.html'),
        'neurovisor-electrical': resolve(import.meta.dirname, 'neurovisor-electrical.html'),
        'neurovisor-calcium': resolve(import.meta.dirname, 'neurovisor-calcium.html'),
      },
    },
  },
});
