import { afterEach, describe, expect, test, vi } from 'vitest';
import { REST_BASE, createRest } from '../../src/trello/rest';
import type { Pacer } from '../../src/model/pacer';
import type { TrelloAuth } from '../../src/trello/auth';

const TOKEN = 'TOKEN';

interface Recorded {
  method: string; url: string; path: string; query: Record<string, string>;
  headers: Record<string, string>; body: unknown;
}
interface Opts {
  statuses?: number[]; bodies?: unknown[]; token?: string | null; throws?: boolean;
  tokens?: (string | null)[]; pacer?: Pacer; baseUrl?: string;
  fetchImpl?: typeof fetch; timers?: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (h: unknown) => void };
}

/** A rest client over a fake fetch. Answers come from `statuses` and `bodies`, one per request, in order; a request past the end of `statuses` gets 200 and past the end of `bodies` gets `{}`. */
function restWithFake(o: Opts = {}) {
  const requests: Recorded[] = [];
  const slept: number[] = [];
  let tokenCalls = 0;
  const auth: TrelloAuth = {
    authorize: async () => {},
    isAuthorized: async () => true,
    accessToken: async () => {
      const i = tokenCalls++;
      if (o.tokens) return o.tokens[Math.min(i, o.tokens.length - 1)] ?? null;
      return o.token === undefined ? TOKEN : o.token;
    },
  };
  const fakeFetch = (async (input: unknown, init?: RequestInit) => {
    if (o.throws) throw new TypeError(`network down for ${String(input)} with ${TOKEN}`);
    const url = new URL(String(input));
    const n = requests.length;
    requests.push({
      method: init?.method ?? 'GET', url: String(input), path: url.pathname,
      query: Object.fromEntries(url.searchParams), headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const status = o.statuses?.[n] ?? 200;
    const body = o.bodies && n < o.bodies.length ? o.bodies[n] : {};
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  const pacer: Pacer = o.pacer ?? { run: fn => fn() };
  const rest = createRest({ auth, fetch: o.fetchImpl ?? fakeFetch, pacer, sleep: async ms => { slept.push(ms); }, baseUrl: o.baseUrl, ...o.timers });
  return { rest, requests, slept, tokenCalls: () => tokenCalls };
}

const opt = (id: string, text: string, color = 'none') => ({ id, value: { text }, color });

describe('setFieldOption', () => {
  test('sets and clears with the bodies Trello accepted in the live check', async () => {
    const { rest, requests } = restWithFake();
    await rest.setFieldOption('card1', 'f1', 'opt1');
    await rest.setFieldOption('card1', 'f1', null);
    expect(requests[0]).toMatchObject({ method: 'PUT', path: '/1/cards/card1/customField/f1/item', body: { idValue: 'opt1' } });
    expect(requests[1]!.body).toEqual({ idValue: '', value: '' });
    expect(requests[0]!.headers.Authorization).toBe('Bearer TOKEN');
    expect(requests[0]!.headers['Content-Type']).toBe('application/json');
    expect(requests[0]!.url.startsWith('https://api.trello.com/')).toBe(true);
  });
  test('REST_BASE is the host the live check settled on', () => {
    expect(REST_BASE).toBe('https://api.trello.com');
  });
});

describe('setCardPos', () => {
  test('puts the number in the query', async () => {
    const { rest, requests } = restWithFake();
    await rest.setCardPos('c1', 32768);
    expect(requests[0]).toMatchObject({ method: 'PUT', path: '/1/cards/c1', query: { pos: '32768' } });
    expect(requests[0]!.body).toBeUndefined();
    expect(requests[0]!.headers['Content-Type']).toBeUndefined();
    expect(requests[0]!.headers.Authorization).toBe('Bearer TOKEN');
  });
  test('keeps a fractional position exactly', async () => {
    const { rest, requests } = restWithFake();
    await rest.setCardPos('c1', 65536.5);
    expect(requests[0]!.query.pos).toBe('65536.5');
  });
  test('escapes ids in the path', async () => {
    const { rest, requests } = restWithFake();
    await rest.setCardPos('a/b?c', 1);
    expect(requests[0]!.path).toBe('/1/cards/a%2Fb%3Fc');
    expect(requests[0]!.query).toEqual({ pos: '1' });
  });
  test('a different base address is used when given', async () => {
    const { rest, requests } = restWithFake({ baseUrl: 'https://trello.com' });
    await rest.setCardPos('c1', 1);
    expect(requests[0]!.url.startsWith('https://trello.com/1/cards/c1')).toBe(true);
  });
});

describe('createDropdownField', () => {
  const full = { id: 'f9', name: 'Value', options: [opt('o1', 'Low'), opt('o2', 'High')] };

  test('posts a list field shown on card fronts and returns its options in order', async () => {
    const { rest, requests } = restWithFake({ bodies: [full] });
    const field = await rest.createDropdownField('board1', 'Value', ['Low', 'High']);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST', path: '/1/customFields',
      body: {
        idModel: 'board1', modelType: 'board', name: 'Value', type: 'list', pos: 'bottom', display_cardFront: true,
        options: [{ value: { text: 'Low' }, color: 'none', pos: 'bottom' }, { value: { text: 'High' }, color: 'none', pos: 'bottom' }],
      },
    });
    expect(requests[0]!.headers['Content-Type']).toBe('application/json');
    expect(field).toEqual({ id: 'f9', name: 'Value', options: [{ id: 'o1', text: 'Low', colour: 'none' }, { id: 'o2', text: 'High', colour: 'none' }] });
  });
  test('puts the options in the order given even when the answer lists them in another order', async () => {
    const { rest } = restWithFake({ bodies: [{ ...full, options: [opt('o2', 'High'), opt('o1', 'Low')] }] });
    const field = await rest.createDropdownField('b', 'Value', ['Low', 'High']);
    expect(field.options.map(o => o.id)).toEqual(['o1', 'o2']);
  });
  test('carries the colour Trello reports, and uses none when it says nothing', async () => {
    const { rest } = restWithFake({ bodies: [{ id: 'f9', name: 'V', options: [opt('o1', 'a', 'red'), { id: 'o2', value: { text: 'b' } }] }] });
    const field = await rest.createDropdownField('b', 'V', ['a', 'b']);
    expect(field.options.map(o => o.colour)).toEqual(['red', 'none']);
  });
  test('falls back to the name sent when the answer has none', async () => {
    const { rest } = restWithFake({ bodies: [{ id: 'f9', options: full.options }] });
    expect((await rest.createDropdownField('b', 'Sent name', ['Low', 'High'])).name).toBe('Sent name');
  });
  test('reads the options separately when the answer has none', async () => {
    const { rest, requests } = restWithFake({ bodies: [{ id: 'f9', name: 'Value' }, [opt('o1', 'Low'), opt('o2', 'High')]] });
    const field = await rest.createDropdownField('board1', 'Value', ['Low', 'High']);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ method: 'GET', path: '/1/customFields/f9/options' });
    expect(requests[1]!.body).toBeUndefined();
    expect(requests[1]!.headers.Authorization).toBe('Bearer TOKEN');
    expect(field).toEqual({ id: 'f9', name: 'Value', options: [{ id: 'o1', text: 'Low', colour: 'none' }, { id: 'o2', text: 'High', colour: 'none' }] });
  });
  test('reads the options separately when those in the answer are unusable', async () => {
    const { rest, requests } = restWithFake({ bodies: [{ id: 'f9', name: 'Value', options: [{ nope: 1 }, 'x'] }, [opt('o1', 'Low'), opt('o2', 'High')]] });
    const field = await rest.createDropdownField('b', 'Value', ['Low', 'High']);
    expect(requests[1]).toMatchObject({ method: 'GET', path: '/1/customFields/f9/options' });
    expect(field.options.map(o => o.id)).toEqual(['o1', 'o2']);
  });
  test('rejects clearly when the options cannot be matched', async () => {
    const { rest, requests } = restWithFake({ bodies: [{ id: 'f9', name: 'Value' }, []] });
    await expect(rest.createDropdownField('b', 'Value', ['Low', 'High'])).rejects.toMatchObject({
      kind: 'network', message: 'Trello created the field but did not say what its options are. Link it from the dialog instead.',
    });
    expect(requests).toHaveLength(2);
  });
  test('rejects the same way when the texts in the answer are not the ones sent', async () => {
    const { rest } = restWithFake({ bodies: [{ id: 'f9', name: 'V', options: [opt('o1', 'Low'), opt('o2', 'Other')] }, [opt('o1', 'Low'), opt('o2', 'Other')]] });
    await expect(rest.createDropdownField('b', 'V', ['Low', 'High'])).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('Link it') });
  });
  test('rejects the same way when the answer has no field id, without a second request', async () => {
    const { rest, requests } = restWithFake({ bodies: [{ name: 'Value', options: [] }] });
    await expect(rest.createDropdownField('b', 'Value', ['Low', 'High'])).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('Link it') });
    expect(requests).toHaveLength(1);
  });
  test('rejects the same way when the follow-up read fails, since the field now exists', async () => {
    const { rest } = restWithFake({ statuses: [200, 500], bodies: [{ id: 'f9', name: 'V' }] });
    await expect(rest.createDropdownField('b', 'V', ['Low', 'High'])).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('Link it') });
  });
  test('an answer that is not JSON counts as having no options', async () => {
    const { rest } = restWithFake({ bodies: ['<html>', 'also not json'] });
    await expect(rest.createDropdownField('b', 'V', ['Low', 'High'])).rejects.toMatchObject({ kind: 'network' });
  });
  test('texts that repeat are matched one option each', async () => {
    const { rest } = restWithFake({ bodies: [{ id: 'f9', name: 'V', options: [opt('o1', 'Same'), opt('o2', 'Same')] }] });
    const field = await rest.createDropdownField('b', 'V', ['Same', 'Same']);
    expect(field.options.map(o => o.id)).toEqual(['o1', 'o2']);
  });
});

describe('the token', () => {
  test('no request carries a key or token in its address', async () => {
    const { rest, requests } = restWithFake({ bodies: [{ id: 'f9', name: 'V', options: [opt('o1', 'a'), opt('o2', 'b')] }] });
    await rest.createDropdownField('b', 'V', ['a', 'b']);
    await rest.setFieldOption('c', 'f9', 'o1');
    await rest.setCardPos('c', 5);
    expect(requests).toHaveLength(3);
    for (const r of requests) {
      expect(r.query).not.toHaveProperty('key');
      expect(r.query).not.toHaveProperty('token');
      expect(r.url).not.toContain('TOKEN');
      expect(r.url).not.toMatch(/[?&](key|token)=/);
    }
  });
  test('a token is fetched for every request, and none means nothing is sent', async () => {
    const a = restWithFake({ token: null });
    await expect(a.rest.setCardPos('c', 1)).rejects.toMatchObject({ kind: 'auth', message: 'Not signed in to Trello.' });
    expect(a.requests).toHaveLength(0);
    await expect(a.rest.setFieldOption('c', 'f', 'o')).rejects.toMatchObject({ kind: 'auth' });
    await expect(a.rest.createDropdownField('b', 'V', ['a', 'b'])).rejects.toMatchObject({ kind: 'auth' });
    expect(a.requests).toHaveLength(0);
  });
  test('a token renewed between calls is the one sent', async () => {
    const a = restWithFake({ tokens: ['OLD', 'NEW'] });
    await a.rest.setCardPos('c', 1);
    await a.rest.setCardPos('c', 2);
    expect(a.requests.map(r => r.headers.Authorization)).toEqual(['Bearer OLD', 'Bearer NEW']);
    expect(a.tokenCalls()).toBe(2);
  });
  test('each retry fetches the token again', async () => {
    const a = restWithFake({ statuses: [429, 200], tokens: ['OLD', 'NEW'] });
    await a.rest.setCardPos('c', 1);
    expect(a.requests.map(r => r.headers.Authorization)).toEqual(['Bearer OLD', 'Bearer NEW']);
  });
  test('a token that cannot be read is an auth error and nothing is sent', async () => {
    const requests: unknown[] = [];
    const rest = createRest({
      auth: { authorize: async () => {}, isAuthorized: async () => false, accessToken: async () => { throw new Error('boom'); } },
      fetch: (async () => { requests.push(1); return new Response('{}'); }) as typeof fetch,
      pacer: { run: fn => fn() }, sleep: async () => {},
    });
    await expect(rest.setCardPos('c', 1)).rejects.toMatchObject({ kind: 'auth', message: 'Not signed in to Trello.' });
    expect(requests).toHaveLength(0);
  });
  test('the Bearer header is not sent to a host that is not Trello', async () => {
    const a = restWithFake({ baseUrl: 'https://example.com' });
    await a.rest.setCardPos('c', 1);
    expect(a.requests[0]!.headers.Authorization).toBeUndefined();
  });
  test('the token never appears in an error message, even when Trello echoes it', async () => {
    const a = restWithFake({ statuses: [500], bodies: [`oops ${TOKEN} oops`] });
    const e = await a.rest.setCardPos('c', 1).catch((x: unknown) => x as Error);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).not.toContain(TOKEN);
    expect(String((e as Error).stack)).not.toContain(TOKEN);
    for (const status of [401, 403, 409, 429]) {
      const r = restWithFake({ statuses: [status, status, status, status], bodies: Array(4).fill(`echo ${TOKEN}`) });
      const err = await r.rest.setCardPos('c', 1).catch((x: unknown) => x as Error);
      expect((err as Error).message).not.toContain(TOKEN);
    }
    const t = restWithFake({ throws: true });
    const te = await t.rest.setCardPos('c', 1).catch((x: unknown) => x as Error);
    expect((te as Error).message).not.toContain(TOKEN);
    expect(String((te as Error & { cause?: unknown }).cause ?? '')).not.toContain(TOKEN);
  });
});

describe('answers', () => {
  test('answers map to store errors', async () => {
    await expect(restWithFake({ statuses: [401] }).rest.setCardPos('c', 1)).rejects.toMatchObject({ kind: 'auth' });
    await expect(restWithFake({ statuses: [403], bodies: ['missing scopes'] }).rest.setCardPos('c', 1)).rejects.toMatchObject({ kind: 'permission', message: 'Trello does not allow this with the current sign-in.' });
    await expect(restWithFake({ statuses: [403], bodies: ['unauthorized'] }).rest.setCardPos('c', 1)).rejects.toMatchObject({ kind: 'permission', message: 'You are not allowed to change this board.' });
    await expect(restWithFake({ statuses: [409], bodies: [{ error: 'CUSTOM_FIELD_DUPLICATE_FIELD' }] }).rest.createDropdownField('b', 'V', ['a', 'b'])).rejects.toMatchObject({ kind: 'invalid', message: 'A field with that name already exists on the board.' });
    await expect(restWithFake({ statuses: [500] }).rest.setCardPos('c', 1)).rejects.toMatchObject({ kind: 'network', message: 'Trello answered 500.' });
    await expect(restWithFake({ throws: true }).rest.setCardPos('c', 1)).rejects.toMatchObject({ kind: 'network', message: 'Could not reach Trello.' });
  });
  test('each message is the one the spec gives', async () => {
    await expect(restWithFake({ statuses: [401] }).rest.setCardPos('c', 1)).rejects.toThrow('Trello sign-in has expired. Connect again.');
    await expect(restWithFake({ statuses: [429, 429, 429, 429] }).rest.setCardPos('c', 1)).rejects.toThrow('Trello is limiting requests. Try again in a minute.');
  });
  test('a 403 whose body is a JSON object that mentions missing scopes is a sign-in problem', async () => {
    await expect(restWithFake({ statuses: [403], bodies: [{ message: 'missing scopes', error: 'x' }] }).rest.setCardPos('c', 1))
      .rejects.toMatchObject({ kind: 'permission', message: 'Trello does not allow this with the current sign-in.' });
  });
  test('a 403 with no body is the board permission message', async () => {
    await expect(restWithFake({ statuses: [403], bodies: [''] }).rest.setCardPos('c', 1))
      .rejects.toMatchObject({ kind: 'permission', message: 'You are not allowed to change this board.' });
  });
  test('a 409 that is not a duplicate field is a generic network error', async () => {
    await expect(restWithFake({ statuses: [409], bodies: ['conflict'] }).rest.setCardPos('c', 1))
      .rejects.toMatchObject({ kind: 'network', message: 'Trello answered 409.' });
  });
  test('other statuses (400, 404) are generic network errors that name the status', async () => {
    await expect(restWithFake({ statuses: [404] }).rest.setCardPos('c', 1)).rejects.toMatchObject({ kind: 'network', message: 'Trello answered 404.' });
    await expect(restWithFake({ statuses: [400] }).rest.setFieldOption('c', 'f', 'o')).rejects.toMatchObject({ kind: 'network', message: 'Trello answered 400.' });
  });
  test('the errors are StoreErrors', async () => {
    const e = await restWithFake({ statuses: [401] }).rest.setCardPos('c', 1).catch((x: unknown) => x);
    expect((e as Error).name).toBe('StoreError');
  });
  test('an error is not retried, apart from 429', async () => {
    const a = restWithFake({ statuses: [500, 200] });
    await expect(a.rest.setCardPos('c', 1)).rejects.toBeDefined();
    expect(a.requests).toHaveLength(1);
    expect(a.slept).toEqual([]);
  });
  test('429 waits 10 s and retries, three times at most', async () => {
    const a = restWithFake({ statuses: [429, 429, 200] });
    await a.rest.setCardPos('c', 1);
    expect(a.requests).toHaveLength(3);
    expect(a.slept).toEqual([10000, 10000]);
    const b = restWithFake({ statuses: [429, 429, 429, 429] });
    await expect(b.rest.setCardPos('c', 1)).rejects.toMatchObject({ kind: 'rate-limit' });
    expect(b.requests).toHaveLength(4);
    expect(b.slept).toEqual([10000, 10000, 10000]);
  });
  test('a retry sends the same request again, body included', async () => {
    const a = restWithFake({ statuses: [429, 200] });
    await a.rest.setFieldOption('card1', 'f1', 'opt1');
    expect(a.requests).toHaveLength(2);
    expect(a.requests[1]).toEqual(a.requests[0]);
  });
});

describe('the pacer', () => {
  test('every request goes through the pacer', async () => {
    let runs = 0;
    const pacer: Pacer = { run: fn => { runs++; return fn(); } };
    const a = restWithFake({ pacer, statuses: [429, 200, 200, 200], bodies: [{}, {}, {}, { id: 'f9', name: 'V', options: [opt('o1', 'a'), opt('o2', 'b')] }] });
    await a.rest.setCardPos('c', 1);                   // 429 then 200: two requests
    expect(runs).toBe(2);
    await a.rest.setFieldOption('c', 'f', 'o');
    expect(runs).toBe(3);
    await a.rest.createDropdownField('b', 'V', ['a', 'b']);
    expect(runs).toBe(4);
    expect(a.requests).toHaveLength(4);
  });
  test('nothing is sent until the pacer lets the request run', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const pacer: Pacer = { run: async fn => { await gate; return fn(); } };
    const a = restWithFake({ pacer });
    const done = a.rest.setCardPos('c', 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(a.requests).toHaveLength(0);
    release();
    await done;
    expect(a.requests).toHaveLength(1);
  });
  test('a request that the pacer rejects rejects the call', async () => {
    const pacer: Pacer = { run: async () => { throw new Error('queue broken'); } };
    await expect(restWithFake({ pacer }).rest.setCardPos('c', 1)).rejects.toThrow('queue broken');
  });
});

describe('the timeout', () => {
  afterEach(() => { vi.useRealTimers(); });

  /** A fetch that never answers; it records the signal it was given. */
  function hangingFetch() {
    const signals: AbortSignal[] = [];
    const fetchImpl = ((_input: unknown, init?: RequestInit) => {
      signals.push(init!.signal!);
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    return { fetchImpl, signals };
  }

  test('a fetch that never settles rejects after 20 s, and the signal it was given is aborted', async () => {
    vi.useFakeTimers();
    const { fetchImpl, signals } = hangingFetch();
    const a = restWithFake({ fetchImpl });
    const result = a.rest.setCardPos('c', 1).catch((e: unknown) => e as Error);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const e = await result;
    expect(e).toMatchObject({ name: 'StoreError', kind: 'network', message: 'Trello did not answer in time.' });
    expect(signals[0]!.aborted).toBe(true);
  });
  test('a body that never finishes arriving times out too', async () => {
    vi.useFakeTimers();
    const fetchImpl = (async () => ({ ok: true, status: 200, text: () => new Promise<string>(() => {}) }) as unknown as Response) as typeof fetch;
    const result = restWithFake({ fetchImpl }).rest.setCardPos('c', 1).catch((e: unknown) => e as Error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toMatchObject({ kind: 'network', message: 'Trello did not answer in time.' });
  });
  test('a fetch that answers in time is not aborted and its timer is cleared', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchImpl = (async (_i: unknown, init?: RequestInit) => { signals.push(init!.signal!); return new Response('{}'); }) as typeof fetch;
    await restWithFake({ fetchImpl }).rest.setCardPos('c', 1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signals[0]!.aborted).toBe(false);
  });
  test('a request that fails quickly clears its timer as well', async () => {
    vi.useFakeTimers();
    await expect(restWithFake({ statuses: [500] }).rest.setCardPos('c', 1)).rejects.toMatchObject({ message: 'Trello answered 500.' });
    await expect(restWithFake({ throws: true }).rest.setCardPos('c', 1)).rejects.toMatchObject({ message: 'Could not reach Trello.' });
    expect(vi.getTimerCount()).toBe(0);
  });
  test('a timeout is not retried', async () => {
    vi.useFakeTimers();
    const { fetchImpl, signals } = hangingFetch();
    const a = restWithFake({ fetchImpl });
    const result = a.rest.setCardPos('c', 1).catch((e: unknown) => e as Error);
    await vi.advanceTimersByTimeAsync(20_000);
    await result;
    await vi.advanceTimersByTimeAsync(100_000);
    expect(signals).toHaveLength(1);
    expect(a.slept).toEqual([]);
  });
  test('each retry after a 429 gets its own 20 s', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    let n = 0;
    const fetchImpl = ((_i: unknown, init?: RequestInit) => {
      signals.push(init!.signal!);
      return n++ === 0 ? Promise.resolve(new Response('', { status: 429 })) : new Promise<Response>(() => {});
    }) as typeof fetch;
    const result = restWithFake({ fetchImpl }).rest.setCardPos('c', 1).catch((e: unknown) => e as Error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toMatchObject({ message: 'Trello did not answer in time.' });
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(false);
    expect(signals[1]!.aborted).toBe(true);
  });
  test('the setTimeout and clearTimeout passed in are the ones used', async () => {
    const started: { fn: () => void; ms: number; handle: object }[] = [];
    const cleared: unknown[] = [];
    const timers = {
      setTimeout: (fn: () => void, ms: number) => { const handle = {}; started.push({ fn, ms, handle }); return handle; },
      clearTimeout: (h: unknown) => { cleared.push(h); },
    };
    const a = restWithFake({ timers });
    await a.rest.setCardPos('c', 1);
    expect(started.map(s => s.ms)).toEqual([20_000]);
    expect(cleared).toEqual([started[0]!.handle]);
    const b = restWithFake({ timers, fetchImpl: hangingFetch().fetchImpl });
    const result = b.rest.setCardPos('c', 1).catch((e: unknown) => e as Error);
    await Promise.resolve();
    await vi.waitFor(() => expect(started).toHaveLength(2));
    started[1]!.fn();
    expect(await result).toMatchObject({ kind: 'network', message: 'Trello did not answer in time.' });
    expect(cleared).toHaveLength(2);
  });
});
