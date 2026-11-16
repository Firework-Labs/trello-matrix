/** The Trello OAuth 2.0 client ID (a public client: there is no secret). Public by design. */
export const CLIENT_ID: string = import.meta.env.VITE_TRELLO_CLIENT_ID ?? '';

/** The address of the sign-in redirect page. Trello's client settings must list exactly this. */
export function redirectUriFor(origin: string, baseUrl: string): string {
  const path = `${baseUrl}oauth-callback.html`;
  return origin ? new URL(path, origin).href : path;   // no origin outside a browser (unit tests)
}
export const REDIRECT_URI: string = redirectUriFor(globalThis.location?.origin ?? '', import.meta.env.BASE_URL);

export const OAUTH_SCOPES: readonly string[] = ['read:board:trello', 'write:board:trello'];

/** Task 14 sets this to true when matrix.html works; until then the Matrix and Show on matrix buttons stay hidden. */
export const MATRIX_READY: boolean = false;

export const APP_NAME = 'Matrix';
export const SYNC_MODE: 'render' | 'poll' = 'poll';            // set from check P2
export const COVER_MODE: 'img' | 'fetch' | 'off' = 'off';      // set from check P5
export const RENAME_OPTIONS: boolean = false;                  // set from check P7
