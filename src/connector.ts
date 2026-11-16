import { CLIENT_ID, MATRIX_READY, REDIRECT_URI } from './config';
import { boardButtons, cardButtons } from './trello/buttons';

const iconUrl = new URL(`${import.meta.env.BASE_URL}icon.svg`, location.origin).href;

function openModal(t: TrelloIframe, url: string, title: string, args?: Record<string, unknown>) {
  return t.modal({ url, fullscreen: true, title, ...(args ? { args } : {}) });
}

TrelloPowerUp.initialize(
  {
    'board-buttons': () => boardButtons({ matrixReady: MATRIX_READY, proof: import.meta.env.VITE_PROOF === '1', iconUrl, open: openModal }),
    'card-buttons': () => cardButtons({ matrixReady: MATRIX_READY, iconUrl, open: openModal }),
  },
  { clientId: CLIENT_ID, redirectUri: REDIRECT_URI },
);
