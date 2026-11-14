import { expect, test, type Page } from '@playwright/test';
import { centreOf, dragCardBy, dragCardTo, dragCardToPoint, nextFrames, startDrag, store, storeCalls, wheelZoom } from './helpers';

const card = (page: Page, id: string) => page.locator(`[data-card-id="${id}"]`);
const fieldsOf = (page: Page, id: string) => page.evaluate(
  cardId => (window as unknown as { __store: { snapshot(): { cards: { id: string; fieldOptions: Record<string, string> }[] } } })
    .__store.snapshot().cards.find(c => c.id === cardId)!.fieldOptions, id);
const positionsOf = (page: Page, id: string) => page.evaluate(
  cardId => (window as unknown as { __store: { snapshot(): { placements: Record<string, { positions: Record<string, number> }> } } })
    .__store.snapshot().placements[cardId]?.positions, id);

test('moving inside a section saves the spot and writes no field', async ({ page }) => {
  await page.goto('dev.html');
  const before = (await positionsOf(page, 'c1'))!;
  await dragCardBy(page, 'c1', -30, 20);
  await expect.poll(() => storeCalls(page)).toEqual(['savePositions']);
  await expect(page.getByTestId('toast')).toBeHidden();
  const after = (await positionsOf(page, 'c1'))!;
  expect(after['f-cost']).toBeLessThan(before['f-cost']!);         // left is the worst end
  expect(after['f-value']).toBeLessThan(before['f-value']!);       // down is the worst end
  expect(await fieldsOf(page, 'c1')).toMatchObject({ 'f-cost': 'k2', 'f-value': 'v2' });
  await expect(card(page, 'c1')).toHaveAttribute('data-zone', 'matrix');
});

test('crossing into another section writes that field and says so', async ({ page }) => {
  await page.goto('dev.html');
  await dragCardTo(page, 'c1', '[data-section="1-2"]');                        // Cost Low → Medium
  await expect(page.getByTestId('toast')).toHaveText('Cost: Low → Medium');
  const f = (await fieldsOf(page, 'c1'))!;
  expect(f['f-cost']).toBe('k1');
  expect(f['f-value']).toBe('v2');
  expect(await storeCalls(page)).toEqual(['setLevel', 'savePositions']);
  await expect(page.locator('[data-section="1-2"] .count')).toContainText(/^\d+ cards$/);
});

test('the counts and the card follow a drop without a reload', async ({ page }) => {
  await page.goto('dev.html');
  const count = async (section: string) => parseInt((await page.locator(`[data-section="${section}"] .count`).textContent())!);
  const [from, to] = [await count('2-2'), await count('1-2')];
  await dragCardTo(page, 'c1', '[data-section="1-2"]');
  await expect(page.getByTestId('toast')).toBeVisible();
  expect(await count('2-2')).toBe(from - 1);
  expect(await count('1-2')).toBe(to + 1);
});

test('the section under a dragged card is highlighted', async ({ page }) => {
  await page.goto('dev.html');
  const target = await centreOf(page, '[data-section="0-1"]');
  await startDrag(page, 'c1', target);
  await expect(card(page, 'c1')).toHaveAttribute('data-dragging', '');
  await expect(page.locator('[data-section].hot')).toHaveCount(1);
  await expect(page.locator('[data-section="0-1"]')).toHaveClass(/hot/);
  await page.mouse.move(target.x + 400, target.y, { steps: 4 });               // on to the next section across
  await expect(page.locator('[data-section="1-1"]')).toHaveClass(/hot/);
  await expect(page.locator('[data-section].hot')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.hot')).toHaveCount(0);
});

test('strips and the tray light up as drop targets too', async ({ page }) => {
  await page.goto('dev.html');
  await startDrag(page, 'c1', await centreOf(page, '[data-testid="tray"]'));
  await expect(page.getByTestId('tray')).toHaveClass(/hot/);
  await expect(page.locator('[data-section].hot')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('.hot')).toHaveCount(0);
});

test('strip card dragged straight in keeps its Value spot and gains Cost', async ({ page }) => {
  await page.goto('dev.html');
  await dragCardBy(page, 'c2', 400, 0);
  await expect(card(page, 'c2')).toHaveAttribute('data-zone', 'matrix');
  const p = (await positionsOf(page, 'c2'))!;
  expect(p['f-value']).toBe(0.5);
  expect(p['f-cost']).toBeGreaterThan(0);
  expect(await storeCalls(page)).toEqual(['setLevel', 'savePositions']);
});

test('tray card dropped on the matrix sets both levels', async ({ page }) => {
  await page.goto('dev.html');
  const trayBefore = await page.getByTestId('tray').locator('[data-card-id]').count();
  await dragCardTo(page, 'c3', '[data-section="0-0"]');
  await expect(page.getByTestId('toast')).toHaveText('Cost: not set → High, Value: not set → Low');
  const f = (await fieldsOf(page, 'c3'))!;
  expect(f['f-cost']).toBe('k0');
  expect(f['f-value']).toBe('v0');
  await expect(card(page, 'c3')).toHaveAttribute('data-zone', 'matrix');
  await expect(page.getByTestId('tray').locator('[data-card-id]')).toHaveCount(trayBefore - 1);
  await expect(page.getByTestId('tray').locator('h4')).toHaveText(`Not placed yet (${trayBefore - 1})`);
});

test('dropping on the tray clears both fields; on the left strip clears only Across', async ({ page }) => {
  await page.goto('dev.html');
  const c4 = await centreOf(page, '[data-card-id="c4"]');
  const strip = await centreOf(page, '[data-testid="strip-left"]');
  await dragCardToPoint(page, 'c4', { x: strip.x, y: c4.y });                  // straight left, at its own height
  await expect(card(page, 'c4')).toHaveAttribute('data-zone', 'leftStrip');
  let f = (await fieldsOf(page, 'c4'))!;
  expect(f['f-cost']).toBeUndefined();
  expect(f['f-value']).toBe('v0');
  await expect(page.getByTestId('toast')).toHaveText('Cost: High → not set');
  expect((await positionsOf(page, 'c4'))!['f-cost']).toBeUndefined();

  await dragCardTo(page, 'c4', '[data-testid="tray"]');
  await expect(card(page, 'c4')).toHaveAttribute('data-zone', 'tray');
  f = (await fieldsOf(page, 'c4'))!;
  expect(f['f-value']).toBeUndefined();
  expect(await positionsOf(page, 'c4')).toBeUndefined();
  await expect(page.getByTestId('tray').locator('[data-card-id="c4"]')).toHaveCount(1);
});

test('dropping on the bottom strip clears only Up', async ({ page }) => {
  await page.goto('dev.html');
  const c1 = await centreOf(page, '[data-card-id="c1"]');
  const strip = await centreOf(page, '[data-testid="strip-bottom"]');
  await dragCardToPoint(page, 'c1', { x: c1.x, y: strip.y });
  await expect(card(page, 'c1')).toHaveAttribute('data-zone', 'bottomStrip');
  const f = (await fieldsOf(page, 'c1'))!;
  expect(f['f-value']).toBeUndefined();
  expect(f['f-cost']).toBe('k2');
});

test('a tray card dropped back on the tray writes nothing', async ({ page }) => {
  await page.goto('dev.html');
  await dragCardBy(page, 'c3', 30, 0);
  await expect(card(page, 'c3')).toHaveAttribute('data-zone', 'tray');
  expect(await storeCalls(page)).toEqual([]);
});

test('a drop outside every zone cancels the drag', async ({ page }) => {
  await page.goto('dev.html');
  const before = await card(page, 'c1').boundingBox();
  await dragCardToPoint(page, 'c1', { x: 300, y: 842 });                       // below the bottom strip, on the axis labels
  await expect(card(page, 'c1')).not.toHaveAttribute('data-dragging', '');
  expect(await card(page, 'c1').boundingBox()).toEqual(before);
  expect(await storeCalls(page)).toEqual([]);
  await expect(page.getByTestId('toast')).toBeHidden();
});

test('a failed write puts the card back and shows the error', async ({ page }) => {
  await page.goto('dev.html');
  const before = await card(page, 'c1').boundingBox();
  await store(page, s => s.failNext('setLevel'));
  await dragCardTo(page, 'c1', '[data-section="0-0"]');
  await expect(page.getByTestId('toast')).toContainText("Couldn't save");
  await expect(page.getByTestId('toast')).toContainText('Simulated failure');
  expect(await card(page, 'c1').boundingBox()).toEqual(before);
  await expect(card(page, 'c1')).toHaveAttribute('data-zone', 'matrix');
  const f = (await fieldsOf(page, 'c1'))!;
  expect(f['f-cost']).toBe('k2');
  expect((await positionsOf(page, 'c1'))!['f-cost']).toBe(0.9);                // position not saved either
  expect(await storeCalls(page)).toEqual(['setLevel']);                       // stopped at the first rejected call
});

test('a failed save of the spot puts the card back, with nothing written', async ({ page }) => {
  await page.goto('dev.html');
  const before = await card(page, 'c1').boundingBox();
  await store(page, s => s.failNext('savePositions'));
  await dragCardBy(page, 'c1', -30, 20);                                      // inside its section: only the spot is saved
  await expect(page.getByTestId('toast')).toContainText("Couldn't save the move. Simulated failure");
  expect(await card(page, 'c1').boundingBox()).toEqual(before);
  expect((await positionsOf(page, 'c1'))!['f-cost']).toBe(0.9);
});

test('a tray card whose write fails goes back to its place in the tray', async ({ page }) => {
  await page.goto('dev.html');
  const order = () => page.getByTestId('tray').locator('[data-card-id]').evaluateAll(els => els.map(e => e.getAttribute('data-card-id')));
  const before = await order();
  expect(before).toContain('c3');
  await store(page, s => s.failNext('setLevel'));
  await dragCardTo(page, 'c3', '[data-section="1-1"]');
  await expect(page.getByTestId('toast')).toContainText("Couldn't save the move.");
  expect(await order()).toEqual(before);
  await expect(card(page, 'c3')).toHaveAttribute('data-zone', 'tray');
  expect(await storeCalls(page)).toEqual(['setLevel']);
});

test('when a later write fails, the view shows what the store really holds', async ({ page }) => {
  await page.goto('dev.html');
  await page.evaluate(() => {                                                 // the second setLevel rejects, the first has gone through
    const w = window as unknown as { __store: { setLevel(...a: unknown[]): Promise<void> } };
    const real = w.__store.setLevel.bind(w.__store);
    let n = 0;
    w.__store.setLevel = (...a) => ++n === 2 ? Promise.reject(new Error('Second write refused')) : real(...a);
  });
  await dragCardTo(page, 'c3', '[data-section="1-1"]');
  await expect(page.getByTestId('toast')).toContainText("Couldn't save the move. Second write refused");
  const f = (await fieldsOf(page, 'c3'))!;
  expect(f['f-cost']).toBe('k1');                                             // Cost went in (it is Across, written first)
  expect(f['f-value']).toBeUndefined();
  expect(await positionsOf(page, 'c3')).toBeUndefined();
  await expect(card(page, 'c3')).toHaveAttribute('data-zone', 'bottomStrip');   // Cost only: bottom strip
});

test('while the write is in flight the card stays where it was dropped', async ({ page }) => {
  await page.goto('dev.html');
  await page.evaluate(() => {
    const w = window as unknown as { __store: { savePositions(...a: unknown[]): Promise<void> }; __finish: () => void };
    const real = w.__store.savePositions.bind(w.__store);
    w.__store.savePositions = (...a) => new Promise<void>((resolve, reject) => {
      w.__finish = () => real(...a).then(resolve, reject);
    });
  });
  const target = await centreOf(page, '[data-section="0-0"]');
  await dragCardToPoint(page, 'c1', target);
  await nextFrames(page);
  await expect(card(page, 'c1')).toHaveAttribute('data-dragging', '');          // still lifted, not yet put in a section
  const box = (await card(page, 'c1').boundingBox())!;
  expect(box.x + box.width / 2).toBeCloseTo(target.x, 0);
  expect(box.y + box.height / 2).toBeCloseTo(target.y, 0);
  await page.evaluate(() => (window as unknown as { __finish: () => void }).__finish());
  await expect(card(page, 'c1')).not.toHaveAttribute('data-dragging', '');
  await expect(card(page, 'c1')).toHaveAttribute('data-zone', 'matrix');
});

test('a card in flight is not pulled back when another drop redraws the matrix', async ({ page }) => {
  await page.goto('dev.html');
  await page.evaluate(() => {
    const w = window as unknown as { __store: { savePositions(id: string, p: unknown): Promise<void> }; __finish: () => void };
    const real = w.__store.savePositions.bind(w.__store);
    w.__store.savePositions = (id, p) => id !== 'c1' ? real(id, p) : new Promise<void>((resolve, reject) => {
      w.__finish = () => real(id, p).then(resolve, reject);
    });
  });
  await dragCardTo(page, 'c1', '[data-section="0-0"]');
  await dragCardBy(page, 'c4', 15, -15);                                      // saves at once and redraws the matrix
  await expect.poll(() => positionsOf(page, 'c4').then(p => p?.['f-cost'])).toBeGreaterThan(0);
  await nextFrames(page);
  await expect(card(page, 'c4')).not.toHaveAttribute('data-dragging', '');
  await expect(card(page, 'c1')).toHaveAttribute('data-dragging', '');
  await page.evaluate(() => (window as unknown as { __finish: () => void }).__finish());
  await expect(card(page, 'c1')).not.toHaveAttribute('data-dragging', '');
});

test('a dragged card keeps following the pointer through a zoom redraw', async ({ page }) => {
  await page.goto('dev.html');
  const target = await centreOf(page, '[data-section="1-1"]');
  await startDrag(page, 'c1', target);
  await page.mouse.wheel(0, -100);
  await nextFrames(page);
  await expect(card(page, 'c1')).toHaveAttribute('data-dragging', '');
  const box = (await card(page, 'c1').boundingBox())!;
  expect(box.x + box.width / 2).toBeCloseTo(target.x, 0);
  expect(box.y + box.height / 2).toBeCloseTo(target.y, 0);
  await page.mouse.up();
});

test('a press that barely moves is a click, not a drag', async ({ page }) => {
  await page.goto('dev.html');
  const c = await centreOf(page, '[data-card-id="c1"]');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 3, c.y, { steps: 3 });
  await expect(card(page, 'c1')).not.toHaveAttribute('data-dragging', '');
  await page.mouse.up();
  expect(await storeCalls(page)).toEqual([]);
  await expect(page.getByTestId('toast')).toBeHidden();
  await expect(card(page, 'c1')).toHaveAttribute('data-zone', 'matrix');
});

test('the card under the pointer comes to the front', async ({ page }) => {
  await page.goto('dev.html');
  const c1 = await centreOf(page, '[data-card-id="c1"]');
  await page.mouse.move(c1.x, c1.y);
  await wheelZoom(page, 3);                                                   // chips, close enough together to overlap
  await expect(card(page, 'c1')).toHaveAttribute('data-detail', 'chip');
  await nextFrames(page);
  // Two cards where the later one in the page covers part of the earlier one, and a point of the earlier one that the later one does not cover.
  const pair = await page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>('[data-testid="matrix"] ~ [data-card-id]')];
    for (let i = 0; i < els.length; i++) {
      for (let k = i + 1; k < els.length; k++) {
        const a = els[i]!.getBoundingClientRect(), b = els[k]!.getBoundingClientRect();
        const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        if (!overlap || a.left > b.left) continue;
        const own = { x: a.left + 3, y: (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2 };
        const shared = { x: (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2, y: own.y };
        const topAt = (p: { x: number; y: number }) => document.elementFromPoint(p.x, p.y)?.closest('[data-card-id]');
        if (topAt(own) !== els[i] || topAt(shared) !== els[k]) continue;
        return { under: els[i]!.dataset.cardId!, over: els[k]!.dataset.cardId!, own, shared };
      }
    }
    return null;
  });
  expect(pair, 'the sample board has two overlapping chips at this zoom').not.toBeNull();
  await page.mouse.move(pair!.own.x, pair!.own.y);
  await nextFrames(page);
  const hit = () => page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-card-id]')?.getAttribute('data-card-id'), [pair!.shared.x, pair!.shared.y]);
  expect(await hit()).toBe(pair!.under);                                      // hovering it lifts it over the card that covered it
});

test('dragging works when zoomed in', async ({ page }) => {
  await page.goto('dev.html');
  const c = await centreOf(page, '[data-card-id="c1"]');
  await page.mouse.move(c.x, c.y);
  await wheelZoom(page, 8);
  await expect(card(page, 'c1')).toHaveAttribute('data-detail', 'full');
  await nextFrames(page);
  const matrixWidth = (await page.getByTestId('matrix').boundingBox())!.width;   // matrix width * zoom
  const before = (await positionsOf(page, 'c1'))!['f-cost']!;
  await dragCardBy(page, 'c1', 60, 0);
  await expect.poll(async () => (await positionsOf(page, 'c1'))!['f-cost']).not.toBe(before);
  const after = (await positionsOf(page, 'c1'))!['f-cost']!;
  expect(after - before).toBeCloseTo(60 / matrixWidth, 2);
  expect(Math.abs(after - before - 60 / matrixWidth)).toBeLessThan(0.005);
});

test('a card dropped at the very edge stays fully visible', async ({ page }) => {
  await page.goto('dev.html');
  const area = (await page.locator('.mm-area').boundingBox())!;
  await dragCardToPoint(page, 'c1', { x: area.x + area.width - 0.5, y: area.y + 0.5 });         // top right corner
  await expect.poll(async () => (await positionsOf(page, 'c1'))!['f-cost']).toBeGreaterThan(0.995);   // within a pixel of the corner
  expect((await positionsOf(page, 'c1'))!['f-value']).toBeGreaterThan(0.995);
  await expect(card(page, 'c1')).toBeInViewport({ ratio: 1 });
  await dragCardToPoint(page, 'c4', { x: area.x + 0.5, y: area.y + area.height - 0.5 });        // bottom left corner
  await expect.poll(async () => (await positionsOf(page, 'c4'))!['f-cost']).toBeLessThan(0.002);
  expect((await positionsOf(page, 'c4'))!['f-value']).toBeLessThan(0.002);
  await expect(card(page, 'c4')).toBeInViewport({ ratio: 1 });
});

test('strip cards are drawn exactly where their position says', async ({ page }) => {
  await page.goto('dev.html');
  const area = (await page.locator('.mm-area').boundingBox())!;
  const c2 = await centreOf(page, '[data-card-id="c2"]');
  const value = (await positionsOf(page, 'c2'))!['f-value']!;
  expect(Math.abs(c2.y - (area.y + (1 - value) * area.height))).toBeLessThan(0.05);
  await page.goto('dev.html?across=f-value&up=f-ease');                          // c2 has only a Value, now on Across
  const bottom = await centreOf(page, '[data-card-id="c2"]');
  expect(Math.abs(bottom.x - (area.x + value * area.width))).toBeLessThan(0.05);
});
