import { locate } from '../model/placement';
import type { BoardSnapshot, Card, ColourBy, ParamId, Parameter, ViewSettings } from '../model/types';
import type { BoardStore } from '../store/board-store';
import { createConnectScreen, createLoadErrorScreen } from './connect-screen';
import { attachDrag } from './drag';
import { createLegend } from './legend';
import { createParameterDialog } from './parameter-dialog';
import { createResequenceDrawer } from './resequence-drawer';
import { shareUnchanged } from './snapshot-share';
import { createSurface, type Surface, type SurfaceState } from './surface';
import { createToolbar } from './toolbar';
import { hideToast, showToast } from './toast';
import { clampPan, detailOf, fitSection, MAX_ZOOM, MIN_ZOOM, zoomAt, type Viewport } from './viewport';
import './styles.css';

export interface MatrixOptions {
  /** "Show on matrix": open zoomed to this card (or, if it has no spot on the matrix, highlight it for a moment). */
  focusCardId?: string;
  /** Whether a level can be renamed in the parameter dialog. Default true. */
  canRenameLevels?: boolean;
  /** Called with the milliseconds each render took (the dev page collects them). */
  onRenderTime?: (ms: number) => void;
}

/** The part of the saved view that says what is plotted and how; the zoom and pan live in `AppState.vp`. */
type Choice = Omit<ViewSettings, 'zoom' | 'panX' | 'panY'>;

/** What the view shows. Later tasks replace `snapshot` on a store update and call `schedule()`. */
interface AppState {
  snapshot: BoardSnapshot;
  cards: Card[];                 // the cards in the chosen lists; a new array only when the snapshot or the lists change
  choice: Choice;
  vp: Viewport;
}

const WHOLE: Viewport = { zoom: 1, panX: 0, panY: 0 };
const ANIMATION_MS = 430;
const PAN_THRESHOLD = 3;       // px of movement before a press on the background becomes a pan
const SAVE_EVERY_MS = 500;     // the view is saved at most this often
const NO_CARDS: Card[] = [];
const FOCUS_ZOOM = 4;          // full-card detail starts at 3.4
const HIGHLIGHT_MS = 2500;     // how long a card that cannot be zoomed to stays marked

const HINT_NEEDS_PARAMETERS = 'Add at least two parameters to plot cards.';
const HINT_NEEDS_LISTS = 'Choose the lists to plot.';
const HINT_NO_CARDS = 'No cards in the chosen lists.';

const DETAIL_TEXT = { dot: 'Whole matrix: dots', chip: 'Closer: titles', full: 'Close up: full cards' };

const finiteOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * The saved view made to fit this board: a parameter or list that no longer exists is replaced
 * (the first parameters for the axes) or dropped, and the two axes are never the same parameter.
 * With nothing saved, Across and Up are the first two parameters and no lists are chosen.
 */
function resolveView(saved: ViewSettings | null, snap: BoardSnapshot): { choice: Choice; vp: Viewport } {
  const across = snap.parameters.find(p => p.id === saved?.across) ?? snap.parameters[0];
  const up = snap.parameters.find(p => p.id === saved?.up && p !== across) ?? snap.parameters.find(p => p !== across);
  const chosen = new Set(Array.isArray(saved?.listIds) ? saved.listIds : []);
  return {
    choice: {
      across: across?.id ?? null, up: up?.id ?? null,
      listIds: snap.lists.filter(l => chosen.has(l.id)).map(l => l.id),
      colourBy: validColour(saved?.colourBy, snap), showImages: typeof saved?.showImages === 'boolean' ? saved.showImages : true,
    },
    vp: {
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, finiteOr(saved?.zoom, 1))),
      panX: finiteOr(saved?.panX, 0), panY: finiteOr(saved?.panY, 0),
    },
  };
}

/** The colouring when the board still has what it needs (a dropdown field for `field`), otherwise by label. */
function validColour(by: ColourBy | undefined, snap: BoardSnapshot): ColourBy {
  if (by?.kind === 'list' || by?.kind === 'member') return { kind: by.kind };
  if (by?.kind === 'field' && snap.dropdownFields.some(f => f.id === by.fieldId)) return { kind: 'field', fieldId: by.fieldId };
  return { kind: 'label' };
}

function cardsInLists(snap: BoardSnapshot, listIds: string[]): Card[] {
  const chosen = new Set(listIds);
  return snap.cards.filter(c => chosen.has(c.idList));
}

/**
 * Mounts the matrix, after the one-time "Connect to Trello" step when this person has not connected yet.
 * It does not reject: when the board cannot be read at startup, a screen says so, with a "Try again" button that
 * starts the whole mount again. Whatever the failed attempt set up is gone before the screen appears.
 */
export async function mountMatrix(root: HTMLElement, store: BoardStore, opts: MatrixOptions = {}): Promise<{ destroy(): void }> {
  const abort = new AbortController();
  let mounted: { destroy(): void } | null = null;

  async function attempt(): Promise<void> {
    try {
      const next = await mountStart(root, store, opts);
      if (abort.signal.aborted) next.destroy(); else mounted = next;
    } catch (error) {
      if (abort.signal.aborted) return;
      root.replaceChildren(createLoadErrorScreen(error, () => { void attempt(); }, abort.signal).el);
    }
  }
  await attempt();
  return {
    destroy() {
      abort.abort();
      mounted?.destroy();
      mounted = null;
      root.replaceChildren();
    },
  };
}

/** One attempt: the connect step if needed, otherwise the board. Rejects when the board cannot be read. */
async function mountStart(root: HTMLElement, store: BoardStore, opts: MatrixOptions): Promise<{ destroy(): void }> {
  if (await store.isConnected()) return mountBoard(root, store, opts);

  const abort = new AbortController();
  let board: { destroy(): void } | null = null;
  const screen = createConnectScreen({
    connect: () => store.connect(),
    async onConnected() {
      let mounted: { destroy(): void };
      try {
        mounted = await mountBoard(root, store, opts);              // replaces the connect screen
      } catch (error) {
        if (!abort.signal.aborted) root.replaceChildren(screen.el);  // a failed attempt cleans up after itself; the connect screen shows what went wrong
        throw error;
      }
      if (abort.signal.aborted) mounted.destroy(); else board = mounted;
    },
  }, abort.signal);
  root.replaceChildren(screen.el);
  return {
    destroy() {
      abort.abort();
      board?.destroy();
      root.replaceChildren();
    },
  };
}

async function mountBoard(root: HTMLElement, store: BoardStore, opts: MatrixOptions): Promise<{ destroy(): void }> {
  const [snapshot, saved] = await Promise.all([store.load(), loadSavedView(store)]);
  root.replaceChildren();
  root.classList.add('mm-app');

  const resolved = resolveView(saved, snapshot);
  const choice = resolved.choice;
  const state: AppState = { snapshot, cards: cardsInLists(snapshot, choice.listIds), choice, vp: resolved.vp };
  /** Lists plotted only because a card in them was asked for ("Show on matrix"); they are not part of the saved view. */
  const sessionLists = new Set<string>();

  const abort = new AbortController();
  const { signal } = abort;

  // The toolbar above the stage and the main row below it, then the legend.
  const toolbar = createToolbar({
    onAcross(id) { setAxes(id, choice.up); },
    onUp(id) { setAxes(choice.across, id); },
    onSwap() { setAxes(choice.up, choice.across); },
    onLists(listIds) {
      sessionLists.clear();                                      // a list the person leaves ticked is now their own choice
      choice.listIds = listIds;
      state.cards = cardsInLists(state.snapshot, listIds);       // the zoom stays where it is
      choiceChanged();
    },
    onColourBy(by) { choice.colourBy = by; choiceChanged(); },
    onShowImages(show) { choice.showImages = show; choiceChanged(); },
    onParams() { dialog.open(state.snapshot); },
    onResequence() { openResequence(); },
    onWholeMatrix() { animateTo(WHOLE); },
  }, signal);
  const legend = createLegend();
  const main = document.createElement('div');
  main.className = 'mm-main';
  const dialog = createParameterDialog({
    store,
    canRenameLevels: opts.canRenameLevels ?? true,
    onChanged: boardRead,
    onClosed() { toolbar.focusParams(); },
    signal,
  });
  const drawer = createResequenceDrawer({
    store,
    onChanged: boardRead,
    onClosed() { toolbar.focusResequence(); },
    signal,
  });
  root.append(toolbar.el, main, legend.el, dialog.el, drawer.el);

  const surface: Surface = createSurface(main, { coverImage: cardId => store.coverImageUrl(cardId) });
  const stage = surface.stage;

  // ---- what is drawn: the matrix, or a hint when there is nothing to plot ----

  const parameterOf = (id: ParamId | null): Parameter | undefined => state.snapshot.parameters.find(p => p.id === id);

  function plot(): SurfaceState | string {
    const across = parameterOf(choice.across), up = parameterOf(choice.up);
    if (!across || !up) return HINT_NEEDS_PARAMETERS;
    if (choice.listIds.length === 0) return HINT_NEEDS_LISTS;
    if (state.cards.length === 0) return HINT_NO_CARDS;
    return { snapshot: state.snapshot, cards: state.cards, across, up, colourBy: choice.colourBy, showImages: choice.showImages, vp: state.vp };
  }
  let lastPlot: SurfaceState | null = null;

  function syncToolbar(): void {
    toolbar.update({
      parameters: state.snapshot.parameters, lists: state.snapshot.lists, dropdownFields: state.snapshot.dropdownFields,
      ...choice, canEdit: state.snapshot.canEdit, canResequence: typeof plot() !== 'string',
    });
  }

  // ---- rendering: batched into one per animation frame ----

  let frame = 0;
  function renderNow(): void {
    const started = performance.now();
    const shown = plot();
    // The legend first: when it appears or wraps it changes the stage's height, and the cards are placed for that height.
    legend.update(typeof shown === 'string' ? NO_CARDS : state.cards, choice.colourBy, state.snapshot);
    if (typeof shown === 'string') {
      surface.showHint(shown);
    } else {
      lastPlot = shown;
      surface.render(shown);
    }
    toolbar.setZoomText(`${DETAIL_TEXT[detailOf(state.vp.zoom)]} · ${Math.round(state.vp.zoom * 100)}%`);
    void stage.offsetWidth;                         // include the style and layout work this render caused
    queueSave();
    opts.onRenderTime?.(performance.now() - started);
  }
  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; renderNow(); });
  }

  /** Lists, colours or images changed: the toolbar follows and the matrix is redrawn, at the same zoom. */
  function choiceChanged(): void {
    syncToolbar();
    renderNow();
  }

  // ---- saving the view: at most once per SAVE_EVERY_MS, whatever changed (the zoom and pan included) ----

  function currentView(): ViewSettings {
    return { ...choice, listIds: choice.listIds.filter(id => !sessionLists.has(id)), zoom: state.vp.zoom, panX: state.vp.panX, panY: state.vp.panY };
  }
  let savedJson = JSON.stringify(currentView());     // what the store is known to hold
  let saveTimer = 0;
  let saveFailed = false;                            // the last save failed and the person has been told
  function queueSave(): void {
    if (saveTimer || JSON.stringify(currentView()) === savedJson) return;
    saveTimer = window.setTimeout(saveNow, SAVE_EVERY_MS);
  }
  async function saveNow(): Promise<void> {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const view = currentView();
    const json = JSON.stringify(view);
    if (json === savedJson) return;
    savedJson = json;
    try {
      await store.saveView(view);
      saveFailed = false;
    } catch (error) {
      savedJson = '';                                // the next change tries again
      if (!saveFailed) showToast(`Couldn't save your view. ${error instanceof Error ? error.message : String(error)}`, 'error');
      saveFailed = true;                             // quiet until a save works, so a failure that stays does not toast on every render
    }
  }
  // A change in the last half second would otherwise be lost when the page or the matrix goes away.
  window.addEventListener('pagehide', () => { if (saveTimer) void saveNow(); }, { signal });

  // ---- zoom and pan ----

  let animationTimer = 0;
  function stopAnimation(): void {
    clearTimeout(animationTimer);
    stage.classList.remove('mm-anim');
  }
  function animateTo(vp: Viewport): void {
    stage.classList.add('mm-anim');
    clearTimeout(animationTimer);
    animationTimer = window.setTimeout(() => stage.classList.remove('mm-anim'), ANIMATION_MS);
    state.vp = vp;
    renderNow();
  }

  /** A new pair of axes: the cards glide to their new places and the view returns to the whole matrix. */
  function setAxes(across: ParamId | null, up: ParamId | null): void {
    if (across === null || up === null || across === up) return;
    choice.across = across;
    choice.up = up;
    syncToolbar();
    animateTo(WHOLE);
  }

  /**
   * The view's choices made to fit the board as it is now: an axis whose parameter is gone moves to another parameter that
   * is not on the other axis, a list that is gone is dropped, and a colouring that needs a removed field goes back to labels.
   * Returns whether an axis changed. The zoom and pan are not touched.
   */
  function mend(next: BoardSnapshot): boolean {
    const exists = (id: ParamId | null): id is ParamId => next.parameters.some(p => p.id === id);
    const before = [choice.across, choice.up];
    const across = exists(choice.across) ? choice.across : next.parameters.find(p => p.id !== choice.up)?.id ?? null;
    const up = exists(choice.up) ? choice.up : next.parameters.find(p => p.id !== across)?.id ?? null;
    choice.across = across;
    choice.up = up;
    const open = new Set(next.lists.map(l => l.id));
    if (choice.listIds.some(id => !open.has(id))) choice.listIds = choice.listIds.filter(id => open.has(id));
    for (const id of sessionLists) if (!open.has(id)) sessionLists.delete(id);
    const colourBy = validColour(choice.colourBy, next);
    if (JSON.stringify(colourBy) !== JSON.stringify(choice.colourBy)) choice.colourBy = colourBy;
    return before[0] !== across || before[1] !== up;
  }

  /** The board as the store now holds it replaces what the view was built from, and the view is mended to fit. Does not draw. Returns whether an axis changed. */
  function adopt(next: BoardSnapshot): boolean {
    state.snapshot = next;
    const axesChanged = mend(next);
    state.cards = cardsInLists(next, choice.listIds);
    syncToolbar();
    return axesChanged;
  }

  /** The board was read again after the parameter dialog or the resequence drawer wrote it: new axes start from the whole matrix. */
  function boardRead(next: BoardSnapshot): void {
    if (adopt(shareUnchanged(state.snapshot, next))) animateTo(WHOLE);
    else renderNow();
  }

  /**
   * The store says the board changed: the other person's change, or just as likely the echo of this person's own.
   * What is already shown is kept as it is, so a snapshot that repeats it redraws nothing, and the zoom and pan stay.
   * A card in the hand is not touched by a render (the drop decides what becomes of it).
   */
  function boardChangedByStore(next: BoardSnapshot): void {
    const shared = shareUnchanged(state.snapshot, next);
    if (signal.aborted || shared === state.snapshot) return;
    adopt(shared);
    renderNow();
  }

  function openResequence(): void {
    if (!state.snapshot.canEdit || choice.across === null || choice.up === null || typeof plot() === 'string') return;
    drawer.open({ snapshot: state.snapshot, across: choice.across, up: choice.up, listIds: choice.listIds });
  }

  stage.addEventListener('wheel', ev => {
    ev.preventDefault();
    if (typeof plot() === 'string') return;
    stopAnimation();
    const dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
    const at = surface.pointInMatrix(ev.clientX, ev.clientY);
    state.vp = zoomAt(state.vp, Math.exp(-dy * (ev.ctrlKey ? 0.012 : 0.0022)), at.x, at.y, surface.size());
    schedule();
  }, { passive: false, signal });

  let press: { id: number; x: number; y: number; panX: number; panY: number; panning: boolean } | null = null;
  stage.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 || (ev.target as Element).closest('[data-card-id]') || typeof plot() === 'string') return;
    press = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, panX: state.vp.panX, panY: state.vp.panY, panning: false };
  }, { signal });
  stage.addEventListener('pointermove', ev => {
    if (!press || ev.pointerId !== press.id) return;
    if (!(ev.buttons & 1)) { endPress(ev); return; }           // a stale press: the button is already up
    const dx = ev.clientX - press.x, dy = ev.clientY - press.y;
    if (!press.panning) {
      if (Math.abs(dx) + Math.abs(dy) <= PAN_THRESHOLD) return;
      press.panning = true;                         // capture only now, so a plain click or double-click keeps its target
      stopAnimation();
      stage.setPointerCapture(ev.pointerId);
      stage.classList.add('mm-panning');
    }
    state.vp = clampPan({ ...state.vp, panX: press.panX + dx, panY: press.panY + dy }, surface.size());
    schedule();
  }, { signal });
  function endPress(ev: PointerEvent): void {
    if (!press || ev.pointerId !== press.id) return;
    press = null;
    stage.classList.remove('mm-panning');
  }
  stage.addEventListener('pointerup', endPress, { signal });
  stage.addEventListener('pointercancel', endPress, { signal });

  stage.addEventListener('dblclick', ev => {
    const section = (ev.target as Element).closest<HTMLElement>('[data-section]');
    if (!section) return;
    const [i = 0, j = 0] = section.dataset.section!.split('-').map(Number);
    const across = parameterOf(choice.across), up = parameterOf(choice.up);
    if (across && up) animateTo(fitSection(i, j, across.levels.length, up.levels.length, surface.size()));
  }, { signal });

  // ---- dragging cards ----

  /** A card was clicked (pressed and released without a drag): the real Trello card opens, and nothing is written. */
  async function onCardClick(cardId: string): Promise<void> {
    if (!state.cards.some(c => c.id === cardId)) return;
    try {
      await store.openCard(cardId);
    } catch (error) {
      showToast(`Couldn't open the card. ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  attachDrag({
    host: main,
    surface,
    store,
    // Cards can only be dragged while a matrix is drawn; after a drop's writes the view may have changed
    // (the lists were unchecked, say), and then only the snapshot is read from it.
    view: () => { const shown = plot(); return typeof shown === 'string' ? lastPlot! : shown; },
    applyWrite(change) {
      state.snapshot = change(state.snapshot);
      state.cards = cardsInLists(state.snapshot, choice.listIds);
    },
    renderNow,
    canEdit: () => state.snapshot.canEdit,
    isPlotted: cardId => state.cards.some(c => c.id === cardId),
    onCardClick: cardId => { void onCardClick(cardId); },
    signal,
  });

  const resizeObserver = new ResizeObserver(() => {
    state.vp = clampPan(state.vp, surface.size());
    schedule();
  });
  resizeObserver.observe(stage);

  /** "Show on matrix": the card's list is plotted, and the view is zoomed to it (or the card is marked, if it has no spot). */
  function focusOn(cardId: string): boolean {
    const card = state.snapshot.cards.find(c => c.id === cardId);
    const across = parameterOf(choice.across), up = parameterOf(choice.up);
    if (!card || !across || !up || !state.snapshot.lists.some(l => l.id === card.idList)) return false;
    if (!choice.listIds.includes(card.idList)) {
      sessionLists.add(card.idList);
      choice.listIds = state.snapshot.lists.filter(l => l.id === card.idList || choice.listIds.includes(l.id)).map(l => l.id);
      state.cards = cardsInLists(state.snapshot, choice.listIds);
    }
    const at = locate(card, state.snapshot.placements[card.id], across, up);
    if (at.zone !== 'matrix') {
      state.vp = WHOLE;
      return true;
    }
    const s = surface.size();
    state.vp = { zoom: FOCUS_ZOOM, panX: s.w / 2 - at.x! * s.w * FOCUS_ZOOM, panY: s.h / 2 - (1 - at.y!) * s.h * FOCUS_ZOOM };
    return false;
  }
  let highlightTimer = 0;
  /** Takes everything the view set up away: listeners, observer, timers, the matrix itself. Writes nothing. */
  function release(): void {
    abort.abort();
    clearTimeout(highlightTimer);
    clearTimeout(saveTimer);
    saveTimer = 0;
    resizeObserver.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(animationTimer);
    hideToast();
    surface.destroy();
    root.replaceChildren();
    root.classList.remove('mm-app');
  }
  const highlightFocus = opts.focusCardId !== undefined && focusOn(opts.focusCardId);

  state.vp = clampPan(state.vp, surface.size());     // a saved pan from a different window size
  syncToolbar();
  renderNow();
  if (highlightFocus) {
    surface.highlight(opts.focusCardId!);
    highlightTimer = window.setTimeout(() => surface.highlight(null), HIGHLIGHT_MS);
  }
  let unsubscribe: () => void;
  try {
    unsubscribe = store.subscribe(boardChangedByStore);
  } catch (error) {
    release();                                       // the attempt has failed: nothing it set up may stay live, and nothing is saved
    throw error;
  }
  if (snapshot.canEdit && snapshot.parameters.length < 2) dialog.open(state.snapshot);   // nothing can be plotted without them

  return {
    destroy() {
      unsubscribe();
      if (saveTimer) void saveNow();               // a change in the last half second is not lost
      release();
    },
  };
}

/** The saved view, or null when there is none or it cannot be read (the person is told, and starts from the defaults). */
async function loadSavedView(store: BoardStore): Promise<ViewSettings | null> {
  try {
    return await store.loadView();
  } catch (error) {
    showToast(`Couldn't load your saved view. ${error instanceof Error ? error.message : String(error)}`, 'error');
    return null;
  }
}
