import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: '/dashboard/',
  resolve: {
    alias: {
      '@routerly/shared': path.resolve(__dirname, '../shared/src/browser.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/v1': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
