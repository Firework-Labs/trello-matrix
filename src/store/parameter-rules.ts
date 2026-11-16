// The rules for parameters that every store holds to (see the contract in board-store.ts). Pure: each takes the
// current snapshot and either returns what it checked or throws an `invalid` StoreError.
import type { BoardSnapshot, DropdownField, ParamId, Parameter } from '../model/types';
import { StoreError, type NewParameter } from './board-store';

const invalid = (message: string) => new StoreError('invalid', message);
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Items typed first to last, ordered worst to best: a copy, reversed when the best end is the first. */
export function worstToBest<T>(typedOrder: readonly T[], bestEnd: 'first' | 'last'): T[] {
  return bestEnd === 'first' ? [...typedOrder].reverse() : [...typedOrder];
}

/** The parameter a dropdown field makes, its options being in the order the field shows them. */
export function parameterFromField(field: DropdownField, bestEnd: 'first' | 'last'): Parameter {
  const options = worstToBest(field.options, bestEnd);
  return {
    id: field.id, name: field.name, fieldId: field.id,
    levels: options.map(opt => opt.text), optionIds: options.map(opt => opt.id),
  };
}

/** The parameter with this id and its field (which may be missing). */
export function parameterNamed(snap: BoardSnapshot, id: ParamId): { param: Parameter; field: DropdownField | undefined } {
  const param = snap.parameters.find(p => p.id === id);
  if (!param) throw invalid(`No parameter ${id}`);
  return { param, field: snap.dropdownFields.find(f => f.id === param.fieldId) };
}

/** The name without surrounding spaces; `what` ("A parameter", "A level") is named in the message when it is blank. */
function cleanName(name: string, what: string): string {
  const trimmed = name.trim();
  if (trimmed === '') throw invalid(`${what} needs a name`);
  return trimmed;
}

/** A parameter name must be unique among parameters and among dropdown fields (a field that is not a parameter still holds its name). */
export function checkParameterNameFree(snap: BoardSnapshot, name: string, exceptId?: ParamId): void {
  if (snap.parameters.some(p => p.id !== exceptId && sameName(p.name, name))) throw invalid(`There is already a parameter called ${name}`);
  if (snap.dropdownFields.some(f => f.id !== exceptId && sameName(f.name, name))) throw invalid(`There is already a field called ${name}`);
}

/** The name and level names of a parameter to create, trimmed and in typed order. */
export function validateNewParameter(snap: BoardSnapshot, input: NewParameter): { name: string; levels: string[] } {
  const name = cleanName(input.name, 'A parameter');
  const levels = input.levels.map(l => l.trim());
  if (levels.length < 2 || levels.length > 3) throw invalid('A parameter has 2 or 3 levels');
  if (levels.some(l => l === '')) throw invalid('Every level needs a name');
  if (new Set(levels.map(l => l.toLowerCase())).size !== levels.length) throw invalid('Level names must differ');
  checkParameterNameFree(snap, name);
  return { name, levels };
}

/** The dropdown field to link: it must exist, not be a parameter yet, and have 2 or 3 options. */
export function validateLink(snap: BoardSnapshot, fieldId: string): DropdownField {
  const field = snap.dropdownFields.find(f => f.id === fieldId);
  if (!field) throw invalid(`No dropdown field ${fieldId}`);
  if (snap.parameters.some(p => p.fieldId === fieldId)) throw invalid(`${field.name} is already a parameter`);
  if (field.options.length < 2 || field.options.length > 3) throw invalid('A parameter has 2 or 3 levels');
  checkParameterNameFree(snap, field.name, field.id);
  return field;
}

/** The clean new name for a parameter. */
export function validateRenameParameter(snap: BoardSnapshot, id: ParamId, name: string): string {
  parameterNamed(snap, id);
  const clean = cleanName(name, 'A parameter');
  checkParameterNameFree(snap, clean, id);
  return clean;
}

/** The clean new name for one level of a parameter. */
export function validateRenameLevel(snap: BoardSnapshot, id: ParamId, level: number, name: string): string {
  const { param } = parameterNamed(snap, id);
  if (!Number.isInteger(level) || param.optionIds[level] === undefined) throw invalid(`${param.name} has no level ${level}`);
  const clean = cleanName(name, 'A level');
  if (param.levels.some((l, i) => i !== level && sameName(l, clean))) throw invalid(`Another level is already called ${clean}`);
  return clean;
}
