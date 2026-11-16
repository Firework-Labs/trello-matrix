/** The Trello OAuth 2.0 client ID (a public client: there is no secret). Public by design. */
export const CLIENT_ID: string = import.meta.env.VITE_TRELLO_CLIENT_ID ?? '';

/** The address of the sign-in redirect page. Trello's client settings must list exactly this. */
export function redirectUriFor(origin: string, baseUrl: string): string {
  const path = `${baseUrl}oauth-callback.html`;
  return origin ? new URL(path, origin).href : path;   // no origin outside a browser (unit tests)
}
export const REDIRECT_URI: string = redirectUriFor(globalThis.location?.origin ?? '', import.meta.env.BASE_URL);

export const OAUTH_SCOPES: readonly string[] = ['read:board:trello', 'write:board:trello'];

/** The "Matrix" board button and the "Show on matrix" card button are shown. */
export const MATRIX_READY: boolean = true;

/**
 * Trello refuses to rename custom fields and their options for OAuth 2.0 tokens (live check P7), so parameter
 * and level names are changed in Trello's own Custom Fields editor and the matrix shows them read-only.
 */
export const CAN_RENAME_FIELDS: boolean = false;
