import { expect, test, type Page } from '@playwright/test';
import { centreOf, dragCardBy, dragCardTo, nextFrames, startDrag, store, storeCalls, wheelZoom, zoomToFull } from './helpers';

const VIEW_KEY = 'trello-matrix-dev-view';       // where the dev page keeps the saved view
const card = (page: Page, id: string) => page.locator(`[data-card-id="${id}"]`);
const savedView = (page: Page) => page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? 'null') as { listIds: string[]; zoom: number } | null, VIEW_KEY);
const coverRequests = (page: Page) => store(page, s => s.calls.filter(c => c.method === 'coverImageUrl').map(c => c.args[0] as string));
const sectionCount = async (page: Page, section: string) => parseInt((await page.locator(`[data-section="${section}"] .count`).textContent())!);
const positionsOf = (page: Page, id: string) => page.evaluate(
  cardId => (window as unknown as { __store: { snapshot(): { placements: Record<string, { positions: Record<string, number> }> } } })
    .__store.snapshot().placements[cardId]?.positions, id);
const fieldsOf = (page: Page, id: string) => page.evaluate(
  cardId => (window as unknown as { __store: { snapshot(): { cards: { id: string; fieldOptions: Record<string, string> }[] } } })
    .__store.snapshot().cards.find(c => c.id === cardId)!.fieldOptions, id);

// ---- opening the real card ----

test('a click without a drag opens the real card, at any zoom', async ({ page }) => {
  await page.goto('dev.html');
  await card(page, 'c1').click();                                                    // whole matrix: a dot
  expect(await store(page, s => s.calls.at(-1))).toEqual({ method: 'openCard', args: ['c1'] });
  await card(page, 'c3').click();                                                    // a card waiting in the tray
  expect(await store(page, s => s.calls.at(-1))).toEqual({ method: 'openCard', args: ['c3'] });
  await card(page, 'c2').click();                                                    // a card in a strip
  expect(await store(page, s => s.calls.at(-1))).toEqual({ method: 'openCard', args: ['c2'] });
  await zoomToFull(page, 'c1');
  await card(page, 'c1').click();                                                    // a full card
  expect(await store(page, s => s.calls.at(-1))).toEqual({ method: 'openCard', args: ['c1'] });
  expect(await store(page, s => s.calls.filter(c => c.method === 'openCard').length)).toBe(4);
  expect(await store(page, s => s.calls.filter(c => c.method === 'savePositions' || c.method === 'setLevel').length)).toBe(0);
  await expect(page.getByTestId('toast')).toBeHidden();
});

test('a drag does not open the card, and a card that cannot be opened says so', async ({ page }) => {
  await page.goto('dev.html');
  await dragCardBy(page, 'c1', -30, 20);
  await expect.poll(() => storeCalls(page)).toEqual(['savePositions']);
  await store(page, s => s.failNext('openCard'));
  await card(page, 'c4').click();
  await expect(page.getByTestId('toast')).toContainText("Couldn't open the card. Simulated failure");
});

// ---- cover images ----

test('cover images load only for full cards in view, and Show images turns them off', async ({ page }) => {
  await page.goto('dev.html');
  expect(await coverRequests(page)).toHaveLength(0);
  await zoomToFull(page, 'c1');
  await expect(card(page, 'c1').locator('img[data-cover]')).toBeVisible();
  const asked = await coverRequests(page);
  expect(asked).toContain('c1');
  expect(asked.length).toBeLessThan(15);
  expect(new Set(asked).size).toBe(asked.length);                                    // each card is asked about once
  await page.getByTestId('show-images').uncheck();
  await expect(page.locator('img[data-cover]')).toHaveCount(0);
  await expect(page.locator('.mm-cover')).toHaveCount(0);
  await page.getByTestId('show-images').check();
  await expect(card(page, 'c1').locator('img[data-cover]')).toBeVisible();
  expect((await coverRequests(page)).filter(id => id === 'c1')).toHaveLength(1);     // the answer was kept for the session
});

test('only the full cards that are on screen are asked about', async ({ page }) => {
  await page.goto('dev.html?focus=c1');                                              // opens zoomed in at once, with no steps in between
  await expect(card(page, 'c1').locator('img[data-cover]')).toBeVisible();
  const asked = await coverRequests(page);
  const { outOfView, fullWithCover } = await page.evaluate(ids => {
    const stage = document.querySelector('[data-testid="stage"]')!.getBoundingClientRect();
    const onScreen = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.right > stage.left && r.left < stage.right && r.bottom > stage.top && r.top < stage.bottom;
    };
    return {
      outOfView: ids.filter(id => !onScreen(document.querySelector(`[data-card-id="${id}"]`)!)),
      fullWithCover: [...document.querySelectorAll('[data-detail="full"]')].filter(e => e.querySelector('.mm-cover') && !onScreen(e)).length,
    };
  }, asked);
  expect(outOfView).toEqual([]);
  expect(fullWithCover).toBeGreaterThan(0);                                          // there are full cards with covers off screen, and they were left alone
  await expect(page.locator('img[data-cover]')).toHaveCount(asked.length);
});

test('no images are asked for while Show images is off, or at chip and dot detail', async ({ page }) => {
  await page.goto('dev.html');
  await page.getByTestId('show-images').uncheck();
  await zoomToFull(page, 'c1');
  await nextFrames(page);
  expect(await coverRequests(page)).toHaveLength(0);
  await page.getByTestId('whole-matrix').click();
  await page.getByTestId('show-images').check();
  await nextFrames(page);
  expect(await coverRequests(page)).toHaveLength(0);
});

test('a card whose image cannot be loaded shows no image and no error', async ({ page }) => {
  await page.goto('dev.html');
  await store(page, s => s.failNext('coverImageUrl'));                               // the first request rejects
  await zoomToFull(page, 'c1');
  await expect.poll(() => coverRequests(page)).toContain('c1');
  await expect(card(page, 'c1').locator('img[data-cover]')).toHaveCount(0);
  await expect(page.getByTestId('toast')).toBeHidden();
  await page.getByTestId('whole-matrix').click();
  await zoomToFull(page, 'c1');
  expect((await coverRequests(page)).filter(id => id === 'c1')).toHaveLength(1);     // not asked again this session
  await expect(card(page, 'c1').locator('img[data-cover]')).toHaveCount(0);
});

test('an image that is null shows no image and no error', async ({ page }) => {
  await page.goto('dev.html');
  await page.evaluate(() => {
    const w = window as unknown as { __store: { coverImageUrl(id: string): Promise<string | null> } };
    w.__store.coverImageUrl = () => Promise.resolve(null);
  });
  await zoomToFull(page, 'c1');
  await nextFrames(page, 4);
  await expect(page.locator('img[data-cover]')).toHaveCount(0);
  await expect(card(page, 'c1')).toHaveAttribute('data-detail', 'full');
  await expect(page.getByTestId('toast')).toBeHidden();
});

test('the card does not change size when its image arrives', async ({ page }) => {
  await page.goto('dev.html');
  await page.evaluate(() => {
    const w = window as unknown as { __store: { coverImageUrl(id: string): Promise<string | null> }; __finish: () => void };
    const real = w.__store.coverImageUrl.bind(w.__store);
    const waiting: (() => void)[] = [];
    w.__store.coverImageUrl = id => new Promise(resolve => { waiting.push(() => resolve(real(id))); });
    w.__finish = () => waiting.forEach(answer => answer());
  });
  await zoomToFull(page, 'c1');
  await expect(card(page, 'c1').locator('.mm-cover')).toBeVisible();                 // the empty placeholder, while it is awaited
  const before = (await card(page, 'c1').boundingBox())!;
  const slot = (await card(page, 'c1').locator('.mm-cover').boundingBox())!;
  await page.evaluate(() => (window as unknown as { __finish: () => void }).__finish());
  await expect(card(page, 'c1').locator('img[data-cover]')).toBeVisible();
  await expect(card(page, 'c1').locator('div.mm-cover')).toHaveCount(0);            // the placeholder was replaced
  expect(await card(page, 'c1').boundingBox()).toEqual(before);
  expect(await card(page, 'c1').locator('img[data-cover]').boundingBox()).toEqual(slot);
});

// ---- Show on matrix ----

test('Show on matrix opens zoomed to that card', async ({ page }) => {
  await page.goto('dev.html?focus=c4');
  await expect(card(page, 'c4')).toHaveAttribute('data-detail', 'full');
  await expect(card(page, 'c4')).toBeInViewport({ ratio: 1 });
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const at = await centreOf(page, '[data-card-id="c4"]');
  expect(Math.abs(at.x - (stage.x + stage.width / 2))).toBeLessThan(stage.width * 0.2);   // roughly in the middle
  expect(Math.abs(at.y - (stage.y + stage.height / 2))).toBeLessThan(stage.height * 0.2);
});

test('focus on a card outside the chosen lists adds its list for this session only', async ({ page }) => {
  await page.goto('dev.html');
  const target = await store(page, s => {
    const snap = s.snapshot();
    return snap.cards.find(c => c.idList === 'l-doing' && snap.placements[c.id]?.positions['f-cost'] !== undefined
      && snap.placements[c.id]?.positions['f-value'] !== undefined)!.id;
  });
  await expect(card(page, target)).toHaveCount(0);                                   // Doing is not plotted
  await page.goto(`dev.html?focus=${target}`);
  await expect(card(page, target)).toHaveAttribute('data-detail', 'full');
  await expect(card(page, target)).toBeInViewport();
  await expect(page.getByTestId('lists')).toHaveText('Lists (3)…');
  await page.getByTestId('lists').click();
  await expect(page.getByLabel('Doing')).toBeChecked();
  await expect.poll(async () => (await savedView(page))?.zoom).toBeGreaterThan(1);   // the view was saved ...
  expect((await savedView(page))!.listIds).toEqual(['l-backlog', 'l-ideas']);        // ... without the extra list
});

test('choosing lists after a focus makes the choice the person own', async ({ page }) => {
  await page.goto('dev.html');
  const target = await store(page, s => s.snapshot().cards.find(c => c.idList === 'l-doing')!.id);
  await page.goto(`dev.html?focus=${target}`);
  await page.getByTestId('lists').click();
  await page.getByLabel('Ideas').uncheck();                                          // a deliberate change keeps the other two
  await expect(page.getByTestId('lists')).toHaveText('Lists (2)…');
  await expect.poll(async () => (await savedView(page))?.listIds).toEqual(['l-backlog', 'l-doing']);
});

for (const [id, zone] of [['c3', 'tray'], ['c2', 'leftStrip']] as const) {
  test(`focus on a card in the ${zone} stays on the whole matrix and highlights it for a moment`, async ({ page }) => {
    await page.goto(`dev.html?focus=${id}`);
    await expect(card(page, id)).toHaveAttribute('data-zone', zone);
    await expect(card(page, id)).toHaveAttribute('data-highlight', '');
    await expect(page.getByTestId('zoom-label')).toContainText('100%');
    await expect(page.locator('[data-highlight]')).toHaveCount(1);
    await expect(card(page, id)).not.toHaveAttribute('data-highlight', '', { timeout: 8000 });
    await expect(page.getByTestId('zoom-label')).toContainText('100%');
  });
}

test('focus on a card that does not exist opens normally', async ({ page }) => {
  await page.goto('dev.html?focus=nope');
  await expect(card(page, 'c1')).toBeVisible();
  await expect(page.getByTestId('zoom-label')).toContainText('100%');
  await expect(page.locator('[data-highlight]')).toHaveCount(0);
  await expect(page.getByTestId('lists')).toHaveText('Lists (2)…');
});

// ---- connecting ----

test('not connected: only the connect step shows, and connecting loads the matrix', async ({ page }) => {
  await page.goto('dev.html?connected=0');
  await expect(page.getByTestId('connect')).toBeVisible();
  await expect(page.getByTestId('stage')).toHaveCount(0);
  await expect(page.getByTestId('toolbar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect to Trello' }).click();
  await expect(card(page, 'c1')).toBeVisible();
  await expect(page.getByTestId('connect')).toHaveCount(0);
  expect(await store(page, s => s.calls.filter(c => c.method === 'connect').length)).toBe(1);
});

test('declining to connect shows a message and keeps the connect step; trying again works', async ({ page }) => {
  await page.goto('dev.html?connected=0');
  await store(page, s => s.failNext('connect'));
  await page.getByRole('button', { name: 'Connect to Trello' }).click();
  await expect(page.getByTestId('connect')).toContainText('Trello access is needed to save your changes.');
  await expect(page.getByTestId('stage')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect to Trello' })).toBeEnabled();
  await page.getByRole('button', { name: 'Connect to Trello' }).click();
  await expect(card(page, 'c1')).toBeVisible();
  await expect(page.getByTestId('connect')).toHaveCount(0);
  expect(await store(page, s => s.calls.filter(c => c.method === 'connect').length)).toBe(2);
});

test('connecting, then a failed subscribe: the connect step comes back with the reason, and trying again works', async ({ page }) => {
  await page.goto('dev.html?connected=0');
  await store(page, s => s.failNext('subscribe'));
  await page.getByRole('button', { name: 'Connect to Trello' }).click();
  await expect(page.getByTestId('connect-error')).toContainText("Couldn't load the board. Simulated failure");
  await expect(page.getByTestId('stage')).toHaveCount(0);
  expect(await store(page, s => s.subscriberCount())).toBe(0);
  await page.getByRole('button', { name: 'Connect to Trello' }).click();
  await expect(card(page, 'c1')).toBeVisible();
  expect(await store(page, s => s.subscriberCount())).toBe(1);
});

// ---- a failure to load at startup ----

for (const method of ['isConnected', 'load', 'subscribe'] as const) {
  test(`a failed ${method} at startup shows an error screen; Try again loads the matrix and nothing of the failed attempt stays live`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('dev.html?focus=c1');                                           // a focus zooms in, so the view differs from the one saved
    await expect(card(page, 'c1')).toBeVisible();
    await expect.poll(() => savedView(page)).not.toBeNull();                         // the first mount has saved its view
    await page.evaluate(key => { sessionStorage.setItem(key, '"sentinel"'); }, VIEW_KEY);   // a save from the failed attempt would replace this
    await page.evaluate(m => (window as unknown as { __store: { failNext(m: string): void } }).__store.failNext(m), method);
    await page.evaluate(() => (window as unknown as { __remount(): Promise<void> }).__remount());   // the old matrix goes, a new mount is tried

    const screen = page.getByTestId('load-error');
    await expect(screen).toContainText("Couldn't load the board. Simulated failure");
    await expect(page.getByTestId('toolbar')).toHaveCount(0);
    await expect(page.getByTestId('stage')).toHaveCount(0);
    await page.evaluate(() => { (window as unknown as { __renderMs: unknown }).__renderMs = { last: -1, p95: -1 }; });   // a leftover render would replace this
    await store(page, s => s.remote(snap => { snap.cards[0]!.name = 'Renamed by the other person'; }));   // nothing is listening, nothing throws
    await page.waitForTimeout(900);                                                  // longer than the view's save delay
    expect(await page.evaluate(key => sessionStorage.getItem(key), VIEW_KEY)).toBe('"sentinel"');
    expect(await page.evaluate(() => (window as unknown as { __renderMs: unknown }).__renderMs)).toEqual({ last: -1, p95: -1 });
    expect(await store(page, s => s.subscriberCount())).toBe(0);
    await expect(screen).toBeVisible();

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(card(page, 'c1')).toBeVisible();
    await expect(page.getByTestId('toolbar')).toBeVisible();
    await expect(screen).toHaveCount(0);
    expect(await store(page, s => s.subscriberCount())).toBe(1);
    expect(errors).toEqual([]);
  });
}

// ---- read-only ----

test('read-only: cards cannot be dragged, clicks still open cards, the view still works', async ({ page }) => {
  await page.goto('dev.html?readonly=1');
  await expect(page.getByTestId('params')).toBeHidden();
  await expect(page.getByTestId('resequence')).toBeHidden();
  const before = await card(page, 'c1').boundingBox();
  await dragCardBy(page, 'c1', -200, 100);
  await nextFrames(page);
  expect(await card(page, 'c1').boundingBox()).toEqual(before);
  await expect(card(page, 'c1')).not.toHaveAttribute('data-dragging', '');
  expect(await store(page, s => s.calls.length)).toBe(0);                            // not even an openCard: it was a drag attempt
  await card(page, 'c1').click();
  expect(await store(page, s => s.calls)).toEqual([{ method: 'openCard', args: ['c1'] }]);
  const tray = await centreOf(page, '[data-card-id="c3"]');
  await dragCardBy(page, 'c3', 300, 0);                                              // from the tray into the matrix
  await expect(card(page, 'c3')).toHaveAttribute('data-zone', 'tray');
  expect(await centreOf(page, '[data-card-id="c3"]')).toEqual(tray);
  expect(await store(page, s => s.calls.some(c => c.method === 'savePositions' || c.method === 'setLevel'))).toBe(false);
  // Zoom, pan and the view controls work, and the view is still saved.
  await page.mouse.move(700, 400);
  await wheelZoom(page, 3);
  await expect(page.getByTestId('zoom-label')).not.toContainText('100%');
  await page.getByTestId('swap').click();
  await expect(page.getByTestId('across')).toHaveValue('f-value');
  await expect.poll(async () => (await savedView(page))?.zoom).toBe(1);               // the swap reset the zoom, and that was saved
  await page.getByTestId('show-images').uncheck();
  await expect(page.getByTestId('show-images')).not.toBeChecked();
  await expect.poll(() => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!).showImages, VIEW_KEY)).toBe(false);
});

test('a board that becomes read-only stops accepting drops and hides the editing buttons', async ({ page }) => {
  await page.goto('dev.html');
  await expect(page.getByTestId('params')).toBeVisible();
  await store(page, s => s.remote(b => { b.canEdit = false; }));
  await expect(page.getByTestId('params')).toBeHidden();
  await expect(page.getByTestId('resequence')).toBeHidden();
  const before = await card(page, 'c1').boundingBox();
  await dragCardBy(page, 'c1', -200, 100);
  await nextFrames(page);
  expect(await card(page, 'c1').boundingBox()).toEqual(before);
  expect(await storeCalls(page)).toEqual([]);
});

// ---- the other person's changes ----

test("the other person's move appears without reload", async ({ page }) => {
  await page.goto('dev.html');
  const before = (await card(page, 'c4').boundingBox())!;
  const section = await sectionCount(page, '0-0');
  await store(page, s => s.remote(b => { b.placements.c4!.positions['f-cost'] = 0.95; b.cards.find(c => c.id === 'c4')!.fieldOptions['f-cost'] = 'k2'; }));
  await expect.poll(async () => (await card(page, 'c4').boundingBox())!.x).toBeGreaterThan(before.x + 300);
  expect(await sectionCount(page, '0-0')).toBe(section - 1);
  expect(await storeCalls(page)).toEqual([]);                                        // nothing written by this person
});

test("the other person's new, renamed and archived cards appear without reload", async ({ page }) => {
  await page.goto('dev.html');
  await store(page, s => s.remote(b => {
    b.cards.push({ id: 'cNew', name: 'Brand new card', idList: 'l-backlog', pos: 99999, labelIds: [], memberIds: [], hasCover: false, fieldOptions: { 'f-cost': 'k1', 'f-value': 'v1' } });
    b.cards.find(c => c.id === 'c2')!.name = 'Renamed by someone';
    b.cards = b.cards.filter(c => c.id !== 'c4');
  }));
  await expect(card(page, 'cNew')).toHaveAttribute('data-zone', 'matrix');
  await expect(card(page, 'c4')).toHaveCount(0);
  await expect(card(page, 'c2')).toHaveAttribute('aria-label', 'Renamed by someone');
});

test('a card being dragged is not moved by an incoming change until the drag ends', async ({ page }) => {
  await page.goto('dev.html');
  const from = await centreOf(page, '[data-card-id="c1"]');
  const to = { x: from.x - 100, y: from.y };
  await startDrag(page, 'c1', to);
  await expect(card(page, 'c1')).toHaveAttribute('data-dragging', '');
  await store(page, s => s.remote(b => { b.placements.c1!.positions['f-cost'] = 0.2; b.cards.find(c => c.id === 'c1')!.fieldOptions['f-cost'] = 'k0'; }));
  await nextFrames(page);
  const held = await centreOf(page, '[data-card-id="c1"]');
  expect(Math.abs(held.x - to.x)).toBeLessThan(1);                                   // still under the pointer
  expect(Math.abs(held.y - to.y)).toBeLessThan(1);
  await page.mouse.up();
  await expect.poll(async () => (await fieldsOf(page, 'c1'))['f-cost']).toBe('k2');  // the drop is what the store holds, not the other person's value
  const saved = (await positionsOf(page, 'c1'))!['f-cost']!;
  expect(saved).toBeGreaterThan(0.7);
  expect(saved).toBeLessThan(0.9);
  await expect(card(page, 'c1')).not.toHaveAttribute('data-dragging', '');
  await nextFrames(page);
  const after = await centreOf(page, '[data-card-id="c1"]');
  expect(Math.abs(after.x - to.x)).toBeLessThan(2);
  expect(Math.abs(after.y - to.y)).toBeLessThan(2);
});

test('a card archived by the other person mid-drag disappears and the drop is discarded', async ({ page }) => {
  await page.goto('dev.html');
  const from = await centreOf(page, '[data-card-id="c1"]');
  await startDrag(page, 'c1', { x: from.x - 100, y: from.y });
  await store(page, s => s.remote(b => { b.cards = b.cards.filter(c => c.id !== 'c1'); }));
  await page.mouse.up();
  await expect(card(page, 'c1')).toHaveCount(0);
  await nextFrames(page);
  expect(await store(page, s => s.calls.some(c => c.args[0] === 'c1'))).toBe(false);
  expect(await storeCalls(page)).toEqual([]);
  await expect(page.getByTestId('toast')).toBeHidden();
});

test('a card moved to an unchosen list by the other person leaves the matrix, even mid-drag', async ({ page }) => {
  await page.goto('dev.html');
  const before = await sectionCount(page, '2-2');                                    // c1 is in the top right section
  await store(page, s => s.remote(b => { b.cards.find(c => c.id === 'c1')!.idList = 'l-doing'; }));
  await expect(card(page, 'c1')).toHaveCount(0);
  expect(await sectionCount(page, '2-2')).toBe(before - 1);

  const from = await centreOf(page, '[data-card-id="c4"]');
  await startDrag(page, 'c4', { x: from.x + 100, y: from.y });
  await store(page, s => s.remote(b => { b.cards.find(c => c.id === 'c4')!.idList = 'l-doing'; }));
  await page.mouse.up();
  await expect(card(page, 'c4')).toHaveCount(0);
  await nextFrames(page);
  expect(await storeCalls(page)).toEqual([]);
});

test("the other person's change does not move my view", async ({ page }) => {
  await page.goto('dev.html');
  await page.locator('[data-section="2-2"]').dblclick({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
  await expect(page.getByTestId('stage')).not.toHaveClass(/mm-anim/);
  await nextFrames(page);
  const matrix = await page.getByTestId('matrix').boundingBox();
  await store(page, s => s.remote(b => { b.cards.find(c => c.id === 'c1')!.name = 'Renamed while you look'; }));
  await expect(card(page, 'c1')).toHaveAttribute('aria-label', 'Renamed while you look');
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
  expect(await page.getByTestId('matrix').boundingBox()).toEqual(matrix);
});

test('parameters, lists and fields removed by the other person leave a valid view at the same zoom', async ({ page }) => {
  await page.goto('dev.html');
  await page.getByTestId('colour-by').selectOption('field:f-impacts');
  await page.locator('[data-section="2-2"]').dblclick({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
  await expect(page.getByTestId('stage')).not.toHaveClass(/mm-anim/);
  await nextFrames(page);
  const matrix = await page.getByTestId('matrix').boundingBox();
  await expect(page.getByTestId('across')).toHaveValue('f-cost');
  await store(page, s => s.remote(b => {
    b.parameters = b.parameters.filter(p => p.id !== 'f-cost');                       // the Across parameter
    b.lists = b.lists.filter(l => l.id !== 'l-ideas');                                // one of the two chosen lists
    b.dropdownFields = b.dropdownFields.filter(f => f.id !== 'f-impacts');            // the colouring
  }));
  await expect(page.getByTestId('across')).toHaveValue('f-ease');                     // the first parameter that is not on Up
  await expect(page.getByTestId('up')).toHaveValue('f-value');
  await expect(page.getByTestId('lists')).toHaveText('Lists (1)…');
  await expect(page.getByTestId('colour-by')).toHaveValue('label');
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
  await nextFrames(page);
  expect(await page.getByTestId('matrix').boundingBox()).toEqual(matrix);
  await expect(page.locator('[data-axis="across"]').first()).toContainText('Ease');
});

test('parameters added by the other person appear in the toolbar', async ({ page }) => {
  await page.goto('dev.html');
  await store(page, s => s.remote(b => {
    b.dropdownFields.push({ id: 'f-risk', name: 'Risk', options: [{ id: 'r0', text: 'High', colour: 'red' }, { id: 'r1', text: 'Low', colour: 'green' }] });
    b.parameters.push({ id: 'f-risk', name: 'Risk', fieldId: 'f-risk', levels: ['High', 'Low'], optionIds: ['r0', 'r1'] });
  }));
  await expect(page.getByTestId('across').locator('option[value="f-risk"]')).toHaveCount(1);
  await expect(page.getByTestId('colour-by').locator('option[value="field:f-risk"]')).toHaveCount(1);
});

test('an echo of my own change redraws nothing', async ({ page }) => {
  await page.goto('dev.html');
  await dragCardBy(page, 'c1', -30, 20);
  await expect.poll(() => storeCalls(page)).toEqual(['savePositions']);
  await nextFrames(page);
  const before = await card(page, 'c1').boundingBox();
  const sections = [await sectionCount(page, '2-2'), await sectionCount(page, '1-1')];
  await page.evaluate(() => {
    const w = window as unknown as { __mutations: number; __first: Element };
    w.__mutations = 0;
    w.__first = document.querySelector('[data-card-id="c1"]')!;
    new MutationObserver(list => {                                                  // changes to any card, in any zone
      w.__mutations += list.filter(m => (m.target instanceof Element ? m.target : m.target.parentElement)?.closest('[data-card-id]')).length;
    }).observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
  });
  await store(page, s => s.remote(() => { /* the store already holds what this person wrote */ }));   // the real store echoes writes like this
  await store(page, s => s.remote(() => { /* and again, as a poll would */ }));
  await nextFrames(page, 3);
  expect(await page.evaluate(() => (window as unknown as { __mutations: number }).__mutations)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __first: Element }).__first === document.querySelector('[data-card-id="c1"]'))).toBe(true);
  expect(await card(page, 'c1').boundingBox()).toEqual(before);
  expect([await sectionCount(page, '2-2'), await sectionCount(page, '1-1')]).toEqual(sections);
  expect(await storeCalls(page)).toEqual(['savePositions']);                         // nothing written because of it
  await expect(page.getByTestId('toast')).toBeHidden();
});

test('a snapshot that arrives while my drop is still being written does not undo it', async ({ page }) => {
  await page.goto('dev.html');
  await page.evaluate(() => {                                                       // savePositions waits until the test lets it through
    const w = window as unknown as { __store: { savePositions(...a: unknown[]): Promise<void> }; __finish: () => void };
    const real = w.__store.savePositions.bind(w.__store);
    w.__store.savePositions = (...a) => new Promise<void>((resolve, reject) => {
      w.__finish = () => real(...a).then(resolve, reject);
    });
  });
  const c4 = (await card(page, 'c4').boundingBox())!;
  const target = await centreOf(page, '[data-section="0-0"]');
  const countBefore = [await sectionCount(page, '0-0'), await sectionCount(page, '2-0'), await sectionCount(page, '2-2')];
  await dragCardTo(page, 'c1', '[data-section="0-0"]');
  await expect.poll(() => storeCalls(page)).toEqual(['setLevel', 'setLevel']);        // the levels are in, the position is not
  // The other person moves c4. The snapshot they cause holds c1's new levels but not its new position.
  await store(page, s => s.remote(b => { b.placements.c4!.positions['f-cost'] = 0.95; b.cards.find(c => c.id === 'c4')!.fieldOptions['f-cost'] = 'k2'; }));
  await expect.poll(async () => (await card(page, 'c4').boundingBox())!.x).toBeGreaterThan(c4.x + 300);   // their change shows at once
  await expect(card(page, 'c1')).toHaveAttribute('data-dragging', '');
  await page.evaluate(() => (window as unknown as { __finish: () => void }).__finish());
  await expect(card(page, 'c1')).not.toHaveAttribute('data-dragging', '');
  await nextFrames(page);
  await expect(card(page, 'c1')).toHaveAttribute('data-zone', 'matrix');
  const at = await centreOf(page, '[data-card-id="c1"]');
  expect(Math.abs(at.x - target.x)).toBeLessThan(2);                                // where it was dropped, not where it was before
  expect(Math.abs(at.y - target.y)).toBeLessThan(2);
  // c1 arrived in 0-0 and left 2-2; c4 (the other person's) left 0-0 and arrived in 2-0.
  expect([await sectionCount(page, '0-0'), await sectionCount(page, '2-0'), await sectionCount(page, '2-2')])
    .toEqual([countBefore[0]! + 1 - 1, countBefore[1]! + 1, countBefore[2]! - 1]);
  expect((await positionsOf(page, 'c1'))!['f-cost']).toBeLessThan(0.34);
  const c4After = (await card(page, 'c4').boundingBox())!;
  expect(c4After.x).toBeGreaterThan(c4.x + 300);                                    // and theirs was not undone either
});

test('a drop whose write fails after a snapshot arrived shows what the store holds', async ({ page }) => {
  await page.goto('dev.html');
  await page.evaluate(() => {
    const w = window as unknown as { __store: { savePositions(...a: unknown[]): Promise<void> }; __fail: () => void };
    w.__store.savePositions = () => new Promise<void>((_, reject) => { w.__fail = () => reject(new Error('Offline')); });
  });
  await dragCardTo(page, 'c1', '[data-section="0-0"]');
  await expect.poll(() => storeCalls(page)).toEqual(['setLevel', 'setLevel']);
  await store(page, s => s.remote(b => { b.cards.find(c => c.id === 'c4')!.name = 'Renamed meanwhile'; }));
  await expect(card(page, 'c4')).toHaveAttribute('aria-label', 'Renamed meanwhile');
  await page.evaluate(() => (window as unknown as { __fail: () => void }).__fail());
  await expect(page.getByTestId('toast')).toContainText("Couldn't save the move. Offline");
  await expect(card(page, 'c1')).not.toHaveAttribute('data-dragging', '');
  await expect(card(page, 'c4')).toHaveAttribute('aria-label', 'Renamed meanwhile');
  expect(await fieldsOf(page, 'c1')).toMatchObject({ 'f-cost': 'k0', 'f-value': 'v0' });   // the levels that did go in are shown
  await expect(card(page, 'c1')).toHaveAttribute('data-zone', 'matrix');
});

// ---- while a dialog or the drawer is open ----

for (const [name, button, closer] of [
  ['parameter dialog', 'params', 'Done'], ['resequence drawer', 'resequence', 'Cancel'],
] as const) {
  test(`the matrix behind the open ${name} follows the other person's changes`, async ({ page }) => {
    await page.goto('dev.html');
    const before = (await card(page, 'c4').boundingBox())!;
    const section = await sectionCount(page, '0-0');
    await page.getByTestId(button).click();
    await expect(page.getByRole('button', { name: closer })).toBeVisible();          // the modal is open ...
    await store(page, s => s.remote(b => {
      b.placements.c4!.positions['f-cost'] = 0.95;
      b.cards.find(c => c.id === 'c4')!.fieldOptions['f-cost'] = 'k2';
      b.cards.find(c => c.id === 'c1')!.name = 'Renamed behind the modal';
    }));
    await expect.poll(async () => (await card(page, 'c4').boundingBox())!.x).toBeGreaterThan(before.x + 300);   // ... and the card moved behind it
    await expect(card(page, 'c1')).toHaveAttribute('aria-label', 'Renamed behind the modal');
    expect(await sectionCount(page, '0-0')).toBe(section - 1);
    await expect(page.getByRole('button', { name: closer })).toBeVisible();          // still open
    expect(await storeCalls(page)).toEqual([]);
  });
}

// ---- a drop that the other person's change has made wrong ----

test('axes changed by the other person mid-drag: the drop is discarded with a message and nothing is written', async ({ page }) => {
  await page.goto('dev.html');
  const from = await centreOf(page, '[data-card-id="c1"]');
  await startDrag(page, 'c1', { x: from.x - 150, y: from.y + 60 });
  await expect(card(page, 'c1')).toHaveAttribute('data-dragging', '');
  await store(page, s => s.remote(b => { b.parameters = b.parameters.filter(p => p.id !== 'f-cost'); }));   // the Across parameter
  await expect(page.getByTestId('across')).toHaveValue('f-ease');
  await page.mouse.up();
  await expect(page.getByTestId('toast')).toHaveText('The axes changed while you were dragging. Nothing was moved.');
  await expect(card(page, 'c1')).not.toHaveAttribute('data-dragging', '');
  await nextFrames(page);
  expect(await store(page, s => s.calls.filter(c => c.method === 'savePositions' || c.method === 'setLevel').length)).toBe(0);
  // c1 has a Value but no Ease: with the new axes it waits in the left strip, where the latest snapshot puts it.
  await expect(card(page, 'c1')).toHaveAttribute('data-zone', 'leftStrip');
  const area = (await page.locator('.mm-area').boundingBox())!;
  const at = await centreOf(page, '[data-card-id="c1"]');
  expect(at.y).toBeCloseTo(area.y + (1 - 0.9) * area.height, 0);                    // its Value spot, not where it was dropped
  expect(at.x).toBeLessThan(area.x);
});

test('a tray card that the other person places while it is in the hand can still be dropped back on the tray', async ({ page }) => {
  await page.goto('dev.html');
  await startDrag(page, 'c3', await centreOf(page, '[data-testid="tray"]'));
  await expect(card(page, 'c3')).toHaveAttribute('data-dragging', '');
  await store(page, s => s.remote(b => {
    const c3 = b.cards.find(c => c.id === 'c3')!;
    c3.fieldOptions['f-cost'] = 'k1'; c3.fieldOptions['f-value'] = 'v1';
    b.placements.c3 = { positions: { 'f-cost': 0.5, 'f-value': 0.5 } };
  }));
  await page.mouse.up();
  await expect.poll(async () => await fieldsOf(page, 'c3')).not.toHaveProperty('f-cost');
  expect(await fieldsOf(page, 'c3')).not.toHaveProperty('f-value');
  expect(await positionsOf(page, 'c3')).toBeUndefined();
  await expect(card(page, 'c3')).toHaveAttribute('data-zone', 'tray');
  await expect(page.getByTestId('toast')).toBeVisible();                             // "Cost: Medium → not set, ..."
});
