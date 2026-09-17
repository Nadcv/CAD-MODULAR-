import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built app works whether it's served from a domain root or a
  // GitHub Pages project subpath (https://<user>.github.io/<repo>/) without extra config.
  base: './',
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
