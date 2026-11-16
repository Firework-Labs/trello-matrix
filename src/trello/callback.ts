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
