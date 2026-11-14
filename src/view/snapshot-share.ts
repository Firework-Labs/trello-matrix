import type { BoardSnapshot } from '../model/types';

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Each item of `next` that equals the item with the same id in `prev` is that item; the array is `prev` itself when nothing differs. */
function keepItems<T extends { id: string }>(prev: T[], next: T[]): T[] {
  const before = new Map(prev.map(item => [item.id, item]));
  const items = next.map(item => { const old = before.get(item.id); return old && same(old, item) ? old : item; });
  return items.length === prev.length && items.every((item, i) => item === prev[i]) ? prev : items;
}

function keepPlacements(prev: BoardSnapshot['placements'], next: BoardSnapshot['placements']): BoardSnapshot['placements'] {
  const ids = Object.keys(next);
  const merged = Object.fromEntries(ids.map(id => [id, prev[id] && same(prev[id], next[id]) ? prev[id]! : next[id]!]));
  return ids.length === Object.keys(prev).length && ids.every(id => merged[id] === prev[id]) ? prev : merged;
}

/**
 * The snapshot just read, built to share everything that did not change with the one on screen: a list, card or placement
 * that is equal keeps its old identity, and the snapshot itself is the old one when nothing differs. The view redraws
 * by identity, so a snapshot that only repeats what is shown (the echo of this person's own write, or a poll that found
 * nothing new) touches nothing.
 */
export function shareUnchanged(prev: BoardSnapshot, next: BoardSnapshot): BoardSnapshot {
  const merged: BoardSnapshot = {
    lists: keepItems(prev.lists, next.lists),
    cards: keepItems(prev.cards, next.cards),
    labels: keepItems(prev.labels, next.labels),
    members: keepItems(prev.members, next.members),
    dropdownFields: keepItems(prev.dropdownFields, next.dropdownFields),
    parameters: keepItems(prev.parameters, next.parameters),
    placements: keepPlacements(prev.placements, next.placements),
    canEdit: next.canEdit,
    canUndoReorder: next.canUndoReorder,
  };
  const unchanged = (Object.keys(merged) as (keyof BoardSnapshot)[]).every(key => merged[key] === prev[key]);
  return unchanged ? prev : merged;
}
