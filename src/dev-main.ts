import { createFakeStore, type FakeStore } from './store/fake-store';
import { sampleSnapshot } from './store/sample-data';
import { mountMatrix } from './view/app';

/** The matrix on the in-memory fake store, for development and the browser tests. Never talks to Trello. */

interface RenderStats { last: number; p95: number }
declare global {
  interface Window { __store: FakeStore; __renderMs: RenderStats }
}

const query = new URLSearchParams(location.search);
const snapshot = sampleSnapshot({ cards: Number(query.get('cards') ?? 85) });
snapshot.canEdit = query.get('readonly') !== '1';
const store = createFakeStore({ snapshot, connected: query.get('connected') !== '0' });
window.__store = store;

const SAMPLES = 200;
const times: number[] = [];
window.__renderMs = { last: 0, p95: 0 };
function recordRender(ms: number): void {
  times.push(ms);
  if (times.length > SAMPLES) times.shift();
  const sorted = [...times].sort((a, b) => a - b);
  window.__renderMs = { last: ms, p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? ms };
}

void mountMatrix(document.getElementById('app')!, store, { onRenderTime: recordRender });
