// Only what this project calls. The library itself is loaded by a script tag
// from https://p.trellocdn.com/power-up.min.js, not from npm.

type TrelloVisibility = 'shared' | 'private';

// `permissions` is what the person may do in this context ('write' or 'read' for the board); its shape is read defensively.
interface TrelloContext { board: string; card?: string; member: string; permissions?: unknown; [key: string]: unknown }

interface TrelloOAuth2Client {
  /** Opens the consent window. The documentation does not say what it resolves with, so treat it as unknown. */
  authorize(opts: { scopes: string[] }): Promise<unknown>;
  /** The access token, or null when the person must authorise again. The library refreshes it itself. */
  getAccessToken(): Promise<string | null>;
  /** Called on the redirect page once the window has loaded. */
  redirectUriCallback(): unknown;
}

interface TrelloPowerUpOptions { clientId: string; redirectUri: string }

interface TrelloModalOptions {
  url: string;
  title?: string;
  fullscreen?: boolean;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

// What t.cards returns for `cover` is not documented well enough to rely on, so every field here is optional
// and typed `unknown`. Read it defensively (check P5 does).
interface TrelloCover { idAttachment?: unknown; idUploadedBackground?: unknown; color?: unknown; scaled?: unknown; [key: string]: unknown }
interface TrelloCardInfo { id: string; name?: string; idList?: string; pos?: number; cover?: TrelloCover | null; [key: string]: unknown }
interface TrelloListInfo { id: string; name?: string; cards?: TrelloCardInfo[]; [key: string]: unknown }

interface TrelloIframe {
  // `scope` is 'board', 'card', 'member', 'organization' or a card id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(scope: string, visibility: TrelloVisibility, key: string, defaultValue?: any): Promise<any>;
  set(scope: string, visibility: TrelloVisibility, key: string, value: unknown): Promise<void>;
  remove(scope: string, visibility: TrelloVisibility, key: string): Promise<void>;
  cards(...fields: string[]): Promise<TrelloCardInfo[]>;
  lists(...fields: string[]): Promise<TrelloListInfo[]>;
  board(...fields: string[]): Promise<{ id: string; [key: string]: unknown }>;
  getContext(): TrelloContext;
  modal(opts: TrelloModalOptions): Promise<void>;
  showCard(cardId: string): Promise<void>;
  render(fn: () => void | Promise<void>): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arg(name: string, defaultValue?: any): any;
  getOAuth2ApiClient(): TrelloOAuth2Client;
}

interface TrelloButton {
  icon?: string | { dark: string; light: string };
  text: string;
  condition?: 'always' | 'admin' | 'edit' | 'readOnly' | 'signedIn' | 'signedOut';
  callback: (t: TrelloIframe) => unknown;
}

interface TrelloCapabilities {
  'board-buttons'?: (t: TrelloIframe) => TrelloButton[] | Promise<TrelloButton[]>;
  'card-buttons'?: (t: TrelloIframe) => TrelloButton[] | Promise<TrelloButton[]>;
}

declare const TrelloPowerUp: {
  initialize(capabilities: TrelloCapabilities, options: TrelloPowerUpOptions): void;
  iframe(options: TrelloPowerUpOptions): TrelloIframe;
};
