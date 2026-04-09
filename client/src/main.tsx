import React from 'react';
import ReactDOM from 'react-dom/client';
import { useRegisterSW } from 'virtual:pwa-register/react';
import App from './App';
import { seedExerciseLibraryIfEmpty } from './db/idb';
import { registerAutoSync } from './sync/syncClient';
import './styles/global.css';

// ── Exercise library seeding ──────────────────────────────────────────────────
// Runs on first install. Idempotent on subsequent loads.
seedExerciseLibraryIfEmpty().catch(err =>
  console.error('[Init] Exercise library seeding failed:', err),
);

// ── Auto-sync registration ────────────────────────────────────────────────────
// Registers the visibility-change handler. getUserId resolves lazily
// to avoid blocking the startup path.
registerAutoSync(() => {
  // userId is stored in sessionStorage after profile load
  return sessionStorage.getItem('fit_tracker_user_id');
});

// ── SW update prompt wrapper ──────────────────────────────────────────────────
// vite-plugin-pwa's useRegisterSW hook requires a React component context.

function Root() {
  // Prompt user when a new SW version is waiting.
  // offlineReady fires when the app is fully cached for offline use.
  const { offlineReady: [offlineReady], needRefresh: [needRefresh], updateServiceWorker } =
    useRegisterSW({
      onRegistered(r: ServiceWorkerRegistration | undefined) {
        console.log('[SW] Registered:', r);
      },
      onRegisterError(error: unknown) {
        console.error('[SW] Registration failed:', error);
      },
    });

  return (
    <>
      <App />
      {needRefresh && (
        <div className="sw-update-banner">
          <span>A new version is available.</span>
          <button onClick={() => updateServiceWorker(true)}>Update</button>
        </div>
      )}
      {offlineReady && !needRefresh && (
        <div className="sw-offline-ready">App ready for offline use</div>
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
