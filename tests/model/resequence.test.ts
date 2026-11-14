import { expect, test } from 'vitest';
import type { Card, Located } from '../../src/model/types';
import { positionsFor, resequenceList } from '../../src/model/resequence';

const cardWithId = (id: string): Card =>
  ({ id, name: id, idList: 'l', pos: 1, labelIds: [], memberIds: [], hasCover: false, fieldOptions: {} });

test('placed cards go nearest the top-right first, then unplaced in their old order', () => {
  const at: Record<string, Located> = {
    a: { zone: 'tray', x: null, y: null }, b: { zone: 'matrix', x: 0.9, y: 0.1 }, c: { zone: 'matrix', x: 0.5, y: 0.5 },
    d: { zone: 'leftStrip', x: null, y: 0.99 }, e: { zone: 'matrix', x: 0.9, y: 0.9 },
  };
  const r = resequenceList(['a', 'b', 'c', 'd', 'e'].map(cardWithId), c => at[c.id]!);
  expect(r.map(x => x.cardId)).toEqual(['e', 'c', 'b', 'a', 'd']);
  expect(r[0]).toEqual({ cardId: 'e', oldIndex: 4, newIndex: 0, placed: true });
  expect(r[3]).toMatchObject({ cardId: 'a', placed: false });
});
test('equal distances keep their current order', () => {
  const same: Located = { zone: 'matrix', x: 0.5, y: 0.5 };
  expect(resequenceList(['a', 'b', 'c'].map(cardWithId), () => same).map(x => x.cardId)).toEqual(['a', 'b', 'c']);
});
test('a card in a strip with one coordinate known is not placed', () => {
  const at: Record<string, Located> = {
    a: { zone: 'bottomStrip', x: 1, y: null }, b: { zone: 'leftStrip', x: null, y: 1 }, c: { zone: 'matrix', x: 0.2, y: 0.2 },
  };
  const r = resequenceList(['a', 'b', 'c'].map(cardWithId), c => at[c.id]!);
  expect(r.map(x => [x.cardId, x.placed])).toEqual([['c', true], ['a', false], ['b', false]]);
});
test('positionsFor gives ascending positive positions', () => {
  expect(positionsFor(['x', 'y'])).toEqual([{ cardId: 'x', pos: 16384 }, { cardId: 'y', pos: 32768 }]);
});
