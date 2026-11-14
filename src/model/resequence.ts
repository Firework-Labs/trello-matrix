import type { Card, Located } from './types';

export interface RankedCard { cardId: string; oldIndex: number; newIndex: number; placed: boolean }

/** Gap between consecutive Trello positions, so a card can be inserted between two others later. */
const POSITION_STEP = 16384;

/**
 * The new order of a list's cards. Cards placed on the matrix come first, nearest the
 * top-right corner first; equal distances keep their current order. Cards not placed
 * (in a strip, in the tray, or with a coordinate missing) follow in their old order.
 */
export function resequenceList(cardsInListOrder: Card[], locate: (c: Card) => Located): RankedCard[] {
  const placed: { cardId: string; oldIndex: number; distance: number }[] = [];
  const unplaced: { cardId: string; oldIndex: number }[] = [];
  cardsInListOrder.forEach((card, oldIndex) => {
    const at = locate(card);
    if (at.zone === 'matrix' && at.x !== null && at.y !== null) {
      placed.push({ cardId: card.id, oldIndex, distance: Math.hypot(1 - at.x, 1 - at.y) });
    } else {
      unplaced.push({ cardId: card.id, oldIndex });
    }
  });
  // Array.prototype.sort is stable, so equal distances keep their current order.
  placed.sort((a, b) => a.distance - b.distance);
  return [
    ...placed.map(p => ({ cardId: p.cardId, oldIndex: p.oldIndex, placed: true })),
    ...unplaced.map(u => ({ cardId: u.cardId, oldIndex: u.oldIndex, placed: false })),
  ].map((entry, newIndex) => ({ ...entry, newIndex }));
}

/** Trello positions for an ordered list of card ids: ascending, positive, evenly spaced. */
export function positionsFor(orderedCardIds: string[]): { cardId: string; pos: number }[] {
  return orderedCardIds.map((cardId, i) => ({ cardId, pos: (i + 1) * POSITION_STEP }));
}
