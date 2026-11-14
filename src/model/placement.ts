import type { Card, Located, Parameter, Placement } from './types';

const MAX_POSITION = 0.999;
const JITTER = 0.15;

/** The level (0 = worst) that a position falls in: equal divisions, clamped. */
export function levelOf(v: number, levelCount: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(levelCount - 1, Math.max(0, Math.floor(v * levelCount)));
}

/** Clamp to [0, 0.999] and round to 3 decimals, the form in which positions are stored. */
export function clampPosition(v: number): number {
  return Math.round(Math.min(MAX_POSITION, Math.max(0, v)) * 1000) / 1000;
}

/** The level the card's Custom Field value puts it in, or null when unset or not a known option. */
export function fieldLevel(card: Card, p: Parameter): number | null {
  const optionId = card.fieldOptions[p.fieldId];
  if (optionId === undefined) return null;
  const level = p.optionIds.indexOf(optionId);
  return level === -1 ? null : level;
}

/** A repeatable offset in [-JITTER, JITTER] derived from the card id (FNV-1a). */
function jitterFor(cardId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < cardId.length; i++) {
    h ^= cardId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h / 0x100000000) * 2 * JITTER - JITTER;
}

/**
 * Where a card sits on one axis. The field decides the level; the stored position
 * only supplies the offset inside that level's section. Null level means not placed.
 */
export function effectivePosition(
  level: number | null, stored: number | undefined, levelCount: number, cardId: string,
): number | null {
  if (level === null) return null;
  if (stored === undefined || !Number.isFinite(stored) || stored < 0 || stored > MAX_POSITION) {
    return (level + 0.5 + jitterFor(cardId)) / levelCount;
  }
  if (levelOf(stored, levelCount) === level) return stored;
  const offset = stored * levelCount - Math.floor(stored * levelCount);
  return (level + offset) / levelCount;
}

/** Which zone a card is in, and its coordinates: x on Across, y on Up. */
export function locate(card: Card, placement: Placement | undefined, across: Parameter, up: Parameter): Located {
  const x = effectivePosition(fieldLevel(card, across), placement?.positions[across.id], across.levels.length, card.id);
  const y = effectivePosition(fieldLevel(card, up), placement?.positions[up.id], up.levels.length, card.id);
  if (x !== null && y !== null) return { zone: 'matrix', x, y };
  if (y !== null) return { zone: 'leftStrip', x: null, y };
  if (x !== null) return { zone: 'bottomStrip', x, y: null };
  return { zone: 'tray', x: null, y: null };
}
