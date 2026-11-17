// Our own recent REST writes, laid over what the Power-Up's data shows until that data catches up (about a
// quarter of a second later). Without this a fresh read would show the person their own change being undone.
import type { BoardSnapshot, Card, DropdownField } from '../model/types';
import { joinParameters, type StoredParam } from './plugin-data';

export interface Overlay {
  /** We set this card's dropdown value from `was` to `optionId` (null means cleared). */
  noteFieldOption(cardId: string, fieldId: string, optionId: string | null, was: string | null): void;
  /** We created this dropdown field. */
  noteField(field: DropdownField): void;
  /** Returns the snapshot with the noted writes it does not show yet laid over it. Never changes its argument. */
  apply(snap: BoardSnapshot, stored?: StoredParam[]): BoardSnapshot;
  /** How many noted writes are still waiting to be seen. */
  pending(): number;
}

/** A write we made. `before` holds every value the snapshot may still show from before it took effect. */
interface Note<V> { value: V; before: Set<V>; at: number }

/**
 * What a note says about the value the snapshot shows now: it has arrived (forget the note), it is stale (lay our
 * value over it and keep the note), or it is someone else's (forget the note).
 */
type Verdict = 'arrived' | 'stale' | 'other';

const copyField = (f: DropdownField): DropdownField => ({ ...f, options: f.options.map(opt => ({ ...opt })) });

export function createOverlay(o: { now: () => number; ttlMs?: number }): Overlay {
  const ttlMs = o.ttlMs ?? 15000;
  const fieldNotes = new Map<string, Map<string, Note<string | null>>>();   // card id → field id → note
  const fieldCreates = new Map<string, { field: DropdownField; at: number }>();

  const expired = (at: number) => o.now() - at > ttlMs;

  /** A new note for the same target replaces the old one; values the old one expected still count as "before". */
  function replace<V>(prev: Note<V> | undefined, value: V, was: V): Note<V> {
    const before = new Set<V>([was]);
    if (prev) { before.add(prev.value); for (const v of prev.before) before.add(v); }
    return { value, before, at: o.now() };
  }

  function judge<V>(note: Note<V>, shown: V): Verdict {
    // A value set and then set back is both our newest value and an earlier one: a read showing it may be from
    // before either write, so the note stays until a read shows something else or the time runs out.
    if (note.before.has(note.value)) return note.before.has(shown) ? 'stale' : 'other';
    if (shown === note.value) return 'arrived';
    return note.before.has(shown) ? 'stale' : 'other';
  }

  function forgetExpired() {
    for (const [cardId, byField] of fieldNotes) {
      for (const [fieldId, n] of byField) if (expired(n.at)) byField.delete(fieldId);
      if (byField.size === 0) fieldNotes.delete(cardId);
    }
    for (const [fieldId, n] of fieldCreates) if (expired(n.at)) fieldCreates.delete(fieldId);
  }

  function apply(snap: BoardSnapshot, stored?: StoredParam[]): BoardSnapshot {
    forgetExpired();
    const known = new Set(snap.cards.map(c => c.id));
    let changed = false;

    // Notes about cards that are gone are forgotten first.
    for (const cardId of [...fieldNotes.keys()]) if (!known.has(cardId)) fieldNotes.delete(cardId);

    const cards = snap.cards.map((card): Card => {
      let next = card;
      const byField = fieldNotes.get(card.id);
      if (byField) {
        for (const [fieldId, note] of byField) {
          const shown = Object.hasOwn(card.fieldOptions, fieldId) ? card.fieldOptions[fieldId]! : null;
          if (judge(note, shown) !== 'stale') { byField.delete(fieldId); continue; }
          if (shown === note.value) continue;   // set back to what it shows: nothing to lay over, the note stays
          // A computed key makes an own property even for a key such as `__proto__`, which an assignment would not.
          const { [fieldId]: _dropped, ...rest } = next.fieldOptions;
          next = { ...next, fieldOptions: note.value === null ? rest : { ...rest, [fieldId]: note.value } };
        }
        if (byField.size === 0) fieldNotes.delete(card.id);
      }
      if (next !== card) changed = true;
      return next;
    });

    const have = new Set(snap.dropdownFields.map(f => f.id));
    const added: DropdownField[] = [];
    for (const [fieldId, n] of fieldCreates) {
      if (have.has(fieldId)) fieldCreates.delete(fieldId); else added.push(copyField(n.field));
    }

    if (!changed && added.length === 0 && stored === undefined) return snap;
    const dropdownFields = added.length > 0 ? [...snap.dropdownFields, ...added] : snap.dropdownFields;
    return {
      ...snap,
      cards: changed ? cards : snap.cards,
      dropdownFields,
      parameters: stored === undefined ? snap.parameters : joinParameters(stored, dropdownFields),
    };
  }

  return {
    noteFieldOption(cardId, fieldId, optionId, was) {
      forgetExpired();
      let byField = fieldNotes.get(cardId);
      if (!byField) fieldNotes.set(cardId, byField = new Map());
      byField.set(fieldId, replace(byField.get(fieldId), optionId, was));
    },
    noteField(field) {
      forgetExpired();
      fieldCreates.set(field.id, { field: copyField(field), at: o.now() });
    },
    apply,
    pending() {
      forgetExpired();
      let n = fieldCreates.size;
      for (const byField of fieldNotes.values()) n += byField.size;
      return n;
    },
  };
}
