import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RUN_ORDER, checks, p3AfterReload, p4Closed, p4Survived, writePing } from '../../src/proof/checks';
import type { CheckDeps, RestHost } from '../../src/proof/checks';
import type { TrelloAuth } from '../../src/trello/auth';

const TOKEN = 'secret-token-123';

interface Opts {
  cards?: { id: string }[];
  setRejects?: string;
  imgLoads?: boolean;
  fetchStatus?: number;
  everythingThrows?: boolean;
  /** The person is signed in (a token exists) from the start. Default true. */
  signedIn?: boolean;
  /** The sign-in window is declined: authorize() rejects and no token results. */
  declines?: boolean;
  /** What each REST host answers to every request: a status, or 'network' for a CORS or network error. Default 200. */
  hostStatus?: Partial<Record<RestHost, number | 'network'>>;
  /** The host remembered from an earlier P3 in this tab. */
  savedHost?: RestHost;
  coverUrl?: string;
  /** What `t.cards` returns, for P5 (default: `cards`). Any shape, so the check can be shown odd answers. */
  clientCards?: unknown[];
  /** What REST answers to the board's card list (default: card b has a cover whose last size is `coverUrl`). Any JSON. */
  restCards?: unknown;
  /** What REST answers to a card's attachment list (default: an empty list). */
  cardAttachments?: unknown;
  /** Whether a plain image element loads this address (default: `imgLoads`). */
  imgLoadsFor?: (url: string) => boolean;
  /** The Power-Up's id in `t.getContext().plugin`: a string, or null for a context that has none. Default 'plugin1'. */
  pluginId?: string | null;
  /** The `idPlugin` REST reports on the card's stored data. Default: the context's plugin id. */
  restPluginId?: string;
  /** REST returns the cards without any plugin data. */
  restOmitsPluginData?: boolean;
  /** Every `t.set` after this many rejects (counting all sets). */
  failSetsAfter?: number;
}
interface Call { method: string; url: string; headers: Record<string, string>; body: unknown }
type Fake = CheckDeps & { store: Map<string, unknown>; renderCallbacks: (() => void)[]; calls: Call[]; order: string[]; savedHost: () => RestHost | null };

function deps(o: Opts = {}): Fake {
  const store = new Map<string, unknown>();
  const renderCallbacks: (() => void)[] = [];
  const calls: Call[] = [];
  const order: string[] = [];   // which Trello client calls happened, in order
  let hasToken = o.signedIn ?? true;
  let savedHost: RestHost | null = o.savedHost ?? null;   // null until P3 has found one in this tab
  const boom = (): never => { throw new Error('boom'); };
  const cards = o.cards ?? [{ id: 'a' }, { id: 'b' }];
  let sets = 0;
  const pluginId = o.pluginId === undefined ? 'plugin1' : o.pluginId;
  const t = {
    getContext: () => ({ board: 'board1', member: 'm1', ...(pluginId === null ? {} : { plugin: pluginId }) }),
    get: async (scope: string, vis: string, key: string) => { order.push('get'); return o.everythingThrows ? boom() : store.get(`${scope}|${vis}|${key}`); },
    set: async (scope: string, vis: string, key: string, value: unknown) => {
      order.push('set');
      sets++;
      if (o.everythingThrows) boom();
      if (o.failSetsAfter !== undefined && sets > o.failSetsAfter) throw new Error('storage is busy');
      if (o.setRejects) throw new Error(o.setRejects);
      store.set(`${scope}|${vis}|${key}`, value);
    },
    remove: async (scope: string, vis: string, key: string) => { store.delete(`${scope}|${vis}|${key}`); },
    cards: async () => (o.everythingThrows ? boom() : o.clientCards ?? cards),
    lists: async () => (o.everythingThrows ? boom() : [{ id: 'l1', cards: [{ id: 'a' }] }]),
    board: async () => (o.everythingThrows ? boom() : { id: 'board1' }),
    render: (fn: () => void) => { if (o.everythingThrows) boom(); renderCallbacks.push(fn); },
    showCard: async () => (o.everythingThrows ? boom() : undefined),
  } as unknown as TrelloIframe;
  const auth: TrelloAuth = {
    authorize: () => {
      order.push('authorize');
      if (o.everythingThrows) return Promise.reject(new Error('boom'));
      if (o.declines) return Promise.reject(new Error('Trello gave no access token. The sign-in was declined or did not finish.'));
      hasToken = true;
      return Promise.resolve();
    },
    accessToken: async () => { order.push('accessToken'); return o.everythingThrows ? boom() : hasToken ? TOKEN : null; },
    isAuthorized: async () => hasToken,
  };
  const dropToken = () => { hasToken = false; };
  (auth as TrelloAuth & { dropToken: () => void }).dropToken = dropToken;

  let optionText = 'One';
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (o.everythingThrows) throw new TypeError('network down');
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string>, body });
    const host = new URL(url).origin as RestHost;
    const hostAnswer = o.hostStatus?.[host];
    if (hostAnswer === 'network') throw new TypeError('Failed to fetch');
    const status = hostAnswer ?? o.fetchStatus ?? 200;
    const path = new URL(url).pathname;
    let json: unknown = {};
    if (method === 'POST' && path === '/1/customFields') {
      json = { id: 'f1', options: [{ id: 'o1', value: { text: 'One' } }, { id: 'o2', value: { text: 'Two' } }] };
    } else if (method === 'PUT' && path === '/1/customFields/f1/options/o1') {
      optionText = body.value.text;
      json = { id: 'o1', value: { text: optionText } };
    } else if (method === 'GET' && path === '/1/customFields/f1/options/o1') {
      json = { id: 'o1', value: { text: optionText } };
    } else if (path === '/1/boards/board1') {
      // Like Trello: each card lists its stored Power-Up data as one entry per Power-Up, the value a JSON string.
      const pluginData = (cardId: string) => {
        const mine: Record<string, unknown> = {};
        for (const [k, v] of store) {
          const [scope, vis, key] = k.split('|');
          if (scope === cardId && vis === 'shared') mine[key!] = v;
        }
        if (o.restOmitsPluginData || Object.keys(mine).length === 0) return [];
        return [{ idPlugin: o.restPluginId ?? pluginId ?? 'plugin1', scope: 'card', idModel: cardId, value: JSON.stringify(mine), access: 'shared' }];
      };
      json = { id: 'board1', cards: ['a', 'b'].map(id => ({ id, name: id.toUpperCase(), pluginData: pluginData(id) })) };
    } else if (path === '/1/boards/board1/cards') {
      json = o.restCards ?? [{ id: 'a', cover: {} }, { id: 'b', cover: { scaled: [{ url: 'https://img.example/small.png' }, { url: o.coverUrl ?? 'https://img.example/big.png' }] } }];
    } else if (path.endsWith('/attachments')) {
      json = o.cardAttachments ?? [];
    } else if (path.startsWith('/1/cards/')) {
      const pos = new URL(url).searchParams.get('pos');
      json = { id: 'a', pos: pos === 'top' ? 1 : pos === 'bottom' ? 9999 : pos ? Number(pos) : 2048 };
    }
    return new Response(status < 300 ? JSON.stringify(json) : status === 401 ? 'unauthorized permission requested' : 'nope', { status, headers: { 'x-rate-limit-api-token-remaining': '70' } });
  }) as typeof fetch;

  let tick = 0;
  return {
    t, auth, fetch: fakeFetch, now: () => (tick += 10), store, renderCallbacks, calls, order,
    host: { get: () => savedHost ?? 'https://trello.com', saved: () => savedHost, set: h => { savedHost = h; } }, savedHost: () => savedHost,
    loadImage: async url => (o.imgLoadsFor ? o.imgLoadsFor(url) : o.imgLoads ?? true),
  };
}

const byId = (id: string) => {
  const c = checks.find(x => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
};

test('there are eight checks, P1 to P8, in order', () => {
  expect(checks.map(c => c.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
});

test('the run order is the script order and holds every check id exactly once', () => {
  expect([...RUN_ORDER]).toEqual(['P1', 'P3', 'P5', 'P6', 'P7', 'P8', 'P2', 'P4']);
  expect([...RUN_ORDER].sort()).toEqual(checks.map(c => c.id).sort());
  expect(new Set(RUN_ORDER).size).toBe(RUN_ORDER.length);
});

test('every check has a one-line instruction, and the texts are the ones the script promises', () => {
  for (const c of checks) {
    expect(c.instruction.trim()).not.toBe('');
    expect(c.instruction).not.toMatch(/\n/);
  }
  expect(Object.fromEntries(checks.map(c => [c.id, c.instruction]))).toEqual({
    P1: 'Press Run.',
    P3: 'Press Run and allow access in the window that opens. When the row has a result, reload this page once.',
    P5: 'Press Run. Needs a card with a cover image or an image attachment.',
    P6: 'Press Run. It moves one card and puts it back.',
    P7: 'Press Run. It adds a temporary field and removes it.',
    P8: 'Press Run. It takes a few seconds.',
    P2: 'Needs a second browser window open on this board with this page (another person, or you in another window). Press Run here, then press Write ping in the other window within 90 seconds.',
    P4: 'Press Run, then close the card that opens.',
  });
});

test('P1 passes when a value set on another card id reads back', async () => {
  const r = await byId('P1').run(deps({ cards: [{ id: 'a' }, { id: 'b' }] }));
  expect(r.status).toBe('pass');
});
test('P1 fails with the error text when t.set rejects', async () => {
  const r = await byId('P1').run(deps({ setRejects: 'not in scope' }));
  expect(r).toMatchObject({ status: 'fail', detail: expect.stringContaining('not in scope') });
});
test('P1 fails when the board has fewer than two cards', async () => {
  const r = await byId('P1').run(deps({ cards: [{ id: 'a' }] }));
  expect(r).toMatchObject({ status: 'fail', detail: expect.stringContaining('two cards') });
});
test('P1 fails when the value does not read back', async () => {
  const d = deps();
  d.t.get = async () => undefined;
  expect((await byId('P1').run(d)).status).toBe('fail');
});

const API_HOST: RestHost = 'https://api.trello.com';
const TRELLO_HOST: RestHost = 'https://trello.com';
const probes = (d: Fake) => d.calls.filter(c => c.url.includes('/1/boards/board1?fields=name'));

test('P3 calls authorize first, before anything is awaited, and even when a token exists', async () => {
  const d = deps({ signedIn: true });
  const running = byId('P3').run(d);
  expect(d.order).toEqual(['authorize']);
  await running;
});
test('P3 passes when only trello.com answers 200, names it, and remembers it', async () => {
  const d = deps({ signedIn: false, hostStatus: { [API_HOST]: 401 } });
  const r = await byId('P3').run(d);
  expect(r.status).toBe('pass');
  expect(r.detail).toContain('token received: yes');
  expect(r.detail).toContain(`${API_HOST}: HTTP 401`);
  expect(r.detail).toContain(`${TRELLO_HOST}: HTTP 200`);
  expect(r.detail).toContain(`hosts that worked: ${TRELLO_HOST}`);
  expect(r.detail).not.toContain(`hosts that worked: ${API_HOST}`);
  expect(d.savedHost()).toBe(TRELLO_HOST);
});
test('P3 passes when only api.trello.com answers 200, and remembers it', async () => {
  const d = deps({ hostStatus: { [TRELLO_HOST]: 'network' } });
  const r = await byId('P3').run(d);
  expect(r.status).toBe('pass');
  expect(r.detail).toContain(`${TRELLO_HOST}: network error: Failed to fetch`);
  expect(r.detail).toContain(`hosts that worked: ${API_HOST}.`);
  expect(d.savedHost()).toBe(API_HOST);
});
test('P3 passes when both hosts answer 200, names both, and prefers api.trello.com', async () => {
  const d = deps({ savedHost: TRELLO_HOST });
  const r = await byId('P3').run(d);
  expect(r.status).toBe('pass');
  expect(r.detail).toContain(`hosts that worked: ${API_HOST}, ${TRELLO_HOST}`);
  expect(d.savedHost()).toBe(API_HOST);
});
test('P3 asks for the board name from both hosts with the Bearer header and no key or token in the address', async () => {
  const d = deps();
  await byId('P3').run(d);
  expect(probes(d).map(c => c.url)).toEqual([`${API_HOST}/1/boards/board1?fields=name`, `${TRELLO_HOST}/1/boards/board1?fields=name`]);
  for (const c of probes(d)) expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`);
});
test('P3 fails when neither host answers 200, with both answers in the detail, and keeps the old host', async () => {
  const d = deps({ savedHost: TRELLO_HOST, hostStatus: { [API_HOST]: 'network', [TRELLO_HOST]: 401 } });
  const r = await byId('P3').run(d);
  expect(r.status).toBe('fail');
  expect(r.detail).toContain(`${API_HOST}: network error: Failed to fetch`);
  expect(r.detail).toContain(`${TRELLO_HOST}: HTTP 401 unauthorized permission requested`);
  expect(d.savedHost()).toBe(TRELLO_HOST);
});
test('P3 failing says which saved host later checks keep using', async () => {
  const d = deps({ savedHost: API_HOST, hostStatus: { [API_HOST]: 401, [TRELLO_HOST]: 401 } });
  const r = await byId('P3').run(d);
  expect(r.status).toBe('fail');
  expect(r.detail).toContain(`Later checks keep using ${API_HOST}.`);
  const declined = await byId('P3').run(deps({ savedHost: TRELLO_HOST, signedIn: false, declines: true }));
  expect(declined.detail).toContain(`Later checks keep using ${TRELLO_HOST}.`);
});
test('P3 failing says nothing about a host when none was saved in this tab', async () => {
  const d = deps({ hostStatus: { [API_HOST]: 401, [TRELLO_HOST]: 401 } });
  expect((await byId('P3').run(d)).detail).not.toContain('Later checks keep using');
  expect(d.savedHost()).toBeNull();
});
test('P3 fails when no token results, and makes no request', async () => {
  const d = deps({ signedIn: false, declines: true });
  const r = await byId('P3').run(d);
  expect(r.status).toBe('fail');
  expect(r.detail).toContain('declined');
  expect(d.calls).toEqual([]);
});
test('P3 fails when authorize resolves but there is still no token, and makes no request', async () => {
  const d = deps({ signedIn: false });
  d.auth.authorize = async () => undefined;
  const r = await byId('P3').run(d);
  expect(r).toMatchObject({ status: 'fail', detail: expect.stringContaining('token received: no') });
  expect(d.calls).toEqual([]);
});
test('P3 leaves a marker for the next page load only when a token resulted', async () => {
  const signedIn = deps({ signedIn: false });
  await byId('P3').run(signedIn);
  expect(signedIn.store.has('member|private|mxproofAuth')).toBe(true);
  const declined = deps({ signedIn: false, declines: true });
  await byId('P3').run(declined);
  expect(declined.store.has('member|private|mxproofAuth')).toBe(false);
});
test('P3 after reload still reports the token when no host answered 200, and the row stays a fail', async () => {
  const d = deps({ signedIn: false, hostStatus: { [API_HOST]: 401, [TRELLO_HOST]: 'network' } });
  expect((await byId('P3').run(d)).status).toBe('fail');
  expect(d.store.has('member|private|mxproofAuth')).toBe(true);
  const after = await p3AfterReload(d);
  expect(after).toMatchObject({ id: 'P3', status: 'fail', detail: expect.stringContaining('token after reload: yes') });
  expect(after?.detail).toContain('no host answered 200');
  expect(d.store.has('member|private|mxproofAuth')).toBe(false);
});
test('P3 after reload passes when the saved marker is there and the token is still there', async () => {
  const d = deps({ signedIn: false });
  await byId('P3').run(d);
  expect(await p3AfterReload(d)).toMatchObject({ id: 'P3', status: 'pass', detail: expect.stringContaining('token after reload: yes') });
});
test('P3 after reload keeps what the first part found', async () => {
  const d = deps({ hostStatus: { [API_HOST]: 401 } });
  await byId('P3').run(d);
  expect((await p3AfterReload(d))?.detail).toContain(`hosts that worked: ${TRELLO_HOST}`);
});
test('P3 after reload reports once, then clears its marker', async () => {
  const d = deps({ signedIn: false });
  await byId('P3').run(d);
  expect(await p3AfterReload(d)).toMatchObject({ id: 'P3', status: 'pass' });
  expect(d.store.has('member|private|mxproofAuth')).toBe(false);
  expect(await p3AfterReload(d)).toBeNull();
});
test('P3 after reload ignores a marker left by another browser, and leaves it alone', async () => {
  const d = deps();
  d.store.set('member|private|mxproofAuth', { ua: 'Some Other Browser', at: 1 });
  expect(await p3AfterReload(d)).toBeNull();
  expect(d.store.has('member|private|mxproofAuth')).toBe(true);
});
test('P3 after reload says nothing when sign-in was never tried', async () => {
  expect(await p3AfterReload(deps())).toBeNull();
});
test('P3 after reload fails when the token is gone', async () => {
  const d = deps({ signedIn: false });
  await byId('P3').run(d);
  (d.auth as TrelloAuth & { dropToken: () => void }).dropToken();
  expect(await p3AfterReload(d)).toMatchObject({ id: 'P3', status: 'fail', detail: expect.stringContaining('token after reload: no') });
});

describe('a check that needs a token and finds none', () => {
  for (const id of ['P5', 'P6', 'P7', 'P8']) {
    test(`${id} says "Not signed in. Run P3 first." and makes no request`, async () => {
      const d = deps({ signedIn: false });
      const r = await byId(id).run(d);
      expect(r).toMatchObject({ status: 'fail', detail: 'Not signed in. Run P3 first.' });
      expect(d.calls).toEqual([]);
    });
  }
});

describe('the host P3 found', () => {
  test('later checks use trello.com when P3 has not run, and say so', async () => {
    const d = deps();
    const r = await byId('P6').run(d);
    expect(d.calls.every(c => c.url.startsWith(`${TRELLO_HOST}/`))).toBe(true);
    expect(r.detail).toContain(`REST host: ${TRELLO_HOST}`);
  });
  test.each([
    ['only api.trello.com answered', { [TRELLO_HOST]: 401 } as Opts['hostStatus'], API_HOST],
    ['only trello.com answered', { [API_HOST]: 'network' } as Opts['hostStatus'], TRELLO_HOST],
  ])('later checks use the host P3 found (%s), and say so', async (_name, hostStatus, expected) => {
    const o: Opts = { hostStatus };
    const d = deps(o);
    await byId('P3').run(d);
    o.hostStatus = undefined;                 // from here on both hosts answer, so only the saved host decides
    for (const id of ['P5', 'P6', 'P7', 'P8']) {
      d.calls.length = 0;
      const r = await byId(id).run(d);
      expect(r.detail).toContain(`REST host: ${expected}`);
      const restCalls = d.calls.filter(c => c.url.includes('/1/'));   // P5 also fetches image addresses, which are not REST calls
      expect(restCalls.length).toBeGreaterThan(0);
      expect(restCalls.every(c => c.url.startsWith(`${expected}/`))).toBe(true);
    }
  });
});

test('no request anywhere carries a key= or token= parameter', async () => {
  const d = deps({ imgLoads: false });
  for (const id of ['P3', 'P5', 'P6', 'P7', 'P8']) await byId(id).run(d);
  expect(d.calls.length).toBeGreaterThan(40);
  for (const c of d.calls) {
    expect(new URL(c.url).searchParams.has('key')).toBe(false);
    expect(new URL(c.url).searchParams.has('token')).toBe(false);
    expect(c.url).not.toContain(TOKEN);
  }
});

// ---- P5: every way a cover could be described and shown ----------------------

const TRELLO_IMAGE = 'https://trello.com/1/cards/b/attachments/x/download/big.png';
type Answer = (url: string, init?: RequestInit) => Response | undefined | Promise<Response | undefined>;
/** Lets a test answer chosen requests itself; every other request goes to the usual fake. Answered requests are recorded too. */
function intercept(d: Fake, answer: Answer): Fake {
  const real = d.fetch;
  d.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const mine = await answer(url, init);
    if (!mine) return real(input, init);
    d.calls.push({ method: init?.method ?? 'GET', url, headers: (init?.headers ?? {}) as Record<string, string>, body: undefined });
    return mine;
  }) as typeof fetch;
  return d;
}
const unauthorized = () => new Response('unauthorized permission requested', { status: 401 });
const sectionOf = (detail: string, prefix: string) => detail.split(' | ').find(s => s.startsWith(prefix)) ?? '';
/** A card that only the client data (t.cards) knows has a cover; REST has nothing for it. */
const clientOnly = (scaled: unknown[], extra: Record<string, unknown> = {}): Opts => ({
  clientCards: [{ id: 'a', name: 'Secret card name', cover: { idAttachment: 'att1', scaled }, ...extra }],
  restCards: [{ id: 'a', cover: {} }],
});

describe('P5', () => {
  test('is manual when neither source has a cover or an image attachment, and the detail carries both sources\' counts', async () => {
    const d = deps({
      clientCards: [{ id: 'a', name: 'Secret card name', cover: null }, { id: 'b', name: 'Another', cover: {}, attachments: [{ id: 'z', url: 'https://x.example/f.pdf', previews: [] }] }],
      restCards: [{ id: 'a', cover: {}, attachments: [] }, { id: 'b', cover: null }],
    });
    const r = await byId('P5').run(d);
    expect(r.status).toBe('manual');
    expect(r.detail.startsWith('No cover or image attachment was found in either source.')).toBe(true);
    expect(r.detail).toContain('Client data (t.cards): 2 cards; cover.idAttachment on 0; cover.idUploadedBackground on 0; cover.scaled not empty on 0');
    expect(r.detail).toContain('REST card list: HTTP 200; 2 cards; cover.idAttachment on 0; cover.scaled not empty on 0; idAttachmentCover on 0; attachments on 0');
    expect(d.calls.some(c => c.url.includes('/attachments'))).toBe(false);
  });

  test('finds a cover that only the client data has, and passes when img works for it', async () => {
    const d = deps({ ...clientOnly([{ url: 'https://img.example/c-small.png', width: 100 }, { url: 'https://img.example/c-600.png', width: 600 }, { url: 'https://img.example/c-big.png', width: 1200 }]), imgLoads: true });
    const r = await byId('P5').run(d);
    expect(r.status).toBe('pass');
    expect(r.detail.startsWith('Works: ')).toBe(true);
    expect(sectionOf(r.detail, 'Works: ')).toContain('client cover.scaled via img');
    expect(r.detail).toContain('img.example/c-600.png');       // the largest size not wider than 600
    expect(r.detail).not.toContain('c-big.png');
    expect(d.calls.some(c => c.url.endsWith('/1/cards/a/attachments?fields=id,name,url,previews,mimeType,isUpload'))).toBe(true);
  });

  test('takes the first card in the client data\'s order that shows a cover in either source', async () => {
    const d = deps({
      clientCards: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      restCards: [{ id: 'a', cover: {} }, { id: 'b', cover: null }, { id: 'c', idAttachmentCover: 'att9' }, { id: 'd', cover: { idAttachment: 'att8' } }],
    });
    await byId('P5').run(d);
    expect(d.calls.some(c => c.url.includes('/1/cards/c/attachments'))).toBe(true);
    expect(d.calls.some(c => c.url.includes('/1/cards/d/attachments'))).toBe(false);
  });

  test('falls back to a card with an image attachment that has previews', async () => {
    const d = deps({
      clientCards: [{ id: 'a' }, { id: 'b', attachments: [{ id: 'x', url: 'https://img.example/a.png', mimeType: 'image/png', previews: [{ url: 'https://img.example/pv.png', width: 300 }] }] }],
      restCards: [{ id: 'a', cover: {} }, { id: 'b', cover: {} }],
    });
    const r = await byId('P5').run(d);
    expect(r.status).toBe('pass');
    expect(sectionOf(r.detail, 'Works: ')).toContain('client attachment preview via img');
    expect(d.calls.some(c => c.url.includes('/1/cards/b/attachments'))).toBe(true);
  });

  test('lists the candidates in order, one per label, from every source', async () => {
    const d = deps({
      clientCards: [{ id: 'a', cover: { idAttachment: 'att2', scaled: [{ url: 'https://img.example/cs.png', width: 300 }] }, attachments: [
        { id: 'att1', url: 'https://img.example/other.png', mimeType: 'image/png', previews: [{ url: 'https://img.example/other-pv.png', width: 100 }] },
        { id: 'att2', url: 'https://img.example/dl2.png', mimeType: 'image/png', previews: [{ url: 'https://img.example/p2-300.png', width: 300 }, { url: 'https://img.example/p2-1000.png', width: 1000 }] }] }],
      restCards: [{ id: 'a', cover: { idAttachment: 'att2', scaled: [{ url: 'https://img.example/rs.png', width: 300 }] } }],
      cardAttachments: [{ id: 'att2', url: 'https://img.example/dl2-rest.png', previews: [{ url: 'https://img.example/rp2.png', width: 500 }] }],
    });
    const r = await byId('P5').run(d);
    const candidates = sectionOf(r.detail, 'Candidates: ');
    const order = ['client cover.scaled', 'rest cover.scaled', 'client attachment preview', 'rest attachment preview', 'attachment download url'].map(l => candidates.indexOf(l));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(candidates).toContain('img.example/p2-300.png');
    expect(candidates).toContain('img.example/rp2.png');
    expect(candidates).toContain('img.example/dl2.png');           // the client's own address wins
    expect(candidates).not.toContain('other-pv.png');              // the cover attachment is chosen by its id
    expect(candidates).not.toContain('p2-1000.png');
    expect(r.detail.match(/client cover\.scaled/g)?.length).toBeGreaterThan(0);
  });

  test('tries every candidate by img, fetch with the token and fetch without, even when img works', async () => {
    const d = deps({ ...clientOnly([{ url: TRELLO_IMAGE, width: 300 }]), imgLoads: true });
    const r = await byId('P5').run(d);
    const works = sectionOf(r.detail, 'Works: ');
    expect(works).toContain('client cover.scaled via img');
    expect(works).toContain('client cover.scaled via fetch+token');
    expect(works).toContain('client cover.scaled via fetch plain');
    const imageCalls = d.calls.filter(c => c.url === TRELLO_IMAGE);
    expect(imageCalls).toHaveLength(2);
    expect(imageCalls.some(c => c.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(imageCalls.some(c => c.headers.Authorization === undefined)).toBe(true);
  });

  test('passes when only fetch with the token works, and says so', async () => {
    const d = intercept(deps({ ...clientOnly([{ url: TRELLO_IMAGE, width: 300 }]), imgLoads: false }),
      (url, init) => (url === TRELLO_IMAGE ? ((init?.headers as Record<string, string> | undefined)?.Authorization ? new Response('PNGDATA') : unauthorized()) : undefined));
    const r = await byId('P5').run(d);
    expect(r.status).toBe('pass');
    expect(sectionOf(r.detail, 'Works: ')).toContain('client cover.scaled via fetch+token');
    expect(sectionOf(r.detail, 'Works: ')).not.toContain('via img');
    expect(sectionOf(r.detail, 'Works: ')).not.toContain('via fetch plain');
    const failed = sectionOf(r.detail, 'Did not work: ');
    expect(failed).toContain('client cover.scaled via img');
    expect(failed).toContain('client cover.scaled via fetch plain (HTTP 401 unauthorized permission requested)');
  });

  test('passes when only fetch without headers works, and says so', async () => {
    const d = intercept(deps({ ...clientOnly([{ url: TRELLO_IMAGE, width: 300 }]), imgLoads: false }),
      (url, init) => {
        if (url !== TRELLO_IMAGE) return undefined;
        if ((init?.headers as Record<string, string> | undefined)?.Authorization) throw new TypeError('Failed to fetch');
        return new Response('PNGDATA');
      });
    const r = await byId('P5').run(d);
    expect(r.status).toBe('pass');
    expect(sectionOf(r.detail, 'Works: ')).toContain('client cover.scaled via fetch plain');
    expect(sectionOf(r.detail, 'Works: ')).not.toContain('via fetch+token');
    expect(sectionOf(r.detail, 'Did not work: ')).toContain('client cover.scaled via fetch+token (network error: Failed to fetch)');
  });

  test('sends fetch without headers and without credentials', async () => {
    const seen: RequestInit[] = [];
    const d = intercept(deps({ ...clientOnly([{ url: 'https://img.example/p.png' }]) }), (url, init) => { if (url === 'https://img.example/p.png') { seen.push(init ?? {}); return new Response('PNGDATA'); } });
    await byId('P5').run(d);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.credentials).toBe('omit');
    expect(seen[0]?.headers).toBeUndefined();
  });

  test('fails when candidates exist and nothing loads, naming every attempted pair with its reason', async () => {
    const d = intercept(deps({ ...clientOnly([{ url: TRELLO_IMAGE }]), imgLoads: false }), url => (url === TRELLO_IMAGE ? unauthorized() : undefined));
    const r = await byId('P5').run(d);
    expect(r.status).toBe('fail');
    expect(r.detail.startsWith('Works: none')).toBe(true);
    const failed = sectionOf(r.detail, 'Did not work: ');
    expect(failed).toContain('client cover.scaled via img (did not load)');
    expect(failed).toContain('client cover.scaled via fetch+token (HTTP 401 unauthorized permission requested)');
    expect(failed).toContain('client cover.scaled via fetch plain (HTTP 401 unauthorized permission requested)');
    expect(r.detail).toContain('Client data (t.cards): 1 cards');
    expect(r.detail).toContain('REST card list: HTTP 200');
    expect(r.detail).toContain('REST card attachments');
  });

  test('fails, and says why, when a card has a cover but no image address can be found for it', async () => {
    const d = deps({ clientCards: [{ id: 'a', cover: { idAttachment: 'att1' } }], restCards: [{ id: 'a', cover: {} }] });
    const r = await byId('P5').run(d);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('No image address was found for card a');
  });

  test('still runs on the client data and reports it when the REST card list is refused', async () => {
    const d = intercept(deps({ ...clientOnly([{ url: 'https://img.example/p.png' }]) }), url => (new URL(url).pathname === '/1/boards/board1/cards' ? unauthorized() : undefined));
    const r = await byId('P5').run(d);
    expect(r.status).toBe('pass');
    expect(r.detail).toContain('REST card list: refused (HTTP 401 unauthorized permission requested)');
    expect(sectionOf(r.detail, 'Works: ')).toContain('client cover.scaled via img');
  });

  test('carries on and reports it when the card\'s attachment list is refused', async () => {
    const d = intercept(deps({ ...clientOnly([{ url: 'https://img.example/p.png' }]) }), url => (new URL(url).pathname === '/1/cards/a/attachments' ? unauthorized() : undefined));
    const r = await byId('P5').run(d);
    expect(r.status).toBe('pass');
    expect(r.detail).toContain('REST card attachments (card a): refused (HTTP 401 unauthorized permission requested)');
  });

  test('reports a network error on a REST step and carries on', async () => {
    const d = intercept(deps({ ...clientOnly([{ url: 'https://img.example/p.png' }]) }), url => { if (new URL(url).pathname === '/1/cards/a/attachments') throw new TypeError('Failed to fetch'); });
    const r = await byId('P5').run(d);
    expect(r.status).toBe('pass');
    expect(r.detail).toContain('REST card attachments (card a): failed (Failed to fetch)');
  });

  test('never sends the Authorization header to a host that is not Trello, and says it did not try', async () => {
    const urls = ['https://images.unsplash.com/photo.jpg', 'https://trello.com.evil.example/x.png'];
    for (const url of urls) {
      const d = deps({ ...clientOnly([{ url }]), imgLoads: false });
      const r = await byId('P5').run(d);
      const sent = d.calls.filter(c => c.url === url);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.headers.Authorization).toBeUndefined();
      expect(sectionOf(r.detail, 'Not tried: ')).toContain('client cover.scaled via fetch+token');
      expect(r.detail).not.toContain(TOKEN);
    }
  });

  test('sends the Bearer header to a subdomain of trello.com', async () => {
    const url = 'https://trello-attachments.trello.com/x.png';
    const d = deps({ ...clientOnly([{ url }]), imgLoads: false });
    await byId('P5').run(d);
    expect(d.calls.filter(c => c.url === url).some(c => c.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  test('masks addresses: no long ids, no query string, no token and no card name in the detail', async () => {
    const url = 'https://trello.com/1/cards/5f3a9c1e8b7d4a2e6c1f0b3d/attachments/60A1B2C3D4E5F60718293A4B/previews/1234567/download/pic.png?sig=SECRETSIG&token=abc';
    const d = intercept(deps({ ...clientOnly([{ url }]), imgLoads: false }), u => (u.startsWith('https://trello.com/1/cards/5f3a') ? new Response(`bad credentials ${TOKEN} ${url}`, { status: 401 }) : undefined));
    const r = await byId('P5').run(d);
    expect(r.detail).toContain('trello.com/1/cards/…/attachments/…/previews/…/download/pic.png');
    expect(r.detail).not.toMatch(/[0-9a-f]{16,}/i);
    expect(r.detail).not.toMatch(/\d{6,}/);
    expect(r.detail).not.toContain('SECRETSIG');
    expect(r.detail).not.toContain('?');
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(r.detail).not.toContain('Secret card name');
  });

  test('cuts each refusal or error text to 120 characters', async () => {
    const url = 'https://img.example/p.png';
    const d = intercept(deps({ ...clientOnly([{ url }]), imgLoads: false }), u => { if (u === url) return new Response('x'.repeat(500), { status: 500 }); });
    const r = await byId('P5').run(d);
    expect(r.detail).toContain('x'.repeat(100));
    expect(r.detail).not.toContain('x'.repeat(121));
  });

  test('reports an unexpected shape instead of throwing', async () => {
    const d = deps({
      clientCards: [null, 5, 'text', { id: 'a', cover: 'weird', attachments: {} }, { id: 'b', cover: { scaled: 7, idAttachment: 5 }, attachments: [null, { previews: 'no' }] }],
      restCards: 'not a list',
    });
    const r = await byId('P5').run(d);
    expect(r.status).toBe('manual');
    expect(r.detail).toContain('Client data (t.cards): 5 cards');
    expect(r.detail).toContain('REST card list: HTTP 200 but the answer was not a list');
  });

  test('reports a failing t.cards and still runs the REST step', async () => {
    const d = deps({ restCards: [{ id: 'a', cover: { idAttachment: 'att1', scaled: [{ url: 'https://img.example/r.png' }] } }] });
    d.t.cards = async () => { throw new Error('no cards for you'); };
    const r = await byId('P5').run(d);
    expect(r.status).toBe('pass');
    expect(r.detail).toContain('Client data (t.cards): failed (no cards for you)');
    expect(sectionOf(r.detail, 'Works: ')).toContain('rest cover.scaled via img');
  });

  test('says which card it tested, by id, and which key names it saw (names only)', async () => {
    const d = deps({ ...clientOnly([{ url: 'https://img.example/p.png' }], { attachments: [{ id: 'att1', url: 'https://img.example/d.png', mimeType: 'image/png', previews: [{ url: 'https://img.example/p.png' }], secretField: 'x' }] }) });
    const r = await byId('P5').run(d);
    expect(r.detail).toContain('Card tested: a');
    expect(r.detail).toContain('cover keys [idAttachment, scaled]');
    expect(r.detail).toContain('attachment keys [id, mimeType, previews, secretField, url]');
  });
});

test('P6 reports requests per second and any 429', async () => {
  const r = await byId('P6').run(deps({ fetchStatus: 200 }));
  expect(r.detail).toMatch(/\d+ requests in \d+ ms, 429s: 0/);
});
test('P6 sends 30 requests and reads back top, bottom and a fraction', async () => {
  const d = deps();
  const r = await byId('P6').run(d);
  const puts = d.calls.filter(c => c.method === 'PUT');
  expect(puts.length).toBeGreaterThanOrEqual(33);
  expect(r.detail).toContain('30 requests');
  expect(r.detail).toContain('65536.5');
  expect(r.detail).toContain('x-rate-limit-api-token-remaining: 70');
});
/** A fetch that answers 429 to some of the PUTs. PUT 1-3 are the position tries, 4-33 the burst, 34 on the restore. */
function tooManyOnPuts(d: Fake, is429: (n: number) => boolean) {
  const real = d.fetch;
  let puts = 0;
  d.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT' && is429(++puts)) return new Response('slow down', { status: 429 });
    return real(input, init);
  }) as typeof fetch;
}

test('P6 counts 429 responses in the burst', async () => {
  const d = deps();
  tooManyOnPuts(d, n => n > 23 && n <= 33);
  const r = await byId('P6').run(d);
  expect(r.detail).toMatch(/30 requests in \d+ ms, 429s: 10;/);
  expect(r.detail).toContain('card position restored');
});

describe('P6 restore', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test('P6 reports "not restored" when the restore PUT keeps getting 429', async () => {
    const d = deps();
    tooManyOnPuts(d, n => n > 33);
    const running = byId('P6').run(d);
    await vi.runAllTimersAsync();
    const r = await running;
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('not restored');
  });
  test('P6 reports restored when the restore succeeds on a retry', async () => {
    const d = deps();
    tooManyOnPuts(d, n => n === 34);
    const running = byId('P6').run(d);
    await vi.runAllTimersAsync();
    const r = await running;
    expect(r.status).toBe('pass');
    expect(r.detail).toContain('card position restored');
    expect(d.calls.filter(c => c.method === 'PUT').length).toBe(34); // the 429 was answered before it reached the fake's log
  });
  test('P6 still tries to restore after a refused value', async () => {
    const d = deps();
    tooManyOnPuts(d, n => n === 2);
    const running = byId('P6').run(d);
    await vi.runAllTimersAsync();
    const r = await running;
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('pos=bottom was refused');
    expect(r.detail).toContain('card position restored');
  });
});
test('P6 fails clearly when a position value is refused', async () => {
  const r = await byId('P6').run(deps({ fetchStatus: 400 }));
  expect(r.status).toBe('fail');
});
test('a refused request gives the HTTP status and the short error text, so a 401 can be recognised', async () => {
  for (const id of ['P6', 'P7', 'P8']) {
    const r = await byId(id).run(deps({ fetchStatus: 401 }));
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('HTTP 401 unauthorized permission requested');
    expect(r.detail).toContain('REST host: https://trello.com');
  }
});

test('P7 creates a field, renames an option, reads it back and deletes the field', async () => {
  const d = deps();
  const r = await byId('P7').run(d);
  expect(r.status).toBe('pass');
  const create = d.calls.find(c => c.method === 'POST');
  expect(create?.body).toMatchObject({ name: 'mxproof', display_cardFront: true, idModel: 'board1' });
  const rename = d.calls.find(c => c.method === 'PUT');
  expect(rename?.url).toContain('/1/customFields/f1/options/o1');
  expect(rename?.body).toMatchObject({ value: { text: expect.any(String) } });
  expect(d.calls.at(-1)).toMatchObject({ method: 'DELETE' });
  expect(d.calls.at(-1)?.url).toContain('/1/customFields/f1');
});
test('P7 still deletes the field when the rename fails', async () => {
  const d = deps();
  const real = d.fetch;
  d.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    init?.method === 'PUT' ? new Response('nope', { status: 400 }) : real(input, init)) as typeof fetch;
  const r = await byId('P7').run(d);
  expect(r.status).toBe('fail');
  expect(d.calls.some(c => c.method === 'DELETE' && c.url.includes('/1/customFields/f1'))).toBe(true);
});

describe('P8', () => {
  const KEY = 'a|shared|mxproof8';
  const burstSets = (d: Fake) => d.order.filter(o => o === 'set').length;

  test('P8 passes when REST returns the value under this Power-Up\'s id, and reports the burst', async () => {
    const d = deps();
    const r = await byId('P8').run(d);
    expect(r.status).toBe('pass');
    expect(r.detail).toContain('plugin id in the context: yes');
    expect(r.detail).toContain('value in the REST card data: found');
    expect(r.detail).toContain('idPlugin matches the context: yes');
    expect(r.detail).toMatch(/30 saves in \d+ ms, failures: 0/);
    expect(burstSets(d)).toBe(31);                                  // the stamp, then the burst
    const read = d.calls.find(c => c.method === 'GET' && c.url.includes('/1/boards/board1?'));
    expect(read?.url).toBe('https://trello.com/1/boards/board1?cards=open&card_fields=name&card_pluginData=true');
    expect(r.detail).toContain('REST host: https://trello.com');
    expect(read?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(d.store.has(KEY)).toBe(false);
  });
  test('P8 fails when the context has no plugin id, and still removes its key', async () => {
    for (const pluginId of [null, '']) {
      const d = deps({ pluginId });
      const r = await byId('P8').run(d);
      expect(r.status).toBe('fail');
      expect(r.detail).toContain('plugin id in the context: no');
      expect(d.store.has(KEY)).toBe(false);
    }
  });
  test('P8 fails when REST does not return the stored value, and still removes its key', async () => {
    const d = deps({ restOmitsPluginData: true });
    const r = await byId('P8').run(d);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('value in the REST card data: not found');
    expect(r.detail).toMatch(/30 saves in \d+ ms/);                 // the burst is measured all the same
    expect(d.store.has(KEY)).toBe(false);
  });
  test('P8 fails when the entry is there under a different idPlugin', async () => {
    const d = deps({ restPluginId: 'someone-else' });
    const r = await byId('P8').run(d);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('value in the REST card data: found');
    expect(r.detail).toContain('idPlugin matches the context: no');
    expect(d.store.has(KEY)).toBe(false);
  });
  test('P8 counts failed saves in the burst, reports the first error and still passes on the REST facts', async () => {
    const d = deps({ failSetsAfter: 21 });                           // the stamp and 20 saves work, the last 10 fail
    const r = await byId('P8').run(d);
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/30 saves in \d+ ms, failures: 10 \(first error: storage is busy\)/);
    expect(d.store.has(KEY)).toBe(false);
  });
  test('P8 reports a REST failure, still runs the burst and removes its key', async () => {
    const d = deps({ fetchStatus: 500 });
    const r = await byId('P8').run(d);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('HTTP 500');
    expect(r.detail).toMatch(/30 saves in \d+ ms, failures: 0/);
    expect(d.store.has(KEY)).toBe(false);
  });
  test('P8 removes its key when the first save fails', async () => {
    const d = deps({ failSetsAfter: 0 });
    const r = await byId('P8').run(d);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('storage is busy');
    expect(d.store.has(KEY)).toBe(false);
  });
  test('P8 needs a card, and no result ever holds the token', async () => {
    const none = await byId('P8').run(deps({ cards: [] }));
    expect(none).toMatchObject({ status: 'fail', detail: expect.stringContaining('at least one card') });
    for (const o of [{}, { fetchStatus: 500 }, { restPluginId: 'x' }, { pluginId: null }, { failSetsAfter: 3 }] as Opts[]) {
      expect(JSON.stringify(await byId('P8').run(deps(o)))).not.toContain(TOKEN);
    }
  });
  test('P8 is a write check: the page keeps it off until the test board is ticked', async () => {
    expect((await import('../../src/proof/checks')).writeCheckIds).toContain('P8');
  });
});

test('every check resolves to a result even when it throws', async () => {
  for (const c of checks) expect((await c.run(deps({ everythingThrows: true }))).status).toBe('fail');
});
test('no result ever contains the token', async () => {
  const d = deps({ imgLoads: false });
  for (const id of ['P1', 'P3', 'P5', 'P6', 'P7', 'P8']) {
    expect(JSON.stringify(await byId(id).run(d))).not.toContain(TOKEN);
  }
  expect(JSON.stringify(await p3AfterReload(d))).not.toContain(TOKEN);
});
test('no result holds the token even when Trello echoes it in an error', async () => {
  const d = deps();
  d.fetch = (async () => new Response(`bad credentials ${TOKEN}`, { status: 401 })) as typeof fetch;
  for (const id of ['P3', 'P5', 'P6', 'P7', 'P8']) {
    const r = await byId(id).run(d);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  }
});

// P2 polls once a second, so it needs a controllable clock.
describe('P2', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const withClock = (o: Opts = {}) => ({ ...deps(o), now: () => Date.now() });

  test('P2 sees a ping by polling and says render did not fire', async () => {
    const d = withClock();
    const running = byId('P2').run(d);
    await vi.advanceTimersByTimeAsync(2500);
    await writePing(d);
    await vi.advanceTimersByTimeAsync(1000);
    const r = await running;
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/render fired: no, seen after \d+ ms/);
  });
  test('P2 removes the ping afterwards, on success and on timeout', async () => {
    const ok = withClock();
    const running = byId('P2').run(ok);
    await vi.advanceTimersByTimeAsync(1500);
    await writePing(ok);
    await vi.advanceTimersByTimeAsync(1000);
    await running;
    expect(ok.store.has('board|shared|mxping')).toBe(false);

    const late = withClock();
    const waiting = byId('P2').run(late);
    await vi.advanceTimersByTimeAsync(95_000);
    await waiting;
    expect(late.store.has('board|shared|mxping')).toBe(false);
  });
  test('P2 says render fired when render ran before the value was seen', async () => {
    const d = withClock();
    const running = byId('P2').run(d);
    await vi.advanceTimersByTimeAsync(2500);
    await writePing(d);
    for (const cb of d.renderCallbacks) cb();
    await vi.advanceTimersByTimeAsync(1000);
    const r = await running;
    expect(r.detail).toMatch(/render fired: yes, seen after \d+ ms/);
  });
  test('P2 fails when nobody presses Write ping', async () => {
    const d = withClock();
    const running = byId('P2').run(d);
    await vi.advanceTimersByTimeAsync(95_000);
    expect(await running).toMatchObject({
      status: 'fail',
      detail: 'No ping arrived within 90 s. If nobody pressed Write ping in another window during that time, this is not a real result: run P2 again. render fired: no',
    });
  });
});

// P4 uses the browser's sessionStorage, which Node does not have.
describe('P4', () => {
  const session = new Map<string, string>();
  beforeEach(() => {
    session.clear();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => { session.set(k, v); },
      removeItem: (k: string) => { session.delete(k); },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  test('P4 opens the first card and asks to be told what happened', async () => {
    const showCard = vi.fn(async () => undefined);
    const d = deps();
    d.t.showCard = showCard;
    const r = await byId('P4').run(d);
    expect(r.status).toBe('manual');
    expect(showCard).toHaveBeenCalledWith('a');
    expect(session.size).toBe(1);
  });
  test('P4 reports "matrix stayed open" when the same page gets focus back', async () => {
    await byId('P4').run(deps());
    expect(p4Survived()).toMatchObject({ id: 'P4', status: 'manual', detail: expect.stringContaining('matrix stayed open') });
    expect(p4Survived()).toBeNull();
  });
  test('P4 "stayed open" is not overwritten by a later load in the same tab', async () => {
    await byId('P4').run(deps());
    p4Survived();
    expect(session.size).toBe(0);
    expect(p4Closed()).toBeNull();
  });
  test('P4 reports "matrix was closed" when a new page finds the stamp', async () => {
    session.set('mxproof.p4', '123');
    expect(p4Closed()).toMatchObject({ id: 'P4', status: 'manual', detail: expect.stringContaining('matrix was closed') });
    expect(session.size).toBe(0);
    expect(p4Closed()).toBeNull();
  });
});
