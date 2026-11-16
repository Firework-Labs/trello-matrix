import { expect, test, vi } from 'vitest';
import { CALLBACK_FAILED, CALLBACK_WORKING, finishSignIn } from '../../src/trello/callback';

const OPTIONS = { clientId: 'client1', redirectUri: 'https://example.test/base/oauth-callback.html' };

function fakePowerUp(redirectUriCallback: () => unknown, iframeThrows = false) {
  const iframe = vi.fn((_o: unknown) => {
    if (iframeThrows) throw new Error('no iframe');
    return { getOAuth2ApiClient: () => ({ redirectUriCallback }) } as unknown as TrelloIframe;
  });
  return { powerUp: { iframe }, iframe };
}

test('creates the iframe with the two options and calls redirectUriCallback, showing the working text', async () => {
  const callback = vi.fn(async () => undefined);
  const { powerUp, iframe } = fakePowerUp(callback);
  const texts: string[] = [];
  await finishSignIn(powerUp, OPTIONS, s => texts.push(s));
  expect(iframe).toHaveBeenCalledWith(OPTIONS);
  expect(callback).toHaveBeenCalledTimes(1);
  expect(texts.at(-1)).toBe('Finishing sign-in… you can close this window if it stays open.');
  expect(texts.at(-1)).toBe(CALLBACK_WORKING);
});
test('shows the failure text when redirectUriCallback throws', async () => {
  const { powerUp } = fakePowerUp(() => { throw new Error('bad state abc123'); });
  const texts: string[] = [];
  await finishSignIn(powerUp, OPTIONS, s => texts.push(s));
  expect(texts.at(-1)).toBe('Sign-in could not be finished. Close this window and try again.');
  expect(texts.at(-1)).toBe(CALLBACK_FAILED);
  expect(texts.join(' ')).not.toContain('abc123');
});
test('shows the failure text when redirectUriCallback rejects, or the iframe cannot be made', async () => {
  for (const p of [fakePowerUp(async () => { throw new Error('x'); }), fakePowerUp(() => undefined, true)]) {
    const texts: string[] = [];
    await finishSignIn(p.powerUp, OPTIONS, s => texts.push(s));
    expect(texts.at(-1)).toBe(CALLBACK_FAILED);
  }
});
test('never logs anything', async () => {
  const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => undefined));
  await finishSignIn(fakePowerUp(() => { throw new Error('secret'); }).powerUp, OPTIONS, () => undefined);
  for (const s of spies) expect(s).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
