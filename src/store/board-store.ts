import type { BoardSnapshot, Parameter, ParamId, ViewSettings } from '../model/types';

export interface Progress { done: number; total: number }
export interface NewParameter { name: string; levels: string[]; bestEnd: 'first' | 'last' }   // levels as typed, 2 or 3 names
export interface ListOrder { listId: string; cardIds: string[] }
export type StoreErrorKind = 'auth' | 'permission' | 'rate-limit' | 'limit' | 'network' | 'invalid';

export class StoreError extends Error {
  constructor(public kind: StoreErrorKind, message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

/**
 * Every board read and write goes through this, so a server-backed store can replace the Trello one.
 *
 * What the view relies on (every implementation must keep to it, the fake store included):
 *
 * Reads
 * - `load()` reflects every write this store has completed. A store that reads from a cache must not serve a snapshot
 *   from before its own latest completed write.
 * - `subscribe` never delivers a snapshot that was read before this store's own latest completed write.
 * - `loadView()` resolves `null` when nothing is saved, and never throws for missing data (only for a failed read).
 *
 * Validation (a write that breaks a rule rejects with a `StoreError` of kind `invalid` and changes nothing)
 * - A parameter has 2 or 3 levels, and its level names are non-empty and distinct (compared without regard to case).
 * - A parameter name is non-empty and unique among the parameters and among the board's dropdown fields, compared
 *   without regard to case and surrounding spaces. A dropdown field that is not a parameter still holds its name.
 * - `linkParameter` accepts only a dropdown field that has 2 or 3 options and is not already a parameter.
 * - `renameParameter` and `renameLevel` hold to the same uniqueness rules (a level name must differ from the other
 *   levels of the same parameter); renaming to the name it already has, in other letters, is allowed.
 * - A write to an unknown card, an unknown parameter or an out-of-range level rejects.
 */
export interface BoardStore {
  isConnected(): Promise<boolean>;
  connect(): Promise<void>;                                   // call only from a click handler
  load(): Promise<BoardSnapshot>;
  subscribe(onChange: (snap: BoardSnapshot) => void): () => void;
  savePositions(cardId: string, positions: Record<ParamId, number | null>): Promise<void>;   // null forgets
  setLevel(cardId: string, param: Parameter, level: number | null): Promise<void>;
  createParameter(input: NewParameter): Promise<Parameter>;
  linkParameter(fieldId: string, bestEnd: 'first' | 'last'): Promise<Parameter>;
  renameParameter(id: ParamId, name: string): Promise<void>;
  renameLevel(id: ParamId, level: number, name: string): Promise<void>;
  removeParameter(id: ParamId): Promise<void>;                // forgets it; the field and its values stay
  reorderLists(orders: ListOrder[], onProgress: (p: Progress) => void): Promise<void>;
  undoReorder(onProgress: (p: Progress) => void): Promise<void>;
  openCard(cardId: string): Promise<void>;
  coverImageUrl(cardId: string): Promise<string | null>;
  loadView(): Promise<ViewSettings | null>;
  saveView(view: ViewSettings): Promise<void>;
}
