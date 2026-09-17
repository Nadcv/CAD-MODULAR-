import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built app works whether it's served from a domain root or a
  // GitHub Pages project subpath (https://<user>.github.io/<repo>/) without extra config.
  base: './',
  optimizeDeps: {
    // opencascade.js does its own Emscripten WASM loading via locateFile; let it be
    // dynamically imported as-is instead of esbuild pre-bundling the ~65MB module.
    exclude: ['opencascade.js'],
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
