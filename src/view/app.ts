import type { BoardSnapshot, Card, ColourBy, ParamId, Parameter, ViewSettings } from '../model/types';
import type { BoardStore } from '../store/board-store';
import { attachDrag } from './drag';
import { createLegend } from './legend';
import { createSurface, type Surface, type SurfaceState } from './surface';
import { createToolbar } from './toolbar';
import { hideToast, showToast } from './toast';
import { clampPan, detailOf, fitSection, MAX_ZOOM, MIN_ZOOM, zoomAt, type Viewport } from './viewport';
import './styles.css';

export interface MatrixOptions {
  focusCardId?: string;          // used from Task 12
  canRenameLevels?: boolean;     // used from Task 10; default true
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
  const by = saved?.colourBy;
  const colourBy: ColourBy = by?.kind === 'list' || by?.kind === 'member' ? { kind: by.kind }
    : by?.kind === 'field' && snap.dropdownFields.some(f => f.id === by.fieldId) ? { kind: 'field', fieldId: by.fieldId }
    : { kind: 'label' };
  return {
    choice: {
      across: across?.id ?? null, up: up?.id ?? null,
      listIds: snap.lists.filter(l => chosen.has(l.id)).map(l => l.id),
      colourBy, showImages: typeof saved?.showImages === 'boolean' ? saved.showImages : true,
    },
    vp: {
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, finiteOr(saved?.zoom, 1))),
      panX: finiteOr(saved?.panX, 0), panY: finiteOr(saved?.panY, 0),
    },
  };
}

function cardsInLists(snap: BoardSnapshot, listIds: string[]): Card[] {
  const chosen = new Set(listIds);
  return snap.cards.filter(c => chosen.has(c.idList));
}

export async function mountMatrix(root: HTMLElement, store: BoardStore, opts: MatrixOptions = {}): Promise<{ destroy(): void }> {
  const [snapshot, saved] = await Promise.all([store.load(), loadSavedView(store)]);
  root.replaceChildren();
  root.classList.add('mm-app');

  const resolved = resolveView(saved, snapshot);
  const choice = resolved.choice;
  const state: AppState = { snapshot, cards: cardsInLists(snapshot, choice.listIds), choice, vp: resolved.vp };

  const abort = new AbortController();
  const { signal } = abort;

  // The toolbar above the stage and the main row below it, then the legend.
  const toolbar = createToolbar({
    onAcross(id) { setAxes(id, choice.up); },
    onUp(id) { setAxes(choice.across, id); },
    onSwap() { setAxes(choice.up, choice.across); },
    onLists(listIds) {
      choice.listIds = listIds;
      state.cards = cardsInLists(state.snapshot, listIds);       // the zoom stays where it is
      choiceChanged();
    },
    onColourBy(by) { choice.colourBy = by; choiceChanged(); },
    onShowImages(show) { choice.showImages = show; choiceChanged(); },
    onParams() { /* the parameter dialog comes with Task 10 */ },
    onResequence() { /* the resequence dialog comes with Task 11 */ },
    onWholeMatrix() { animateTo(WHOLE); },
  }, signal);
  const legend = createLegend();
  const main = document.createElement('div');
  main.className = 'mm-main';
  root.append(toolbar.el, main, legend.el);

  const surface: Surface = createSurface(main);
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
      ...choice, canResequence: typeof plot() !== 'string',
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
    return { ...choice, zoom: state.vp.zoom, panX: state.vp.panX, panY: state.vp.panY };
  }
  let savedJson = JSON.stringify(currentView());     // what the store is known to hold
  let saveTimer = 0;
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
    } catch (error) {
      savedJson = '';                                // the next change tries again
      showToast(`Couldn't save your view. ${error instanceof Error ? error.message : String(error)}`, 'error');
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

  /** A card was clicked (pressed and released without a drag). Opening it comes with Task 12. */
  function onCardClick(_cardId: string): void { /* nothing yet */ }

  attachDrag({
    host: main,
    surface,
    store,
    // Cards can only be dragged while a matrix is drawn; after a drop's writes the view may have changed
    // (the lists were unchecked, say), and then only the snapshot is read from it.
    view: () => { const shown = plot(); return typeof shown === 'string' ? lastPlot! : shown; },
    setSnapshot(next) {
      state.snapshot = next;
      state.cards = cardsInLists(next, choice.listIds);
    },
    renderNow,
    onCardClick,
    signal,
  });

  const resizeObserver = new ResizeObserver(() => {
    state.vp = clampPan(state.vp, surface.size());
    schedule();
  });
  resizeObserver.observe(stage);

  state.vp = clampPan(state.vp, surface.size());     // a saved pan from a different window size
  syncToolbar();
  renderNow();

  return {
    destroy() {
      abort.abort();
      resizeObserver.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(animationTimer);
      if (saveTimer) void saveNow();
      hideToast();
      surface.destroy();
      root.replaceChildren();
      root.classList.remove('mm-app');
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
