// The buttons the Power-Up adds to a board and to a card. Pure (no Trello library, no page), so the
// four combinations of "matrix ready" and "checks on" are unit tested; src/connector.ts supplies the real parts.

type OpenModal = (t: TrelloIframe, url: string, title: string, args?: Record<string, unknown>) => unknown;

/** "Matrix" only once matrix.html works; "Matrix checks" only in a build made for the live checks. */
export function boardButtons(o: { matrixReady: boolean; proof: boolean; iconUrl: string; open: OpenModal }): TrelloButton[] {
  const buttons: TrelloButton[] = [];
  if (o.matrixReady) {
    buttons.push({ icon: o.iconUrl, text: 'Matrix', condition: 'always', callback: t => o.open(t, './matrix.html', 'Matrix') });
  }
  if (o.proof) {
    buttons.push({ icon: o.iconUrl, text: 'Matrix checks', condition: 'always', callback: t => o.open(t, './proof.html', 'Matrix checks') });
  }
  return buttons;
}

/** "Show on matrix" only once matrix.html works. */
export function cardButtons(o: { matrixReady: boolean; iconUrl: string; open: OpenModal }): TrelloButton[] {
  if (!o.matrixReady) return [];
  return [{
    icon: o.iconUrl,
    text: 'Show on matrix',
    callback: t => o.open(t, './matrix.html', 'Matrix', { focusCardId: t.getContext().card }),
  }];
}
