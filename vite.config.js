import dotenv from 'dotenv';
dotenv.config();

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import jsconfigPaths from 'vite-jsconfig-paths';

const LIVE_BACKEND_URL = 'https://kuku-ahjz.onrender.com';

const normalizeBackendUrl = (value = '') =>
  String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api$/i, '');

const proxyBackendTarget =
  normalizeBackendUrl(process.env.VITE_BACKEND_URL || process.env.VITE_API_BASE_URL) ||
  LIVE_BACKEND_URL;

// https://vitejs.dev/config/
export default defineConfig({
  publicDir: 'src/app/assets',
  plugins: [
    react({
      // Ensures the compiler automatically imports the JSX runtime
      jsxRuntime: 'automatic',
    }),
    jsconfigPaths(),
  ],
  esbuild: {
    // This forces esbuild to use the JSX loader for .js files
    loader: 'jsx',
    include: /src\/.*\.js$/, // Only apply to files in the src folder
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ['abs-percent'],
      },
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
    proxy: {
      '/api': {
        target: proxyBackendTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist/app',
  },
});
