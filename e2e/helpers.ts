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

export interface Point { x: number; y: number }

/** The middle of an element's box, in page coordinates. */
export async function centreOf(page: Page, selector: string): Promise<Point> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not on the page`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Press on a card's centre (checking the card really is what is under the pointer) and move towards `to` in 5 steps, leaving the button down. */
export async function startDrag(page: Page, id: string, to: Point): Promise<Point> {
  const from = await centreOf(page, `[data-card-id="${id}"]`);
  const under = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-card-id]')?.getAttribute('data-card-id') ?? null, [from.x, from.y]);
  if (under !== id) throw new Error(`Card ${id} is covered at its centre by ${under}`);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  return from;
}

/** Drag a card's centre to a page point and let go. */
export async function dragCardToPoint(page: Page, id: string, to: Point): Promise<void> {
  await startDrag(page, id, to);
  await page.mouse.up();
}

/** Drag a card by `dx`, `dy` pixels and let go. */
export async function dragCardBy(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const from = await centreOf(page, `[data-card-id="${id}"]`);
  await dragCardToPoint(page, id, { x: from.x + dx, y: from.y + dy });
}

/** Drag a card to the middle of the element matching `selector` and let go. */
export async function dragCardTo(page: Page, id: string, selector: string): Promise<void> {
  await dragCardToPoint(page, id, await centreOf(page, selector));
}

/** The writes the fake store has seen so far, as method names. */
export function storeCalls(page: Page): Promise<string[]> {
  return store(page, s => s.calls.map(c => c.method));
}

const TOOLBAR_CONTROLS = ['across', 'swap', 'up', 'lists', 'colour-by', 'show-images', 'params', 'whole-matrix'];

/**
 * What a person can still reach behind an open dialog: the toolbar controls that take the keyboard focus,
 * and the page regions (toolbar, matrix area, legend) that sit inside an inert part of the page.
 */
export function reachableBehind(page: Page): Promise<{ focusable: string[]; inert: string[] }> {
  return page.evaluate(ids => {
    const focusable = ids.filter(id => {
      const control = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
      control.focus();
      const got = document.activeElement === control;
      (document.activeElement as HTMLElement | null)?.blur();
      return got;
    });
    const regions: Record<string, string> = { toolbar: '[data-testid="toolbar"]', main: '.mm-main', legend: '.mm-legend' };
    const inert = Object.keys(regions).filter(name => document.querySelector(regions[name]!)!.closest('[inert]') !== null);
    return { focusable, inert };
  }, TOOLBAR_CONTROLS);
}

export const ALL_TOOLBAR_CONTROLS = TOOLBAR_CONTROLS;
export const ALL_REGIONS = ['toolbar', 'main', 'legend'];

/** Wheel-zoom in on a card until it is drawn as a full card, and let the page draw it. */
export async function zoomToFull(page: Page, id: string): Promise<void> {
  const at = await centreOf(page, `[data-card-id="${id}"]`);
  await page.mouse.move(at.x, at.y);
  await wheelZoom(page, 8);
  await page.locator(`[data-card-id="${id}"][data-detail="full"]`).waitFor();
  await nextFrames(page);
}
