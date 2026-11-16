// The live checks from spec section 10. Each check takes everything it touches
// (`t`, `auth`, `fetch`, `host`, `now`) as arguments, so the unit tests use fakes and
// nothing here contacts Trello unless the proof page passes it the real ones.
// No result may ever contain the access token.
import { authHeaders } from '../trello/auth';
import { createFieldBody } from '../trello/rest';
import type { TrelloAuth } from '../trello/auth';

export interface CheckResult { id: string; title: string; status: 'pass' | 'fail' | 'manual'; detail: string; ms?: number }
/** The two addresses P3 tries. The documentation does not say which one accepts an OAuth 2.0 token. */
export type RestHost = 'https://api.trello.com' | 'https://trello.com';
/** Where the host P3 found is kept (the proof page keeps it with the saved results, in the tab). */
export interface RestHostStore {
  /** The host to use: the saved one, or trello.com when none is saved. */
  get(): RestHost;
  /** The host an earlier P3 saved in this tab, or null. */
  saved(): RestHost | null;
  set(host: RestHost): void;
}
export interface CheckDeps {
  t: TrelloIframe;
  auth: TrelloAuth;
  fetch: typeof fetch;
  host: RestHostStore;
  now: () => number;
  /** Tries an <img> with this address. Defaults to a real image element. */
  loadImage?: (url: string) => Promise<boolean>;
}
interface Check { id: string; title: string; /** One line shown under the title on the page: what the person does. */ instruction: string; needsClick: boolean; run(d: CheckDeps): Promise<CheckResult> }
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
function check(id: string, title: string, instruction: string, needsClick: boolean, fn: (d: CheckDeps) => Promise<Outcome>, usesRest = false): Check {
  return {
    id, title, instruction, needsClick,
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

const p1 = check('P1', 'Read and write shared storage on any card by id', 'Press Run.', false, async d => {
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

const p2 = check('P2', 'A change by another person arrives without a reload', 'Needs a second browser window open on this board with this page (another person, or you in another window). Press Run here, then press Write ping in the other window within 90 seconds.', true, async d => {
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
  if (seenAfter === null) return { status: 'fail', detail: `No ping arrived within ${P2_TIMEOUT_MS / 1000} s. If nobody pressed Write ping in another window during that time, this is not a real result: run P2 again. render fired: ${renderFired ? 'yes' : 'no'}` };
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

const p3 = check('P3', P3_TITLE, 'Press Run and allow access in the window that opens. When the row has a result, reload this page once.', true, async d => {
  // Straight from the click, with nothing awaited first (a browser may block the window after an async gap).
  // Always called, even when a token exists, so every run tests the sign-in itself.
  const signIn = d.auth.authorize();
  // A failed P3 does not change the host the later checks use, so say which one that is.
  const keep = () => { const host = d.host.saved(); return host ? ` Later checks keep using ${host}.` : ''; };
  try {
    await signIn;
  } catch (e) {
    return { status: 'fail', detail: `token received: no (${errorText(e)}).${keep()}` };
  }
  const tok = await d.auth.accessToken();
  if (!tok) return { status: 'fail', detail: `token received: no (sign-in finished but no access token is available).${keep()}` };

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
  // The marker is left whenever a token resulted, so the reload always reports whether the token survived.
  const detail = first ? `${base}; hosts that worked: ${worked.join(', ')}` : `${base}; no host answered 200`;
  await d.t.set(...P3_MARKER, { ua: userAgent(), at: d.now(), detail, ok: first !== undefined });
  if (!first) return { status: 'fail', detail: `${detail}.${keep()} Reload this page to see whether the token survives.` };
  d.host.set(first);
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
    return { id: 'P3', title: P3_TITLE, status: still && marker.ok !== false ? 'pass' : 'fail', detail: `${before}token after reload: ${still ? 'yes' : 'no'}` };
  } catch (e) {
    return { id: 'P3', title: P3_TITLE, status: 'fail', detail: errorText(e) };
  }
}

// ---- P4: what happens to the matrix when a card is opened --------------------

const P4_TITLE = 'What happens to the matrix when a card opens';
let p4Stamp: string | null = null;

const p4 = check('P4', P4_TITLE, 'Press Run, then close the card that opens.', true, async d => {
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

// ---- P5: every way a cover image could be described, and every way to load one ----
//
// An exploration, not a yes/no: we do not know what Trello returns for `cover` or `attachments` (from the
// Power-Up's own data or from REST) with an OAuth 2.0 token, nor which of those addresses a page may load.
// So this reads everything defensively (nothing is assumed to exist or to have a type), tries every way of
// loading each address it finds, and reports what it saw. It writes nothing to the board. The detail holds
// key names, counts, card ids and masked addresses; never a card name, a full address or the token.

function loadImageElement(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), IMAGE_TIMEOUT_MS);
    img.onload = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asText = (v: unknown): string => (typeof v === 'string' ? v : '');
const objects = (v: unknown): Obj[] => asList(v).map(asObj).filter((o): o is Obj => o !== null);
const keyNames = (o: Obj | null | undefined): string => (o ? `[${Object.keys(o).sort().join(', ')}]` : 'none seen');
const countOf = <T>(items: T[], test: (item: T) => boolean): number => items.filter(test).length;

/** Only what P5 reads of a card, from either source. */
interface CardView { id: string; cover: Obj | null; attachments: Obj[]; idAttachmentCover: string }
function viewCard(raw: unknown): CardView | null {
  const c = asObj(raw);
  const id = c ? asText(c.id) : '';
  if (!c || !id) return null;
  return { id, cover: asObj(c.cover), attachments: objects(c.attachments), idAttachmentCover: asText(c.idAttachmentCover) };
}
const viewCards = (raw: unknown): CardView[] => asList(raw).map(viewCard).filter((c): c is CardView => c !== null);

const hasPreviews = (a: Obj) => asList(a.previews).length > 0;
const isImage = (a: Obj) => hasPreviews(a) || asText(a.mimeType).startsWith('image/');
const coverAttachmentId = (c: CardView | undefined) => asText(c?.cover?.idAttachment) || c?.idAttachmentCover || '';
const showsCover = (c: CardView | undefined) =>
  c !== undefined && (asText(c.cover?.idAttachment) !== '' || asText(c.cover?.idUploadedBackground) !== '' || c.idAttachmentCover !== '' || asList(c.cover?.scaled).length > 0);

/** The address of the largest entry not wider than 600 px, else of the last entry; '' when there is none. */
function pickSize(list: unknown): string {
  const entries = objects(list).filter(e => asText(e.url) !== '');
  const width = (e: Obj) => (typeof e.width === 'number' ? e.width : Number.NaN);
  const fitting = entries.filter(e => width(e) <= 600);
  const chosen = fitting.length > 0 ? fitting.reduce((best, e) => (width(e) > width(best) ? e : best)) : entries.at(-1);
  return chosen ? asText(chosen.url) : '';
}
/** The cover attachment (found by its id) first, then every other image attachment. */
function coverFirst(attachments: Obj[], coverId: string): Obj[] {
  const cover = coverId ? attachments.filter(a => asText(a.id) === coverId) : [];
  return [...cover, ...attachments.filter(a => !cover.includes(a) && isImage(a))];
}
const firstAddress = (attachments: Obj[], read: (a: Obj) => string): string => {
  for (const a of attachments) { const url = read(a); if (url) return url; }
  return '';
};

function webAddress(url: string): URL | null {
  try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? u : null; } catch { return null; }
}
/**
 * host and path with ids masked (16 or more hex characters, 6 or more digits become …), never the query string.
 * The last path segment is a file name, which is the person's own text, so its name becomes <file> and only
 * its extension stays (a segment that is just a masked id stays as it is).
 */
function maskAddress(url: string): string {
  const u = webAddress(url);
  if (!u) return '[not a web address]';
  const path = u.pathname.replace(/[0-9a-fA-F]{16,}/g, '…').replace(/\d{6,}/g, '…');
  const cut = path.lastIndexOf('/') + 1;
  const last = path.slice(cut);
  const extension = /\.[A-Za-z0-9]{1,8}$/.exec(last)?.[0] ?? '';
  return `${u.hostname}${path.slice(0, cut)}${last === '' || last === '…' ? last : `<file>${extension}`}`;
}
/** A refusal or error text for the detail: one line, no token, no full address, no " | " (the section separator), at most 120 characters. */
function shorten(text: string, tok: string): string {
  return text.split(tok).join('[token]')
    .replace(/https?:\/\/[^\s"'<>]+/g, maskAddress)
    .replace(/\s*\|\s*/g, ' / ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * "HTTP 401 unauthorized permission requested" for the detail. Only a Trello host's answer shows its body text;
 * any other host (an image or storage service) shows just the status, because its error body can repeat a file name.
 */
async function refusalText(r: Response, requestUrl: string, tok: string): Promise<string> {
  if (!('Authorization' in authHeaders(requestUrl, tok))) return `HTTP ${r.status}`;
  return shorten(await refusal(r, tok), tok);
}

type Method = 'img' | 'fetch+token' | 'fetch plain';
interface Attempt { pair: string; state: 'worked' | 'failed' | 'not tried'; note: string }

async function fetchAttempt(d: CheckDeps, tok: string, url: string, init: RequestInit | undefined): Promise<{ ok: boolean; note: string }> {
  try {
    const r = await d.fetch(url, init);
    if (!r.ok) return { ok: false, note: await refusalText(r, url, tok) };
    const size = (await r.blob()).size;
    return size > 0 ? { ok: true, note: `${size} bytes` } : { ok: false, note: `HTTP ${r.status} but the body was empty` };
  } catch (e) {
    return { ok: false, note: shorten(`network error: ${errorText(e)}`, tok) };
  }
}

async function tryAddress(d: CheckDeps, tok: string, label: string, url: string): Promise<Attempt[]> {
  const attempts: Attempt[] = [];
  const add = (method: Method, state: Attempt['state'], note: string) => attempts.push({ pair: `${label} via ${method}`, state, note });

  try {
    const loaded = await (d.loadImage ?? loadImageElement)(url);
    add('img', loaded ? 'worked' : 'failed', loaded ? '' : 'did not load');
  } catch (e) {
    add('img', 'failed', shorten(errorText(e), tok));
  }

  const headers = authHeaders(url, tok);   // only Trello's own hosts get the header
  if ('Authorization' in headers) {
    const r = await fetchAttempt(d, tok, url, { headers });
    add('fetch+token', r.ok ? 'worked' : 'failed', r.note);
  } else {
    add('fetch+token', 'not tried', 'not a Trello host');
  }

  const plain = await fetchAttempt(d, tok, url, { credentials: 'omit' });
  add('fetch plain', plain.ok ? 'worked' : 'failed', plain.note);
  return attempts;
}

function clientSummary(rawCount: number, cards: CardView[]): string {
  return [
    `Client data (t.cards): ${rawCount} cards`,
    `cover.idAttachment on ${countOf(cards, c => asText(c.cover?.idAttachment) !== '')}`,
    `cover.idUploadedBackground on ${countOf(cards, c => asText(c.cover?.idUploadedBackground) !== '')}`,
    `cover.scaled not empty on ${countOf(cards, c => asList(c.cover?.scaled).length > 0)}`,
    `cover keys ${keyNames(cards.find(c => c.cover !== null)?.cover)}`,
    `cards with an attachment that has previews: ${countOf(cards, c => c.attachments.some(hasPreviews))}`,
    `attachment keys ${keyNames(cards.flatMap(c => c.attachments)[0])}`,
  ].join('; ');
}
function restSummary(rawCount: number, cards: CardView[]): string {
  return [
    `REST card list: HTTP 200; ${rawCount} cards`,
    `cover.idAttachment on ${countOf(cards, c => asText(c.cover?.idAttachment) !== '')}`,
    `cover.scaled not empty on ${countOf(cards, c => asList(c.cover?.scaled).length > 0)}`,
    `idAttachmentCover on ${countOf(cards, c => c.idAttachmentCover !== '')}`,
    `attachments on ${countOf(cards, c => c.attachments.length > 0)}`,
    `cover keys ${keyNames(cards.find(c => c.cover !== null)?.cover)}`,
  ].join('; ');
}

const REST_CARD_FIELDS = 'fields=id,name,cover,idAttachmentCover&attachments=cover&attachment_fields=id,name,url,previews,mimeType,isUpload';
const REST_ATTACHMENT_FIELDS = 'fields=id,name,url,previews,mimeType,isUpload';

const p5 = check('P5', 'A card cover image can be shown', 'Press Run. Needs a card with a cover image or an image attachment.', false, async d => {
  const tok = await token(d);
  const say = (e: unknown) => shorten(errorText(e), tok);

  // 1. What the Power-Up's own data says.
  let clientCards: CardView[] = [];
  let clientLine: string;
  try {
    const raw: unknown = await d.t.cards('id', 'name', 'cover', 'attachments');
    clientCards = viewCards(raw);
    clientLine = clientSummary(asList(raw).length, clientCards);
  } catch (e) {
    clientLine = `Client data (t.cards): failed (${say(e)})`;
  }

  // 2. What REST says.
  let restCards: CardView[] = [];
  let restLine: string;
  try {
    const board = await d.t.board('id');
    const r = await rest(d, tok, 'GET', `/1/boards/${board.id}/cards?${REST_CARD_FIELDS}`);
    if (!r.ok) {
      restLine = `REST card list: refused (${await refusalText(r, d.host.get(), tok)})`;
    } else {
      const body: unknown = await r.json().catch(() => undefined);
      if (Array.isArray(body)) {
        restCards = viewCards(body);
        restLine = restSummary(body.length, restCards);
      } else {
        restLine = 'REST card list: HTTP 200 but the answer was not a list';
      }
    }
  } catch (e) {
    restLine = `REST card list: failed (${say(e)})`;
  }

  // 3. Pick one card to test: the first (in the client data's order) that either source shows a cover for.
  const clientById = new Map(clientCards.map(c => [c.id, c]));
  const restById = new Map(restCards.map(c => [c.id, c]));
  const ids = [...new Set([...clientCards, ...restCards].map(c => c.id))];
  const attachmentsOf = (id: string) => [...(clientById.get(id)?.attachments ?? []), ...(restById.get(id)?.attachments ?? [])];
  let cardId = ids.find(id => showsCover(clientById.get(id)) || showsCover(restById.get(id)));
  let why = 'the first card with a cover in either source';
  if (cardId === undefined) {
    cardId = ids.find(id => attachmentsOf(id).some(hasPreviews));
    why = 'the first card with an image attachment that has previews';
  }
  if (cardId === undefined) {
    return { status: 'manual', detail: ['No cover or image attachment was found in either source.', clientLine, restLine].join(' | ') };
  }
  const client = clientById.get(cardId);
  const restCard = restById.get(cardId);

  // 4. Ask REST for that card's attachments directly.
  let directAttachments: Obj[] = [];
  let directLine: string;
  try {
    const r = await rest(d, tok, 'GET', `/1/cards/${cardId}/attachments?${REST_ATTACHMENT_FIELDS}`);
    if (!r.ok) {
      directLine = `REST card attachments (card ${cardId}): refused (${await refusalText(r, d.host.get(), tok)})`;
    } else {
      const body: unknown = await r.json().catch(() => undefined);
      if (Array.isArray(body)) {
        directAttachments = objects(body);
        directLine = `REST card attachments (card ${cardId}): HTTP 200; ${body.length} attachments; with previews: ${countOf(directAttachments, hasPreviews)}`;
      } else {
        directLine = `REST card attachments (card ${cardId}): HTTP 200 but the answer was not a list`;
      }
    }
  } catch (e) {
    directLine = `REST card attachments (card ${cardId}): failed (${say(e)})`;
  }

  // 5. Candidate addresses, one per label, in order.
  const coverId = coverAttachmentId(client) || coverAttachmentId(restCard);
  const clientAttachments = coverFirst(client?.attachments ?? [], coverId);
  const restAttachments = coverFirst([...directAttachments, ...(restCard?.attachments ?? [])], coverId);
  const found: [string, string][] = [
    ['client cover.scaled', pickSize(client?.cover?.scaled)],
    ['rest cover.scaled', pickSize(restCard?.cover?.scaled)],
    ['client attachment preview', firstAddress(clientAttachments, a => pickSize(a.previews))],
    ['rest attachment preview', firstAddress(restAttachments, a => pickSize(a.previews))],
    ['attachment download url', firstAddress([...clientAttachments, ...restAttachments], a => asText(a.url))],
  ];
  const candidates = found.filter(([, url]) => webAddress(url) !== null);
  const notes = found.filter(([, url]) => url !== '' && webAddress(url) === null).map(([label]) => `${label}: the address was not a web address`);

  // 6. Try every candidate every way.
  const attempts: Attempt[] = [];
  for (const [label, url] of candidates) attempts.push(...await tryAddress(d, tok, label, url));

  // 7. Report.
  const list = (state: Attempt['state'], withNote: boolean) =>
    attempts.filter(a => a.state === state).map(a => (withNote && a.note ? `${a.pair} (${a.note})` : a.pair)).join('; ') || 'none';
  const detail = [
    `Works: ${list('worked', false)}`,
    `Did not work: ${candidates.length === 0 ? `No image address was found for card ${cardId}` : list('failed', true)}`,
    ...(attempts.some(a => a.state === 'not tried') ? [`Not tried: ${list('not tried', true)}`] : []),
    `Candidates: ${candidates.map(([label, url]) => `${label} = ${maskAddress(url)}`).join('; ') || 'none'}`,
    `Card tested: ${cardId} (${why})`,
    clientLine, restLine, directLine,
    ...(notes.length > 0 ? [`Notes: ${notes.join('; ')}`] : []),
  ].join(' | ');
  return { status: attempts.some(a => a.state === 'worked') ? 'pass' : 'fail', detail };
}, true);

// ---- P6: list position values and request pacing -----------------------------

const p6 = check('P6', 'Which list positions are accepted, and how fast', 'Press Run. It moves one card and puts it back.', false, async d => {
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

// ---- P7: a dropdown field's whole life: create, rename, set on a card, clear, delete -------

const FIELD = 'mxproof';
const FIELD_RENAMED = 'mxproof2';
const OPTION_RENAMED = 'mxproof-renamed';
const OPTION_TEXTS = ['One', 'Two'];
const CLIENT_WAIT_MS = 6000;
const CLIENT_POLL_MS = 250;
const byHand = (name: string) => `The field ${name} could not be removed: delete it by hand (board menu, Custom Fields).`;

interface ProofOption { id: string; text: string }
const optionsOf = (field: Obj | null | undefined): ProofOption[] =>
  objects(field?.options).map(o => ({ id: asText(o.id), text: asText(asObj(o.value)?.text) })).filter(o => o.id !== '');

/** Looks until `probe` says yes: at once, then every 250 ms for up to 6 s. Returns how long it took, or null. */
async function waitFor(d: CheckDeps, probe: () => Promise<boolean>): Promise<number | null> {
  const started = d.now();
  for (;;) {
    if (await probe()) return d.now() - started;
    if (d.now() - started >= CLIENT_WAIT_MS) return null;
    await sleep(CLIENT_POLL_MS);
  }
}

// Every step reports `<step>: ok`, `<step>: HTTP <status> <short text>` or `<step>: <error text>`, so a partial
// result is still a full answer. The status comes only from the REST steps; what the Power-Up's own data shows is
// reported but never decides it. The delete always runs. The detail starts with the REST host (it cannot end with
// it, because the last words may be the instruction to delete the field by hand).
const p7 = check('P7', 'Dropdown fields: create, rename, set on a card, delete', 'Press Run. It adds a temporary field, uses it on one card, and removes it.', false, async d => {
  const tok = await token(d);
  const lines: string[] = [`REST host: ${d.host.get()}`];
  const say = (e: unknown) => shorten(errorText(e), tok);
  const record = (step: string, text: string) => { lines.push(`${step}: ${text}`); };
  const ok = (step: string, extra = '') => record(step, `ok${extra}`);
  /** One REST call. A refusal or error is recorded under `step`; success is left for the caller to record. */
  const call = async (step: string, method: string, path: string, body?: unknown): Promise<{ ok: boolean; json?: unknown }> => {
    try {
      const r = await rest(d, tok, method, path, body);
      if (!r.ok) { record(step, await refusalText(r, d.host.get(), tok)); return { ok: false }; }
      return { ok: true, json: await r.json().catch(() => undefined) };
    } catch (e) {
      record(step, say(e));
      return { ok: false };
    }
  };
  /** Runs one step; anything it throws is recorded under the step's name instead of ending the check. */
  const guard = async (step: string, run: () => Promise<void>): Promise<void> => {
    try { await run(); } catch (e) { record(step, say(e)); }
  };
  const skipped = (step: string, why: string) => record(step, `skipped, ${why}`);

  let listPath = '';
  let fieldId = '';
  let options: ProofOption[] = [];
  let leftover = false;            // a field named mxproof (or mxproof2) was found on the board
  let leftoverRenamed = false;     // ... and it was the mxproof2 one, which has to be renamed back first
  let createTried = false;         // a create POST was sent: the board may hold a field even if its id never reached us
  let createdOk = false;
  let renameOptionOk = false;
  let setOk = false;
  let clearOk = false;
  let deleteOk = false;
  let cardId = '';
  let valueOptionId = '';

  /** The board's field list as REST gives it; records a refusal under `step`. */
  const boardFields = async (step: string): Promise<Obj[] | null> => {
    const r = await call(step, 'GET', listPath);
    if (!r.ok) return null;
    if (!Array.isArray(r.json)) { record(step, 'the answer was not a list'); return null; }
    return objects(r.json);
  };
  /** Reads the field back from REST; null when it cannot be read (recorded under `step`). */
  const readField = async (step: string): Promise<Obj | null> => {
    const r = await call(step, 'GET', `/1/customFields/${fieldId}`);
    if (!r.ok) return null;
    const field = asObj(r.json);
    if (!field) record(step, 'the answer was not a field');
    return field;
  };
  /** Does the person's own Power-Up data show this? Reports how long it took, and key names of what it saw first. */
  const clientSees = async (step: string, what: string, look: () => Promise<{ found: boolean; keys: Obj | null }>, already = false) => {
    let firstKeys: Obj | null = null;
    try {
      const took = await waitFor(d, async () => {
        const seen = await look();
        firstKeys ??= seen.keys;
        return seen.found;
      });
      const keys = `(${what} keys ${keyNames(firstKeys)})`;
      record(step, took === null ? `not seen within ${CLIENT_WAIT_MS / 1000} s ${keys}` : already && took < CLIENT_POLL_MS ? `already present ${keys}` : `seen after ${took} ms ${keys}`);
    } catch (e) {
      record(step, say(e));
    }
  };
  const clientSeesField = () => clientSees('client sees field', 'customField', async () => {
    const fields = objects(asObj(await d.t.board('customFields'))?.customFields);
    return { found: fields.some(f => asText(f.id) === fieldId), keys: fields[0] ?? null };
  }, leftover);
  /** Renames the field and reads the name back; false unless the new name is verified. */
  const renameField = async (step: string, name: string): Promise<boolean> => {
    let verified = false;
    await guard(step, async () => {
      const put = await call(step, 'PUT', `/1/customFields/${fieldId}`, { name });
      if (!put.ok) return;
      ok(step);
      const back = await readField(`${step} read back`);
      if (!back) return;
      verified = asText(back.name) === name;
      record(`${step} read back`, verified ? 'ok' : 'not verified, the new name is not there');
    });
    return verified;
  };
  /** The options as REST shows them: from the field itself, or, when that answer has none, from its options list. */
  const readOptions = async (step: string): Promise<{ options: ProofOption[]; via: string } | null> => {
    const field = await readField(step);
    if (!field) return null;
    const own = optionsOf(field);
    if (own.length > 0) return { options: own, via: 'the field' };
    const listed = await call(step, 'GET', `/1/customFields/${fieldId}/options`);
    if (!listed.ok) return null;
    return { options: optionsOf({ options: listed.json }), via: 'the options list' };
  };

  let leftName = '';   // the name of a field the delete read back still lists, if any
  try {
    const board = await d.t.board('id');
    listPath = `/1/boards/${board.id}/customFields`;

    // 1. find (the exact names mxproof and mxproof2 only; mxproof2 is what an earlier run left if it stopped mid-rename)
    await guard('find', async () => {
      const found = await boardFields('find');
      if (!found) return;
      const old = found.find(f => asText(f.name) === FIELD) ?? found.find(f => asText(f.name) === FIELD_RENAMED);
      if (old) { leftover = true; leftoverRenamed = asText(old.name) === FIELD_RENAMED; fieldId = asText(old.id); options = optionsOf(old); }
      ok('find', old ? `, a field named ${asText(old.name)} is already on the board` : ', no leftover field');
    });

    // 2. create (or reuse)
    await guard('create', async () => {
      if (leftover) {
        if (fieldId) { record('create', 'skipped, reusing a leftover field'); createdOk = true; } else record('create', 'the leftover field had no id');
        return;
      }
      createTried = true;
      const made = await call('create', 'POST', '/1/customFields', createFieldBody(board.id, FIELD, OPTION_TEXTS));   // the very request the store sends
      if (!made.ok) return;
      const field = asObj(made.json);
      fieldId = asText(field?.id);
      options = optionsOf(field);
      if (fieldId) { ok('create'); createdOk = true; } else record('create', 'the answer had no field id');
    });
    if (fieldId && leftoverRenamed) await renameField('rename leftover back', FIELD);
    if (fieldId) {
      for (let i = options.length; i < OPTION_TEXTS.length; i++) {
        await guard('add option', async () => {
          const added = await call('add option', 'POST', `/1/customFields/${fieldId}/options`, { value: { text: OPTION_TEXTS[i] }, color: 'none', pos: 'bottom' });
          if (!added.ok) return;
          const id = asText(asObj(added.json)?.id);
          if (!id) { record('add option', 'the answer had no option id'); return; }
          options.push({ id, text: OPTION_TEXTS[i]! });
          ok('add option');
        });
      }
    }

    // 7 (done at once). Does the Power-Up's own board data show the field?
    if (fieldId) await clientSeesField(); else skipped('client sees field', 'there is no field');

    // 3. rename an option, and read it back
    const first = options[0];
    if (!fieldId || !first) {
      skipped('rename option', fieldId ? 'the field has no option' : 'there is no field');
    } else {
      await guard('rename option', async () => {
        const put = await call('rename option', 'PUT', `/1/customFields/${fieldId}/options/${first.id}`, { value: { text: OPTION_RENAMED } });
        if (!put.ok) return;
        ok('rename option');
        const back = await readOptions('rename option read back');
        if (!back) return;
        const there = back.options.find(o => o.id === first.id)?.text === OPTION_RENAMED;
        record('rename option read back', there ? `ok (from ${back.via})` : `not verified, the renamed text is not there (read from ${back.via})`);
        renameOptionOk = there;
      });
    }

    // 4. rename the field, read it back, rename it back and read that back
    if (!fieldId) {
      skipped('rename field', 'there is no field');
    } else {
      await renameField('rename field', FIELD_RENAMED);
      await renameField('rename field back', FIELD);
    }

    // 5. set the field on the first card, and read it back
    valueOptionId = options[0]?.id ?? '';
    if (!fieldId || !valueOptionId) {
      skipped('set on card', fieldId ? 'the field has no option' : 'there is no field');
    } else {
      await guard('set on card', async () => {
        const [firstCard] = await d.t.cards('id');
        cardId = firstCard?.id ?? '';
        if (!cardId) { record('set on card', 'the board has no card'); return; }
        const put = await call('set on card', 'PUT', `/1/cards/${cardId}/customField/${fieldId}/item`, { idValue: valueOptionId });
        if (!put.ok) return;
        ok('set on card', ` (card ${cardId})`);
        const back = await call('set on card read back', 'GET', `/1/cards/${cardId}/customFieldItems`);
        if (!back.ok) return;
        const item = objects(back.json).find(i => asText(i.idCustomField) === fieldId && asText(i.idValue) === valueOptionId);
        record('set on card read back', item ? 'ok' : 'not verified, no item for this field with that value');
        setOk = item !== undefined;
      });
    }

    // 6. does the Power-Up's own card data show the value?
    if (setOk) {
      await clientSees('client sees card value', 'customFieldItem', async () => {
        const cards = objects(await d.t.cards('id', 'customFieldItems'));
        const items = cards.flatMap(c => objects(c.customFieldItems));
        const mine = objects(cards.find(c => asText(c.id) === cardId)?.customFieldItems);
        return { found: mine.some(i => asText(i.idCustomField) === fieldId && asText(i.idValue) === valueOptionId), keys: items[0] ?? null };
      });
    } else {
      skipped('client sees card value', 'the value was not set on the card');
    }

    // 8. clear it again
    if (!fieldId || !cardId) {
      skipped('clear on card', fieldId ? 'no card was used' : 'there is no field');
    } else {
      await guard('clear on card', async () => {
        const put = await call('clear on card', 'PUT', `/1/cards/${cardId}/customField/${fieldId}/item`, { idValue: '', value: '' });
        if (!put.ok) return;
        ok('clear on card');
        const back = await call('clear on card read back', 'GET', `/1/cards/${cardId}/customFieldItems`);
        if (!back.ok) return;
        const gone = !objects(back.json).some(i => asText(i.idCustomField) === fieldId);
        record('clear on card read back', gone ? 'ok' : 'not verified, the item is still on the card');
        clearOk = gone;
      });
    }
  } catch (e) {
    record('unexpected', say(e));
  } finally {
    // 9. delete, whatever happened above, and check it is gone
    let gone = false;
    await guard('delete', async () => {
      if (fieldId) {
        const del = await call('delete', 'DELETE', `/1/customFields/${fieldId}`);
        if (del.ok) ok('delete');
      } else {
        skipped('delete', 'there is no field id');
      }
      if (!listPath) { skipped('delete read back', 'the board id is not known'); return; }
      const left = await boardFields('delete read back');
      if (!left) return;
      const there = left.find(f => asText(f.id) === fieldId || asText(f.name) === FIELD || asText(f.name) === FIELD_RENAMED);
      gone = there === undefined;
      if (there) leftName = asText(there.name) === FIELD_RENAMED ? FIELD_RENAMED : FIELD;
      record('delete read back', gone ? 'ok, the field is gone' : `not verified, a field named ${leftName} is still on the board`);
    });
    deleteOk = gone && fieldId !== '';
    // Not verified gone, and there may be a field of ours: one we know the id of, found, tried to create, or the read back lists.
    if (!gone && (fieldId !== '' || leftover || createTried || leftName !== '')) lines.push(byHand(leftName || FIELD));
  }
  const pass = createdOk && renameOptionOk && setOk && clearOk && deleteOk;
  return { status: pass ? 'pass' : 'fail', detail: lines.join(' | ') };
});

// ---- P8: hidden card data through REST, and a burst of card-storage saves ----

interface RestPluginData { idPlugin?: string; value?: unknown }
interface RestBoardCards { cards?: { id: string; pluginData?: RestPluginData[] }[] }

// Poll mode builds its snapshot from one board read with the card data included, keeping only this Power-Up's entries
// (those whose idPlugin is the context's plugin id). A reorder is also about 90 saves in a burst.
const p8 = check('P8', 'Hidden card data through REST, and a burst of saves', 'Press Run. It takes a few seconds.', false, async d => {
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

/** The order the page lists the checks and the copied results, and the order docs/proof-script.md runs them. */
export const RUN_ORDER: readonly string[] = ['P1', 'P3', 'P5', 'P6', 'P7', 'P8', 'P2', 'P4'];
