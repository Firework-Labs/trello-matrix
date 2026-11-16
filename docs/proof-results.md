# Live check results

Results Mike sent from the test board. Newest first. Sign-in is OAuth 2.0
(public client).

## 2026-11-16, Chrome 157 on macOS (complete except creating a field)

| Check | Result | What it showed |
|-------|--------|----------------|
| P1 hidden card data by card id | pass | Wrote and read back on two cards from the page opened by the board button. Approach A's hard requirement holds. |
| P3 sign in, REST hosts | pass | A token was received. Both `https://api.trello.com` and `https://trello.com` answered 200 with the Bearer header. Still signed in after a reload. |
| P2 another window's change arrives | pass | Seen without a reload; Trello's render callback fired. (An earlier "fail" was a run where nobody pressed Write ping.) |
| P4 opening a card | answer | The matrix page is closed when a card opens. The saved view and the "Show on matrix" card button are the way back, as designed. |
| P5 cover image | pass | A plain image tag loads the cover from every source tried: REST `cover.scaled`, the Power-Up's own attachment previews, REST attachment previews, and the attachment's download address. `fetch` fails for all of them (blocked cross-origin), with or without the token. In the Power-Up's own card data, `cover` is the cover attachment itself (keys `date, edgeColor, id, idMember, name, previews, url`). In REST, `cover` has `idAttachment` and `scaled` (14 of 158 cards). |
| P6 list positions and pace | pass | `top`, `bottom` and a number (65536.5) are all accepted. 30 moves took 3,360 ms with no rate-limit refusals. The rate-limit header is not readable from the browser. The card was put back. |
| P7 dropdown fields | partly | With the OAuth token: listing fields works; **setting and clearing a dropdown value on a card works** and reads back; the Power-Up's own data shows the new value about 256 ms later. **Renaming a field, renaming an option and deleting a field are refused: HTTP 403 `missing scopes`**, although Trello's reference lists only `read:board:trello` and `write:board:trello` for them. Creating a field is still unproven: the leftover `mxproof` field was reused both times (the first attempt got 409 duplicate). The leftover has to be deleted by hand. |
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
- Cover images: use a plain image tag with the preview address from the
  Power-Up's own card data (`cover.previews`, else `cover.url`). No token and
  no REST call needed. `COVER_MODE` is `img` (P5).
- Fields with OAuth 2.0: the matrix can set and clear levels on cards, which is
  what every drop needs. It cannot rename or delete fields or options, so
  parameter and level names are changed in Trello's own Custom Fields editor
  and the matrix shows the new names. Removing a parameter never deleted the
  field anyway. `RENAME_OPTIONS` is `false`, and the same now applies to
  parameter names (P7).
- After a REST write the Power-Up's own data lags by about a quarter of a
  second (P7), so the Trello store must lay its own recent writes over what it
  reads until the data catches up.
- Saving hidden data is fast (P8), so saving every card's previous position
  before a reorder is cheap.
