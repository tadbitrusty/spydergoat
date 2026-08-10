import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/mjd': 'http://127.0.0.1:8787',
      '/jd': 'http://127.0.0.1:8787',
      '/success': 'http://127.0.0.1:8787',
      '/webhook': 'http://127.0.0.1:8787',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/web/test/setup.ts'],
    include: ['src/web/**/*.test.{ts,tsx}'],
    css: true,
  },
});
