import { expect, test, type Page } from '@playwright/test';
import type { FakeStore } from '../src/store/fake-store';
import { listOrder, positions, store } from './helpers';

const drawer = (page: Page) => page.getByTestId('reseq-drawer');
const reorderButton = (page: Page) => drawer(page).getByRole('button', { name: 'Reorder in Trello' });

/** The lists each `reorderLists` call the fake store has seen was asked to reorder. */
const sentLists = (page: Page): Promise<string[][]> =>
  store(page, s => s.calls.filter(c => c.method === 'reorderLists').map(c => (c.args[0] as { listId: string }[]).map(o => o.listId)));

/** The ids of the cards that are not on the matrix for Value and Cost (a card needs both fields to be placed). */
const unplacedIds = (page: Page): Promise<string[]> =>
  store(page, s => s.snapshot().cards.filter(c => !(c.fieldOptions['f-value'] && c.fieldOptions['f-cost'])).map(c => c.id));

test('preview shows the new order per list and changes nothing', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('resequence').click();
  const d = drawer(page);
  await expect(d).toContainText('using the two axes shown now (Value and Cost)');
  await expect(d.locator('h4')).toHaveText([/^Backlog \(\d+ cards\)$/, /^New Feature ideas \(\d+ cards\)$/]);
  await expect(d.locator('ol').first().locator('li').first()).toContainText('Fixture top right');
  await expect(d.locator('ol').first().locator('li')).toHaveCount(7);
  await expect(d.locator('ol').first().locator('li').first()).toContainText('was #1');
  await expect(d.getByText(/^…and \d+ more$/)).toHaveCount(2);
  const before = await positions(page);
  expect(await store(page, s => s.calls.filter(c => c.method === 'reorderLists').length)).toBe(0);
  await d.getByRole('button', { name: 'Cancel' }).click(); await expect(d).toBeHidden();
  expect(await positions(page)).toEqual(before);
  expect(await store(page, s => s.calls.filter(c => c.method === 'reorderLists').length)).toBe(0);
});

test('the preview counts the cards of the list, and the new order is the matrix order', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('resequence').click();
  const backlog = await listOrder(page, 'l-backlog');
  await expect(drawer(page).locator('h4').first()).toHaveText(`Backlog (${backlog.length} cards)`);
  await expect(drawer(page).getByText(`…and ${backlog.length - 7} more`)).toBeVisible();
});

test('Reorder in Trello applies the previewed order, with unplaced cards last in their old order', async ({ page }) => {
  await page.goto('dev.html'); const before = await listOrder(page, 'l-backlog');
  await page.getByTestId('resequence').click(); await reorderButton(page).click();
  await expect(page.getByTestId('toast')).toContainText('Backlog and New Feature ideas reordered.');
  await expect(drawer(page)).toBeHidden();
  const after = await listOrder(page, 'l-backlog');
  expect(after[0]).toBe('c1'); expect(new Set(after)).toEqual(new Set(before)); expect(after).toHaveLength(before.length);
  const unplaced = new Set(await unplacedIds(page));
  expect(unplaced.has('c2') && unplaced.has('c3')).toBe(true);
  const firstUnplaced = after.findIndex(id => unplaced.has(id));
  expect(firstUnplaced).toBeGreaterThan(0);
  expect(after.slice(firstUnplaced).every(id => unplaced.has(id))).toBe(true);          // every placed card comes before every unplaced one
  expect(after.filter(id => unplaced.has(id))).toEqual(before.filter(id => unplaced.has(id)));   // the unplaced keep their old order
  const distances = await store(page, s => {                                           // the placed cards run nearest the top right first
    const snap = s.snapshot();
    return snap.cards.filter(c => c.idList === 'l-backlog').sort((a, b) => a.pos - b.pos)
      .filter(c => c.fieldOptions['f-value'] && c.fieldOptions['f-cost'])
      .map(c => Math.hypot(1 - snap.placements[c.id]!.positions['f-cost']!, 1 - snap.placements[c.id]!.positions['f-value']!));
  });
  expect(distances.length).toBeGreaterThan(10);
  expect(distances).toEqual([...distances].sort((a, b) => a - b));
  expect(await sentLists(page)).toEqual([['l-backlog', 'l-ideas']]);
  await expect(page.locator('[data-card-id="c1"]')).toBeVisible();                       // the matrix was drawn again from the new snapshot
});

test('cards in lists that are not chosen are never touched', async ({ page }) => {
  await page.goto('dev.html');
  const before = await positions(page);
  const doingBefore = await listOrder(page, 'l-doing');
  await page.getByTestId('resequence').click(); await expect(drawer(page).locator('h4')).toHaveCount(2);
  await expect(drawer(page)).not.toContainText('Doing');
  await reorderButton(page).click(); await expect(page.getByTestId('toast')).toContainText('reordered.');
  expect(await listOrder(page, 'l-doing')).toEqual(doingBefore);
  const after = await positions(page);
  for (const [id, was] of Object.entries(before)) if (was.idList === 'l-doing') expect(after[id]).toEqual(was);
  for (const [id, was] of Object.entries(before)) expect(after[id]!.idList).toBe(was.idList);          // and no card changed list
  expect((await sentLists(page)).flat()).not.toContain('l-doing');
});

test('Undo last reorder restores the previous order', async ({ page }) => {
  await page.goto('dev.html');
  const before = await positions(page);
  await page.getByTestId('resequence').click();
  await expect(drawer(page).getByRole('button', { name: 'Undo last reorder' })).toHaveCount(0);   // nothing to undo yet
  await reorderButton(page).click(); await expect(page.getByTestId('toast')).toContainText('reordered.');
  expect(await positions(page)).not.toEqual(before);
  await page.getByTestId('resequence').click();
  await drawer(page).getByRole('button', { name: 'Undo last reorder' }).click();
  await expect(page.getByTestId('toast')).toHaveText('Last reorder undone.');
  await expect(drawer(page)).toBeHidden();
  expect(await positions(page)).toEqual(before);
  await page.getByTestId('resequence').click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByRole('button', { name: 'Undo last reorder' })).toHaveCount(0);    // gone once used
});

test('a failure part-way shows how far it got and Retry finishes the same order', async ({ page }) => {
  await page.goto('dev.html?reorderFailAfter=10'); await page.getByTestId('resequence').click();
  await reorderButton(page).click();
  await expect(drawer(page)).toContainText('Stopped after 10 of');
  await expect(drawer(page)).toContainText('offline');
  await expect(drawer(page)).toBeVisible();                                              // it stays open
  await expect(reorderButton(page)).toHaveCount(0);
  await expect(page.getByTestId('toast')).toBeHidden();
  const stopped = await store(page, s => s.calls.filter(c => c.method === 'reorderLists').map(c => JSON.stringify(c.args[0])));
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('toast')).toContainText('reordered.');
  expect((await listOrder(page, 'l-backlog'))[0]).toBe('c1');
  const all = await store(page, s => s.calls.filter(c => c.method === 'reorderLists').map(c => JSON.stringify(c.args[0])));
  expect(all).toEqual([stopped[0], stopped[0]]);                                          // the same orders were sent again
});

test('undo after a retried reorder returns to the order from before the first attempt', async ({ page }) => {
  await page.goto('dev.html?reorderFailAfter=10');
  const before = await positions(page);
  await page.getByTestId('resequence').click(); await reorderButton(page).click();
  await expect(drawer(page)).toContainText('Stopped after 10 of');
  await page.getByRole('button', { name: 'Retry' }).click(); await expect(page.getByTestId('toast')).toContainText('reordered.');
  await page.getByTestId('resequence').click();
  await drawer(page).getByRole('button', { name: 'Undo last reorder' }).click();
  await expect(page.getByTestId('toast')).toHaveText('Last reorder undone.');
  expect(await positions(page)).toEqual(before);
});

test('Cancel after a failure leaves the drawer closed and the matrix showing what Trello now holds', async ({ page }) => {
  await page.goto('dev.html?reorderFailAfter=10'); await page.getByTestId('resequence').click(); await reorderButton(page).click();
  await expect(drawer(page)).toContainText('Stopped after 10 of');
  await drawer(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(drawer(page)).toBeHidden();
  await page.getByTestId('resequence').click();
  await expect(drawer(page).getByRole('button', { name: 'Undo last reorder' })).toBeVisible();      // the cards that moved can be put back
});

test('the order is worked out again when Reorder is pressed, so a card added meanwhile is included', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('resequence').click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByText('The lists are already in this order.')).toBeHidden();
  await store(page, s => s.remote(snap => {
    const top = Math.max(...snap.cards.map(c => c.pos));
    snap.cards.push({ id: 'c-new', name: 'Added meanwhile', idList: 'l-backlog', pos: top + 16384, labelIds: [], memberIds: [], hasCover: false, fieldOptions: {} });
  }));
  await reorderButton(page).click(); await expect(page.getByTestId('toast')).toContainText('reordered.');
  const after = await listOrder(page, 'l-backlog');
  expect(after).toContain('c-new');
  expect(after.at(-1)).toBe('c-new');                                                    // not placed: at the bottom, after the placed cards
  expect(after[0]).toBe('c1');
});

test('a chosen list whose order would not change is shown but not sent', async ({ page }) => {
  await page.goto('dev.html?lists=l-ideas');
  await page.getByTestId('resequence').click(); await reorderButton(page).click();
  await expect(page.getByTestId('toast')).toHaveText('New Feature ideas reordered.');
  await page.getByTestId('lists').click(); await page.getByLabel('Backlog').check();
  await page.getByTestId('resequence').click();
  await expect(drawer(page).locator('h4')).toHaveText([/^Backlog \(\d+ cards\)$/, /^New Feature ideas \(\d+ cards\)$/]);
  await expect(drawer(page).getByText('The lists are already in this order.')).toBeHidden();     // Backlog still changes
  await reorderButton(page).click(); await expect(page.getByTestId('toast')).toHaveText('Backlog reordered.');
  expect(await sentLists(page)).toEqual([['l-ideas'], ['l-backlog']]);
});

test('when nothing would change the drawer says so and Reorder is disabled', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('resequence').click(); await reorderButton(page).click();
  await expect(page.getByTestId('toast')).toContainText('reordered.');
  await page.getByTestId('resequence').click();
  await expect(drawer(page).getByText('The lists are already in this order.')).toBeVisible();
  await expect(drawer(page).locator('h4')).toHaveCount(2);                               // the lists are still shown
  await expect(reorderButton(page)).toBeDisabled();
  await drawer(page).getByRole('button', { name: 'Cancel' }).click();
  expect(await sentLists(page)).toHaveLength(1);
});

test('while it runs the buttons are off, the progress shows, and a second click starts nothing', async ({ page }) => {
  await page.goto('dev.html');
  await page.evaluate(() => {
    const s = (window as unknown as { __store: FakeStore; __release: () => void }).__store;
    const w = window as unknown as { __release: () => void };
    const real = s.reorderLists.bind(s);
    s.reorderLists = async (orders, onProgress) => {
      onProgress({ done: 3, total: 10 });
      await new Promise<void>(resolve => { w.__release = resolve; });
      return real(orders, onProgress);
    };
  });
  await page.getByTestId('resequence').click();
  await reorderButton(page).dblclick();
  await expect(drawer(page)).toContainText('Reordering… 3 of 10');
  for (const b of await drawer(page).getByRole('button').all()) await expect(b).toBeDisabled();
  await reorderButton(page).click({ force: true });
  expect(await store(page, s => s.calls.filter(c => c.method === 'reorderLists').length)).toBe(0);   // the slow one has not reached the fake yet
  await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
  await expect(page.getByTestId('toast')).toContainText('reordered.');
  expect(await store(page, s => s.calls.filter(c => c.method === 'reorderLists').length)).toBe(1);
  await expect(drawer(page)).toBeHidden();
});

test('a failed undo says how far it got and Retry undoes it', async ({ page }) => {
  await page.goto('dev.html');
  const before = await positions(page);
  await page.getByTestId('resequence').click(); await reorderButton(page).click(); await expect(page.getByTestId('toast')).toContainText('reordered.');
  await store(page, s => s.failNext('undoReorder'));
  await page.getByTestId('resequence').click();
  await drawer(page).getByRole('button', { name: 'Undo last reorder' }).click();
  await expect(drawer(page)).toContainText('Stopped before it began.');
  await expect(drawer(page)).toContainText('Simulated failure');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('toast')).toHaveText('Last reorder undone.');
  expect(await positions(page)).toEqual(before);
});

test('if the board cannot be read when Reorder is pressed, nothing is written and pressing it again works', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('resequence').click();
  await store(page, s => s.failNext('load'));
  await reorderButton(page).click();
  await expect(drawer(page)).toContainText('Could not read the board. Simulated failure');
  expect(await store(page, s => s.calls.filter(c => c.method === 'reorderLists').length)).toBe(0);
  await expect(reorderButton(page)).toBeEnabled();
  await reorderButton(page).click();
  await expect(page.getByTestId('toast')).toContainText('reordered.');
});

test('the Escape key does not close the drawer', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('resequence').click();
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeVisible();
});

test('read-only users do not get the button', async ({ page }) => {
  await page.goto('dev.html?readonly=1'); await expect(page.getByTestId('resequence')).toBeHidden();
  await expect(page.getByTestId('toolbar')).toBeVisible();
});
