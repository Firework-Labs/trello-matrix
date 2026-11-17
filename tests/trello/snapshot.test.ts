import { describe, expect, test } from 'vitest';
import { coverUrlOf, coverUrls, toSnapshot, type RawBoardData } from '../../src/trello/snapshot';

const COVER = {
  date: '2026-11-01T10:00:00.000Z', edgeColor: '#aabbcc', id: 'a1', idMember: 'm1', name: 'x.jpeg',
  url: 'https://trello.com/1/cards/c1/attachments/a1/download/x.jpeg',
  previews: [
    { url: 'https://trello.com/p/150', width: 150, height: 100 },
    { url: 'https://trello.com/p/600', width: 600, height: 400 },
    { url: 'https://trello.com/p/1200', width: 1200, height: 800 },
  ],
};

/** One realistic raw board, with the key shapes a live board returned. */
function rawBoard(): RawBoardData {
  return {
    cards: [
      {
        id: 'c1', name: 'One', idList: 'l1', pos: 100,
        labels: [{ id: 'lab1', name: 'UXUI', color: 'pink_dark' }],
        members: [{ id: 'm1', fullName: 'Mike Klar' }],
        cover: COVER,
        customFieldItems: [{ id: 'i1', idCustomField: 'f1', idValue: 'oHigh' }],
      },
      { id: 'c2', name: 'Two', idList: 'l2', pos: 200, labels: [], members: [], cover: null, customFieldItems: [] },
    ],
    lists: [{ id: 'l1', name: 'Backlog' }, { id: 'l2', name: 'Ideas' }],
    board: {
      id: 'b1',
      labels: [{ id: 'lab1', name: 'UXUI', color: 'pink_dark' }],
      members: [{ id: 'm1', fullName: 'Mike Klar' }],
      customFields: [{
        id: 'f1', name: 'Value', type: 'list', display: { cardFront: true }, pos: 1,
        options: [
          { id: 'oMed', value: { text: 'Medium' }, color: 'yellow', pos: 2 },
          { id: 'oHigh', value: { text: 'High' }, color: 'red', pos: 3 },
          { id: 'oLow', value: { text: 'Low' }, color: 'none', pos: 1 },
        ],
      }],
    },
    cardData: { c1: { p: { f1: 0.9 } } },
    params: [{ f: 'f1', o: ['oLow', 'oMed', 'oHigh'] }],
    canEdit: true,
  };
}

const withFields = (customFields: unknown): RawBoardData => ({ ...rawBoard(), board: { customFields } });
const withCards = (cards: unknown): RawBoardData => ({ ...rawBoard(), cards });
const field = (options: unknown, extra: object = {}) => ({ id: 'f1', name: 'Value', type: 'list', options, ...extra });

describe('toSnapshot', () => {
  test('maps a realistic board', () => {
    const s = toSnapshot(rawBoard());
    expect(s.lists).toEqual([{ id: 'l1', name: 'Backlog' }, { id: 'l2', name: 'Ideas' }]);
    expect(s.labels[0]).toEqual({ id: 'lab1', name: 'UXUI', colour: 'pink_dark' });
    expect(s.members[0]).toEqual({ id: 'm1', fullName: 'Mike Klar', initials: 'MK' });
    expect(s.dropdownFields).toEqual([{ id: 'f1', name: 'Value', options: [{ id: 'oLow', text: 'Low', colour: 'none' }, { id: 'oMed', text: 'Medium', colour: 'yellow' }, { id: 'oHigh', text: 'High', colour: 'red' }] }]);
    expect(s.cards[0]).toEqual({ id: 'c1', name: 'One', idList: 'l1', pos: 100, labelIds: ['lab1'], memberIds: ['m1'], hasCover: true, fieldOptions: { f1: 'oHigh' } });
    expect(s.cards[1]).toEqual({ id: 'c2', name: 'Two', idList: 'l2', pos: 200, labelIds: [], memberIds: [], hasCover: false, fieldOptions: {} });
    expect(s.placements).toEqual({ c1: { positions: { f1: 0.9 } } });
    expect(s.parameters).toEqual([{ id: 'f1', name: 'Value', levels: ['Low', 'Medium', 'High'], fieldId: 'f1', optionIds: ['oLow', 'oMed', 'oHigh'] }]);
    expect(s.canEdit).toBe(true);
  });

  test('canEdit is passed through', () => {
    expect(toSnapshot({ ...rawBoard(), canEdit: false }).canEdit).toBe(false);
  });

  test('options follow pos when every option has one, the given order otherwise', () => {
    const shuffled = [
      { id: 'c', value: { text: 'C' }, color: 'red', pos: 30 },
      { id: 'a', value: { text: 'A' }, color: 'red', pos: 10 },
      { id: 'b', value: { text: 'B' }, color: 'red', pos: 20 },
    ];
    expect(toSnapshot(withFields([field(shuffled)])).dropdownFields[0]!.options.map(o => o.id)).toEqual(['a', 'b', 'c']);
    const oneMissing = [shuffled[0]!, { id: 'a', value: { text: 'A' } }, shuffled[2]!];
    expect(toSnapshot(withFields([field(oneMissing)])).dropdownFields[0]!.options.map(o => o.id)).toEqual(['c', 'a', 'b']);
    const nonNumeric = [{ id: 'z', pos: 1 }, { id: 'y', pos: '0' }];
    expect(toSnapshot(withFields([field(nonNumeric)])).dropdownFields[0]!.options.map(o => o.id)).toEqual(['z', 'y']);
  });

  test('an option without value.text falls back to text, then to an empty string', () => {
    const s = toSnapshot(withFields([field([
      { id: 'o1', value: { text: 'From value' }, text: 'ignored' },
      { id: 'o2', text: 'From text' },
      { id: 'o3', value: {} },
      { id: 'o4', value: { text: 5 }, text: 7 },
    ])]));
    expect(s.dropdownFields[0]!.options.map(o => o.text)).toEqual(['From value', 'From text', '', '']);
  });

  test('an option colour defaults to none, and an option without an id is skipped', () => {
    const s = toSnapshot(withFields([field([{ id: 'o1', value: { text: 'A' } }, { value: { text: 'no id' } }, 'x', null, { id: 'o2', value: { text: 'B' }, color: 'blue' }])]));
    expect(s.dropdownFields[0]!.options).toEqual([{ id: 'o1', text: 'A', colour: 'none' }, { id: 'o2', text: 'B', colour: 'blue' }]);
  });

  test('non-dropdown custom fields are left out', () => {
    const s = toSnapshot(withFields([
      { id: 'ft', name: 'Notes', type: 'text' },
      { id: 'fn', name: 'Points', type: 'number' },
      { id: 'fc', name: 'Done', type: 'checkbox' },
      { id: 'fd', name: 'Due', type: 'date' },
      field([{ id: 'o1', value: { text: 'A' } }], { id: 'fl', name: 'Keep' }),
    ]));
    expect(s.dropdownFields.map(f => f.id)).toEqual(['fl']);
  });

  test('a custom field item without idValue is not a level', () => {
    const s = toSnapshot(withCards([{
      id: 'c1', idList: 'l1',
      customFieldItems: [
        { idCustomField: 'f1', value: { text: 'x' } },
        { idCustomField: 'f2', idValue: '' },
        { idCustomField: 'f3', idValue: 7 },
        { idCustomField: 'f4', idValue: 'o4' },
        { idValue: 'o5' },
      ],
    }]));
    expect(s.cards[0]!.fieldOptions).toEqual({ f4: 'o4' });
    expect('f1' in s.cards[0]!.fieldOptions).toBe(false);
  });

  test('a card with no cover, a null cover, or a cover with no usable address has hasCover false', () => {
    const s = toSnapshot(withCards([
      { id: 'a', idList: 'l1' },
      { id: 'b', idList: 'l1', cover: null },
      { id: 'c', idList: 'l1', cover: { url: 'http://insecure/x.png', previews: [{ url: 'data:image/png;base64,AA', width: 10 }] } },
      { id: 'd', idList: 'l1', cover: COVER },
    ]));
    expect(s.cards.map(c => c.hasCover)).toEqual([false, false, false, true]);
  });

  test('initials: the given ones, else the first letters of the first two words, else ?', () => {
    const s = toSnapshot({ ...rawBoard(), board: { members: [
      { id: 'a', fullName: 'Mike Klar', initials: 'mk2' },
      { id: 'b', fullName: 'ada king lovelace' },
      { id: 'c', fullName: '  Plato ' },
      { id: 'd', fullName: '   ' },
      { id: 'e', fullName: 'Mike Klar', initials: '' },
      { id: 'f' },
    ] } });
    expect(s.members.map(m => m.initials)).toEqual(['mk2', 'AK', 'P', '?', 'MK', '?']);
    expect(s.members[5]).toEqual({ id: 'f', fullName: '', initials: '?' });
  });

  test('junk never throws and is left out', () => {
    expect(() => toSnapshot({ cards: 'x', lists: null, board: 7, cardData: {}, params: 'p', canEdit: false })).not.toThrow();
    const s = toSnapshot({ cards: [null, 5, { name: 'no id' }, { id: 'c9', idList: 'l1', pos: 'NaN' }], lists: [{ id: 'l1' }, 'x'], board: { labels: [{}], members: [{ id: 'm2' }], customFields: 'nope' }, cardData: { c9: 'junk' }, params: [{ f: 'gone', o: ['a', 'b'] }], canEdit: false });
    expect(s.cards).toEqual([{ id: 'c9', name: '', idList: 'l1', pos: 0, labelIds: [], memberIds: [], hasCover: false, fieldOptions: {} }]);
    expect(s.lists).toEqual([{ id: 'l1', name: '' }]); expect(s.labels).toEqual([]); expect(s.members).toEqual([{ id: 'm2', fullName: '', initials: '?' }]);
    expect(s.parameters).toEqual([]); expect(s.placements).toEqual({});
  });

  test('junk of every kind in every place still gives a snapshot', () => {
    for (const junk of [null, undefined, 0, 'x', [], {}, true]) {
      const raw = { cards: junk, lists: junk, board: junk, cardData: junk, params: junk, canEdit: true } as unknown as RawBoardData;
      expect(() => toSnapshot(raw)).not.toThrow();
      const s = toSnapshot(raw);
      expect(s).toMatchObject({ lists: [], cards: [], labels: [], members: [], dropdownFields: [], parameters: [], placements: {}, canEdit: true });
    }
    const s = toSnapshot(withCards([
      { id: 'c1', idList: 'l1', name: 5, pos: Infinity, labels: 'x', members: [null, { fullName: 'no id' }], cover: 'x', customFieldItems: { a: 1 } },
      { id: 'c2', idList: 7 },
    ]));
    expect(s.cards).toEqual([{ id: 'c1', name: '', idList: 'l1', pos: 0, labelIds: [], memberIds: [], hasCover: false, fieldOptions: {} }]);
  });

  test('a card keeps its labels and members that have an id and drops the rest', () => {
    const s = toSnapshot(withCards([{ id: 'c1', idList: 'l1', labels: [{ id: 'a' }, { name: 'x' }, 3, { id: 'b' }], members: [{ id: 'm1' }, {}] }]));
    expect(s.cards[0]).toMatchObject({ labelIds: ['a', 'b'], memberIds: ['m1'] });
  });

  test('a label without a name or colour gets an empty name and a null colour', () => {
    const s = toSnapshot({ ...rawBoard(), board: { labels: [{ id: 'l' }, { id: 'm', name: 'N', color: null }, { id: 'n', color: 5 }] } });
    expect(s.labels).toEqual([{ id: 'l', name: '', colour: null }, { id: 'm', name: 'N', colour: null }, { id: 'n', name: '', colour: null }]);
  });

  test('a position of exactly 0 is kept, and a card with no stored positions (one that carries only the old `prev` and `gen`) gets no placement', () => {
    const raw = { ...rawBoard(), cardData: { c1: { p: { f1: 0 } }, c2: { prev: 5, gen: 'g' } } };
    expect(toSnapshot(raw).placements).toEqual({ c1: { positions: { f1: 0 } } });
  });

  test('a stored parameter whose field is no longer a dropdown is dropped', () => {
    const raw = { ...rawBoard(), board: { ...(rawBoard().board as object), customFields: [{ id: 'f1', name: 'Value', type: 'text' }] } };
    expect(toSnapshot(raw).parameters).toEqual([]);
  });

  test('stored keys such as __proto__ and constructor cannot change behaviour', () => {
    const cardData = JSON.parse('{"c1":{"p":{"__proto__":0.5,"constructor":0.3,"f1":0.2}},"__proto__":{"p":{"f1":0.4}},"toString":{"p":{"f1":0.6}}}');
    const cards = JSON.parse('[{"id":"c1","idList":"l1","customFieldItems":[{"idCustomField":"__proto__","idValue":"polluted"},{"idCustomField":"constructor","idValue":"o1"},{"idCustomField":"f1","idValue":"o2"}]},{"id":"toString","idList":"l1"},{"id":"constructor","idList":"l1"}]');
    const s = toSnapshot({ ...rawBoard(), cards, cardData });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(s.placements)).toBe(Object.prototype);
    // Only cards' own entries count: a card named like an inherited key does not pick up Object.prototype's members.
    expect(Object.keys(s.placements)).toEqual(['c1', 'toString']);
    expect(s.placements.c1).toEqual({ positions: { constructor: 0.3, f1: 0.2 } });
    const positions = s.placements.c1!.positions;
    expect(Object.getPrototypeOf(positions)).toBe(Object.prototype);
    expect(Object.keys(positions)).toEqual(['constructor', 'f1']);
    expect(Object.hasOwn(positions, '__proto__')).toBe(false);
    const fo = s.cards[0]!.fieldOptions;
    expect(Object.getPrototypeOf(fo)).toBe(Object.prototype);
    expect(Object.keys(fo)).toEqual(['constructor', 'f1']);
    expect(Object.hasOwn(fo, '__proto__')).toBe(false);
    expect(s.cards.map(c => c.id)).toEqual(['c1', 'toString', 'constructor']);
    expect(s.placements.constructor).toBe(Object.prototype.constructor);   // not an own entry: no placement for the card named constructor
    expect(Object.hasOwn(s.placements, 'constructor')).toBe(false);
  });

  test('a card id of __proto__ gets no placement and no field options', () => {
    const cards = JSON.parse('[{"id":"__proto__","idList":"l1","customFieldItems":[{"idCustomField":"f1","idValue":"o1"}]}]');
    const cardData = JSON.parse('{"__proto__":{"p":{"f1":0.4}}}');
    const s = toSnapshot({ ...rawBoard(), cards, cardData });
    expect(Object.getPrototypeOf(s.placements)).toBe(Object.prototype);
    expect(Object.keys(s.placements)).toEqual([]);
  });

  test('toSnapshot does not change what it is given', () => {
    const raw = rawBoard();
    const before = JSON.stringify(raw);
    toSnapshot(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe('coverUrlOf', () => {
  test('picks the widest preview that fits, else the narrowest, else the attachment address', () => {
    const cover = { url: 'https://trello.com/1/cards/c/attachments/a/download/x.jpeg', previews: [{ url: 'https://trello.com/p/150', width: 150, height: 100 }, { url: 'https://trello.com/p/600', width: 600, height: 400 }, { url: 'https://trello.com/p/1200', width: 1200, height: 800 }] };
    expect(coverUrlOf(cover)).toBe('https://trello.com/p/600'); expect(coverUrlOf(cover, 300)).toBe('https://trello.com/p/150'); expect(coverUrlOf(cover, 100)).toBe('https://trello.com/p/150');
    expect(coverUrlOf({ url: cover.url, previews: [] })).toBe(cover.url);
    expect(coverUrlOf({ scaled: [{ url: 'https://trello.com/s/300', width: 300, height: 200 }] })).toBe('https://trello.com/s/300');
  });

  test('the order of the previews does not matter, and the narrowest is used when all are too wide', () => {
    const cover = { previews: [{ url: 'https://t/1200', width: 1200 }, { url: 'https://t/800', width: 800 }, { url: 'https://t/150', width: 150 }] };
    expect(coverUrlOf(cover, 1000)).toBe('https://t/800');
    expect(coverUrlOf(cover, 100)).toBe('https://t/150');
    expect(coverUrlOf({ previews: [{ url: 'https://t/1200', width: 1200 }, { url: 'https://t/800', width: 800 }] }, 100)).toBe('https://t/800');
  });

  test('previews that are not https or have no numeric width are not used', () => {
    const cover = { url: 'https://t/own.png', previews: [{ url: 'http://t/300', width: 300 }, { url: 'https://t/nowidth' }, { url: 'https://t/strwidth', width: '300' }, { url: 7, width: 300 }, null] };
    expect(coverUrlOf(cover)).toBe('https://t/own.png');
    expect(coverUrlOf({ previews: [{ url: 'http://t/300', width: 300 }, { url: 'https://t/ok', width: 400 }] })).toBe('https://t/ok');
  });

  test('never returns an address that is not https, and null for junk', () => {
    expect(coverUrlOf({ url: 'http://x/y.png' })).toBeNull(); expect(coverUrlOf({ url: 'javascript:alert(1)' })).toBeNull();
    expect(coverUrlOf({ previews: [{ url: 'data:image/png;base64,AAAA', width: 100 }] })).toBeNull();
    for (const junk of [null, undefined, 5, 'x', [], {}]) expect(coverUrlOf(junk)).toBeNull();
  });

  test('what is returned is the checked, canonical form of the address', () => {
    expect(coverUrlOf({ url: ' https://x/y.png' })).toBe('https://x/y.png');
    expect(coverUrlOf({ url: 'HTTPS://X/y.png' })).toBe('https://x/y.png');
    expect(coverUrlOf({ url: 'https:/x/y.png' })).toBe('https://x/y.png');
    expect(coverUrlOf({ url: 'https:x/y.png' })).toBe('https://x/y.png');
    expect(coverUrlOf({ url: 'ht\ntps://h/x' })).toBe('https://h/x');
    expect(coverUrlOf({ url: 'https://h/a b.png' })).toBe('https://h/a%20b.png');
    expect(coverUrlOf({ previews: [{ url: ' HTTPS://h/p.png', width: 100 }] })).toBe('https://h/p.png');
    expect(coverUrlOf({ scaled: [{ url: 'https:/h/s.png', width: 100 }] })).toBe('https://h/s.png');
  });

  test('an address with credentials, or without a host, is not accepted', () => {
    expect(coverUrlOf({ url: 'https://u:p@h/x.png' })).toBeNull();
    expect(coverUrlOf({ url: 'https://u@h/x.png' })).toBeNull();
    expect(coverUrlOf({ url: 'https://:p@h/x.png' })).toBeNull();
    expect(coverUrlOf({ previews: [{ url: 'https://u:p@h/p.png', width: 100 }], url: 'https://h/own.png' })).toBe('https://h/own.png');
    expect(coverUrlOf({ url: '//host/x' })).toBeNull();
    expect(coverUrlOf({ url: '/x/y.png' })).toBeNull();
    expect(coverUrlOf({ url: 'x/y.png' })).toBeNull();
  });

  test('a string that only looks like https is not accepted', () => {
    expect(coverUrlOf({ url: 'https:' })).toBeNull();
    expect(coverUrlOf({ url: 'not a url' })).toBeNull();
    expect(coverUrlOf({ url: ' javascript:alert(1)//https://x' })).toBeNull();
  });
});

describe('coverUrls', () => {
  test('lists only cards with a usable cover', () => {
    const urls = coverUrls([
      { id: 'a', cover: COVER },
      { id: 'b', cover: null },
      { id: 'c', cover: { url: 'https://t/c.png' } },
      { id: 'd', cover: { url: 'http://t/d.png' } },
      { cover: COVER },
      'junk',
    ]);
    expect(urls).toEqual({ a: 'https://trello.com/p/600', c: 'https://t/c.png' });
  });

  test('addresses are returned in canonical form, and ones with credentials are left out', () => {
    expect(coverUrls([
      { id: 'a', cover: { url: ' HTTPS://h/a.png' } },
      { id: 'b', cover: { url: 'https://u:p@h/b.png' } },
      { id: 'c', cover: { url: 'https:/h/c.png' } },
    ])).toEqual({ a: 'https://h/a.png', c: 'https://h/c.png' });
  });

  test('junk gives an empty object, and an id of __proto__ is not a key', () => {
    expect(coverUrls('x')).toEqual({});
    expect(coverUrls(null)).toEqual({});
    const urls = coverUrls(JSON.parse('[{"id":"__proto__","cover":{"url":"https://t/x.png"}}]'));
    expect(Object.getPrototypeOf(urls)).toBe(Object.prototype);
    expect(Object.keys(urls)).toEqual([]);
  });
});
