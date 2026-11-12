import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` makes one self-contained dist/index.html (game + Phaser inlined).
export default defineConfig({
  base: './',   // relative paths, so the build works under any GitHub Pages sub-path
  plugins: [viteSingleFile()],
  build: { chunkSizeWarningLimit: 4000 },
});
