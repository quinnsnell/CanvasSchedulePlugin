import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Use relative base so the build works whether deployed at the root
// of a domain or under a sub-path (e.g., GitHub Pages /repo-name/).
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
