import type { ViewSettings } from './model/types';
import { createFakeStore, type FakeStore } from './store/fake-store';
import { sampleSnapshot } from './store/sample-data';
import { mountMatrix } from './view/app';

/**
 * The matrix on the in-memory fake store, for development and the browser tests. Never talks to Trello.
 *
 * Page options (query string): cards=N (sample size), readonly=1, connected=0, fresh=1 (no saved view),
 * lists=id,id (the chosen lists), across=id and up=id (the axes), emptyDoing=1 (no cards in the Doing list),
 * params=N (only the first N parameters).
 */

interface RenderStats { last: number; p95: number }
declare global {
  interface Window { __store: FakeStore; __renderMs: RenderStats }
}

/** Where the dev page keeps the person's saved view, so it survives a reload (the fake store itself does not). */
const VIEW_KEY = 'trello-matrix-dev-view';

/** What a page with no `fresh` option starts with, so the other browser tests find the matrix drawn. */
const SEEDED_VIEW: ViewSettings = {
  across: 'f-cost', up: 'f-value', listIds: ['l-backlog', 'l-ideas'],
  colourBy: { kind: 'label' }, showImages: true, zoom: 1, panX: 0, panY: 0,
};
const BLANK_VIEW: ViewSettings = { ...SEEDED_VIEW, across: null, up: null, listIds: [] };

const query = new URLSearchParams(location.search);
const snapshot = sampleSnapshot({ cards: Number(query.get('cards') ?? 85) });
snapshot.canEdit = query.get('readonly') !== '1';
if (query.get('emptyDoing') === '1') {
  snapshot.cards = snapshot.cards.filter(c => c.idList !== 'l-doing');
  snapshot.placements = Object.fromEntries(Object.entries(snapshot.placements).filter(([id]) => snapshot.cards.some(c => c.id === id)));
}
if (query.has('params')) snapshot.parameters = snapshot.parameters.slice(0, Number(query.get('params')));

const store = createFakeStore({ snapshot, connected: query.get('connected') !== '0' });
window.__store = store;

function storedView(): ViewSettings | null {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? 'null') as ViewSettings | null;
  } catch {
    return null;                       // not valid JSON: treated as no saved view
  }
}

// The fake store keeps the view in memory only, so start it from sessionStorage and write every save back there.
let view: ViewSettings | null = query.get('fresh') === '1' ? null : storedView() ?? SEEDED_VIEW;
if (query.has('lists') || query.has('across') || query.has('up')) {
  view = { ...(view ?? BLANK_VIEW) };
  if (query.has('lists')) view.listIds = query.get('lists')!.split(',').filter(Boolean);
  if (query.has('across')) view.across = query.get('across');
  if (query.has('up')) view.up = query.get('up');
}
const fakeSaveView = store.saveView;
// Every other method is looked up on the fake itself, so a test that replaces one on `window.__store` still takes effect.
const devStore: FakeStore = Object.create(store, {
  saveView: {
    async value(next: ViewSettings) {
      await fakeSaveView(next);
      sessionStorage.setItem(VIEW_KEY, JSON.stringify(next));
    },
  },
});

const SAMPLES = 200;
const times: number[] = [];
window.__renderMs = { last: 0, p95: 0 };
function recordRender(ms: number): void {
  times.push(ms);
  if (times.length > SAMPLES) times.shift();
  const sorted = [...times].sort((a, b) => a - b);
  window.__renderMs = { last: ms, p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? ms };
}

void (async () => {
  if (view) await fakeSaveView(view);
  await mountMatrix(document.getElementById('app')!, devStore, { onRenderTime: recordRender });
})();
