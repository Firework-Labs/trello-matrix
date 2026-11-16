import { describe, expect, test } from 'vitest';
import { authHeaders, createAuth } from '../../src/trello/auth';

const TOKEN = 'secret-token-123';

interface Opts { token?: string | null; libraryRejects?: string; tokenRejects?: string }

/** A fake `t` whose every OAuth call records itself, so the tests can check the order. */
function fakeT(o: Opts = {}) {
  const log: string[] = [];
  const authorizeArgs: unknown[] = [];
  let signedIn = false;
  const client = {
    authorize: async (args: unknown) => {
      log.push('authorize');
      authorizeArgs.push(args);
      if (o.libraryRejects) throw new Error(o.libraryRejects);
      signedIn = true;
    },
    getAccessToken: async () => {
      log.push('getAccessToken');
      if (o.tokenRejects) throw new Error(o.tokenRejects);
      if (o.token !== undefined) return o.token;
      return signedIn ? TOKEN : null;
    },
    redirectUriCallback: async () => { log.push('redirectUriCallback'); },
  };
  const t = { getOAuth2ApiClient: () => { log.push('getOAuth2ApiClient'); return client; } } as unknown as TrelloIframe;
  return { t, log, authorizeArgs };
}

describe('authorize', () => {
  test('calls the library with both scopes before anything is awaited', async () => {
    const { t, log, authorizeArgs } = fakeT();
    const pending = createAuth(t).authorize();
    // Nothing has been awaited by this test yet, so this is what ran synchronously.
    expect(log).toEqual(['getOAuth2ApiClient', 'authorize']);
    expect(authorizeArgs).toEqual([{ scopes: ['read:board:trello', 'write:board:trello'] }]);
    await pending;
    expect(log).toEqual(['getOAuth2ApiClient', 'authorize', 'getOAuth2ApiClient', 'getAccessToken']);
  });
  test('uses the scopes it is given', async () => {
    const { t, authorizeArgs } = fakeT();
    await createAuth(t, ['read:board:trello']).authorize();
    expect(authorizeArgs).toEqual([{ scopes: ['read:board:trello'] }]);
  });
  test('resolves when getAccessToken then gives a token', async () => {
    await expect(createAuth(fakeT().t).authorize()).resolves.toBeUndefined();
  });
  test.each([null, ''])('rejects when getAccessToken gives %j, without the token in the message', async token => {
    const err = await createAuth(fakeT({ token }).t).authorize().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(TOKEN);
    expect((err as Error).message).toMatch(/no access token|declined|did not finish/i);
  });
  test('rejects with an Error when the library authorize rejects, and does not ask for a token', async () => {
    const { t, log } = fakeT({ libraryRejects: 'popup closed' });
    const err = await createAuth(t).authorize().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('popup closed');
    expect((err as Error).message).not.toContain(TOKEN);
    expect(log).not.toContain('getAccessToken');
  });
  test('cuts a very long library message to 200 characters', async () => {
    const long = 'x'.repeat(1000);
    const err = await createAuth(fakeT({ libraryRejects: long }).t).authorize().catch((e: unknown) => e);
    const message = (err as Error).message;
    expect(message).toContain('x'.repeat(200));
    expect(message).not.toContain('x'.repeat(201));
    expect(message.length).toBeLessThan(300);
  });
  test('rejects with an Error when getAccessToken throws', async () => {
    const err = await createAuth(fakeT({ tokenRejects: 'storage blocked' }).t).authorize().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('storage blocked');
  });
  test('rejects (not throws) when the Trello client is missing', async () => {
    const t = { getOAuth2ApiClient: () => { throw new Error('no client'); } } as unknown as TrelloIframe;
    await expect(createAuth(t).authorize()).rejects.toThrow('no client');
  });
});

describe('accessToken and isAuthorized', () => {
  test('give the token, and true, for a non-empty token', async () => {
    const auth = createAuth(fakeT({ token: TOKEN }).t);
    expect(await auth.accessToken()).toBe(TOKEN);
    expect(await auth.isAuthorized()).toBe(true);
  });
  test.each([null, '', undefined])('give null, and false, for %j', async token => {
    const { t } = fakeT({ token: token as string | null });
    const auth = createAuth(t);
    expect(await auth.accessToken()).toBeNull();
    expect(await auth.isAuthorized()).toBe(false);
  });
});

describe('authHeaders', () => {
  test.each(['https://api.trello.com/1/x', 'https://trello.com/1/x', 'https://trello-attachments.trello.com/x.png'])(
    'sends the Bearer header to %s', url => { expect(authHeaders(url, 'T')).toEqual({ Authorization: 'Bearer T' }); });
  test.each(['https://trello.com.evil.example/x', 'http://trello.com/x', 'https://images.unsplash.com/x', 'https://eviltrello.com/x', 'not a url'])(
    'sends nothing to %s', url => { expect(authHeaders(url, 'T')).toEqual({}); });
});
