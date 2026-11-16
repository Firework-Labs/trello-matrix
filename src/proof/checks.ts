// The live checks from spec section 10. Each check takes everything it touches
// (`t`, `auth`, `fetch`, `host`, `now`) as arguments, so the unit tests use fakes and
// nothing here contacts Trello unless the proof page passes it the real ones.
// No result may ever contain the access token.
import { authHeaders } from '../trello/auth';
import type { TrelloAuth } from '../trello/auth';

export interface CheckResult { id: string; title: string; status: 'pass' | 'fail' | 'manual'; detail: string; ms?: number }
/** The two addresses P3 tries. The documentation does not say which one accepts an OAuth 2.0 token. */
export type RestHost = 'https://api.trello.com' | 'https://trello.com';
/** Where the host P3 found is kept (the proof page keeps it with the saved results, in the tab). */
export interface RestHostStore { get(): RestHost; set(host: RestHost): void }
export interface CheckDeps {
  t: TrelloIframe;
  auth: TrelloAuth;
  fetch: typeof fetch;
  host: RestHostStore;
  now: () => number;
  /** Tries an <img> with this address. Defaults to a real image element. */
  loadImage?: (url: string) => Promise<boolean>;
}
interface Check { id: string; title: string; needsClick: boolean; run(d: CheckDeps): Promise<CheckResult> }
type Outcome = Pick<CheckResult, 'status' | 'detail'>;

const HOSTS: readonly RestHost[] = ['https://api.trello.com', 'https://trello.com'];
const NOT_SIGNED_IN = 'Not signed in. Run P3 first.';
const P2_TIMEOUT_MS = 90_000;
const P2_POLL_MS = 1000;
const IMAGE_TIMEOUT_MS = 10_000;
const BURST = 30;
const RESTORE_ATTEMPTS = 3;
const RESTORE_PAUSE_MS = 3000;
const P4_KEY = 'mxproof.p4';
const P8_KEY = 'mxproof8';
const RENAMED = 'Renamed';

/** Ids of the checks that write to the board; the page keeps them off until "This is a test board" is ticked. */
export const writeCheckIds: readonly string[] = ['P1', 'P6', 'P7', 'P8'];

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  try { return JSON.stringify(e); } catch { return String(e); }
}

class NotSignedIn extends Error {
  constructor() { super(NOT_SIGNED_IN); }
}

/** `usesRest` checks say in their detail which REST host they used. */
function check(id: string, title: string, needsClick: boolean, fn: (d: CheckDeps) => Promise<Outcome>, usesRest = false): Check {
  return {
    id, title, needsClick,
    async run(d) {
      const started = d.now();
      const hostNote = () => (usesRest ? ` (REST host: ${d.host.get()})` : '');
      try {
        const outcome = await fn(d);
        return { id, title, ...outcome, detail: outcome.detail + hostNote(), ms: d.now() - started };
      } catch (e) {
        const detail = e instanceof NotSignedIn ? e.message : errorText(e) + hostNote();
        return { id, title, status: 'fail', detail, ms: d.now() - started };
      }
    },
  };
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ---- REST helpers (Bearer header; the token never leaves these) ----------------

async function token(d: CheckDeps): Promise<string> {
  const value = await d.auth.accessToken();
  if (!value) throw new NotSignedIn();
  return value;
}
function rest(d: CheckDeps, tok: string, method: string, path: string, body?: unknown): Promise<Response> {
  const url = `${d.host.get()}${path}`;
  const headers: Record<string, string> = authHeaders(url, tok);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return d.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
/** "HTTP 401 unauthorized permission requested": the status and the start of Trello's error text, never the token. */
async function refusal(r: Response, tok: string): Promise<string> {
  const text = (await r.text().catch(() => '')).split(tok).join('[token]').slice(0, 200);
  return `HTTP ${r.status}${text ? ` ${text}` : ''}`;
}
async function mustBeOk(r: Response, what: string, tok: string): Promise<Response> {
  if (r.ok) return r;
  throw new Error(`${what}: ${await refusal(r, tok)}`);
}

// ---- P1: storage on another card id ------------------------------------------

const p1 = check('P1', 'Read and write shared storage on any card by id', false, async d => {
  const cards = await d.t.cards('id');
  const [first, second] = cards;
  if (!first || !second) return { status: 'fail', detail: 'The board needs at least two cards.' };
  const stamp = `p1-${d.now()}`;
  const ids = [first.id, second.id];
  try {
    for (const id of ids) await d.t.set(id, 'shared', 'mxproof', stamp);
    const back = await Promise.all(ids.map(id => d.t.get(id, 'shared', 'mxproof')));
    const bad = ids.filter((_, i) => back[i] !== stamp);
    if (bad.length) return { status: 'fail', detail: `Wrote ${stamp} but read back something else on ${bad.join(', ')}.` };
    return { status: 'pass', detail: `Wrote and read back on two cards (${ids.join(', ')}).` };
  } finally {
    for (const id of ids) await d.t.remove(id, 'shared', 'mxproof').catch(() => undefined);
  }
});

// ---- P2: does a change by someone else arrive without a reload ---------------

const PING = ['board', 'shared', 'mxping'] as const;

/** Person B's button. Writes the writer's clock so person A can work out the delay. */
export async function writePing(d: Pick<CheckDeps, 't' | 'now'>): Promise<void> {
  await d.t.set(PING[0], PING[1], PING[2], d.now());
}

const p2 = check('P2', 'A change by another person arrives without a reload', true, async d => {
  const started = d.now();
  let armed = false;
  let renderFired = false;
  let seenAfter: number | null = null;
  let baseline: unknown;
  const look = async () => {
    if (seenAfter !== null) return;
    const value = await d.t.get(...PING);
    if (value !== undefined && value !== baseline) seenAfter = d.now() - Number(value);
  };
  d.t.render(() => {
    if (!armed || seenAfter !== null) return;
    renderFired = true;
    void look().catch(() => undefined);
  });
  try {
    baseline = await d.t.get(...PING);
    armed = true;
    while (seenAfter === null && d.now() - started < P2_TIMEOUT_MS) {
      await sleep(P2_POLL_MS);
      await look();
    }
  } finally {
    armed = false;
    await d.t.remove(...PING).catch(() => undefined); // leave nothing behind in the board's Power-Up data
  }
  if (seenAfter === null) return { status: 'fail', detail: `no ping seen within ${P2_TIMEOUT_MS / 1000} s. render fired: ${renderFired ? 'yes' : 'no'}` };
  return { status: 'pass', detail: `render fired: ${renderFired ? 'yes' : 'no'}, seen after ${seenAfter} ms (the two computers' clocks may differ by a second or two)` };
});

// ---- P3: sign in, which REST host accepts the token, and whether it survives a reload

const P3_MARKER = ['member', 'private', 'mxproofAuth'] as const;
const P3_TITLE = 'Sign in with Trello (OAuth 2.0)';
const userAgent = () => globalThis.navigator?.userAgent ?? '';

/** GET the board's name from one host. Reports the status or the network/CORS error text; never the token. */
async function probeHost(d: CheckDeps, host: RestHost, boardId: string, tok: string): Promise<{ ok: boolean; text: string }> {
  const url = `${host}/1/boards/${boardId}?fields=name`;
  try {
    const r = await d.fetch(url, { method: 'GET', headers: authHeaders(url, tok) });
    return r.status === 200 ? { ok: true, text: 'HTTP 200' } : { ok: false, text: await refusal(r, tok) };
  } catch (e) {
    return { ok: false, text: `network error: ${errorText(e)}` };
  }
}

const p3 = check('P3', P3_TITLE, true, async d => {
  // Straight from the click, with nothing awaited first (a browser may block the window after an async gap).
  // Always called, even when a token exists, so every run tests the sign-in itself.
  const signIn = d.auth.authorize();
  try {
    await signIn;
  } catch (e) {
    return { status: 'fail', detail: `token received: no (${errorText(e)})` };
  }
  const tok = await d.auth.accessToken();
  if (!tok) return { status: 'fail', detail: 'token received: no (sign-in finished but no access token is available)' };

  const board = await d.t.board('id');
  const worked: RestHost[] = [];
  const seen: string[] = [];
  for (const host of HOSTS) {
    const answer = await probeHost(d, host, board.id, tok);
    seen.push(`${host}: ${answer.text}`);
    if (answer.ok) worked.push(host);
  }
  const base = `token received: yes; ${seen.join('; ')}`;
  const [first] = worked;
  if (!first) return { status: 'fail', detail: `${base}; no host answered 200` };
  d.host.set(first);
  const detail = `${base}; hosts that worked: ${worked.join(', ')}`;
  await d.t.set(...P3_MARKER, { ua: userAgent(), at: d.now(), detail });
  return { status: 'pass', detail: `${detail}. Now reload this page; the result for "after reload" replaces this row.` };
});

/**
 * Run on every page load. Reports on P3 only if this same browser signed in before, and only once:
 * the marker is removed after it reports, so a later load (or another browser) is not told a stale answer.
 */
export async function p3AfterReload(d: Pick<CheckDeps, 't' | 'now' | 'auth'>): Promise<CheckResult | null> {
  try {
    const marker = await d.t.get(...P3_MARKER);
    if (!marker || marker.ua !== userAgent()) return null;
    await d.t.remove(...P3_MARKER);
    const still = await d.auth.isAuthorized();
    const before = typeof marker.detail === 'string' && marker.detail ? `${marker.detail}; ` : '';
    return { id: 'P3', title: P3_TITLE, status: still ? 'pass' : 'fail', detail: `${before}token after reload: ${still ? 'yes' : 'no'}` };
  } catch (e) {
    return { id: 'P3', title: P3_TITLE, status: 'fail', detail: errorText(e) };
  }
}

// ---- P4: what happens to the matrix when a card is opened --------------------

const P4_TITLE = 'What happens to the matrix when a card opens';
let p4Stamp: string | null = null;

const p4 = check('P4', P4_TITLE, true, async d => {
  const storage = globalThis.sessionStorage;
  if (!storage) throw new Error('sessionStorage is not available in this browser frame.');
  const [first] = await d.t.cards('id');
  if (!first) throw new Error('The board needs at least one card.');
  p4Stamp = `p4-${d.now()}`;
  storage.setItem(P4_KEY, p4Stamp);
  await d.t.showCard(first.id);
  return { status: 'manual', detail: 'Card opened. Close the card and come back to this page; this row then says what happened.' };
});

/** Call when the page regains focus. Non-null once, if this same page instance is still running. */
export function p4Survived(): CheckResult | null {
  if (p4Stamp === null) return null;
  p4Stamp = null;
  globalThis.sessionStorage?.removeItem(P4_KEY);
  return { id: 'P4', title: P4_TITLE, status: 'manual', detail: 'matrix stayed open' };
}

/** Call on page load. Non-null once, if an earlier page left its stamp behind, so it was closed. */
export function p4Closed(): CheckResult | null {
  const storage = globalThis.sessionStorage;
  if (!storage || storage.getItem(P4_KEY) === null) return null;
  storage.removeItem(P4_KEY);
  return { id: 'P4', title: P4_TITLE, status: 'manual', detail: 'matrix was closed' };
}

// ---- P5: can a cover image be shown ------------------------------------------

function loadImageElement(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), IMAGE_TIMEOUT_MS);
    img.onload = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

interface RestCard { id: string; cover?: { scaled?: { url: string }[] } | null }

const p5 = check('P5', 'A card cover image can be shown', false, async d => {
  const tok = await token(d);
  const board = await d.t.board('id');
  const cards: RestCard[] = await (await mustBeOk(await rest(d, tok, 'GET', `/1/boards/${board.id}/cards?fields=id,cover`), 'List cards', tok)).json();
  const withCover = cards.find(c => (c.cover?.scaled?.length ?? 0) > 0);
  const url = withCover?.cover?.scaled?.at(-1)?.url;
  if (!url) return { status: 'manual', detail: 'No card on this board has a cover image. Add one to any card and run P5 again.' };

  if (await (d.loadImage ?? loadImageElement)(url)) return { status: 'pass', detail: 'img works (a plain image tag loads the cover)' };

  const headers = authHeaders(url, tok);   // only Trello's own hosts get the header
  const trello = 'Authorization' in headers;
  const how = trello ? 'with the Authorization header' : 'without the Authorization header, because the image is not hosted by Trello';
  let fetched = 'fetch failed';
  try {
    const r = await d.fetch(url, trello ? { headers } : undefined);
    if (r.ok && (await r.blob()).size > 0) {
      return { status: 'pass', detail: `fetch works (img did not load; fetching ${how} does)` };
    }
    fetched = `fetch ${how} failed: ${await refusal(r, tok)}`;
  } catch (e) {
    fetched = `fetch ${how} failed: ${errorText(e)}`;
  }
  return { status: 'fail', detail: `img did not load; ${fetched}` };
}, true);

// ---- P6: list position values and request pacing -----------------------------

const p6 = check('P6', 'Which list positions are accepted, and how fast', false, async d => {
  const tok = await token(d);
  const [list] = await d.t.lists('id', 'cards');
  const card = list?.cards?.[0];
  if (!card) return { status: 'fail', detail: 'The first list needs at least one card.' };
  const cardPath = `/1/cards/${card.id}`;
  const readPos = async () => ((await (await mustBeOk(await rest(d, tok, 'GET', `${cardPath}?fields=pos`), 'Read pos', tok)).json()) as { pos: number }).pos;

  const original = await readPos();

  // Put the card back where it was. A 429 is a normal answer here, not an exception, so check
  // the status, wait, retry, and read the position back before saying it worked.
  const restore = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < RESTORE_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(RESTORE_PAUSE_MS);
      try {
        const r = await rest(d, tok, 'PUT', `${cardPath}?pos=${original}`);
        if (r.ok && (await readPos()) === original) return true;
      } catch { /* try again */ }
    }
    return false;
  };

  let outcome: Outcome | undefined;
  let failure = '';
  try {
    const accepted: string[] = [];
    for (const value of ['top', 'bottom', 65536.5]) {
      const r = await rest(d, tok, 'PUT', `${cardPath}?pos=${value}`);
      if (!r.ok) throw new Error(`pos=${value} was refused: ${await refusal(r, tok)}`);
      accepted.push(`${value} gives ${await readPos()}`);
    }
    let tooMany = 0;
    let lastRemaining: string | null = null;
    const started = d.now();
    for (let i = 0; i < BURST; i++) {
      const r = await rest(d, tok, 'PUT', `${cardPath}?pos=${original}`);
      if (r.status === 429) tooMany++;
      lastRemaining = r.headers.get('x-rate-limit-api-token-remaining') ?? lastRemaining;
    }
    const elapsed = d.now() - started;
    const header = lastRemaining === null ? 'x-rate-limit-api-token-remaining: not readable' : `x-rate-limit-api-token-remaining: ${lastRemaining}`;
    outcome = { status: 'pass', detail: `accepted: ${accepted.join(', ')}; ${BURST} requests in ${elapsed} ms, 429s: ${tooMany}; ${header}` };
  } catch (e) {
    failure = errorText(e);
  }
  const restored = await restore();
  const note = restored ? 'card position restored' : `card position not restored: set card ${card.id} back to position ${original} by hand`;
  if (!outcome) return { status: 'fail', detail: `${failure}; ${note}` };
  return { status: restored ? 'pass' : 'fail', detail: `${outcome.detail}; ${note}` };
}, true);

// ---- P7: create a dropdown field and rename one of its options ---------------

const p7 = check('P7', 'A dropdown field can be created and an option renamed', false, async d => {
  const tok = await token(d);
  const board = await d.t.board('id');
  const created = (await (await mustBeOk(await rest(d, tok, 'POST', '/1/customFields', {
    idModel: board.id, modelType: 'board', name: 'mxproof', type: 'list', pos: 'bottom', display_cardFront: true,
    options: [{ value: { text: 'One' }, pos: 1 }, { value: { text: 'Two' }, pos: 2 }],
  }), 'Create field', tok)).json()) as { id: string; options?: { id: string }[] };
  const fieldId = created.id;
  let problem: string | null = null;
  try {
    const optionId = created.options?.[0]?.id;
    if (!optionId) throw new Error('The new field came back without options.');
    const optionPath = `/1/customFields/${fieldId}/options/${optionId}`;
    await mustBeOk(await rest(d, tok, 'PUT', optionPath, { value: { text: RENAMED } }), 'Rename option', tok);
    const back = (await (await mustBeOk(await rest(d, tok, 'GET', optionPath), 'Read option', tok)).json()) as { value?: { text?: string } };
    if (back.value?.text !== RENAMED) throw new Error(`Renamed to "${RENAMED}" but read back "${back.value?.text}"`);
  } catch (e) {
    problem = errorText(e);
  }
  let leftover = '';
  try {
    await mustBeOk(await rest(d, tok, 'DELETE', `/1/customFields/${fieldId}`), 'Delete field', tok);
  } catch (e) {
    leftover = ` The test field "mxproof" could not be deleted (${errorText(e)}); delete it by hand.`;
  }
  if (problem !== null) return { status: 'fail', detail: `${problem}.${leftover}` };
  if (leftover) return { status: 'fail', detail: `Field created and option renamed.${leftover}` };
  return { status: 'pass', detail: `Field created; option renamed to "${RENAMED}" and read back; field deleted` };
}, true);

// ---- P8: hidden card data through REST, and a burst of card-storage saves ----

interface RestPluginData { idPlugin?: string; value?: unknown }
interface RestBoardCards { cards?: { id: string; pluginData?: RestPluginData[] }[] }

// Poll mode builds its snapshot from one board read with the card data included, keeping only this Power-Up's entries
// (those whose idPlugin is the context's plugin id). A reorder is also about 90 saves in a burst.
const p8 = check('P8', 'Hidden card data through REST, and a burst of saves', false, async d => {
  const tok = await token(d);
  const board = await d.t.board('id');
  const [first] = await d.t.cards('id');
  if (!first) return { status: 'fail', detail: 'The board needs at least one card.' };
  const stamp = `p8-${d.now()}`;
  const facts: string[] = [];
  let holds = false;
  let problem = '';
  let removed = '';
  try {
    await d.t.set(first.id, 'shared', P8_KEY, stamp);
    try {
      const plugin = d.t.getContext().plugin;
      const hasPlugin = typeof plugin === 'string' && plugin !== '';
      facts.push(`plugin id in the context: ${hasPlugin ? 'yes' : 'no'}`);
      const path = `/1/boards/${board.id}?cards=open&card_fields=name&card_pluginData=true`;
      const read = (await (await mustBeOk(await rest(d, tok, 'GET', path), 'Read board', tok)).json()) as RestBoardCards;
      const entry = read.cards?.find(c => c.id === first.id)?.pluginData
        ?.find(e => typeof e.value === 'string' && e.value.includes(stamp));
      facts.push(`value in the REST card data: ${entry ? 'found' : 'not found'}`);
      const sameId = entry !== undefined && hasPlugin && entry.idPlugin === plugin;
      if (entry) facts.push(`idPlugin matches the context: ${sameId ? 'yes' : 'no'}`);
      holds = hasPlugin && sameId;
    } catch (e) {
      problem = errorText(e);
    }

    let failures = 0;
    let firstError = '';
    const started = d.now();
    for (let i = 0; i < BURST; i++) {
      try {
        await d.t.set(first.id, 'shared', P8_KEY, `${stamp}-${i}`);
      } catch (e) {
        if (failures++ === 0) firstError = errorText(e);
      }
    }
    facts.push(`${BURST} saves in ${d.now() - started} ms, failures: ${failures}${failures ? ` (first error: ${firstError})` : ''}`);
  } catch (e) {
    problem = errorText(e);
  } finally {
    try {
      await d.t.remove(first.id, 'shared', P8_KEY);
    } catch (e) {
      removed = ` The test value "${P8_KEY}" could not be removed from card ${first.id} (${errorText(e)}); remove it by hand.`;
    }
  }
  const detail = `${[...(problem ? [problem] : []), ...facts].join('; ')}.${removed}`;
  return { status: holds && !problem && !removed ? 'pass' : 'fail', detail };
}, true);

export const checks: Check[] = [p1, p2, p3, p4, p5, p6, p7, p8];
