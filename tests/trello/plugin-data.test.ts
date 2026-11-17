import { describe, expect, test } from 'vitest';
import {
  assertFits, decodeCard, decodeParams, decodeView, encodeCard, joinParameters,
  KEY_CARD, KEY_PARAMS, KEY_VIEW,
} from '../../src/trello/plugin-data';
import type { DropdownField, ViewSettings } from '../../src/model/types';

const fieldWith = (id: string, name: string, texts: string[]): DropdownField => ({
  id, name, options: texts.map((text, i) => ({ id: `${id}-o${i}`, text, colour: 'none' })),
});

const goodView: ViewSettings = {
  across: 'p1', up: null, listIds: ['l1', 'l2'], colourBy: { kind: 'list' },
  showImages: true, zoom: 1.5, panX: -20, panY: 30.5,
};

describe('keys', () => {
  test('the storage keys are the ones the store writes under', () => {
    expect([KEY_PARAMS, KEY_CARD, KEY_VIEW]).toEqual(['params', 'mx', 'view']);
  });
});

describe('decodeCard', () => {
  test('drops anything that is not a position in range', () => {
    expect(decodeCard('junk')).toEqual({});
    expect(decodeCard(null)).toEqual({});
    expect(decodeCard({ p: { a: 'x', b: 1.7, c: 0.5, d: -1, e: NaN } })).toEqual({ p: { c: 0.5 } });
  });
  test('keeps the ends of the range that are valid: 0 is a position, 1 is not', () => {
    expect(decodeCard({ p: { a: 0, b: 0.999, c: 1 } })).toEqual({ p: { a: 0, b: 0.999 } });
  });
  test('leaves out p when nothing in it is usable, and ignores a p that is not an object', () => {
    expect(decodeCard({ p: { a: 'x' } })).toEqual({});
    expect(Object.keys(decodeCard({ p: { a: 'x' } }))).toEqual([]);
    expect(decodeCard({ p: [0.5] })).toEqual({});
    expect(decodeCard({ p: 'x' })).toEqual({});
    expect(decodeCard([1, 2])).toEqual({});
  });
  test('ignores the `prev` and `gen` that cards stored by an earlier version still carry', () => {
    expect(decodeCard({ p: { c: 0.5 }, prev: 1234.5, gen: 'g1' })).toEqual({ p: { c: 0.5 } });
    expect(decodeCard({ prev: 1234.5, gen: 'g1' })).toEqual({});
  });
  test('a stored __proto__ key cannot change the result', () => {
    const raw = JSON.parse('{"p":{"__proto__":0.5,"a":0.2}}');
    const out = decodeCard(raw);
    expect(out).toEqual({ p: { a: 0.2 } });
    expect(Object.getPrototypeOf(out.p)).toBe(Object.prototype);
  });
});

describe('encodeCard', () => {
  test('rounds and returns null when empty', () => {
    expect(encodeCard({ p: { a: 0.123456 } })).toEqual({ p: { a: 0.123 } });
    expect(encodeCard({ p: {} })).toBeNull();
  });
  test('clamps to the stored range and returns null for an empty card', () => {
    expect(encodeCard({ p: { a: 2, b: -3 } })).toEqual({ p: { a: 0.999, b: 0 } });
    expect(encodeCard({})).toBeNull();
  });
  test('leaves out positions that are not numbers', () => {
    expect(encodeCard({ p: { a: NaN, b: 0.5 } })).toEqual({ p: { b: 0.5 } });
    expect(encodeCard({ p: { a: Infinity } })).toBeNull();
  });
  test('what encodeCard writes decodeCard reads back unchanged', () => {
    const c = { p: { a: 0.25, b: 0.999 } };
    expect(decodeCard(encodeCard(c))).toEqual(c);
  });
});

describe('decodeParams', () => {
  test('keeps only well-formed entries', () => {
    expect(decodeParams([{ f: 'a', o: ['1', '2'] }, { f: 'b', o: ['1'] }, { f: 3, o: ['1', '2'] }, 'x', { f: 'c', o: ['1', '2', '3', '4'] }]))
      .toEqual([{ f: 'a', o: ['1', '2'] }]);
    expect(decodeParams(undefined)).toEqual([]);
  });
  test('accepts three options, rejects option lists with non-strings, and anything that is not an array', () => {
    expect(decodeParams([{ f: 'a', o: ['1', '2', '3'] }])).toEqual([{ f: 'a', o: ['1', '2', '3'] }]);
    expect(decodeParams([{ f: 'a', o: ['1', 2] }, { f: 'b', o: 'ab' }, { f: 'c' }, null])).toEqual([]);
    expect(decodeParams({ f: 'a', o: ['1', '2'] })).toEqual([]);
    expect(decodeParams('junk')).toEqual([]);
  });
  test('drops extra properties of an entry', () => {
    expect(decodeParams([{ f: 'a', o: ['1', '2'], z: 1 }])).toEqual([{ f: 'a', o: ['1', '2'] }]);
  });
});

describe('joinParameters', () => {
  const fields = [fieldWith('f1', 'Value', ['Low', 'High'])];
  const optionIds = fields[0]!.options.map(o => o.id);   // f1-o0 (Low), f1-o1 (High)

  test('drops parameters whose field or options are gone', () => {
    const f = [{ id: 'f1', name: 'Value', options: [{ id: 'a', text: 'Low', colour: 'none' }, { id: 'b', text: 'High', colour: 'none' }] }];
    expect(joinParameters([{ f: 'f1', o: ['b', 'a'] }, { f: 'gone', o: ['x', 'y'] }, { f: 'f1', o: ['a', 'zzz'] }], f))
      .toEqual([{ id: 'f1', name: 'Value', levels: ['High', 'Low'], fieldId: 'f1', optionIds: ['b', 'a'] }]);
  });
  test('drops a parameter whose field gained an option', () => {
    const three = [fieldWith('f1', 'Value', ['Low', 'Mid', 'High'])];
    expect(joinParameters([{ f: 'f1', o: [three[0]!.options[0]!.id, three[0]!.options[2]!.id] }], three)).toEqual([]);
  });
  test('drops a parameter whose field lost an option', () => {
    const two = [fieldWith('f1', 'Value', ['Low', 'High'])];
    expect(joinParameters([{ f: 'f1', o: [...optionIds, 'f1-o2'] }], two)).toEqual([]);
    const one = [fieldWith('f1', 'Value', ['Low'])];
    expect(joinParameters([{ f: 'f1', o: ['f1-o0', 'f1-o1'] }], one)).toEqual([]);
  });
  test('uses the field as it is now: its name, and the option texts in the stored order', () => {
    const renamed = [fieldWith('f1', 'Effort (renamed)', ['Small', 'Medium', 'Large'])];
    const [p] = joinParameters([{ f: 'f1', o: ['f1-o2', 'f1-o1', 'f1-o0'] }], renamed);
    expect(p).toEqual({ id: 'f1', fieldId: 'f1', name: 'Effort (renamed)', levels: ['Large', 'Medium', 'Small'], optionIds: ['f1-o2', 'f1-o1', 'f1-o0'] });
  });
  test('keeps the stored order of parameters', () => {
    const two = [fieldWith('a', 'A', ['1', '2']), fieldWith('b', 'B', ['1', '2'])];
    const out = joinParameters([{ f: 'b', o: ['b-o0', 'b-o1'] }, { f: 'a', o: ['a-o0', 'a-o1'] }], two);
    expect(out.map(p => p.id)).toEqual(['b', 'a']);
  });
  test('drops a parameter that repeats an option, and a second entry for the same field', () => {
    expect(joinParameters([{ f: 'f1', o: ['f1-o0', 'f1-o0'] }], fields)).toEqual([]);
    const out = joinParameters([{ f: 'f1', o: ['f1-o0', 'f1-o1'] }, { f: 'f1', o: ['f1-o1', 'f1-o0'] }], fields);
    expect(out).toHaveLength(1);
    expect(out[0]!.optionIds).toEqual(['f1-o0', 'f1-o1']);
  });
  test('returns nothing for nothing', () => {
    expect(joinParameters([], fields)).toEqual([]);
    expect(joinParameters([{ f: 'f1', o: ['f1-o0', 'f1-o1'] }], [])).toEqual([]);
  });
});

describe('decodeView', () => {
  test('rejects malformed views and accepts a good one', () => {
    expect(decodeView({ across: 5 })).toBeNull();
    expect(decodeView(goodView)).toEqual(goodView);
    expect(decodeView({ ...goodView, colourBy: { kind: 'field' } })).toBeNull();
  });
  test('accepts every colourBy kind, and a field with its id', () => {
    for (const colourBy of [{ kind: 'label' }, { kind: 'list' }, { kind: 'member' }, { kind: 'field', fieldId: 'f1' }]) {
      expect(decodeView({ ...goodView, colourBy })).toEqual({ ...goodView, colourBy });
    }
  });
  test('rejects an unknown colourBy kind, or a field id that is not a string', () => {
    expect(decodeView({ ...goodView, colourBy: { kind: 'size' } })).toBeNull();
    expect(decodeView({ ...goodView, colourBy: { kind: 'field', fieldId: 4 } })).toBeNull();
    expect(decodeView({ ...goodView, colourBy: 'list' })).toBeNull();
    expect(decodeView({ ...goodView, colourBy: null })).toBeNull();
  });
  test('rejects a wrong type in any field', () => {
    for (const bad of [
      { across: 3 }, { up: undefined }, { listIds: 'l1' }, { listIds: ['l1', 2] }, { showImages: 'yes' },
      { zoom: '1' }, { zoom: NaN }, { panX: Infinity }, { panY: null },
    ]) {
      expect(decodeView({ ...goodView, ...bad }), JSON.stringify(bad)).toBeNull();
    }
  });
  test('rejects a view with a missing field, and things that are not views', () => {
    const { zoom: _zoom, ...noZoom } = goodView;
    expect(decodeView(noZoom)).toBeNull();
    for (const raw of [null, undefined, 'view', 7, [], []]) expect(decodeView(raw)).toBeNull();
  });
  test('keeps null for across and up', () => {
    expect(decodeView({ ...goodView, across: null, up: null })).toEqual({ ...goodView, across: null, up: null });
  });
  test('returns only the view fields', () => {
    const out = decodeView({ ...goodView, extra: 1, colourBy: { kind: 'list', junk: true } });
    expect(out).toEqual(goodView);
    expect(Object.keys(out!).sort()).toEqual(Object.keys(goodView).sort());
  });
});

describe('assertFits', () => {
  test('throws a limit error past 4096 characters', () => {
    expect(() => assertFits('x'.repeat(4095))).toThrow(expect.objectContaining({ kind: 'limit' }));
    expect(() => assertFits('x'.repeat(4000))).not.toThrow();
  });
  test('the limit is on the JSON text: 4096 fits and 4097 does not', () => {
    expect(() => assertFits('x'.repeat(4094))).not.toThrow();   // 4096 with its two quotes
    expect(() => assertFits('x'.repeat(4095))).toThrow();       // 4097
  });
  test('says what happened, in Trello\'s words', () => {
    expect(() => assertFits('x'.repeat(5000))).toThrow("Trello's 4,096-character limit for stored data was reached.");
  });
  test('accepts a value that has no JSON text', () => {
    expect(() => assertFits(undefined)).not.toThrow();
  });
});
