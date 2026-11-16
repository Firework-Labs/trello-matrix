import { describe, expect, test } from 'vitest';
import { createOverlay } from '../../src/trello/overlay';
import type { BoardSnapshot, Card, DropdownField } from '../../src/model/types';

let t = 0;
const now = () => t;
const advance = (ms: number) => { t += ms; };

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

const fieldF1: DropdownField = { id: 'f1', name: 'Value', options: [{ id: 'oLow', text: 'Low', colour: 'none' }, { id: 'oMed', text: 'Medium', colour: 'none' }, { id: 'oHigh', text: 'High', colour: 'none' }] };

/** A frozen snapshot with one card per key of `cards` (card id → its dropdown values), so any write to it throws. */
function snap(cards: Record<string, Record<string, string>>, fields: DropdownField[] = [], pos: Record<string, number> = {}): BoardSnapshot {
  const list: Card[] = Object.entries(cards).map(([id, fieldOptions]) => ({
    id, name: id, idList: 'l1', pos: pos[id] ?? 100, labelIds: [], memberIds: [], hasCover: false, fieldOptions,
  }));
  return deepFreeze({
    lists: [{ id: 'l1', name: 'Backlog' }], cards: list, labels: [], members: [],
    dropdownFields: fields, parameters: [], placements: {}, canEdit: true, canUndoReorder: false,
  });
}

const fieldOf = (s: BoardSnapshot, card: string, field: string) => s.cards.find(c => c.id === card)!.fieldOptions[field];

describe('dropdown values', () => {
  test('a stale snapshot gets our value; a caught-up one does not and the note is forgotten', () => {
    const o = createOverlay({ now }); o.noteFieldOption('c1', 'f1', 'oHigh', 'oLow');
    const stale = snap({ c1: { f1: 'oLow' } });
    expect(o.apply(stale).cards[0]!.fieldOptions.f1).toBe('oHigh'); expect(stale.cards[0]!.fieldOptions.f1).toBe('oLow');   // input untouched
    expect(o.pending()).toBe(1);
    const fresh = snap({ c1: { f1: 'oHigh' } });
    expect(o.apply(fresh)).toBe(fresh); expect(o.pending()).toBe(0);
  });

  test('the note is kept while the snapshot stays stale, and applies again', () => {
    const o = createOverlay({ now }); o.noteFieldOption('c1', 'f1', 'oHigh', 'oLow');
    expect(fieldOf(o.apply(snap({ c1: { f1: 'oLow' } })), 'c1', 'f1')).toBe('oHigh');
    expect(fieldOf(o.apply(snap({ c1: { f1: 'oLow' } })), 'c1', 'f1')).toBe('oHigh');
    expect(o.pending()).toBe(1);
  });

  test("someone else's later change wins over our note", () => {
    const o = createOverlay({ now }); o.noteFieldOption('c1', 'f1', 'oHigh', 'oLow');
    const theirs = snap({ c1: { f1: 'oMed' } });
    expect(o.apply(theirs)).toBe(theirs); expect(o.pending()).toBe(0);
    const later = snap({ c1: { f1: 'oLow' } });   // the old value coming back after that is theirs too
    expect(o.apply(later)).toBe(later);
  });

  test('someone else clearing the value after us wins too', () => {
    const o = createOverlay({ now }); o.noteFieldOption('c1', 'f1', 'oHigh', 'oLow');
    const cleared = snap({ c1: {} });
    expect(o.apply(cleared)).toBe(cleared); expect(o.pending()).toBe(0);
  });

  test('clearing a value is overlaid as a missing key, and setting from nothing works', () => {
    const o = createOverlay({ now }); o.noteFieldOption('c1', 'f1', null, 'oLow');
    expect('f1' in o.apply(snap({ c1: { f1: 'oLow' } })).cards[0]!.fieldOptions).toBe(false);
    const p = createOverlay({ now }); p.noteFieldOption('c1', 'f1', 'oLow', null);
    expect(p.apply(snap({ c1: {} })).cards[0]!.fieldOptions.f1).toBe('oLow');
  });

  test('a cleared value that has arrived is forgotten', () => {
    const o = createOverlay({ now }); o.noteFieldOption('c1', 'f1', null, 'oLow');
    const done = snap({ c1: {} });
    expect(o.apply(done)).toBe(done); expect(o.pending()).toBe(0);
  });

  test('other values on the card are kept when one is overlaid', () => {
    const o = createOverlay({ now }); o.noteFieldOption('c1', 'f1', 'oHigh', 'oLow');
    const r = o.apply(snap({ c1: { f1: 'oLow', f2: 'x' }, c2: { f1: 'oLow' } }));
    expect(r.cards[0]!.fieldOptions).toEqual({ f1: 'oHigh', f2: 'x' });
    expect(r.cards[1]!.fieldOptions).toEqual({ f1: 'oLow' });
  });

  test('a newer note for the same card and field replaces the older one', () => {
    const o = createOverlay({ now });
    o.noteFieldOption('c1', 'f1', 'oMed', 'oLow'); o.noteFieldOption('c1', 'f1', 'oHigh', 'oMed');
    expect(o.pending()).toBe(1);
    expect(fieldOf(o.apply(snap({ c1: { f1: 'oLow' } })), 'c1', 'f1')).toBe('oHigh');
    expect(fieldOf(o.apply(snap({ c1: { f1: 'oMed' } })), 'c1', 'f1')).toBe('oHigh');
    expect(o.pending()).toBe(1);
    const fresh = snap({ c1: { f1: 'oHigh' } });
    expect(o.apply(fresh)).toBe(fresh); expect(o.pending()).toBe(0);
  });

  test("after a newer note, a value that is none of the noted ones is someone else's and wins", () => {
    const o = createOverlay({ now });
    o.noteFieldOption('c1', 'f1', 'oMed', 'oLow'); o.noteFieldOption('c1', 'f1', 'oHigh', 'oMed');
    const theirs = snap({ c1: { f1: 'oOther' } });
    expect(o.apply(theirs)).toBe(theirs); expect(o.pending()).toBe(0);
    const p = createOverlay({ now });
    p.noteFieldOption('c1', 'f1', 'oMed', 'oLow'); p.noteFieldOption('c1', 'f1', 'oHigh', 'oMed');
    const cleared = snap({ c1: {} });   // nothing shown is not one of the noted values either
    expect(p.apply(cleared)).toBe(cleared); expect(p.pending()).toBe(0);
  });

  test('a value set and then set back stays overlaid while reads still show either of the two', () => {
    t = 0;
    const o = createOverlay({ now, ttlMs: 1000 });
    o.noteFieldOption('c1', 'f1', 'oB', 'oA'); o.noteFieldOption('c1', 'f1', 'oA', 'oB');   // A to B, then B back to A
    for (const shown of ['oA', 'oB', 'oA']) {
      expect(fieldOf(o.apply(snap({ c1: { f1: shown } })), 'c1', 'f1')).toBe('oA');
      expect(o.pending()).toBe(1);
    }
    const theirs = snap({ c1: { f1: 'oC' } });   // a third value is someone else's
    expect(o.apply(theirs)).toBe(theirs); expect(o.pending()).toBe(0);
  });

  test('a value set and then set back is forgotten after the time limit', () => {
    t = 0;
    const o = createOverlay({ now, ttlMs: 1000 });
    o.noteFieldOption('c1', 'f1', 'oB', 'oA'); o.noteFieldOption('c1', 'f1', 'oA', 'oB');
    advance(1001);
    const s = snap({ c1: { f1: 'oB' } });
    expect(o.apply(s)).toBe(s); expect(o.pending()).toBe(0);
  });

  test('a cleared value that was set back to nothing stays overlaid the same way', () => {
    const o = createOverlay({ now });
    o.noteFieldOption('c1', 'f1', 'oA', null); o.noteFieldOption('c1', 'f1', null, 'oA');   // nothing to A, then A cleared
    expect('f1' in o.apply(snap({ c1: {} })).cards[0]!.fieldOptions).toBe(false);
    expect(o.pending()).toBe(1);
    expect('f1' in o.apply(snap({ c1: { f1: 'oA' } })).cards[0]!.fieldOptions).toBe(false);
    expect(o.pending()).toBe(1);
  });

  test('notes on different fields of one card are independent', () => {
    const o = createOverlay({ now });
    o.noteFieldOption('c1', 'f1', 'a2', 'a1'); o.noteFieldOption('c1', 'f2', 'b2', 'b1');
    const r = o.apply(snap({ c1: { f1: 'a1', f2: 'b2' } }));
    expect(r.cards[0]!.fieldOptions).toEqual({ f1: 'a2', f2: 'b2' });
    expect(o.pending()).toBe(1);
  });

  test('a field id such as __proto__ or constructor cannot change behaviour', () => {
    const o = createOverlay({ now });
    o.noteFieldOption('c1', '__proto__', 'x', null); o.noteFieldOption('c1', 'constructor', 'y', null);
    const r = o.apply(snap({ c1: {} }));
    const fo = r.cards[0]!.fieldOptions;
    expect(Object.getPrototypeOf(fo)).toBe(Object.prototype);
    expect(Object.keys(fo).sort()).toEqual(['__proto__', 'constructor']);
    expect(Object.getOwnPropertyDescriptor(fo, '__proto__')!.value).toBe('x');
    expect(Object.getOwnPropertyDescriptor(fo, 'constructor')!.value).toBe('y');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    // An inherited member is not mistaken for a value that is shown: nothing is shown here, so our "from nothing" note is stale.
    const p = createOverlay({ now }); p.noteFieldOption('c1', 'toString', 'z', null);
    expect(Object.getOwnPropertyDescriptor(p.apply(snap({ c1: {} })).cards[0]!.fieldOptions, 'toString')!.value).toBe('z');
  });

  test('notes expire after the time limit', () => {
    t = 0;
    const o = createOverlay({ now, ttlMs: 1000 }); o.noteFieldOption('c1', 'f1', 'oHigh', 'oLow');
    advance(1001); const stale = snap({ c1: { f1: 'oLow' } });
    expect(o.apply(stale)).toBe(stale); expect(o.pending()).toBe(0);
  });

  test('a note is still in force at exactly the time limit, and the limit defaults to 15 seconds', () => {
    t = 0;
    const o = createOverlay({ now, ttlMs: 1000 }); o.noteFieldOption('c1', 'f1', 'oHigh', 'oLow');
    advance(1000);
    expect(fieldOf(o.apply(snap({ c1: { f1: 'oLow' } })), 'c1', 'f1')).toBe('oHigh');
    const d = createOverlay({ now }); d.noteFieldOption('c1', 'f1', 'oHigh', 'oLow');
    advance(15000);
    expect(fieldOf(d.apply(snap({ c1: { f1: 'oLow' } })), 'c1', 'f1')).toBe('oHigh');
    advance(1);
    expect(d.pending()).toBe(0);
  });

  test('a note for a card that is gone is forgotten', () => {
    const o = createOverlay({ now }); o.noteFieldOption('gone', 'f1', 'oHigh', 'oLow');
    const s = snap({ c1: { f1: 'oLow' } });
    expect(o.apply(s)).toBe(s); expect(o.pending()).toBe(0);
  });

  test('with nothing noted the same snapshot comes back', () => {
    const s = snap({ c1: { f1: 'oLow' } });
    expect(createOverlay({ now }).apply(s)).toBe(s);
  });
});

describe('list positions', () => {
  test('follow the same three rules', () => {
    t = 0;
    const o = createOverlay({ now }); o.noteCardPos('c1', 500, 100);
    const stale = snap({ c1: {} }, [], { c1: 100 });
    const r = o.apply(stale);
    expect(r.cards[0]!.pos).toBe(500); expect(stale.cards[0]!.pos).toBe(100); expect(o.pending()).toBe(1);
    const caughtUp = snap({ c1: {} }, [], { c1: 500 });
    expect(o.apply(caughtUp)).toBe(caughtUp); expect(o.pending()).toBe(0);
    o.noteCardPos('c1', 500, 100);
    const third = snap({ c1: {} }, [], { c1: 300 });
    expect(o.apply(third)).toBe(third); expect(o.pending()).toBe(0);
  });

  test('a newer position note replaces the older one', () => {
    const o = createOverlay({ now });
    o.noteCardPos('c1', 200, 100); o.noteCardPos('c1', 300, 200);
    expect(o.pending()).toBe(1);
    expect(o.apply(snap({ c1: {} }, [], { c1: 100 })).cards[0]!.pos).toBe(300);
    expect(o.apply(snap({ c1: {} }, [], { c1: 200 })).cards[0]!.pos).toBe(300);
  });

  test('a position set and then set back stays overlaid while reads show either, until a third value', () => {
    t = 0;
    const o = createOverlay({ now, ttlMs: 1000 });
    o.noteCardPos('c1', 200, 100); o.noteCardPos('c1', 100, 200);   // 100 to 200, then back to 100
    for (const shown of [100, 200, 100]) {
      expect(o.apply(snap({ c1: {} }, [], { c1: shown })).cards[0]!.pos).toBe(100);
      expect(o.pending()).toBe(1);
    }
    const theirs = snap({ c1: {} }, [], { c1: 300 });
    expect(o.apply(theirs)).toBe(theirs); expect(o.pending()).toBe(0);
    o.noteCardPos('c1', 200, 100); o.noteCardPos('c1', 100, 200);
    advance(1001);
    const late = snap({ c1: {} }, [], { c1: 200 });
    expect(o.apply(late)).toBe(late); expect(o.pending()).toBe(0);
  });

  test('expire, and are forgotten for a card that is gone', () => {
    t = 0;
    const o = createOverlay({ now, ttlMs: 1000 }); o.noteCardPos('c1', 500, 100); o.noteCardPos('gone', 5, 4);
    const s = snap({ c1: {} }, [], { c1: 100 });
    expect(o.apply(s).cards[0]!.pos).toBe(500); expect(o.pending()).toBe(1);
    advance(1001);
    expect(o.apply(s)).toBe(s); expect(o.pending()).toBe(0);
  });

  test('a position and a value on the same card are both applied', () => {
    const o = createOverlay({ now }); o.noteCardPos('c1', 500, 100); o.noteFieldOption('c1', 'f1', 'oHigh', 'oLow');
    const r = o.apply(snap({ c1: { f1: 'oLow' } }, [], { c1: 100 }));
    expect(r.cards[0]).toMatchObject({ pos: 500, fieldOptions: { f1: 'oHigh' } });
  });
});

describe('created fields', () => {
  const field: DropdownField = { id: 'f9', name: 'Risk', options: [{ id: 'a', text: 'Low', colour: 'none' }, { id: 'b', text: 'High', colour: 'none' }] };

  test('a created field is shown until the snapshot has it, and parameters are worked out again', () => {
    const o = createOverlay({ now }); const field = { id: 'f9', name: 'Risk', options: [{ id: 'a', text: 'Low', colour: 'none' }, { id: 'b', text: 'High', colour: 'none' }] };
    o.noteField(field);
    const r = o.apply(snap({}), [{ f: 'f9', o: ['b', 'a'] }]);
    expect(r.dropdownFields.some(f => f.id === 'f9')).toBe(true);
    expect(r.parameters).toContainEqual({ id: 'f9', name: 'Risk', levels: ['High', 'Low'], fieldId: 'f9', optionIds: ['b', 'a'] });
    const caughtUp = snap({}, [field]); o.apply(caughtUp, [{ f: 'f9', o: ['b', 'a'] }]); expect(o.pending()).toBe(0);
  });

  test('the snapshot keeps its own fields and the created one comes after them', () => {
    const o = createOverlay({ now }); o.noteField(field);
    const s = snap({}, [fieldF1]);
    const r = o.apply(s);
    expect(r.dropdownFields.map(f => f.id)).toEqual(['f1', 'f9']);
    expect(s.dropdownFields).toHaveLength(1);
    expect(o.pending()).toBe(1);
  });

  test('when the snapshot has the field it is not added twice, and the snapshot comes back as it was', () => {
    const o = createOverlay({ now }); o.noteField(field);
    const s = snap({}, [field]);
    expect(o.apply(s)).toBe(s); expect(o.pending()).toBe(0);
  });

  test('a created field is forgotten after the time limit', () => {
    t = 0;
    const o = createOverlay({ now, ttlMs: 1000 }); o.noteField(field);
    advance(1001);
    const s = snap({});
    expect(o.apply(s)).toBe(s); expect(o.pending()).toBe(0);
  });

  test('what apply returns is a copy: changing it does not change the note', () => {
    const o = createOverlay({ now });
    o.noteField(field);
    const first = o.apply(snap({})).dropdownFields[0]!;
    first.name = 'Mutated'; first.options[0]!.text = 'Mutated'; first.options.push({ id: 'z', text: 'Z', colour: 'none' });
    const second = o.apply(snap({})).dropdownFields[0]!;
    expect(second).toEqual(field);
    expect(second).not.toBe(first); expect(second.options).not.toBe(first.options);
  });

  test('the note keeps its own copy of the field', () => {
    const o = createOverlay({ now });
    const mine: DropdownField = { id: 'f9', name: 'Risk', options: [{ id: 'a', text: 'Low', colour: 'none' }, { id: 'b', text: 'High', colour: 'none' }] };
    o.noteField(mine);
    mine.name = 'Changed'; mine.options[0]!.text = 'Changed';
    expect(o.apply(snap({})).dropdownFields[0]).toEqual(field);
  });
});

describe('parameters', () => {
  test('are joined again from the stored list whenever it is given, even when nothing else is laid over', () => {
    const o = createOverlay({ now });
    const s = snap({ c1: {} }, [fieldF1]);
    const r = o.apply(s, [{ f: 'f1', o: ['oLow', 'oMed', 'oHigh'] }]);
    expect(r).not.toBe(s);
    expect(r.parameters).toEqual([{ id: 'f1', name: 'Value', levels: ['Low', 'Medium', 'High'], fieldId: 'f1', optionIds: ['oLow', 'oMed', 'oHigh'] }]);
    expect(r.cards).toBe(s.cards);
    expect(s.parameters).toEqual([]);
  });

  test('are the snapshot\'s own when no stored list is given', () => {
    const o = createOverlay({ now }); o.noteFieldOption('c1', 'f1', 'oHigh', 'oLow');
    const base = snap({ c1: { f1: 'oLow' } }, [fieldF1]);
    const withParams: BoardSnapshot = { ...base, parameters: [{ id: 'f1', name: 'Value', levels: ['Low', 'Medium', 'High'], fieldId: 'f1', optionIds: ['oLow', 'oMed', 'oHigh'] }] };
    expect(o.apply(withParams).parameters).toBe(withParams.parameters);
  });
});

describe('several notes', () => {
  test('on different cards are all applied in one pass', () => {
    const o = createOverlay({ now });
    o.noteFieldOption('c1', 'f1', 'oHigh', 'oLow'); o.noteFieldOption('c2', 'f1', null, 'oMed'); o.noteCardPos('c3', 900, 300);
    const s = snap({ c1: { f1: 'oLow' }, c2: { f1: 'oMed' }, c3: { f1: 'oLow' }, c4: { f1: 'oLow' } }, [], { c3: 300 });
    const r = o.apply(s);
    expect(r.cards[0]!.fieldOptions).toEqual({ f1: 'oHigh' });
    expect(r.cards[1]!.fieldOptions).toEqual({});
    expect(r.cards[2]).toMatchObject({ pos: 900, fieldOptions: { f1: 'oLow' } });
    expect(r.cards[3]).toBe(s.cards[3]);   // untouched cards are the same objects
    expect(o.pending()).toBe(3);
  });

  test('each is judged on its own: one caught up, one stale, one beaten by someone else', () => {
    const o = createOverlay({ now });
    o.noteFieldOption('c1', 'f1', 'oHigh', 'oLow'); o.noteFieldOption('c2', 'f1', 'oHigh', 'oLow'); o.noteFieldOption('c3', 'f1', 'oHigh', 'oLow');
    const r = o.apply(snap({ c1: { f1: 'oHigh' }, c2: { f1: 'oLow' }, c3: { f1: 'oMed' } }));
    expect(r.cards.map(c => c.fieldOptions.f1)).toEqual(['oHigh', 'oHigh', 'oMed']);
    expect(o.pending()).toBe(1);
  });
});
