import { CLIENT_ID, REDIRECT_URI } from './config';
import { runCallbackPage, type CallbackEnv } from './trello/callback';

window.addEventListener('load', () => {
  void runCallbackPage({ window: window as unknown as CallbackEnv['window'], document, options: { clientId: CLIENT_ID, redirectUri: REDIRECT_URI } });
});
