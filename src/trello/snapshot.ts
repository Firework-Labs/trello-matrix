// Turns what the Power-Up client library returned into a BoardSnapshot. Everything read is untrusted: a value
// of the wrong type counts as missing, nothing throws, and an entry without a string id is skipped.
import type { BoardSnapshot, Card, DropdownField, Label, List, Member, Placement } from '../model/types';
import { decodeCard, decodeParams, decodeReorder, joinParameters } from './plugin-data';

/** Everything the store reads from the Power-Up client library for one snapshot. All of it is untrusted. */
export interface RawBoardData {
  cards: unknown;                       // t.cards('id','name','idList','pos','labels','members','cover','customFieldItems')
  lists: unknown;                       // t.lists('id','name')
  board: unknown;                       // t.board('id','labels','customFields','members')
  cardData: Record<string, unknown>;    // by card id: the Power-Up's shared card storage value (key 'mx')
  params: unknown;                      // board shared storage value (key 'params')
  reorder: unknown;                     // board shared storage value (key 'reorder')
  canEdit: boolean;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The entries of an array that are objects with a string id. */
function withId(raw: unknown): (Rec & { id: string })[] {
  return Array.isArray(raw) ? raw.filter((e): e is Rec & { id: string } => isRecord(e) && isString(e.id)) : [];
}

/**
 * A plain object built from entries. A key of `__proto__` is left out, and the others become own properties, so
 * a stored key cannot reach the prototype.
 */
function plainObject<V>(entries: Iterable<readonly [string, V]>): Record<string, V> {
  return Object.fromEntries([...entries].filter(([k]) => k !== '__proto__'));
}

const isHttps = (u: unknown): u is string => {
  if (!isString(u)) return false;
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
};

export function coverUrlOf(rawCover: unknown, maxWidth = 600): string | null {
  if (!isRecord(rawCover)) return null;
  const sized: { url: string; width: number }[] = [];
  for (const list of [rawCover.previews, rawCover.scaled]) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      if (isRecord(p) && isHttps(p.url) && isNumber(p.width)) sized.push({ url: p.url, width: p.width });
    }
  }
  const fits = sized.filter(p => p.width <= maxWidth);
  const pool = fits.length > 0 ? fits : sized;
  if (pool.length > 0) {
    const better = fits.length > 0 ? (a: number, b: number) => a > b : (a: number, b: number) => a < b;
    return pool.reduce((best, p) => (better(p.width, best.width) ? p : best)).url;
  }
  return isHttps(rawCover.url) ? rawCover.url : null;
}

export function coverUrls(rawCards: unknown): Record<string, string> {
  const entries: [string, string][] = [];
  for (const c of withId(rawCards)) {
    const url = coverUrlOf(c.cover);
    if (url !== null) entries.push([c.id, url]);
  }
  return plainObject(entries);
}

function initialsOf(m: Rec, fullName: string): string {
  if (isString(m.initials) && m.initials !== '') return m.initials;
  const words = fullName.split(/\s+/).filter(w => w !== '').slice(0, 2);
  const letters = words.map(w => [...w][0]!).join('').toUpperCase();
  return letters === '' ? '?' : letters;
}

function toDropdownField(f: Rec & { id: string }): DropdownField {
  const options = withId(f.options).map(o => {
    const value = isRecord(o.value) ? o.value : {};
    const text = isString(value.text) ? value.text : isString(o.text) ? o.text : '';
    return { opt: { id: o.id, text, colour: isString(o.color) ? o.color : 'none' }, pos: o.pos };
  });
  const sorted = options.every(o => isNumber(o.pos))
    ? [...options].sort((a, b) => (a.pos as number) - (b.pos as number))
    : options;
  return { id: f.id, name: isString(f.name) ? f.name : '', options: sorted.map(o => o.opt) };
}

function toCard(c: Rec & { id: string }, idList: string): Card {
  const items = Array.isArray(c.customFieldItems) ? c.customFieldItems : [];
  const fieldOptions = plainObject(items.flatMap((i): [string, string][] =>
    isRecord(i) && isString(i.idCustomField) && isString(i.idValue) && i.idValue !== '' ? [[i.idCustomField, i.idValue]] : []));
  return {
    id: c.id, name: isString(c.name) ? c.name : '', idList, pos: isNumber(c.pos) ? c.pos : 0,
    labelIds: withId(c.labels).map(l => l.id), memberIds: withId(c.members).map(m => m.id),
    hasCover: coverUrlOf(c.cover) !== null, fieldOptions,
  };
}

export function toSnapshot(raw: RawBoardData): BoardSnapshot {
  const board = isRecord(raw.board) ? raw.board : {};
  const cardData = isRecord(raw.cardData) ? raw.cardData : {};

  const lists: List[] = withId(raw.lists).map(l => ({ id: l.id, name: isString(l.name) ? l.name : '' }));
  const labels: Label[] = withId(board.labels).map(l => ({ id: l.id, name: isString(l.name) ? l.name : '', colour: isString(l.color) ? l.color : null }));
  const members: Member[] = withId(board.members).map(m => {
    const fullName = isString(m.fullName) ? m.fullName : '';
    return { id: m.id, fullName, initials: initialsOf(m, fullName) };
  });
  const dropdownFields = withId(board.customFields).filter(f => f.type === 'list').map(toDropdownField);

  const cards: Card[] = [];
  for (const c of withId(raw.cards)) {
    if (isString(c.idList)) cards.push(toCard(c, c.idList));
  }
  const placements = plainObject(cards.flatMap((c): [string, Placement][] => {
    if (!Object.hasOwn(cardData, c.id)) return [];
    const p = decodeCard(cardData[c.id]).p;
    return p ? [[c.id, { positions: plainObject(Object.entries(p)) }]] : [];
  }));

  return {
    lists, cards, labels, members, dropdownFields,
    parameters: joinParameters(decodeParams(raw.params), dropdownFields),
    placements, canEdit: raw.canEdit === true, canUndoReorder: decodeReorder(raw.reorder) !== null,
  };
}
