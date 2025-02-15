import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'index.js'),
      name: 'CreepyBird',
      fileName: (format) => `creepy-bird.${format}.js`
    },
    rollupOptions: {
      // External dependencies that shouldn't be bundled
      external: [],
      output: {
        // Global variables to use in UMD build
        globals: {}
      }
    }
  }
}); 