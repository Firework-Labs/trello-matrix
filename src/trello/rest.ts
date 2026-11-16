// The three REST calls the matrix makes, as proven by the live checks (docs/proof-results.md).
// Everything it needs (fetch, sign-in, pacer, sleep) is passed in, so tests use fakes.
// The token goes only in the Authorization header, is read when each request is sent, and is
// never put in an address, a message or a log.
import type { Pacer } from '../model/pacer';
import type { DropdownField } from '../model/types';
import { StoreError } from '../store/board-store';
import { authHeaders, type TrelloAuth } from './auth';

export const REST_BASE = 'https://api.trello.com';

export interface Rest {
  /** Creates a dropdown field shown on card fronts, with one option per text, in the order given. */
  createDropdownField(boardId: string, name: string, optionTexts: string[]): Promise<DropdownField>;
  /** Sets the card's value for a dropdown field, or clears it with null. */
  setFieldOption(cardId: string, fieldId: string, optionId: string | null): Promise<void>;
  setCardPos(cardId: string, pos: number): Promise<void>;
}

const RATE_LIMIT_WAIT_MS = 10_000;
const MAX_RETRIES = 3;
/** A request Trello has not answered by now is given up on, so a hung request cannot hold the store's writes and reloads. */
const REQUEST_TIMEOUT_MS = 20_000;
const TIMED_OUT = 'Trello did not answer in time.';
const OPTIONS_UNKNOWN = 'Trello created the field but did not say what its options are. Link it from the dialog instead.';

interface Answer { status: number; ok: boolean; text: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

/** The error an answer that is not ok stands for. The message never includes anything Trello sent. */
function errorFor(a: Answer): StoreError {
  if (a.status === 401) return new StoreError('auth', 'Trello sign-in has expired. Connect again.');
  if (a.status === 403) {
    return a.text.includes('missing scopes')
      ? new StoreError('permission', 'Trello does not allow this with the current sign-in.')
      : new StoreError('permission', 'You are not allowed to change this board.');
  }
  if (a.status === 409 && a.text.includes('CUSTOM_FIELD_DUPLICATE_FIELD')) {
    return new StoreError('invalid', 'A field with that name already exists on the board.');
  }
  if (a.status === 429) return new StoreError('rate-limit', 'Trello is limiting requests. Try again in a minute.');
  return new StoreError('network', `Trello answered ${a.status}.`);
}

interface ReadOption { id: string; text: string; colour: string }

/** Options as Trello describes them, skipping any entry that lacks an id or a text. */
function readOptions(raw: unknown): ReadOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ReadOption[] = [];
  for (const o of raw) {
    if (!isRecord(o) || typeof o.id !== 'string' || !isRecord(o.value) || typeof o.value.text !== 'string') continue;
    out.push({ id: o.id, text: o.value.text, colour: typeof o.color === 'string' ? o.color : 'none' });
  }
  return out;
}

/** One option per text sent, in the order sent; null unless every text finds its own option. */
function matchOptions(read: ReadOption[], texts: string[]): DropdownField['options'] | null {
  if (read.length !== texts.length) return null;
  const unused = [...read];
  const out: DropdownField['options'] = [];
  for (const text of texts) {
    const i = unused.findIndex(o => o.text === text);
    if (i < 0) return null;
    const [o] = unused.splice(i, 1);
    out.push({ id: o!.id, text: o!.text, colour: o!.colour });
  }
  return out;
}

export function createRest(o: {
  auth: TrelloAuth; fetch: typeof fetch; pacer: Pacer; sleep: (ms: number) => Promise<void>; baseUrl?: string;
  /** For the request timeout. Default to the globals. */
  setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (handle: unknown) => void;
}): Rest {
  const base = o.baseUrl ?? REST_BASE;
  const startTimer = o.setTimeout ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const stopTimer = o.clearTimeout ?? ((handle: unknown): void => { clearTimeout(handle as ReturnType<typeof setTimeout>); });
  const doFetch = o.fetch;   // called without a receiver: a browser's fetch throws "Illegal invocation" as a property of another object

  /** One HTTP request, paced. Nothing is sent when there is no token. */
  function attempt(method: string, path: string, query: Record<string, string> | undefined, body: unknown): Promise<Answer> {
    return o.pacer.run(async () => {
      // The 20 s cover the token read as well, so a token call that never answers cannot hold the pacer either.
      const controller = new AbortController();
      let timer: unknown;
      const timedOut = new Promise<never>((_, reject) => {
        timer = startTimer(() => { controller.abort(); reject(new StoreError('network', TIMED_OUT)); }, REQUEST_TIMEOUT_MS);
      });
      const exchange = (async (): Promise<Answer> => {
        let token: string | null;
        try { token = await o.auth.accessToken(); } catch { token = null; }
        if (token === null) throw new StoreError('auth', 'Not signed in to Trello.');
        const url = new URL(path, base);
        for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
        const address = url.toString();
        const headers: Record<string, string> = authHeaders(address, token);
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await doFetch(address, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
        });
        return { status: res.status, ok: res.ok, text: await res.text() };
      })();
      try {
        return await Promise.race([exchange, timedOut]);   // a fetch that ignores the signal still cannot hold this up
      } catch (e) {
        throw e instanceof StoreError ? e : new StoreError('network', 'Could not reach Trello.');
      } finally {
        stopTimer(timer);
      }
    });
  }

  /** Sends the request, waiting and trying again when Trello says it is being asked too much. Resolves with the answer text. */
  async function send(method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<string> {
    for (let retries = 0; ; retries++) {
      const answer = await attempt(method, path, query, body);
      if (answer.ok) return answer.text;
      if (answer.status !== 429 || retries >= MAX_RETRIES) throw errorFor(answer);
      await o.sleep(RATE_LIMIT_WAIT_MS);
    }
  }

  return {
    async createDropdownField(boardId, name, optionTexts) {
      const text = await send('POST', '/1/customFields', undefined, {
        idModel: boardId, modelType: 'board', name, type: 'list', pos: 'bottom', display_cardFront: true,
        options: optionTexts.map(t => ({ value: { text: t }, color: 'none', pos: 'bottom' })),
      });
      const answer = parseJson(text);
      const id = isRecord(answer) && typeof answer.id === 'string' && answer.id !== '' ? answer.id : null;
      if (id === null) throw new StoreError('network', OPTIONS_UNKNOWN);
      let options = matchOptions(readOptions(isRecord(answer) ? answer.options : undefined), optionTexts);
      if (options === null) {
        try {
          options = matchOptions(readOptions(parseJson(await send('GET', `/1/customFields/${encodeURIComponent(id)}/options`))), optionTexts);
        } catch {
          options = null;   // the field exists now, so say so rather than report why this read failed
        }
      }
      if (options === null) throw new StoreError('network', OPTIONS_UNKNOWN);
      const fieldName = isRecord(answer) && typeof answer.name === 'string' ? answer.name : name;
      return { id, name: fieldName, options };
    },

    async setFieldOption(cardId, fieldId, optionId) {
      await send(
        'PUT', `/1/cards/${encodeURIComponent(cardId)}/customField/${encodeURIComponent(fieldId)}/item`, undefined,
        optionId === null ? { idValue: '', value: '' } : { idValue: optionId },
      );
    },

    async setCardPos(cardId, pos) {
      await send('PUT', `/1/cards/${encodeURIComponent(cardId)}`, { pos: String(pos) });
    },
  };
}
