import { colourOf, trelloColour } from '../model/colour';
import { fieldLevel, locate } from '../model/placement';
import type { BoardSnapshot, Card, ColourBy, Parameter, Zone } from '../model/types';
import { detailOf, toScreen, type Detail, type Size, type Viewport } from './viewport';

/** Everything the surface draws. Identity matters: the card model is rebuilt only when one of the first five changes. */
export interface SurfaceState {
  snapshot: BoardSnapshot;
  cards: Card[];                 // the cards in scope, in board order
  across: Parameter;
  up: Parameter;
  colourBy: ColourBy;
  vp: Viewport;
}

/** Where a card is, as drawn: its zone and its position on each axis (null where it has none). */
export interface PlacedCard { card: Card; zone: Zone; x: number | null; y: number | null }

/** Where a pointer would drop a card. In the matrix, `i` counts from the left and `j` from the bottom. */
export type DropTarget = { zone: 'matrix'; i: number; j: number } | { zone: 'leftStrip' | 'bottomStrip' | 'tray' };

export interface Surface {
  stage: HTMLElement;
  /** The matrix area at zoom 1, in px. */
  size(): Size;
  /** A pointer position in the matrix area's own pixels (the origin that `Viewport` pan is measured from). */
  pointInMatrix(clientX: number, clientY: number): { x: number; y: number };
  render(state: SurfaceState): void;
  /** The card as last drawn, or undefined when it is not shown. */
  placementOf(cardId: string): PlacedCard | undefined;
  /** Which drop zone a page position is over (tray, left strip, bottom strip, matrix), or null outside all of them. */
  dropTargetAt(clientX: number, clientY: number): DropTarget | null;
  /** Highlights the drop target, and only that one; null clears it. */
  setDropTarget(target: DropTarget | null): void;
  /**
   * Takes the card out of the layout into the drag layer, where `moveLifted` positions it in page pixels.
   * Renders leave a lifted card alone until `release`. Returns where it was on the page.
   */
  lift(cardId: string): DOMRect | null;
  moveLifted(cardId: string, left: number, top: number): void;
  /** Puts a lifted card back in its zone; the next `render` draws it where the model says it belongs. */
  release(cardId: string): void;
  destroy(): void;
}

/** The label under a dot, chip or full card; the same tray form is used at every zoom. */
const TRAY_DETAIL: Detail = 'chip';
/** An axis label needs this much of its section on screen to be shown. */
const MIN_LABEL_ROOM = 90;
/** The tray's heading and hint come before its cards. */
const TRAY_HEADER_CHILDREN = 2;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

interface CardView {
  el: HTMLElement;
  card: Card;
  zone: Zone;
  x: number | null;
  y: number | null;
  colour: string;
  /** What the element currently shows, so unchanged cards are not touched. */
  shown: { zone: Zone; detail: string; card: Card; colour: string; left: string; top: string };
}

interface AxisLabel { el: HTMLElement; shown: string }

export function createSurface(host: HTMLElement): Surface {
  const tray = el('aside', 'mm-tray');
  tray.dataset.testid = 'tray';
  const trayHeading = el('h4');
  const trayHint = el('p', undefined, 'Cards with no level for the two axes shown wait here until you drag them in.');
  tray.append(trayHeading, trayHint);

  const stage = el('div', 'mm-stage');
  stage.dataset.testid = 'stage';
  const clip = el('div', 'mm-clip');
  const area = el('div', 'mm-area');             // the origin of every position; the clip reaches a little past it
  clip.append(area);
  const matrix = el('div', 'mm-matrix');
  matrix.dataset.testid = 'matrix';
  const badge = el('div', 'mm-best', 'Do first');
  badge.dataset.testid = 'do-first';
  matrix.append(badge);
  area.append(matrix);
  const stripLeft = el('div', 'mm-strip mm-strip-left');
  stripLeft.dataset.testid = 'strip-left';
  const stripBottom = el('div', 'mm-strip mm-strip-bottom');
  stripBottom.dataset.testid = 'strip-bottom';
  const acrossAxes = el('div', 'mm-axes mm-axes-across');
  const upAxes = el('div', 'mm-axes mm-axes-up');
  stage.append(clip, stripLeft, stripBottom, acrossAxes, upAxes);
  const dragLayer = el('div', 'mm-drag-layer');
  host.append(tray, stage, dragLayer);

  const parentOf: Record<Zone, HTMLElement> = { matrix: area, leftStrip: stripLeft, bottomStrip: stripBottom, tray };

  let views = new Map<string, CardView>();
  let sections: HTMLElement[] = [];                 // index i * ny + j
  let acrossLabels: AxisLabel[] = [];
  let upLabels: AxisLabel[] = [];
  let gridKey = '';
  let last: Pick<SurfaceState, 'snapshot' | 'cards' | 'across' | 'up' | 'colourBy'> | null = null;
  let shownMatrix = '';
  let shownRefs: unknown[] = [];                    // the parts of the snapshot that card content is drawn from
  const lifted = new Set<string>();                 // cards in the drag layer; renders do not touch them
  let needsSync = false;                            // a card was released and may be in the wrong parent
  let hot: HTMLElement | null = null;

  /** The exact box, not clientWidth's rounded one, so positions and pointer conversions agree to the sub-pixel. */
  function size(): Size {
    const r = area.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  function pointInMatrix(clientX: number, clientY: number) {
    const r = area.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // ---- model: which card is where, in which colour; rebuilt only when the inputs change ----

  function cardContent(v: CardView, detail: Detail, state: SurfaceState): void {
    const { card } = v;
    const body: HTMLElement[] = [];
    if (detail === 'chip') {
      body.push(el('div', 'mm-title', card.name));
    } else if (detail === 'full') {
      if (card.hasCover) body.push(el('div', 'mm-cover'));
      body.push(el('div', 'mm-title', card.name));
      const pills = state.snapshot.labels.filter(l => card.labelIds.includes(l.id));
      if (pills.length) {
        const row = el('div', 'mm-pills');
        for (const l of pills) {
          const pill = el('span', 'mm-pill', l.name || l.colour || '');
          pill.style.setProperty('--c', trelloColour(l.colour));
          row.append(pill);
        }
        body.push(row);
      }
      const meta = el('div', 'mm-meta', state.snapshot.lists.find(l => l.id === card.idList)?.name ?? '');
      for (const m of state.snapshot.members.filter(m => card.memberIds.includes(m.id))) {
        const who = el('span', 'mm-member', m.initials);
        who.title = m.fullName;
        meta.append(who);
      }
      body.push(meta);
      const tags = el('div', 'mm-tags');
      for (const p of state.snapshot.parameters) {
        const level = fieldLevel(card, p);
        if (level !== null) tags.append(el('span', 'mm-tag', `${p.name}: ${p.levels[level] ?? ''}`));
      }
      if (tags.childElementCount) body.push(tags);
    }
    v.el.replaceChildren(...body);
  }

  function rebuildModel(state: SurfaceState): void {
    const { snapshot, cards, across, up, colourBy } = state;
    const next = new Map<string, CardView>();
    let trayCount = 0;
    const counts = new Map<number, number>();
    const nx = across.levels.length, ny = up.levels.length;

    // Full cards draw labels, members, lists and parameters from the snapshot; when those change, every card is redrawn.
    const refs = [snapshot.labels, snapshot.members, snapshot.lists, snapshot.parameters];
    const contentChanged = refs.some((r, k) => r !== shownRefs[k]);
    shownRefs = refs;

    for (const card of cards) {
      const at = locate(card, snapshot.placements[card.id], across, up);
      const colour = colourOf(card, colourBy, snapshot).colour;
      let v = views.get(card.id);
      if (!v) {
        const e = el('div');
        e.dataset.cardId = card.id;
        v = { el: e, card, zone: at.zone, x: at.x, y: at.y, colour, shown: { zone: at.zone, detail: '', card, colour: '', left: '', top: '' } };
      }
      Object.assign(v, { card, zone: at.zone, x: at.x, y: at.y, colour });
      if (contentChanged) v.shown.detail = '';          // forces the next render to rewrite this card
      next.set(card.id, v);
      if (at.zone === 'tray') trayCount++;
      if (at.zone === 'matrix') {
        const key = Math.min(nx - 1, Math.floor(at.x! * nx)) * ny + Math.min(ny - 1, Math.floor(at.y! * ny));
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    for (const [id, v] of views) {
      if (next.has(id)) continue;
      v.el.remove();
      lifted.delete(id);
    }
    views = next;
    syncParents();
    trayHeading.textContent = `Not placed yet (${trayCount})`;

    rebuildGrid(across, up);
    sections.forEach((s, k) => { s.querySelector('.count')!.textContent = `${counts.get(k) ?? 0} cards`; });
  }

  /** Every card that is not lifted goes in its zone's element; the tray keeps board order. */
  function syncParents(): void {
    needsSync = false;
    const trayCards: HTMLElement[] = [];
    for (const [id, v] of views) {
      if (lifted.has(id)) continue;
      if (v.zone === 'tray') trayCards.push(v.el);
      else if (v.el.parentElement !== parentOf[v.zone]) parentOf[v.zone].append(v.el);
    }
    const inPlace = trayCards.every((e, k) => tray.children[k + TRAY_HEADER_CHILDREN] === e)
      && tray.childElementCount === trayCards.length + TRAY_HEADER_CHILDREN;
    if (!inPlace) tray.append(...trayCards);
  }

  /** Sections and axis labels depend only on the two parameters. */
  function rebuildGrid(across: Parameter, up: Parameter): void {
    const key = JSON.stringify([across.name, across.levels, up.name, up.levels]);
    if (key === gridKey) return;
    gridKey = key;
    const nx = across.levels.length, ny = up.levels.length;

    for (const s of sections) s.remove();
    sections = [];
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const s = el('div', 'mm-section');
        s.dataset.section = `${i}-${j}`;
        s.style.left = `${(i / nx) * 100}%`;
        s.style.width = `${100 / nx}%`;
        s.style.top = `${((ny - 1 - j) / ny) * 100}%`;
        s.style.height = `${100 / ny}%`;
        s.append(el('span', 'count'));
        sections.push(s);
        matrix.append(s);
      }
    }
    const label = (kind: 'across' | 'up', p: Parameter, level: number): AxisLabel => {
      const e = el('div', 'mm-axis');
      e.dataset.axis = kind;
      const name = el('span', undefined, `${p.name}: `);
      name.append(el('b', undefined, p.levels[level] ?? ''));
      e.append(name);
      e.hidden = true;
      return { el: e, shown: '' };
    };
    acrossLabels = across.levels.map((_, i) => label('across', across, i));
    upLabels = up.levels.map((_, j) => label('up', up, j));
    acrossAxes.replaceChildren(...acrossLabels.map(l => l.el));
    upAxes.replaceChildren(...upLabels.map(l => l.el));
    // Sections are placed in the matrix element by percentages, so they follow its size without more work.
  }

  // ---- view: positions that depend on zoom and pan, written only where they changed ----

  function setStyle(v: CardView, left: string | null, top: string | null): void {
    if (left !== null && left !== v.shown.left) { v.el.style.left = left; v.shown.left = left; }
    if (top !== null && top !== v.shown.top) { v.el.style.top = top; v.shown.top = top; }
  }

  function placeLabel(l: AxisLabel, lo: number, hi: number, axis: 'across' | 'up'): void {
    const room = hi - lo;
    const hide = room < MIN_LABEL_ROOM;
    const pos = hide ? '' : `${(lo + hi) / 2}px`;
    if (l.shown === pos && l.el.hidden === hide) return;
    l.shown = pos;
    l.el.hidden = hide;
    if (!hide) l.el.style[axis === 'across' ? 'left' : 'top'] = pos;
  }

  function render(state: SurfaceState): void {
    if (!last || last.snapshot !== state.snapshot || last.cards !== state.cards || last.across !== state.across
      || last.up !== state.up || last.colourBy !== state.colourBy) {
      rebuildModel(state);
      last = { snapshot: state.snapshot, cards: state.cards, across: state.across, up: state.up, colourBy: state.colourBy };
    } else if (needsSync) {
      syncParents();
    }
    const { vp, across, up } = state;
    const s = size();
    const detail = detailOf(vp.zoom);
    const W = s.w * vp.zoom, H = s.h * vp.zoom;

    const m = `${vp.panX}|${vp.panY}|${W}|${H}`;
    if (m !== shownMatrix) {
      shownMatrix = m;
      matrix.style.left = `${vp.panX}px`;
      matrix.style.top = `${vp.panY}px`;
      matrix.style.width = `${W}px`;
      matrix.style.height = `${H}px`;
    }

    for (const [id, v] of views) {
      if (lifted.has(id)) continue;
      const shown = v.shown;
      if (v.zone === 'tray') {
        if (shown.detail !== TRAY_DETAIL || shown.zone !== 'tray' || shown.card !== v.card || shown.colour !== v.colour) {
          v.el.className = 'mm-tray-card';
          v.el.dataset.zone = 'tray';
          v.el.dataset.detail = TRAY_DETAIL;
          v.el.style.setProperty('--c', v.colour);
          v.el.removeAttribute('title');
          v.el.removeAttribute('aria-label');
          v.el.style.left = ''; v.el.style.top = '';
          shown.left = ''; shown.top = '';
          v.el.textContent = v.card.name;
          shown.detail = TRAY_DETAIL; shown.zone = 'tray'; shown.card = v.card; shown.colour = v.colour;
        }
        continue;
      }
      if (shown.detail !== detail || shown.zone !== v.zone || shown.card !== v.card || shown.colour !== v.colour) {
        v.el.className = 'mm-card';
        v.el.dataset.zone = v.zone;
        v.el.dataset.detail = detail;
        v.el.style.setProperty('--c', v.colour);
        v.el.setAttribute('aria-label', v.card.name);
        if (detail === 'dot') v.el.title = v.card.name; else v.el.removeAttribute('title');
        cardContent(v, detail, state);
        shown.detail = detail; shown.zone = v.zone; shown.card = v.card; shown.colour = v.colour;
        shown.left = ''; shown.top = '';                // the zone may have changed which coordinates are set
        v.el.style.left = ''; v.el.style.top = '';
      }
      if (v.zone === 'matrix') {
        const p = toScreen(v.x!, v.y!, vp, s);
        setStyle(v, `${p.left}px`, `${p.top}px`);
      } else if (v.zone === 'leftStrip') {
        setStyle(v, null, `${toScreen(0, v.y!, vp, s).top}px`);
      } else {
        setStyle(v, `${toScreen(v.x!, 0, vp, s).left}px`, null);
      }
    }

    // Labels are clamped to the part of their section that is on screen.
    const nx = across.levels.length, ny = up.levels.length;
    acrossLabels.forEach((l, i) => {
      placeLabel(l, Math.max(vp.panX + (i / nx) * W, 0), Math.min(vp.panX + ((i + 1) / nx) * W, s.w), 'across');
    });
    upLabels.forEach((l, j) => {
      placeLabel(l, Math.max(vp.panY + ((ny - 1 - j) / ny) * H, 0), Math.min(vp.panY + ((ny - j) / ny) * H, s.h), 'up');
    });
  }

  // ---- dragging: the drag module decides what moves where; the surface owns the elements ----

  function placementOf(cardId: string): PlacedCard | undefined {
    const v = views.get(cardId);
    return v && { card: v.card, zone: v.zone, x: v.x, y: v.y };
  }

  function dropTargetAt(clientX: number, clientY: number): DropTarget | null {
    const over = (e: HTMLElement) => {
      const r = e.getBoundingClientRect();
      return clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom;
    };
    if (over(tray)) return { zone: 'tray' };
    if (over(stripLeft)) return { zone: 'leftStrip' };
    if (over(stripBottom)) return { zone: 'bottomStrip' };
    if (!over(clip)) return null;
    // The section under the pointer, read from the matrix as drawn (a pointer past its edge counts as the nearest section).
    const r = matrix.getBoundingClientRect();
    const nx = Math.max(1, acrossLabels.length), ny = Math.max(1, upLabels.length);
    const at = (v: number, lo: number, len: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(((v - lo) / len) * n)));
    return { zone: 'matrix', i: at(clientX, r.left, r.width, nx), j: ny - 1 - at(clientY, r.top, r.height, ny) };
  }

  function setDropTarget(target: DropTarget | null): void {
    let next: HTMLElement | null = null;
    if (target?.zone === 'matrix') next = sections[target.i * upLabels.length + target.j] ?? null;
    else if (target?.zone === 'leftStrip') next = stripLeft;
    else if (target?.zone === 'bottomStrip') next = stripBottom;
    else if (target?.zone === 'tray') next = tray;
    if (next === hot) return;
    hot?.classList.remove('hot');
    next?.classList.add('hot');
    hot = next;
  }

  function lift(cardId: string): DOMRect | null {
    const v = views.get(cardId);
    if (!v || lifted.has(cardId)) return null;
    const rect = v.el.getBoundingClientRect();
    lifted.add(cardId);
    v.el.dataset.dragging = '';
    v.el.style.transform = 'none';                    // positioned by its top-left corner, whatever zone it came from
    v.el.style.width = `${rect.width}px`;
    dragLayer.append(v.el);
    return rect;
  }

  function moveLifted(cardId: string, left: number, top: number): void {
    const v = views.get(cardId);
    if (!v || !lifted.has(cardId)) return;
    v.el.style.left = `${left}px`;
    v.el.style.top = `${top}px`;
  }

  function release(cardId: string): void {
    const v = views.get(cardId);
    if (!lifted.delete(cardId) || !v) return;
    delete v.el.dataset.dragging;
    v.el.style.transform = '';
    v.el.style.width = '';
    v.shown.detail = '';                              // the next render rewrites its class and position
    needsSync = true;
  }

  function destroy(): void {
    tray.remove();
    stage.remove();
    dragLayer.remove();
    views.clear();
    lifted.clear();
  }

  return { stage, size, pointInMatrix, render, placementOf, dropTargetAt, setDropTarget, lift, moveLifted, release, destroy };
}
