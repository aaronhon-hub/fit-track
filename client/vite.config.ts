import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  // CRITICAL: Must match the Express static mount path.
  // The app is served at hontechnologies.com/fit-tracker/
  // All asset URLs, service worker scope, and manifest start_url derive from this.
  base: '/fit-tracker/',

  plugins: [
    react(),
    VitePWA({
      // injectManifest lets us write a custom service worker (src/sw.ts)
      // while still getting Workbox's precache manifest injected automatically.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',

      // Output SW to the build root so it's served at /fit-tracker/sw.js
      // and its scope covers /fit-tracker/
      injectManifest: {
        // Precache all built assets + the exercise library JSON
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}', 'exercise-library.json'],
      },

      manifest: {
        name: 'Adaptive Fitness Coach',
        short_name: 'FitCoach',
        description: 'Science-backed adaptive training. Benchmark, plan, execute, evaluate.',
        theme_color: '#0a0f1e',
        background_color: '#0a0f1e',
        display: 'standalone',
        orientation: 'portrait',
        // Must match base path
        start_url: '/fit-tracker/',
        scope: '/fit-tracker/',
        icons: [
          {
            src: '/fit-tracker/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/fit-tracker/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },

      // Register the service worker automatically on app load
      registerType: 'autoUpdate',

      devOptions: {
        // Enable SW in dev for local testing (requires localhost HTTPS or http://localhost)
        enabled: false,
        type: 'module',
      },
    }),
  ],

  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split vendor chunks for better cache efficiency
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },

  server: {
    // Dev proxy: forward API calls to NAS Express server
    // Allows running the dev server locally against the live NAS backend
    proxy: {
      '/api/fit-tracker': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
