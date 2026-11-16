// Reordering a board's lists and undoing it. This file holds the sequence of steps; every read and write it needs
// comes in through `ReorderIo`, so the store decides how each one is made, locked and reported.
import { positionsFor } from '../model/resequence';
import type { BoardSnapshot } from '../model/types';
import { StoreError, type ListOrder, type Progress } from '../store/board-store';
import { decodeCard, type StoredCard, type StoredReorder } from './plugin-data';

/** Returned by an `updateCard` change to leave the card's stored value as it is (nothing is written). */
export const KEEP = Symbol('keep');

export interface ReorderIo {
  /** A fresh read of the board with every card's stored value (raw, by card id). */
  fresh(): Promise<{ snapshot: BoardSnapshot; cardData: Record<string, unknown>; unreadable: Set<string> }>;
  getMarker(): Promise<StoredReorder | null>;
  putMarker(marker: StoredReorder): Promise<void>;
  /** Removes the marker, but only if it is still the one with this id. */
  dropMarker(gen: string): Promise<void>;
  /** Reads the card's stored value now and writes what `change` returns (or nothing for KEEP; null removes it). */
  updateCard(cardId: string, change: (stored: StoredCard) => StoredCard | null | typeof KEEP): Promise<void>;
  /** Sets the card's list position in Trello and notes it so a read shows it before Trello's own data does. */
  moveCard(cardId: string, pos: number, was: number): Promise<void>;
  newId(): string;
}

export interface Reorderer {
  reorder(orders: ListOrder[], onProgress: (p: Progress) => void): Promise<void>;
  undo(onProgress: (p: Progress) => void): Promise<void>;
}

/** A card's stored value holds its saved positions and the position to undo to, so acting on a guess about it is never safe. */
const UNREADABLE = 'Some cards could not be read. Nothing was changed. Try again.';

export function createReorderer(io: ReorderIo): Reorderer {
  return {
    async reorder(orders, onProgress) {
      const { snapshot, unreadable } = await io.fresh();
      const cards = new Map(snapshot.cards.map(c => [c.id, c] as const));
      const lists = new Set(snapshot.lists.map(l => l.id));
      const wanted = new Map<string, string[]>();                 // a list named twice is ordered once, by its last order
      for (const order of orders) {
        if (!lists.has(order.listId)) throw new StoreError('invalid', 'That list is no longer on the board.');
        wanted.set(order.listId, order.cardIds);
      }
      const plan: { cardId: string; pos: number }[] = [];
      for (const [listId, cardIds] of wanted) {
        const ids = [...new Set(cardIds)].filter(id => cards.get(id)?.idList === listId);
        plan.push(...positionsFor(ids));
      }
      if (plan.length === 0) return;
      // A card read as having no data would get a stored value built from nothing, wiping the positions it has.
      if (plan.some(({ cardId }) => unreadable.has(cardId))) throw new StoreError('network', UNREADABLE);

      // An unfinished reorder is being retried: keep its id, so the positions it already saved are kept.
      const marker = await io.getMarker();
      const gen = marker !== null && !marker.complete ? marker.gen : io.newId();
      await io.putMarker({ gen, complete: false });

      let done = 0;
      for (const { cardId, pos } of plan) {
        const was = cards.get(cardId)!.pos;
        await io.updateCard(cardId, stored => (stored.gen === gen ? KEEP : { ...stored, prev: was, gen }));
        if (was !== pos) await io.moveCard(cardId, pos, was);
        onProgress({ done: ++done, total: plan.length });
      }
      await io.putMarker({ gen, complete: true });
    },

    async undo(onProgress) {
      const marker = await io.getMarker();
      if (marker === null) throw new StoreError('invalid', 'There is no reorder to undo.');
      const { snapshot, cardData, unreadable } = await io.fresh();
      // Which cards belong to the reorder is known only from their stored values, so one that cannot be read may be one of them.
      if (unreadable.size > 0) throw new StoreError('network', UNREADABLE);
      const todo: { cardId: string; was: number; prev: number }[] = [];
      for (const card of snapshot.cards) {
        if (!Object.hasOwn(cardData, card.id)) continue;
        const stored = decodeCard(cardData[card.id]);
        if (stored.gen === marker.gen && stored.prev !== undefined) todo.push({ cardId: card.id, was: card.pos, prev: stored.prev });
      }
      let done = 0;
      for (const { cardId, was, prev } of todo) {
        if (was !== prev) await io.moveCard(cardId, prev, was);
        // What was saved for this reorder is cleared; the card's positions on the matrix stay.
        await io.updateCard(cardId, stored => (stored.gen === marker.gen ? { p: stored.p } : KEEP));
        onProgress({ done: ++done, total: todo.length });
      }
      await io.dropMarker(marker.gen);
    },
  };
}
