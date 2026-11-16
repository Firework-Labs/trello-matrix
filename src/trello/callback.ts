// The sign-in redirect page's logic. The page never reads, shows, logs or stores
// anything from its own address; Trello's library does all of that.

export const CALLBACK_WORKING = 'Finishing sign-in… you can close this window if it stays open.';
export const CALLBACK_FAILED = 'Sign-in could not be finished. Close this window and try again.';

export interface CallbackOptions { clientId: string; redirectUri: string }

export async function finishSignIn(
  powerUp: { iframe(options: CallbackOptions): TrelloIframe },
  options: CallbackOptions,
  setText: (text: string) => void,
): Promise<void> {
  setText(CALLBACK_WORKING);
  try {
    await powerUp.iframe(options).getOAuth2ApiClient().redirectUriCallback();
  } catch {
    setText(CALLBACK_FAILED);
  }
}

/** The real parts of the redirect page, as `src/oauth-callback.ts` passes them in (and a test replaces them). */
export interface CallbackEnv {
  window: { TrelloPowerUp?: { iframe(options: CallbackOptions): TrelloIframe } | null };
  document: { getElementById(id: string): { textContent: string | null } | null };
  options: CallbackOptions;
}

/** Runs the redirect page. When Trello's library did not load there is nothing to finish the sign-in with, and the page says so. */
export async function runCallbackPage(env: CallbackEnv): Promise<void> {
  const line = env.document.getElementById('status');
  const show = (text: string) => { if (line) line.textContent = text; };
  const powerUp = env.window.TrelloPowerUp;
  if (!powerUp || typeof powerUp.iframe !== 'function') { show(CALLBACK_FAILED); return; }
  await finishSignIn(powerUp, env.options, show);
}
