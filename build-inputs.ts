import { resolve } from 'node:path';

/**
 * The pages the build turns into the published site. The checks page (`proof.html`) writes to the board it is opened on
 * (it creates a field, moves a card, saves hidden data), so it is part of the site only when the build asks for it with
 * `VITE_PROOF=1`. The dev server serves it regardless; it is not in the published site otherwise.
 */
export function buildInputs(root: string, env: { VITE_PROOF?: string | undefined }): Record<string, string> {
  const inputs: Record<string, string> = {
    index: resolve(root, 'index.html'),
    matrix: resolve(root, 'matrix.html'),
    'oauth-callback': resolve(root, 'oauth-callback.html'),
    dev: resolve(root, 'dev.html'),
  };
  if (env.VITE_PROOF === '1') inputs.proof = resolve(root, 'proof.html');
  return inputs;
}
