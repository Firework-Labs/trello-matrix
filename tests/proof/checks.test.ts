import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { checks, p3AfterReload, p4Closed, p4Survived, writePing } from '../../src/proof/checks';
import type { CheckDeps } from '../../src/proof/checks';

const TOKEN = 'secret-token-123';

interface Opts {
  cards?: { id: string }[];
  setRejects?: string;
  imgLoads?: boolean;
  fetchStatus?: number;
  everythingThrows?: boolean;
  authorized?: boolean;
  coverUrl?: string;
}
interface Call { method: string; url: string; headers: Record<string, string>; body: unknown }
type Fake = CheckDeps & { store: Map<string, unknown>; renderCallbacks: (() => void)[]; calls: Call[]; order: string[] };

function deps(o: Opts = {}): Fake {
  const store = new Map<string, unknown>();
  const renderCallbacks: (() => void)[] = [];
  const calls: Call[] = [];
  const order: string[] = [];   // which Trello client calls happened, in order
  let authorized = o.authorized ?? true;
  const boom = (): never => { throw new Error('boom'); };
  const cards = o.cards ?? [{ id: 'a' }, { id: 'b' }];
  const t = {
    get: async (scope: string, vis: string, key: string) => { order.push('get'); return o.everythingThrows ? boom() : store.get(`${scope}|${vis}|${key}`); },
    set: async (scope: string, vis: string, key: string, value: unknown) => {
      order.push('set');
      if (o.everythingThrows) boom();
      if (o.setRejects) throw new Error(o.setRejects);
      store.set(`${scope}|${vis}|${key}`, value);
    },
    remove: async (scope: string, vis: string, key: string) => { store.delete(`${scope}|${vis}|${key}`); },
    cards: async () => (o.everythingThrows ? boom() : cards),
    lists: async () => (o.everythingThrows ? boom() : [{ id: 'l1', cards: [{ id: 'a' }] }]),
    board: async () => (o.everythingThrows ? boom() : { id: 'board1' }),
    render: (fn: () => void) => { if (o.everythingThrows) boom(); renderCallbacks.push(fn); },
    showCard: async () => (o.everythingThrows ? boom() : undefined),
    getRestApi: () => {
      if (o.everythingThrows) boom();
      return {
        isAuthorized: async () => { order.push('isAuthorized'); return authorized; },
        authorize: async () => { order.push('authorize'); authorized = true; return TOKEN; },
        getToken: async () => (authorized ? TOKEN : null),
        clearToken: async () => { authorized = false; },
      };
    },
  } as unknown as TrelloIframe;

  let optionText = 'One';
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (o.everythingThrows) throw new TypeError('network down');
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string>, body });
    const status = o.fetchStatus ?? 200;
    const path = new URL(url).pathname;
    let json: unknown = {};
    if (method === 'POST' && path === '/1/customFields') {
      json = { id: 'f1', options: [{ id: 'o1', value: { text: 'One' } }, { id: 'o2', value: { text: 'Two' } }] };
    } else if (method === 'PUT' && path === '/1/customFields/f1/options/o1') {
      optionText = body.value.text;
      json = { id: 'o1', value: { text: optionText } };
    } else if (method === 'GET' && path === '/1/customFields/f1/options/o1') {
      json = { id: 'o1', value: { text: optionText } };
    } else if (path === '/1/boards/board1/cards') {
      json = [{ id: 'a', cover: {} }, { id: 'b', cover: { scaled: [{ url: 'https://img.example/small.png' }, { url: o.coverUrl ?? 'https://img.example/big.png' }] } }];
    } else if (path.startsWith('/1/cards/')) {
      const pos = new URL(url).searchParams.get('pos');
      json = { id: 'a', pos: pos === 'top' ? 1 : pos === 'bottom' ? 9999 : pos ? Number(pos) : 2048 };
    }
    return new Response(JSON.stringify(json), { status, headers: { 'x-rate-limit-api-token-remaining': '70' } });
  }) as typeof fetch;

  let tick = 0;
  return {
    t, fetch: fakeFetch, key: 'KEY', now: () => (tick += 10), store, renderCallbacks, calls, order,
    loadImage: async () => o.imgLoads ?? true,
  };
}

const byId = (id: string) => {
  const c = checks.find(x => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
};

test('there are seven checks, P1 to P7, in order', () => {
  expect(checks.map(c => c.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
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

test('P3 asks for a reload after authorising, and does not claim a pass yet', async () => {
  const d = deps({ authorized: false });
  const r = await byId('P3').run(d);
  expect(r).toMatchObject({ status: 'manual', detail: expect.stringContaining('authorised now: yes') });
});
test('P3 after reload passes when the saved marker is there and the token is still good', async () => {
  const d = deps({ authorized: false });
  await byId('P3').run(d);
  expect(await p3AfterReload(d)).toMatchObject({ id: 'P3', status: 'pass' });
});
test('P3 calls authorize first, before anything is awaited, and even when a token exists', async () => {
  const d = deps({ authorized: true });
  await byId('P3').run(d);
  expect(d.order[0]).toBe('authorize');
});
test('P3 after reload reports once, then clears its marker', async () => {
  const d = deps({ authorized: false });
  await byId('P3').run(d);
  expect(await p3AfterReload(d)).toMatchObject({ id: 'P3', status: 'pass', detail: 'authorised after reload: yes' });
  expect(d.store.has('member|private|mxproofAuth')).toBe(false);
  expect(await p3AfterReload(d)).toBeNull();
});
test('P3 after reload ignores a marker left by another browser, and leaves it alone', async () => {
  const d = deps();
  d.store.set('member|private|mxproofAuth', { ua: 'Some Other Browser', at: 1 });
  expect(await p3AfterReload(d)).toBeNull();
  expect(d.store.has('member|private|mxproofAuth')).toBe(true);
});
test('P3 after reload says nothing when authorisation was never tried', async () => {
  expect(await p3AfterReload(deps())).toBeNull();
});
test('P3 after reload fails when the token is gone', async () => {
  const d = deps({ authorized: false });
  await byId('P3').run(d);
  await d.t.getRestApi().clearToken();
  expect(await p3AfterReload(d)).toMatchObject({ id: 'P3', status: 'fail' });
});

test('P5 reports which image method worked', async () => {
  const r = await byId('P5').run(deps({ imgLoads: false, fetchStatus: 200 }));
  expect(r).toMatchObject({ status: 'pass', detail: expect.stringContaining('fetch') });
});
test('P5 prefers img when it loads', async () => {
  const r = await byId('P5').run(deps({ imgLoads: true }));
  expect(r).toMatchObject({ status: 'pass', detail: expect.stringMatching(/^img/) });
});
test('P5 fetches a Trello-hosted image with the OAuth header', async () => {
  const url = 'https://trello.com/1/cards/b/attachments/x/download/big.png';
  const d = deps({ imgLoads: false, coverUrl: url });
  await byId('P5').run(d);
  const imageCall = d.calls.find(c => c.url === url);
  expect(imageCall?.headers.Authorization).toBe(`OAuth oauth_consumer_key="KEY", oauth_token="${TOKEN}"`);
});
test('P5 does not send the Authorization header to a host that is not Trello', async () => {
  const d = deps({ imgLoads: false, coverUrl: 'https://images.unsplash.com/photo.jpg' });
  const r = await byId('P5').run(d);
  const imageCall = d.calls.find(c => c.url === 'https://images.unsplash.com/photo.jpg');
  expect(imageCall).toBeDefined();
  expect(imageCall?.headers.Authorization).toBeUndefined();
  expect(r.detail).toContain('without the Authorization header');
});
test('P5 does not treat a look-alike host as Trello', async () => {
  const d = deps({ imgLoads: false, coverUrl: 'https://trello.com.evil.example/x.png' });
  await byId('P5').run(d);
  expect(d.calls.find(c => c.url.startsWith('https://trello.com.evil'))?.headers.Authorization).toBeUndefined();
});
test('P5 sends the header to a subdomain of trello.com', async () => {
  const d = deps({ imgLoads: false, coverUrl: 'https://trello-attachments.trello.com/x.png' });
  await byId('P5').run(d);
  expect(d.calls.find(c => c.url.startsWith('https://trello-attachments.trello.com'))?.headers.Authorization).toContain('oauth_token');
});
test('P5 fails when neither method works', async () => {
  const r = await byId('P5').run(deps({ imgLoads: false, fetchStatus: 401 }));
  expect(r.status).toBe('fail');
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

test('every check resolves to a result even when it throws', async () => {
  for (const c of checks) expect((await c.run(deps({ everythingThrows: true }))).status).toBe('fail');
});
test('no result ever contains the token', async () => {
  const d = deps({ imgLoads: false });
  for (const id of ['P1', 'P3', 'P5', 'P6', 'P7']) {
    expect(JSON.stringify(await byId(id).run(d))).not.toContain(TOKEN);
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
    expect(await running).toMatchObject({ status: 'fail', detail: expect.stringContaining('no ping') });
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
