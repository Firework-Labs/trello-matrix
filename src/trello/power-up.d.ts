// Only what this project calls. The library itself is loaded by a script tag
// from https://p.trellocdn.com/power-up.min.js, not from npm.

type TrelloVisibility = 'shared' | 'private';

interface TrelloContext { board: string; card?: string; member: string; [key: string]: unknown }

interface TrelloRestApi {
  isAuthorized(): Promise<boolean>;
  authorize(opts: { scope: string; expiration: string; [key: string]: unknown }): Promise<string>;
  getToken(): Promise<string | null>;
  clearToken(): Promise<void>;
}

interface TrelloModalOptions {
  url: string;
  title?: string;
  fullscreen?: boolean;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

interface TrelloCover { idAttachment?: string | null; idUploadedBackground?: string | null; color?: string | null; [key: string]: unknown }
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
  closeModal(): Promise<void>;
  showCard(cardId: string): Promise<void>;
  render(fn: () => void | Promise<void>): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arg(name: string, defaultValue?: any): any;
  getRestApi(): TrelloRestApi;
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
  initialize(capabilities: TrelloCapabilities, options?: { appKey: string; appName: string }): void;
  iframe(options?: { appKey: string; appName: string }): TrelloIframe;
};
