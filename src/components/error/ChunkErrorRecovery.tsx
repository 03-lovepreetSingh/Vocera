'use client';

import { useEffect } from 'react';

/**
 * Self-heal stale-bundle navigations.
 *
 * Webpack throws `ChunkLoadError` when the browser asks for a chunk hash that
 * no longer exists on the server — typical after a redeploy or local rebuild
 * while a tab was open. The error fires on the Promise from `import()` (so it
 * lands in `unhandledrejection`, not `error`), with no React boundary in the
 * call path because the chunk never even started rendering.
 *
 * Listening at `window` and force-reloading on detection is the pattern Next.js
 * recommends in their official ChunkLoadError docs. Reloading drops the stale
 * HTML and pulls fresh chunk hashes that match the current build.
 *
 * The reload guard prevents a refresh storm if the freshly loaded page also
 * fails (e.g. server is down) — at most one reload per ~5s.
 */
export function ChunkErrorRecovery() {
  useEffect(() => {
    const RELOAD_KEY = 'vocera:chunk-reload-at';
    const COOLDOWN_MS = 5000;

    function isChunkError(err: unknown): boolean {
      if (!err) return false;
      const e = err as { name?: string; message?: string };
      const name = e.name ?? '';
      const message = e.message ?? '';
      return (
        name === 'ChunkLoadError' ||
        /Loading chunk\s+[\w-]+\s+failed|ChunkLoadError|Failed to fetch dynamically imported module/i.test(
          message,
        )
      );
    }

    function reloadOnce() {
      try {
        const lastRaw = sessionStorage.getItem(RELOAD_KEY);
        const last = lastRaw ? Number.parseInt(lastRaw, 10) : 0;
        if (Date.now() - last < COOLDOWN_MS) return; // already reloaded recently
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        // sessionStorage may be blocked — best-effort, still reload.
      }
      console.warn('[ChunkErrorRecovery] stale chunk detected — reloading');
      window.location.reload();
    }

    function onError(event: ErrorEvent) {
      if (isChunkError(event.error) || isChunkError({ message: event.message })) {
        event.preventDefault();
        reloadOnce();
      }
    }

    function onRejection(event: PromiseRejectionEvent) {
      if (isChunkError(event.reason)) {
        event.preventDefault();
        reloadOnce();
      }
    }

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
