import type { Page } from '@playwright/test';
import type { FakeStore } from '../src/store/fake-store';

/** Run `fn` in the page against the fake store the dev page exposes as `window.__store`. */
export function store<T>(page: Page, fn: (s: FakeStore) => T | Promise<T>): Promise<T> {
  return page.evaluate(`(${fn.toString()})(window.__store)`) as Promise<T>;
}

/** Wheel-zoom in around the pointer by `steps` notches (each is a factor of e^0.22). */
export async function wheelZoom(page: Page, steps: number): Promise<void> {
  for (let i = 0; i < Math.abs(steps); i++) await page.mouse.wheel(0, steps > 0 ? -100 : 100);
}

/** Let the page draw the frames it has queued (renders are batched into animation frames). */
export function nextFrames(page: Page, count = 2): Promise<void> {
  return page.evaluate(async n => { for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r)); }, count);
}

/** A point on the matrix that is not on a card, in page coordinates, found by looking at what is under a grid of points. */
export async function emptyMatrixSpot(page: Page): Promise<{ x: number; y: number }> {
  const spot = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="stage"] .mm-clip')!.getBoundingClientRect();
    for (let fy = 0.1; fy < 0.95; fy += 0.07) {
      for (let fx = 0.1; fx < 0.95; fx += 0.07) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && hit.closest('[data-testid="matrix"]') && !hit.closest('[data-card-id]')) return { x, y };
      }
    }
    return null;
  });
  if (!spot) throw new Error('No empty spot on the matrix');
  return spot;
}
