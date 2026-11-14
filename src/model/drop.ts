import { clampPosition, fieldLevel, levelOf } from './placement';
import type { Card, Parameter, ParamId, Zone } from './types';

export interface DropInput { card: Card; across: Parameter; up: Parameter; zone: Zone; x: number; y: number }
export interface LevelChange { param: Parameter; level: number | null }
export interface DropPlan { positions: Record<ParamId, number | null>; levels: LevelChange[]; message: string | null }

/**
 * What a drop saves and writes. The zone decides which parameters are set or cleared:
 * the matrix sets both, the left strip clears Across, the bottom strip clears Up,
 * the tray clears both. Positions are always saved (null forgets them). A field is
 * written only when its level changes.
 */
export function planDrop(input: DropInput): DropPlan {
  const { card, across, up, zone, x, y } = input;
  const acrossPos = zone === 'matrix' || zone === 'bottomStrip' ? clampPosition(x) : null;
  const upPos = zone === 'matrix' || zone === 'leftStrip' ? clampPosition(y) : null;

  const positions: Record<ParamId, number | null> = { [across.id]: acrossPos, [up.id]: upPos };
  const levels: LevelChange[] = [];
  const parts: string[] = [];
  for (const [param, pos] of [[across, acrossPos], [up, upPos]] as const) {
    const before = fieldLevel(card, param);
    const after = pos === null ? null : levelOf(pos, param.levels.length);
    if (after === before) continue;
    levels.push({ param, level: after });
    parts.push(`${param.name}: ${levelName(param, before)} → ${levelName(param, after)}`);
  }
  return { positions, levels, message: parts.length ? parts.join(', ') : null };
}

function levelName(param: Parameter, level: number | null): string {
  return level === null ? 'not set' : (param.levels[level] ?? 'unknown level');
}
