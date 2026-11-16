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
  newId: () => string;
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
    t, rest, auth, newId: deps.newId, now: deps.now, setTimeout: deps.setTimeout, clearTimeout: deps.clearTimeout,
  });
  const focus: unknown = t.arg('focusCardId');
  return await deps.mount(deps.root, store, {
    ...(typeof focus === 'string' && focus !== '' ? { focusCardId: focus } : {}),
    canRenameLevels: CAN_RENAME_FIELDS,
    canRenameParameters: CAN_RENAME_FIELDS,
  });
}
