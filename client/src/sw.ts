/// <reference lib="webworker" />
/**
 * Service Worker (src/sw.ts)
 *
 * Strategy: app shell offline-first.
 * - All built assets (JS, CSS, HTML) precached by Workbox at install time.
 * - exercise-library.json precached (bundled static content).
 * - API calls (/api/fit-tracker/*) are network-only — never cached.
 *   Core functionality never depends on network (ADR-004); caching API
 *   responses would create stale data risks without meaningful benefit.
 * - Navigation requests fall back to index.html (SPA routing support).
 *
 * Workbox injects the precache manifest into this file at build time.
 * The `self.__WB_MANIFEST` reference is the injection point.
 */

import { clientsClaim } from 'workbox-core';
import {
  precacheAndRoute,
  createHandlerBoundToURL,
  cleanupOutdatedCaches,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

// Take control of all clients immediately on activation
clientsClaim();

// Precache all assets listed in the Workbox manifest (injected at build time)
// Includes: JS chunks, CSS, index.html, icons, exercise-library.json
precacheAndRoute(self.__WB_MANIFEST);

// Clean up caches from previous SW versions
cleanupOutdatedCaches();

// ── Navigation fallback ───────────────────────────────────────────────────────
// All navigation requests (page loads, back/forward) serve the precached
// index.html. Required for React Router to work offline.
// Scoped to /fit-tracker/ — does not interfere with other apps on the server.

const navigationHandler = createHandlerBoundToURL('/fit-tracker/index.html');
const navigationRoute   = new NavigationRoute(navigationHandler, {
  allowlist: [/^\/fit-tracker\//],
  denylist:  [/^\/api\//],
});
registerRoute(navigationRoute);

// ── API routes — network only ─────────────────────────────────────────────────
// LLM calls, sync push/pull, health checks.
// Never fall back to cache; fail gracefully in the app layer.

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/fit-tracker/'),
  new NetworkOnly(),
);

// ── Skip waiting ──────────────────────────────────────────────────────────────
// Accept update messages from the app shell (sent by vite-plugin-pwa's
// useRegisterSW hook) to activate the new SW immediately.

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
