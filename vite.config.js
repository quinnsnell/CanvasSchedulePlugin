import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Use relative base so the build works whether deployed at the root
// of a domain or under a sub-path (e.g., GitHub Pages /repo-name/).
// Set your Canvas instance URL here for local development.
// The dev server proxies /api/v1/* requests to Canvas, bypassing CORS entirely.
const CANVAS_BASE_URL = process.env.CANVAS_URL || 'https://canvas.youruniversity.edu';

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    proxy: {
      '/api/v1': {
        target: CANVAS_BASE_URL,
        changeOrigin: true,
        secure: true,
      },
      '/files': {
        target: CANVAS_BASE_URL,
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
