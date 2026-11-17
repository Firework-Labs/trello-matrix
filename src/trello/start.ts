// Starts the matrix inside Trello. Everything real (the Power-Up library, the page, fetch, the clock and timers) is
// passed in, so this is tested without a browser or Trello; src/matrix-main.ts only supplies the real parts.
import { CAN_RENAME_FIELDS, CLIENT_ID, REDIRECT_URI } from '../config';
import { createPacer } from '../model/pacer';
import type { mountMatrix } from '../view/app';
import { createAuth } from './auth';
import { createRest } from './rest';
import { createTrelloStore } from './trello-store';

export interface StartDeps {
  powerUp: { iframe(options: { clientId: string; redirectUri: string }): TrelloIframe };
  root: HTMLElement;
  fetch: typeof fetch;
  mount: typeof mountMatrix;                      // injected so the test needs no DOM
  now: () => number;                              // a steady clock (performance.now in the page)
  sleep: (ms: number) => Promise<void>;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  /** Whether the page can be seen (the store's steady read pauses while it cannot). Default: always. */
  isVisible?: () => boolean;
}

/** Trello's limit is 100 requests per 10 seconds per person; this stays under it. */
const MAX_PER_WINDOW = 80;
const WINDOW_MS = 10_000;

export async function startMatrix(deps: StartDeps): Promise<{ destroy(): void }> {
  const t = deps.powerUp.iframe({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
  const auth = createAuth(t);
  const pacer = createPacer({ maxPerWindow: MAX_PER_WINDOW, windowMs: WINDOW_MS, now: deps.now, sleep: deps.sleep });
  const rest = createRest({
    auth, fetch: deps.fetch, pacer, sleep: deps.sleep, setTimeout: deps.setTimeout, clearTimeout: deps.clearTimeout,
  });
  const store = createTrelloStore({
    t, rest, auth, now: deps.now, setTimeout: deps.setTimeout, clearTimeout: deps.clearTimeout,
    ...(deps.isVisible ? { isVisible: deps.isVisible } : {}),
  });
  const focus: unknown = t.arg('focusCardId');
  return await deps.mount(deps.root, store, {
    ...(typeof focus === 'string' && focus !== '' ? { focusCardId: focus } : {}),
    canRenameLevels: CAN_RENAME_FIELDS,
    canRenameParameters: CAN_RENAME_FIELDS,
  });
}

/** What the page shows when the matrix cannot start. Fixed: nothing Trello or the browser said is ever put on the page. */
export const COULD_NOT_START = 'The matrix could not start. Close this window and open it again.';

/** The real parts of the page, as `src/matrix-main.ts` passes them in (and a test replaces them). */
export interface BootEnv {
  window: {
    TrelloPowerUp?: StartDeps['powerUp'] | null;   // missing when Trello's library did not load
    fetch: typeof fetch;
    performance: { now(): number };
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  document: { getElementById(id: string): HTMLElement | null; body: HTMLElement; visibilityState?: string };
  mount: typeof mountMatrix;
}

/**
 * Starts the matrix on the page. Whatever goes wrong (the library missing, no #app, a throw, a rejection) ends the
 * same way: the fixed sentence on the page and nothing else. It never rejects and never logs.
 */
export async function bootMatrix(env: BootEnv): Promise<void> {
  let target: HTMLElement | null = null;
  try {
    target = env.document.getElementById('app');
    if (target === null) { env.document.body.textContent = COULD_NOT_START; return; }
    const { window: w } = env;
    const powerUp = w.TrelloPowerUp;
    if (!powerUp || typeof powerUp.iframe !== 'function') throw new Error('The Power-Up library is missing.');
    await startMatrix({
      powerUp,
      root: target,
      fetch: w.fetch.bind(w),
      mount: env.mount,
      now: () => w.performance.now(),
      sleep: ms => new Promise<void>(resolve => { w.setTimeout(resolve, ms); }),
      setTimeout: (fn, ms) => w.setTimeout(fn, ms),
      clearTimeout: handle => { w.clearTimeout(handle); },
      isVisible: () => env.document.visibilityState !== 'hidden',
    });
  } catch {
    try { (target ?? env.document.body).textContent = COULD_NOT_START; } catch { /* nothing more can be done */ }
  }
}
