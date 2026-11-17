import { resolve } from 'node:path';

/**
 * The pages the build turns into the published site. The checks page (`proof.html`) writes to the board it is opened on
 * (it creates a field, moves a card, saves hidden data), so it is part of the site only when the build asks for it with
 * `VITE_PROOF=1`. The sample-data page (`dev.html`) is never published. The dev server serves both regardless.
 */
export function buildInputs(root: string, env: { VITE_PROOF?: string | undefined }): Record<string, string> {
  const inputs: Record<string, string> = {
    index: resolve(root, 'index.html'),
    matrix: resolve(root, 'matrix.html'),
    'oauth-callback': resolve(root, 'oauth-callback.html'),
  };
  if (env.VITE_PROOF === '1') inputs.proof = resolve(root, 'proof.html');
  return inputs;
}
