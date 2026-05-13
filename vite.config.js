import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Use relative base so the build works whether deployed at the root
// of a domain or under a sub-path (e.g., GitHub Pages /repo-name/).
// Set your Canvas instance URL here for local development.
// The dev server proxies /api/v1/* requests to Canvas, bypassing CORS entirely.
const CANVAS_BASE_URL = process.env.CANVAS_URL || 'https://youruniversity.instructure.com';

/**
 * Virtual module `virtual:build-time` exposes a fresh ISO timestamp
 * that's frozen at build time in production and re-emitted on every
 * HMR update in dev — so the Header's version stamp tracks code
 * freshness without needing a server restart.
 */
function buildTimePlugin() {
  const id = 'virtual:build-time';
  const resolvedId = '\0' + id;
  return {
    name: 'build-time',
    resolveId(s) { if (s === id) return resolvedId; },
    load(s) {
      if (s !== resolvedId) return;
      return `export const BUILD_TIME = ${JSON.stringify(new Date().toISOString())};`;
    },
    handleHotUpdate({ server }) {
      // Any source edit → invalidate so the next import re-evaluates load()
      // with a fresh `new Date()`. Returning [] tells Vite we've handled it.
      const mod = server.moduleGraph.getModuleById(resolvedId);
      if (mod) server.moduleGraph.invalidateModule(mod);
    },
  };
}

export default defineConfig({
  plugins: [react(), buildTimePlugin()],
  base: './',
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
