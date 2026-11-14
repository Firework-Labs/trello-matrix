import { locate } from '../model/placement';
import { resequenceList, type RankedCard } from '../model/resequence';
import type { BoardSnapshot, List, ParamId, Parameter } from '../model/types';
import type { BoardStore, ListOrder, Progress } from '../store/board-store';
import { createModalLock } from './modal';
import { showToast } from './toast';

/**
 * The resequence drawer: a preview of each chosen list's new card order (nearest the top-right corner first),
 * then "Reorder in Trello", which writes it, and "Undo last reorder". Nothing is written until Reorder is pressed.
 * When Reorder is pressed the order is worked out again from a fresh read of the board, with the axes and lists the
 * preview was opened with. It is sent, and only for the lists whose order changes, only if it is exactly the order the
 * person was shown. If the board changed meanwhile nothing is sent: the preview becomes the new order, a line says so,
 * and the next press checks again. Closed only by Cancel (never by a key).
 */
export interface ResequenceRequest {
  snapshot: BoardSnapshot;
  across: ParamId;
  up: ParamId;
  /** The chosen lists. */
  listIds: string[];
}

export interface ResequenceDrawerDeps {
  store: BoardStore;
  /** Called with the board as the store now holds it, after a reorder or an undo, or after a stopped one is cancelled. */
  onChanged(snapshot: BoardSnapshot): void;
  /** Called when the drawer has been closed. */
  onClosed(): void;
  signal: AbortSignal;
}

export interface ResequenceDrawer {
  el: HTMLElement;
  open(request: ResequenceRequest): void;
  close(): void;
}

const PREVIEW_CARDS = 7;
const TEXT_SAME = 'The lists are already in this order.';
const TEXT_UNDONE = 'Last reorder undone.';
const TEXT_CHANGED = 'The board changed. Check the new order, then press Reorder in Trello again.';

interface ListPlan { list: List; titles: Map<string, string>; ranked: RankedCard[]; changed: boolean }

/** What the person is shown for a plan: the lists, and for each the cards in their new order with the place each was in. */
const signatureOf = (plans: ListPlan[]): string => JSON.stringify(plans.map(p => [p.list.id, p.ranked.map(r => [r.cardId, r.oldIndex])]));

/** What a failed or finished step left on screen: `retry` is set when the same step can be sent again. */
interface Failure { text: string; retry: (() => void) | null }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, testId: string, className?: string): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.dataset.testid = testId;
  return b;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** "A", "A and B", "A, B and C". */
function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * The new order of every chosen list on this board, with the two axes it was worked out for. Each list's cards are
 * taken in their current order (by position); a card counts as placed only if it is on the matrix for these axes.
 * Null when one of the axes is no longer a parameter.
 */
function planFor(snap: BoardSnapshot, acrossId: ParamId, upId: ParamId, listIds: string[]): { across: Parameter; up: Parameter; plans: ListPlan[] } | null {
  const across = snap.parameters.find(p => p.id === acrossId);
  const up = snap.parameters.find(p => p.id === upId);
  if (!across || !up) return null;
  const chosen = new Set(listIds);
  const plans = snap.lists.filter(l => chosen.has(l.id)).map((list): ListPlan => {
    const cards = snap.cards.filter(c => c.idList === list.id).sort((a, b) => a.pos - b.pos);
    const ranked = resequenceList(cards, c => locate(c, snap.placements[c.id], across, up));
    return {
      list, ranked, titles: new Map(cards.map(c => [c.id, c.name])),
      changed: ranked.some(r => r.newIndex !== r.oldIndex),
    };
  });
  return { across, up, plans };
}

export function createResequenceDrawer(deps: ResequenceDrawerDeps): ResequenceDrawer {
  const { store, signal } = deps;
  let request: ResequenceRequest | null = null;
  let plans: ListPlan[] = [];
  let running: 'reorder' | 'undo' | null = null;
  let progress: Progress | null = null;
  let failure: Failure | null = null;
  let boardChanged = false;                        // the last press found a different order from the one shown, and sent nothing
  let stoppedPartway = false;                      // a reorder or undo began writing and stopped, so the board may differ from what is shown

  const backdrop = el('div', 'mm-drawer-backdrop');
  backdrop.hidden = true;
  const drawer = el('div', 'mm-drawer');
  drawer.dataset.testid = 'reseq-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'Resequence lists');
  drawer.tabIndex = -1;
  backdrop.append(drawer);
  const modal = createModalLock(backdrop);

  const intro = el('p', 'mm-rs-note');
  const same = el('p', 'mm-rs-same', TEXT_SAME);
  same.dataset.testid = 'reseq-same';
  const listsBox = el('div', 'mm-rs-lists');
  const changedLine = el('p', 'mm-rs-changed', TEXT_CHANGED);
  changedLine.dataset.testid = 'reseq-changed';
  changedLine.setAttribute('role', 'status');
  const progressLine = el('p', 'mm-rs-progress');
  progressLine.dataset.testid = 'reseq-progress';
  progressLine.setAttribute('role', 'status');
  const errorLine = el('p', 'mm-rs-error');
  errorLine.dataset.testid = 'reseq-error';
  errorLine.setAttribute('role', 'alert');
  const go = button('Reorder in Trello', 'reseq-go', 'mm-primary');
  const retry = button('Retry', 'reseq-retry', 'mm-primary');
  const undo = button('Undo last reorder', 'reseq-undo');
  const cancel = button('Cancel', 'reseq-cancel');
  const actions = el('div', 'mm-rs-actions');
  actions.append(go, retry, cancel);
  const undoRow = el('div', 'mm-rs-actions');
  undoRow.append(undo);
  drawer.append(el('h3', undefined, 'Resequence lists'), intro, same, changedLine, listsBox, progressLine, errorLine, actions, undoRow);

  // ---- what is shown: the preview, then the buttons and lines that follow the state ----

  function showPreview(across: Parameter, up: Parameter): void {
    intro.textContent = `Each list is reordered on its own, closest to the top-right corner first, using the two axes shown now (${up.name} and ${across.name}). ` +
      'Cards not placed yet keep their order at the bottom.';
    listsBox.replaceChildren(...plans.flatMap(plan => {
      const count = plan.ranked.length;
      const items = plan.ranked.slice(0, PREVIEW_CARDS).map(r => {
        const li = el('li', undefined, `${plan.titles.get(r.cardId) ?? r.cardId} `);
        li.append(el('span', 'mm-rs-was', `was #${r.oldIndex + 1}`));
        return li;
      });
      const ol = el('ol');
      ol.append(...items);
      const parts: HTMLElement[] = [el('h4', undefined, `${plan.list.name} (${count} card${count === 1 ? '' : 's'})`), ol];
      if (count > PREVIEW_CARDS) parts.push(el('p', 'mm-rs-note', `…and ${count - PREVIEW_CARDS} more`));
      return parts;
    }));
  }

  /** Buttons, progress and error follow `running`, `progress` and `failure`. */
  function sync(): void {
    const retrying = failure?.retry != null;
    const anyChange = plans.some(p => p.changed);
    same.hidden = anyChange || plans.length === 0;
    changedLine.hidden = !boardChanged;
    go.hidden = retrying;
    go.disabled = running !== null || !anyChange;
    retry.hidden = !retrying;
    retry.disabled = running !== null;
    undoRow.hidden = retrying || !request?.snapshot.canUndoReorder;
    undo.disabled = running !== null;
    cancel.disabled = running !== null;
    const verb = running === 'undo' ? 'Undoing…' : 'Reordering…';
    progressLine.textContent = running ? (progress ? `${verb} ${progress.done} of ${progress.total}` : verb) : '';
    progressLine.hidden = !running;
    errorLine.textContent = failure?.text ?? '';
    errorLine.hidden = failure === null;
    drawer.setAttribute('aria-busy', String(running !== null));
  }

  // ---- writing ----

  /** Reads the board again after a write, hands it on, closes the drawer and says what was done. */
  async function finish(message: string): Promise<void> {
    let next: BoardSnapshot;
    try {
      next = await store.load();
    } catch (error) {
      if (signal.aborted) return;
      running = null;
      close();
      showToast(`${message} The board could not be read again. ${messageOf(error)}`, 'error');
      return;
    }
    if (signal.aborted) return;
    running = null;
    deps.onChanged(next);
    close();
    showToast(message);
  }

  function stoppedText(error: unknown, sentTotal: number | null): string {
    const done = progress?.done ?? 0;
    const total = progress?.total ?? sentTotal;
    return total === null ? `Stopped before it began. ${messageOf(error)}` : `Stopped after ${done} of ${total}. ${messageOf(error)}`;
  }

  /** Sends orders to the store. A failure leaves the drawer open with "Stopped after D of T." and a Retry that sends the same orders. */
  async function send(orders: ListOrder[], total: number, message: string): Promise<void> {
    running = 'reorder';
    progress = { done: 0, total };
    failure = null;
    sync();
    try {
      await store.reorderLists(orders, p => { if (!signal.aborted) { progress = p; sync(); } });
    } catch (error) {
      if (signal.aborted) return;
      running = null;
      stoppedPartway = true;
      failure = { text: stoppedText(error, total), retry: () => { void send(orders, total, message); } };
      sync();
      return;
    }
    await finish(message);
  }

  /** "Reorder in Trello": works the order out again from a fresh read. Sends the lists that change only if it is the order that was shown. */
  async function apply(): Promise<void> {
    if (running || !request) return;
    running = 'reorder';
    progress = null;
    failure = null;
    boardChanged = false;
    sync();
    const { across, up, listIds } = request;
    let fresh: ReturnType<typeof planFor>;
    let freshSnapshot: BoardSnapshot;
    try {
      freshSnapshot = await store.load();
      fresh = planFor(freshSnapshot, across, up, listIds);
    } catch (error) {
      if (signal.aborted) return;
      running = null;
      failure = { text: `Could not read the board. ${messageOf(error)}`, retry: null };
      sync();
      return;
    }
    if (signal.aborted) return;
    if (!fresh) {
      running = null;
      failure = { text: 'The parameters on the axes are no longer on the board. Close this and try again.', retry: null };
      sync();
      return;
    }
    const shown = signatureOf(plans);
    plans = fresh.plans;
    showPreview(fresh.across, fresh.up);
    const changed = plans.filter(p => p.changed);
    if (signatureOf(plans) !== shown) {               // not the order the person confirmed: show the new one and wait for another press
      request = { ...request, snapshot: freshSnapshot };
      boardChanged = true;
      running = null;
      sync();
      return;
    }
    if (changed.length === 0) {                       // nothing left to do
      running = null;
      sync();
      return;
    }
    const orders = changed.map((p): ListOrder => ({ listId: p.list.id, cardIds: p.ranked.map(r => r.cardId) }));
    await send(orders, orders.reduce((n, o) => n + o.cardIds.length, 0), `${joinNames(changed.map(p => p.list.name))} reordered.`);
  }

  /** "Undo last reorder". A failure leaves the drawer open with a Retry. */
  async function undoLast(): Promise<void> {
    if (running) return;
    running = 'undo';
    progress = null;
    failure = null;
    sync();
    try {
      await store.undoReorder(p => { if (!signal.aborted) { progress = p; sync(); } });
    } catch (error) {
      if (signal.aborted) return;
      running = null;
      stoppedPartway = true;
      failure = { text: stoppedText(error, null), retry: () => { void undoLast(); } };
      sync();
      return;
    }
    await finish(TEXT_UNDONE);
  }

  go.addEventListener('click', () => { void apply(); }, { signal });
  retry.addEventListener('click', () => { failure?.retry?.(); }, { signal });
  undo.addEventListener('click', () => { void undoLast(); }, { signal });
  cancel.addEventListener('click', () => {
    if (running) return;
    const needsRead = stoppedPartway;
    close();
    if (needsRead) {                                  // part of a reorder or undo was written: the matrix should show what Trello holds
      store.load().then(next => { if (!signal.aborted) deps.onChanged(next); }, () => { /* the next read shows it */ });
    }
  }, { signal });

  // ---- opening and closing ----

  function open(next: ResequenceRequest): void {
    if (!backdrop.hidden) return;                    // already open, whatever it is doing: opening again would forget a running write or a Retry
    request = next;
    running = null;
    progress = null;
    failure = null;
    stoppedPartway = false;
    boardChanged = false;
    const planned = planFor(next.snapshot, next.across, next.up, next.listIds);
    plans = planned?.plans ?? [];
    if (planned) showPreview(planned.across, planned.up);
    sync();
    backdrop.hidden = false;
    modal.lock();
    drawer.focus();
  }

  function close(): void {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    modal.unlock();
    deps.onClosed();
  }

  sync();
  return { el: backdrop, open, close };
}
