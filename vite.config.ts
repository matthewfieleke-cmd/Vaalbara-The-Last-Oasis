import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' makes the build fully relative so it works on GitHub Pages
// regardless of the repository name / subpath it is served from.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
