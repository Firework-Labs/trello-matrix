# Trello Matrix Power-Up: design

Date: 2026-11-13
Status: reviewed, awaiting Mike's approval
Reference mockup (throwaway, invented cards): [matrix-mockup.html](assets/matrix-mockup.html)

## Amendment, 2026-11-16: sign-in uses Trello OAuth 2.0

Decision (Mike, 2026-11-16): the Power-Up authorises with Trello's OAuth 2.0
as a **public client**, not with the legacy API key. Where this document says
"API key", "allowed origins" or "read and write, without expiry", read it as
follows:

- The Power-Up has an OAuth 2.0 **client ID**, which is public. There is no
  client secret, because the site has no server to keep one.
- The site hosts one extra page, `oauth-callback.html`, that Trello's sign-in
  window returns to. Its address is registered as the client's callback URL.
- Each person signs in once through Trello's consent window. Access lasts one
  hour and renews itself; after 90 days without use Trello asks again. The
  person needs a Trello account linked to an Atlassian account.
- Scopes: `read:board:trello` and `write:board:trello`.
- The approach is still A: a static page, no server, all data in Trello.
- Trello's documentation does not say whether OAuth 2.0 tokens can use the
  custom-field endpoints, download cover images, or read hidden card data
  through REST, nor what the rate limits are. The live checks in section 10
  (now P1 to P8) are what settles each of these. The legacy key is still
  supported by Trello with no end date, and is the fallback if a check fails.

## 1. Intent

Mike has 80–90 items in the backlog of the `67-Pass-Play-Teamwork` Trello board
(Firework Labs workspace) and needs to decide what the team works on next.
Reading a long list does not show how items compare. He wants to lay the cards
out on two axes (for example Value against Cost), do this together with one
collaborator, and have the result land back on the real cards so it drives the
order of work for the team.

The Power-Up is a full-screen matrix view of a board's cards. Dragging a card
sets its level on two parameters, the levels are written to the card as fields,
and one button reorders the lists so the best cards come first.

## 2. Goals

1. Plot the cards of chosen lists on a 2D matrix. Each axis is a parameter with
   2 or 3 named levels.
2. Drag cards anywhere. Crossing into another section updates that parameter's
   level on the real card, as its own field.
3. Remember the exact spot of a card inside a section, but expose only the
   level on the card.
4. Swap either axis to any other parameter (cost, ease, value, convenience and
   so on). Parameters are defined by the user.
5. Zoom continuously between the whole matrix, one section and single cards,
   with cards gaining detail as they grow.
6. Colour cards by label, by a dropdown custom field, by list or by member.
7. Open the real Trello card from the matrix to see its full context.
8. Show a card's image when zoomed in, with an option to turn images off.
9. Reorder the cards in their lists by closeness to the top-right corner, to
   sequence the team's work.
10. Two people work on one shared matrix. A move by one shows up for the other
    within a few seconds without reloading.

## 3. Non-goals for this version

- Live cursors or seeing the other person's drag while it is in progress.
- Separate layouts per person, or comparing two people's placements.
- More than two parameters on screen at once, or more than 3 levels.
- Weighting one axis above the other when reordering.
- Using the board's existing `Priority` field (six levels) as an axis.
- Auto-arranging cards or preventing overlap.
- Changing a parameter's number of levels after it is created.
- History of placements.
- The Trello mobile apps. The target is Trello in a desktop browser.
- Listing the Power-Up publicly. It is a private Power-Up for the Firework Labs
  workspace.

## 4. Anti-goals

These would make it a failure even if it works:

- **Surprising writes to the real board.** No reorder without a preview and a
  confirm. No field or field value is ever deleted automatically. Cards in
  lists the user did not choose are never touched.
- **Losing exact positions**, for example on an axis swap, a reload or a
  failed write.
- **Sluggish zoom or drag.** It must stay smooth with 150 cards on screen and
  usable with 300.
- **Field clutter.** One field per parameter, nothing else visible on cards.
- **The matrix and the cards disagreeing** about a card's level.

## 5. Constraints

- **Platform.** A Trello Power-Up cannot add a tab to Trello's view switcher.
  The matrix opens from a board button as a full-screen modal
  (`t.modal` with `fullscreen: true`).
- **Escape belongs to Trello.** Escape closes the modal, so the matrix must not
  use it for "back to whole matrix".
- **Custom Fields** are the visible fields. The board already has them enabled
  (four dropdown fields exist). A board allows up to 50 custom fields. The
  Custom Fields feature must be enabled on any board the Power-Up is used on.
- **Hidden storage.** Power-Up plugin data is limited to 4096 characters per
  scope and visibility pair (for example per card, shared). Shared writes are
  not atomic, so the last write wins.
- **Writing fields and reordering need the REST API**, which needs each person
  to authorise the Power-Up once with their Trello account (read and write).
- **Rate limits.** 100 requests per 10 seconds per token, 300 per 10 seconds
  per API key. Exceeding them returns HTTP 429.
- **Hosting.** The Power-Up is a web page served over HTTPS. Mike must create
  the GitHub repository; the agent machine cannot create repositories.
- **External writes by the agent.** The agent may write to Trello only on
  boards named in the project's `.claude/handoff.json`. Mike names a test
  board there before any live testing.

## 6. Approaches considered

**A. Everything in Trello (chosen).** A static web page with no server. Exact
positions go in the Power-Up's per-card storage, levels in Custom Fields,
reordering through the REST API under each person's own authorisation.
Free to run, no card data leaves Trello, nothing to operate. The other
person's moves arrive through Trello's own board updates, expected within a
second or two, without live cursors. Bound by Trello's rate limits and by what
the Power-Up frame allows.

**B. Power-Up plus our own small server.** Positions in our own database, a
server relaying moves instantly and writing to Trello. Buys true real-time
dragging with cursors and room for per-person layouts or history. Costs a
server to host, secure and maintain, card data stored outside Trello, and
roughly double the build.

**C. A separate web app outside Trello (dropped).** Escapes the frame limits,
but cannot write the hidden per-card storage, so exact positions would need
visible fields or a server. It is also not a Power-Up, which is what was asked
for.

**Decision (Mike, 2026-11-13):** start with A, and keep in mind that we might
have to reconsider. Two people prioritising 90 cards do not need live cursors.
To keep B open, all reading and writing of board data goes through one
interface (section 9), so a server-backed implementation can replace the
Trello one without changing the matrix.

## 7. Behaviour

Decisions marked **(Mike)** were made by Mike in conversation. Everything
marked **(call)** is the designer's proposal, which Mike can overrule when he
reads this.

### 7.1 Opening the matrix

- A board button "Matrix" opens the full-screen matrix. **(call)**
- A card button "Show on matrix" on every card opens the matrix zoomed to that
  card. This is also the way back after opening a card from the matrix.
  **(call)**
- On first use each person sees a single "Connect to Trello" step that
  authorises read and write access without expiry. The matrix is not usable
  before that, because field writes need it. **(call)**
- People who cannot edit the board see the matrix read-only. **(call)**

### 7.2 Parameters

- A parameter has a name, 2 or 3 named levels, and a better end.
  The user creates parameters in a setup dialog inside the matrix. **(Mike:
  2 or 3 levels, user-defined parameters; call: the dialog)**
- Creating a parameter creates one dropdown Custom Field on the board with the
  same name and one option per level, shown on the front of cards. **(call)**
- If a dropdown field with that name already exists, the dialog asks whether
  to link to it (only if it has 2 or 3 options) instead of creating a
  duplicate. **(call)**
- Renaming a parameter or a level renames the field or option. **(call)**
- Removing a parameter removes it from the matrix only. The Custom Field and
  its values stay on the cards. **(call)**
- The number of levels is fixed once created. **(call)**
- The matrix needs at least two parameters. With fewer, it shows the setup
  dialog. **(call)**

### 7.3 Axes

- Two pickers, "Across" and "Up", choose the parameter on each axis. A "Swap
  axes" button exchanges them. The same parameter cannot be on both. **(Mike:
  swap axes; call: controls)**
- The better end of every axis points up or right, so the top-right corner
  always means "do first". Cost therefore reads High to Low from left to
  right. The corner is marked with a "Do first" badge and light shading.
  **(Mike)**
- Sections are equal divisions of each axis: halves for 2 levels, thirds for
  3. A 2-level parameter against a 3-level one gives a 2 by 3 grid. **(call)**
- Changing an axis animates the cards to their places and resets the zoom to
  the whole matrix. **(call)**

### 7.4 Which cards appear

- A list picker selects one or more of the board's open lists. All open cards
  in those lists are in scope. Archived cards are not shown. **(call)**
- Where a card sits depends on which of the two visible parameters it has a
  level for. **(Mike chose edge strips; call: the details)**

  | Has a level on | Where the card is |
  |----------------|-------------------|
  | Both | On the matrix |
  | "Up" only | In a strip along the left edge of the matrix, at its known height |
  | "Across" only | In a strip along the bottom edge, at its known position across |
  | Neither | In the "Not placed yet" tray at the left, showing its title |

- This matters most on an axis swap. After placing every card on Value against
  Cost and switching to Value against Ease, the cards line up in the left strip
  at their Value heights, and none of their Value positions is lost.
- Dragging a card from a strip or the tray onto the matrix places it. The drag
  is free, like any other. A strip card starts from its known coordinate, so
  dragging it straight in keeps that coordinate.
- Where a card is dropped decides what is set. Dropping on the matrix sets
  both parameters. Dropping on the left strip clears the "Across" parameter
  only. Dropping on the bottom strip clears the "Up" parameter only. Dropping
  on the tray clears both. Clearing removes the field value from the card and
  forgets the exact position for that parameter. **(call)**
- Strip cards follow the zoom and pan of the axis they sit on, and use the
  same dot, chip and full-card forms as the matrix. **(call)**
- For resequencing, only cards on the matrix count as placed. Strip and tray
  cards count as not placed. **(call)**

### 7.5 Exact position and level

- For each card and each parameter the Power-Up stores one number from 0 to 1,
  where 0 is the worst end and 1 the best. The level is the equal division the
  number falls in. **(call)**
- The position belongs to the parameter, not to the pair of axes. A card's
  place on Value is the same whichever parameter is beside it. **(call, shown
  in the mockup)**
- **The field on the card is the truth for the level. The stored number is the
  truth for the spot inside the level.** Someone may change the field directly
  on the card. When the stored number falls in a different level from the
  field, the card is drawn in the field's section, keeping the same relative
  offset inside the section, and the stored number is corrected the next time
  that person's matrix writes the card. **(call)**
- A card that has a level but no stored number (the field was set by hand) is
  drawn near the middle of its section, with a small offset derived from the
  card id so that several such cards do not stack exactly. **(call)**

### 7.6 Moving cards

- Drag freely. No snapping. Cards may overlap. The card under the pointer
  comes to the front. **(Mike: arbitrary movement; call: the rest)**
- While dragging, the section under the card is highlighted.
- On drop the exact position is always saved. A field is written only when the
  level changed. A short message names the change, for example "Cost: High →
  Medium". **(Mike: fields update automatically; call: message)**
- The card moves immediately. If a write fails, the card returns to where it
  was and an error is shown. **(call)**

### 7.7 Zoom

- Continuous zoom centred on the pointer, by scroll or pinch. Drag the
  background to pan. **(Mike confirmed continuous zoom in the mockup)**
- Double-click a section to fit it to the screen. A "Whole matrix" button
  returns to the full view. No Escape shortcut (section 5).
- Cards change with zoom, as in the mockup: **(Mike confirmed)**
  - whole matrix: coloured dots, title on hover
  - closer: a chip with the title
  - close up: a full card with cover image if any, title, labels, members,
    list name, and the level of every parameter
- Axis labels stay visible and readable at every zoom, so the user always
  knows which section they are looking at. **(call)**
- Each section shows its card count. **(call)**

### 7.8 Opening the real card

- A click without a drag, at any zoom, opens the real Trello card
  (`t.showCard`). **(Mike)**
- Each person's view (axes, lists, colouring, image setting, zoom and pan) is
  saved privately for that person and board, so reopening the matrix returns
  to the same place whether or not Trello closes the matrix when the card
  opens. **(call)**

### 7.9 Images

- If a card has a cover image, the full-card view shows it. A "Show images"
  checkbox turns images off. The setting is per person. **(Mike: option to see
  images when zoomed in; call: cover image only, per-person setting)**
- Images are loaded only for cards at full-card size and in view. **(call)**

### 7.10 Colour

- "Colour by" offers: label, any dropdown custom field on the board, list,
  member. **(Mike: label, custom field or other attribute; call: this set)**
- By label, a card with several labels takes the colour of its first label in
  the board's label order. By member, its first member. Cards with no value
  are grey. **(call)**
- Label and dropdown option colours match Trello's. Lists and members get
  colours from a fixed palette. **(call)**
- A legend at the bottom shows the colours in use. **(call)**

### 7.11 Resequencing lists

- A "Resequence lists…" button opens a preview. Nothing changes in Trello
  until the user confirms. **(Mike: an option to resequence; call: preview and
  confirm)**
- Each chosen list is reordered on its own. Cards never move between lists.
  **(Mike: "in their lists")**
- Order is by straight-line distance to the top-right corner, nearest first,
  using the exact positions on the two parameters on screen, each axis running
  0 to 1 and counting equally. Ties keep their current order. **(Mike:
  closeness to the upper right; call: the measure)**
- Cards not placed (in a strip or the tray) stay below the placed cards, in
  their current order. **(call)**
- The preview shows each list's new order with each card's old position.
- Applying shows progress, paces requests to stay inside the rate limits, and
  can be re-run safely if it stops part-way. **(call)**
- One-step undo. Before reordering, each card's previous list position is
  saved in its own hidden storage. "Undo last reorder" restores those
  positions, and is available until the next reorder. **(call)**

### 7.12 Working together

- There is one shared placement per card. Both people can drag. **(Mike)**
- A change made by the other person appears within a few seconds without a
  reload. **(Mike: shared matrix; call: the target)**
- If both move the same card, the last write wins. A card being dragged
  locally is not moved by an incoming update until the drag ends. **(call)**
- View settings are per person, so one person changing axes or zoom does not
  move the other's view. **(call)**

## 8. Where data lives

| Data | Where | Visible on card |
|------|-------|-----------------|
| Level per parameter | Dropdown Custom Field value on the card | Yes |
| Exact position per parameter (0 to 1) | Power-Up storage, card scope, shared | No |
| Previous list position, for undo | Power-Up storage, card scope, shared | No |
| Parameter definitions (name, levels, field and option ids) | Power-Up storage, board scope, shared | No |
| View settings | Power-Up storage, board scope, private per person | No |
| REST token | Trello's own private Power-Up storage | No |

Per-card storage holds a handful of numbers, far inside the 4096-character
limit. Parameter definitions are small enough for the board-scope limit at any
realistic number of parameters; the builder should fail clearly, not silently,
if the limit is ever hit.

## 9. Structure

Design calls, not agreed with Mike in detail:

- **Board store (the seam).** One interface for everything the matrix needs
  from the outside: load lists, cards, labels, members and fields; load and
  save exact positions; set or clear a level; create, rename and link
  parameter fields; reorder a list; subscribe to changes; open a card; load a
  card image; load and save view settings. Two implementations: the Trello one
  (Power-Up client library plus REST), and an in-memory fake with sample data
  for development and tests. A server-backed one (approach B) would be a
  third.
- **Model.** Pure functions with no Trello or screen knowledge: level from
  position, reconciling field and stored position, which cards are placed,
  resequence order, request pacing.
- **View.** The matrix surface (zoom, pan, detail levels, drag), toolbar,
  tray, legend, resequence preview, parameter setup.
- **Connector.** The Power-Up entry page that declares the board button and
  card button and opens the modal.

Tools: TypeScript, built with Vite, cards rendered as ordinary page elements
as in the mockup (no canvas needed at this card count). Whether to use a light
view library is the builder's choice.

Hosting **(Mike)**: a public repository under Firework-Labs, served by GitHub
Pages. The hosted page contains code only, no card data. It does contain the
Power-Up's API key, which Trello treats as public; no secret or token is ever
committed or served. The Pages address feeds the Power-Up registration, the
API key's allowed origins and the build's base path.

Tests: unit tests for the model; the view developed and browser-tested against
the fake board store, so nothing touches Trello in automated tests.

## 10. Prove first on a test board

The Trello documentation does not settle these. The first step of the build is
a small proof on a test board.

**Who runs it (Mike):** the builder makes a check page inside the Power-Up that
runs each check and reports its own result, plus a short written script. Mike
and his collaborator (or a second Trello account) run it in Chrome and Safari,
about ten minutes, and send the results back. The agent machine does not hold
Trello browser logins.

**Order of work (call):** the proof needs the repository, hosting and Power-Up
registration from section 11. Building the model and the matrix against the
fake board store does not, and may start before the proof results are in. The
Trello board store is finished after the results, since they decide its
fallbacks.

| Question | If it works | If it does not |
|----------|-------------|----------------|
| Can a modal opened from the board button read and write shared storage on any card by id (`t.get` / `t.set` with a card id)? | As designed | No fallback inside approach A: stop and revisit B with Mike |
| Does a change by another person reach an open modal without reload (`t.render` or similar)? | Use it | Poll the board through REST every few seconds |
| Does the REST authorisation work and persist inside the Power-Up frame in Chrome and Safari? | As designed | Report to Mike; may need a different sign-in flow |
| What happens to the matrix when `t.showCard` is called from it? | Either outcome is handled by saved view settings | Not applicable |
| Can a card's cover image be shown (plain image tag, or fetched with the authorisation header)? | Use whichever works | Leave images out of this version and tell Mike |
| Which values does a card's list position accept, and how fast can 90 cards be reordered inside the rate limits? | Set the pacing | Not applicable |

## 11. What Mike provides

- A public GitHub repository for the project under Firework-Labs, with this
  machine's account invited and GitHub Pages turned on.
- Registering the Power-Up in Trello's Power-Up admin page for the Firework
  Labs workspace and generating its API key. The builder supplies exact steps.
- A test board, ideally a copy of the Teamwork board, with Custom Fields
  enabled. If the agent is to write to it directly, it is named in
  `.claude/handoff.json`.
- Running the scripted proof from section 10 with a second account.
- Adding the collaborator to the board when it is time to use it together.

## 12. Left to the builder

- Zoom thresholds for the three detail levels, sizes, animation timings.
- The fixed colour palette for lists and members.
- Whether to use a light view library.
- Storage key names and the exact shape of stored values.
- How list positions are assigned during a reorder, and the pacing.
- Wording of messages and the setup dialog layout.
- Icons for the board and card buttons.

## 13. Size

A project. It gets a full implementation plan after this design is approved.
