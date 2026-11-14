import type { BoardSnapshot, Card, ColourBy } from './types';

/** The grey for a card with no value (and for Trello's 'black' label, which is the same hue). */
export const NONE_COLOUR = '#8590a2';

/** Ten distinct colours for lists and members, given out in board order and wrapping after ten. */
export const PALETTE: string[] = [
  '#4bce97', '#e2b203', '#faa53d', '#f87462', '#9f8fef',
  '#579dff', '#60c6d2', '#94c748', '#e774bb', '#1d7f8c',
];

/** Atlassian's published label colours: each base name with plain, _dark and _light shades. */
const TRELLO_HEX = new Map(Object.entries({
  green: '#4bce97', green_dark: '#216e4e', green_light: '#d3f1a7',
  yellow: '#e2b203', yellow_dark: '#946f00', yellow_light: '#f8e6a0',
  orange: '#faa53d', orange_dark: '#a54800', orange_light: '#fedec8',
  red: '#f87462', red_dark: '#ae2e24', red_light: '#ffd5d2',
  purple: '#9f8fef', purple_dark: '#5e4db2', purple_light: '#dfd8fd',
  blue: '#579dff', blue_dark: '#0055cc', blue_light: '#cce0ff',
  sky: '#60c6d2', sky_dark: '#206a83', sky_light: '#c6edfb',
  lime: '#94c748', lime_dark: '#4c6b1f', lime_light: '#e2f7c6',
  pink: '#e774bb', pink_dark: '#943d73', pink_light: '#fdd0ec',
  black: '#8590a2', black_dark: '#44546f', black_light: '#dfe1e6',
}));

/** A Trello label or option colour name to its hex. Unknown or null (including 'none') is the grey. */
export function trelloColour(name: string | null): string {
  return (name !== null && TRELLO_HEX.get(name)) || NONE_COLOUR;
}

export interface ColourInfo { key: string; label: string; colour: string }

const NO_VALUE: ColourInfo = { key: 'none', label: 'None', colour: NONE_COLOUR };

function paletteAt(index: number): string {
  return PALETTE[index % PALETTE.length] ?? NONE_COLOUR;
}

/** The colour and legend entry for a card under one colouring. A card with no usable value is 'none'. */
export function colourOf(card: Card, by: ColourBy, snap: BoardSnapshot): ColourInfo {
  return valueOf(card, by, snap) ?? NO_VALUE;
}

function valueOf(card: Card, by: ColourBy, snap: BoardSnapshot): ColourInfo | null {
  switch (by.kind) {
    case 'label': {
      const label = snap.labels.find(l => card.labelIds.includes(l.id));   // board order
      if (!label) return null;
      return { key: label.id, label: label.name || label.colour || 'None', colour: trelloColour(label.colour) };
    }
    case 'list': {
      const index = snap.lists.findIndex(l => l.id === card.idList);
      const list = snap.lists[index];
      if (!list) return null;
      return { key: list.id, label: list.name, colour: paletteAt(index) };
    }
    case 'member': {
      const index = snap.members.findIndex(m => card.memberIds.includes(m.id));   // board order
      const member = snap.members[index];
      if (!member) return null;
      return { key: member.id, label: member.fullName, colour: paletteAt(index) };
    }
    case 'field': {
      const field = snap.dropdownFields.find(f => f.id === by.fieldId);
      const option = field?.options.find(o => o.id === card.fieldOptions[by.fieldId]);
      if (!option) return null;
      return { key: option.id, label: option.text, colour: trelloColour(option.colour) };
    }
  }
}

/** Position of a key in its board list, used to order the legend. */
function boardIndex(by: ColourBy, snap: BoardSnapshot, key: string): number {
  switch (by.kind) {
    case 'label': return snap.labels.findIndex(l => l.id === key);
    case 'list': return snap.lists.findIndex(l => l.id === key);
    case 'member': return snap.members.findIndex(m => m.id === key);
    case 'field': return snap.dropdownFields.find(f => f.id === by.fieldId)?.options.findIndex(o => o.id === key) ?? -1;
  }
}

/** The distinct colours in use across the cards, in board order, with 'none' last. */
export function legendFor(cards: Card[], by: ColourBy, snap: BoardSnapshot): ColourInfo[] {
  const used = new Map<string, ColourInfo>();
  for (const card of cards) {
    const info = colourOf(card, by, snap);
    if (!used.has(info.key)) used.set(info.key, info);
  }
  const rank = (info: ColourInfo) => info.key === NO_VALUE.key ? Number.MAX_SAFE_INTEGER : boardIndex(by, snap, info.key);
  return [...used.values()].sort((a, b) => rank(a) - rank(b));
}
