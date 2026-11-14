/** One short message at the bottom of the page, shown in `[data-testid="toast"]`. */

const SHOW_MS = 2600;

let toastEl: HTMLElement | null = null;
let timer = 0;

function element(): HTMLElement {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'mm-toast';
    toastEl.dataset.testid = 'toast';
    toastEl.hidden = true;
  }
  if (!toastEl.isConnected) document.body.append(toastEl);
  return toastEl;
}

export function showToast(text: string, kind: 'info' | 'error' = 'info'): void {
  const e = element();
  e.textContent = text;
  e.dataset.kind = kind;
  e.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  e.hidden = false;
  clearTimeout(timer);
  timer = window.setTimeout(() => { e.hidden = true; }, SHOW_MS);
}

export function hideToast(): void {
  clearTimeout(timer);
  if (toastEl) toastEl.hidden = true;
}
