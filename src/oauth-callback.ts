import { CLIENT_ID, REDIRECT_URI } from './config';
import { finishSignIn } from './trello/callback';

window.addEventListener('load', () => {
  const line = document.getElementById('status');
  void finishSignIn(TrelloPowerUp, { clientId: CLIENT_ID, redirectUri: REDIRECT_URI }, text => { if (line) line.textContent = text; });
});
