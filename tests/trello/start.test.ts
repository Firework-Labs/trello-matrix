import { describe, expect, test, vi } from 'vitest';
import { CLIENT_ID, REDIRECT_URI } from '../../src/config';
import type { BoardStore } from '../../src/store/board-store';
import { KEY_PARAMS } from '../../src/trello/plugin-data';
import { COULD_NOT_START, bootMatrix, startMatrix, type BootEnv, type StartDeps } from '../../src/trello/start';

const CARDS = 85;
const opt = (id: string, text: string, pos: number) => ({ id, value: { text }, color: 'none', pos });

/** A Power-Up library with one board of 85 cards, one dropdown field, and a signed-in person. */
function fakeIframe(arg: (name: string) => unknown = () => undefined): TrelloIframe {
  const data = new Map<string, unknown>([[`board|shared|${KEY_PARAMS}`, [{ f: 'f1', o: ['oLow', 'oMed', 'oHigh'] }]]]);
  const cards = Array.from({ length: CARDS }, (_, i) => ({
    id: `c${i}`, name: `Card ${i}`, idList: 'l1', pos: i + 1, labels: [], members: [], cover: null, customFieldItems: [],
  }));
  return {
    get: async (scope: string, vis: string, key: string, def?: unknown) => data.get(`${scope}|${vis}|${key}`) ?? def,
    set: async () => {}, remove: async () => {},
    cards: async () => structuredClone(cards),
    lists: async () => [{ id: 'l1', name: 'Backlog' }],
    board: async () => ({
      id: 'b1', labels: [], members: [],
      customFields: [{ id: 'f1', name: 'Value', type: 'list', options: [opt('oLow', 'Low', 1), opt('oMed', 'Medium', 2), opt('oHigh', 'High', 3)] }],
    }),
    getContext: () => ({ board: 'b1', member: 'm1', permissions: { board: 'write' } }),
    modal: async () => {}, closeModal: async () => {}, showCard: async () => {}, render: () => {},
    arg: (name: string) => arg(name),
    getOAuth2ApiClient: () => ({ getAccessToken: async () => 'TOKEN' }),
  } as unknown as TrelloIframe;
}

function setup(o: { arg?: (name: string) => unknown; fetchImpl?: typeof fetch } = {}) {
  const iframe = fakeIframe(o.arg);
  const iframeCalls: unknown[] = [];
  const mountCalls: { root: HTMLElement; store: BoardStore; options: Record<string, unknown> }[] = [];
  const handle = { destroy: vi.fn() };
  const requests: { url: string; init: RequestInit }[] = [];
  const timers: { fn: () => void; ms: number; handle: object }[] = [];
  const cleared: unknown[] = [];
  const slept: number[] = [];
  let clock = 0;
  const root = { id: 'root' } as unknown as HTMLElement;
  const deps: StartDeps = {
    powerUp: { iframe: options => { iframeCalls.push(options); return iframe; } },
    root,
    fetch: o.fetchImpl ?? (async (input: unknown, init?: RequestInit) => { requests.push({ url: String(input), init: init ?? {} }); return new Response('{}'); }) as typeof fetch,
    mount: (async (r: HTMLElement, store: BoardStore, options = {}) => { mountCalls.push({ root: r, store, options: { ...options } }); return handle; }) as StartDeps['mount'],
    now: () => clock,
    sleep: async ms => { slept.push(ms); clock += ms; },
    setTimeout: (fn, ms) => { const h = {}; timers.push({ fn, ms, handle: h }); return h; },
    clearTimeout: h => { cleared.push(h); },
  };
  return { deps, root, iframeCalls, mountCalls, handle, requests, timers, cleared, slept };
}

describe('startMatrix', () => {
  test('creates the iframe with the client id and the redirect address from the configuration', async () => {
    const s = setup();
    await startMatrix(s.deps);
    expect(s.iframeCalls).toEqual([{ clientId: CLIENT_ID, redirectUri: REDIRECT_URI }]);
  });

  test('mounts the matrix on the root with a store and both rename flags false', async () => {
    const s = setup();
    const result = await startMatrix(s.deps);
    expect(s.mountCalls).toHaveLength(1);
    const call = s.mountCalls[0]!;
    expect(call.root).toBe(s.root);
    for (const method of ['isConnected', 'connect', 'load', 'subscribe', 'savePositions', 'setLevel', 'createParameter', 'linkParameter',
      'renameParameter', 'renameLevel', 'removeParameter', 'openCard', 'coverImageUrl', 'loadView', 'saveView']) {
      expect(typeof (call.store as unknown as Record<string, unknown>)[method]).toBe('function');
    }
    expect(call.options.canRenameLevels).toBe(false);
    expect(call.options.canRenameParameters).toBe(false);
    expect(result).toBe(s.handle);
    result.destroy();
    expect(s.handle.destroy).toHaveBeenCalledTimes(1);
  });

  test('passes focusCardId when the page was opened with one', async () => {
    const asked: string[] = [];
    const s = setup({ arg: name => { asked.push(name); return name === 'focusCardId' ? 'card42' : undefined; } });
    await startMatrix(s.deps);
    expect(asked).toEqual(['focusCardId']);
    expect(s.mountCalls[0]!.options.focusCardId).toBe('card42');
  });

  test.each([[undefined], [null], [''], [42], [{ id: 'x' }], [true]])('leaves focusCardId out when t.arg gives %j', async value => {
    const s = setup({ arg: () => value });
    await startMatrix(s.deps);
    expect(s.mountCalls[0]!.options).not.toHaveProperty('focusCardId');
  });

  test('the pacer runs on the steady clock: 80 requests go at once, the 81st waits out the 10 s window', async () => {
    const s = setup();
    await startMatrix(s.deps);
    const store = s.mountCalls[0]!.store;
    const snap = await store.load();
    const param = snap.parameters[0]!;
    for (let i = 0; i < 80; i++) await store.setLevel(`c${i}`, param, 1);
    expect(s.requests).toHaveLength(80);
    expect(s.slept).toEqual([]);
    await store.setLevel('c80', param, 1);                  // the clock is still at 0, so this one must wait the whole window
    expect(s.slept).toEqual([10_000]);
    expect(s.requests).toHaveLength(81);
    expect(s.requests[0]!.url.startsWith('https://api.trello.com/1/cards/c0/customField/f1/item')).toBe(true);
    expect((s.requests[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
  });

  test('a request Trello never answers is given up on after 20 s, with the timers passed in', async () => {
    const s = setup({ fetchImpl: (() => new Promise<Response>(() => {})) as typeof fetch });
    await startMatrix(s.deps);
    const store = s.mountCalls[0]!.store;
    const param = (await store.load()).parameters[0]!;
    const done = store.setLevel('c0', param, 1).catch((e: unknown) => e as Error);
    // The store's own reads also run under a 20 s timer; those have finished and been cleared by now, so only the request's is live.
    const live = () => s.timers.filter(t => t.ms === 20_000 && !s.cleared.includes(t.handle));
    await vi.waitFor(() => expect(live()).toHaveLength(1));
    const request = live()[0]!;
    request.fn();
    expect(await done).toMatchObject({ kind: 'network', message: 'Trello did not answer in time.' });
    expect(s.cleared).toContain(request.handle);
  });

  test('fetch is called as a bare function, not as a method of another object', async () => {
    const receivers: unknown[] = [];
    const fetchImpl = function (this: unknown) { receivers.push(this); return Promise.resolve(new Response('{}')); } as unknown as typeof fetch;
    const s = setup({ fetchImpl });
    await startMatrix(s.deps);
    const store = s.mountCalls[0]!.store;
    await store.setLevel('c0', (await store.load()).parameters[0]!, 1);
    expect(receivers).toHaveLength(1);
    expect(receivers[0]).toBeUndefined();
  });

  test('start-up logs nothing, even when the start fails', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => undefined));
    try {
      await startMatrix(setup().deps);
      const failing = setup();
      failing.deps.mount = (async () => { throw new Error('secret'); }) as StartDeps['mount'];
      await startMatrix(failing.deps).catch(() => undefined);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('bootMatrix', () => {
  const SENTENCE = 'The matrix could not start. Close this window and open it again.';

  interface FakeEl { textContent: string | null; id: string }
  function bootSetup(o: {
    library?: unknown; appMissing?: boolean; mountThrows?: unknown; iframeThrows?: unknown; mountRejects?: unknown;
  } = {}) {
    const app: FakeEl = { textContent: '', id: 'app' };
    const body: FakeEl = { textContent: '', id: 'body' };
    const mounts: { root: unknown }[] = [];
    const iframes: unknown[] = [];
    const library = 'library' in o
      ? o.library
      : { iframe: (options: unknown) => { iframes.push(options); if (o.iframeThrows) throw o.iframeThrows; return fakeIframe(); } };
    const env: BootEnv = {
      window: {
        TrelloPowerUp: library as BootEnv['window']['TrelloPowerUp'],
        fetch: (async () => new Response('{}')) as typeof fetch,
        performance: { now: () => 0 },
        setTimeout: () => ({}), clearTimeout: () => {},
      },
      document: {
        getElementById: (id: string) => (id === 'app' && !o.appMissing ? (app as unknown as HTMLElement) : null),
        body: body as unknown as HTMLElement,
      },
      mount: (async (root: HTMLElement) => {
        mounts.push({ root });
        if (o.mountRejects) throw o.mountRejects;
        return { destroy() {} };
      }) as BootEnv['mount'],
    };
    return { env, app, body, mounts, iframes };
  }

  test('starts the matrix on #app and shows nothing of its own when all is well', async () => {
    const b = bootSetup();
    await bootMatrix(b.env);
    expect(b.mounts).toEqual([{ root: b.app }]);
    expect(b.app.textContent).toBe('');
    expect(b.body.textContent).toBe('');
  });

  test('the sentence is the fixed one', () => {
    expect(COULD_NOT_START).toBe(SENTENCE);
  });

  test.each([['missing', undefined], ['null', null], ['without iframe', {}]])('a Power-Up library that is %s shows the sentence on the page', async (_name, library) => {
    const b = bootSetup({ library });
    await bootMatrix(b.env);
    expect(b.app.textContent).toBe(SENTENCE);
    expect(b.mounts).toEqual([]);
  });

  test('a window with no TrelloPowerUp property at all shows the sentence', async () => {
    const b = bootSetup();
    delete (b.env.window as { TrelloPowerUp?: unknown }).TrelloPowerUp;
    await bootMatrix(b.env);
    expect(b.app.textContent).toBe(SENTENCE);
  });

  test('without #app the sentence goes in the body, and the matrix is not started', async () => {
    const b = bootSetup({ appMissing: true });
    await bootMatrix(b.env);
    expect(b.body.textContent).toBe(SENTENCE);
    expect(b.app.textContent).toBe('');
    expect(b.mounts).toEqual([]);
  });

  test('an iframe() that throws shows the sentence only, never its message', async () => {
    const b = bootSetup({ iframeThrows: new Error('token abc123 leaked') });
    await bootMatrix(b.env);
    expect(b.app.textContent).toBe(SENTENCE);
  });

  test('a start that rejects shows the sentence only, never its message', async () => {
    const b = bootSetup({ mountRejects: new Error('Bearer abc123') });
    await bootMatrix(b.env);
    expect(b.app.textContent).toBe(SENTENCE);
  });

  test('a throw that is not an Error is handled too', async () => {
    const b = bootSetup({ iframeThrows: 'abc123' });
    await bootMatrix(b.env);
    expect(b.app.textContent).toBe(SENTENCE);
  });

  test('bootMatrix itself never rejects and never logs', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => undefined));
    try {
      for (const o of [{ library: undefined }, { appMissing: true }, { iframeThrows: new Error('x') }, { mountRejects: new Error('y') }]) {
        await expect(bootMatrix(bootSetup(o).env)).resolves.toBeUndefined();
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
