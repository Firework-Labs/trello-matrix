// The live checks from spec section 10. Each check takes everything it touches
// (`t`, `fetch`, `key`, `now`) as arguments, so the unit tests use fakes and
// nothing here contacts Trello unless the proof page passes it the real ones.
// No result may ever contain the REST token.

export interface CheckResult { id: string; title: string; status: 'pass' | 'fail' | 'manual'; detail: string; ms?: number }
export interface CheckDeps {
  t: TrelloIframe;
  fetch: typeof fetch;
  key: string;
  now: () => number;
  /** Tries an <img> with this address. Defaults to a real image element. */
  loadImage?: (url: string) => Promise<boolean>;
}
interface Check { id: string; title: string; needsClick: boolean; run(d: CheckDeps): Promise<CheckResult> }
type Outcome = Pick<CheckResult, 'status' | 'detail'>;

const API = 'https://api.trello.com';
const P2_TIMEOUT_MS = 90_000;
const P2_POLL_MS = 1000;
const IMAGE_TIMEOUT_MS = 10_000;
const BURST = 30;
const P4_KEY = 'mxproof.p4';
const RENAMED = 'Renamed';

/** Ids of the checks that write to the board; the page keeps them off until "This is a test board" is ticked. */
export const writeCheckIds: readonly string[] = ['P1', 'P6', 'P7'];

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  try { return JSON.stringify(e); } catch { return String(e); }
}

function check(id: string, title: string, needsClick: boolean, fn: (d: CheckDeps) => Promise<Outcome>): Check {
  return {
    id, title, needsClick,
    async run(d) {
      const started = d.now();
      try {
        const outcome = await fn(d);
        return { id, title, ...outcome, ms: d.now() - started };
      } catch (e) {
        return { id, title, status: 'fail', detail: errorText(e), ms: d.now() - started };
      }
    },
  };
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ---- REST helpers (header authorisation; the token never leaves these) -------

async function token(d: CheckDeps): Promise<string> {
  const value = await d.t.getRestApi().getToken();
  if (!value) throw new Error('Not authorised yet. Run P3 first.');
  return value;
}
function authHeader(d: CheckDeps, tok: string): string {
  return `OAuth oauth_consumer_key="${d.key}", oauth_token="${tok}"`;
}
function rest(d: CheckDeps, tok: string, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Authorization: authHeader(d, tok) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return d.fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function mustBeOk(r: Response, what: string): Promise<Response> {
  if (r.ok) return r;
  const text = (await r.text().catch(() => '')).slice(0, 200);
  throw new Error(`${what}: HTTP ${r.status}${text ? ` ${text}` : ''}`);
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
  baseline = await d.t.get(...PING);
  armed = true;
  while (seenAfter === null && d.now() - started < P2_TIMEOUT_MS) {
    await sleep(P2_POLL_MS);
    await look();
  }
  if (seenAfter === null) return { status: 'fail', detail: `no ping seen within ${P2_TIMEOUT_MS / 1000} s. render fired: ${renderFired ? 'yes' : 'no'}` };
  return { status: 'pass', detail: `render fired: ${renderFired ? 'yes' : 'no'}, seen after ${seenAfter} ms (the two computers' clocks may differ by a second or two)` };
});

// ---- P3: REST authorisation and whether it survives a reload -----------------

const P3_MARKER = ['member', 'private', 'mxproofAuth'] as const;

const p3 = check('P3', 'REST authorisation works and persists', true, async d => {
  const api = d.t.getRestApi();
  if (!(await api.isAuthorized())) await api.authorize({ scope: 'read,write', expiration: 'never' });
  if (!(await api.isAuthorized())) return { status: 'fail', detail: 'authorised now: no (authorise returned but isAuthorized is still false)' };
  await d.t.set(...P3_MARKER, d.now());
  return { status: 'manual', detail: 'authorised now: yes. Now reload this page; the result for "after reload" replaces this row.' };
});

/** Run on every page load. Reports on P3 only if authorisation was tried before. */
export async function p3AfterReload(d: Pick<CheckDeps, 't' | 'now'>): Promise<CheckResult | null> {
  const title = 'REST authorisation works and persists';
  try {
    const marker = await d.t.get(...P3_MARKER);
    if (marker === undefined) return null;
    const still = await d.t.getRestApi().isAuthorized();
    return { id: 'P3', title, status: still ? 'pass' : 'fail', detail: `authorised now: yes, after reload: ${still ? 'yes' : 'no'}` };
  } catch (e) {
    return { id: 'P3', title, status: 'fail', detail: errorText(e) };
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
  const cards: RestCard[] = await (await mustBeOk(await rest(d, tok, 'GET', `/1/boards/${board.id}/cards?fields=id,cover`), 'List cards')).json();
  const withCover = cards.find(c => (c.cover?.scaled?.length ?? 0) > 0);
  const url = withCover?.cover?.scaled?.at(-1)?.url;
  if (!url) return { status: 'manual', detail: 'No card on this board has a cover image. Add one to any card and run P5 again.' };

  if (await (d.loadImage ?? loadImageElement)(url)) return { status: 'pass', detail: 'img works (a plain image tag loads the cover)' };

  let fetched = 'fetch failed';
  try {
    const r = await d.fetch(url, { headers: { Authorization: authHeader(d, tok) } });
    if (r.ok && (await r.blob()).size > 0) {
      return { status: 'pass', detail: 'fetch works (img did not load; fetching with the Authorization header does)' };
    }
    fetched = `fetch failed: HTTP ${r.status}`;
  } catch (e) {
    fetched = `fetch failed: ${errorText(e)}`;
  }
  return { status: 'fail', detail: `img did not load; ${fetched}` };
});

// ---- P6: list position values and request pacing -----------------------------

const p6 = check('P6', 'Which list positions are accepted, and how fast', false, async d => {
  const tok = await token(d);
  const [list] = await d.t.lists('id', 'cards');
  const card = list?.cards?.[0];
  if (!card) return { status: 'fail', detail: 'The first list needs at least one card.' };
  const cardPath = `/1/cards/${card.id}`;
  const readPos = async () => ((await (await mustBeOk(await rest(d, tok, 'GET', `${cardPath}?fields=pos`), 'Read pos')).json()) as { pos: number }).pos;

  const original = await readPos();
  const accepted: string[] = [];
  try {
    for (const value of ['top', 'bottom', 65536.5]) {
      const r = await rest(d, tok, 'PUT', `${cardPath}?pos=${value}`);
      if (!r.ok) throw new Error(`pos=${value} was refused: HTTP ${r.status}`);
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
    return {
      status: 'pass',
      detail: `accepted: ${accepted.join(', ')}; ${BURST} requests in ${elapsed} ms, 429s: ${tooMany}; ${header}`,
    };
  } finally {
    await rest(d, tok, 'PUT', `${cardPath}?pos=${original}`).catch(() => undefined);
  }
});

// ---- P7: create a dropdown field and rename one of its options ---------------

const p7 = check('P7', 'A dropdown field can be created and an option renamed', false, async d => {
  const tok = await token(d);
  const board = await d.t.board('id');
  const created = (await (await mustBeOk(await rest(d, tok, 'POST', '/1/customFields', {
    idModel: board.id, modelType: 'board', name: 'mxproof', type: 'list', pos: 'bottom', display_cardFront: true,
    options: [{ value: { text: 'One' }, pos: 1 }, { value: { text: 'Two' }, pos: 2 }],
  }), 'Create field')).json()) as { id: string; options?: { id: string }[] };
  const fieldId = created.id;
  let problem: string | null = null;
  try {
    const optionId = created.options?.[0]?.id;
    if (!optionId) throw new Error('The new field came back without options.');
    const optionPath = `/1/customFields/${fieldId}/options/${optionId}`;
    await mustBeOk(await rest(d, tok, 'PUT', optionPath, { value: { text: RENAMED } }), 'Rename option');
    const back = (await (await mustBeOk(await rest(d, tok, 'GET', optionPath), 'Read option')).json()) as { value?: { text?: string } };
    if (back.value?.text !== RENAMED) throw new Error(`Renamed to "${RENAMED}" but read back "${back.value?.text}"`);
  } catch (e) {
    problem = errorText(e);
  }
  let leftover = '';
  try {
    await mustBeOk(await rest(d, tok, 'DELETE', `/1/customFields/${fieldId}`), 'Delete field');
  } catch (e) {
    leftover = ` The test field "mxproof" could not be deleted (${errorText(e)}); delete it by hand.`;
  }
  if (problem !== null) return { status: 'fail', detail: `${problem}.${leftover}` };
  if (leftover) return { status: 'fail', detail: `Field created and option renamed.${leftover}` };
  return { status: 'pass', detail: `Field created; option renamed to "${RENAMED}" and read back; field deleted` };
});

export const checks: Check[] = [p1, p2, p3, p4, p5, p6, p7];
