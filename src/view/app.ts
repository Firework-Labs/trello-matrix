import type { BoardSnapshot, Card, ColourBy, Parameter } from '../model/types';
import type { BoardStore } from '../store/board-store';
import { attachDrag } from './drag';
import { createSurface, type Surface } from './surface';
import { hideToast } from './toast';
import { clampPan, detailOf, fitSection, zoomAt, type Viewport } from './viewport';
import './styles.css';

export interface MatrixOptions {
  focusCardId?: string;          // used from Task 12
  canRenameLevels?: boolean;     // used from Task 10; default true
  /** Called with the milliseconds each render took (the dev page collects them). */
  onRenderTime?: (ms: number) => void;
}

/** What the view shows. Later tasks replace `snapshot` on a store update and call `schedule()`. */
interface AppState {
  snapshot: BoardSnapshot;
  cards: Card[];                 // the cards in the chosen lists; a new array only when the snapshot changes
  across: Parameter;
  up: Parameter;
  colourBy: ColourBy;
  vp: Viewport;
}

const WHOLE: Viewport = { zoom: 1, panX: 0, panY: 0 };
const ANIMATION_MS = 430;
const PAN_THRESHOLD = 3;       // px of movement before a press on the background becomes a pan

// Until Task 9 (toolbar, saved view) these are fixed; the query string can pick the axes for tests.
const CHOSEN_LIST_IDS = ['l-backlog', 'l-ideas'];
const DEFAULT_ACROSS = 'f-cost';
const DEFAULT_UP = 'f-value';

const DETAIL_TEXT = { dot: 'Whole matrix: dots', chip: 'Closer: titles', full: 'Close up: full cards' };

function initialAxes(snap: BoardSnapshot): { across: Parameter; up: Parameter } | null {
  const query = new URLSearchParams(location.search);
  const byId = (id: string) => snap.parameters.find(p => p.id === id);
  const across = byId(query.get('across') ?? DEFAULT_ACROSS) ?? snap.parameters[0];
  const up = byId(query.get('up') ?? DEFAULT_UP);
  const other = up && up !== across ? up : snap.parameters.find(p => p !== across);
  return across && other ? { across, up: other } : null;
}

function cardsInChosenLists(snap: BoardSnapshot): Card[] {
  const known = CHOSEN_LIST_IDS.filter(id => snap.lists.some(l => l.id === id));
  const chosen = new Set(known.length ? known : snap.lists.map(l => l.id));
  return snap.cards.filter(c => chosen.has(c.idList));
}

export async function mountMatrix(root: HTMLElement, store: BoardStore, opts: MatrixOptions = {}): Promise<{ destroy(): void }> {
  const snapshot = await store.load();
  root.replaceChildren();
  root.classList.add('mm-app');

  const axes = initialAxes(snapshot);
  if (!axes) {
    const note = document.createElement('p');
    note.className = 'mm-note';
    note.textContent = 'This board needs two parameters before it can show a matrix.';
    root.append(note);
    return { destroy() { root.replaceChildren(); root.classList.remove('mm-app'); } };
  }

  const state: AppState = {
    snapshot, cards: cardsInChosenLists(snapshot), across: axes.across, up: axes.up,
    colourBy: { kind: 'label' }, vp: WHOLE,
  };

  // Toolbar above the stage and the main row below it; later tasks add a legend after the main row.
  const toolbar = document.createElement('div');
  toolbar.className = 'mm-toolbar';
  toolbar.dataset.testid = 'toolbar';
  const spacer = document.createElement('span');
  spacer.className = 'mm-spacer';
  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'mm-zoom-label';
  zoomLabel.dataset.testid = 'zoom-label';
  const wholeButton = document.createElement('button');
  wholeButton.type = 'button';
  wholeButton.textContent = 'Whole matrix';
  wholeButton.dataset.testid = 'whole-matrix';
  toolbar.append(spacer, zoomLabel, wholeButton);
  const main = document.createElement('div');
  main.className = 'mm-main';
  root.append(toolbar, main);

  const surface: Surface = createSurface(main);
  const stage = surface.stage;
  const abort = new AbortController();
  const { signal } = abort;

  // ---- rendering: batched into one per animation frame ----

  let frame = 0;
  function renderNow(): void {
    const started = performance.now();
    surface.render(state);
    zoomLabel.textContent = `${DETAIL_TEXT[detailOf(state.vp.zoom)]} · ${Math.round(state.vp.zoom * 100)}%`;
    void stage.offsetWidth;                         // include the style and layout work this render caused
    opts.onRenderTime?.(performance.now() - started);
  }
  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; renderNow(); });
  }

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

  stage.addEventListener('wheel', ev => {
    ev.preventDefault();
    stopAnimation();
    const dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
    const at = surface.pointInMatrix(ev.clientX, ev.clientY);
    state.vp = zoomAt(state.vp, Math.exp(-dy * (ev.ctrlKey ? 0.012 : 0.0022)), at.x, at.y, surface.size());
    schedule();
  }, { passive: false, signal });

  let press: { id: number; x: number; y: number; panX: number; panY: number; panning: boolean } | null = null;
  stage.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 || (ev.target as Element).closest('[data-card-id]')) return;
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
    animateTo(fitSection(i, j, state.across.levels.length, state.up.levels.length, surface.size()));
  }, { signal });

  wholeButton.addEventListener('click', () => animateTo(WHOLE), { signal });

  // ---- dragging cards ----

  /** A card was clicked (pressed and released without a drag). Opening it comes with Task 12. */
  function onCardClick(_cardId: string): void { /* nothing yet */ }

  attachDrag({
    host: main,
    surface,
    store,
    view: () => state,
    setSnapshot(next) {
      state.snapshot = next;
      state.cards = cardsInChosenLists(next);
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

  renderNow();

  return {
    destroy() {
      abort.abort();
      resizeObserver.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(animationTimer);
      hideToast();
      surface.destroy();
      root.replaceChildren();
      root.classList.remove('mm-app');
    },
  };
}
