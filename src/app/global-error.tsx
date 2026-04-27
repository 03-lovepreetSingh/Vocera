'use client';

import { useEffect } from 'react';

/**
 * Last-resort catch for errors that escape every other boundary — most often
 * a stale-chunk import failure during a route segment render. Mirrors the
 * window-level recovery in `ChunkErrorRecovery` so users never see a broken
 * page after a deploy: the bundle is stale, we reload, the next HTML pulls
 * fresh chunk hashes.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const isChunk =
      error?.name === 'ChunkLoadError' ||
      /Loading chunk\s+[\w-]+\s+failed|Failed to fetch dynamically imported module/i.test(
        error?.message ?? '',
      );
    if (isChunk) {
      const RELOAD_KEY = 'vocera:chunk-reload-at';
      try {
        const lastRaw = sessionStorage.getItem(RELOAD_KEY);
        const last = lastRaw ? Number.parseInt(lastRaw, 10) : 0;
        if (Date.now() - last >= 5000) {
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <html>
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: '#fafafa',
          color: '#111',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center', padding: 24 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p style={{ margin: '0 0 16px', fontSize: 14, color: '#555' }}>
            The page failed to load. This usually self-resolves with a refresh.
          </p>
          <button
            type="button"
            onClick={() => {
              try {
                reset();
              } catch {
                window.location.reload();
              }
            }}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid #d4d4d4',
              background: '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
