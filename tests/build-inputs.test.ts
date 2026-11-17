import { describe, expect, test } from 'vitest';
import { buildInputs } from '../build-inputs';

describe('buildInputs', () => {
  const pages = (env: { VITE_PROOF?: string }) => Object.keys(buildInputs('/site', env)).sort();

  test('the checks page is a build input only when VITE_PROOF is exactly 1', () => {
    expect(pages({ VITE_PROOF: '1' })).toEqual(['index', 'matrix', 'oauth-callback', 'proof']);
  });

  test.each([[{}], [{ VITE_PROOF: '0' }], [{ VITE_PROOF: '' }], [{ VITE_PROOF: 'true' }], [{ VITE_PROOF: ' 1' }], [{ VITE_PROOF: '11' }]])(
    'without it (%j) the checks page is left out and the others stay', env => {
      expect(pages(env)).toEqual(['index', 'matrix', 'oauth-callback']);
      expect(Object.values(buildInputs('/site', env)).some(path => path.includes('proof'))).toBe(false);
    });

  test('the sample-data dev page is never published; the dev server still serves it', () => {
    expect(Object.values(buildInputs('/site', { VITE_PROOF: '1' })).some(path => path.includes('dev'))).toBe(false);
  });

  test('every input is the page file under the given root', () => {
    expect(buildInputs('/site', { VITE_PROOF: '1' })).toEqual({
      index: '/site/index.html', matrix: '/site/matrix.html', 'oauth-callback': '/site/oauth-callback.html',
      proof: '/site/proof.html',
    });
  });
});
