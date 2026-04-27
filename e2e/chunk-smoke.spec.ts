import { test, expect, type ConsoleMessage, type Response } from '@playwright/test';

const PUBLIC_ROUTES = ['/login', '/signup', '/'] as const;

const CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk\s+\S+\s+failed/i,
];

for (const route of PUBLIC_ROUTES) {
  test(`route ${route} loads without ChunkLoadError`, async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedChunkRequests: string[] = [];

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (CHUNK_ERROR_PATTERNS.some((re) => re.test(text))) {
        consoleErrors.push(text);
      }
    });

    page.on('pageerror', (err: Error) => {
      const text = `${err.name}: ${err.message}`;
      if (CHUNK_ERROR_PATTERNS.some((re) => re.test(text))) {
        consoleErrors.push(text);
      }
    });

    page.on('response', (res: Response) => {
      const url = res.url();
      if (!url.includes('_next/static/chunks/')) return;
      if (res.status() >= 400) {
        failedChunkRequests.push(`${res.status()} ${url}`);
      }
    });

    page.on('requestfailed', (req) => {
      const url = req.url();
      if (url.includes('_next/static/chunks/')) {
        failedChunkRequests.push(`FAILED ${req.failure()?.errorText ?? ''} ${url}`);
      }
    });

    await page.goto(`http://localhost:3000${route}`, { waitUntil: 'networkidle' });

    expect(consoleErrors, `Chunk console errors on ${route}:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(failedChunkRequests, `Failed chunk requests on ${route}:\n${failedChunkRequests.join('\n')}`).toEqual([]);
  });
}
