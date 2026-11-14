import { describe, expect, test } from 'vitest';
import { sampleSnapshot } from '../../src/store/sample-data';
import { shareUnchanged } from '../../src/view/snapshot-share';

const prev = sampleSnapshot();
const again = () => structuredClone(prev);

describe('shareUnchanged', () => {
  test('an identical snapshot comes back as the previous one', () => {
    expect(shareUnchanged(prev, again())).toBe(prev);
  });

  test('a changed card is the new one, every other card and list keeps its identity', () => {
    const next = again();
    next.cards.find(c => c.id === 'c4')!.name = 'Renamed';
    const shared = shareUnchanged(prev, next);
    expect(shared).not.toBe(prev);
    expect(shared.cards).not.toBe(prev.cards);
    expect(shared.cards.find(c => c.id === 'c4')!.name).toBe('Renamed');
    expect(shared.cards.find(c => c.id === 'c4')).not.toBe(prev.cards.find(c => c.id === 'c4'));
    expect(shared.cards.find(c => c.id === 'c1')).toBe(prev.cards.find(c => c.id === 'c1'));
    expect(shared.cards.find(c => c.id === 'c2')).toBe(prev.cards.find(c => c.id === 'c2'));
    expect(shared.lists).toBe(prev.lists);
    expect(shared.labels).toBe(prev.labels);
    expect(shared.members).toBe(prev.members);
    expect(shared.parameters).toBe(prev.parameters);
    expect(shared.dropdownFields).toBe(prev.dropdownFields);
    expect(shared.placements).toBe(prev.placements);
  });

  test('new, removed and reordered cards are what the new snapshot says', () => {
    const next = again();
    const removed = next.cards.shift()!;
    next.cards.push({ ...removed, id: 'cNew' });
    next.cards.reverse();
    const shared = shareUnchanged(prev, next);
    expect(shared.cards.map(c => c.id)).toEqual(next.cards.map(c => c.id));
    expect(shared.cards.find(c => c.id === removed.id)).toBeUndefined();
    expect(shared.cards.find(c => c.id === 'c2')).toBe(prev.cards.find(c => c.id === 'c2'));
  });

  test('a changed part is replaced and the parts around it are kept', () => {
    const next = again();
    next.parameters[0]!.levels[0] = 'Lowest';
    next.placements.c1!.positions['f-cost'] = 0.1;
    next.canEdit = false;
    const shared = shareUnchanged(prev, next);
    expect(shared.parameters).not.toBe(prev.parameters);
    expect(shared.parameters[0]!.levels[0]).toBe('Lowest');
    expect(shared.placements).not.toBe(prev.placements);
    expect(shared.placements.c1!.positions['f-cost']).toBe(0.1);
    expect(shared.placements.c2).toBe(prev.placements.c2);                       // a card's own placement that did not change
    expect(shared.canEdit).toBe(false);
    expect(shared.cards).toBe(prev.cards);
    expect(shared.lists).toBe(prev.lists);
  });
});
