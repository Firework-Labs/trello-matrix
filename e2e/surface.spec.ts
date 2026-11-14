import { expect, test } from '@playwright/test';
import { emptyMatrixSpot, nextFrames, store, wheelZoom } from './helpers';

test('whole matrix shows dots, sections with counts, and the do-first corner', async ({ page }) => {
  await page.goto('dev.html');
  await expect(page.locator('[data-section]')).toHaveCount(9);
  await expect(page.locator('[data-card-id="c1"]')).toHaveAttribute('data-detail', 'dot');
  await expect(page.locator('[data-card-id="c1"]')).toHaveAttribute('data-zone', 'matrix');
  await expect(page.getByTestId('do-first')).toBeVisible();
  await expect(page.getByTestId('do-first')).toHaveText('Do first');
  const total = (await page.locator('[data-section] .count').allTextContents()).reduce((n, t) => n + parseInt(t), 0);
  expect(total).toBe(await page.locator('[data-card-id][data-zone="matrix"]').count());
  expect(total).toBeGreaterThan(20);
});

test('a section with one card says "1 card", every other count says "N cards"', async ({ page }) => {
  await page.goto('dev.html?cards=4&lists=l-backlog');                                   // the four fixture cards only
  await expect(page.locator('[data-section]')).toHaveCount(9);
  const texts = await page.locator('[data-section] .count').allTextContents();
  expect(texts).toContain('1 card');
  expect(texts).toContain('0 cards');
  for (const text of texts) expect(text).toMatch(/^(1 card|(?!1 )\d+ cards)$/);
});

test('c1 sits in the best section, the axes read worst to best, and the zoom label starts at 100%', async ({ page }) => {
  await page.goto('dev.html');
  await expect(page.locator('[data-section="2-2"] .count')).toHaveText(/\d+ cards/);
  const labels = await page.locator('[data-axis="across"]').allTextContents();
  expect(labels).toEqual(['Cost: High', 'Cost: Medium', 'Cost: Low']);
  expect(await page.locator('[data-axis="up"]').allTextContents()).toEqual(['Value: Low', 'Value: Medium', 'Value: High']);
  await expect(page.getByTestId('zoom-label')).toHaveText('Whole matrix: dots · 100%');
  const c1 = (await page.locator('[data-card-id="c1"]').boundingBox())!;
  const best = (await page.locator('[data-section="2-2"]').boundingBox())!;
  expect(c1.x).toBeGreaterThan(best.x);
  expect(c1.x).toBeLessThan(best.x + best.width);
  expect(c1.y).toBeGreaterThan(best.y);
  expect(c1.y).toBeLessThan(best.y + best.height);
});

test('half-placed and unplaced cards sit in the strip and the tray', async ({ page }) => {
  await page.goto('dev.html');
  await expect(page.getByTestId('strip-left').locator('[data-card-id="c2"]')).toBeVisible();
  await expect(page.getByTestId('strip-left').locator('[data-card-id="c2"]')).toHaveAttribute('data-zone', 'leftStrip');
  await expect(page.getByTestId('tray').locator('[data-card-id="c3"]')).toContainText('Fixture unplaced');
  await expect(page.getByTestId('tray').locator('h4')).toHaveText(/^Not placed yet \(\d+\)$/);
  const inTray = await page.getByTestId('tray').locator('[data-card-id]').count();
  await expect(page.getByTestId('tray').locator('h4')).toHaveText(`Not placed yet (${inTray})`);
});

test('cards with only an Across level sit in the bottom strip', async ({ page }) => {
  await page.goto('dev.html?across=f-value&up=f-ease');       // no card has an Ease level
  await expect(page.getByTestId('strip-bottom').locator('[data-card-id="c2"]')).toBeVisible();
  await expect(page.getByTestId('strip-bottom').locator('[data-card-id="c2"]')).toHaveAttribute('data-zone', 'bottomStrip');
  await expect(page.locator('[data-card-id][data-zone="matrix"]')).toHaveCount(0);
});

test('cards gain detail as you zoom in, around the pointer', async ({ page }) => {
  await page.goto('dev.html');
  const c1 = page.locator('[data-card-id="c1"]'); const box = (await c1.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 6);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);          // factor e^0.88
  await expect(c1).toHaveAttribute('data-detail', 'chip');
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
  await expect(c1).toHaveAttribute('data-detail', 'full');
  await expect(c1).toContainText('Fixture top right'); await expect(c1).toContainText('Value: High'); await expect(c1).toContainText('Cost: Low');
  await expect(c1).toBeInViewport();
  await expect(page.locator('[data-axis="up"]').filter({ hasText: 'Value: High' })).toBeInViewport();   // labels stay visible
});

test('the full card shows its cover block, labels, members and list', async ({ page }) => {
  await page.goto('dev.html');
  const c1 = page.locator('[data-card-id="c1"]'); const box = (await c1.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 6);
  await wheelZoom(page, 8);
  await expect(c1).toHaveAttribute('data-detail', 'full');
  await expect(c1.locator('.mm-cover')).toHaveCount(1);
  await expect(c1).toContainText('UXUI');
  await expect(c1).toContainText('AT');
  await expect(c1).toContainText('Backlog');
  await expect(page.locator('[data-card-id="c4"]')).toHaveCount(1);
});

test('a chip cuts a long title to one line', async ({ page }) => {
  await page.goto('dev.html');
  const c4 = page.locator('[data-card-id="c4"]'); const box = (await c4.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 6);
  await wheelZoom(page, 4);
  await expect(c4).toHaveAttribute('data-detail', 'chip');
  const after = (await c4.boundingBox())!;
  expect(after.width).toBeLessThan(140);
  expect(after.height).toBeLessThan(40);
});

test('double-click fits a section; Whole matrix goes back; Escape does nothing', async ({ page }) => {
  await page.goto('dev.html');
  await page.locator('[data-section="2-2"]').dblclick({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
  await page.getByTestId('whole-matrix').click();
  await expect(page.getByTestId('zoom-label')).toContainText('100%');
});

test('the zoom label names the detail level', async ({ page }) => {
  await page.goto('dev.html');
  await page.locator('[data-section="1-1"]').dblclick({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('zoom-label')).toHaveText('Closer: titles · 282%');
  await wheelZoom(page, 4);
  await expect(page.getByTestId('zoom-label')).toContainText('Close up: full cards');
});

test('dragging the background pans', async ({ page }) => {
  await page.goto('dev.html');
  const c1 = page.locator('[data-card-id="c1"]'); const box = (await c1.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 6);
  await wheelZoom(page, 4);                                              // chip detail, c1 stays under the pointer
  await expect(c1).toHaveAttribute('data-detail', 'chip');
  await nextFrames(page);
  const before = (await c1.boundingBox())!;
  const spot = await emptyMatrixSpot(page);
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.move(spot.x - 100, spot.y, { steps: 5 });
  await page.mouse.move(spot.x - 200, spot.y, { steps: 5 });
  await page.mouse.up();
  await nextFrames(page);
  const after = (await c1.boundingBox())!;
  expect(before.x - after.x).toBeCloseTo(200, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
});

test('a 2-level axis gives a 2-wide grid', async ({ page }) => {
  await page.goto('dev.html?across=f-ease&up=f-value');
  await expect(page.locator('[data-section]')).toHaveCount(6);
  await expect(page.locator('[data-axis="across"]')).toHaveText(['Ease: Hard', 'Ease: Easy']);
  await expect(page.locator('[data-section="1-2"]')).toBeVisible();
  await expect(page.locator('[data-section="2-0"]')).toHaveCount(0);
});

test('300 cards stay responsive', async ({ page }) => {
  await page.goto('dev.html?cards=300');
  const inChosenLists = await store(page, s => s.snapshot().cards.filter(c => c.idList !== 'l-doing').length);
  expect(inChosenLists).toBeGreaterThan(200);                            // the Doing list is not one of the chosen lists
  await expect(page.locator('[data-card-id]')).toHaveCount(inChosenLists);
  await page.mouse.move(700, 400);                                       // wheel events go to the stage under the pointer
  await wheelZoom(page, 8);                                              // close up, where cards are heaviest
  await nextFrames(page);
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, i % 2 ? 100 : -100);
    await nextFrames(page, 1);
  }
  const stats = await page.evaluate(() => (window as unknown as { __renderMs: { last: number; p95: number } }).__renderMs);
  expect(stats.p95).toBeGreaterThan(0);                                  // renders were really measured
  expect(stats.p95).toBeLessThan(50);
});

test('a stale press with no button down does not pan', async ({ page }) => {
  await page.goto('dev.html');
  await page.locator('[data-section="2-2"]').dblclick({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
  await expect(page.getByTestId('stage')).not.toHaveClass(/mm-anim/);          // the fit animation has finished
  await nextFrames(page);
  const before = (await page.getByTestId('matrix').boundingBox())!;
  const spot = await emptyMatrixSpot(page);
  // A press whose release was never seen, then a move with the button up.
  await page.evaluate(({ x, y }) => {
    const stage = document.querySelector('[data-testid="stage"]')!;
    const at = (type: string, buttons: number, dx: number) => stage.dispatchEvent(new PointerEvent(type, {
      pointerId: 9, isPrimary: true, button: 0, buttons, clientX: x + dx, clientY: y, bubbles: true,
    }));
    at('pointerdown', 1, 0);
    at('pointermove', 0, 120);                       // the first of these used to start a pan (setPointerCapture then throws) ...
    at('pointermove', 0, 140);                       // ... and the next one moved the matrix
  }, spot);
  await nextFrames(page);
  const after = (await page.getByTestId('matrix').boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
});
