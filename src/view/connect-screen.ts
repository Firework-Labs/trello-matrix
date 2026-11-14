/** The step before the matrix on a person's first use: one button that asks Trello for access. */

export const DECLINED_TEXT = 'Trello access is needed to save your changes.';

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

  button.addEventListener('click', () => {
    let asked: Promise<void>;
    try {
      asked = handlers.connect();                       // in this very call: no await before it
    } catch (error) {
      asked = Promise.reject(error);
    }
    button.disabled = true;
    message.hidden = true;
    asked.then(
      () => handlers.onConnected().catch(error => fail(`Couldn't load the board. ${messageOf(error)}`)),
      () => fail(DECLINED_TEXT),
    );
  }, { signal });

  return { el: screen };
}
