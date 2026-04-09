/**
 * Platform API Hooks
 *
 * useWakeLock  — keeps screen on during active workout session
 * useAudioContext — initialises Web Audio API on first user gesture
 *
 * Both are used by the session page only. Neither is active outside
 * an active workout session.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Wake Lock ─────────────────────────────────────────────────────────────────

interface WakeLockState {
  supported: boolean;
  active: boolean;
  acquire: () => Promise<void>;
  release: () => Promise<void>;
}

export function useWakeLock(): WakeLockState {
  const supported = 'wakeLock' in navigator;
  const lockRef = useRef<WakeLockSentinel | null>(null);
  const [active, setActive] = useState(false);

  const acquire = useCallback(async () => {
    if (!supported || lockRef.current) return;
    try {
      lockRef.current = await navigator.wakeLock.request('screen');
      setActive(true);
      lockRef.current.addEventListener('release', () => {
        lockRef.current = null;
        setActive(false);
      });
    } catch (err) {
      console.warn('[WakeLock] Failed to acquire:', err);
    }
  }, [supported]);

  const release = useCallback(async () => {
    if (!lockRef.current) return;
    await lockRef.current.release();
    lockRef.current = null;
    setActive(false);
  }, []);

  // Re-acquire after tab becomes visible again (lock is released on tab switch)
  useEffect(() => {
    if (!active) return;
    const handler = () => {
      if (document.visibilityState === 'visible' && !lockRef.current) {
        acquire();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [active, acquire]);

  // Release on unmount
  useEffect(() => {
    return () => {
      if (lockRef.current) {
        lockRef.current.release().catch(() => {});
      }
    };
  }, []);

  return { supported, active, acquire, release };
}

// ── Audio Context ─────────────────────────────────────────────────────────────
// Web Audio API requires a user gesture before AudioContext can be created
// (or resumed). This hook manages that lifecycle.

interface AudioContextState {
  ctx: AudioContext | null;
  ready: boolean;
  // Call this in a click/touch handler to initialise the context
  initOnGesture: () => void;
}

// Singleton — one AudioContext per app session
let _sharedCtx: AudioContext | null = null;

export function useAudioContext(): AudioContextState {
  const [ready, setReady] = useState(_sharedCtx?.state === 'running');

  const initOnGesture = useCallback(() => {
    if (_sharedCtx) {
      if (_sharedCtx.state === 'suspended') {
        _sharedCtx.resume().then(() => setReady(true)).catch(() => {});
      }
      return;
    }
    try {
      _sharedCtx = new AudioContext();
      if (_sharedCtx.state === 'running') {
        setReady(true);
      } else {
        _sharedCtx.resume().then(() => setReady(true)).catch(() => {});
      }
    } catch (err) {
      console.warn('[AudioContext] Failed to create:', err);
    }
  }, []);

  return { ctx: _sharedCtx, ready, initOnGesture };
}

// ── Export shared audio context for use by audioCueEngine ────────────────────
export function getSharedAudioContext(): AudioContext | null {
  return _sharedCtx;
}
