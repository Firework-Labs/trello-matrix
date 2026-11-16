import { clampPosition } from '../model/placement';
import { positionsFor } from '../model/resequence';
import type { BoardSnapshot, Card, DropdownField, ViewSettings } from '../model/types';
import { StoreError, type BoardStore, type ListOrder, type NewParameter, type Progress } from './board-store';
import {
  parameterFromField, parameterNamed, validateLink, validateNewParameter, validateRenameLevel, validateRenameParameter,
} from './parameter-rules';
import { sampleSnapshot } from './sample-data';

export interface FakeStore extends BoardStore {
  /** Outward and mutating calls only (not load, subscribe, isConnected, loadView, saveView), in call order. */
  calls: { method: string; args: unknown[] }[];
  /** The next call of this method rejects once with `error` and changes nothing. */
  failNext(method: keyof BoardStore, error?: StoreError): void;
  remote(mutate: (snap: BoardSnapshot) => void): void;        // simulates the other person; notifies subscribers
  snapshot(): BoardSnapshot;                                  // current state, a deep copy
  /** How many subscriptions are live now (a view that has gone away must have left none). */
  subscriberCount(): number;
}

const invalid = (message: string) => new StoreError('invalid', message);

/** The methods that change the board: after one of these, a store with `staleReads` serves old reads for a while. */
const WRITES = new Set<keyof BoardStore>([
  'savePositions', 'setLevel', 'createParameter', 'linkParameter', 'renameParameter', 'renameLevel',
  'removeParameter', 'reorderLists', 'undoReorder',
]);

export interface FakeStoreOptions {
  snapshot?: BoardSnapshot;
  connected?: boolean;
  /** The first `reorderLists` with more cards than this writes this many, then rejects once with a network error. */
  reorderFailAfter?: number;
  /**
   * Models a store that reads from a cache which lags its own writes: after every write, the next this-many `load()`
   * calls return the board as it was before that write began. Default 0 (reads are always current).
   */
  staleReads?: number;
}

export function createFakeStore(o: FakeStoreOptions = {}): FakeStore {
  let board: BoardSnapshot = structuredClone(o.snapshot ?? sampleSnapshot());
  let connected = o.connected ?? true;
  let view: ViewSettings | null = null;
  let undoPositions: Map<string, number> | null = null;
  let reorderInterrupted = false;                 // the last reorder stopped part-way, so the next one is its retry
  let failReorderAfter = o.reorderFailAfter;      // spent once it has fired
  const subscribers = new Set<(snap: BoardSnapshot) => void>();
  const failures = new Map<string, StoreError>();
  const calls: FakeStore['calls'] = [];
  let beforeLatestWrite: BoardSnapshot | null = null;   // the board as it was when the latest write began
  let staleLoadsLeft = 0;

  const copy = () => structuredClone(board);
  /** Throws the failure queued for this method, if any; it fires once. */
  const checkFailure = (method: keyof BoardStore) => {
    const error = failures.get(method);
    if (error) { failures.delete(method); throw error; }
  };
  /** Start of every recorded method: note the call, then fail it if a failure is queued. */
  const enter = (method: keyof BoardStore, args: unknown[]) => {
    calls.push({ method, args });
    checkFailure(method);
    if (WRITES.has(method)) {
      beforeLatestWrite = copy();
      staleLoadsLeft = o.staleReads ?? 0;
    }
  };

  const cardNamed = (cardId: string): Card => {
    const card = board.cards.find(c => c.id === cardId);
    if (!card) throw invalid(`No card ${cardId}`);
    return card;
  };
  const uniqueFieldId = (name: string): string => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'field';
    let id = `f-${slug}`;
    for (let n = 2; board.dropdownFields.some(f => f.id === id); n++) id = `f-${slug}-${n}`;
    return id;
  };

  const store: FakeStore = {
    calls,
    failNext(method, error = new StoreError('network', 'Simulated failure')) { failures.set(method, error); },
    remote(mutate) {
      const next = copy();
      mutate(next);
      board = next;
      for (const notify of [...subscribers]) notify(copy());
    },
    snapshot: copy,
    subscriberCount: () => subscribers.size,

    async isConnected() { checkFailure('isConnected'); return connected; },
    async connect() { enter('connect', []); connected = true; },
    async load() {
      checkFailure('load');
      if (staleLoadsLeft > 0 && beforeLatestWrite) { staleLoadsLeft--; return structuredClone(beforeLatestWrite); }
      return copy();
    },
    subscribe(onChange) {
      checkFailure('subscribe');
      subscribers.add(onChange);
      return () => { subscribers.delete(onChange); };
    },

    async savePositions(cardId, positions) {
      enter('savePositions', [cardId, positions]);
      cardNamed(cardId);
      const stored = { ...board.placements[cardId]?.positions };
      for (const [paramId, v] of Object.entries(positions)) {
        if (v === null) delete stored[paramId];
        else stored[paramId] = clampPosition(v);
      }
      if (Object.keys(stored).length === 0) delete board.placements[cardId];
      else board.placements[cardId] = { positions: stored };
    },

    async setLevel(cardId, param, level) {
      enter('setLevel', [cardId, param, level]);
      const card = cardNamed(cardId);
      if (level === null) { delete card.fieldOptions[param.fieldId]; return; }
      const optionId = param.optionIds[level];
      if (!Number.isInteger(level) || optionId === undefined) throw invalid(`${param.name} has no level ${level}`);
      card.fieldOptions[param.fieldId] = optionId;
    },

    async createParameter(input: NewParameter) {
      enter('createParameter', [input]);
      const { name, levels: typed } = validateNewParameter(board, input);
      const id = uniqueFieldId(name);
      const field: DropdownField = {
        id, name, options: typed.map((text, i) => ({ id: `${id}-o${i}`, text, colour: 'none' })),
      };
      board.dropdownFields.push(field);
      const param = parameterFromField(field, input.bestEnd);
      board.parameters.push(param);
      return structuredClone(param);
    },

    async linkParameter(fieldId, bestEnd) {
      enter('linkParameter', [fieldId, bestEnd]);
      const field = validateLink(board, fieldId);
      const param = parameterFromField(field, bestEnd);
      board.parameters.push(param);
      return structuredClone(param);
    },

    async renameParameter(id, name) {
      enter('renameParameter', [id, name]);
      const clean = validateRenameParameter(board, id, name);
      const { param, field } = parameterNamed(board, id);
      param.name = clean;
      if (field) field.name = clean;
    },

    async renameLevel(id, level, name) {
      enter('renameLevel', [id, level, name]);
      const clean = validateRenameLevel(board, id, level, name);
      const { param, field } = parameterNamed(board, id);
      const optionId = param.optionIds[level];
      param.levels[level] = clean;
      const option = field?.options.find(opt => opt.id === optionId);
      if (option) option.text = clean;
    },

    async removeParameter(id) {
      enter('removeParameter', [id]);
      parameterNamed(board, id);
      board.parameters = board.parameters.filter(p => p.id !== id);
      // Removes it from the matrix only: the field, the cards' values and their stored
      // positions all stay, so linking the field again restores every card's exact spot.
    },

    async reorderLists(orders: ListOrder[], onProgress) {
      enter('reorderLists', [orders, onProgress]);
      const changes: { cardId: string; pos: number }[] = [];
      for (const order of orders) {
        const inList = new Set(board.cards.filter(c => c.idList === order.listId).map(c => c.id));
        const ids = [...new Set(order.cardIds)].filter(id => inList.has(id));
        changes.push(...positionsFor(ids));
      }
      // A retry keeps the positions saved by the first attempt (the cards it moved are no longer where they were).
      const saved = reorderInterrupted && undoPositions ? undoPositions : new Map<string, number>();
      for (const { cardId } of changes) if (!saved.has(cardId)) saved.set(cardId, cardNamed(cardId).pos);
      undoPositions = saved;
      board.canUndoReorder = true;
      reorderInterrupted = true;
      const stopAfter = failReorderAfter !== undefined && failReorderAfter < changes.length ? failReorderAfter : undefined;
      if (stopAfter !== undefined) failReorderAfter = undefined;
      applyPositions(changes, onProgress, stopAfter);
      reorderInterrupted = false;
    },

    async undoReorder(onProgress) {
      enter('undoReorder', [onProgress]);
      if (!undoPositions) throw invalid('Nothing to undo');
      applyPositions([...undoPositions].map(([cardId, pos]) => ({ cardId, pos })), onProgress);
      undoPositions = null;
      reorderInterrupted = false;
      board.canUndoReorder = false;
    },

    async openCard(cardId) { enter('openCard', [cardId]); },

    async coverImageUrl(cardId) {
      enter('coverImageUrl', [cardId]);
      const card = board.cards.find(c => c.id === cardId);
      return card?.hasCover ? coverDataUrl(card.id) : null;
    },

    async loadView() { checkFailure('loadView'); return view ? structuredClone(view) : null; },
    async saveView(next) { checkFailure('saveView'); view = structuredClone(next); },
  };

  /** Writes the positions one card at a time; with `stopAfter` it rejects once that many are written. */
  function applyPositions(changes: { cardId: string; pos: number }[], onProgress: (p: Progress) => void, stopAfter?: number) {
    changes.forEach(({ cardId, pos }, i) => {
      cardNamed(cardId).pos = pos;
      onProgress({ done: i + 1, total: changes.length });
      if (i + 1 === stopAfter) throw new StoreError('network', 'offline');
    });
  }

  return store;
}

/** A small flat-colour SVG, the colour taken from the card id so covers look different. */
function coverDataUrl(cardId: string): string {
  let hue = 0;
  for (let i = 0; i < cardId.length; i++) hue = (hue * 31 + cardId.charCodeAt(i)) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90">` +
    `<rect width="160" height="90" fill="hsl(${hue} 55% 70%)"/>` +
    `<circle cx="120" cy="30" r="14" fill="hsl(${hue} 55% 88%)"/>` +
    `<path d="M0 90 L55 40 L95 75 L120 55 L160 90 Z" fill="hsl(${hue} 45% 45%)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
