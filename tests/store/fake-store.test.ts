import { describe, expect, test } from 'vitest';
import type { BoardSnapshot, Card, Parameter, ViewSettings } from '../../src/model/types';
import { levelOf, locate } from '../../src/model/placement';
import { StoreError, type Progress } from '../../src/store/board-store';
import { createFakeStore } from '../../src/store/fake-store';
import { sampleSnapshot } from '../../src/store/sample-data';

const byId = (s: BoardSnapshot, id: string): Card => {
  const c = s.cards.find(x => x.id === id);
  if (!c) throw new Error(`no card ${id}`);
  return c;
};
const param = (s: BoardSnapshot, id: string): Parameter => {
  const p = s.parameters.find(x => x.id === id);
  if (!p) throw new Error(`no parameter ${id}`);
  return p;
};
/** Ids of one list's cards in the order Trello would show them (ascending pos). */
const inListOrder = (s: BoardSnapshot, listId: string): string[] =>
  s.cards.filter(c => c.idList === listId).sort((a, b) => a.pos - b.pos).map(c => c.id);

const generated = (s: BoardSnapshot): Card[] => s.cards.filter(c => !['c1', 'c2', 'c3', 'c4'].includes(c.id));
const optionIdFor = (p: Parameter, position: number): string => p.optionIds[levelOf(position, p.levels.length)]!;

describe('sample board', () => {
  test('has the fixtures', () => {
    const s = sampleSnapshot();
    expect(s.cards).toHaveLength(85);
    expect(locate(byId(s, 'c1'), s.placements.c1, param(s, 'f-cost'), param(s, 'f-value'))).toEqual({ zone: 'matrix', x: 0.9, y: 0.9 });
    expect(locate(byId(s, 'c2'), s.placements.c2, param(s, 'f-cost'), param(s, 'f-value')).zone).toBe('leftStrip');
    expect(sampleSnapshot()).toEqual(sampleSnapshot()); // deterministic
  });

  test('lists, parameters, labels and the Impacts field are as the brief fixes them', () => {
    const s = sampleSnapshot();
    expect(s.lists).toEqual([
      { id: 'l-backlog', name: 'Backlog' }, { id: 'l-ideas', name: 'New Feature ideas' }, { id: 'l-doing', name: 'Doing' },
    ]);
    expect(s.parameters.map(p => [p.id, p.name, p.levels, p.optionIds])).toEqual([
      ['f-value', 'Value', ['Low', 'Medium', 'High'], ['v0', 'v1', 'v2']],
      ['f-cost', 'Cost', ['High', 'Medium', 'Low'], ['k0', 'k1', 'k2']],
      ['f-ease', 'Ease', ['Hard', 'Easy'], ['e0', 'e1']],
    ]);
    for (const p of s.parameters) {
      const field = s.dropdownFields.find(f => f.id === p.fieldId)!;
      expect(field.options.map(o => [o.id, o.text])).toEqual(p.optionIds.map((id, i) => [id, p.levels[i]]));
    }
    expect(s.labels.map(l => [l.name, l.colour])).toEqual([
      ['UXUI', 'pink_dark'], ['Process Improvement', 'yellow'], ['Compliance', 'pink_light'],
      ['Architecture', 'black_dark'], ['Bug', 'red_dark'],
    ]);
    const impacts = s.dropdownFields.find(f => f.id === 'f-impacts')!;
    expect(s.parameters.some(p => p.fieldId === 'f-impacts')).toBe(false);
    expect(impacts.options.map(o => [o.text, o.colour])).toEqual([
      ['All mobile', 'pink'], ['iOS only', 'blue'], ['Android only', 'lime'],
      ['Admin', 'black'], ['Website (not Admin)', 'yellow'], ['Backend', 'orange'],
    ]);
    expect(impacts.options.find(o => o.text === 'iOS only')!.id).toBe('opt-ios');
    expect(s.canEdit).toBe(true);
    expect(s.canUndoReorder).toBe(false);
  });

  test('fixture cards c1 to c4', () => {
    const s = sampleSnapshot();
    const [c1, c2, c3, c4] = ['c1', 'c2', 'c3', 'c4'].map(id => byId(s, id)) as [Card, Card, Card, Card];
    expect(c1.name).toBe('Fixture top right');
    expect(c2.name).toBe('Fixture value only');
    expect(c3.name).toBe('Fixture unplaced');
    expect(c4.name).toBe('Fixture with a very long title that has to be cut off somewhere sensible in a chip');
    for (const c of [c1, c2, c3, c4]) expect(c.idList).toBe('l-backlog');
    expect(c1.hasCover).toBe(true);
    expect(s.placements.c1!.positions).toEqual({ 'f-value': 0.9, 'f-cost': 0.9 });
    expect(c1.fieldOptions).toMatchObject({ 'f-value': 'v2', 'f-cost': 'k2' });
    expect(s.placements.c2!.positions).toEqual({ 'f-value': 0.5 });
    expect(c2.fieldOptions['f-value']).toBe('v1');
    expect(c2.fieldOptions['f-cost']).toBeUndefined();
    expect(s.placements.c3?.positions ?? {}).toEqual({});
    for (const id of ['f-value', 'f-cost', 'f-ease']) expect(c3.fieldOptions[id]).toBeUndefined();
    expect(s.placements.c4!.positions).toEqual({ 'f-value': 0.1, 'f-cost': 0.1 });
    expect(c4.fieldOptions).toMatchObject({ 'f-value': 'v0', 'f-cost': 'k0' });
  });

  test('generated cards: mix, ranges, and field options agreeing with positions', () => {
    const s = sampleSnapshot();
    const gen = generated(s);
    expect(gen).toHaveLength(81);
    const value = param(s, 'f-value'), cost = param(s, 'f-cost');
    let both = 0, valueOnly = 0, none = 0;
    for (const c of gen) {
      const pos = s.placements[c.id]?.positions ?? {};
      const v = pos['f-value'], k = pos['f-cost'];
      expect(c.fieldOptions['f-ease']).toBeUndefined();
      expect(pos['f-ease']).toBeUndefined();
      for (const x of [v, k]) if (x !== undefined) { expect(x).toBeGreaterThanOrEqual(0.16); expect(x).toBeLessThanOrEqual(0.84); }
      if (v !== undefined && k !== undefined) {
        both++;
        expect(c.fieldOptions['f-value']).toBe(optionIdFor(value, v));
        expect(c.fieldOptions['f-cost']).toBe(optionIdFor(cost, k));
      } else if (v !== undefined) {
        valueOnly++;
        expect(v < 0.44 || v > 0.56).toBe(true);
        expect(c.fieldOptions['f-value']).toBe(optionIdFor(value, v));
        expect(c.fieldOptions['f-cost']).toBeUndefined();
      } else {
        none++;
        expect(k).toBeUndefined();
        expect(c.fieldOptions['f-value']).toBeUndefined();
        expect(c.fieldOptions['f-cost']).toBeUndefined();
      }
    }
    expect(both + valueOnly + none).toBe(81);
    expect(both / 81).toBeGreaterThan(0.55); expect(both / 81).toBeLessThan(0.85);
    expect(valueOnly).toBeGreaterThan(3); expect(none).toBeGreaterThan(3);
  });

  test('c1 is nearest the top-right corner and c4 nearest the bottom-left of all placed cards', () => {
    const s = sampleSnapshot();
    const cost = param(s, 'f-cost'), value = param(s, 'f-value');
    const placed = s.cards
      .map(c => ({ id: c.id, at: locate(c, s.placements[c.id], cost, value) }))
      .filter(x => x.at.zone === 'matrix');
    const dist = (x: number, y: number, tx: number, ty: number) => Math.hypot(x - tx, y - ty);
    const near = (tx: number, ty: number) =>
      placed.sort((a, b) => dist(a.at.x!, a.at.y!, tx, ty) - dist(b.at.x!, b.at.y!, tx, ty))[0]!.id;
    expect(near(1, 1)).toBe('c1');
    expect(near(0, 0)).toBe('c4');
  });

  test('spread over lists, covers, Impacts, members and distinct names', () => {
    const s = sampleSnapshot();
    const gen = generated(s);
    const share = (pred: (c: Card) => boolean) => gen.filter(pred).length / gen.length;
    expect(share(c => c.idList === 'l-backlog')).toBeGreaterThan(0.5);
    expect(share(c => c.idList === 'l-backlog')).toBeLessThan(0.8);
    expect(share(c => c.idList === 'l-ideas')).toBeGreaterThan(0.08);
    expect(share(c => c.idList === 'l-doing')).toBeGreaterThan(0.05);
    expect(share(c => c.hasCover)).toBeGreaterThan(0.2);
    expect(share(c => c.hasCover)).toBeLessThan(0.45);
    expect(share(c => c.fieldOptions['f-impacts'] !== undefined)).toBeGreaterThan(0.6);
    expect(s.members.length).toBeGreaterThanOrEqual(2);
    expect(s.cards.some(c => c.memberIds.length > 0)).toBe(true);
    const optionIds = new Set(s.dropdownFields.find(f => f.id === 'f-impacts')!.options.map(o => o.id));
    for (const c of s.cards) {
      const o = c.fieldOptions['f-impacts'];
      if (o !== undefined) expect(optionIds.has(o)).toBe(true);
    }
    expect(new Set(s.cards.map(c => c.name)).size).toBe(s.cards.length);
    expect(new Set(s.cards.map(c => c.id)).size).toBe(s.cards.length);
    for (const list of s.lists) {
      const pos = s.cards.filter(c => c.idList === list.id).map(c => c.pos);
      expect(new Set(pos).size).toBe(pos.length);
    }
  });

  test('card count and seed options; the seed changes the generated cards only', () => {
    expect(sampleSnapshot({ cards: 30 }).cards).toHaveLength(30);
    const a = sampleSnapshot({ seed: 1 }), b = sampleSnapshot({ seed: 2 });
    expect(a).not.toEqual(b);
    for (const id of ['c1', 'c2', 'c3', 'c4']) {
      expect(byId(a, id)).toEqual(byId(b, id));
      expect(a.placements[id]).toEqual(b.placements[id]);
    }
  });
});

describe('fake store', () => {
  test('setLevel and savePositions change what load returns', async () => {
    const st = createFakeStore();
    const cost = param(await st.load(), 'f-cost');
    await st.setLevel('c3', cost, 2); await st.savePositions('c3', { 'f-cost': 0.95 });
    const s = await st.load();
    expect(byId(s, 'c3').fieldOptions['f-cost']).toBe(cost.optionIds[2]);
    expect(s.placements.c3!.positions['f-cost']).toBe(0.95);
    await st.savePositions('c3', { 'f-cost': null });
    expect((await st.load()).placements.c3?.positions['f-cost']).toBeUndefined();
  });

  test('setLevel null clears the field value; savePositions clamps and keeps other positions', async () => {
    const st = createFakeStore();
    const value = param(await st.load(), 'f-value');
    await st.setLevel('c1', value, null);
    expect(byId(await st.load(), 'c1').fieldOptions['f-value']).toBeUndefined();
    await st.savePositions('c1', { 'f-cost': 1.5 });
    const pos = (await st.load()).placements.c1!.positions;
    expect(pos['f-cost']).toBe(0.999);
    expect(pos['f-value']).toBe(0.9);
  });

  test('writes to an unknown card or a bad level are rejected as invalid', async () => {
    const st = createFakeStore();
    const value = param(await st.load(), 'f-value');
    await expect(st.setLevel('nope', value, 0)).rejects.toMatchObject({ kind: 'invalid' });
    await expect(st.setLevel('c1', value, 3)).rejects.toMatchObject({ kind: 'invalid' });
    await expect(st.savePositions('nope', { 'f-value': 0.5 })).rejects.toMatchObject({ kind: 'invalid' });
  });

  test('load and snapshot return deep copies', async () => {
    const st = createFakeStore();
    const s = await st.load();
    s.cards[0]!.name = 'changed'; s.parameters.pop(); delete s.placements.c1;
    const again = st.snapshot();
    expect(again.cards[0]!.name).not.toBe('changed');
    expect(again.parameters).toHaveLength(3);
    expect(again.placements.c1).toBeDefined();
    again.cards[0]!.name = 'changed too';
    expect(st.snapshot().cards[0]!.name).not.toBe('changed too');
  });

  test('createParameter stores levels worst to best', async () => {
    const st = createFakeStore();
    const p = await st.createParameter({ name: 'Risk', levels: ['Low', 'High'], bestEnd: 'first' });
    expect(p.levels).toEqual(['High', 'Low']);
    const s = await st.load();
    const field = s.dropdownFields.find(f => f.id === p.fieldId)!;
    expect(field.options.map(o => o.text)).toEqual(['Low', 'High']);
    expect(p.optionIds.map(id => field.options.find(o => o.id === id)!.text)).toEqual(['High', 'Low']);
    expect(s.parameters.at(-1)).toEqual(p);
    const q = await st.createParameter({ name: 'Effort', levels: ['S', 'M', 'L'], bestEnd: 'last' });
    expect(q.levels).toEqual(['S', 'M', 'L']);
    expect(q.id).not.toBe(p.id);
  });

  test('createParameter rejects 1 or 4 levels and duplicate names', async () => {
    await expect(createFakeStore().createParameter({ name: 'X', levels: ['a'], bestEnd: 'last' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(createFakeStore().createParameter({ name: 'X', levels: ['a', 'b', 'c', 'd'], bestEnd: 'last' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(createFakeStore().createParameter({ name: 'Value', levels: ['a', 'b'], bestEnd: 'last' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(createFakeStore().createParameter({ name: ' ', levels: ['a', 'b'], bestEnd: 'last' })).rejects.toMatchObject({ kind: 'invalid' });
  });

  test('removeParameter keeps the field and card values', async () => {
    const st = createFakeStore();
    const ease = param(await st.load(), 'f-ease');
    await st.setLevel('c3', ease, 1);
    await st.savePositions('c3', { 'f-ease': 0.8 });
    await st.removeParameter('f-ease');
    const s = await st.load();
    expect(s.parameters.map(p => p.id)).toEqual(['f-value', 'f-cost']);
    expect(s.dropdownFields.some(f => f.id === 'f-ease')).toBe(true);
    expect(byId(s, 'c3').fieldOptions['f-ease']).toBe('e1');
    expect(s.placements.c3!.positions['f-ease']).toBe(0.8);          // exact position is kept
    await expect(st.removeParameter('f-ease')).rejects.toMatchObject({ kind: 'invalid' });
    await st.linkParameter('f-ease', 'last');
    const relinked = await st.load();
    expect(relinked.parameters.map(p => p.id)).toEqual(['f-value', 'f-cost', 'f-ease']);
    expect(relinked.placements.c3!.positions['f-ease']).toBe(0.8);
    expect(byId(relinked, 'c3').fieldOptions['f-ease']).toBe('e1');
  });

  test('linkParameter turns an existing dropdown field into a parameter', async () => {
    const st = createFakeStore();
    await st.removeParameter('f-ease');
    const p = await st.linkParameter('f-ease', 'last');
    expect(p).toMatchObject({ id: 'f-ease', name: 'Ease', fieldId: 'f-ease', levels: ['Hard', 'Easy'], optionIds: ['e0', 'e1'] });
    expect((await st.load()).parameters.map(x => x.id)).toEqual(['f-value', 'f-cost', 'f-ease']);
    await st.removeParameter('f-ease');
    const flipped = await st.linkParameter('f-ease', 'first');
    expect(flipped.levels).toEqual(['Easy', 'Hard']);
    expect(flipped.optionIds).toEqual(['e1', 'e0']);
    await expect(st.linkParameter('f-ease', 'last')).rejects.toMatchObject({ kind: 'invalid' });      // already linked
    await expect(st.linkParameter('f-impacts', 'last')).rejects.toMatchObject({ kind: 'invalid' });   // six options
    await expect(st.linkParameter('nope', 'last')).rejects.toMatchObject({ kind: 'invalid' });
  });

  test('renameParameter and renameLevel update the parameter and its field', async () => {
    const st = createFakeStore();
    await st.renameParameter('f-value', 'Impact on users');
    await st.renameLevel('f-value', 2, 'Huge');
    const s = await st.load();
    expect(param(s, 'f-value').name).toBe('Impact on users');
    expect(param(s, 'f-value').levels).toEqual(['Low', 'Medium', 'Huge']);
    const field = s.dropdownFields.find(f => f.id === 'f-value')!;
    expect(field.name).toBe('Impact on users');
    expect(field.options.map(o => o.text)).toEqual(['Low', 'Medium', 'Huge']);
    await expect(st.renameParameter('f-value', 'Cost')).rejects.toMatchObject({ kind: 'invalid' });
    await expect(st.renameParameter('f-value', '  ')).rejects.toMatchObject({ kind: 'invalid' });
    await expect(st.renameLevel('f-value', 5, 'x')).rejects.toMatchObject({ kind: 'invalid' });
    await expect(st.renameParameter('nope', 'x')).rejects.toMatchObject({ kind: 'invalid' });
  });

  test('reorderLists then undoReorder restores the exact positions', async () => {
    const st = createFakeStore();
    const before = (await st.load()).cards.filter(c => c.idList === 'l-backlog').map(c => [c.id, c.pos]);
    const ids = before.map(b => b[0] as string).reverse();
    const seen: Progress[] = [];
    await st.reorderLists([{ listId: 'l-backlog', cardIds: ids }], p => seen.push(p));
    expect(inListOrder(await st.load(), 'l-backlog')).toEqual(ids);
    expect(seen.at(-1)).toEqual({ done: ids.length, total: ids.length });
    expect(seen).toHaveLength(ids.length);
    expect((await st.load()).canUndoReorder).toBe(true);
    await st.undoReorder(() => {});
    expect((await st.load()).cards.filter(c => c.idList === 'l-backlog').map(c => [c.id, c.pos])).toEqual(before);
    expect((await st.load()).canUndoReorder).toBe(false);
  });

  test('reorderLists handles several lists, reports progress per card, and ignores ids from other lists', async () => {
    const st = createFakeStore();
    const s0 = await st.load();
    const ideas = inListOrder(s0, 'l-ideas').reverse();
    const doing = inListOrder(s0, 'l-doing').reverse();
    const foreign = inListOrder(s0, 'l-backlog')[0]!;
    const foreignPos = byId(s0, foreign).pos;
    const seen: Progress[] = [];
    await st.reorderLists(
      [{ listId: 'l-ideas', cardIds: [...ideas, foreign] }, { listId: 'l-doing', cardIds: doing }],
      p => seen.push(p),
    );
    const total = ideas.length + doing.length;
    expect(seen.map(p => p.done)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(seen.every(p => p.total === total)).toBe(true);
    const s1 = await st.load();
    expect(inListOrder(s1, 'l-ideas')).toEqual(ideas);
    expect(inListOrder(s1, 'l-doing')).toEqual(doing);
    expect(byId(s1, foreign).idList).toBe('l-backlog');
    expect(byId(s1, foreign).pos).toBe(foreignPos);
    await st.undoReorder(() => {});
    expect(inListOrder(await st.load(), 'l-ideas')).toEqual(inListOrder(s0, 'l-ideas'));
  });

  test('undoReorder with nothing to undo is rejected as invalid', async () => {
    await expect(createFakeStore().undoReorder(() => {})).rejects.toMatchObject({ kind: 'invalid' });
  });

  test('failNext rejects once and changes nothing', async () => {
    const st = createFakeStore(); st.failNext('setLevel', new StoreError('network', 'offline'));
    await expect(st.setLevel('c1', param(await st.load(), 'f-cost'), 0)).rejects.toMatchObject({ kind: 'network' });
    expect(byId(await st.load(), 'c1').fieldOptions['f-cost']).toBe('k2');
    await st.setLevel('c1', param(await st.load(), 'f-cost'), 0);          // the next call goes through
    expect(byId(await st.load(), 'c1').fieldOptions['f-cost']).toBe('k0');
  });

  test('failNext defaults to a network StoreError and also works for load', async () => {
    const st = createFakeStore(); st.failNext('load');
    const err = await st.load().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StoreError);
    expect(err).toMatchObject({ kind: 'network', message: 'Simulated failure' });
    await expect(st.load()).resolves.toBeDefined();
  });

  test('a failed reorder changes nothing and keeps undo unavailable', async () => {
    const st = createFakeStore(); const before = st.snapshot();
    st.failNext('reorderLists');
    await expect(st.reorderLists([{ listId: 'l-doing', cardIds: inListOrder(before, 'l-doing').reverse() }], () => {})).rejects.toBeInstanceOf(StoreError);
    expect(st.snapshot()).toEqual(before);
  });

  test('remote notifies subscribers once with the mutated snapshot, and unsubscribe stops it', () => {
    const st = createFakeStore();
    const got: BoardSnapshot[] = [];
    const off = st.subscribe(s => got.push(s));
    st.remote(s => { byId(s, 'c3').name = 'Renamed by someone else'; });
    expect(got).toHaveLength(1);
    expect(byId(got[0]!, 'c3').name).toBe('Renamed by someone else');
    expect(byId(st.snapshot(), 'c3').name).toBe('Renamed by someone else');
    got[0]!.cards.length = 0;                                   // a subscriber cannot corrupt the store
    expect(st.snapshot().cards).toHaveLength(85);
    off();
    st.remote(s => { byId(s, 'c3').name = 'Again'; });
    expect(got).toHaveLength(1);
    expect(byId(st.snapshot(), 'c3').name).toBe('Again');
  });

  test('connected defaults to true; connect() connects', async () => {
    expect(await createFakeStore().isConnected()).toBe(true);
    const st = createFakeStore({ connected: false });
    expect(await st.isConnected()).toBe(false);
    await st.connect();
    expect(await st.isConnected()).toBe(true);
  });

  test('a snapshot can be supplied', async () => {
    const st = createFakeStore({ snapshot: sampleSnapshot({ cards: 10 }) });
    expect((await st.load()).cards).toHaveLength(10);
  });

  test('coverImageUrl is an inline SVG data URL for cards with a cover, otherwise null', async () => {
    const st = createFakeStore();
    const url = await st.coverImageUrl('c1');
    expect(url).toMatch(/^data:image\/svg\+xml/);
    expect(await st.coverImageUrl('c3')).toBeNull();
    expect(await st.coverImageUrl('nope')).toBeNull();
  });

  test('loadView and saveView round-trip, starting from null', async () => {
    const st = createFakeStore();
    expect(await st.loadView()).toBeNull();
    const view: ViewSettings = {
      across: 'f-cost', up: 'f-value', listIds: ['l-backlog'], colourBy: { kind: 'field', fieldId: 'f-impacts' },
      showImages: true, zoom: 2, panX: 10, panY: -5,
    };
    await st.saveView(view);
    const back = await st.loadView();
    expect(back).toEqual(view);
    back!.listIds.push('x');
    expect((await st.loadView())!.listIds).toEqual(['l-backlog']);
  });

  test('calls records only outward and mutating methods, with their arguments', async () => {
    const st = createFakeStore({ connected: false });
    await st.isConnected(); await st.load(); st.subscribe(() => {})(); await st.loadView();
    await st.saveView({ across: null, up: null, listIds: [], colourBy: { kind: 'list' }, showImages: false, zoom: 1, panX: 0, panY: 0 });
    expect(st.calls).toEqual([]);
    const cost = param(st.snapshot(), 'f-cost');
    await st.connect();
    await st.savePositions('c3', { 'f-cost': 0.4 });
    await st.setLevel('c3', cost, 1);
    await st.openCard('c1');
    await st.coverImageUrl('c1');
    expect(st.calls.map(c => c.method)).toEqual(['connect', 'savePositions', 'setLevel', 'openCard', 'coverImageUrl']);
    expect(st.calls[1]!.args).toEqual(['c3', { 'f-cost': 0.4 }]);
    expect(st.calls[3]!.args).toEqual(['c1']);
  });

  test('every mutating method is recorded, including calls that then fail', async () => {
    const st = createFakeStore();
    await st.createParameter({ name: 'Risk', levels: ['a', 'b'], bestEnd: 'last' });
    await st.renameParameter('f-ease', 'Easiness');
    await st.renameLevel('f-ease', 0, 'Tough');
    await st.removeParameter('f-ease');
    await st.linkParameter('f-ease', 'last');
    await st.reorderLists([], () => {});
    await st.undoReorder(() => {});
    st.failNext('openCard');
    await expect(st.openCard('c1')).rejects.toBeInstanceOf(StoreError);
    expect(st.calls.map(c => c.method)).toEqual([
      'createParameter', 'renameParameter', 'renameLevel', 'removeParameter', 'linkParameter',
      'reorderLists', 'undoReorder', 'openCard',
    ]);
  });
});
