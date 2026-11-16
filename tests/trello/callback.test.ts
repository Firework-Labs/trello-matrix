import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { CALLBACK_FAILED, CALLBACK_WORKING, finishSignIn, runCallbackPage } from '../../src/trello/callback';

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
function page(powerUp: unknown) {
  const line = { textContent: CALLBACK_WORKING as string | null };
  const asked: string[] = [];
  const env = {
    window: { TrelloPowerUp: powerUp } as never,
    document: { getElementById: (id: string) => { asked.push(id); return id === 'status' ? line : null; } },
    options: OPTIONS,
  };
  return { env, line, asked };
}

test('the page: with the library missing the status line shows the failure text instead of staying on "Finishing sign-in…"', async () => {
  for (const missing of [undefined, null]) {
    const p = page(missing);
    await runCallbackPage(p.env);
    expect(p.line.textContent).toBe(CALLBACK_FAILED);
  }
});
test('the page: with the library present the status line follows the sign-in, and a missing status line is no problem', async () => {
  const callback = vi.fn(async () => undefined);
  const ok = page(fakePowerUp(callback).powerUp);
  await runCallbackPage(ok.env);
  expect(ok.asked).toEqual(['status']);
  expect(callback).toHaveBeenCalledTimes(1);
  expect(ok.line.textContent).toBe(CALLBACK_WORKING);
  const failing = page(fakePowerUp(() => { throw new Error('x'); }).powerUp);
  await runCallbackPage(failing.env);
  expect(failing.line.textContent).toBe(CALLBACK_FAILED);
  const noLine = page(fakePowerUp(callback).powerUp);
  noLine.env.document.getElementById = () => null;
  await expect(runCallbackPage(noLine.env)).resolves.toBeUndefined();
});
test('never logs anything', async () => {
  const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => undefined));
  await finishSignIn(fakePowerUp(() => { throw new Error('secret'); }).powerUp, OPTIONS, () => undefined);
  for (const s of spies) expect(s).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

test('the redirect page tells the browser not to send the address it was opened with on to anyone', () => {
  const html = readFileSync(new URL('../../oauth-callback.html', import.meta.url), 'utf8');
  expect(html).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/);
});
