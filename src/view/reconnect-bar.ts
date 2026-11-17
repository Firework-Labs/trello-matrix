import { DECLINED_TEXT, wireConnectButton } from './connect-screen';

/**
 * The bar across the top of the matrix that appears when Trello says the sign-in has expired. It is one element however
 * many calls fail. The page behind a dialog is made inert, but this bar is exempt (`data-modal-exempt`),
 * and the dialog layers start below it, so the person can always press Connect.
 */
export interface ReconnectBar {
  el: HTMLElement;
  /** Shows the bar (no change when it is already showing). */
  show(): void;
}

export interface ReconnectDeps {
  /** Asks for access. Called straight from the click, with nothing awaited first. */
  connect(): Promise<void>;
  /** Access was given: the bar has been taken away; read the board again and show it. */
  onConnected(): void;
  signal: AbortSignal;
}

export const EXPIRED_TEXT = 'Trello sign-in has expired.';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createReconnectBar(deps: ReconnectDeps): ReconnectBar {
  const bar = el('div', 'mm-reconnect');
  bar.dataset.testid = 'reconnect';
  bar.dataset.modalExempt = '';
  bar.hidden = true;
  const text = el('span', 'mm-reconnect-text', EXPIRED_TEXT);
  text.setAttribute('role', 'alert');
  const refusal = el('span', 'mm-reconnect-text');            // holds the sentence only after a refusal
  refusal.dataset.testid = 'reconnect-refused';
  refusal.hidden = true;
  const button = el('button', 'mm-primary', 'Connect to Trello');
  button.type = 'button';
  bar.append(text, refusal, button);

  /** The page layers that sit over everything start below the bar; its height is told to them as a CSS variable on the app root. */
  function syncOffset(): void {
    bar.parentElement?.style.setProperty('--mm-bar-h', bar.hidden ? '0px' : `${bar.offsetHeight}px`);
  }
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(syncOffset);
    observer.observe(bar);
    deps.signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  }

  function clearRefusal(): void {
    refusal.textContent = '';
    refusal.hidden = true;
  }

  wireConnectButton(button, {
    connect: () => deps.connect(),
    pressed: () => { clearRefusal(); syncOffset(); },
    granted() {
      bar.hidden = true;
      clearRefusal();
      button.disabled = false;
      syncOffset();
      deps.onConnected();
    },
    refused() {
      refusal.textContent = DECLINED_TEXT;
      refusal.hidden = false;
      button.disabled = false;
      syncOffset();
    },
    signal: deps.signal,
  });

  return {
    el: bar,
    show() {
      if (!bar.hidden) return;
      bar.hidden = false;
      clearRefusal();
      button.disabled = false;
      syncOffset();
    },
  };
}
