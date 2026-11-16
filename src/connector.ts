import { CLIENT_ID, REDIRECT_URI } from './config';

const iconUrl = new URL(`${import.meta.env.BASE_URL}icon.svg`, location.origin).href;

function openModal(t: TrelloIframe, url: string, title: string, args?: Record<string, unknown>) {
  return t.modal({ url, fullscreen: true, title, ...(args ? { args } : {}) });
}

TrelloPowerUp.initialize(
  {
    'board-buttons': () => {
      const buttons: TrelloButton[] = [
        { icon: iconUrl, text: 'Matrix', condition: 'always', callback: t => openModal(t, './matrix.html', 'Matrix') },
      ];
      if (import.meta.env.VITE_PROOF === '1') {
        buttons.push({ icon: iconUrl, text: 'Matrix checks', condition: 'always', callback: t => openModal(t, './proof.html', 'Matrix checks') });
      }
      return buttons;
    },
    'card-buttons': () => [
      {
        icon: iconUrl,
        text: 'Show on matrix',
        callback: t => openModal(t, './matrix.html', 'Matrix', { focusCardId: t.getContext().card }),
      },
    ],
  },
  { clientId: CLIENT_ID, redirectUri: REDIRECT_URI },
);
