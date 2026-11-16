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
| P5 cover image | not answered | The check found no cover image although the board has cards with images. The check looked only at `cover.scaled` in the REST card list. The check is being rewritten to report what Trello returns. |
| P6 list positions and pace | not run yet | |
| P7 create and rename a dropdown field | not run yet | |
| P8 hidden data through REST, burst of saves | not run yet | |

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
