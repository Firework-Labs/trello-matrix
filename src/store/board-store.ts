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

/** Every board read and write goes through this, so a server-backed store can replace the Trello one. */
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
