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
- The Power-Up API key is public by design. Tokens and secrets are never
  committed, logged or written to a file.
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
