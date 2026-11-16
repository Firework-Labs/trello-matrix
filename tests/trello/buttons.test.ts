import { expect, test, vi } from 'vitest';
import { boardButtons, cardButtons } from '../../src/trello/buttons';

const iconUrl = 'https://example.test/icon.svg';
const open = vi.fn();
const texts = (b: TrelloButton[]) => b.map(x => x.text);
const board = (matrixReady: boolean, proof: boolean) => boardButtons({ matrixReady, proof, iconUrl, open });

test('board buttons: neither the matrix nor the checks gives an empty list', () => {
  expect(board(false, false)).toEqual([]);
});
test('board buttons: only the checks while the matrix is not ready', () => {
  expect(texts(board(false, true))).toEqual(['Matrix checks']);
});
test('board buttons: only Matrix when the matrix is ready and the checks are off', () => {
  expect(texts(board(true, false))).toEqual(['Matrix']);
});
test('board buttons: Matrix, then Matrix checks, when both apply', () => {
  expect(texts(board(true, true))).toEqual(['Matrix', 'Matrix checks']);
});

test('the board buttons carry the icon and open the right pages', () => {
  const t = {} as TrelloIframe;
  const [matrix, checks] = board(true, true);
  expect(matrix).toMatchObject({ icon: iconUrl, condition: 'always' });
  expect(checks).toMatchObject({ icon: iconUrl, condition: 'always' });
  open.mockClear();
  matrix!.callback(t);
  checks!.callback(t);
  expect(open.mock.calls).toEqual([[t, './matrix.html', 'Matrix'], [t, './proof.html', 'Matrix checks']]);
});

test('the card button exists only when the matrix is ready', () => {
  expect(cardButtons({ matrixReady: false, iconUrl, open })).toEqual([]);
  const [button, ...rest] = cardButtons({ matrixReady: true, iconUrl, open });
  expect(rest).toEqual([]);
  expect(button).toMatchObject({ text: 'Show on matrix', icon: iconUrl });
});
test('the card button opens the matrix focused on the card', () => {
  const t = { getContext: () => ({ board: 'b', member: 'm', card: 'card42' }) } as unknown as TrelloIframe;
  open.mockClear();
  cardButtons({ matrixReady: true, iconUrl, open })[0]!.callback(t);
  expect(open).toHaveBeenCalledWith(t, './matrix.html', 'Matrix', { focusCardId: 'card42' });
});
