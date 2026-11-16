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
- `src/connector.ts` the Power-Up entry (board button, card button).
- `src/trello/auth.ts` OAuth 2.0 sign-in (public client) and the Bearer header;
  `src/oauth-callback.ts` is the redirect page Trello sends the person back to.
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

