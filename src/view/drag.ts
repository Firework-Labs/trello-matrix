import { planDrop, type DropPlan, type LevelChange } from '../model/drop';
import type { BoardSnapshot, Card, Parameter, ParamId } from '../model/types';
import type { BoardStore } from '../store/board-store';
import type { DropTarget, PlacedCard, Surface } from './surface';
import { showToast } from './toast';
import { toModel, toScreen, type Viewport } from './viewport';

/** A pointer that stays within this many px of where it went down is a click, not a drag. */
export const CLICK_SLOP = 4;

export interface DragContext {
  /** The element that receives the pointer events and holds the pointer capture; it contains the cards and the tray. */
  host: HTMLElement;
  surface: Surface;
  store: Pick<BoardStore, 'setLevel' | 'savePositions'>;
  /** What the view shows right now. */
  view(): { snapshot: BoardSnapshot; across: Parameter; up: Parameter; vp: Viewport };
  /**
   * Lays what a drop saved over the snapshot as it is now (not as it was when the drop began: the other person's
   * changes may have arrived meanwhile, and a snapshot read before the writes finished must not undo them). Does not draw.
   */
  applyWrite(change: (snapshot: BoardSnapshot) => BoardSnapshot): void;
  renderNow(): void;
  /** Whether this person can change the board right now. When not, cards are not lifted and nothing is written. */
  canEdit(): boolean;
  /** Whether the card is still in the cards that are plotted (it may have been archived or moved to another list by the other person). */
  isPlotted(cardId: string): boolean;
  /** A press and release on a card without a drag. */
  onCardClick(cardId: string): void;
  signal: AbortSignal;
}

/**
 * The snapshot as the store holds it after these writes: the levels that were set, then the
 * positions (null forgets one; a card left with none has no placement). Cards that did not change keep their identity.
 */
export function withMove(
  snapshot: BoardSnapshot, cardId: string, levels: LevelChange[], positions: Record<ParamId, number | null> | null,
): BoardSnapshot {
  let next = snapshot;
  if (levels.length) {
    next = {
      ...next,
      cards: next.cards.map(card => {
        if (card.id !== cardId) return card;
        const fieldOptions = { ...card.fieldOptions };
        for (const { param, level } of levels) {
          const optionId = level === null ? undefined : param.optionIds[level];
          if (optionId === undefined) delete fieldOptions[param.fieldId];
          else fieldOptions[param.fieldId] = optionId;
        }
        return { ...card, fieldOptions };
      }),
    };
  }
  if (positions) {
    const stored = { ...next.placements[cardId]?.positions };
    for (const [paramId, v] of Object.entries(positions)) {
      if (v === null) delete stored[paramId];
      else stored[paramId] = v;
    }
    const placements = { ...next.placements };
    if (Object.keys(stored).length === 0) delete placements[cardId];
    else placements[cardId] = { positions: stored };
    next = { ...next, placements };
  }
  return next;
}

interface Press {
  pointerId: number;
  cardId: string;
  startX: number;
  startY: number;
  placed: PlacedCard;           // where the card was when the pointer went down
  /**
   * Where the card's position on each axis was drawn when the pointer went down, in page pixels
   * (null on an axis it had no position on). The lifted card follows the pointer in page pixels,
   * so this plus the pointer's travel is where it is shown, whatever the viewport does meanwhile.
   */
  anchor: { x: number | null; y: number | null };
  /** Set once the pointer has moved CLICK_SLOP: the card's page rectangle at that moment. */
  lifted: DOMRect | null;
  /** The two axis parameters when the pointer went down: the anchor above is measured on these. */
  axes: { across: ParamId; up: ParamId };
  /** The pointer went CLICK_SLOP away without a card being lifted (nobody can drag here): not a click either. */
  strayed: boolean;
}

/**
 * Dragging a card between the matrix, the strips and the tray. A press that moves less than CLICK_SLOP
 * px is a click; one that goes further becomes a drag and stays one. The card follows the pointer's
 * travel, and on release the drop zone is found from the pointer's own position.
 */
export function attachDrag(ctx: DragContext): void {
  const { host, surface, signal } = ctx;
  let press: Press | null = null;

  function end(): void {
    if (press) { try { host.releasePointerCapture(press.pointerId); } catch { /* capture already gone */ } }
    press = null;
  }

  /** Puts a lifted card back where the model says it is. */
  function putBack(cardId: string): void {
    surface.setDropTarget(null);
    surface.release(cardId);
    ctx.renderNow();
  }

  function cancel(): void {
    const p = press;
    end();
    if (p?.lifted) putBack(p.cardId);
  }

  host.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 || !ev.isPrimary) return;
    const cardId = (ev.target as Element).closest<HTMLElement>('[data-card-id]')?.dataset.cardId;
    const placed = cardId === undefined ? undefined : surface.placementOf(cardId);
    if (cardId === undefined || !placed) return;
    cancel();                                                 // a stale press whose release never arrived
    press = { pointerId: ev.pointerId, cardId, startX: ev.clientX, startY: ev.clientY, placed, anchor: anchorOf(placed), lifted: null, strayed: false, axes: axesNow() };
    host.setPointerCapture(ev.pointerId);
  }, { signal });

  host.addEventListener('pointermove', ev => {
    if (!press || ev.pointerId !== press.pointerId) return;
    if (!(ev.buttons & 1)) { cancel(); return; }               // the button went up without us hearing about it
    const dx = ev.clientX - press.startX, dy = ev.clientY - press.startY;
    if (!press.lifted) {
      if (Math.hypot(dx, dy) < CLICK_SLOP) return;
      if (!ctx.canEdit()) { press.strayed = true; return; }
      press.lifted = surface.lift(press.cardId);
      if (!press.lifted) { end(); return; }
    }
    surface.moveLifted(press.cardId, press.lifted.left + dx, press.lifted.top + dy);
    surface.setDropTarget(surface.dropTargetAt(ev.clientX, ev.clientY));
  }, { signal });

  host.addEventListener('pointerup', ev => {
    if (!press || ev.pointerId !== press.pointerId || ev.button !== 0) return;
    const p = press;
    end();
    if (!p.lifted) {
      if (!p.strayed) ctx.onCardClick(p.cardId);
      return;
    }
    surface.setDropTarget(null);
    void drop(p, ev.clientX, ev.clientY);
  }, { signal });

  host.addEventListener('pointercancel', ev => {
    if (press && ev.pointerId === press.pointerId) cancel();
  }, { signal });

  function axesNow(): Press['axes'] {
    const { across, up } = ctx.view();
    return { across: across.id, up: up.id };
  }

  function anchorOf(placed: PlacedCard): Press['anchor'] {
    const { vp } = ctx.view();
    const size = surface.size();
    const origin = surface.pointInMatrix(0, 0);              // minus the matrix area's page position
    return {
      x: placed.x === null ? null : toScreen(placed.x, 0, vp, size).left - origin.x,
      y: placed.y === null ? null : toScreen(0, placed.y, vp, size).top - origin.y,
    };
  }

  /**
   * Where the card goes, in model positions: it moves by the pointer's travel on an axis it already had
   * a position on, and takes the pointer's own position on one it had none on. The travel is added to
   * where the card was drawn (in page pixels) and converted with the viewport as it is now, so if the
   * view was zoomed during the drag the saved position is still where the card is shown. Null when a
   * position cannot be computed (a stage with no size), so nothing is ever planned from a non-finite number.
   */
  function planFor(p: Press, card: Card, target: DropTarget, clientX: number, clientY: number): DropPlan | null {
    const { across, up, vp } = ctx.view();
    const size = surface.size();
    const pointer = surface.pointInMatrix(clientX, clientY);
    const at = toModel(pointer.x, pointer.y, vp, size);
    const origin = surface.pointInMatrix(0, 0);
    const x = p.anchor.x === null ? at.x : toModel(p.anchor.x + (clientX - p.startX) + origin.x, 0, vp, size).x;
    const y = p.anchor.y === null ? at.y : toModel(0, p.anchor.y + (clientY - p.startY) + origin.y, vp, size).y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return planDrop({ card, across, up, zone: target.zone, x, y });
  }

  async function drop(p: Press, clientX: number, clientY: number): Promise<void> {
    // The card may have gone while it was in the hand (archived, or moved to a list that is not plotted): then the drop is discarded.
    // The levels it has now, not the ones it had at the press, decide what is written.
    const current = ctx.isPlotted(p.cardId) ? surface.placementOf(p.cardId) : undefined;
    const target = surface.dropTargetAt(clientX, clientY);
    // The other person changed an axis while the card was in the hand: the spot it was dragged to means something else now.
    if (current && (axesNow().across !== p.axes.across || axesNow().up !== p.axes.up)) {
      putBack(p.cardId);
      showToast('The axes changed while you were dragging. Nothing was moved.');
      return;
    }
    // Outside every zone, or from the tray back into the tray (as it is now, not as it was at the press), or nothing may be written: nothing to write.
    const plan = current && ctx.canEdit() && target && !(target.zone === 'tray' && current.zone === 'tray')
      ? planFor(p, current.card, target, clientX, clientY) : null;
    if (!plan) { putBack(p.cardId); return; }

    // The card stays where it was dropped while the writes run.
    const written: LevelChange[] = [];
    let failure: unknown = null;
    try {
      for (const change of plan.levels) {
        await ctx.store.setLevel(p.cardId, change.param, change.level);
        written.push(change);
      }
      await ctx.store.savePositions(p.cardId, plan.positions);
    } catch (error) {
      failure = error;                                        // stop at the first rejected call
    }
    if (signal.aborted) return;

    // Whatever was saved is in the snapshot, so the view never shows something the store does not hold.
    const saved = failure === null;
    if (saved || written.length) {
      const positions = saved ? plan.positions : null;
      ctx.applyWrite(snapshot => snapshot.cards.some(c => c.id === p.cardId) ? withMove(snapshot, p.cardId, written, positions) : snapshot);
    }
    surface.release(p.cardId);
    ctx.renderNow();
    if (saved) {
      if (plan.message) showToast(plan.message);
    } else {
      const reason = failure instanceof Error ? failure.message : String(failure);
      showToast(`Couldn't save the move. ${reason}`, 'error');
    }
  }
}
