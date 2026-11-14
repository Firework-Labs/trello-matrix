import { expect, test } from 'vitest';
import type { BoardSnapshot, Card, ColourBy } from '../../src/model/types';
import { NONE_COLOUR, PALETTE, colourOf, legendFor, trelloColour } from '../../src/model/colour';

const snap: BoardSnapshot = {
  lists: [{ id: 'l-todo', name: 'To do' }, { id: 'l-done', name: 'Done' }],
  cards: [],
  labels: [{ id: 'uxui', name: 'UXUI', colour: 'pink_dark' }, { id: 'bug', name: 'Bug', colour: 'red_dark' }],
  members: [{ id: 'm-alex', fullName: 'Alex Example', initials: 'AE' }],
  dropdownFields: [{ id: 'f-impacts', name: 'Impacts', options: [{ id: 'opt-ios', text: 'iOS', colour: 'blue' }] }],
  parameters: [],
  placements: {},
  canEdit: true,
  canUndoReorder: false,
};
const cardWith = (partial: Partial<Card>): Card =>
  ({ id: 'c', name: 'n', idList: 'l-todo', pos: 1, labelIds: [], memberIds: [], hasCover: false, fieldOptions: {}, ...partial });

test('every Trello colour name maps to a hex', () => {
  for (const base of ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'black'])
    for (const suffix of ['', '_dark', '_light']) expect(trelloColour(base + suffix)).toMatch(/^#[0-9a-f]{6}$/);
  expect(trelloColour('nope')).toBe(NONE_COLOUR); expect(trelloColour(null)).toBe(NONE_COLOUR);
});
test('no label colour name draws as the grey for "no value", and black sits between its dark and light shades', () => {
  const names = ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'black'].flatMap(b => [b, b + '_dark', b + '_light']);
  for (const name of names) expect(trelloColour(name), name).not.toBe(NONE_COLOUR);
  const brightness = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
  expect(brightness(trelloColour('black_dark'))).toBeLessThan(brightness(trelloColour('black')));
  expect(brightness(trelloColour('black'))).toBeLessThan(brightness(NONE_COLOUR));          // clearly darker than the grey for "no label"
  expect(brightness(trelloColour('black_light'))).toBeGreaterThan(brightness(trelloColour('black')));
});
test('dark and light shades differ from the plain colour', () => {
  for (const base of ['green', 'red', 'blue', 'black']) {
    expect(trelloColour(base + '_dark')).not.toBe(trelloColour(base));
    expect(trelloColour(base + '_light')).not.toBe(trelloColour(base));
  }
});
test('the palette has ten distinct colours, none of them the grey for no value', () => {
  expect(PALETTE).toHaveLength(10);
  expect(new Set(PALETTE).size).toBe(10);
  expect(PALETTE).not.toContain(NONE_COLOUR);
});
test('by label: first label in board order wins', () => {
  // snap.labels order: [UXUI pink_dark, Bug red_dark]; the card lists Bug before UXUI
  expect(colourOf(cardWith({ labelIds: ['bug', 'uxui'] }), { kind: 'label' }, snap)).toEqual({ key: 'uxui', label: 'UXUI', colour: trelloColour('pink_dark') });
});
test('a label with no name is named by its colour', () => {
  const unnamed: BoardSnapshot = { ...snap, labels: [{ id: 'x', name: '', colour: 'green_light' }] };
  expect(colourOf(cardWith({ labelIds: ['x'] }), { kind: 'label' }, unnamed)).toEqual({ key: 'x', label: 'green_light', colour: trelloColour('green_light') });
});
test('no value is grey with key "none"', () => {
  for (const by of [{ kind: 'label' }, { kind: 'member' }, { kind: 'field', fieldId: 'f-impacts' }] as ColourBy[])
    expect(colourOf(cardWith({}), by, snap)).toEqual({ key: 'none', label: 'None', colour: NONE_COLOUR });
});
test('ids that no longer exist in the snapshot count as no value', () => {
  const gone = cardWith({ labelIds: ['deleted-label'], memberIds: ['deleted-member'], idList: 'deleted-list', fieldOptions: { 'f-impacts': 'deleted-option' } });
  for (const by of [{ kind: 'label' }, { kind: 'member' }, { kind: 'list' }, { kind: 'field', fieldId: 'f-impacts' }] as ColourBy[])
    expect(colourOf(gone, by, snap).key).toBe('none');
  expect(colourOf(cardWith({ fieldOptions: { 'f-impacts': 'opt-ios' } }), { kind: 'field', fieldId: 'deleted-field' }, snap).key).toBe('none');
});
test('by field uses the option colour; by list and member use the palette by board order', () => {
  expect(colourOf(cardWith({ fieldOptions: { 'f-impacts': 'opt-ios' } }), { kind: 'field', fieldId: 'f-impacts' }, snap).colour).toBe(trelloColour('blue'));
  expect(colourOf(cardWith({ idList: snap.lists[1]!.id }), { kind: 'list' }, snap).colour).toBe(PALETTE[1]);
  expect(colourOf(cardWith({ memberIds: [snap.members[0]!.id] }), { kind: 'member' }, snap).colour).toBe(PALETTE[0]);
});
test('a dropdown option coloured none is grey', () => {
  const grey: BoardSnapshot = { ...snap, dropdownFields: [{ id: 'f-impacts', name: 'Impacts', options: [{ id: 'opt-ios', text: 'iOS', colour: 'none' }] }] };
  expect(colourOf(cardWith({ fieldOptions: { 'f-impacts': 'opt-ios' } }), { kind: 'field', fieldId: 'f-impacts' }, grey).colour).toBe(NONE_COLOUR);
});
test('legend lists only colours in use, none last', () => {
  expect(legendFor([cardWith({ labelIds: ['bug'] }), cardWith({})], { kind: 'label' }, snap).map(l => l.key)).toEqual(['bug', 'none']);
});
test('legend follows board order, not card order', () => {
  expect(legendFor([cardWith({ labelIds: ['bug'] }), cardWith({ labelIds: ['uxui'] })], { kind: 'label' }, snap).map(l => l.key)).toEqual(['uxui', 'bug']);
});
