import { expect, test } from '@playwright/test';
import { store, wheelZoom } from './helpers';

const VIEW_KEY = 'trello-matrix-dev-view';       // where the dev page keeps the saved view

test('first use: no lists chosen shows a hint, choosing lists shows cards', async ({ page }) => {
  await page.goto('dev.html?fresh=1');                       // fresh=1: no saved view
  await expect(page.getByTestId('empty-hint')).toHaveText('Choose the lists to plot.');
  await expect(page.getByTestId('resequence')).toBeDisabled();
  await expect(page.locator('[data-card-id]')).toHaveCount(0);
  await expect(page.getByTestId('across')).toHaveValue('f-value');          // the first two parameters
  await expect(page.getByTestId('up')).toHaveValue('f-cost');
  await expect(page.getByTestId('show-images')).toBeChecked();
  await expect(page.getByTestId('colour-by')).toHaveValue('label');
  await page.getByTestId('lists').click(); await page.getByLabel('Backlog').check();
  await expect(page.locator('[data-card-id="c1"]')).toBeVisible();
  await expect(page.getByTestId('empty-hint')).toBeHidden();
  await expect(page.getByTestId('resequence')).toBeEnabled();
  await expect(page.locator('[data-card-id]')).toHaveCount(await store(page, s => s.snapshot().cards.filter(c => c.idList === 'l-backlog').length));
});

test('an empty chosen list and fewer than two parameters show hints', async ({ page }) => {
  await page.goto('dev.html?fresh=1&lists=l-doing&emptyDoing=1');
  await expect(page.getByTestId('empty-hint')).toHaveText('No cards in the chosen lists.');
  await expect(page.getByTestId('resequence')).toBeDisabled();
  await expect(page.getByTestId('lists')).toBeEnabled();                   // the toolbar stays usable
  await page.goto('dev.html?params=1');
  await expect(page.getByTestId('empty-hint')).toHaveText('Add at least two parameters to plot cards.');
  await expect(page.getByTestId('resequence')).toBeDisabled();
  await expect(page.getByTestId('swap')).toBeDisabled();
});

test('changing an axis re-places the cards and resets the zoom', async ({ page }) => {
  await page.goto('dev.html'); await page.locator('[data-section="2-2"]').dblclick({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
  await page.getByTestId('across').selectOption('f-ease');
  await expect(page.locator('[data-section]')).toHaveCount(6);
  await expect(page.getByTestId('zoom-label')).toContainText('100%');
  await expect(page.locator('[data-card-id="c1"]')).toHaveAttribute('data-zone', 'leftStrip');          // has Value, no Ease
  expect(await store(page, s => s.snapshot().placements.c1!.positions['f-cost'])).toBe(0.9);           // nothing lost
});

test('Swap axes exchanges them; the same parameter cannot be on both', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('swap').click();
  await expect(page.getByTestId('across')).toHaveValue('f-value'); await expect(page.getByTestId('up')).toHaveValue('f-cost');
  await expect(page.getByTestId('up').locator('option[value="f-value"]')).toBeDisabled();
  await expect(page.getByTestId('across').locator('option[value="f-cost"]')).toBeDisabled();
  await expect(page.getByTestId('up').locator('option[value="f-ease"]')).toBeEnabled();
  expect(await page.locator('[data-axis="across"]').allTextContents()).toEqual(['Value: Low', 'Value: Medium', 'Value: High']);
});

test('swapping resets the zoom', async ({ page }) => {
  await page.goto('dev.html'); await page.locator('[data-section="1-1"]').dblclick({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
  await page.getByTestId('swap').click();
  await expect(page.getByTestId('zoom-label')).toContainText('100%');
});

test('colour by changes card colours and the legend', async ({ page }) => {
  await page.goto('dev.html');
  await expect(page.getByTestId('legend')).toContainText('UXUI');
  await page.getByTestId('colour-by').selectOption({ label: 'List' });
  await expect(page.getByTestId('legend')).toContainText('Backlog'); await expect(page.getByTestId('legend')).not.toContainText('UXUI');
});

test('colour by offers Label, List, Member, then every dropdown field by name', async ({ page }) => {
  await page.goto('dev.html');
  expect(await page.getByTestId('colour-by').locator('option').allTextContents()).toEqual(['Label', 'List', 'Member', 'Value', 'Cost', 'Ease', 'Impacts']);
  const c1 = page.locator('[data-card-id="c1"]');
  const before = await c1.evaluate(e => getComputedStyle(e).backgroundColor);
  await page.getByTestId('colour-by').selectOption({ label: 'Impacts' });
  await expect(page.getByTestId('legend')).toContainText('iOS only');
  await expect(c1).not.toHaveCSS('background-color', before);
  await page.getByTestId('colour-by').selectOption({ label: 'Member' });
  await expect(page.getByTestId('legend')).toContainText('Ana Torres');
});

test('choosing lists, colour or images keeps the zoom', async ({ page }) => {
  await page.goto('dev.html'); await page.locator('[data-section="1-1"]').dblclick({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
  await page.getByTestId('colour-by').selectOption({ label: 'List' });
  await page.getByTestId('show-images').uncheck();
  await page.getByTestId('lists').click(); await page.getByLabel('Doing').check();
  await expect(page.locator('[data-card-id]').first()).toBeAttached();
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
  const doing = await store(page, s => s.snapshot().cards.filter(c => c.idList === 'l-doing').length);
  expect(doing).toBeGreaterThan(0);
  await expect(page.getByTestId('legend')).toContainText('Doing');
});

test('the lists checklist shows every open list, reflects the choice, and closes on a press outside', async ({ page }) => {
  await page.goto('dev.html');
  await expect(page.getByTestId('lists-panel')).toBeHidden();
  await page.getByTestId('lists').click();
  await expect(page.getByTestId('lists-panel').locator('label')).toHaveText(['Backlog', 'New Feature ideas', 'Doing']);
  await expect(page.getByLabel('Backlog')).toBeChecked(); await expect(page.getByLabel('New Feature ideas')).toBeChecked();
  await expect(page.getByLabel('Doing')).not.toBeChecked();
  await page.getByLabel('Backlog').uncheck();
  await expect(page.locator('[data-card-id="c1"]')).toHaveCount(0);
  await expect(page.getByTestId('lists-panel')).toBeVisible();
  await page.getByTestId('stage').click({ position: { x: 300, y: 200 } });
  await expect(page.getByTestId('lists-panel')).toBeHidden();
});

test('Show images only controls the cover block on a full card', async ({ page }) => {
  await page.goto('dev.html');
  const c1 = page.locator('[data-card-id="c1"]'); const box = (await c1.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 6);
  await wheelZoom(page, 8);
  await expect(c1).toHaveAttribute('data-detail', 'full');
  await expect(c1.locator('.mm-cover')).toHaveCount(1);
  const label = page.getByTestId('zoom-label');
  let zoom = '';
  await expect(async () => {                                  // the wheel's last events may still be arriving
    zoom = (await label.textContent())!;
    await page.waitForTimeout(150);
    expect(await label.textContent()).toBe(zoom);
  }).toPass();
  await page.getByTestId('show-images').uncheck();
  await expect(c1.locator('.mm-cover')).toHaveCount(0);
  await expect(page.getByTestId('zoom-label')).toHaveText(zoom);
  await page.getByTestId('show-images').check();
  await expect(c1.locator('.mm-cover')).toHaveCount(1);
});

test('Parameters and Resequence lists buttons are in the toolbar', async ({ page }) => {
  await page.goto('dev.html');
  await expect(page.getByTestId('params')).toHaveText('Parameters…');
  await expect(page.getByTestId('resequence')).toHaveText('Resequence lists…');
  await expect(page.getByTestId('resequence')).toBeEnabled();
});

test('the view is restored on reload, per person', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('swap').click(); await page.getByTestId('show-images').uncheck();
  await page.getByTestId('colour-by').selectOption({ label: 'List' });
  await page.locator('[data-section="0-0"]').dblclick({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(700); await page.reload();        // the dev page keeps the fake store's view in sessionStorage
  await expect(page.getByTestId('across')).toHaveValue('f-value'); await expect(page.getByTestId('show-images')).not.toBeChecked();
  await expect(page.getByTestId('colour-by')).toHaveValue('list');
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
});

test('the view is saved at most once per 500 ms, zoom and pan included', async ({ page }) => {
  await page.addInitScript(key => {
    const saves: number[] = [];
    (window as unknown as { __saves: number[] }).__saves = saves;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) { if (k === key) saves.push(performance.now()); return original.call(this, k, v); };
  }, VIEW_KEY);
  await page.goto('dev.html');
  const box = (await page.getByTestId('stage').boundingBox())!;
  await page.mouse.move(box.x + 400, box.y + 300);
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(100); }      // about 1.2 s of zooming
  await page.waitForTimeout(700);
  const saves = await page.evaluate(() => (window as unknown as { __saves: number[] }).__saves);
  expect(saves.length).toBeGreaterThanOrEqual(2);
  expect(saves.length).toBeLessThanOrEqual(4);
  for (let i = 1; i < saves.length; i++) expect(saves[i]! - saves[i - 1]!).toBeGreaterThanOrEqual(480);
  const saved = JSON.parse(await page.evaluate(key => sessionStorage.getItem(key)!, VIEW_KEY));
  expect(saved.zoom).toBeGreaterThan(1);
});

test('a saved view naming a parameter or list that no longer exists falls back to defaults', async ({ page }) => {
  await page.addInitScript(([key, view]) => sessionStorage.setItem(key!, view!), [VIEW_KEY, JSON.stringify({
    across: 'gone', up: 'also-gone', listIds: ['l-ideas', 'l-gone'], colourBy: { kind: 'field', fieldId: 'f-gone' },
    showImages: true, zoom: 1, panX: 0, panY: 0,
  })]);
  await page.goto('dev.html');
  await expect(page.getByTestId('across')).toHaveValue('f-value');          // the first two parameters
  await expect(page.getByTestId('up')).toHaveValue('f-cost');
  await expect(page.getByTestId('colour-by')).toHaveValue('label');
  const ideas = await store(page, s => s.snapshot().cards.filter(c => c.idList === 'l-ideas').length);
  expect(ideas).toBeGreaterThan(0);
  await expect(page.locator('[data-card-id]')).toHaveCount(ideas);           // only the list that still exists
  await expect(page.getByTestId('empty-hint')).toBeHidden();
});

test('a saved view that cannot be used as it stands is mended: same parameter twice, nonsense zoom', async ({ page }) => {
  await page.addInitScript(([key, view]) => sessionStorage.setItem(key!, view!), [VIEW_KEY, JSON.stringify({
    across: 'f-cost', up: 'f-cost', listIds: ['l-backlog'], colourBy: { kind: 'label' }, showImages: true, zoom: 50, panX: 1e9, panY: -1e9,
  })]);
  await page.goto('dev.html');
  await expect(page.getByTestId('across')).toHaveValue('f-cost');
  await expect(page.getByTestId('up')).toHaveValue('f-value');
  await expect(page.getByTestId('zoom-label')).toContainText('900%');         // the largest zoom
  await expect(page.getByTestId('matrix')).toBeAttached();
});

test('a long title is cut off in a chip and shown in full on hover', async ({ page }) => {
  await page.goto('dev.html');
  const c4 = page.locator('[data-card-id="c4"]'); const box = (await c4.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 6);
  await wheelZoom(page, 4);
  await expect(c4).toHaveAttribute('data-detail', 'chip');
  const full = await store(page, s => s.snapshot().cards.find(c => c.id === 'c4')!.name);
  await expect(c4).toHaveAttribute('title', full);
  const title = c4.locator('.mm-title');
  await expect(title).toHaveCSS('text-overflow', 'ellipsis');
  await expect(title).toHaveCSS('white-space', 'nowrap');
  expect(await title.evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true);        // really cut off
});
