import { clampPosition, levelOf } from '../model/placement';
import { positionsFor } from '../model/resequence';
import type { BoardSnapshot, Card, DropdownField, Label, List, Member, Parameter } from '../model/types';

/**
 * A deterministic sample board for the fake store, tests and the dev page. The four fixtures
 * c1..c4 are fixed whatever the seed; the other cards are generated from it.
 */

const LISTS: List[] = [
  { id: 'l-backlog', name: 'Backlog' },
  { id: 'l-ideas', name: 'New Feature ideas' },
  { id: 'l-doing', name: 'Doing' },
];

const LABELS: Label[] = [
  { id: 'lb-uxui', name: 'UXUI', colour: 'pink_dark' },
  { id: 'lb-process', name: 'Process Improvement', colour: 'yellow' },
  { id: 'lb-compliance', name: 'Compliance', colour: 'pink_light' },
  { id: 'lb-architecture', name: 'Architecture', colour: 'black_dark' },
  { id: 'lb-bug', name: 'Bug', colour: 'red_dark' },
];

const MEMBERS: Member[] = [
  { id: 'm-ana', fullName: 'Ana Torres', initials: 'AT' },
  { id: 'm-ben', fullName: 'Ben Okafor', initials: 'BO' },
  { id: 'm-chen', fullName: 'Chen Wei', initials: 'CW' },
];

const IMPACT_IDS = ['opt-all', 'opt-ios', 'opt-android', 'opt-admin', 'opt-website', 'opt-backend'] as const;

const DROPDOWN_FIELDS: DropdownField[] = [
  {
    id: 'f-value', name: 'Value', options: [
      { id: 'v0', text: 'Low', colour: 'sky' }, { id: 'v1', text: 'Medium', colour: 'blue' }, { id: 'v2', text: 'High', colour: 'purple' },
    ],
  },
  {
    id: 'f-cost', name: 'Cost', options: [
      { id: 'k0', text: 'High', colour: 'red' }, { id: 'k1', text: 'Medium', colour: 'orange' }, { id: 'k2', text: 'Low', colour: 'green' },
    ],
  },
  {
    id: 'f-ease', name: 'Ease', options: [
      { id: 'e0', text: 'Hard', colour: 'orange' }, { id: 'e1', text: 'Easy', colour: 'lime' },
    ],
  },
  {
    id: 'f-impacts', name: 'Impacts', options: [
      { id: 'opt-all', text: 'All mobile', colour: 'pink' }, { id: 'opt-ios', text: 'iOS only', colour: 'blue' },
      { id: 'opt-android', text: 'Android only', colour: 'lime' }, { id: 'opt-admin', text: 'Admin', colour: 'black' },
      { id: 'opt-website', text: 'Website (not Admin)', colour: 'yellow' }, { id: 'opt-backend', text: 'Backend', colour: 'orange' },
    ],
  },
];

/** Levels worst to best, as the parameters store them. Cost's best end is Low. */
const PARAMETERS: Parameter[] = [
  { id: 'f-value', name: 'Value', fieldId: 'f-value', levels: ['Low', 'Medium', 'High'], optionIds: ['v0', 'v1', 'v2'] },
  { id: 'f-cost', name: 'Cost', fieldId: 'f-cost', levels: ['High', 'Medium', 'Low'], optionIds: ['k0', 'k1', 'k2'] },
  { id: 'f-ease', name: 'Ease', fieldId: 'f-ease', levels: ['Hard', 'Easy'], optionIds: ['e0', 'e1'] },
];

const ACTIONS = [
  'Add', 'Fix', 'Redesign', 'Speed up', 'Simplify', 'Audit', 'Migrate', 'Instrument', 'Document',
];
const THINGS = [
  'login screen', 'checkout flow', 'push notification settings', 'profile photo upload', 'offline sync',
  'search results', 'onboarding tour', 'order history', 'in-app receipts', 'deep link handling',
  'crash reporting', 'accessibility labels', 'dark mode colours', 'promo code entry',
];

/** Small seeded generator (mulberry32): the same seed gives the same board on every run. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Draft { card: Omit<Card, 'pos'>; positions: Record<string, number> }

/** The option id of the level that `position` falls in on a fixture parameter. */
function optionAt(paramId: string, position: number): string {
  const p = PARAMETERS.find(x => x.id === paramId)!;
  return p.optionIds[levelOf(position, p.levels.length)]!;
}

/** A draft with the given positions and the Value/Cost field options that agree with them. */
function draft(
  id: string, name: string, idList: string,
  positions: { 'f-value'?: number; 'f-cost'?: number },
  extra: { labelIds?: string[]; memberIds?: string[]; hasCover?: boolean; impact?: string },
): Draft {
  const fieldOptions: Record<string, string> = {};
  const stored: Record<string, number> = {};
  for (const [paramId, position] of Object.entries(positions)) {
    fieldOptions[paramId] = optionAt(paramId, position);
    stored[paramId] = position;
  }
  if (extra.impact !== undefined) fieldOptions['f-impacts'] = extra.impact;
  return {
    card: { id, name, idList, labelIds: extra.labelIds ?? [], memberIds: extra.memberIds ?? [], hasCover: extra.hasCover ?? false, fieldOptions },
    positions: stored,
  };
}

function fixtures(): Draft[] {
  return [
    draft('c1', 'Fixture top right', 'l-backlog', { 'f-value': 0.9, 'f-cost': 0.9 },
      { labelIds: ['lb-uxui'], memberIds: ['m-ana'], hasCover: true, impact: 'opt-ios' }),
    draft('c2', 'Fixture value only', 'l-backlog', { 'f-value': 0.5 },
      { labelIds: ['lb-process'], impact: 'opt-all' }),
    draft('c3', 'Fixture unplaced', 'l-backlog', {},
      { memberIds: ['m-ben', 'm-chen'], impact: 'opt-admin' }),
    draft('c4', 'Fixture with a very long title that has to be cut off somewhere sensible in a chip', 'l-backlog',
      { 'f-value': 0.1, 'f-cost': 0.1 }, { labelIds: ['lb-bug', 'lb-architecture'], impact: 'opt-android' }),
  ];
}

/** Every generated position stays in [0.16, 0.84], clear of the fixtures' corners. */
const SPREAD_LO = 0.16, SPREAD_HI = 0.84;
/** Value-only cards avoid [0.44, 0.56] so none sits on c2 (Value 0.5). */
const VALUE_ONLY_RANGES: [number, number][] = [[SPREAD_LO, 0.43], [0.57, SPREAD_HI]];

function generate(count: number, random: () => number): Draft[] {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const between = (lo: number, hi: number) => clampPosition(lo + random() * (hi - lo));

  const titles = ACTIONS.flatMap(a => THINGS.map(t => `${a} ${t}`));
  for (let i = titles.length - 1; i > 0; i--) {              // Fisher–Yates
    const j = Math.floor(random() * (i + 1));
    [titles[i], titles[j]] = [titles[j]!, titles[i]!];
  }

  const drafts: Draft[] = [];
  for (let i = 0; i < count; i++) {
    const round = Math.floor(i / titles.length);
    const title = titles[i % titles.length]! + (round === 0 ? '' : ` (${round + 1})`);

    const listRoll = random();
    const idList = listRoll < 0.65 ? 'l-backlog' : listRoll < 0.85 ? 'l-ideas' : 'l-doing';

    const placeRoll = random();
    const positions: { 'f-value'?: number; 'f-cost'?: number } = {};
    if (placeRoll < 0.7) {
      positions['f-value'] = between(SPREAD_LO, SPREAD_HI);
      positions['f-cost'] = between(SPREAD_LO, SPREAD_HI);
    } else if (placeRoll < 0.85) {
      const [lo, hi] = pick(VALUE_ONLY_RANGES);
      positions['f-value'] = between(lo, hi);
    }

    const labelIds = LABELS.filter(() => random() < 0.2).map(l => l.id);
    const memberIds = random() < 0.4 ? [pick(MEMBERS).id] : [];
    const hasCover = random() < 0.33;
    const impact = random() < 0.85 ? pick(IMPACT_IDS) : undefined;
    drafts.push(draft(`c${i + 5}`, title, idList, positions, { labelIds, memberIds, hasCover, impact }));
  }
  return drafts;
}

export function sampleSnapshot(o: { cards?: number; seed?: number } = {}): BoardSnapshot {
  const total = Math.max(0, o.cards ?? 85);
  const fixed = fixtures().slice(0, total);
  const drafts = [...fixed, ...generate(total - fixed.length, makeRandom(o.seed ?? 7))];

  // Within each list, cards sit in the order they were made, spaced as Trello spaces them.
  const posById = new Map<string, number>();
  for (const list of LISTS) {
    const ids = drafts.filter(d => d.card.idList === list.id).map(d => d.card.id);
    for (const { cardId, pos } of positionsFor(ids)) posById.set(cardId, pos);
  }

  const placements: BoardSnapshot['placements'] = {};
  for (const d of drafts) {
    if (Object.keys(d.positions).length > 0) placements[d.card.id] = { positions: d.positions };
  }
  return {
    lists: structuredClone(LISTS),
    cards: drafts.map(d => ({ ...d.card, pos: posById.get(d.card.id)! })),
    labels: structuredClone(LABELS),
    members: structuredClone(MEMBERS),
    dropdownFields: structuredClone(DROPDOWN_FIELDS),
    parameters: structuredClone(PARAMETERS),
    placements,
    canEdit: true,
    canUndoReorder: false,
  };
}
