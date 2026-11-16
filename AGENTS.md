# trello-matrix

A private Trello Power-Up: a zoomable 2D matrix of a board's cards for
prioritising a backlog. Static site, no server, all data in Trello.

## Read first

- Design (approved): `docs/superpowers/specs/2026-11-13-trello-matrix-design.md`
- Plan: `docs/superpowers/plans/2026-11-14-trello-matrix.md`
- Latest handoff: newest file in `handoff/`

## Rules for this project

- Automated tests never touch Trello. Everything is built and tested against
  the in-memory fake board store.
- The agent writes to a Trello board only if `.claude/handoff.json` names it.
  Never enable the Power-Up on the real `67-Pass-Play-Teamwork` board; Mike
  does that.
- The OAuth 2.0 client ID is public by design. Access tokens, refresh tokens
  and any client secret are never committed, logged or written to a file.
- Never delete a Custom Field or a field value except through an explicit
  drop on a strip or the tray, as the design describes.
- Escape closes Trello's modal. Do not bind it.
- The mockup in `docs/superpowers/specs/assets/` is throwaway. Copy its look
  and feel, not its code.

## Conventions

- Positions run from 0 (worst end) to 1 (best end). Parameter levels are
  always stored worst to best. On screen the best end is up or right.
- All board reads and writes go through the `BoardStore` interface, so a
  server-backed store can replace the Trello one later.

## Where things are

- `src/model/` pure rules (placement, drop, resequence, pacer, colour).
- `src/store/board-store.ts` the seam and its contract; `fake-store.ts` and
  `sample-data.ts` back the dev page and every test.
- `src/view/` the matrix (`app.ts` mounts it on any `BoardStore`).
- `src/proof/` the live-check page Mike runs against a test board (P1 to P8).
- `src/trello/trello-store.ts` the real `BoardStore` on Trello (reads through the Power-Up library, writes through REST).
- `src/trello/start.ts` builds auth, pacer, REST client and store and mounts the matrix; `matrix.html` (with
  `src/matrix-main.ts`, which only supplies the real parts) is the page Trello opens.
- `src/connector.ts` the Power-Up entry (board button, card button).
- `src/trello/auth.ts` OAuth 2.0 sign-in (public client) and the Bearer header;
  `src/oauth-callback.ts` is the redirect page Trello sends the person back to.
- `docs/proof-results.md` what the live checks showed; `docs/acceptance.md` the checklist Mike and a collaborator run on the
  test board.
- `dev.html` runs the matrix on sample data: `npm run dev`, then open
  `http://localhost:5173/trello-matrix/dev.html`.

## Running and testing

- `npm test` (Vitest), `npx tsc --noEmit`, `npm run build`.
- `npx playwright test` runs the browser tests in Chromium and WebKit. A fresh
  machine needs `npx playwright install chromium webkit` first.
- Two WebKit drag tests compare positions within 0.5 px and rely on the
  toolbar being 45 px high and the legend 30 px high.

## Gotchas

- The fake store notifies subscribers only through `remote()`. The real store
  will also echo the person's own writes; the view is written for that.
- The real store must meet the contract in `board-store.ts`: reads include its
  own completed writes, and no snapshot older than its latest write is
  delivered.
- Dialogs and the drawer make the rest of the page `inert` through
  `src/view/modal.ts`. Use it for any new modal.

- Trello refuses to rename or delete custom fields and their options for
  OAuth 2.0 tokens (HTTP 403 "missing scopes"), and does not return the
  Power-Up's hidden card data through REST. `docs/proof-results.md` records
  what a real board answered; trust it over Trello's reference.
- The Power-Up's own data lags a REST write by about a quarter of a second.
  `src/trello/overlay.ts` covers that; any new REST write must note itself
  there with the value from before the write.
- Every read and storage call in the Trello store has a 20-second limit, and a
  read is delivered only if no own write finished since it began and none is
  under way. Keep both when changing `src/trello/trello-store.ts`.
- A sign-in that lapses shows the reconnect bar (`src/view/reconnect-bar.ts`);
  `app.ts` wraps every store call to catch `auth` errors in one place.
- The checks page (`proof.html`) is built only when `VITE_PROOF=1`, and writes
  to whichever board it is opened on. It must be off before the real board.

## Publishing

- GitHub Pages builds from `main` on every push. To publish: fast-forward
  `main` to the working branch and push both. Repository variables:
  `TRELLO_CLIENT_ID` (the OAuth 2.0 client ID) and `PROOF` (`1` or `0`).
- Do not publish while Mike is in the middle of a check or acceptance run
  unless he is blocked on the fix.
