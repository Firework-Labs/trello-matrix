import { describe, expect, test } from 'vitest';
import { sampleSnapshot } from '../../src/store/sample-data';
import { withMove } from '../../src/view/drag';

const snap = sampleSnapshot();
const cost = snap.parameters.find(p => p.id === 'f-cost')!;
const value = snap.parameters.find(p => p.id === 'f-value')!;
const card = (s: typeof snap, id: string) => s.cards.find(c => c.id === id)!;

describe('withMove', () => {
  test('sets and clears field values and leaves other cards the same objects', () => {
    const next = withMove(snap, 'c1', [{ param: cost, level: 1 }, { param: value, level: null }], null);
    expect(card(next, 'c1').fieldOptions).toEqual({ ...card(snap, 'c1').fieldOptions, 'f-cost': 'k1', 'f-value': undefined });
    expect('f-value' in card(next, 'c1').fieldOptions).toBe(false);
    expect(card(snap, 'c1').fieldOptions['f-cost']).toBe('k2');                       // the old snapshot is untouched
    expect(card(next, 'c2')).toBe(card(snap, 'c2'));
    expect(next.placements).toBe(snap.placements);
    expect(next.labels).toBe(snap.labels);
  });

  test('saves positions, and null forgets one; a card with none left has no placement', () => {
    const saved = withMove(snap, 'c1', [], { 'f-cost': 0.4, 'f-value': 0.6 });
    expect(saved.placements.c1).toEqual({ positions: { 'f-cost': 0.4, 'f-value': 0.6 } });
    expect(saved.cards).toBe(snap.cards);
    const forgot = withMove(saved, 'c1', [], { 'f-cost': null, 'f-value': 0.6 });
    expect(forgot.placements.c1).toEqual({ positions: { 'f-value': 0.6 } });
    const none = withMove(forgot, 'c1', [], { 'f-cost': null, 'f-value': null });
    expect('c1' in none.placements).toBe(false);
    expect(Object.keys(saved.placements)).toContain('c1');                            // earlier snapshots keep theirs
  });

  test('with nothing to apply it returns the same snapshot', () => {
    expect(withMove(snap, 'c1', [], null)).toBe(snap);
  });
});
