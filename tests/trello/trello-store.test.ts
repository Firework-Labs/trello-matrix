import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BoardSnapshot, DropdownField, Parameter, ViewSettings } from '../../src/model/types';
import { StoreError, type BoardStore, type Progress } from '../../src/store/board-store';
import type { TrelloAuth } from '../../src/trello/auth';
import { KEY_CARD, KEY_PARAMS, KEY_REORDER, KEY_VIEW } from '../../src/trello/plugin-data';
import type { Rest } from '../../src/trello/rest';
import { POLL_MS, createTrelloStore } from '../../src/trello/trello-store';

// ---------------------------------------------------------------- fakes

type Vis = 'shared' | 'private';
interface Op { op: 'set' | 'remove'; scope: string; vis: Vis; key: string; value?: unknown }

const COVER = { previews: [{ url: 'https://trello.com/p/150', width: 150, height: 100 }, { url: 'https://trello.com/p/600', width: 600, height: 400 }] };
const opt = (id: string, text: string, pos: number) => ({ id, value: { text }, color: 'none', pos });
const rawCard = (id: string, idList: string, pos: number, value?: string, extra: object = {}) => ({
  id, name: `Card ${id}`, idList, pos, labels: [], members: [], cover: null,
  customFieldItems: value ? [{ id: `i-${id}`, idCustomField: 'f1', idValue: value }] : [], ...extra,
});

/** Everything the fake Power-Up library and the fake REST client share, so a test can change it between calls. */
interface World {
  data: Map<string, unknown>;                 // plugin data: scope|visibility|key
  cards: { id: string; pos: number; customFieldItems: unknown[]; [k: string]: unknown }[];
  lists: unknown[];
  board: { id: string; customFields: unknown[]; [k: string]: unknown };
  permissions: unknown;
  cardsImpl: (() => Promise<unknown>) | null;     // replaces the default answer of t.cards
  failGet: (scope: string, vis: string, key: string) => Error | null;
  failSet: (scope: string, vis: string, key: string) => Error | null;
  setGate: Promise<void> | null;                  // t.set waits for this before it takes effect
  hangSet: ((scope: string, key: string) => boolean) | null;   // a t.set or t.remove for which this is true never answers
  hangGet: ((scope: string, key: string) => boolean) | null;   // a t.get for which this is true never answers
  ops: Op[];                                  // t.set and t.remove that went through
  log: string[];                              // every write from the store, t and REST, in order
  renderFns: (() => unknown)[];
  shown: string[];
  cardsCalls: number;
  clock: number;
  newIds: number;
}

const dkey = (scope: string, vis: string, key: string) => `${scope}|${vis}|${key}`;
const put = (w: World, scope: string, vis: Vis, key: string, value: unknown) => { w.data.set(dkey(scope, vis, key), structuredClone(value)); };
const read = (w: World, scope: string, vis: Vis, key: string) => w.data.get(dkey(scope, vis, key));
const marker = (w: World) => read(w, 'board', 'shared', KEY_REORDER);
const storedParams = (w: World) => read(w, 'board', 'shared', KEY_PARAMS);
const cardValue = (w: World, id: string) => read(w, id, 'shared', KEY_CARD);
const raw = (w: World, id: string) => w.cards.find(c => c.id === id)!;

function newWorld(): World {
  const w: World = {
    data: new Map(),
    cards: [
      rawCard('c1', 'l1', 100, 'oMed', { cover: COVER, labels: [{ id: 'lab1', name: 'Bug', color: 'red' }], members: [{ id: 'm1', fullName: 'Ann Lee' }] }),
      rawCard('c2', 'l1', 200), rawCard('c3', 'l1', 300), rawCard('c4', 'l2', 100),
    ],
    lists: [{ id: 'l1', name: 'Backlog' }, { id: 'l2', name: 'Doing' }],
    board: {
      id: 'b1',
      labels: [{ id: 'lab1', name: 'Bug', color: 'red' }],
      members: [{ id: 'm1', fullName: 'Ann Lee', initials: 'AL' }],
      customFields: [
        { id: 'f1', name: 'Value', type: 'list', options: [opt('oMed', 'Medium', 2), opt('oHigh', 'High', 3), opt('oLow', 'Low', 1)] },
        { id: 'f2', name: 'Ease', type: 'list', options: [opt('e0', 'Hard', 1), opt('e1', 'Easy', 2)] },
        { id: 'f3', name: 'Impacts', type: 'list', options: [opt('i0', 'a', 1), opt('i1', 'b', 2), opt('i2', 'c', 3), opt('i3', 'd', 4)] },
        { id: 'f4', name: 'Reach', type: 'list', options: [opt('r0', 'Few', 1), opt('r1', 'Some', 2), opt('r2', 'Many', 3)] },
      ],
    },
    permissions: { board: 'write' },
    cardsImpl: null, failGet: () => null, failSet: () => null, setGate: null, hangSet: null, hangGet: null,
    ops: [], log: [], renderFns: [], shown: [], cardsCalls: 0, clock: 1_000_000, newIds: 0,
  };
  put(w, 'board', 'shared', KEY_PARAMS, [{ f: 'f1', o: ['oLow', 'oMed', 'oHigh'] }]);
  put(w, 'c1', 'shared', KEY_CARD, { p: { f1: 0.9 } });
  return w;
}

/** A Power-Up library over `w`. Stored data comes back as copies; `cards`, `lists` and `board` answer whatever `w` holds now. */
function makeT(w: World): TrelloIframe {
  return {
    async get(scope, vis, key, def) {
      if (w.hangGet?.(scope, key)) await new Promise(() => {});
      const err = w.failGet(scope, vis, key);
      if (err) throw err;
      const k = dkey(scope, vis, key);
      return w.data.has(k) ? structuredClone(w.data.get(k)) : def;
    },
    async set(scope, vis, key, value) {
      if (w.hangSet?.(scope, key)) await new Promise(() => {});
      const err = w.failSet(scope, vis, key);
      if (err) throw err;
      if (w.setGate) await w.setGate;
      w.ops.push({ op: 'set', scope, vis, key, value: structuredClone(value) });
      w.log.push(`set ${scope} ${key}`);
      put(w, scope, vis, key, value);
    },
    async remove(scope, vis, key) {
      if (w.hangSet?.(scope, key)) await new Promise(() => {});
      const err = w.failSet(scope, vis, key);
      if (err) throw err;
      w.ops.push({ op: 'remove', scope, vis, key });
      w.log.push(`remove ${scope} ${key}`);
      w.data.delete(dkey(scope, vis, key));
    },
    async cards() {
      w.cardsCalls++;
      return (w.cardsImpl ? await w.cardsImpl() : structuredClone(w.cards)) as never;
    },
    async lists() { return structuredClone(w.lists) as never; },
    async board() { return structuredClone(w.board) as never; },
    getContext: () => ({ board: 'b1', member: 'm1', permissions: w.permissions }),
    async modal() {},
    async showCard(id) { w.shown.push(id); },
    render(fn) { w.renderFns.push(fn); },
    arg: () => undefined,
    getOAuth2ApiClient: () => { throw new Error('not used by the store'); },
  };
}

interface RestControl {
  calls: { method: string; args: unknown[] }[];
  failOn: Map<number, StoreError>;           // the Nth call (1 is the first, any method) rejects
  gate: Promise<void> | null;                // every call waits for this first
  applyPos: boolean;                         // Trello applies setCardPos to the cards t.cards shows (default true)
  onCall: ((n: number) => void) | null;      // runs as each call arrives (n counts from 1), to change the world mid-operation
}
/** A REST client that records its calls. setFieldOption changes nothing in `w` (Trello's own data lags); the test moves it. */
function makeRest(w: World): Rest & RestControl {
  let fields = 0;
  const ctl: RestControl = { calls: [], failOn: new Map(), gate: null, applyPos: true, onCall: null };
  const enter = async (method: string, args: unknown[]) => {
    ctl.calls.push({ method, args });
    w.log.push(`rest ${method} ${args.slice(0, 3).join(' ')}`);
    ctl.onCall?.(ctl.calls.length);
    if (ctl.gate) await ctl.gate;
    const failure = ctl.failOn.get(ctl.calls.length);
    if (failure) throw failure;
  };
  return Object.assign(ctl, {
    async createDropdownField(boardId: string, name: string, texts: string[]): Promise<DropdownField> {
      await enter('createDropdownField', [boardId, name, texts]);
      const id = `fNew${++fields}`;
      return { id, name, options: texts.map((text, i) => ({ id: `${id}o${i}`, text, colour: 'none' })) };
    },
    async setFieldOption(cardId: string, fieldId: string, optionId: string | null) {
      await enter('setFieldOption', [cardId, fieldId, optionId]);
    },
    async setCardPos(cardId: string, pos: number) {
      await enter('setCardPos', [cardId, pos]);
      if (ctl.applyPos) raw(w, cardId).pos = pos;
    },
  });
}

function makeAuth() {
  const calls: string[] = [];
  const ctl = { calls, authorized: true, refuse: false };
  const auth: TrelloAuth = {
    authorize() { calls.push('authorize'); return ctl.refuse ? Promise.reject(new Error('declined, secret-ish detail')) : Promise.resolve(); },
    async accessToken() { return 'T'; },
    async isAuthorized() { calls.push('isAuthorized'); return ctl.authorized; },
  };
  return Object.assign(auth, ctl, { ctl });
}

function setup(opts: { isVisible?: () => boolean } = {}) {
  const w = newWorld();
  const t = makeT(w);
  const rest = makeRest(w);
  const auth = makeAuth();
  let n = 0;
  const st: BoardStore = createTrelloStore({
    t, rest, auth,
    newId: () => { w.newIds++; return `gen-${++n}`; },
    now: () => w.clock,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    ...opts,
  });
  return { w, t, rest, auth, st };
}

const settle = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };
const paramNamed = (s: BoardSnapshot, id: string): Parameter => s.parameters.find(p => p.id === id)!;
const cardIn = (s: BoardSnapshot, id: string) => s.cards.find(c => c.id === id)!;
const error = async (p: Promise<unknown>): Promise<StoreError> => {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(StoreError); return e as StoreError; }
  throw new Error('did not reject');
};
const noWrites = (w: World, rest: RestControl) => { expect(w.ops).toEqual([]); expect(rest.calls).toEqual([]); };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// ---------------------------------------------------------------- reading

describe('load', () => {
  test('maps the board and asks the library for everything it needs', async () => {
    const { w, st } = setup();
    const s = await st.load();
    expect(s.lists).toEqual([{ id: 'l1', name: 'Backlog' }, { id: 'l2', name: 'Doing' }]);
    expect(s.labels).toEqual([{ id: 'lab1', name: 'Bug', colour: 'red' }]);
    expect(s.members).toEqual([{ id: 'm1', fullName: 'Ann Lee', initials: 'AL' }]);
    expect(s.dropdownFields.map(f => f.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(s.dropdownFields[0]!.options.map(o => o.id)).toEqual(['oLow', 'oMed', 'oHigh']);
    expect(s.parameters).toEqual([{ id: 'f1', name: 'Value', fieldId: 'f1', levels: ['Low', 'Medium', 'High'], optionIds: ['oLow', 'oMed', 'oHigh'] }]);
    expect(s.cards.map(c => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(cardIn(s, 'c1')).toMatchObject({ idList: 'l1', pos: 100, labelIds: ['lab1'], memberIds: ['m1'], hasCover: true, fieldOptions: { f1: 'oMed' } });
    expect(s.placements).toEqual({ c1: { positions: { f1: 0.9 } } });
    expect(s.canEdit).toBe(true);
    expect(s.canUndoReorder).toBe(false);
    expect(w.ops).toEqual([]);
  });

  test('canEdit follows the board permission in the context, and is false when it is missing or odd', async () => {
    for (const [permissions, expected] of [[{ board: 'read' }, false], [undefined, false], [{ board: 'WRITE' }, false], ['write', false], [{ board: 'write' }, true]] as const) {
      const { w, st } = setup();
      w.permissions = permissions;
      expect((await st.load()).canEdit).toBe(expected);
    }
  });

  test('canUndoReorder is true while a reorder marker is stored', async () => {
    const { w, st } = setup();
    put(w, 'board', 'shared', KEY_REORDER, { gen: 'g', complete: true });
    expect((await st.load()).canUndoReorder).toBe(true);
  });

  test('returns a copy: changing it does not change what the next load returns', async () => {
    const { st } = setup();
    const first = await st.load();
    first.cards.length = 0;
    first.parameters[0]!.levels.push('x');
    const second = await st.load();
    expect(second.cards).toHaveLength(4);
    expect(second.parameters[0]!.levels).toEqual(['Low', 'Medium', 'High']);
  });

  test('a load whose read began before an own write finished reads again and shows the write', async () => {
    const { w, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    const reads = w.cardsCalls;
    const pending: ((v: unknown) => void)[] = [];
    w.cardsImpl = () => new Promise(resolve => { pending.push(resolve); });
    const loading = st.load();
    await settle();
    expect(pending).toHaveLength(1);
    await st.setLevel('c2', param, 2);
    pending[0]!(structuredClone(w.cards));                 // the answer that lacks the write
    await settle();
    expect(pending).toHaveLength(2);
    pending[1]!(structuredClone(w.cards));
    expect(cardIn(await loading, 'c2').fieldOptions).toEqual({ f1: 'oHigh' });
    expect(w.cardsCalls).toBe(reads + 2);
  });

  test('a load gives up re-reading after three reads when writes keep coming, and returns the last', async () => {
    const { w, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    const reads = w.cardsCalls;
    const pending: ((v: unknown) => void)[] = [];
    w.cardsImpl = () => new Promise(resolve => { pending.push(resolve); });
    const loading = st.load();
    for (let i = 0; i < 3; i++) {
      await settle();
      expect(pending).toHaveLength(i + 1);
      await st.setLevel('c2', param, i % 3);
      pending[i]!(structuredClone(w.cards));
    }
    const snap = await loading;
    expect(snap.cards).toHaveLength(4);
    expect(cardIn(snap, 'c2').fieldOptions).toEqual({ f1: 'oHigh' });   // the third write, laid over the third read
    expect(w.cardsCalls).toBe(reads + 3);
  });

  test('a card whose stored data cannot be read is loaded with no placement; the others still load', async () => {
    const { w, st } = setup();
    put(w, 'c2', 'shared', KEY_CARD, { p: { f1: 0.3 } });
    w.failGet = (scope, _vis, key) => (scope === 'c1' && key === KEY_CARD ? new Error('boom') : null);
    const s = await st.load();
    expect(s.cards).toHaveLength(4);
    expect(s.placements).toEqual({ c2: { positions: { f1: 0.3 } } });
  });

  test('a failed read of the card list, a list, the board, the parameters or the marker rejects with a network error', async () => {
    {
      const { w, st } = setup();
      w.cardsImpl = () => Promise.reject(new Error('boom'));
      expect(await error(st.load())).toMatchObject({ kind: 'network' });
    }
    for (const failing of [KEY_PARAMS, KEY_REORDER]) {
      const { w, st } = setup();
      w.failGet = (_s, _v, key) => (key === failing ? new Error('boom') : null);
      expect(await error(st.load())).toMatchObject({ kind: 'network' });
    }
    {
      const { t, st } = setup();
      t.lists = () => Promise.reject(new Error('boom'));
      expect(await error(st.load())).toMatchObject({ kind: 'network' });
    }
    {
      const { t, st } = setup();
      t.board = () => Promise.reject(new Error('boom'));
      expect(await error(st.load())).toMatchObject({ kind: 'network' });
    }
  });
});

describe('own writes shown while Trello catches up', () => {
  test('setLevel is shown by load while t.cards still shows the old value, and after it catches up; another value wins', async () => {
    const { w, rest, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    await st.setLevel('c2', param, 2);
    expect(rest.calls).toEqual([{ method: 'setFieldOption', args: ['c2', 'f1', 'oHigh'] }]);
    expect(raw(w, 'c2').customFieldItems).toEqual([]);                       // Trello's data has not caught up

    expect(cardIn(await st.load(), 'c2').fieldOptions).toEqual({ f1: 'oHigh' });

    raw(w, 'c2').customFieldItems = [{ idCustomField: 'f1', idValue: 'oHigh' }];   // caught up
    expect(cardIn(await st.load(), 'c2').fieldOptions).toEqual({ f1: 'oHigh' });

    raw(w, 'c2').customFieldItems = [{ idCustomField: 'f1', idValue: 'oLow' }];    // the other person's change
    expect(cardIn(await st.load(), 'c2').fieldOptions).toEqual({ f1: 'oLow' });
  });

  test('a third value shown before the data caught up is shown, not ours', async () => {
    const { w, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    await st.setLevel('c2', param, 2);
    raw(w, 'c2').customFieldItems = [{ idCustomField: 'f1', idValue: 'oLow' }];
    expect(cardIn(await st.load(), 'c2').fieldOptions).toEqual({ f1: 'oLow' });
  });

  test('a position set by a reorder is shown while t.cards still shows the old one', async () => {
    const { w, rest, st } = setup();
    rest.applyPos = false;
    await st.reorderLists([{ listId: 'l1', cardIds: ['c3', 'c1', 'c2'] }], () => {});
    expect(raw(w, 'c3').pos).toBe(300);
    const s = await st.load();
    expect(s.cards.filter(c => c.idList === 'l1').map(c => [c.id, c.pos])).toEqual([['c1', 32768], ['c2', 49152], ['c3', 16384]]);
  });

  test('a second setLevel on the same card is based on the first, even before Trello caught up', async () => {
    const { w, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    await st.setLevel('c2', param, 2);
    await st.setLevel('c2', param, 0);
    expect(cardIn(await st.load(), 'c2').fieldOptions).toEqual({ f1: 'oLow' });
    raw(w, 'c2').customFieldItems = [{ idCustomField: 'f1', idValue: 'oLow' }];
    expect(cardIn(await st.load(), 'c2').fieldOptions).toEqual({ f1: 'oLow' });
  });
});

// ---------------------------------------------------------------- writing cards

describe('savePositions', () => {
  test('merges into the stored value, rounds and clamps, forgets null keys, and keeps prev and gen', async () => {
    const { w, st } = setup();
    put(w, 'c1', 'shared', KEY_CARD, { p: { f1: 0.9, f2: 0.2 }, prev: 5000, gen: 'g1' });
    await st.load();
    await st.savePositions('c1', { f1: 0.4567, f2: null, f9: 1.5 });
    expect(w.ops).toEqual([{ op: 'set', scope: 'c1', vis: 'shared', key: KEY_CARD, value: { p: { f1: 0.457, f9: 0.999 }, prev: 5000, gen: 'g1' } }]);
    expect(cardValue(w, 'c1')).toEqual({ p: { f1: 0.457, f9: 0.999 }, prev: 5000, gen: 'g1' });
  });

  test('reads the stored value fresh each time, so another person\'s keys are kept', async () => {
    const { w, st } = setup();
    await st.load();
    put(w, 'c1', 'shared', KEY_CARD, { p: { f1: 0.9, fOther: 0.1 } });   // written by someone else after our read
    await st.savePositions('c1', { f1: 0.2 });
    expect(cardValue(w, 'c1')).toEqual({ p: { f1: 0.2, fOther: 0.1 } });
  });

  test('removes the whole stored value when nothing is left, but keeps a value that still has prev and gen', async () => {
    const { w, st } = setup();
    await st.load();
    await st.savePositions('c1', { f1: null });
    expect(w.ops).toEqual([{ op: 'remove', scope: 'c1', vis: 'shared', key: KEY_CARD }]);
    expect(cardValue(w, 'c1')).toBeUndefined();

    put(w, 'c2', 'shared', KEY_CARD, { p: { f1: 0.5 }, prev: 7, gen: 'g' });
    await st.savePositions('c2', { f1: null });
    expect(w.ops[1]).toEqual({ op: 'set', scope: 'c2', vis: 'shared', key: KEY_CARD, value: { prev: 7, gen: 'g' } });
  });

  test('a position that is not a number rejects as invalid and writes nothing', async () => {
    const { w, rest, st } = setup();
    await st.load();
    expect(await error(st.savePositions('c1', { f1: Number.NaN }))).toMatchObject({ kind: 'invalid' });
    expect(await error(st.savePositions('c1', { f1: Infinity }))).toMatchObject({ kind: 'invalid' });
    noWrites(w, rest);
  });

  test('two saves for one card at the same time both land', async () => {
    const { w, st } = setup();
    await st.load();
    await Promise.all([st.savePositions('c2', { f1: 0.1 }), st.savePositions('c2', { f2: 0.2 })]);
    expect(cardValue(w, 'c2')).toEqual({ p: { f1: 0.1, f2: 0.2 } });
  });

  test('a save and a running reorder touching the same card at the same time both land on its stored value', async () => {
    const { w, st } = setup();
    await st.load();
    const reorder = st.reorderLists([{ listId: 'l1', cardIds: ['c3', 'c1', 'c2'] }], () => {});
    const save = st.savePositions('c1', { f2: 0.4 });
    await Promise.all([reorder, save]);
    expect(cardValue(w, 'c1')).toEqual({ p: { f1: 0.9, f2: 0.4 }, prev: 100, gen: 'gen-1' });
    expect(marker(w)).toEqual({ gen: 'gen-1', complete: true });
  });

  test('a failed read of the stored value rejects with a network error and writes nothing', async () => {
    const { w, rest, st } = setup();
    await st.load();
    w.failGet = (scope, _v, key) => (scope === 'c1' && key === KEY_CARD ? new Error('boom') : null);
    expect(await error(st.savePositions('c1', { f1: 0.5 }))).toMatchObject({ kind: 'network' });
    noWrites(w, rest);
  });
});

describe('a card that is not on the board', () => {
  test('savePositions and setLevel reject as invalid and send or store nothing', async () => {
    const { w, rest, st } = setup();
    const s = await st.load();
    const param = paramNamed(s, 'f1');
    for (const id of ['nope', 'constructor', '__proto__', 'toString']) {
      expect(await error(st.savePositions(id, { f1: 0.5 }))).toMatchObject({ kind: 'invalid', message: 'That card is no longer on the board.' });
      expect(await error(st.setLevel(id, param, 1))).toMatchObject({ kind: 'invalid', message: 'That card is no longer on the board.' });
    }
    noWrites(w, rest);
  });

  test('a card that has gone since the latest read is refused too', async () => {
    const { w, rest, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    w.cards = w.cards.filter(c => c.id !== 'c2');
    await st.load();
    expect(await error(st.setLevel('c2', param, 1))).toMatchObject({ kind: 'invalid' });
    noWrites(w, rest);
  });
});

describe('setLevel', () => {
  test('maps the level to the option id, and null clears', async () => {
    const { rest, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    await st.setLevel('c1', param, 0);
    await st.setLevel('c1', param, 2);
    await st.setLevel('c1', param, null);
    expect(rest.calls).toEqual([
      { method: 'setFieldOption', args: ['c1', 'f1', 'oLow'] },
      { method: 'setFieldOption', args: ['c1', 'f1', 'oHigh'] },
      { method: 'setFieldOption', args: ['c1', 'f1', null] },
    ]);
  });

  test('an out-of-range or non-integer level rejects as invalid without a request', async () => {
    const { w, rest, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    for (const level of [3, -1, 1.5, Number.NaN, Infinity, '1' as unknown as number, undefined as unknown as number]) {
      expect(await error(st.setLevel('c1', param, level))).toMatchObject({ kind: 'invalid', message: 'That level does not exist.' });
    }
    noWrites(w, rest);
  });

  test('a parameter that is no longer on the board rejects as invalid without a request', async () => {
    const { w, rest, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    await st.removeParameter('f1');                                   // the other person (or an earlier step) removed it
    w.ops.length = 0;
    expect(await error(st.setLevel('c1', param, 0))).toMatchObject({ kind: 'invalid', message: 'That parameter is no longer on the board.' });
    expect(await error(st.setLevel('c1', param, null))).toMatchObject({ kind: 'invalid', message: 'That parameter is no longer on the board.' });
    const stranger: Parameter = { ...param, id: 'nope', fieldId: 'f-nope' };
    expect(await error(st.setLevel('c1', stranger, 0))).toMatchObject({ kind: 'invalid', message: 'That parameter is no longer on the board.' });
    noWrites(w, rest);
    expect(cardIn(await st.load(), 'c1').fieldOptions).toEqual({ f1: 'oMed' });
    await st.linkParameter('f1', 'last');                             // linked again: writes are accepted again
    await st.setLevel('c1', paramNamed(await st.load(), 'f1'), 2);
    expect(rest.calls).toHaveLength(1);
  });

  test('a failed request rejects with its error and leaves the shown value alone', async () => {
    const { rest, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    rest.failOn.set(1, new StoreError('rate-limit', 'slow down'));
    expect(await error(st.setLevel('c2', param, 2))).toMatchObject({ kind: 'rate-limit' });
    expect(cardIn(await st.load(), 'c2').fieldOptions).toEqual({});
  });
});

describe('storage failures', () => {
  test('a rejection mentioning 4096 becomes a limit error; any other becomes a network error', async () => {
    const { w, st } = setup();
    await st.load();
    w.failSet = () => new Error('Value exceeds 4096 characters');
    expect(await error(st.savePositions('c1', { f1: 0.5 }))).toMatchObject({ kind: 'limit', message: "Trello's 4,096-character limit for stored data was reached." });
    w.failSet = () => new Error('Request failed');
    expect(await error(st.savePositions('c1', { f1: 0.5 }))).toMatchObject({ kind: 'network', message: 'Could not save to Trello.' });
    expect(w.ops).toEqual([]);
    expect(cardValue(w, 'c1')).toEqual({ p: { f1: 0.9 } });
  });

  test('a rejection of a remove maps the same way', async () => {
    const { w, st } = setup();
    await st.load();
    w.failSet = () => new Error('Request failed');
    expect(await error(st.savePositions('c1', { f1: null }))).toMatchObject({ kind: 'network', message: 'Could not save to Trello.' });
    expect(w.log).toEqual([]);
    expect(w.ops).toEqual([]);
    expect(cardValue(w, 'c1')).toEqual({ p: { f1: 0.9 } });
  });

  test('a value that would be too long is refused before it is sent', async () => {
    const { w, st } = setup();
    await st.load();
    const many = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`field-number-${i}`, 0.5]));
    expect(await error(st.savePositions('c1', many))).toMatchObject({ kind: 'limit' });
    expect(w.ops).toEqual([]);
  });
});

// ---------------------------------------------------------------- parameters

describe('createParameter', () => {
  const input = (over: object = {}) => ({ name: ' Risk ', levels: ['Hard', ' Medium ', 'Easy'], bestEnd: 'last' as const, ...over });

  test('sends the option texts as typed and stores the option ids worst to best', async () => {
    const { w, rest, st } = setup();
    const p = await st.createParameter(input());
    expect(rest.calls).toEqual([{ method: 'createDropdownField', args: ['b1', 'Risk', ['Hard', 'Medium', 'Easy']] }]);
    expect(storedParams(w)).toEqual([{ f: 'f1', o: ['oLow', 'oMed', 'oHigh'] }, { f: 'fNew1', o: ['fNew1o0', 'fNew1o1', 'fNew1o2'] }]);
    expect(p).toEqual({ id: 'fNew1', name: 'Risk', fieldId: 'fNew1', levels: ['Hard', 'Medium', 'Easy'], optionIds: ['fNew1o0', 'fNew1o1', 'fNew1o2'] });
    expect(w.ops).toHaveLength(1);
  });

  test('with the best end first, the levels and the stored option ids are reversed but the field is made in typed order', async () => {
    const { w, rest, st } = setup();
    const p = await st.createParameter(input({ bestEnd: 'first' }));
    expect(rest.calls[0]!.args).toEqual(['b1', 'Risk', ['Hard', 'Medium', 'Easy']]);
    expect(storedParams(w)).toEqual([{ f: 'f1', o: ['oLow', 'oMed', 'oHigh'] }, { f: 'fNew1', o: ['fNew1o2', 'fNew1o1', 'fNew1o0'] }]);
    expect(p.levels).toEqual(['Easy', 'Medium', 'Hard']);
    expect(p.optionIds).toEqual(['fNew1o2', 'fNew1o1', 'fNew1o0']);
  });

  test('refuses one level, four levels, a blank name, and a name a parameter or a dropdown field has, sending and storing nothing', async () => {
    const { w, rest, st } = setup();
    await st.load();
    for (const bad of [
      input({ levels: ['a'] }), input({ levels: ['a', 'b', 'c', 'd'] }), input({ name: '  ' }),
      input({ name: 'value' }), input({ name: ' EASE ' }), input({ levels: ['a', 'A'] }), input({ levels: ['a', ' '] }),
    ]) {
      expect(await error(st.createParameter(bad))).toMatchObject({ kind: 'invalid' });
    }
    noWrites(w, rest);
  });

  test('the new parameter is in the next load although t.board does not list the field yet', async () => {
    const { w, st } = setup();
    await st.load();
    await st.createParameter(input());
    expect(w.board.customFields).toHaveLength(4);
    const s = await st.load();
    expect(s.parameters.map(p => p.id)).toEqual(['f1', 'fNew1']);
    expect(paramNamed(s, 'fNew1').levels).toEqual(['Hard', 'Medium', 'Easy']);
    expect(s.dropdownFields.map(f => f.id)).toContain('fNew1');
  });

  test('if storing the list fails after the field was created, the message says so, the request went once, and the field can be linked', async () => {
    const { w, rest, st } = setup();
    await st.load();
    w.failSet = (_s, _v, key) => (key === KEY_PARAMS ? new Error('Request failed') : null);
    const e = await error(st.createParameter(input()));
    expect(e).toMatchObject({ kind: 'network', message: 'The field was created in Trello but could not be added to the matrix. Link it from the dialog.' });
    expect(rest.calls.filter(c => c.method === 'createDropdownField')).toHaveLength(1);
    expect(storedParams(w)).toEqual([{ f: 'f1', o: ['oLow', 'oMed', 'oHigh'] }]);

    const s = await st.load();
    expect(s.dropdownFields.map(f => f.id)).toContain('fNew1');
    expect(s.parameters.map(p => p.id)).toEqual(['f1']);
    w.failSet = () => null;
    const linked = await st.linkParameter('fNew1', 'last');
    expect(linked.levels).toEqual(['Hard', 'Medium', 'Easy']);
    expect(rest.calls.filter(c => c.method === 'createDropdownField')).toHaveLength(1);
  });

  test('a stored list that cannot be read stops the create before any request', async () => {
    const { w, rest, st } = setup();
    await st.load();
    w.failGet = (_s, _v, key) => (key === KEY_PARAMS ? new Error('boom') : null);
    expect(await error(st.createParameter(input()))).toMatchObject({ kind: 'network', message: 'Could not read from Trello.' });
    noWrites(w, rest);
  });

  test('a list that cannot be read, or has filled up, after the field was created gives the "created but not added" message', async () => {
    const added = { message: expect.stringContaining('created in Trello but could not be added') };
    {
      const { w, rest, st } = setup();
      await st.load();
      let reads = 0;
      w.failGet = (_s, _v, key) => (key === KEY_PARAMS && ++reads === 2 ? new Error('boom') : null);
      expect(await error(st.createParameter(input()))).toMatchObject(added);
      expect(rest.calls).toHaveLength(1);
      expect(w.ops).toEqual([]);
    }
    {
      const { w, rest, st } = setup();
      await st.load();
      rest.onCall = () => put(w, 'board', 'shared', KEY_PARAMS, Array.from({ length: 150 }, (_, i) => ({ f: `field-${i}`, o: ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc'] })));
      expect(await error(st.createParameter(input()))).toMatchObject(added);
      expect(rest.calls).toHaveLength(1);
      expect(w.ops).toEqual([]);
    }
  });

  test('a stored list too full for one more parameter is refused before the field is created', async () => {
    const { w, rest, st } = setup();
    await st.load();
    const list: { f: string; o: string[] }[] = [];
    while (JSON.stringify(list).length <= 3996) list.push({ f: `field-${list.length}`, o: ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'] });
    expect(JSON.stringify(list).length).toBeLessThanOrEqual(4096);      // the list itself still fits
    put(w, 'board', 'shared', KEY_PARAMS, list);
    expect(await error(st.createParameter(input()))).toMatchObject({ kind: 'limit', message: "Trello's 4,096-character limit for stored data was reached." });
    noWrites(w, rest);
  });

  test('a request Trello refused rejects with its error and stores nothing', async () => {
    const { w, rest, st } = setup();
    rest.failOn.set(1, new StoreError('invalid', 'A field with that name already exists on the board.'));
    expect(await error(st.createParameter(input()))).toMatchObject({ kind: 'invalid' });
    expect(w.ops).toEqual([]);
    expect((await st.load()).dropdownFields).toHaveLength(4);
  });

  test('when Trello will not create the field, the message says how to link one instead; nothing is stored', async () => {
    const { w, rest, st } = setup();
    rest.failOn.set(1, new StoreError('permission', 'Trello does not allow this with the current sign-in.'));
    expect(await error(st.createParameter(input()))).toMatchObject({
      kind: 'permission',
      message: "Trello would not create the field. Create a dropdown field with that name in Trello's Custom Fields editor, then add it here to link it.",
    });
    expect(w.ops).toEqual([]);
    expect((await st.load()).dropdownFields).toHaveLength(4);
  });
  test('other refusals of the create pass through unchanged', async () => {
    for (const refusal of [new StoreError('auth', 'Trello sign-in has expired. Connect again.'), new StoreError('network', 'Trello did not answer in time.')]) {
      const { rest, st } = setup();
      rest.failOn.set(1, refusal);
      expect(await error(st.createParameter(input()))).toBe(refusal);
    }
  });

  test('two creates of the same name at once send one request; the other is refused', async () => {
    const { rest, st } = setup();
    await st.load();
    const results = await Promise.allSettled([st.createParameter(input()), st.createParameter(input())]);
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ kind: 'invalid' });
    expect(rest.calls.filter(c => c.method === 'createDropdownField')).toHaveLength(1);
  });
});

describe('linkParameter', () => {
  test('stores an existing field of 2 or 3 options, worst to best, and returns it', async () => {
    const { w, rest, st } = setup();
    await st.load();
    const ease = await st.linkParameter('f2', 'first');
    expect(ease).toEqual({ id: 'f2', name: 'Ease', fieldId: 'f2', levels: ['Easy', 'Hard'], optionIds: ['e1', 'e0'] });
    const reach = await st.linkParameter('f4', 'last');
    expect(reach.levels).toEqual(['Few', 'Some', 'Many']);
    expect(storedParams(w)).toEqual([
      { f: 'f1', o: ['oLow', 'oMed', 'oHigh'] }, { f: 'f2', o: ['e1', 'e0'] }, { f: 'f4', o: ['r0', 'r1', 'r2'] },
    ]);
    expect(rest.calls).toEqual([]);
    expect((await st.load()).parameters.map(p => p.id)).toEqual(['f1', 'f2', 'f4']);
  });

  test('refuses a field that is a parameter, has 4 options, or does not exist, storing nothing', async () => {
    const { w, rest, st } = setup();
    await st.load();
    expect(await error(st.linkParameter('f1', 'last'))).toMatchObject({ kind: 'invalid', message: 'Value is already a parameter' });
    expect(await error(st.linkParameter('f3', 'last'))).toMatchObject({ kind: 'invalid', message: 'A parameter has 2 or 3 levels' });
    expect(await error(st.linkParameter('nope', 'last'))).toMatchObject({ kind: 'invalid', message: 'No dropdown field nope' });
    noWrites(w, rest);
    await st.linkParameter('f2', 'last');
    expect(await error(st.linkParameter('f2', 'last'))).toMatchObject({ kind: 'invalid', message: 'Ease is already a parameter' });
    expect(w.ops).toHaveLength(1);
  });

  test('a storage failure rejects with the storage error kinds', async () => {
    const { w, st } = setup();
    await st.load();
    w.failSet = () => new Error('Request failed');
    expect(await error(st.linkParameter('f2', 'last'))).toMatchObject({ kind: 'network', message: 'Could not save to Trello.' });
    expect(w.log).toEqual([]);
    expect(w.ops).toEqual([]);
    expect(storedParams(w)).toEqual([{ f: 'f1', o: ['oLow', 'oMed', 'oHigh'] }]);
    expect((await st.load()).parameters.map(p => p.id)).toEqual(['f1']);
  });
});

describe('renames', () => {
  test('renameParameter and renameLevel reject as permission errors with no request and no stored change', async () => {
    const { w, rest, st } = setup();
    await st.load();
    const message = "Trello does not let the matrix rename fields. Rename it in Trello's Custom Fields editor.";
    expect(await error(st.renameParameter('f1', 'Worth'))).toMatchObject({ kind: 'permission', message });
    expect(await error(st.renameLevel('f1', 0, 'Poor'))).toMatchObject({ kind: 'permission', message });
    noWrites(w, rest);
  });
});

describe('removeParameter', () => {
  test('stores the list without it, sends no request and leaves card data alone', async () => {
    const { w, rest, st } = setup();
    await st.linkParameter('f2', 'last');
    put(w, 'c2', 'shared', KEY_CARD, { p: { f1: 0.3, f2: 0.6 }, prev: 4, gen: 'g' });
    const cardsBefore = [...w.data].filter(([k]) => k.includes(`|${KEY_CARD}`));
    w.ops.length = 0;
    await st.removeParameter('f1');
    expect(w.ops).toEqual([{ op: 'set', scope: 'board', vis: 'shared', key: KEY_PARAMS, value: [{ f: 'f2', o: ['e0', 'e1'] }] }]);
    expect(rest.calls).toEqual([]);
    expect([...w.data].filter(([k]) => k.includes(`|${KEY_CARD}`))).toEqual(cardsBefore);
    expect((await st.load()).parameters.map(p => p.id)).toEqual(['f2']);
  });

  test('removing the last parameter stores an empty list; an unknown id is refused', async () => {
    const { w, rest, st } = setup();
    await st.load();
    expect(await error(st.removeParameter('nope'))).toMatchObject({ kind: 'invalid', message: 'No parameter nope' });
    noWrites(w, rest);
    await st.removeParameter('f1');
    expect(storedParams(w)).toEqual([]);
    expect(await error(st.removeParameter('f1'))).toMatchObject({ kind: 'invalid' });
  });
});

// ---------------------------------------------------------------- reordering

describe('reorderLists', () => {
  const l1 = (...ids: string[]) => [{ listId: 'l1', cardIds: ids }];

  test('stores each previous position once with the reorder id, sets positions in order, reports progress, and completes the marker', async () => {
    const { w, rest, st } = setup();
    await st.load();
    w.log.length = 0;
    w.ops.length = 0;
    const progress: Progress[] = [];
    await st.reorderLists(
      [{ listId: 'l1', cardIds: ['c3', 'c1', 'c4', 'c2'] }, { listId: 'l2', cardIds: ['c4'] }],
      p => progress.push(p),
    );   // c4 is not in l1: ignored there
    expect(w.newIds).toBe(1);
    expect(w.log).toEqual([
      'set board reorder',
      'set c3 mx', 'rest setCardPos c3 16384',
      'set c1 mx', 'rest setCardPos c1 32768',
      'set c2 mx', 'rest setCardPos c2 49152',
      'set c4 mx', 'rest setCardPos c4 16384',
      'set board reorder',
    ]);
    expect(w.ops[0]).toMatchObject({ key: KEY_REORDER, value: { gen: 'gen-1', complete: false } });
    expect(cardValue(w, 'c3')).toEqual({ prev: 300, gen: 'gen-1' });
    expect(cardValue(w, 'c1')).toEqual({ p: { f1: 0.9 }, prev: 100, gen: 'gen-1' });   // p kept
    expect(cardValue(w, 'c2')).toEqual({ prev: 200, gen: 'gen-1' });
    expect(cardValue(w, 'c4')).toEqual({ prev: 100, gen: 'gen-1' });
    expect(rest.calls.map(c => c.args)).toEqual([['c3', 16384], ['c1', 32768], ['c2', 49152], ['c4', 16384]]);
    expect(progress).toEqual([{ done: 1, total: 4 }, { done: 2, total: 4 }, { done: 3, total: 4 }, { done: 4, total: 4 }]);
    expect(marker(w)).toEqual({ gen: 'gen-1', complete: true });
    expect((await st.load()).canUndoReorder).toBe(true);
  });

  test('a card id that repeats is ordered once', async () => {
    const { rest, st } = setup();
    const progress: Progress[] = [];
    await st.reorderLists(l1('c2', 'c2', 'c1'), p => progress.push(p));
    expect(rest.calls.map(c => c.args)).toEqual([['c2', 16384], ['c1', 32768]]);
    expect(progress.at(-1)).toEqual({ done: 2, total: 2 });
  });

  test('an unknown list is refused before anything is written', async () => {
    const { w, rest, st } = setup();
    await st.load();
    expect(await error(st.reorderLists([...l1('c1'), { listId: 'gone', cardIds: ['c2'] }], () => {})))
      .toMatchObject({ kind: 'invalid', message: 'That list is no longer on the board.' });
    expect(await error(st.reorderLists([{ listId: 'constructor', cardIds: [] }], () => {}))).toMatchObject({ kind: 'invalid' });
    noWrites(w, rest);
    expect(w.newIds).toBe(0);
  });

  test('with no cards to order nothing is written and no progress is reported', async () => {
    const { w, rest, st } = setup();
    const progress: Progress[] = [];
    await st.reorderLists(l1('nope', 'c4'), p => progress.push(p));
    noWrites(w, rest);
    expect(progress).toEqual([]);
  });

  test('a card already at its target position is not sent but still counts in the progress', async () => {
    const { w, rest, st } = setup();
    raw(w, 'c1').pos = 16384;
    const progress: Progress[] = [];
    await st.reorderLists(l1('c1', 'c2'), p => progress.push(p));
    expect(rest.calls.map(c => c.args)).toEqual([['c2', 32768]]);
    expect(progress).toEqual([{ done: 1, total: 2 }, { done: 2, total: 2 }]);
    expect(cardValue(w, 'c1')).toEqual({ p: { f1: 0.9 }, prev: 16384, gen: 'gen-1' });
  });

  test('a failure part-way rejects, leaves the marker incomplete and undo available; running it again reuses the id, keeps the saved positions and finishes', async () => {
    const { w, rest, st } = setup();
    rest.failOn.set(2, new StoreError('network', 'Trello answered 500.'));    // the second card's request
    const first: Progress[] = [];
    expect(await error(st.reorderLists(l1('c3', 'c1', 'c2'), p => first.push(p)))).toMatchObject({ kind: 'network', message: 'Trello answered 500.' });
    expect(first).toEqual([{ done: 1, total: 3 }]);
    expect(marker(w)).toEqual({ gen: 'gen-1', complete: false });
    expect(cardValue(w, 'c3')).toEqual({ prev: 300, gen: 'gen-1' });
    expect(cardValue(w, 'c1')).toEqual({ p: { f1: 0.9 }, prev: 100, gen: 'gen-1' });   // stored before its request failed
    expect(cardValue(w, 'c2')).toBeUndefined();
    expect((await st.load()).canUndoReorder).toBe(true);
    expect(raw(w, 'c3').pos).toBe(16384);

    const second: Progress[] = [];
    await st.reorderLists(l1('c3', 'c1', 'c2'), p => second.push(p));
    expect(w.newIds).toBe(1);
    expect(marker(w)).toEqual({ gen: 'gen-1', complete: true });
    expect(cardValue(w, 'c3')).toEqual({ prev: 300, gen: 'gen-1' });                     // not overwritten with 16384
    expect(cardValue(w, 'c1')).toEqual({ p: { f1: 0.9 }, prev: 100, gen: 'gen-1' });
    expect(cardValue(w, 'c2')).toEqual({ prev: 200, gen: 'gen-1' });
    expect(second).toEqual([{ done: 1, total: 3 }, { done: 2, total: 3 }, { done: 3, total: 3 }]);
    const sent = rest.calls.map(c => c.args.join(':'));
    expect(sent).toEqual(['c3:16384', 'c1:32768', 'c1:32768', 'c2:49152']);             // c3 once; c1 again only because its request failed
  });

  test('a retry sends nothing again for a card done before the failure, even while t.cards still shows its old position', async () => {
    const { w, rest, st } = setup();
    rest.applyPos = false;
    rest.failOn.set(2, new StoreError('network', 'Trello answered 500.'));
    await error(st.reorderLists(l1('c3', 'c1', 'c2'), () => {}));
    await st.reorderLists(l1('c3', 'c1', 'c2'), () => {});
    expect(rest.calls.map(c => c.args.join(':'))).toEqual(['c3:16384', 'c1:32768', 'c1:32768', 'c2:49152']);
    expect(cardValue(w, 'c3')).toEqual({ prev: 300, gen: 'gen-1' });
  });

  test('a failure while storing a previous position stops the reorder and sends nothing for that card', async () => {
    const { w, rest, st } = setup();
    w.failSet = (scope, _v, key) => (scope === 'c1' && key === KEY_CARD ? new Error('Request failed') : null);
    expect(await error(st.reorderLists(l1('c3', 'c1', 'c2'), () => {}))).toMatchObject({ kind: 'network', message: 'Could not save to Trello.' });
    expect(rest.calls.map(c => c.args.join(':'))).toEqual(['c3:16384']);
    expect(marker(w)).toEqual({ gen: 'gen-1', complete: false });
  });

  test('with the stored data of a card being ordered unreadable it rejects and writes nothing; other cards do not matter', async () => {
    const { w, rest, st } = setup();
    put(w, 'c2', 'shared', KEY_CARD, { p: { f1: 0.3 } });
    await st.load();
    w.failGet = (scope, _v, key) => (scope === 'c2' && key === KEY_CARD ? new Error('boom') : null);
    const progress: Progress[] = [];
    expect(await error(st.reorderLists(l1('c3', 'c1', 'c2'), p => progress.push(p))))
      .toMatchObject({ kind: 'network', message: 'Some cards could not be read. Nothing was changed. Try again.' });
    noWrites(w, rest);
    expect(progress).toEqual([]);
    expect(w.newIds).toBe(0);
    expect(cardValue(w, 'c2')).toEqual({ p: { f1: 0.3 } });

    await st.reorderLists(l1('c3', 'c1'), () => {});          // c2 is not being ordered: it is not in the way
    expect(rest.calls.map(c => c.args)).toEqual([['c3', 16384], ['c1', 32768]]);
  });

  test('a new reorder after a completed one gets a new id and replaces the marker', async () => {
    const { w, st } = setup();
    await st.reorderLists(l1('c1', 'c2'), () => {});
    await st.reorderLists(l1('c2', 'c1'), () => {});
    expect(w.newIds).toBe(2);
    expect(marker(w)).toEqual({ gen: 'gen-2', complete: true });
    expect(cardValue(w, 'c2')).toEqual({ prev: 32768, gen: 'gen-2' });
  });

  test('a failure to store the marker stops before any card is touched', async () => {
    const { w, rest, st } = setup();
    w.failSet = (_s, _v, key) => (key === KEY_REORDER ? new Error('Request failed') : null);
    expect(await error(st.reorderLists(l1('c1'), () => {}))).toMatchObject({ kind: 'network' });
    expect(rest.calls).toEqual([]);
    expect(w.ops).toEqual([]);
  });
});

describe('undoReorder', () => {
  test('restores only the cards of the current reorder, clears their prev and gen but keeps p, removes the marker and reports progress', async () => {
    const { w, rest, st } = setup();
    put(w, 'c4', 'shared', KEY_CARD, { prev: 7, gen: 'old' });                 // left by an older reorder
    await st.reorderLists([{ listId: 'l1', cardIds: ['c3', 'c1', 'c2'] }], () => {});
    rest.calls.length = 0;
    w.ops.length = 0;
    const progress: Progress[] = [];
    await st.undoReorder(p => progress.push(p));
    expect(rest.calls.map(c => c.args)).toEqual([['c1', 100], ['c2', 200], ['c3', 300]]);
    expect(progress).toEqual([{ done: 1, total: 3 }, { done: 2, total: 3 }, { done: 3, total: 3 }]);
    expect(cardValue(w, 'c1')).toEqual({ p: { f1: 0.9 } });
    expect(cardValue(w, 'c2')).toBeUndefined();
    expect(cardValue(w, 'c3')).toBeUndefined();
    expect(cardValue(w, 'c4')).toEqual({ prev: 7, gen: 'old' });
    expect(marker(w)).toBeUndefined();
    expect(w.ops.at(-1)).toEqual({ op: 'remove', scope: 'board', vis: 'shared', key: KEY_REORDER });
    expect(['c1', 'c2', 'c3'].map(id => raw(w, id).pos)).toEqual([100, 200, 300]);
    expect((await st.load()).canUndoReorder).toBe(false);
  });

  test('works after a reorder that stopped part-way, and skips a card that is already back at its position', async () => {
    const { w, rest, st } = setup();
    rest.failOn.set(2, new StoreError('network', 'Trello answered 500.'));
    await error(st.reorderLists([{ listId: 'l1', cardIds: ['c3', 'c1', 'c2'] }], () => {}));
    rest.calls.length = 0;
    const progress: Progress[] = [];
    await st.undoReorder(p => progress.push(p));
    // c3 moved, c1 did not move (its request failed) so it is already at 100, c2 was never reached and has no value stored.
    expect(rest.calls.map(c => c.args)).toEqual([['c3', 300]]);
    expect(progress).toEqual([{ done: 1, total: 2 }, { done: 2, total: 2 }]);
    expect(marker(w)).toBeUndefined();
    expect(cardValue(w, 'c1')).toEqual({ p: { f1: 0.9 } });
  });

  test('with a reordered card\'s stored data unreadable it rejects before moving anything, keeps the marker, and a later undo restores every card', async () => {
    const { w, rest, st } = setup();
    await st.reorderLists([{ listId: 'l1', cardIds: ['c3', 'c1', 'c2'] }], () => {});
    rest.calls.length = 0;
    w.ops.length = 0;
    w.failGet = (scope, _v, key) => (scope === 'c2' && key === KEY_CARD ? new Error('boom') : null);
    const progress: Progress[] = [];
    expect(await error(st.undoReorder(p => progress.push(p))))
      .toMatchObject({ kind: 'network', message: 'Some cards could not be read. Nothing was changed. Try again.' });
    expect(rest.calls).toEqual([]);
    expect(w.ops).toEqual([]);
    expect(progress).toEqual([]);
    expect(marker(w)).toEqual({ gen: 'gen-1', complete: true });
    expect(cardValue(w, 'c3')).toEqual({ prev: 300, gen: 'gen-1' });

    w.failGet = () => null;
    await st.undoReorder(() => {});
    expect(['c1', 'c2', 'c3'].map(id => raw(w, id).pos)).toEqual([100, 200, 300]);
    expect(marker(w)).toBeUndefined();
  });

  test('the marker is removed only if it is still the one this undo started with', async () => {
    const { w, rest, st } = setup();
    await st.reorderLists([{ listId: 'l1', cardIds: ['c3', 'c1', 'c2'] }], () => {});
    rest.calls.length = 0;
    rest.onCall = n => { if (n === 1) put(w, 'board', 'shared', KEY_REORDER, { gen: 'newer', complete: false }); };   // the other person starts a reorder
    await st.undoReorder(() => {});
    expect(marker(w)).toEqual({ gen: 'newer', complete: false });
    expect(w.ops.filter(op => op.op === 'remove' && op.key === KEY_REORDER)).toEqual([]);
    expect(['c1', 'c2', 'c3'].map(id => raw(w, id).pos)).toEqual([100, 200, 300]);
  });

  test('a card whose stored value another reorder replaced meanwhile keeps that value', async () => {
    const { w, rest, st } = setup();
    await st.reorderLists([{ listId: 'l1', cardIds: ['c3', 'c1', 'c2'] }], () => {});
    rest.calls.length = 0;
    rest.onCall = n => { if (n === 1) put(w, 'c3', 'shared', KEY_CARD, { prev: 1, gen: 'other' }); };
    await st.undoReorder(() => {});
    expect(cardValue(w, 'c3')).toEqual({ prev: 1, gen: 'other' });
    expect(cardValue(w, 'c2')).toBeUndefined();
  });

  test('with no marker it rejects as invalid and does nothing', async () => {
    const { w, rest, st } = setup();
    expect(await error(st.undoReorder(() => {}))).toMatchObject({ kind: 'invalid', message: 'There is no reorder to undo.' });
    noWrites(w, rest);
  });

  test('a failure part-way leaves the marker and the unrestored cards\' data so it can be run again', async () => {
    const { w, rest, st } = setup();
    await st.reorderLists([{ listId: 'l1', cardIds: ['c3', 'c1', 'c2'] }], () => {});
    rest.calls.length = 0;
    rest.failOn.set(2, new StoreError('network', 'Trello answered 500.'));
    await error(st.undoReorder(() => {}));
    expect(marker(w)).toEqual({ gen: 'gen-1', complete: true });
    expect(cardValue(w, 'c1')).toEqual({ p: { f1: 0.9 } });
    expect(cardValue(w, 'c2')).toEqual({ prev: 200, gen: 'gen-1' });
    await st.undoReorder(() => {});
    expect(['c1', 'c2', 'c3'].map(id => raw(w, id).pos)).toEqual([100, 200, 300]);
    expect(marker(w)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- subscribing

describe('subscribe', () => {
  test('subscribing by itself causes one read and one delivery after 200 ms', async () => {
    const { w, st } = setup();
    const got: BoardSnapshot[] = [];
    st.subscribe(s => got.push(s));
    await vi.advanceTimersByTimeAsync(199);
    await settle();
    expect(w.cardsCalls).toBe(0);
    expect(got).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(w.cardsCalls).toBe(1);
    expect(got).toHaveLength(1);
    expect(got[0]!.cards.map(c => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    await vi.advanceTimersByTimeAsync(POLL_MS - 300);           // nothing more before the steady read
    await settle();
    expect(w.cardsCalls).toBe(1);
  });

  test('a render delivers one snapshot after 200 ms; three renders in the window share one read; the callback is registered once', async () => {
    const { w, st } = setup();
    const got: BoardSnapshot[] = [];
    const other: BoardSnapshot[] = [];
    st.subscribe(s => got.push(s));
    st.subscribe(s => other.push(s));
    expect(w.renderFns).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(got).toHaveLength(1);
    const reads = w.cardsCalls;

    raw(w, 'c2').name = 'Renamed';
    w.renderFns[0]!();
    await vi.advanceTimersByTimeAsync(50);
    w.renderFns[0]!();
    await vi.advanceTimersByTimeAsync(50);
    w.renderFns[0]!();
    await vi.advanceTimersByTimeAsync(99);
    await settle();
    expect(w.cardsCalls).toBe(reads);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(w.cardsCalls).toBe(reads + 1);
    expect(got).toHaveLength(2);
    expect(other).toHaveLength(2);
    expect(cardIn(got[1]!, 'c2').name).toBe('Renamed');
    await vi.advanceTimersByTimeAsync(POLL_MS - 1000);          // nothing more before the steady read
    await settle();
    expect(got).toHaveLength(2);
  });

  test('with no render notice, a change is still delivered by the steady read within POLL_MS and 200 ms', async () => {
    const { w, st } = setup();
    const got: BoardSnapshot[] = [];
    st.subscribe(s => got.push(s));
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(got).toHaveLength(1);
    raw(w, 'c2').name = 'Moved by someone else';            // Trello sends no render
    await vi.advanceTimersByTimeAsync(POLL_MS + 200);
    await settle();
    expect(got.length).toBeGreaterThanOrEqual(2);
    expect(cardIn(got.at(-1)!, 'c2').name).toBe('Moved by someone else');
  });

  test('the steady read reads once per POLL_MS, and not while the page cannot be seen', async () => {
    let visible = true;
    const { w, st } = setup({ isVisible: () => visible });
    st.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    const first = w.cardsCalls;
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    await settle();
    expect(w.cardsCalls).toBe(first + 3);
    visible = false;
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    await settle();
    expect(w.cardsCalls).toBe(first + 3);
    visible = true;
    await vi.advanceTimersByTimeAsync(POLL_MS + 200);
    await settle();
    expect(w.cardsCalls).toBe(first + 4);
  });

  test('a steady read waits for an own write, like any other, and is not delivered stale', async () => {
    const { w, rest, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    const got: BoardSnapshot[] = [];
    st.subscribe(s => got.push(s));
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    let open!: () => void;
    rest.gate = new Promise<void>(resolve => { open = resolve; });
    const write = st.setLevel('c2', param, 2);
    const reads = w.cardsCalls;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    await settle();
    expect(w.cardsCalls).toBe(reads);                       // held back while the write is under way
    open();
    await write;
    await settle();
    expect(cardIn(got.at(-1)!, 'c2').fieldOptions).toEqual({ f1: 'oHigh' });
  });

  test('after unsubscribing nothing is delivered and nothing is read; a render with no subscriber does nothing', async () => {
    const { w, st } = setup();
    const got: BoardSnapshot[] = [];
    const off = st.subscribe(s => got.push(s));
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    const reads = w.cardsCalls;
    off();
    off();                                                // twice is fine
    w.renderFns[0]!();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(w.cardsCalls).toBe(reads);
    expect(got).toHaveLength(1);
  });

  test('the last unsubscribe inside the window takes the pending timers away, and the steady read', async () => {
    const { w, st } = setup();
    const off = st.subscribe(() => {});
    expect(vi.getTimerCount()).toBe(2);                        // the first read and the steady read
    off();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(w.cardsCalls).toBe(0);
  });

  test('unsubscribing inside the window cancels the pending read; the other subscriber still gets it', async () => {
    const { w, st } = setup();
    const a: BoardSnapshot[] = [];
    const b: BoardSnapshot[] = [];
    const offA = st.subscribe(s => a.push(s));
    const offB = st.subscribe(s => b.push(s));
    offA();
    expect(vi.getTimerCount()).toBe(2);                    // the other subscriber still wants its read, and the steady read
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
    offB();
    w.renderFns[0]!();
    const reads = w.cardsCalls;
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(w.cardsCalls).toBe(reads);
  });

  test('a reload that began before an own write finished is not delivered; the snapshot delivered afterwards includes the write', async () => {
    const { w, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    const pending: ((v: unknown) => void)[] = [];
    w.cardsImpl = () => new Promise(resolve => { pending.push(resolve); });
    const got: BoardSnapshot[] = [];
    st.subscribe(s => got.push(s));
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(pending).toHaveLength(1);                       // the reload is waiting for t.cards

    await st.setLevel('c2', param, 2);                     // an own write finishes meanwhile
    pending[0]!(structuredClone(w.cards));                 // the old answer arrives, without the write
    await settle();
    expect(got).toHaveLength(0);                           // thrown away
    expect(pending).toHaveLength(2);                       // and read again

    pending[1]!(structuredClone(w.cards));                 // Trello's data has not caught up, the overlay covers it
    await settle();
    expect(got).toHaveLength(1);
    expect(cardIn(got[0]!, 'c2').fieldOptions).toEqual({ f1: 'oHigh' });
  });

  test('a reload whose read missed a setLevel still under way is not delivered; one snapshot shows the write once it ends', async () => {
    const { w, rest, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    const pending: ((v: unknown) => void)[] = [];
    w.cardsImpl = () => new Promise(resolve => { pending.push(resolve); });
    const got: BoardSnapshot[] = [];
    st.subscribe(s => got.push(s));
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(pending).toHaveLength(1);                       // the reload's read is waiting for t.cards

    let open!: () => void;
    rest.gate = new Promise<void>(resolve => { open = resolve; });
    const write = st.setLevel('c2', param, 2);             // starts after the read began, and is still not answered
    await settle();
    expect(rest.calls).toHaveLength(1);
    pending[0]!(structuredClone(w.cards));                 // the read finishes without the write
    await settle();
    expect(got).toHaveLength(0);

    open();
    await write;
    await settle();
    expect(got).toHaveLength(0);
    expect(pending).toHaveLength(2);                       // read again once the write ended
    pending[1]!(structuredClone(w.cards));
    await settle();
    expect(got).toHaveLength(1);
    expect(cardIn(got[0]!, 'c2').fieldOptions).toEqual({ f1: 'oHigh' });
  });

  test('a reload whose read missed a savePositions still under way is not delivered; one snapshot shows the write once it ends', async () => {
    const { w, st } = setup();
    await st.load();
    const pending: ((v: unknown) => void)[] = [];
    w.cardsImpl = () => new Promise(resolve => { pending.push(resolve); });
    const got: BoardSnapshot[] = [];
    st.subscribe(s => got.push(s));
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(pending).toHaveLength(1);

    let open!: () => void;
    w.setGate = new Promise<void>(resolve => { open = resolve; });
    const write = st.savePositions('c2', { f1: 0.3 });
    await settle();
    expect(w.ops).toEqual([]);                             // t.set has been called but has not taken effect
    pending[0]!(structuredClone(w.cards));
    await settle();
    expect(got).toHaveLength(0);

    open();
    await write;
    await settle();
    expect(got).toHaveLength(0);
    expect(pending).toHaveLength(2);
    pending[1]!(structuredClone(w.cards));
    await settle();
    expect(got).toHaveLength(1);
    expect(got[0]!.placements).toEqual({ c1: { positions: { f1: 0.9 } }, c2: { positions: { f1: 0.3 } } });
  });

  test('saving the view does not hold back or throw away a reload', async () => {
    const { w, st } = setup();
    const pending: ((v: unknown) => void)[] = [];
    w.cardsImpl = () => new Promise(resolve => { pending.push(resolve); });
    const got: BoardSnapshot[] = [];
    st.subscribe(s => got.push(s));
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(pending).toHaveLength(1);
    await st.saveView({ across: null, up: null, listIds: [], colourBy: { kind: 'label' }, showImages: true, zoom: 1, panX: 0, panY: 0 });
    expect(w.ops).toHaveLength(1);
    pending[0]!(structuredClone(w.cards));
    await settle();
    expect(got).toHaveLength(1);
    expect(pending).toHaveLength(1);                       // no second read
  });

  test('while a write is in progress a reload waits for it instead of reading', async () => {
    const { w, rest, st } = setup();
    const param = paramNamed(await st.load(), 'f1');
    const reads = w.cardsCalls;
    let open!: () => void;
    rest.gate = new Promise<void>(resolve => { open = resolve; });
    const write = st.setLevel('c2', param, 2);
    const got: BoardSnapshot[] = [];
    st.subscribe(s => got.push(s));
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(w.cardsCalls).toBe(reads);
    expect(got).toHaveLength(0);
    open();
    await write;
    await settle();
    expect(w.cardsCalls).toBe(reads + 1);
    expect(got).toHaveLength(1);
    expect(cardIn(got[0]!, 'c2').fieldOptions).toEqual({ f1: 'oHigh' });
  });

  test('a failed reload delivers nothing, leaves no unhandled rejection, and the next render delivers', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const { w, st } = setup();
      const got: BoardSnapshot[] = [];
      w.cardsImpl = () => Promise.reject(new Error('offline'));
      st.subscribe(s => got.push(s));
      await vi.advanceTimersByTimeAsync(200);
      await settle();
      expect(w.cardsCalls).toBe(1);
      expect(got).toHaveLength(0);

      w.cardsImpl = null;
      w.renderFns[0]!();
      await vi.advanceTimersByTimeAsync(200);
      await settle();
      expect(got).toHaveLength(1);
      await new Promise<void>(resolve => { vi.useRealTimers(); setImmediate(resolve); });
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('a render during a reload causes another reload afterwards, and deliveries stay in order', async () => {
    const { w, st } = setup();
    const pending: ((v: unknown) => void)[] = [];
    const answers: string[] = [];
    w.cardsImpl = () => new Promise(resolve => { pending.push(resolve); });
    const got: BoardSnapshot[] = [];
    st.subscribe(s => { got.push(s); answers.push(cardIn(s, 'c2').name); });
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(pending).toHaveLength(1);
    w.renderFns[0]!();
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(pending).toHaveLength(1);                       // not started yet: one reload at a time
    raw(w, 'c2').name = 'Second';
    pending[0]!(structuredClone(w.cards));
    await settle();
    expect(pending).toHaveLength(2);
    pending[1]!(structuredClone(w.cards));
    await settle();
    expect(answers).toEqual(['Second', 'Second']);
  });

  test('renders during a slow reload cause one more reload, not one each', async () => {
    const { w, st } = setup();
    const pending: ((v: unknown) => void)[] = [];
    w.cardsImpl = () => new Promise(resolve => { pending.push(resolve); });
    const got: BoardSnapshot[] = [];
    st.subscribe(s => got.push(s));
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    for (let i = 0; i < 3; i++) {                          // three separate windows while the first read is still waiting
      w.renderFns[0]!();
      await vi.advanceTimersByTimeAsync(200);
    }
    pending[0]!(structuredClone(w.cards));
    await settle();
    expect(pending).toHaveLength(2);
    pending[1]!(structuredClone(w.cards));
    await settle();
    expect(pending).toHaveLength(2);
    expect(got).toHaveLength(2);
  });

  test('a subscriber that throws does not stop the others or cause an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const { st } = setup();
      const got: BoardSnapshot[] = [];
      st.subscribe(() => { throw new Error('view bug'); });
      st.subscribe(s => got.push(s));
      await vi.advanceTimersByTimeAsync(200);
      await settle();
      expect(got).toHaveLength(1);
      await new Promise<void>(resolve => { vi.useRealTimers(); setImmediate(resolve); });
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

// ---------------------------------------------------------------- the rest

describe('coverImageUrl', () => {
  test('is the preview address from the latest read for a card with a cover, null otherwise', async () => {
    const { st } = setup();
    expect(await st.coverImageUrl('c1')).toBeNull();                       // nothing read yet
    await st.load();
    expect(await st.coverImageUrl('c1')).toBe('https://trello.com/p/600');
    expect(await st.coverImageUrl('c2')).toBeNull();
    for (const id of ['constructor', '__proto__', 'toString', 'nope']) expect(await st.coverImageUrl(id)).toBeNull();
  });

  test('follows the latest read: a cover that is gone is gone', async () => {
    const { w, st } = setup();
    await st.load();
    raw(w, 'c1').cover = null;
    await st.load();
    expect(await st.coverImageUrl('c1')).toBeNull();
  });
});

describe('the saved view', () => {
  const view: ViewSettings = { across: 'f1', up: null, listIds: ['l1'], colourBy: { kind: 'field', fieldId: 'f1' }, showImages: true, zoom: 1.5, panX: 10, panY: -20 };

  test('loadView is null when nothing is stored and for damaged data', async () => {
    const { w, st } = setup();
    expect(await st.loadView()).toBeNull();
    put(w, 'board', 'private', KEY_VIEW, { across: 5 });
    expect(await st.loadView()).toBeNull();
    put(w, 'board', 'private', KEY_VIEW, 'text');
    expect(await st.loadView()).toBeNull();
  });

  test('saveView stores under board, private, and loadView reads it back', async () => {
    const { w, st } = setup();
    await st.saveView(view);
    expect(w.ops).toEqual([{ op: 'set', scope: 'board', vis: 'private', key: KEY_VIEW, value: view }]);
    expect(await st.loadView()).toEqual(view);
  });

  test('an over-long view rejects with a limit error and stores nothing', async () => {
    const { w, st } = setup();
    const huge = { ...view, listIds: Array.from({ length: 500 }, (_, i) => `list-number-${i}`) };
    expect(await error(st.saveView(huge))).toMatchObject({ kind: 'limit' });
    expect(w.ops).toEqual([]);
  });

  test('storage failures map as for card data, and a failed read of the view rejects', async () => {
    const { w, st } = setup();
    w.failSet = () => new Error('Value exceeds 4096');
    expect(await error(st.saveView(view))).toMatchObject({ kind: 'limit' });
    w.failSet = () => new Error('Request failed');
    expect(await error(st.saveView(view))).toMatchObject({ kind: 'network', message: 'Could not save to Trello.' });
    w.failGet = () => new Error('boom');
    expect(await error(st.loadView())).toMatchObject({ kind: 'network' });
  });
});

describe('connecting and opening cards', () => {
  test('isConnected asks the auth object', async () => {
    const { auth, st } = setup();
    expect(await st.isConnected()).toBe(true);
    auth.ctl.authorized = false;
    expect(await st.isConnected()).toBe(false);
    expect(auth.calls).toEqual(['isAuthorized', 'isAuthorized']);
  });

  test('connect calls authorize at once, before anything is awaited', async () => {
    const { auth, st } = setup();
    const done = st.connect();
    expect(auth.calls).toEqual(['authorize']);              // checked synchronously, before the promise settles
    await done;
    expect(auth.calls).toEqual(['authorize']);
  });

  test('a refusal becomes an auth error that does not repeat the library\'s words', async () => {
    const { auth, st } = setup();
    auth.ctl.refuse = true;
    const e = await error(st.connect());
    expect(e).toMatchObject({ kind: 'auth', message: 'Trello access was not given.' });
    expect(e.message).not.toContain('secret');
    expect(auth.calls).toEqual(['authorize']);
  });

  test('openCard shows the card', async () => {
    const { w, st } = setup();
    await st.openCard('c3');
    expect(w.shown).toEqual(['c3']);
  });

  test('a card that cannot be opened rejects with a network error', async () => {
    const { t, st } = setup();
    t.showCard = () => Promise.reject(new Error('boom'));
    expect(await error(st.openCard('c3'))).toMatchObject({ kind: 'network' });
  });
});

// ---------------------------------------------------------------- calls that never answer

describe('timeouts', () => {
  const MESSAGE = 'Trello did not answer in time.';

  /** Starts `p`, lets `ms` pass, and reports whether it has settled by then. */
  async function settledAfter(p: Promise<unknown>, ms: number): Promise<boolean> {
    let done = false;
    void p.then(() => { done = true; }, () => { done = true; });
    await vi.advanceTimersByTimeAsync(ms);
    return done;
  }

  /** `p` (from `error`) must have given up once `ms` have passed; fails with a plain assertion when it is still waiting. */
  async function givesUpAfter(p: Promise<StoreError>, ms: number): Promise<StoreError> {
    expect(await settledAfter(p, ms), `still waiting after ${ms} ms`).toBe(true);
    return p;
  }

  test('a t.cards that never answers makes load reject after 20 seconds, and the next load works', async () => {
    const { w, st } = setup();
    w.cardsImpl = () => new Promise(() => {});
    const first = error(st.load());
    expect(await settledAfter(first, 19_999)).toBe(false);
    expect(await givesUpAfter(first, 1)).toMatchObject({ kind: 'network', message: MESSAGE });
    w.cardsImpl = null;
    expect((await st.load()).cards.map(c => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  test('a read queued behind one that never answers starts when that one times out, and has its own 20 seconds', async () => {
    const { w, st } = setup();
    w.cardsImpl = () => new Promise(() => {});
    const first = error(st.load());
    await vi.advanceTimersByTimeAsync(10_000);
    const second = error(st.load());                 // queued: the first read is still running
    expect(await givesUpAfter(first, 10_000)).toMatchObject({ message: MESSAGE });
    expect(w.cardsCalls).toBe(2);                    // the second began only now
    expect(await settledAfter(second, 19_999)).toBe(false);
    expect(await givesUpAfter(second, 1)).toMatchObject({ kind: 'network', message: MESSAGE });
  });

  test('a read that answers in time is not cut short, and leaves no timer behind', async () => {
    const { w, st } = setup();
    let answer!: (v: unknown) => void;
    w.cardsImpl = () => new Promise(resolve => { answer = resolve; });
    const loading = st.load();
    await vi.advanceTimersByTimeAsync(19_000);
    answer(structuredClone(w.cards));
    expect((await loading).cards).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a late answer from an abandoned read is not delivered, is not remembered and leaves no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const { w, st } = setup();
      await st.load();                               // the store now knows c1..c4
      const got: BoardSnapshot[] = [];
      st.subscribe(s => got.push(s));
      await vi.advanceTimersByTimeAsync(200);        // the subscription's own read
      await settle();
      expect(got).toHaveLength(1);

      let lateAnswer!: (v: unknown) => void;
      let lateFailure!: (e: unknown) => void;
      w.cardsImpl = () => new Promise((resolve, reject) => { lateAnswer = resolve; lateFailure = reject; });
      w.renderFns[0]!();
      await vi.advanceTimersByTimeAsync(200 + 20_000);
      await settle();
      expect(got).toHaveLength(1);

      w.cards.push(rawCard('cLate', 'l1', 400));
      lateAnswer(structuredClone(w.cards));          // the abandoned read answers at last
      await settle();
      expect(got).toHaveLength(1);                   // nothing delivered
      expect(await error(st.savePositions('cLate', { f1: 0.5 }))).toMatchObject({ kind: 'invalid' });   // and not remembered
      lateFailure(new Error('too late to matter'));  // a second settle of the same promise changes nothing
      await new Promise<void>(resolve => { vi.useRealTimers(); setImmediate(resolve); });
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('a read that fails after it timed out leaves no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const { w, st } = setup();
      let fail!: (e: unknown) => void;
      w.cardsImpl = () => new Promise((_, reject) => { fail = reject; });
      const loading = error(st.load());
      await givesUpAfter(loading, 20_000);
      fail(new Error('late failure'));
      await settle();
      await new Promise<void>(resolve => { vi.useRealTimers(); setImmediate(resolve); });
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('a t.set that never answers in savePositions rejects after 20 seconds, frees the lock and no longer holds reloads', async () => {
    const { w, st } = setup();
    await st.load();
    const got: BoardSnapshot[] = [];
    st.subscribe(s => got.push(s));
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    const delivered = got.length;
    w.hangSet = (scope, key) => scope === 'c2' && key === KEY_CARD;
    const first = error(st.savePositions('c2', { f1: 0.4 }));
    w.renderFns[0]!();                               // a reload is asked for while the write is under way
    await vi.advanceTimersByTimeAsync(10_000);
    expect(got).toHaveLength(delivered);             // held back: a write is under way
    expect(await settledAfter(first, 9_999)).toBe(false);
    expect(await givesUpAfter(first, 1)).toMatchObject({ kind: 'network', message: MESSAGE });

    w.hangSet = null;
    await settle();
    expect(got.length).toBeGreaterThan(delivered);   // the held reload went ahead once the write ended
    await st.savePositions('c2', { f1: 0.6 });       // the lock for c2 is free
    expect(cardValue(w, 'c2')).toEqual({ p: { f1: 0.6 } });
    w.renderFns[0]!();
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(cardIn(got.at(-1)!, 'c2')).toBeDefined();
  });

  test('the write-under-way count is released exactly once: a read after a timed-out write is delivered as current', async () => {
    const { w, st } = setup();
    await st.load();
    w.hangSet = (scope, key) => scope === 'c2' && key === KEY_CARD;
    const failed = error(st.savePositions('c2', { f1: 0.4 }));
    await givesUpAfter(failed, 20_000);
    w.hangSet = null;
    const got: BoardSnapshot[] = [];
    st.subscribe(s => got.push(s));
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(got).toHaveLength(1);                     // not held by a count that stayed above zero
    await st.savePositions('c3', { f1: 0.2 });       // and a following write is neither blocked nor miscounted
    w.renderFns[0]!();
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(got).toHaveLength(2);
  });

  test('a t.get that never answers when a write reads the stored value rejects after 20 seconds and frees the lock', async () => {
    const { w, st } = setup();
    await st.load();
    w.hangGet = (scope, key) => scope === 'c2' && key === KEY_CARD;
    const failed = error(st.savePositions('c2', { f1: 0.4 }));
    expect(await givesUpAfter(failed, 20_000)).toMatchObject({ kind: 'network', message: MESSAGE });
    expect(w.ops).toEqual([]);
    w.hangGet = null;
    await st.savePositions('c2', { f1: 0.7 });
    expect(cardValue(w, 'c2')).toEqual({ p: { f1: 0.7 } });
  });

  test('a t.set that never answers for the parameter list rejects after 20 seconds and frees the params lock', async () => {
    const { w, st } = setup();
    await st.load();
    w.hangSet = (scope, key) => scope === 'board' && key === KEY_PARAMS;
    const failed = error(st.linkParameter('f2', 'last'));
    expect(await givesUpAfter(failed, 20_000)).toMatchObject({ kind: 'network', message: MESSAGE });
    w.hangSet = null;
    expect((await st.linkParameter('f2', 'last')).fieldId).toBe('f2');
  });

  test('a t.set that never answers for the saved view rejects after 20 seconds', async () => {
    const { w, st } = setup();
    w.hangSet = (scope, key) => scope === 'board' && key === KEY_VIEW;
    const failed = error(st.saveView({ across: null, up: null, listIds: [], colourBy: { kind: 'label' }, showImages: true, zoom: 1, panX: 0, panY: 0 } as ViewSettings));
    expect(await givesUpAfter(failed, 20_000)).toMatchObject({ kind: 'network', message: MESSAGE });
  });

  test('a card step of a reorder that never answers stops it after 20 seconds with the marker incomplete, and running it again finishes', async () => {
    const { w, rest, st } = setup();
    await st.load();
    w.hangSet = (scope, key) => scope === 'c1' && key === KEY_CARD;       // the second card's stored value
    const progress: Progress[] = [];
    const running = error(st.reorderLists([{ listId: 'l1', cardIds: ['c3', 'c1', 'c2'] }], p => progress.push(p)));
    expect(await givesUpAfter(running, 20_000)).toMatchObject({ kind: 'network', message: MESSAGE });
    expect(progress).toEqual([{ done: 1, total: 3 }]);
    expect(marker(w)).toEqual({ gen: 'gen-1', complete: false });
    expect((await st.load()).canUndoReorder).toBe(true);

    w.hangSet = null;
    await st.reorderLists([{ listId: 'l1', cardIds: ['c3', 'c1', 'c2'] }], () => {});
    expect(w.newIds).toBe(1);                         // the retry resumed the same reorder
    expect(marker(w)).toEqual({ gen: 'gen-1', complete: true });
    expect(cardValue(w, 'c3')).toEqual({ prev: 300, gen: 'gen-1' });     // not overwritten
    expect(rest.calls.map(c => c.args.join(':'))).toEqual(['c3:16384', 'c1:32768', 'c2:49152']);
  });

  test('the marker write that never answers stops a reorder before any card is touched', async () => {
    const { w, rest, st } = setup();
    await st.load();
    w.hangSet = (scope, key) => scope === 'board' && key === KEY_REORDER;
    const running = error(st.reorderLists([{ listId: 'l1', cardIds: ['c3', 'c1'] }], () => {}));
    expect(await givesUpAfter(running, 20_000)).toMatchObject({ kind: 'network', message: MESSAGE });
    expect(rest.calls).toEqual([]);
    expect(w.ops).toEqual([]);
    w.hangSet = null;
    await st.reorderLists([{ listId: 'l1', cardIds: ['c3', 'c1'] }], () => {});       // the lock for reorders is free
    expect(marker(w)).toEqual({ gen: 'gen-2', complete: true });                      // no marker was stored before, so this is a new reorder
  });
});
