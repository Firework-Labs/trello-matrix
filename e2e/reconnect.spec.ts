import { expect, test, type Page } from '@playwright/test';
import { dragCardBy, dragCardTo, store } from './helpers';

// When Trello says the sign-in has expired, the matrix offers a way back in: one bar across the top with a Connect button.

const bar = (page: Page) => page.getByTestId('reconnect');
const connectButton = (page: Page) => bar(page).getByRole('button', { name: 'Connect to Trello' });
const card = (page: Page, id: string) => page.locator(`[data-card-id="${id}"]`);
const connectCalls = (page: Page) => store(page, s => s.calls.filter(c => c.method === 'connect').length);
const positionsOf = (page: Page, id: string) => page.evaluate(
  cardId => (window as unknown as { __store: { snapshot(): { placements: Record<string, { positions: Record<string, number> }> } } })
    .__store.snapshot().placements[cardId]?.positions, id);

/** The next call of `method` is refused as an expired sign-in (the page cannot import StoreError, so it is built by shape). */
const expireOn = (page: Page, method: string) => page.evaluate(
  m => (window as unknown as { __store: { failNext(m: string, e: unknown): void } }).__store
    .failNext(m, Object.assign(new Error('Trello sign-in has expired. Connect again.'), { kind: 'auth', name: 'StoreError' })), method);

/** Counts every `load()` from now on, as `window.__loads`. */
const countLoads = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __store: { load(): Promise<unknown> }; __loads: number };
  const original = w.__store.load.bind(w.__store);
  w.__loads = 0;
  w.__store.load = () => { w.__loads++; return original(); };
});
const loads = (page: Page) => page.evaluate(() => (window as unknown as { __loads: number }).__loads);

test('no bar while the sign-in is fine', async ({ page }) => {
  await page.goto('dev.html');
  await expect(card(page, 'c1')).toBeVisible();
  await expect(bar(page)).toHaveCount(1);
  await expect(bar(page)).toBeHidden();
});

test('a drop refused for sign-in puts the card back and shows the bar; Connect removes it and reads the board again', async ({ page }) => {
  await page.goto('dev.html');
  const before = (await positionsOf(page, 'c1'))!;
  const within = async () => {                           // where the card is on the matrix
    const [c, stage] = [await card(page, 'c1').boundingBox(), await page.getByTestId('stage').boundingBox()];
    return { x: (c!.x - stage!.x) / stage!.width, y: (c!.y - stage!.y) / stage!.height };   // as fractions: the bar makes the stage a little shorter
  };
  const home = await within();
  await expireOn(page, 'savePositions');
  await dragCardBy(page, 'c1', -30, 20);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toContainText('Trello sign-in has expired.');
  await expect(bar(page)).not.toContainText('Trello access is needed to save your changes.');
  await expect(page.getByTestId('toast')).toContainText("Couldn't save the move.");
  expect(await positionsOf(page, 'c1')).toEqual(before);
  const back = await within();
  expect(back.x).toBeCloseTo(home.x, 2);
  expect(back.y).toBeCloseTo(home.y, 2);
  expect(await connectCalls(page)).toBe(0);

  await countLoads(page);
  await connectButton(page).click();
  await expect(bar(page)).toBeHidden();
  expect(await connectCalls(page)).toBe(1);
  await expect.poll(() => loads(page)).toBe(1);
  expect(await store(page, s => s.calls.filter(c => c.method === 'savePositions').length)).toBe(1);   // not retried by itself
  await expect(card(page, 'c1')).toBeVisible();
});

test('two failures in a row show one bar', async ({ page }) => {
  await page.goto('dev.html');
  await expireOn(page, 'savePositions');
  await dragCardBy(page, 'c1', -30, 20);
  await expect(bar(page)).toBeVisible();
  await expireOn(page, 'savePositions');
  await dragCardBy(page, 'c1', 20, -20);
  await expect(page.getByTestId('toast')).toContainText("Couldn't save the move.");
  await expect(page.getByTestId('reconnect')).toHaveCount(1);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).getByRole('button')).toHaveCount(1);
});

test('refusing to connect keeps the bar and says why; trying again works', async ({ page }) => {
  await page.goto('dev.html');
  await expireOn(page, 'savePositions');
  await dragCardBy(page, 'c1', -30, 20);
  await expect(bar(page)).toBeVisible();
  await store(page, s => s.failNext('connect'));
  await connectButton(page).click();
  await expect(bar(page)).toContainText('Trello sign-in has expired.');
  await expect(bar(page)).toContainText('Trello access is needed to save your changes.');
  await expect(connectButton(page)).toBeEnabled();
  await connectButton(page).click();
  await expect(bar(page)).toBeHidden();
  expect(await connectCalls(page)).toBe(2);
});

test('a start-up read refused for sign-in shows the connect screen, not the load error', async ({ page }) => {
  await page.goto('dev.html');
  await expireOn(page, 'load');
  await page.evaluate(() => (window as unknown as { __remount(): Promise<void> }).__remount());
  await expect(page.getByTestId('connect')).toBeVisible();
  await expect(page.getByTestId('load-error')).toHaveCount(0);
  await expect(page.getByTestId('reconnect')).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect to Trello' }).click();
  await expect(card(page, 'c1')).toBeVisible();
  expect(await connectCalls(page)).toBe(1);
});

test('the parameter dialog: a refused change shows its error and the bar, which can be pressed while the dialog is open', async ({ page }) => {
  await page.goto('dev.html');
  await page.getByTestId('params').click();
  const d = page.getByTestId('param-dialog');
  await d.getByLabel('Name').fill('Risk');
  await expireOn(page, 'createParameter');
  await d.getByRole('button', { name: 'Add parameter' }).click();
  await expect(page.getByTestId('param-error')).toHaveText('Trello sign-in has expired. Connect again.');
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).not.toHaveAttribute('inert', /.*/);
  await expect(d).toBeVisible();
  await connectButton(page).click();                     // a real click: nothing covers the bar, nothing makes it inert
  await expect(bar(page)).toBeHidden();
  expect(await connectCalls(page)).toBe(1);
  await expect(d).toBeVisible();                         // the dialog stays open; the person carries on
  expect(await store(page, s => s.calls.filter(c => c.method === 'createParameter').length)).toBe(1);   // not retried
});

test('the resequence drawer: a refused reorder shows "Stopped after" and the bar, which can be pressed while the drawer is open', async ({ page }) => {
  await page.goto('dev.html');
  await page.getByTestId('resequence').click();
  const d = page.getByTestId('reseq-drawer');
  await expireOn(page, 'reorderLists');
  await d.getByRole('button', { name: 'Reorder in Trello' }).click();
  await expect(d).toContainText('Stopped');
  await expect(d).toContainText('Trello sign-in has expired. Connect again.');
  await expect(bar(page)).toBeVisible();
  await connectButton(page).click();
  await expect(bar(page)).toBeHidden();
  expect(await connectCalls(page)).toBe(1);
  await expect(d).toBeVisible();
  expect(await store(page, s => s.calls.filter(c => c.method === 'reorderLists').length)).toBe(1);   // not retried
});

test('the resequence drawer: a refused undo shows the bar too', async ({ page }) => {
  await page.goto('dev.html');
  await page.getByTestId('resequence').click();
  const d = page.getByTestId('reseq-drawer');
  await d.getByRole('button', { name: 'Reorder in Trello' }).click();
  await expect(d).toBeHidden();
  await page.getByTestId('resequence').click();
  await expireOn(page, 'undoReorder');
  await d.getByRole('button', { name: 'Undo last reorder' }).click();
  await expect(d).toContainText('Stopped');
  await expect(bar(page)).toBeVisible();
});

test('the Connect button comes back 5 seconds after a press that never settles', async ({ page }) => {
  await page.goto('dev.html');
  await expireOn(page, 'savePositions');
  await dragCardBy(page, 'c1', -30, 20);
  await expect(bar(page)).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __store: { connect(): Promise<void> } }).__store.connect = () => new Promise<void>(() => {}); });
  await connectButton(page).click();
  await expect(connectButton(page)).toBeDisabled();
  await page.waitForTimeout(4000);
  await expect(connectButton(page)).toBeDisabled();
  await expect(connectButton(page)).toBeEnabled({ timeout: 3000 });
  await expect(bar(page)).toBeVisible();
});

test('the same on the first connect screen', async ({ page }) => {
  await page.goto('dev.html?connected=0');
  await page.evaluate(() => { (window as unknown as { __store: { connect(): Promise<void> } }).__store.connect = () => new Promise<void>(() => {}); });
  const button = page.getByRole('button', { name: 'Connect to Trello' });
  await button.click();
  await expect(button).toBeDisabled();
  await page.waitForTimeout(4000);
  await expect(button).toBeDisabled();
  await expect(button).toBeEnabled({ timeout: 3000 });
});

test('the bar does not change the toolbar or the legend, and sits above an open dialog', async ({ page }) => {
  await page.goto('dev.html');
  const toolbar = await page.getByTestId('toolbar').boundingBox();
  expect(toolbar!.height).toBe(45);
  await expireOn(page, 'savePositions');
  await dragCardBy(page, 'c1', -30, 20);
  await expect(bar(page)).toBeVisible();
  expect((await page.getByTestId('toolbar').boundingBox())!.height).toBe(45);
  await page.getByTestId('params').click();
  const barBox = (await bar(page).boundingBox())!;
  const dialogBackdrop = (await page.locator('.mm-dialog-backdrop').boundingBox())!;
  expect(dialogBackdrop.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);   // the dialog layer starts below the bar
});
