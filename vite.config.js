import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Local only: http://localhost:5173 (npm run dev) and http://localhost:4173 (npm run preview, the built site)
export default defineConfig({
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
      },
    },
  },
});
