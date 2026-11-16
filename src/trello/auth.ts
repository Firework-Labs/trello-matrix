// The one place that signs a person in to Trello (OAuth 2.0, public client) and
// builds the Authorization header. The token never leaves this module except as
// the return value of accessToken() and the header authHeaders() builds; nothing
// here logs it or puts it in an error message.
import { OAUTH_SCOPES } from '../config';

export interface TrelloAuth {
  /** Opens Trello's consent window. Call only from a click handler, with nothing awaited before it. */
  authorize(): Promise<void>;          // rejects if the person declines or no token results
  /** The current access token, or null when the person must authorise again. */
  accessToken(): Promise<string | null>;
  isAuthorized(): Promise<boolean>;
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'unknown error';
}

export function createAuth(t: TrelloIframe, scopes: readonly string[] = OAUTH_SCOPES): TrelloAuth {
  const accessToken = async (): Promise<string | null> => {
    const value = await t.getOAuth2ApiClient().getAccessToken();
    return typeof value === 'string' && value !== '' ? value : null;
  };
  return {
    accessToken,
    isAuthorized: async () => (await accessToken()) !== null,
    async authorize() {
      // Browsers block a pop-up opened after an async gap, so the library call is the first thing that happens.
      // (An async function runs synchronously up to its first await.)
      const started = t.getOAuth2ApiClient().authorize({ scopes: [...scopes] });
      try {
        await started;
      } catch (e) {
        throw new Error(`Trello sign-in did not finish: ${messageOf(e)}`);
      }
      let token: string | null;
      try {
        token = await accessToken();
      } catch (e) {
        throw new Error(`Trello sign-in finished but the access token could not be read: ${messageOf(e)}`);
      }
      if (token === null) throw new Error('Trello gave no access token. The sign-in was declined or did not finish.');
    },
  };
}

function isTrelloHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'trello.com' || u.hostname.endsWith('.trello.com'));
  } catch {
    return false;
  }
}

/** Headers for a REST request to `url`: the Bearer header only when the host is trello.com or ends in .trello.com over https; otherwise none. */
export function authHeaders(url: string, token: string): Record<string, string> {
  return isTrelloHost(url) ? { Authorization: `Bearer ${token}` } : {};
}
