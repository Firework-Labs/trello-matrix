# Live check results

Results Mike sent from the test board. Newest first. Sign-in is OAuth 2.0
(public client).

## 2026-11-16, Chrome 157 on macOS (round in progress)

| Check | Result | What it showed |
|-------|--------|----------------|
| P1 hidden card data by card id | pass | Wrote and read back on two cards from the page opened by the board button. Approach A's hard requirement holds. |
| P3 sign in, REST hosts | pass | A token was received. Both `https://api.trello.com` and `https://trello.com` answered 200 with the Bearer header. Still signed in after a reload. |
| P2 another window's change arrives | pass | Seen without a reload; Trello's render callback fired. (An earlier "fail" was a run where nobody pressed Write ping.) |
| P4 opening a card | answer | The matrix page is closed when a card opens. The saved view and the "Show on matrix" card button are the way back, as designed. |
| P5 cover image | not answered | The check found no cover image although the board has cards with images. It looked only at `cover.scaled` in the REST card list. Rewritten to look in every place and report what Trello returns; to be run again. |
| P6 list positions and pace | pass | `top`, `bottom` and a number (65536.5) are all accepted. 30 moves took 3,360 ms with no rate-limit refusals. The rate-limit header is not readable from the browser. The card was put back. |
| P7 create and rename a dropdown field | not answered | Trello refused the create with 409 `CUSTOM_FIELD_DUPLICATE_FIELD`: a field named `mxproof` was already on the board (a leftover). So the endpoint accepts the OAuth token, but create, rename, set and delete are unproven. Rewritten to reuse a leftover and report each step; to be run again. |
| P8 hidden data through REST, burst of saves | answer | The Power-Up's id is in the context. This Power-Up's card data was **not** found in `GET /1/boards/{id}?card_pluginData=true` with the OAuth token. 30 hidden saves on one card took 298 ms with no failures. |

Other things Mike saw:

- The Power-Up's buttons do not always show in the board's top bar; they are in
  the "…" menu. There were two "Matrix" entries and only the second worked: the
  first is the real matrix button, which opens an empty page until the Trello
  tasks are built; the second is "Matrix checks".
- He switched on the `attachment-thumbnail` capability in the Power-Up admin
  while looking into P5. The Power-Up does not provide it; it should be off.

## What the results decide so far

- `SYNC_MODE`: `render` works (P2). Polling stays as the fallback.
- REST base URL: either host works; use `https://api.trello.com`.
- Return path after opening a card: the matrix is closed by Trello (P4).
- Reordering: numeric list positions work; about 9 moves a second without
  refusals, so 90 cards take about 10 seconds (P6).
- Hidden card data cannot be read through REST with the OAuth token (P8), so
  the planned polling fallback built on REST cannot work. It is not needed:
  live updates work (P2) and hidden data is read through the Power-Up's own
  storage calls (P1). Task 14 builds render mode only.
- Saving hidden data is fast (P8), so saving every card's previous position
  before a reorder is cheap.
