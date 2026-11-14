import { expect, test } from 'vitest';
import type { Card, Parameter } from '../../src/model/types';
import { clampPosition, effectivePosition, fieldLevel, levelOf, locate } from '../../src/model/placement';

const value: Parameter = { id: 'f-value', name: 'Value', levels: ['Low', 'Medium', 'High'], fieldId: 'f-value', optionIds: ['v0', 'v1', 'v2'] };
const ease: Parameter = { id: 'f-ease', name: 'Ease', levels: ['Hard', 'Easy'], fieldId: 'f-ease', optionIds: ['e0', 'e1'] };
const card = (fieldOptions: Record<string, string>): Card =>
  ({ id: 'c', name: 'n', idList: 'l', pos: 1, labelIds: [], memberIds: [], hasCover: false, fieldOptions });

test('levelOf uses equal divisions and clamps', () => {
  expect([0, 0.3333, 0.34, 0.999, 1, -0.1].map(v => levelOf(v, 3))).toEqual([0, 0, 1, 2, 2, 0]);
  expect([0.49, 0.5].map(v => levelOf(v, 2))).toEqual([0, 1]);
});
test('clampPosition', () => { expect([-1, 0.12345, 1.2].map(clampPosition)).toEqual([0, 0.123, 0.999]); });
test('fieldLevel reads the option, null when unset or unknown', () => {
  expect(fieldLevel(card({ 'f-value': 'v2' }), value)).toBe(2);
  expect(fieldLevel(card({}), value)).toBeNull();
  expect(fieldLevel(card({ 'f-value': 'deleted-option' }), value)).toBeNull();   // Review Focus 1
});
test('effectivePosition: stored wins inside its level', () => { expect(effectivePosition(1, 0.4, 3, 'c', 'p')).toBe(0.4); });
test('effectivePosition: field wins on level, offset inside the section is kept', () => {
  expect(effectivePosition(2, 0.4, 3, 'c', 'p')).toBeCloseTo((2 + 0.2) / 3, 6);
});
test('effectivePosition: no level means not placed', () => { expect(effectivePosition(null, 0.4, 3, 'c', 'p')).toBeNull(); });
test('effectivePosition: no usable stored value draws mid-section, spread by card id', () => {   // Review Focus 2
  for (const bad of [undefined, NaN, 1.7, -0.2]) {
    const v = effectivePosition(0, bad as number | undefined, 2, 'c', 'p')!;
    expect(v).toBeGreaterThanOrEqual(0.175); expect(v).toBeLessThanOrEqual(0.325);
  }
  expect(effectivePosition(0, undefined, 2, 'c', 'p')).toBe(effectivePosition(0, undefined, 2, 'c', 'p'));
  const spread = new Set(Array.from({ length: 20 }, (_, i) => effectivePosition(0, undefined, 2, 'card' + i, 'p')));
  expect(spread.size).toBeGreaterThanOrEqual(10);
});
test('cards with no stored position on either axis are spread across the section, not along its diagonal', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `card${i}`);
  const offsets = ids.map(id => {
    const at = locate({ ...card({ 'f-value': 'v1', 'f-ease': 'e0' }), id }, undefined, ease, value);
    // How far from the middle of its section the card sits on each axis, in section widths.
    return [at.x! * ease.levels.length - 0 - 0.5, at.y! * value.levels.length - 1 - 0.5] as const;
  });
  expect(offsets.every(([x, y]) => Math.abs(x - y) < 1e-9)).toBe(false);
  expect(offsets.filter(([x, y]) => Math.abs(x - y) > 1e-9).length).toBeGreaterThanOrEqual(15);
  expect(new Set(offsets.map(([x]) => x.toFixed(6))).size).toBeGreaterThanOrEqual(10);       // spread along the x axis
  expect(new Set(offsets.map(([, y]) => y.toFixed(6))).size).toBeGreaterThanOrEqual(10);     // and along the y axis
  expect(effectivePosition(0, undefined, 2, 'card1', 'f-ease')).not.toBe(effectivePosition(0, undefined, 2, 'card1', 'f-value'));
});
test('locate picks the zone from which parameters have a level', () => {
  const p = { positions: { 'f-value': 0.9, 'f-ease': 0.75 } };
  expect(locate(card({ 'f-value': 'v2', 'f-ease': 'e1' }), p, ease, value)).toEqual({ zone: 'matrix', x: 0.75, y: 0.9 });
  expect(locate(card({ 'f-value': 'v2' }), p, ease, value)).toEqual({ zone: 'leftStrip', x: null, y: 0.9 });
  expect(locate(card({ 'f-ease': 'e1' }), p, ease, value)).toEqual({ zone: 'bottomStrip', x: 0.75, y: null });
  expect(locate(card({}), p, ease, value)).toEqual({ zone: 'tray', x: null, y: null });
});
