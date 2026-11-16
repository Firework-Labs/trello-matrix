import { expect, test } from 'vitest';
import { OAUTH_SCOPES, redirectUriFor } from '../src/config';

test('the redirect address on the published site is exact', () => {
  expect(redirectUriFor('https://firework-labs.github.io', '/trello-matrix/')).toBe('https://firework-labs.github.io/trello-matrix/oauth-callback.html');
});
test('the redirect address follows the origin and base path', () => {
  expect(redirectUriFor('http://localhost:5173', '/')).toBe('http://localhost:5173/oauth-callback.html');
  expect(redirectUriFor('http://localhost:5173', '/sub/dir/')).toBe('http://localhost:5173/sub/dir/oauth-callback.html');
});
test('the scopes are board read and write', () => {
  expect([...OAUTH_SCOPES]).toEqual(['read:board:trello', 'write:board:trello']);
});
