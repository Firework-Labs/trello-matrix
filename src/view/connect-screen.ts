/** The step before the matrix on a person's first use: one button that asks Trello for access. */

export const DECLINED_TEXT = 'Trello access is needed to save your changes.';

/**
 * How long a Connect button stays disabled after a press the library has not answered. If the person closes the sign-in
 * window, the library may never settle its promise; the button must not stay dead for good.
 */
export const CONNECT_RETRY_MS = 5000;

export interface ConnectScreen {
  el: HTMLElement;
}

export interface ConnectHandlers {
  /** Asks for access. Called straight from the click, with nothing awaited first: the real one opens a popup that browsers block after an async gap. */
  connect(): Promise<void>;
  /** Access was given: the matrix is loaded. A rejection is shown on this screen. */
  onConnected(): Promise<void>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Makes `button` ask for access. `connect` is called in the click itself, with nothing awaited first (a browser blocks a
 * pop-up opened after an async gap). The button is disabled while the question is open and comes back after
 * CONNECT_RETRY_MS if it has not been answered. Only the latest press counts: an older one that settles late is ignored.
 */
export function wireConnectButton(button: HTMLButtonElement, o: {
  connect(): Promise<void>;
  /** Called when a press is made, before it is answered. */
  pressed(): void;
  granted(): void;
  refused(): void;
  signal: AbortSignal;
}): void {
  let latest = 0;
  button.addEventListener('click', () => {
    const press = ++latest;
    let asked: Promise<void>;
    try {
      asked = o.connect();                              // in this very call: no await before it
    } catch (error) {
      asked = Promise.reject(error);
    }
    button.disabled = true;
    o.pressed();
    const timer = window.setTimeout(() => { if (press === latest && !o.signal.aborted) button.disabled = false; }, CONNECT_RETRY_MS);
    asked.then(
      () => { clearTimeout(timer); if (press === latest && !o.signal.aborted) o.granted(); },
      () => { clearTimeout(timer); if (press === latest && !o.signal.aborted) o.refused(); },
    );
  }, { signal: o.signal });
}

/** Shown instead of the matrix when the board could not be read at startup: what went wrong, and a button that tries the whole start again. */
export function createLoadErrorScreen(error: unknown, tryAgain: () => void, signal: AbortSignal): ConnectScreen {
  const screen = el('div', 'mm-connect');
  screen.dataset.testid = 'load-error';
  const panel = el('div', 'mm-connect-panel');
  const message = el('p', 'mm-connect-error', `Couldn't load the board. ${messageOf(error)}`);
  message.setAttribute('role', 'alert');
  const button = el('button', 'mm-primary', 'Try again');
  button.type = 'button';
  button.addEventListener('click', () => { button.disabled = true; tryAgain(); }, { signal });
  panel.append(message, button);
  screen.append(panel);
  return { el: screen };
}

export function createConnectScreen(handlers: ConnectHandlers, signal: AbortSignal): ConnectScreen {
  const screen = el('div', 'mm-connect');
  screen.dataset.testid = 'connect';
  const panel = el('div', 'mm-connect-panel');
  const button = el('button', 'mm-primary', 'Connect to Trello');
  button.type = 'button';
  const message = el('p', 'mm-connect-error');
  message.dataset.testid = 'connect-error';
  message.setAttribute('role', 'alert');
  message.hidden = true;
  panel.append(
    el('h2', undefined, 'Connect to Trello'),
    el('p', undefined, 'The matrix saves where you put each card in Trello, so it needs your permission to read and change this board. You only do this once.'),
    button, message,
  );
  screen.append(panel);

  function fail(text: string): void {
    if (signal.aborted) return;
    message.textContent = text;
    message.hidden = false;
    button.disabled = false;
  }

  wireConnectButton(button, {
    connect: () => handlers.connect(),
    pressed: () => { message.hidden = true; },
    granted: () => { handlers.onConnected().catch(error => fail(`Couldn't load the board. ${messageOf(error)}`)); },
    refused: () => fail(DECLINED_TEXT),
    signal,
  });

  return { el: screen };
}
