// The BoardStore on Trello: reads through the Power-Up client library, writes dropdown values through REST,
// and keeps the matrix's own data in Trello's plugin storage. Everything it needs is passed in, so
// tests use fakes. What a real board does is recorded in docs/proof-results.md.
import { clampPosition } from '../model/placement';
import type { BoardSnapshot, Card } from '../model/types';
import { StoreError, type BoardStore } from '../store/board-store';
import {
  parameterFromField, parameterNamed, validateLink, validateNewParameter, worstToBest,
} from '../store/parameter-rules';
import type { TrelloAuth } from './auth';
import { createOverlay } from './overlay';
import {
  KEY_CARD, KEY_PARAMS, KEY_VIEW, assertFits, decodeCard, decodeParams, decodeView, encodeCard,
  type StoredCard, type StoredParam,
} from './plugin-data';
import type { Rest } from './rest';
import { coverUrls, toSnapshot, type RawBoardData } from './snapshot';

/** Reads that follow a render or a subscription are made this long after the first of them, so a burst makes one. */
const RELOAD_DELAY_MS = 200;

/**
 * While anyone is subscribed and the page can be seen, the board is also read this often. Trello's render notice did not
 * reliably arrive for another window's or person's changes (acceptance lines 16 and 17, 2026-11-17); this read goes
 * through the Power-Up library, so it makes no REST request and does not count against Trello's request limit.
 */
export const POLL_MS = 3000;

/**
 * A read, or one call to Trello's plugin storage, that has not answered by now is given up on. Without this, one call that
 * never answers would hold every later read behind it, and a write's lock and "under way" count for good.
 */
const CALL_TIMEOUT_MS = 20_000;
const TIMED_OUT = 'Trello did not answer in time.';

const LIMIT_MESSAGE = "Trello's 4,096-character limit for stored data was reached.";
const RENAME_MESSAGE = "Trello does not let the matrix rename fields. Rename it in Trello's Custom Fields editor.";
const NOT_CREATED = "Trello would not create the field. Create a dropdown field with that name in Trello's Custom Fields editor, then add it here to link it.";
const CREATED_NOT_ADDED = 'The field was created in Trello but could not be added to the matrix. Link it from the dialog.';
const invalid = (message: string) => new StoreError('invalid', message);

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (isString(e)) return e;
  return isRecord(e) && isString(e.message) ? e.message : '';
}

/** The error for a failed write to Trello's plugin storage. Trello's own words are never repeated. */
function saveError(e: unknown): StoreError {
  if (e instanceof StoreError) return e;
  return messageOf(e).includes('4096') ? new StoreError('limit', LIMIT_MESSAGE) : new StoreError('network', 'Could not save to Trello.');
}

const restError = (e: unknown): StoreError => (e instanceof StoreError ? e : new StoreError('network', 'Could not reach Trello.'));

/** Starts `fn` now, turning a throw into a rejection. */
function call<T>(fn: () => Promise<T>): Promise<T> {
  try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); }
}

/** The ids of the entries of an array that are objects with a string id, each once. */
function idsOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.flatMap(e => (isRecord(e) && isString(e.id) ? [e.id] : [])))];
}

interface ReadResult {
  shown: BoardSnapshot;                     // the snapshot with our own recent writes laid over it
  startedAt: number;                        // the write counter when the read began
}

/** Largest entry the parameter list can gain: a 24-character field id and three 24-character option ids. */
const LARGEST_PARAM_ENTRY: StoredParam = { f: 'f'.repeat(24), o: ['a', 'b', 'c'].map(c => c.repeat(24)) };

/** How many times `load` reads when its read keeps being overtaken by our own writes. */
const LOAD_ATTEMPTS = 3;

export function createTrelloStore(o: {
  t: TrelloIframe; rest: Rest; auth: TrelloAuth;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  /** Whether the page can be seen; the steady read is skipped while it cannot. Default: always. */
  isVisible?: () => boolean;
}): BoardStore {
  const { t, rest, auth } = o;
  const overlay = createOverlay({ now: o.now });

  /**
   * `work`'s result, or a network error once CALL_TIMEOUT_MS have passed. An answer or a failure of `work` after that is
   * dropped: it is not passed on, and (being handled here) it is never an unhandled rejection.
   */
  function timed<T>(work: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let over = false;
      const handle = o.setTimeout(() => { over = true; reject(new StoreError('network', TIMED_OUT)); }, CALL_TIMEOUT_MS);
      work.then(
        value => { if (!over) { over = true; o.clearTimeout(handle); resolve(value); } },
        error => { if (!over) { over = true; o.clearTimeout(handle); reject(error); } },
      );
    });
  }

  // What the latest read that no write of ours overlapped showed. `base` is before the overlay, so applying the
  // overlay to it again always gives the same result plus any writes noted since.
  let base: BoardSnapshot | null = null;
  let storedParams: StoredParam[] = [];     // the parameter list as last read or written
  let covers: Record<string, string> = {};
  let boardId: string | null = null;

  // Our own writes. `epoch` counts every one that finished; `busy` counts operations still under way.
  let epoch = 0;
  let busy = 0;
  let idleWaiters: (() => void)[] = [];

  const whenIdle = (): Promise<void> => (busy === 0 ? Promise.resolve() : new Promise<void>(resolve => { idleWaiters.push(resolve); }));

  /** One write operation: reloads wait until it is done, and reads that began before it ended are known to be older. */
  async function own<T>(fn: () => Promise<T>): Promise<T> {
    busy++;
    try { return await fn(); } finally {
      epoch++;
      if (--busy === 0) { const waiting = idleWaiters; idleWaiters = []; for (const resume of waiting) resume(); }
    }
  }
  /** One request to Trello that changes something. Whatever it notes goes in `fn`, before the epoch moves on. */
  async function step<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } finally { epoch++; }
  }

  /** One at a time per key, so two read-then-write sequences on the same stored value cannot lose an update. */
  const tails = new Map<string, Promise<void>>();
  function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const result = (tails.get(key) ?? Promise.resolve()).then(fn);
    const tail = result.then(() => {}, () => {});
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return result;
  }

  // ------------------------------------------------------------ reading

  function canEdit(): boolean {
    try {
      const permissions = (t.getContext() as { permissions?: unknown } | null)?.permissions;
      return isRecord(permissions) && permissions.board === 'write';
    } catch { return false; }
  }

  async function gather(): Promise<RawBoardData> {
    try {
      const cards = call(() => t.cards('id', 'name', 'idList', 'pos', 'labels', 'members', 'cover', 'customFieldItems'));
      // A card whose own data cannot be read counts as having none; anything else failing fails the read.
      const cardEntries = cards.then(list => Promise.all(idsOf(list).map(id =>
        call(() => t.get(id, 'shared', KEY_CARD)).then(
          value => [id, value] as const,
          () => [id, undefined] as const,
        ))));
      const [cardList, lists, board, params, entries] = await Promise.all([
        cards,
        call(() => t.lists('id', 'name')),
        call(() => t.board('id', 'labels', 'customFields', 'members')),
        call(() => t.get('board', 'shared', KEY_PARAMS)),
        cardEntries,
      ]);
      // fromEntries makes own properties even for an id like `__proto__`.
      return { cards: cardList, lists, board, cardData: Object.fromEntries(entries), params, canEdit: canEdit() };
    } catch {
      throw new StoreError('network', 'Could not read from Trello.');
    }
  }

  /** Reads reach the overlay one at a time and in the order they began, so an older answer never lands after a newer one. */
  let readChain: Promise<unknown> = Promise.resolve();
  function read(): Promise<ReadResult> {
    const run = async (): Promise<ReadResult> => {
      const startedAt = epoch;
      const data = await timed(gather());     // an answer that comes after the limit is dropped here: nothing below sees it
      const snapshot = toSnapshot(data);
      const params = decodeParams(data.params);
      const shown = overlay.apply(snapshot, params);
      if (epoch === startedAt) {
        base = snapshot; storedParams = params; covers = coverUrls(data.cards);
        if (isRecord(data.board) && isString(data.board.id) && data.board.id !== '') boardId = data.board.id;
      }
      return { shown, startedAt };
    };
    const next = readChain.then(run);
    readChain = next.catch(() => undefined);
    return next;
  }

  /**
   * Whether a read can be shown as the board now: none of our writes finished since it began, and none is under way
   * (one under way may already have been answered for the card the read looked at before the write took effect).
   */
  const isCurrent = (r: ReadResult) => r.startedAt === epoch && busy === 0;

  /** The latest snapshot we know, with our own writes since laid over it. Reads once if there is none yet. */
  async function latest(): Promise<BoardSnapshot> {
    return base === null ? (await read()).shown : overlay.apply(base, storedParams);
  }

  async function requireCard(cardId: string): Promise<{ snap: BoardSnapshot; card: Card }> {
    const snap = await latest();
    const card = snap.cards.find(c => c.id === cardId);
    if (!card) throw invalid('That card is no longer on the board.');
    return { snap, card };
  }

  // ------------------------------------------------------------ plugin storage

  async function getKey(scope: string, visibility: 'shared' | 'private', key: string): Promise<unknown> {
    try {
      return await timed(call(() => t.get(scope, visibility, key)));
    } catch (e) {
      throw e instanceof StoreError ? e : new StoreError('network', 'Could not read from Trello.');
    }
  }
  async function setKey(scope: string, visibility: 'shared' | 'private', key: string, value: unknown): Promise<void> {
    assertFits(value);
    await step(async () => { try { await timed(call(() => t.set(scope, visibility, key, value))); } catch (e) { throw saveError(e); } });
  }
  /** Stores the saved view. It cannot change a snapshot, so it is not counted as a write that reads must wait for. */
  async function setView(value: unknown): Promise<void> {
    assertFits(value);
    try { await timed(call(() => t.set('board', 'private', KEY_VIEW, value))); } catch (e) { throw saveError(e); }
  }
  async function removeKey(scope: string, visibility: 'shared' | 'private', key: string): Promise<void> {
    await step(async () => { try { await timed(call(() => t.remove(scope, visibility, key))); } catch (e) { throw saveError(e); } });
  }

  function updateCard(cardId: string, change: (stored: StoredCard) => StoredCard): Promise<void> {
    return locked(`card:${cardId}`, async () => {
      const value = encodeCard(change(decodeCard(await getKey(cardId, 'shared', KEY_CARD))));
      if (value === null) await removeKey(cardId, 'shared', KEY_CARD);
      else await setKey(cardId, 'shared', KEY_CARD, value);
    });
  }

  /** Reads the parameter list now and stores what `change` makes of it (null leaves it alone). Call inside the 'params' lock. */
  async function editParams(change: (list: StoredParam[]) => StoredParam[] | null): Promise<void> {
    const next = change(decodeParams(await getKey('board', 'shared', KEY_PARAMS)));
    if (next === null) return;
    await setKey('board', 'shared', KEY_PARAMS, next);
    storedParams = next;
  }

  function currentBoardId(): string {
    if (boardId !== null) return boardId;
    try {
      const fromContext = (t.getContext() as { board?: unknown } | null)?.board;
      if (isString(fromContext) && fromContext !== '') return fromContext;
    } catch { /* falls through */ }
    throw new StoreError('network', 'Could not tell which board this is.');
  }

  // ------------------------------------------------------------ subscribing

  const subscribers = new Set<(snap: BoardSnapshot) => void>();
  let renderHooked = false;
  let timer: unknown = null;
  let reloading = false;
  let reloadAgain = false;

  function deliver(snap: BoardSnapshot) {
    for (const notify of [...subscribers]) {
      try { notify(structuredClone(snap)); } catch { /* one view's failure must not stop the others */ }
    }
  }

  /** Reads until a read that none of our writes overlapped, and delivers it. A failed read is dropped; the next render tries again. */
  async function reloadOnce(): Promise<void> {
    try {
      for (;;) {
        if (subscribers.size === 0) return;
        await whenIdle();                                   // a read made during a write would only be thrown away
        if (subscribers.size === 0) return;
        const result = await read();
        if (isCurrent(result)) { deliver(result.shown); return; }
      }
    } catch { /* dropped */ }
  }

  async function reload(): Promise<void> {
    if (reloading) { reloadAgain = true; return; }          // what changed may have come after that read began
    reloading = true;
    try {
      do { reloadAgain = false; await reloadOnce(); } while (reloadAgain && subscribers.size > 0);
    } finally { reloading = false; }
  }

  function scheduleReload() {
    if (timer !== null) return;
    timer = o.setTimeout(() => { timer = null; void reload(); }, RELOAD_DELAY_MS);
  }

  /** The steady read: every POLL_MS while subscribed. A read already pending or under way counts as this one. */
  let pollTimer: unknown = null;
  function schedulePoll() {
    pollTimer = o.setTimeout(() => {
      pollTimer = null;
      if (subscribers.size === 0) return;
      if (!reloading && (o.isVisible?.() ?? true)) scheduleReload();
      schedulePoll();
    }, POLL_MS);
  }

  // ------------------------------------------------------------ the store

  return {
    isConnected: () => auth.isAuthorized(),

    async connect() {
      // authorize() is called before anything is awaited: a browser blocks a pop-up opened after an async gap.
      try { await auth.authorize(); } catch { throw new StoreError('auth', 'Trello access was not given.'); }
    },

    async load() {
      // A read that one of our writes overtook is read again, a few times at most.
      for (let attempt = 1; ; attempt++) {
        const result = await read();
        if (isCurrent(result) || attempt >= LOAD_ATTEMPTS) return structuredClone(result.shown);
      }
    },

    subscribe(onChange) {
      const subscriber = (snap: BoardSnapshot) => onChange(snap);
      subscribers.add(subscriber);
      if (!renderHooked) {
        renderHooked = true;
        t.render(() => { if (subscribers.size > 0) scheduleReload(); });   // the library has no way to take it back
      }
      scheduleReload();
      if (pollTimer === null) schedulePoll();
      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size > 0) return;
        if (timer !== null) { o.clearTimeout(timer); timer = null; }
        if (pollTimer !== null) { o.clearTimeout(pollTimer); pollTimer = null; }
      };
    },

    savePositions(cardId, positions) {
      return own(async () => {
        await requireCard(cardId);
        for (const v of Object.values(positions)) {
          if (v !== null && !(typeof v === 'number' && Number.isFinite(v))) throw invalid('That position is not a number.');
        }
        await updateCard(cardId, stored => {
          const p = new Map(Object.entries(stored.p ?? {}));
          for (const [paramId, v] of Object.entries(positions)) {
            if (v === null) p.delete(paramId); else p.set(paramId, clampPosition(v));
          }
          return { p: Object.fromEntries(p) };
        });
      });
    },

    setLevel(cardId, param, level) {
      return own(async () => {
        const { snap, card } = await requireCard(cardId);
        // The parameter may have been removed since the view built it; a value written for a field nobody plots is a stray write.
        if (!snap.parameters.some(p => p.fieldId === param.fieldId)) throw invalid('That parameter is no longer on the board.');
        const optionId = level === null ? null : Number.isInteger(level) ? param.optionIds[level] : undefined;
        if (optionId === undefined) throw invalid('That level does not exist.');
        const was = Object.hasOwn(card.fieldOptions, param.fieldId) ? (card.fieldOptions[param.fieldId] ?? null) : null;
        await step(async () => {
          await call(() => rest.setFieldOption(cardId, param.fieldId, optionId)).catch(e => { throw restError(e); });
          overlay.noteFieldOption(cardId, param.fieldId, optionId, was);
        });
      });
    },

    createParameter(input) {
      return own(() => locked('params', async () => {
        const { name, levels } = validateNewParameter(await latest(), input);
        const id = currentBoardId();
        // The list must still have room for the entry, or the field would be made and then could not be added.
        assertFits([...decodeParams(await getKey('board', 'shared', KEY_PARAMS)), LARGEST_PARAM_ENTRY]);
        // Sent once from here, never again after a failure: a second field would be left on the shared board. (The REST client
        // does repeat a request Trello refused with 429 after a wait; that refusal means nothing was applied.)
        const field = await step(async () => {
          const made = await call(() => rest.createDropdownField(id, name, levels)).catch(e => {
            const error = restError(e);
            throw error.kind === 'permission' ? new StoreError('permission', NOT_CREATED) : error;
          });
          overlay.noteField(made);
          return made;
        });
        try {
          await editParams(list => [...list, { f: field.id, o: worstToBest(field.options.map(opt => opt.id), input.bestEnd) }]);
        } catch {
          throw new StoreError('network', CREATED_NOT_ADDED);
        }
        return parameterFromField(field, input.bestEnd);
      }));
    },

    linkParameter(fieldId, bestEnd) {
      return own(() => locked('params', async () => {
        const param = parameterFromField(validateLink(await latest(), fieldId), bestEnd);
        await editParams(list => [...list.filter(e => e.f !== param.fieldId), { f: param.fieldId, o: param.optionIds }]);
        return param;
      }));
    },

    async renameParameter() { throw new StoreError('permission', RENAME_MESSAGE); },
    async renameLevel() { throw new StoreError('permission', RENAME_MESSAGE); },

    removeParameter(id) {
      return own(() => locked('params', async () => {
        const { param } = parameterNamed(await latest(), id);
        await editParams(list => (list.some(e => e.f === param.fieldId) ? list.filter(e => e.f !== param.fieldId) : null));
      }));
    },

    async openCard(cardId) {
      try { await t.showCard(cardId); } catch { throw new StoreError('network', 'Could not open the card.'); }
    },

    async coverImageUrl(cardId) {
      return Object.hasOwn(covers, cardId) ? (covers[cardId] ?? null) : null;
    },

    async loadView() { return decodeView(await getKey('board', 'private', KEY_VIEW)); },
    saveView: view => setView(view),
  };
}
