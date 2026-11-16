// The page Trello opens from the Matrix and Show on matrix buttons. All it does is hand the real parts to startMatrix
// (src/trello/start.ts), which is where the logic and its tests are.
import { startMatrix } from './trello/start';
import { mountMatrix } from './view/app';

const root = document.getElementById('app')!;
startMatrix({
  powerUp: TrelloPowerUp,
  root,
  fetch: fetch.bind(globalThis),
  mount: mountMatrix,
  now: () => performance.now(),
  sleep: ms => new Promise<void>(resolve => { setTimeout(resolve, ms); }),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
  newId: () => crypto.randomUUID(),
}).catch(() => { root.textContent = 'The matrix could not start. Close this window and open it again.'; });
