// What the Power-Up keeps in Trello's own storage, and how to read it safely.
// Anything read back may be missing, old or damaged, so the decoders never throw
// and return only what has the right shape.
import { clampPosition } from '../model/placement';
import type { ColourBy, DropdownField, Parameter, ViewSettings } from '../model/types';
import { StoreError } from '../store/board-store';

export const KEY_PARAMS = 'params', KEY_CARD = 'mx', KEY_VIEW = 'view';

/** A parameter as stored: the Custom Field's id and its option ids, worst to best. */
export interface StoredParam { f: string; o: string[] }
/** A card's stored data: positions by parameter id. Older values also carry `prev` and `gen`; they are ignored. */
export interface StoredCard { p?: Record<string, number> }

const STORAGE_LIMIT = 4096;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isString = (v: unknown): v is string => typeof v === 'string';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

export function decodeParams(raw: unknown): StoredParam[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredParam[] = [];
  for (const e of raw) {
    if (!isRecord(e) || !isString(e.f) || !isStringArray(e.o)) continue;
    if (e.o.length !== 2 && e.o.length !== 3) continue;
    out.push({ f: e.f, o: [...e.o] });
  }
  return out;
}

export function decodeCard(raw: unknown): StoredCard {
  const out: StoredCard = {};
  if (!isRecord(raw)) return out;
  if (isRecord(raw.p)) {
    const p: Record<string, number> = {};
    for (const [id, v] of Object.entries(raw.p)) {
      if (id === '__proto__') continue;
      if (isFiniteNumber(v) && v >= 0 && v < 1) p[id] = v;
    }
    if (Object.keys(p).length > 0) out.p = p;
  }
  return out;
}

/** The form a card is written in, or null when there is nothing left to store (so the key can be removed). */
export function encodeCard(c: StoredCard): StoredCard | null {
  const out: StoredCard = {};
  if (c.p) {
    const p: Record<string, number> = {};
    for (const [id, v] of Object.entries(c.p)) {
      if (id !== '__proto__' && isFiniteNumber(v)) p[id] = clampPosition(v);
    }
    if (Object.keys(p).length > 0) out.p = p;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function decodeColourBy(raw: unknown): ColourBy | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case 'label': case 'list': case 'member': return { kind: raw.kind };
    case 'field': return isString(raw.fieldId) ? { kind: 'field', fieldId: raw.fieldId } : null;
    default: return null;
  }
}

export function decodeView(raw: unknown): ViewSettings | null {
  if (!isRecord(raw)) return null;
  const { across, up, listIds, showImages, zoom, panX, panY } = raw;
  const colourBy = decodeColourBy(raw.colourBy);
  if (across !== null && !isString(across)) return null;
  if (up !== null && !isString(up)) return null;
  if (!isStringArray(listIds) || colourBy === null || typeof showImages !== 'boolean') return null;
  if (!isFiniteNumber(zoom) || !isFiniteNumber(panX) || !isFiniteNumber(panY)) return null;
  return { across, up, listIds: [...listIds], colourBy, showImages, zoom, panX, panY };
}

/**
 * The parameters that still match the board. A stored parameter is dropped when its field is gone, when its
 * option ids are not all still on the field (or repeat), or when the field now has a different number of
 * options than was stored. A field is a parameter once: a second entry for it is dropped.
 */
export function joinParameters(stored: StoredParam[], fields: DropdownField[]): Parameter[] {
  const byId = new Map(fields.map(f => [f.id, f] as const));
  const seen = new Set<string>();
  const out: Parameter[] = [];
  for (const s of stored) {
    const field = byId.get(s.f);
    if (!field || seen.has(field.id) || field.options.length !== s.o.length) continue;
    const texts = new Map(field.options.map(o => [o.id, o.text] as const));
    if (new Set(s.o).size !== s.o.length || !s.o.every(id => texts.has(id))) continue;
    seen.add(field.id);
    out.push({ id: field.id, name: field.name, levels: s.o.map(id => texts.get(id)!), fieldId: field.id, optionIds: [...s.o] });
  }
  return out;
}

/** Throws a `limit` error when the value's JSON text is longer than Trello allows for one stored item. */
export function assertFits(value: unknown): void {
  const text = JSON.stringify(value);
  if (text !== undefined && text.length > STORAGE_LIMIT) {
    throw new StoreError('limit', "Trello's 4,096-character limit for stored data was reached.");
  }
}
