import { describe, expect, test } from 'vitest';
import { StoreError } from '../../src/store/board-store';
import {
  checkParameterNameFree, parameterFromField, parameterNamed, validateLink, validateNewParameter,
  validateRenameLevel, validateRenameParameter, worstToBest,
} from '../../src/store/parameter-rules';
import { sampleSnapshot } from '../../src/store/sample-data';

const snap = () => sampleSnapshot();

/** Runs `fn`, expects it to throw an `invalid` StoreError, and returns the message. */
function invalidMessage(fn: () => unknown): string {
  try { fn(); } catch (e) {
    expect(e).toBeInstanceOf(StoreError);
    expect((e as StoreError).kind).toBe('invalid');
    return (e as StoreError).message;
  }
  throw new Error('did not throw');
}

describe('worstToBest', () => {
  test('keeps the typed order when the best end is last, reverses a copy when it is first', () => {
    const typed = ['a', 'b', 'c'];
    expect(worstToBest(typed, 'last')).toEqual(['a', 'b', 'c']);
    expect(worstToBest(typed, 'first')).toEqual(['c', 'b', 'a']);
    expect(typed).toEqual(['a', 'b', 'c']);
    expect(worstToBest(typed, 'last')).not.toBe(typed);
  });
});

describe('parameterFromField', () => {
  test('levels and option ids run worst to best', () => {
    const field = { id: 'f', name: 'Ease', options: [{ id: 'o0', text: 'Hard', colour: 'none' }, { id: 'o1', text: 'Easy', colour: 'none' }] };
    expect(parameterFromField(field, 'last')).toEqual({ id: 'f', name: 'Ease', fieldId: 'f', levels: ['Hard', 'Easy'], optionIds: ['o0', 'o1'] });
    expect(parameterFromField(field, 'first')).toEqual({ id: 'f', name: 'Ease', fieldId: 'f', levels: ['Easy', 'Hard'], optionIds: ['o1', 'o0'] });
  });
});

describe('parameterNamed', () => {
  test('finds the parameter and its field; an unknown id gives the message', () => {
    const s = snap();
    const found = parameterNamed(s, 'f-value');
    expect(found.param.name).toBe('Value');
    expect(found.field?.id).toBe('f-value');
    expect(invalidMessage(() => parameterNamed(s, 'nope'))).toBe('No parameter nope');
  });
  test('looks the id up as an own entry, so an inherited name is unknown', () => {
    expect(invalidMessage(() => parameterNamed(snap(), 'constructor'))).toBe('No parameter constructor');
  });
});

describe('checkParameterNameFree', () => {
  test('a parameter name and a dropdown field name both hold the name, without regard to case or edge spaces', () => {
    const s = snap();
    expect(invalidMessage(() => checkParameterNameFree(s, 'value'))).toBe('There is already a parameter called value');
    expect(invalidMessage(() => checkParameterNameFree(s, 'IMPACTS'))).toBe('There is already a field called IMPACTS');
    expect(() => checkParameterNameFree(s, 'Brand new')).not.toThrow();
  });
  test('the parameter being renamed may keep its name in other letters', () => {
    expect(() => checkParameterNameFree(snap(), 'VALUE', 'f-value')).not.toThrow();
    expect(invalidMessage(() => checkParameterNameFree(snap(), 'cost', 'f-value'))).toBe('There is already a parameter called cost');
  });
});

describe('validateNewParameter', () => {
  const ok = (over: Partial<{ name: string; levels: string[] }> = {}) =>
    validateNewParameter(snap(), { name: 'Risk', levels: ['Low', 'High'], bestEnd: 'last', ...over });

  test('returns the trimmed name and levels in typed order', () => {
    expect(ok({ name: '  Risk ', levels: [' Low', 'Mid ', 'High'] })).toEqual({ name: 'Risk', levels: ['Low', 'Mid', 'High'] });
  });
  test('a blank name, a wrong number of levels, a blank level and repeated levels each have their message', () => {
    expect(invalidMessage(() => ok({ name: '   ' }))).toBe('A parameter needs a name');
    expect(invalidMessage(() => ok({ levels: ['a'] }))).toBe('A parameter has 2 or 3 levels');
    expect(invalidMessage(() => ok({ levels: ['a', 'b', 'c', 'd'] }))).toBe('A parameter has 2 or 3 levels');
    expect(invalidMessage(() => ok({ levels: ['a', ' '] }))).toBe('Every level needs a name');
    expect(invalidMessage(() => ok({ levels: ['Low', 'low'] }))).toBe('Level names must differ');
  });
  test('a name a parameter or a dropdown field already has is refused', () => {
    expect(invalidMessage(() => ok({ name: ' ease ' }))).toBe('There is already a parameter called ease');
    expect(invalidMessage(() => ok({ name: 'Impacts' }))).toBe('There is already a field called Impacts');
  });
  test('checks run in the order name, count, blank level, repeated level, name taken', () => {
    expect(invalidMessage(() => ok({ name: '', levels: ['a'] }))).toBe('A parameter needs a name');
    expect(invalidMessage(() => ok({ name: 'Value', levels: ['a'] }))).toBe('A parameter has 2 or 3 levels');
    expect(invalidMessage(() => ok({ name: 'Value', levels: ['a', 'A'] }))).toBe('Level names must differ');
  });
});

describe('validateLink', () => {
  test('returns the field of a dropdown with 2 or 3 options that is not a parameter', () => {
    const s = snap();
    s.parameters = s.parameters.filter(p => p.id !== 'f-ease');
    expect(validateLink(s, 'f-ease').id).toBe('f-ease');
  });
  test('refuses an unknown field, a parameter, and a field with too many options', () => {
    const s = snap();
    expect(invalidMessage(() => validateLink(s, 'nope'))).toBe('No dropdown field nope');
    expect(invalidMessage(() => validateLink(s, 'f-ease'))).toBe('Ease is already a parameter');
    expect(invalidMessage(() => validateLink(s, 'f-impacts'))).toBe('A parameter has 2 or 3 levels');
    expect(invalidMessage(() => validateLink(s, 'constructor'))).toBe('No dropdown field constructor');
  });
  test('refuses a field whose name another dropdown field or another parameter holds', () => {
    const s = snap();
    s.parameters = s.parameters.filter(p => p.id !== 'f-ease');
    s.dropdownFields.push({ id: 'f-other', name: 'ease', options: [{ id: 'x0', text: 'a', colour: 'none' }, { id: 'x1', text: 'b', colour: 'none' }] });
    expect(invalidMessage(() => validateLink(s, 'f-ease'))).toBe('There is already a field called Ease');
    s.parameters.push({ id: 'p', name: 'ease', fieldId: 'p', levels: ['a', 'b'], optionIds: ['x', 'y'] });
    expect(invalidMessage(() => validateLink(s, 'f-ease'))).toBe('There is already a parameter called Ease');
  });
});

describe('validateRenameParameter', () => {
  test('returns the clean name; the message for unknown, blank and taken names', () => {
    const s = snap();
    expect(validateRenameParameter(s, 'f-value', ' Worth ')).toBe('Worth');
    expect(validateRenameParameter(s, 'f-value', 'VALUE')).toBe('VALUE');
    expect(invalidMessage(() => validateRenameParameter(s, 'nope', 'x'))).toBe('No parameter nope');
    expect(invalidMessage(() => validateRenameParameter(s, 'f-value', '  '))).toBe('A parameter needs a name');
    expect(invalidMessage(() => validateRenameParameter(s, 'f-value', 'Cost'))).toBe('There is already a parameter called Cost');
    expect(invalidMessage(() => validateRenameParameter(s, 'f-value', 'Impacts'))).toBe('There is already a field called Impacts');
  });
});

describe('validateRenameLevel', () => {
  test('returns the clean name; the message for unknown, out-of-range, blank and repeated names', () => {
    const s = snap();
    expect(validateRenameLevel(s, 'f-value', 1, ' Middling ')).toBe('Middling');
    expect(validateRenameLevel(s, 'f-value', 1, 'MEDIUM')).toBe('MEDIUM');
    expect(invalidMessage(() => validateRenameLevel(s, 'nope', 0, 'x'))).toBe('No parameter nope');
    expect(invalidMessage(() => validateRenameLevel(s, 'f-value', 5, 'x'))).toBe('Value has no level 5');
    expect(invalidMessage(() => validateRenameLevel(s, 'f-value', 0.5, 'x'))).toBe('Value has no level 0.5');
    expect(invalidMessage(() => validateRenameLevel(s, 'f-value', 0, ' '))).toBe('A level needs a name');
    expect(invalidMessage(() => validateRenameLevel(s, 'f-value', 2, ' medium '))).toBe('Another level is already called medium');
  });
});
