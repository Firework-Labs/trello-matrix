import { expect, test } from 'vitest';
import type { Card, Parameter } from '../../src/model/types';
import { planDrop } from '../../src/model/drop';

const cost: Parameter = { id: 'f-cost', name: 'Cost', levels: ['High', 'Medium', 'Low'], fieldId: 'f-cost', optionIds: ['k0', 'k1', 'k2'] };
const value: Parameter = { id: 'f-value', name: 'Value', levels: ['Low', 'Medium', 'High'], fieldId: 'f-value', optionIds: ['v0', 'v1', 'v2'] };
const card = (fieldOptions: Record<string, string>): Card =>
  ({ id: 'c', name: 'n', idList: 'l', pos: 1, labelIds: [], memberIds: [], hasCover: false, fieldOptions });

test('moving inside a section saves the spot and changes no field', () => {
  const p = planDrop({ card: card({ 'f-cost': 'k0', 'f-value': 'v2' }), across: cost, up: value, zone: 'matrix', x: 0.2, y: 0.8 });
  expect(p).toEqual({ positions: { 'f-cost': 0.2, 'f-value': 0.8 }, levels: [], message: null });
});
test('crossing a boundary changes only that field and names the change', () => {
  const p = planDrop({ card: card({ 'f-cost': 'k0', 'f-value': 'v2' }), across: cost, up: value, zone: 'matrix', x: 0.5, y: 0.8 });
  expect(p.levels).toEqual([{ param: cost, level: 1 }]);
  expect(p.message).toBe('Cost: High → Medium');
});
test('placing from the tray sets both', () => {
  const p = planDrop({ card: card({}), across: cost, up: value, zone: 'matrix', x: 0.9, y: 0.1 });
  expect(p.levels).toEqual([{ param: cost, level: 2 }, { param: value, level: 0 }]);
  expect(p.message).toBe('Cost: not set → Low, Value: not set → Low');
});
test('left strip keeps Up and clears Across', () => {
  const p = planDrop({ card: card({ 'f-cost': 'k0', 'f-value': 'v2' }), across: cost, up: value, zone: 'leftStrip', x: 0, y: 0.8 });
  expect(p.positions).toEqual({ 'f-cost': null, 'f-value': 0.8 });
  expect(p.levels).toEqual([{ param: cost, level: null }]);
  expect(p.message).toBe('Cost: High → not set');
});
test('bottom strip keeps Across and clears Up', () => {
  const p = planDrop({ card: card({ 'f-cost': 'k0', 'f-value': 'v2' }), across: cost, up: value, zone: 'bottomStrip', x: 0.2, y: 0 });
  expect(p.positions).toEqual({ 'f-cost': 0.2, 'f-value': null });
  expect(p.levels).toEqual([{ param: value, level: null }]);
});
test('tray clears both, and only lists fields that were set', () => {
  const p = planDrop({ card: card({ 'f-value': 'v2' }), across: cost, up: value, zone: 'tray', x: 0, y: 0 });
  expect(p.positions).toEqual({ 'f-cost': null, 'f-value': null });
  expect(p.levels).toEqual([{ param: value, level: null }]);
});
test('out-of-range drops are clamped', () => {
  const p = planDrop({ card: card({}), across: cost, up: value, zone: 'matrix', x: 1.4, y: -3 });
  expect(p.positions).toEqual({ 'f-cost': 0.999, 'f-value': 0 });
});
test('a left-strip drop that crosses an Up boundary changes Up and names it', () => {
  const p = planDrop({ card: card({ 'f-cost': 'k0', 'f-value': 'v2' }), across: cost, up: value, zone: 'leftStrip', x: 0, y: 0.1 });
  expect(p.levels).toEqual([{ param: cost, level: null }, { param: value, level: 0 }]);
  expect(p.message).toBe('Cost: High → not set, Value: High → Low');
});
