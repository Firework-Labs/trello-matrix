# Trello Matrix Power-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private Trello Power-Up that shows a board's cards on a zoomable 2D matrix, writes each card's level per parameter to Custom Fields, keeps exact positions hidden, and can reorder lists by closeness to the top-right corner.

**Architecture:** A static multi-page site with no server. Pure model functions decide levels, drops, order and colour. All board reads and writes go through one `BoardStore` interface with two implementations: an in-memory fake (development and all automated tests) and a Trello one (Power-Up client library plus REST). The view is plain DOM, mounted on a store.

**Tech Stack:** TypeScript 5, Vite 6 (multi-page), Vitest 3, Playwright (Chromium and WebKit), no view library, Trello Power-Up client library from `https://p.trellocdn.com/power-up.min.js`, GitHub Pages.

**Status:** written 2026-11-14, awaiting Mike's review and choice of execution method. No task started.

**Spec:** `docs/superpowers/specs/2026-11-13-trello-matrix-design.md` (read it first; section numbers below refer to it). Reference mockup: `docs/superpowers/specs/assets/matrix-mockup.html` (throwaway; copy its look and feel, not its code).

## Global Constraints

- Node 22 or later. No runtime dependencies; dev dependencies only (`typescript`, `vite`, `vitest`, `@playwright/test`).
- Site base path `/trello-matrix/`, overridable with `VITE_BASE`. Published address `https://firework-labs.github.io/trello-matrix/`.
- The Power-Up API key is read from `VITE_TRELLO_APP_KEY`. It is public. No token or secret is ever committed, logged or written to a file.
- Automated tests never touch Trello. Only `src/trello/**`, `src/connector.ts`, `src/matrix-main.ts` and `src/proof/**` may reference `TrelloPowerUp` or `api.trello.com`.
- Positions are numbers from 0 (worst end) to 1 (best end), stored clamped to `[0, 0.999]` and rounded to 3 decimals. `Parameter.levels` is always ordered worst to best. On screen the best end is up or right (spec 7.3).
- A level is an equal division: `floor(v * levelCount)`, clamped. Parameters have exactly 2 or 3 levels.
- Never use Escape as a shortcut (spec 5). Never delete a Custom Field or a field value except through an explicit drop on a strip or the tray (spec 4).
- Plugin data: at most 4096 characters per scope and visibility pair. A write that would exceed it fails with a visible error, never silently.
- REST pacing: at most 80 requests per 10 seconds per person (limit is 100).
- Agent writes to Trello only on boards named in `.claude/handoff.json`. Until one is named, live checks are run by Mike.
- Commit after every task with the message given. Push to `origin main` once the remote exists.
- User-facing text uses the spec's words: "Across", "Up", "Swap axes", "Colour by", "Show images", "Whole matrix", "Not placed yet", "Do first", "Resequence lists…", "Reorder in Trello", "Undo last reorder", "Connect to Trello", "Show on matrix".

- Test code below names small helpers that no task defines (for example `card`, `cardWith`, `byId`, `param`, `fakeClock`, `deps`, `restWithFakeFetch`, `store`, `dragCardBy`, `dragCardTo`, `startDrag`, `zoomToFull`, `listOrder`). Each is a few lines the implementer writes; the name says what it does. Unit-test helpers live in the test file, e2e helpers in `e2e/helpers.ts`. A test whose body is a comment states its exact assertions in that comment.

## Review Focus

Conditions the spec implies but does not spell out, most likely first. Each has a pinned test in the task named.

1. **A parameter's Custom Field or one of its options is deleted or edited in Trello.** The parameter disappears from the matrix, or the card counts as not set on it. Nothing crashes and nothing is written. (Task 1 `fieldLevel`, Task 13 `joinParameters`)
2. **A stored position is missing, not a number or out of range.** It is treated as absent and the card is drawn mid-section. (Task 1, Task 13 `decodeCard`)
3. **A write fails during a drop** (network, 429, lost permission). The card returns to where it was, an error is shown, and the field and position do not end up disagreeing. (Task 8)
4. **A card is archived, deleted or moved to an unchosen list by someone else while the matrix is open or mid-drag.** It leaves the matrix without an error and the drop is discarded. (Task 12)
5. **Nothing to show:** no lists chosen, a chosen list is empty, or fewer than two parameters exist. A plain hint is shown instead of an empty grid, and "Resequence lists…" is disabled. (Task 9)

## File Structure

```
index.html              connector page: loads the Power-Up library and src/connector.ts
matrix.html             the modal: src/matrix-main.ts
proof.html              live-check page: src/proof/proof-main.ts
dev.html                the matrix on the fake store: src/dev-main.ts
public/icon.svg         button icon
src/config.ts           APP_KEY, APP_NAME, SYNC_MODE, COVER_MODE, RENAME_OPTIONS
src/model/types.ts      shared types
src/model/placement.ts  level and position rules
src/model/drop.ts       what a drop writes
src/model/resequence.ts order by closeness to top-right
src/model/pacer.ts      request pacing
src/model/colour.ts     colour by label, field, list, member
src/store/board-store.ts  the seam (interface and errors)
src/store/sample-data.ts  deterministic sample board
src/store/fake-store.ts   in-memory BoardStore
src/view/viewport.ts    zoom and pan arithmetic
src/view/surface.ts     matrix, strips, tray, cards, detail levels
src/view/drag.ts        card dragging and drop zones
src/view/toolbar.ts     pickers and buttons
src/view/legend.ts      colour legend
src/view/toast.ts       messages
src/view/parameter-dialog.ts
src/view/resequence-drawer.ts
src/view/connect-screen.ts
src/view/app.ts         mountMatrix: state, wiring, persistence
src/view/styles.css
src/trello/power-up.d.ts  minimal types for the client library
src/trello/plugin-data.ts storage keys and codecs
src/trello/rest.ts        REST calls
src/trello/change-source.ts  render or poll
src/trello/trello-store.ts   BoardStore on Trello
src/connector.ts        board button and card button
src/matrix-main.ts      mounts the matrix on the Trello store
src/dev-main.ts         mounts the matrix on the fake store
src/proof/checks.ts     the live checks
src/proof/proof-main.ts check page UI
tests/**                Vitest unit tests, mirroring src
e2e/**                  Playwright tests against dev.html
.github/workflows/pages.yml
docs/setup.md           registration and hosting steps for Mike
docs/proof-script.md    the script Mike runs
```

---

### Task 1: Project scaffold, shared types, placement rules

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `src/model/types.ts`, `src/model/placement.ts`
- Test: `tests/model/placement.test.ts`

**Interfaces:**
- Produces `src/model/types.ts`, exactly:

```ts
export type ParamId = string;                       // equals the Custom Field id
export interface Parameter { id: ParamId; name: string; levels: string[]; fieldId: string; optionIds: string[] } // levels and optionIds worst → best
export interface List { id: string; name: string }
export interface Label { id: string; name: string; colour: string | null }   // Trello colour name, e.g. 'pink_dark'
export interface Member { id: string; fullName: string; initials: string }
export interface DropdownField { id: string; name: string; options: { id: string; text: string; colour: string }[] }
export interface Card {
  id: string; name: string; idList: string; pos: number;
  labelIds: string[]; memberIds: string[]; hasCover: boolean;
  fieldOptions: Record<string, string>;             // fieldId → selected optionId
}
export interface Placement { positions: Record<ParamId, number> }
export interface BoardSnapshot {
  lists: List[]; cards: Card[]; labels: Label[]; members: Member[];
  dropdownFields: DropdownField[]; parameters: Parameter[];
  placements: Record<string, Placement>;            // by card id; a missing entry means no positions
  canEdit: boolean; canUndoReorder: boolean;
}
export type ColourBy = { kind: 'label' } | { kind: 'list' } | { kind: 'member' } | { kind: 'field'; fieldId: string };
export interface ViewSettings {
  across: ParamId | null; up: ParamId | null; listIds: string[];
  colourBy: ColourBy; showImages: boolean; zoom: number; panX: number; panY: number;
}
export type Zone = 'matrix' | 'leftStrip' | 'bottomStrip' | 'tray';
export interface Located { zone: Zone; x: number | null; y: number | null }  // x on Across, y on Up
```

- Produces `src/model/placement.ts`:
  - `levelOf(v: number, levelCount: number): number`
  - `clampPosition(v: number): number` (to `[0, 0.999]`, 3 decimals)
  - `fieldLevel(card: Card, p: Parameter): number | null`
  - `effectivePosition(level: number | null, stored: number | undefined, levelCount: number, cardId: string): number | null`
  - `locate(card: Card, placement: Placement | undefined, across: Parameter, up: Parameter): Located`

- [ ] **Step 1: Scaffold.** `package.json` with `"type": "module"`, `"engines": {"node": ">=22"}`, scripts `dev` (`vite`), `build` (`tsc --noEmit && vite build`), `test` (`vitest run`), `e2e` (`playwright test`). `tsconfig.json` strict, `noUncheckedIndexedAccess`, target ES2022, `moduleResolution: bundler`. `vite.config.ts` with `base: process.env.VITE_BASE ?? '/trello-matrix/'` and `build.rollupOptions.input` listing `index.html`, `matrix.html`, `proof.html`, `dev.html` (create each as an empty HTML shell with a `<div id="app">`). Add `node_modules/`, `dist/`, `test-results/`, `playwright-report/` to `.gitignore`. Run `npm install`.

- [ ] **Step 2: Write the failing tests** in `tests/model/placement.test.ts`

```ts
const value: Parameter = { id: 'f-value', name: 'Value', levels: ['Low', 'Medium', 'High'], fieldId: 'f-value', optionIds: ['v0', 'v1', 'v2'] };
const ease: Parameter = { id: 'f-ease', name: 'Ease', levels: ['Hard', 'Easy'], fieldId: 'f-ease', optionIds: ['e0', 'e1'] };
const card = (fieldOptions: Record<string, string>): Card =>
  ({ id: 'c', name: 'n', idList: 'l', pos: 1, labelIds: [], memberIds: [], hasCover: false, fieldOptions });

test('levelOf uses equal divisions and clamps', () => {
  expect([0, 0.3333, 0.34, 0.999, 1, -0.1].map(v => levelOf(v, 3))).toEqual([0, 0, 1, 2, 2, 0]);
  expect([0.49, 0.5].map(v => levelOf(v, 2))).toEqual([0, 1]);
});
test('clampPosition', () => { expect([-1, 0.12345, 1.2].map(clampPosition)).toEqual([0, 0.123, 0.999]); });
test('fieldLevel reads the option, null when unset or unknown', () => {
  expect(fieldLevel(card({ 'f-value': 'v2' }), value)).toBe(2);
  expect(fieldLevel(card({}), value)).toBeNull();
  expect(fieldLevel(card({ 'f-value': 'deleted-option' }), value)).toBeNull();   // Review Focus 1
});
test('effectivePosition: stored wins inside its level', () => { expect(effectivePosition(1, 0.4, 3, 'c')).toBe(0.4); });
test('effectivePosition: field wins on level, offset inside the section is kept', () => {
  expect(effectivePosition(2, 0.4, 3, 'c')).toBeCloseTo((2 + 0.2) / 3, 6);
});
test('effectivePosition: no level means not placed', () => { expect(effectivePosition(null, 0.4, 3, 'c')).toBeNull(); });
test('effectivePosition: no usable stored value draws mid-section, spread by card id', () => {   // Review Focus 2
  for (const bad of [undefined, NaN, 1.7, -0.2]) {
    const v = effectivePosition(0, bad as number | undefined, 2, 'c')!;
    expect(v).toBeGreaterThanOrEqual(0.175); expect(v).toBeLessThanOrEqual(0.325);
  }
  expect(effectivePosition(0, undefined, 2, 'c')).toBe(effectivePosition(0, undefined, 2, 'c'));
  const spread = new Set(Array.from({ length: 20 }, (_, i) => effectivePosition(0, undefined, 2, 'card' + i)));
  expect(spread.size).toBeGreaterThanOrEqual(10);
});
test('locate picks the zone from which parameters have a level', () => {
  const p = { positions: { 'f-value': 0.9, 'f-ease': 0.75 } };
  expect(locate(card({ 'f-value': 'v2', 'f-ease': 'e1' }), p, ease, value)).toEqual({ zone: 'matrix', x: 0.75, y: 0.9 });
  expect(locate(card({ 'f-value': 'v2' }), p, ease, value)).toEqual({ zone: 'leftStrip', x: null, y: 0.9 });
  expect(locate(card({ 'f-ease': 'e1' }), p, ease, value)).toEqual({ zone: 'bottomStrip', x: 0.75, y: null });
  expect(locate(card({}), p, ease, value)).toEqual({ zone: 'tray', x: null, y: null });
});
```

- [ ] **Step 3: Run** `npx vitest run tests/model/placement.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 4: Implement** `types.ts` as above and the five functions. Mid-section offset: `(level + 0.5 + j) / levelCount` where `j` is in `[-0.15, 0.15]`, derived from a string hash of `cardId`.
- [ ] **Step 5: Run** the tests and `npm run build`. Expected: PASS, build succeeds.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: project scaffold and placement rules"`

---

### Task 2: Connector, live-check page, hosting, and the script for Mike

This task has a wait on Mike at the end. Do not block on it: continue with Task 3 once the hand-off is sent. Tasks 13 to 15 need its results.

**Files:**
- Create: `index.html`, `proof.html`, `public/icon.svg`, `src/config.ts`, `src/connector.ts`, `src/trello/power-up.d.ts`, `src/proof/checks.ts`, `src/proof/proof-main.ts`, `.github/workflows/pages.yml`, `docs/setup.md`, `docs/proof-script.md`
- Test: `tests/proof/checks.test.ts`

**Interfaces:**
- Produces `src/config.ts`:

```ts
export const APP_KEY: string = import.meta.env.VITE_TRELLO_APP_KEY ?? '';
export const APP_NAME = 'Matrix';
export const SYNC_MODE: 'render' | 'poll' = 'poll';            // set from check P2
export const COVER_MODE: 'img' | 'fetch' | 'off' = 'off';      // set from check P5
export const RENAME_OPTIONS: boolean = false;                  // set from check P7
```

- Produces `src/trello/power-up.d.ts`: a `TrelloIframe` type and a global `TrelloPowerUp` declaring only what this project calls: `initialize`, `iframe`, `t.get`, `t.set`, `t.remove`, `t.cards`, `t.lists`, `t.board`, `t.getContext`, `t.modal`, `t.closeModal`, `t.showCard`, `t.render`, `t.arg`, `t.getRestApi()` returning `{ isAuthorized(): Promise<boolean>; authorize(opts): Promise<string>; getToken(): Promise<string | null>; clearToken(): Promise<void> }`.
- Produces `src/proof/checks.ts`:

```ts
export interface CheckResult { id: string; title: string; status: 'pass' | 'fail' | 'manual'; detail: string; ms?: number }
export interface CheckDeps { t: TrelloIframe; fetch: typeof fetch; key: string; now: () => number }
export const checks: { id: string; title: string; needsClick: boolean; run(d: CheckDeps): Promise<CheckResult> }[];
```

- [ ] **Step 1: Write the failing tests** in `tests/proof/checks.test.ts` with a hand-made fake `t` (a `Map` behind `get`/`set`) and a fake `fetch`.

```ts
test('P1 passes when a value set on another card id reads back', async () => {
  const r = await byId('P1').run(deps({ cards: [{ id: 'a' }, { id: 'b' }] }));
  expect(r.status).toBe('pass');
});
test('P1 fails with the error text when t.set rejects', async () => {
  const r = await byId('P1').run(deps({ setRejects: 'not in scope' }));
  expect(r).toMatchObject({ status: 'fail', detail: expect.stringContaining('not in scope') });
});
test('P5 reports which image method worked', async () => {
  const r = await byId('P5').run(deps({ imgLoads: false, fetchStatus: 200 }));
  expect(r).toMatchObject({ status: 'pass', detail: expect.stringContaining('fetch') });
});
test('P6 reports requests per second and any 429', async () => {
  const r = await byId('P6').run(deps({ fetchStatus: 200 }));
  expect(r.detail).toMatch(/\d+ requests in \d+ ms, 429s: 0/);
});
test('every check resolves to a result even when it throws', async () => {
  for (const c of checks) expect((await c.run(deps({ everythingThrows: true }))).status).toBe('fail');
});
```

- [ ] **Step 2: Run** `npx vitest run tests/proof`. Expected: FAIL.
- [ ] **Step 3: Implement the seven checks** (spec section 10, plus P7).

| Id | What it does | Pass means |
|----|--------------|-----------|
| P1 | `t.set(cardId, 'shared', 'mxproof', stamp)` on the first two cards from `t.cards('id')`, then `t.get` each | Both read back |
| P2 | Registers `t.render`, polls `t.get('board', 'shared', 'mxping')` every second, and offers a "Write ping" button that sets it. Person B presses it; person A's page records whether `render` fired and how many ms until the value was seen | Value seen without reload; detail says `render fired: yes/no, seen after N ms` |
| P3 | `t.getRestApi().authorize({ scope: 'read,write', expiration: 'never' })` from a click, then `isAuthorized()`; on the next page load reports whether it is still authorised | Authorised now and after reload |
| P4 | Writes `{ stamp }` to `sessionStorage`, calls `t.showCard(firstCardId)`. On load, and when the page regains focus, reports whether the page instance survived | `manual`: detail says "matrix stayed open" or "matrix was closed" |
| P5 | For the first card with a cover: tries an `<img>` with the cover URL, then `fetch` with header `Authorization: OAuth oauth_consumer_key="KEY", oauth_token="TOKEN"` | Either works; detail names which (`img` or `fetch`) |
| P6 | Sets `pos` on the first card of the first list to `'top'`, `'bottom'`, then `65536.5`, reading it back; then sends 30 `PUT /1/cards/{id}?pos=` requests back to back | Detail: accepted values, `N requests in M ms, 429s: K`, and the `x-rate-limit-api-token-remaining` header if readable |
| P7 | Creates a dropdown field `mxproof` with two options through `POST /1/customFields` (`display_cardFront: true`), renames one option with `PUT /1/customFields/{id}/options/{idOption}` and body `{ value: { text } }`, reads it back, then deletes the field | Field created and option renamed |

  `proof-main.ts` renders one row per check with a Run button, a results table, and a "Copy results" button that copies the results as JSON with the browser name. Write checks stay disabled until the user ticks "This is a test board". The page never displays or copies the token.

- [ ] **Step 4: Implement `src/connector.ts`.** `TrelloPowerUp.initialize({ 'board-buttons': ..., 'card-buttons': ... }, { appKey: APP_KEY, appName: APP_NAME })`. Board buttons: "Matrix" (`condition: 'always'`, opens `t.modal({ url: './matrix.html', fullscreen: true, title: 'Matrix' })`) and, only when `import.meta.env.VITE_PROOF === '1'`, "Matrix checks" opening `./proof.html` the same way. Card button: "Show on matrix", opening the modal with `args: { focusCardId: t.getContext().card }`.
- [ ] **Step 5: Add `.github/workflows/pages.yml`**: on push to `main`, `npm ci`, `npm test`, `npm run build` with `VITE_TRELLO_APP_KEY` from repository variable `TRELLO_APP_KEY` and `VITE_PROOF` from variable `PROOF`, then deploy `dist/` with `actions/deploy-pages`.
- [ ] **Step 6: Write `docs/setup.md` and `docs/proof-script.md`.** Setup: create the public repository `Firework-Labs/trello-matrix`, invite this machine's account, turn on Pages with source "GitHub Actions"; at `https://trello.com/power-ups/admin` create a Power-Up named "Matrix" in the Firework Labs workspace with iframe connector URL `https://firework-labs.github.io/trello-matrix/index.html`, enable capabilities "Board buttons" and "Card buttons", generate an API key, add allowed origin `https://firework-labs.github.io`, set repository variables `TRELLO_APP_KEY` and `PROOF=1`; copy the Teamwork board to a test board, enable Custom Fields on it, add the Power-Up. Proof script: numbered steps for two people in Chrome then Safari, which button to press when, and "press Copy results and send both pastes back".
- [ ] **Step 7: Run** `npm test && npm run build`. Expected: PASS; `dist/index.html`, `dist/proof.html` exist.
- [ ] **Step 8: Commit** `git commit -m "feat: Power-Up connector, live-check page and hosting workflow"`
- [ ] **Step 9: Hand off to Mike.** Send him `docs/setup.md` and `docs/proof-script.md`. When the remote exists: `git remote add origin git@github.com:Firework-Labs/trello-matrix.git && git push -u origin main`. Record his pasted results in `docs/proof-results.md`. If P1 fails, stop and bring it to Mike (spec section 10: revisit approach B).

---

### Task 3: What a drop writes

**Files:**
- Create: `src/model/drop.ts`
- Test: `tests/model/drop.test.ts`

**Interfaces:**
- Consumes: `fieldLevel`, `levelOf`, `clampPosition` (Task 1).
- Produces:

```ts
export interface DropInput { card: Card; across: Parameter; up: Parameter; zone: Zone; x: number; y: number }
export interface LevelChange { param: Parameter; level: number | null }
export interface DropPlan { positions: Record<ParamId, number | null>; levels: LevelChange[]; message: string | null }
export function planDrop(input: DropInput): DropPlan;
```

`positions` always holds both visible parameters: a number to save, `null` to forget. `levels` lists only parameters whose level actually changes.

- [ ] **Step 1: Write the failing tests.** `cost` has levels `['High', 'Medium', 'Low']`, options `['k0','k1','k2']`; `value` as in Task 1. Across is `cost`, Up is `value`.

```ts
test('moving inside a section saves the spot and changes no field', () => {
  const p = planDrop({ card: card({ 'f-cost': 'k0', 'f-value': 'v2' }), across: cost, up: value, zone: 'matrix', x: 0.2, y: 0.8 });
  expect(p).toEqual({ positions: { 'f-cost': 0.2, 'f-value': 0.8 }, levels: [], message: null });
});
test('crossing a boundary changes only that field and names the change', () => {
  const p = planDrop({ card: card({ 'f-cost': 'k0', 'f-value': 'v2' }), across: cost, up: value, zone: 'matrix', x: 0.5, y: 0.8 });
  expect(p.levels).toEqual([{ param: cost, level: 1 }]);
  expect(p.message).toBe('Cost: High → Medium');
});
test('placing from the tray sets both', () => {
  const p = planDrop({ card: card({}), across: cost, up: value, zone: 'matrix', x: 0.9, y: 0.1 });
  expect(p.levels).toEqual([{ param: cost, level: 2 }, { param: value, level: 0 }]);
  expect(p.message).toBe('Cost: not set → Low, Value: not set → Low');
});
test('left strip keeps Up and clears Across', () => {
  const p = planDrop({ card: card({ 'f-cost': 'k0', 'f-value': 'v2' }), across: cost, up: value, zone: 'leftStrip', x: 0, y: 0.8 });
  expect(p.positions).toEqual({ 'f-cost': null, 'f-value': 0.8 });
  expect(p.levels).toEqual([{ param: cost, level: null }]);
  expect(p.message).toBe('Cost: High → not set');
});
test('bottom strip keeps Across and clears Up', () => {
  const p = planDrop({ card: card({ 'f-cost': 'k0', 'f-value': 'v2' }), across: cost, up: value, zone: 'bottomStrip', x: 0.2, y: 0 });
  expect(p.positions).toEqual({ 'f-cost': 0.2, 'f-value': null });
  expect(p.levels).toEqual([{ param: value, level: null }]);
});
test('tray clears both, and only lists fields that were set', () => {
  const p = planDrop({ card: card({ 'f-value': 'v2' }), across: cost, up: value, zone: 'tray', x: 0, y: 0 });
  expect(p.positions).toEqual({ 'f-cost': null, 'f-value': null });
  expect(p.levels).toEqual([{ param: value, level: null }]);
});
test('out-of-range drops are clamped', () => {
  const p = planDrop({ card: card({}), across: cost, up: value, zone: 'matrix', x: 1.4, y: -3 });
  expect(p.positions).toEqual({ 'f-cost': 0.999, 'f-value': 0 });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/model/drop.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `planDrop`.** Message parts are `"<Param name>: <old level name or 'not set'> → <new level name or 'not set'>"` joined with `", "`, Across first.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: drop rules for matrix, strips and tray"`

---

### Task 4: Resequence order and request pacing

**Files:**
- Create: `src/model/resequence.ts`, `src/model/pacer.ts`
- Test: `tests/model/resequence.test.ts`, `tests/model/pacer.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RankedCard { cardId: string; oldIndex: number; newIndex: number; placed: boolean }
export function resequenceList(cardsInListOrder: Card[], locate: (c: Card) => Located): RankedCard[];   // sorted by newIndex
export function positionsFor(orderedCardIds: string[]): { cardId: string; pos: number }[];              // pos = (i + 1) * 16384

export interface Pacer { run<T>(fn: () => Promise<T>): Promise<T> }
export function createPacer(o: { maxPerWindow: number; windowMs: number; now: () => number; sleep: (ms: number) => Promise<void> }): Pacer;
```

- [ ] **Step 1: Write the failing tests**

```ts
test('placed cards go nearest the top-right first, then unplaced in their old order', () => {
  const at: Record<string, Located> = {
    a: { zone: 'tray', x: null, y: null }, b: { zone: 'matrix', x: 0.9, y: 0.1 }, c: { zone: 'matrix', x: 0.5, y: 0.5 },
    d: { zone: 'leftStrip', x: null, y: 0.99 }, e: { zone: 'matrix', x: 0.9, y: 0.9 },
  };
  const r = resequenceList(['a', 'b', 'c', 'd', 'e'].map(cardWithId), c => at[c.id]!);
  expect(r.map(x => x.cardId)).toEqual(['e', 'c', 'b', 'a', 'd']);
  expect(r[0]).toEqual({ cardId: 'e', oldIndex: 4, newIndex: 0, placed: true });
  expect(r[3]).toMatchObject({ cardId: 'a', placed: false });
});
test('equal distances keep their current order', () => {
  const same: Located = { zone: 'matrix', x: 0.5, y: 0.5 };
  expect(resequenceList(['a', 'b', 'c'].map(cardWithId), () => same).map(x => x.cardId)).toEqual(['a', 'b', 'c']);
});
test('positionsFor gives ascending positive positions', () => {
  expect(positionsFor(['x', 'y'])).toEqual([{ cardId: 'x', pos: 16384 }, { cardId: 'y', pos: 32768 }]);
});
test('pacer never starts more than maxPerWindow calls in any window', async () => {
  const clock = fakeClock();                       // now() and sleep(ms) that advances now
  const pacer = createPacer({ maxPerWindow: 3, windowMs: 1000, ...clock });
  const starts: number[] = [];
  await Promise.all(Array.from({ length: 7 }, () => pacer.run(async () => { starts.push(clock.now()); })));
  expect(starts).toEqual([0, 0, 0, 1000, 1000, 1000, 2000]);
});
test('pacer passes results and rejections through, in call order', async () => { /* run returns fn's value; a rejection does not block later calls */ });
```

- [ ] **Step 2: Run** `npx vitest run tests/model/resequence.test.ts tests/model/pacer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Distance is `Math.hypot(1 - x, 1 - y)`. The pacer runs calls one after another in arrival order.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: resequence order and request pacing"`

---

### Task 5: Colour

**Files:**
- Create: `src/model/colour.ts`
- Test: `tests/model/colour.test.ts`

**Interfaces:**
- Produces:

```ts
export const NONE_COLOUR = '#8590a2';
export const PALETTE: string[];                            // 10 distinct hex colours, for lists and members
export function trelloColour(name: string | null): string; // Trello label or option colour name → hex; unknown or null → NONE_COLOUR
export interface ColourInfo { key: string; label: string; colour: string }
export function colourOf(card: Card, by: ColourBy, snap: BoardSnapshot): ColourInfo;
export function legendFor(cards: Card[], by: ColourBy, snap: BoardSnapshot): ColourInfo[];  // distinct, board order, 'none' last
```

- [ ] **Step 1: Write the failing tests**

```ts
test('every Trello colour name maps to a hex', () => {
  for (const base of ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'black'])
    for (const suffix of ['', '_dark', '_light']) expect(trelloColour(base + suffix)).toMatch(/^#[0-9a-f]{6}$/);
  expect(trelloColour('nope')).toBe(NONE_COLOUR); expect(trelloColour(null)).toBe(NONE_COLOUR);
});
test('by label: first label in board order wins', () => {
  // snap.labels order: [UXUI pink_dark, Bug red_dark]; the card lists Bug before UXUI
  expect(colourOf(cardWith({ labelIds: ['bug', 'uxui'] }), { kind: 'label' }, snap)).toEqual({ key: 'uxui', label: 'UXUI', colour: trelloColour('pink_dark') });
});
test('no value is grey with key "none"', () => {
  for (const by of [{ kind: 'label' }, { kind: 'member' }, { kind: 'field', fieldId: 'f-impacts' }] as ColourBy[])
    expect(colourOf(cardWith({}), by, snap)).toEqual({ key: 'none', label: 'None', colour: NONE_COLOUR });
});
test('by field uses the option colour; by list and member use the palette by board order', () => {
  expect(colourOf(cardWith({ fieldOptions: { 'f-impacts': 'opt-ios' } }), { kind: 'field', fieldId: 'f-impacts' }, snap).colour).toBe(trelloColour('blue'));
  expect(colourOf(cardWith({ idList: snap.lists[1]!.id }), { kind: 'list' }, snap).colour).toBe(PALETTE[1]);
  expect(colourOf(cardWith({ memberIds: [snap.members[0]!.id] }), { kind: 'member' }, snap).colour).toBe(PALETTE[0]);
});
test('legend lists only colours in use, none last', () => {
  expect(legendFor([cardWith({ labelIds: ['bug'] }), cardWith({})], { kind: 'label' }, snap).map(l => l.key)).toEqual(['bug', 'none']);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/model/colour.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Hex values for the 30 Trello names come from Atlassian's published label palette. Palette index wraps with `%`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: colour by label, field, list and member"`

---

### Task 6: The board store seam and the fake store

**Files:**
- Create: `src/store/board-store.ts`, `src/store/sample-data.ts`, `src/store/fake-store.ts`
- Test: `tests/store/fake-store.test.ts`

**Interfaces:**
- Produces `src/store/board-store.ts`, exactly:

```ts
export interface Progress { done: number; total: number }
export interface NewParameter { name: string; levels: string[]; bestEnd: 'first' | 'last' }   // levels as typed, 2 or 3 names
export interface ListOrder { listId: string; cardIds: string[] }
export type StoreErrorKind = 'auth' | 'permission' | 'rate-limit' | 'limit' | 'network' | 'invalid';
export class StoreError extends Error { constructor(public kind: StoreErrorKind, message: string) }
export interface BoardStore {
  isConnected(): Promise<boolean>;
  connect(): Promise<void>;                                   // call only from a click handler
  load(): Promise<BoardSnapshot>;
  subscribe(onChange: (snap: BoardSnapshot) => void): () => void;
  savePositions(cardId: string, positions: Record<ParamId, number | null>): Promise<void>;   // null forgets
  setLevel(cardId: string, param: Parameter, level: number | null): Promise<void>;
  createParameter(input: NewParameter): Promise<Parameter>;
  linkParameter(fieldId: string, bestEnd: 'first' | 'last'): Promise<Parameter>;
  renameParameter(id: ParamId, name: string): Promise<void>;
  renameLevel(id: ParamId, level: number, name: string): Promise<void>;
  removeParameter(id: ParamId): Promise<void>;                // forgets it; the field and its values stay
  reorderLists(orders: ListOrder[], onProgress: (p: Progress) => void): Promise<void>;
  undoReorder(onProgress: (p: Progress) => void): Promise<void>;
  openCard(cardId: string): Promise<void>;
  coverImageUrl(cardId: string): Promise<string | null>;
  loadView(): Promise<ViewSettings | null>;
  saveView(view: ViewSettings): Promise<void>;
}
```

- Produces `sampleSnapshot(o?: { cards?: number; seed?: number }): BoardSnapshot` (default 85 cards, seed 7) with these fixed fixtures that later tests rely on:
  - lists `l-backlog` "Backlog", `l-ideas` "New Feature ideas", `l-doing` "Doing"
  - parameters `f-value` (Low, Medium, High), `f-cost` (worst → best: High, Medium, Low), `f-ease` (Hard, Easy)
  - dropdown field `f-impacts` that is not a parameter; labels with the board's names and colours (UXUI `pink_dark`, Process Improvement `yellow`, Compliance `pink_light`, Architecture `black_dark`, Bug `red_dark`)
  - `c1` "Fixture top right": in `l-backlog`, Value 0.9, Cost 0.9, has a cover
  - `c2` "Fixture value only": Value 0.5, no Cost
  - `c3` "Fixture unplaced": no levels
  - `c4` "Fixture with a very long title that has to be cut off somewhere sensible in a chip": Value 0.1, Cost 0.1
  - remaining cards generated from the seed: about 70% placed on Value and Cost, 15% Value only, the rest unplaced
- Produces `createFakeStore(o?: { snapshot?: BoardSnapshot; connected?: boolean }): FakeStore` where

```ts
export interface FakeStore extends BoardStore {
  calls: { method: string; args: unknown[] }[];
  failNext(method: keyof BoardStore, error?: StoreError): void;
  remote(mutate: (snap: BoardSnapshot) => void): void;        // simulates the other person; notifies subscribers
  snapshot(): BoardSnapshot;                                  // current state, a deep copy
}
```

- [ ] **Step 1: Write the failing tests**

```ts
test('sample board has the fixtures', () => {
  const s = sampleSnapshot();
  expect(s.cards).toHaveLength(85);
  expect(locate(byId(s, 'c1'), s.placements.c1, param(s, 'f-cost'), param(s, 'f-value'))).toEqual({ zone: 'matrix', x: 0.9, y: 0.9 });
  expect(locate(byId(s, 'c2'), s.placements.c2, param(s, 'f-cost'), param(s, 'f-value')).zone).toBe('leftStrip');
  expect(sampleSnapshot()).toEqual(sampleSnapshot());          // deterministic
});
test('setLevel and savePositions change what load returns', async () => {
  const st = createFakeStore();
  const cost = param(await st.load(), 'f-cost');
  await st.setLevel('c3', cost, 2); await st.savePositions('c3', { 'f-cost': 0.95 });
  const s = await st.load();
  expect(byId(s, 'c3').fieldOptions['f-cost']).toBe(cost.optionIds[2]);
  expect(s.placements.c3!.positions['f-cost']).toBe(0.95);
  await st.savePositions('c3', { 'f-cost': null });
  expect((await st.load()).placements.c3?.positions['f-cost']).toBeUndefined();
});
test('createParameter stores levels worst to best', async () => {
  const st = createFakeStore();
  const p = await st.createParameter({ name: 'Risk', levels: ['Low', 'High'], bestEnd: 'first' });
  expect(p.levels).toEqual(['High', 'Low']);
  expect((await st.load()).dropdownFields.find(f => f.id === p.fieldId)!.options.map(o => o.text)).toEqual(['Low', 'High']);
});
test('createParameter rejects 1 or 4 levels and duplicate names', async () => {
  await expect(createFakeStore().createParameter({ name: 'X', levels: ['a'], bestEnd: 'last' })).rejects.toMatchObject({ kind: 'invalid' });
  await expect(createFakeStore().createParameter({ name: 'Value', levels: ['a', 'b'], bestEnd: 'last' })).rejects.toMatchObject({ kind: 'invalid' });
});
test('removeParameter keeps the field and card values', async () => { /* parameters lacks f-ease; dropdownFields and fieldOptions still have it */ });
test('reorderLists then undoReorder restores the exact positions', async () => {
  const st = createFakeStore(); const before = (await st.load()).cards.filter(c => c.idList === 'l-backlog').map(c => [c.id, c.pos]);
  const ids = before.map(b => b[0] as string).reverse(); const seen: Progress[] = [];
  await st.reorderLists([{ listId: 'l-backlog', cardIds: ids }], p => seen.push(p));
  expect(inListOrder(await st.load(), 'l-backlog')).toEqual(ids);
  expect(seen.at(-1)).toEqual({ done: ids.length, total: ids.length });
  expect((await st.load()).canUndoReorder).toBe(true);
  await st.undoReorder(() => {});
  expect((await st.load()).cards.filter(c => c.idList === 'l-backlog').map(c => [c.id, c.pos])).toEqual(before);
  expect((await st.load()).canUndoReorder).toBe(false);
});
test('failNext rejects once and changes nothing', async () => {
  const st = createFakeStore(); st.failNext('setLevel', new StoreError('network', 'offline'));
  await expect(st.setLevel('c1', param(await st.load(), 'f-cost'), 0)).rejects.toMatchObject({ kind: 'network' });
  expect(byId(await st.load(), 'c1').fieldOptions['f-cost']).toBe('k2');
});
test('remote notifies subscribers, and unsubscribe stops it', () => { /* onChange called once with the mutated snapshot; not after the returned function is called */ });
```

- [ ] **Step 2: Run** `npx vitest run tests/store`. Expected: FAIL.
- [ ] **Step 3: Implement.** `load` and `snapshot` return deep copies. Every method records itself in `calls`. `coverImageUrl` returns a small inline SVG data URL for cards with `hasCover`. `openCard` only records the call. Option ids for the fixture parameters are `v0..v2`, `k0..k2`, `e0..e1`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: board store interface and in-memory fake"`

---

### Task 7: Matrix surface: rendering, detail levels, zoom and pan

**Files:**
- Create: `src/view/viewport.ts`, `src/view/surface.ts`, `src/view/app.ts`, `src/view/styles.css`, `dev.html`, `src/dev-main.ts`, `playwright.config.ts`
- Test: `tests/view/viewport.test.ts`, `e2e/surface.spec.ts`

**Interfaces:**
- Consumes: `locate`, `colourOf`, `BoardStore`, `createFakeStore`, `sampleSnapshot`.
- Produces `src/view/viewport.ts`:

```ts
export interface Viewport { zoom: number; panX: number; panY: number }   // zoom 1: whole matrix fills the stage
export interface Size { w: number; h: number }                           // the matrix area at zoom 1, in px
export const MIN_ZOOM = 1, MAX_ZOOM = 9, CHIP_ZOOM = 1.7, FULL_ZOOM = 3.4;
export function detailOf(zoom: number): 'dot' | 'chip' | 'full';
export function toScreen(x: number, y: number, vp: Viewport, s: Size): { left: number; top: number };   // y = 1 is the top
export function toModel(left: number, top: number, vp: Viewport, s: Size): { x: number; y: number };
export function zoomAt(vp: Viewport, factor: number, px: number, py: number, s: Size): Viewport;         // keeps the point under the pointer fixed
export function clampPan(vp: Viewport, s: Size): Viewport;                                               // at least half the stage always shows matrix; zoom 1 → pan 0,0
export function fitSection(i: number, j: number, nx: number, ny: number, s: Size): Viewport;             // zoom = min(nx, ny) * 0.94, section centred
```

- Produces `src/view/app.ts`: `mountMatrix(root: HTMLElement, store: BoardStore, opts?: { focusCardId?: string; canRenameLevels?: boolean }): Promise<{ destroy(): void }>` (`focusCardId` is used from Task 12, `canRenameLevels` from Task 10, default `true`).
- Produces the DOM contract every later e2e test uses:
  - stage `[data-testid="stage"]`; matrix `[data-testid="matrix"]`; badge `[data-testid="do-first"]` with text "Do first"
  - sections `[data-section="i-j"]` (`i` Across level, 0 at the left; `j` Up level, 0 at the bottom), each with `.count` reading "N cards"
  - cards `[data-card-id]` with `data-zone` (`matrix`, `leftStrip`, `bottomStrip`, `tray`) and `data-detail` (`dot`, `chip`, `full`)
  - `[data-testid="strip-left"]`, `[data-testid="strip-bottom"]`, `[data-testid="tray"]` headed "Not placed yet (N)"
  - axis labels `[data-axis="across"]` and `[data-axis="up"]`, one per level, text "Cost: Low"
  - `[data-testid="zoom-label"]`, `[data-testid="whole-matrix"]`
- `dev.html` mounts the matrix on `createFakeStore({ snapshot: sampleSnapshot({ cards: Number(query.cards ?? 85) }) })` and exposes `window.__store`. `?readonly=1` sets `canEdit: false`; `?connected=0` starts disconnected.
- `playwright.config.ts`: `webServer` runs `npm run dev`, `baseURL` `http://localhost:5173/trello-matrix/`, projects `chromium` and `webkit`, viewport 1400 by 850.

- [ ] **Step 1: Write the failing unit tests** in `tests/view/viewport.test.ts`

```ts
const s = { w: 900, h: 600 };
test('detail thresholds', () => { expect([1, 1.69, 1.7, 3.39, 3.4, 9].map(detailOf)).toEqual(['dot', 'dot', 'chip', 'chip', 'full', 'full']); });
test('toScreen puts the best corner at the top right, and toModel inverts it', () => {
  expect(toScreen(1, 1, { zoom: 1, panX: 0, panY: 0 }, s)).toEqual({ left: 900, top: 0 });
  const vp = { zoom: 2.5, panX: -300, panY: -120 };
  const p = toScreen(0.3, 0.7, vp, s); const m = toModel(p.left, p.top, vp, s);
  expect(m.x).toBeCloseTo(0.3, 9); expect(m.y).toBeCloseTo(0.7, 9);
});
test('zoomAt keeps the pointed-at spot still and respects the limits', () => {
  const vp = zoomAt({ zoom: 1, panX: 0, panY: 0 }, 2, 450, 300, s);
  expect(vp).toEqual({ zoom: 2, panX: -450, panY: -300 });
  expect(zoomAt(vp, 100, 0, 0, s).zoom).toBe(9); expect(zoomAt(vp, 0.001, 0, 0, s)).toEqual({ zoom: 1, panX: 0, panY: 0 });
});
test('fitSection centres the section', () => {
  const vp = fitSection(2, 2, 3, 3, s);                      // top-right section of a 3 by 3
  expect(vp.zoom).toBeCloseTo(2.82, 6);
  expect(toScreen(5 / 6, 5 / 6, vp, s)).toEqual({ left: expect.closeTo(450, 3), top: expect.closeTo(300, 3) });
});
```

- [ ] **Step 2: Write the failing e2e tests** in `e2e/surface.spec.ts`

```ts
test('whole matrix shows dots, sections with counts, and the do-first corner', async ({ page }) => {
  await page.goto('dev.html');
  await expect(page.locator('[data-section]')).toHaveCount(9);
  await expect(page.locator('[data-card-id="c1"]')).toHaveAttribute('data-detail', 'dot');
  await expect(page.locator('[data-card-id="c1"]')).toHaveAttribute('data-zone', 'matrix');
  await expect(page.getByTestId('do-first')).toBeVisible();
  const total = (await page.locator('[data-section] .count').allTextContents()).reduce((n, t) => n + parseInt(t), 0);
  expect(total).toBe(await page.locator('[data-card-id][data-zone="matrix"]').count());
});
test('half-placed and unplaced cards sit in the strip and the tray', async ({ page }) => {
  await page.goto('dev.html');
  await expect(page.getByTestId('strip-left').locator('[data-card-id="c2"]')).toBeVisible();
  await expect(page.getByTestId('tray').locator('[data-card-id="c3"]')).toContainText('Fixture unplaced');
});
test('cards gain detail as you zoom in, around the pointer', async ({ page }) => {
  await page.goto('dev.html');
  const c1 = page.locator('[data-card-id="c1"]'); const box = (await c1.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 6);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);          // factor e^0.88
  await expect(c1).toHaveAttribute('data-detail', 'chip');
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
  await expect(c1).toHaveAttribute('data-detail', 'full');
  await expect(c1).toContainText('Fixture top right'); await expect(c1).toContainText('Value: High'); await expect(c1).toContainText('Cost: Low');
  await expect(c1).toBeInViewport();
  await expect(page.locator('[data-axis="up"]').filter({ hasText: 'Value: High' })).toBeInViewport();   // labels stay visible
});
test('double-click fits a section; Whole matrix goes back; Escape does nothing', async ({ page }) => {
  await page.goto('dev.html');
  await page.locator('[data-section="2-2"]').dblclick({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
  await page.getByTestId('whole-matrix').click();
  await expect(page.getByTestId('zoom-label')).toContainText('100%');
});
test('dragging the background pans', async ({ page }) => { /* zoom in, drag empty matrix space by (-200, 0), c1 moves left by 200 px */ });
test('a 2-level axis gives a 2-wide grid', async ({ page }) => { /* dev.html?across=f-ease&up=f-value → 6 sections */ });
test('300 cards stay responsive', async ({ page }) => {
  await page.goto('dev.html?cards=300');
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, i % 2 ? 100 : -100);
  expect(await page.evaluate(() => (window as any).__renderMs.p95)).toBeLessThan(50);
});
```

- [ ] **Step 3: Run** `npx vitest run tests/view && npx playwright install chromium webkit && npx playwright test e2e/surface.spec.ts`. Expected: FAIL.
- [ ] **Step 4: Implement `viewport.ts`**, then `surface.ts` and `app.ts`.
  - Wheel factor `Math.exp(-deltaY * (ctrlKey ? 0.012 : 0.0022))`, applied with `zoomAt` then `clampPan`; call `preventDefault` on wheel.
  - Cards are absolutely positioned elements placed with `toScreen`; their size depends on `data-detail`, not on the zoom (dot 13 px, chip 128 px wide, full card 214 px wide), as in the mockup.
  - Full card shows: cover area if `hasCover`, title, labels, member initials, list name, and one "Param: Level" tag per parameter that has a level.
  - Left strip: 44 px wide, left of the matrix; a strip card's vertical place follows the Up axis and the current zoom and pan. Bottom strip: 44 px high, below the matrix, likewise for Across.
  - Axis labels are clamped to the visible part of their section and hidden when less than 90 px of it shows.
  - In this task Across is `f-cost` and Up is `f-value` unless the query string gives `across` and `up`; chosen lists are `l-backlog` and `l-ideas`; colour is by label. Task 9 replaces these defaults.
  - Record each render's duration and expose `window.__renderMs = { last, p95 }` on the dev page only.
- [ ] **Step 5: Run** unit and e2e tests. Expected: PASS in both browsers.
- [ ] **Step 6: Commit** `git commit -m "feat: matrix surface with continuous zoom and three detail levels"`

---

### Task 8: Dragging cards

**Files:**
- Create: `src/view/drag.ts`, `src/view/toast.ts`
- Modify: `src/view/surface.ts`, `src/view/app.ts`
- Test: `e2e/drag.spec.ts`

**Interfaces:**
- Consumes: `planDrop` (Task 3), `toModel`, store `setLevel` and `savePositions`.
- Produces: `showToast(text: string, kind?: 'info' | 'error'): void`, rendered in `[data-testid="toast"]`. A pointer that moves less than 4 px between down and up is a click, not a drag (Task 12 uses the click).
- Write order on drop: every `setLevel` in `plan.levels`, then one `savePositions`. If any call rejects, stop, put the card back where it was, and show the error.

- [ ] **Step 1: Write the failing e2e tests.** Helper `dragCard(page, id, to)` uses `page.mouse` down on the card centre, moves in 5 steps, up. Helper `store(page, fn)` evaluates against `window.__store`.

```ts
test('moving inside a section saves the spot and writes no field', async ({ page }) => {
  await page.goto('dev.html'); await dragCardBy(page, 'c1', -30, 20);
  const calls = await store(page, s => s.calls.map(c => c.method));
  expect(calls).toEqual(['savePositions']);
  await expect(page.getByTestId('toast')).toBeHidden();
});
test('crossing into another section writes that field and says so', async ({ page }) => {
  await page.goto('dev.html'); await dragCardTo(page, 'c1', '[data-section="1-2"]');       // Cost Low → Medium
  await expect(page.getByTestId('toast')).toHaveText('Cost: Low → Medium');
  const s = await store(page, s => s.snapshot().cards.find(c => c.id === 'c1')!.fieldOptions);
  expect(s['f-cost']).toBe('k1'); expect(s['f-value']).toBe('v2');
});
test('the section under a dragged card is highlighted', async ({ page }) => { /* mid-drag: exactly one [data-section].hot, and it is the one under the pointer */ });
test('strip card dragged straight in keeps its Value spot and gains Cost', async ({ page }) => {
  await page.goto('dev.html'); await dragCardBy(page, 'c2', 400, 0);
  const p = await store(page, s => s.snapshot().placements.c2!.positions);
  expect(p['f-value']).toBe(0.5); expect(p['f-cost']).toBeGreaterThan(0);
  await expect(page.locator('[data-card-id="c2"]')).toHaveAttribute('data-zone', 'matrix');
});
test('tray card dropped on the matrix sets both levels', async ({ page }) => { /* c3 → [data-section="0-0"]; fieldOptions has k0 and v0; toast "Cost: not set → High, Value: not set → Low" */ });
test('dropping on the tray clears both fields; on the left strip clears only Across', async ({ page }) => {
  await page.goto('dev.html'); await dragCardTo(page, 'c4', '[data-testid="strip-left"]');
  let f = await store(page, s => s.snapshot().cards.find(c => c.id === 'c4')!.fieldOptions);
  expect(f['f-cost']).toBeUndefined(); expect(f['f-value']).toBe('v0');
  await dragCardTo(page, 'c4', '[data-testid="tray"]');
  f = await store(page, s => s.snapshot().cards.find(c => c.id === 'c4')!.fieldOptions);
  expect(f['f-value']).toBeUndefined();
});
test('a failed write puts the card back and shows the error', async ({ page }) => {        // Review Focus 3
  await page.goto('dev.html'); const before = await page.locator('[data-card-id="c1"]').boundingBox();
  await store(page, s => s.failNext('setLevel'));
  await dragCardTo(page, 'c1', '[data-section="0-0"]');
  await expect(page.getByTestId('toast')).toContainText("Couldn't save");
  expect(await page.locator('[data-card-id="c1"]').boundingBox()).toEqual(before);
  const snap = await store(page, s => s.snapshot());
  expect(snap.cards.find(c => c.id === 'c1')!.fieldOptions['f-cost']).toBe('k2');
  expect(snap.placements.c1!.positions['f-cost']).toBe(0.9);                               // position not saved either
});
test('the card under the pointer comes to the front', async ({ page }) => { /* hovered card has the highest z-index among overlapping cards */ });
test('dragging works when zoomed in', async ({ page }) => { /* zoom to full, drag c1 by 60 px, saved position changed by 60 / (matrix width * zoom) within 0.005 */ });
```

- [ ] **Step 2: Run** `npx playwright test e2e/drag.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use pointer events with pointer capture. A drag moves the card by the pointer's travel from where the card started, so a purely horizontal drag leaves the Up position exactly as it was; an axis the card had no position on takes the pointer's own position. The drop zone is found from the pointer position: tray, left strip, bottom strip, otherwise matrix (a drop outside all of them cancels the drag). The card moves at once and stays until the writes settle. Error text: `"Couldn't save the move. <error message>"`. Toasts hide after 2.6 s.
- [ ] **Step 4: Run** `npx playwright test e2e/drag.spec.ts e2e/surface.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: drag cards between matrix, strips and tray"`

---

### Task 9: Toolbar, legend, saved view, empty states

**Files:**
- Create: `src/view/toolbar.ts`, `src/view/legend.ts`
- Modify: `src/view/app.ts`, `src/view/surface.ts`
- Test: `e2e/toolbar.spec.ts`

**Interfaces:**
- Consumes: `legendFor`, `colourOf`, store `loadView` and `saveView`.
- Produces test ids: `across`, `up` (selects), `swap`, `colour-by` (select; options "Label", "List", "Member", then one per dropdown field by name), `lists` (a button opening a checklist of open lists), `show-images` (checkbox), `legend`, `empty-hint`, `params` (button, wired in Task 10), `resequence` (button, wired in Task 11).
- Default view when none is saved: Across and Up are the first two parameters, no lists chosen, colour by label, images on, zoom 1.
- `saveView` is called at most once per 500 ms after any change to the view, including zoom and pan.

- [ ] **Step 1: Write the failing e2e tests**

```ts
test('first use: no lists chosen shows a hint, choosing lists shows cards', async ({ page }) => {      // Review Focus 5
  await page.goto('dev.html?fresh=1');                       // fresh=1: no saved view
  await expect(page.getByTestId('empty-hint')).toHaveText('Choose the lists to plot.');
  await expect(page.getByTestId('resequence')).toBeDisabled();
  await page.getByTestId('lists').click(); await page.getByLabel('Backlog').check();
  await expect(page.locator('[data-card-id="c1"]')).toBeVisible();
  await expect(page.locator('[data-card-id]')).toHaveCount(await store(page, s => s.snapshot().cards.filter(c => c.idList === 'l-backlog').length));
});
test('an empty chosen list and fewer than two parameters show hints', async ({ page }) => {             // Review Focus 5
  await page.goto('dev.html?fresh=1&lists=l-doing&emptyDoing=1');
  await expect(page.getByTestId('empty-hint')).toHaveText('No cards in the chosen lists.');
  await page.goto('dev.html?params=1');
  await expect(page.getByTestId('empty-hint')).toHaveText('Add at least two parameters to plot cards.');
});
test('changing an axis re-places the cards and resets the zoom', async ({ page }) => {
  await page.goto('dev.html'); await page.locator('[data-section="2-2"]').dblclick({ position: { x: 5, y: 5 } });
  await page.getByTestId('across').selectOption('f-ease');
  await expect(page.locator('[data-section]')).toHaveCount(6);
  await expect(page.getByTestId('zoom-label')).toContainText('100%');
  await expect(page.locator('[data-card-id="c1"]')).toHaveAttribute('data-zone', 'leftStrip');          // has Value, no Ease
  expect(await store(page, s => s.snapshot().placements.c1!.positions['f-cost'])).toBe(0.9);           // nothing lost
});
test('Swap axes exchanges them; the same parameter cannot be on both', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('swap').click();
  await expect(page.getByTestId('across')).toHaveValue('f-value'); await expect(page.getByTestId('up')).toHaveValue('f-cost');
  await expect(page.getByTestId('up').locator('option[value="f-value"]')).toBeDisabled();
});
test('colour by changes card colours and the legend', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('colour-by').selectOption({ label: 'List' });
  await expect(page.getByTestId('legend')).toContainText('Backlog'); await expect(page.getByTestId('legend')).not.toContainText('UXUI');
});
test('the view is restored on reload, per person', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('swap').click(); await page.getByTestId('show-images').uncheck();
  await page.locator('[data-section="0-0"]').dblclick({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(700); await page.reload();        // the dev page keeps the fake store's view in sessionStorage
  await expect(page.getByTestId('across')).toHaveValue('f-value'); await expect(page.getByTestId('show-images')).not.toBeChecked();
  await expect(page.getByTestId('zoom-label')).toContainText('282%');
});
test('a saved view naming a parameter or list that no longer exists falls back to defaults', async ({ page }) => { /* saved across 'gone' → first parameter; unknown list ids dropped */ });
test('a long title is cut off in a chip and shown in full on hover', async ({ page }) => { /* c4 at chip detail: text-overflow ellipsis, title attribute has the full name */ });
```

- [ ] **Step 2: Run** `npx playwright test e2e/toolbar.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Changing an axis animates cards to their new places over 400 ms and resets the viewport. The dev page persists the fake store's `saveView` to `sessionStorage`. Unless `fresh=1` or a view is already in `sessionStorage`, it seeds a saved view (Across `f-cost`, Up `f-value`, lists `l-backlog` and `l-ideas`) so the tests from Tasks 7 and 8 keep passing unchanged. It honours `fresh`, `lists`, `emptyDoing` (empties `l-doing`) and `params` (keeps only that many parameters) for these tests.
- [ ] **Step 4: Run** all e2e tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: axis, list and colour controls with saved view"`

---

### Task 10: Parameter setup

**Files:**
- Create: `src/view/parameter-dialog.ts`
- Modify: `src/view/app.ts`
- Test: `e2e/parameters.spec.ts`

**Interfaces:**
- Consumes: store `createParameter`, `linkParameter`, `renameParameter`, `renameLevel`, `removeParameter`; the `canRenameLevels` option of `mountMatrix` (Task 7); the dev page sets it from `?renameLevels=0`, and Task 14 passes `RENAME_OPTIONS`.
- Produces: dialog `[data-testid="param-dialog"]`, opened by `[data-testid="params"]` and automatically when fewer than two parameters exist. Inside: a row per parameter with name input, level inputs, "Remove" button; an "Add parameter" form with name, a "2 levels / 3 levels" choice, level name inputs prefilled "Low", "Medium", "High" (or "Low", "High"), and "Better end" radio buttons labelled with the first and last level names.

- [ ] **Step 1: Write the failing e2e tests**

```ts
test('add a 2-level parameter where the first level is better', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  const d = page.getByTestId('param-dialog');
  await d.getByLabel('Name').fill('Risk'); await d.getByLabel('2 levels').check();
  await d.getByLabel('Better end').getByLabel('Low').check(); await d.getByRole('button', { name: 'Add parameter' }).click();
  const p = await store(page, s => s.snapshot().parameters.find(p => p.name === 'Risk'));
  expect(p!.levels).toEqual(['High', 'Low']);
  await expect(page.getByTestId('across').locator('option', { hasText: 'Risk' })).toHaveCount(1);
});
test('a name that matches an existing dropdown field offers to link it', async ({ page }) => {
  await page.goto('dev.html?extraField=Effort:S,M,L'); await page.getByTestId('params').click();
  const d = page.getByTestId('param-dialog'); await d.getByLabel('Name').fill('Effort');
  await expect(d).toContainText('A field called "Effort" already exists. Link to it?');
  await d.getByLabel('Better end').getByLabel('S').check(); await d.getByRole('button', { name: 'Link' }).click();
  expect(await store(page, s => s.calls.at(-1)!.method)).toBe('linkParameter');
});
test('a matching field with more than 3 options cannot be linked', async ({ page }) => { /* name "Impacts" (6 options): message 'A field called "Impacts" exists but has 6 options. Choose another name.' and Add is disabled */ });
test('remove takes it off the matrix and leaves the field', async ({ page }) => { /* Remove on Ease, confirm text 'The field and its values stay on the cards.'; parameters lacks f-ease, dropdownFields has it; Across/Up no longer offer Ease */ });
test('removing a parameter that is on an axis moves that axis to another parameter', async ({ page }) => { /* remove Cost while Across is Cost → Across becomes Ease */ });
test('rename a parameter and a level', async ({ page }) => { /* store calls renameParameter('f-value','Benefit') and renameLevel('f-value', 2, 'Top'); axis label reads 'Benefit: Top' */ });
test('when level renaming is unavailable, level names are read-only with a note', async ({ page }) => {
  await page.goto('dev.html?renameLevels=0'); await page.getByTestId('params').click();
  await expect(page.getByTestId('param-dialog')).toContainText("Rename levels in Trello's Custom Fields editor.");
});
test('a store error is shown in the dialog and the dialog stays open', async ({ page }) => { /* failNext('createParameter', StoreError('limit', 'This board already has 50 custom fields.')) → that text is visible */ });
```

- [ ] **Step 2: Run** `npx playwright test e2e/parameters.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Level count cannot be changed for an existing parameter (no control for it). Read-only users do not see the `params` button.
- [ ] **Step 4: Run** all e2e tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: parameter setup dialog"`

---

### Task 11: Resequencing lists

**Files:**
- Create: `src/view/resequence-drawer.ts`
- Modify: `src/view/app.ts`
- Test: `e2e/resequence.spec.ts`

**Interfaces:**
- Consumes: `resequenceList` (Task 4), `locate`, store `reorderLists`, `undoReorder`, `BoardSnapshot.canUndoReorder`.
- Produces: drawer `[data-testid="reseq-drawer"]` with, per chosen list, a heading "List name (N cards)", the first 7 cards of the new order each with "was #K", then "…and M more"; buttons "Reorder in Trello" and "Cancel"; a progress line "Reordering… D of T"; and, when `canUndoReorder`, a button "Undo last reorder".

- [ ] **Step 1: Write the failing e2e tests**

```ts
test('preview shows the new order per list and changes nothing', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('resequence').click();
  const d = page.getByTestId('reseq-drawer');
  await expect(d).toContainText('using the two axes shown now (Value and Cost)');
  await expect(d.locator('h4')).toHaveText([/^Backlog \(\d+ cards\)$/, /^New Feature ideas \(\d+ cards\)$/]);
  await expect(d.locator('ol').first().locator('li').first()).toContainText('Fixture top right');
  expect(await store(page, s => s.calls.filter(c => c.method === 'reorderLists').length)).toBe(0);
  await d.getByRole('button', { name: 'Cancel' }).click(); await expect(d).toBeHidden();
});
test('Reorder in Trello applies the previewed order, with unplaced cards last in their old order', async ({ page }) => {
  await page.goto('dev.html'); const before = await store(page, s => listOrder(s.snapshot(), 'l-backlog'));
  await page.getByTestId('resequence').click(); await page.getByRole('button', { name: 'Reorder in Trello' }).click();
  await expect(page.getByTestId('toast')).toContainText('Backlog and New Feature ideas reordered.');
  const after = await store(page, s => listOrder(s.snapshot(), 'l-backlog'));
  expect(after[0]).toBe('c1'); expect(new Set(after)).toEqual(new Set(before));
  const unplaced = (ids: string[]) => ids.filter(id => id === 'c2' || id === 'c3');
  expect(after.slice(-unplaced(after).length)).toEqual(expect.arrayContaining(['c2', 'c3']));
  expect(unplaced(after)).toEqual(unplaced(before));
});
test('cards in lists that are not chosen are never touched', async ({ page }) => { /* l-doing order and pos identical before and after */ });
test('Undo last reorder restores the previous order', async ({ page }) => { /* after reorder: open drawer, click Undo last reorder → order equals before; button gone */ });
test('a failure part-way shows how far it got and Retry finishes the same order', async ({ page }) => {
  // the fake store, with ?reorderFailAfter=10, rejects once after 10 cards with StoreError('network', 'offline')
  await page.goto('dev.html?reorderFailAfter=10'); await page.getByTestId('resequence').click();
  await page.getByRole('button', { name: 'Reorder in Trello' }).click();
  await expect(page.getByTestId('reseq-drawer')).toContainText('Stopped after 10 of');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('toast')).toContainText('reordered.');
  expect((await store(page, s => listOrder(s.snapshot(), 'l-backlog')))[0]).toBe('c1');
});
test('the order is worked out again when Reorder is pressed, so a card added meanwhile is included', async ({ page }) => { /* store.remote adds a card to l-backlog while the drawer is open; after applying, the list contains it, at the bottom */ });
test('read-only users do not get the button', async ({ page }) => { await page.goto('dev.html?readonly=1'); await expect(page.getByTestId('resequence')).toBeHidden(); });
```

- [ ] **Step 2: Run** `npx playwright test e2e/resequence.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `reorderFailAfter` support to the fake store behind the dev page option. Undo after a retried reorder must return to the order from before the first attempt: the fake store keeps the previous positions from the first attempt when a reorder is retried (Task 14 mirrors this rule for Trello).
- [ ] **Step 4: Run** all e2e tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: resequence lists with preview, retry and undo"`

---

### Task 12: Opening cards, images, read-only, connecting, and the other person's changes

**Files:**
- Create: `src/view/connect-screen.ts`
- Modify: `src/view/app.ts`, `src/view/surface.ts`, `src/view/drag.ts`
- Test: `e2e/collab.spec.ts`

**Interfaces:**
- Consumes: store `isConnected`, `connect`, `openCard`, `coverImageUrl`, `subscribe`; `mountMatrix` option `focusCardId`.
- Produces: `[data-testid="connect"]` screen with the button "Connect to Trello"; cover images as `img[data-cover]` inside full cards.

- [ ] **Step 1: Write the failing e2e tests**

```ts
test('a click without a drag opens the real card, at any zoom', async ({ page }) => {
  await page.goto('dev.html'); await page.locator('[data-card-id="c1"]').click();
  expect(await store(page, s => s.calls.at(-1))).toEqual({ method: 'openCard', args: ['c1'] });
  expect(await store(page, s => s.calls.filter(c => c.method === 'savePositions').length)).toBe(0);
});
test('cover images load only for full cards in view, and Show images turns them off', async ({ page }) => {
  await page.goto('dev.html');
  expect(await store(page, s => s.calls.filter(c => c.method === 'coverImageUrl').length)).toBe(0);
  await zoomToFull(page, 'c1');
  await expect(page.locator('[data-card-id="c1"] img[data-cover]')).toBeVisible();
  const asked = await store(page, s => s.calls.filter(c => c.method === 'coverImageUrl').map(c => c.args[0]));
  expect(asked).toContain('c1'); expect(asked.length).toBeLessThan(15);
  await page.getByTestId('show-images').uncheck();
  await expect(page.locator('img[data-cover]')).toHaveCount(0);
});
test('a card whose image cannot be loaded shows no image and no error', async ({ page }) => { /* coverImageUrl resolves null → no img, no toast */ });
test('Show on matrix opens zoomed to that card', async ({ page }) => {
  await page.goto('dev.html?focus=c4');
  await expect(page.locator('[data-card-id="c4"]')).toHaveAttribute('data-detail', 'full');
  await expect(page.locator('[data-card-id="c4"]')).toBeInViewport();
});
test('focus on a card outside the chosen lists adds its list for this session', async ({ page }) => { /* focus a card in l-doing → it is visible; saved view listIds unchanged */ });
test('not connected: only the connect step shows, and connecting loads the matrix', async ({ page }) => {
  await page.goto('dev.html?connected=0');
  await expect(page.getByTestId('connect')).toBeVisible(); await expect(page.getByTestId('stage')).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect to Trello' }).click();
  await expect(page.locator('[data-card-id="c1"]')).toBeVisible();
});
test('declining to connect shows a message and keeps the connect step', async ({ page }) => { /* failNext('connect', StoreError('auth','declined')) → "Trello access is needed to save your changes." */ });
test('read-only: cards cannot be dragged, clicks still open cards', async ({ page }) => {
  await page.goto('dev.html?readonly=1'); const before = await page.locator('[data-card-id="c1"]').boundingBox();
  await dragCardBy(page, 'c1', -200, 100);
  expect(await page.locator('[data-card-id="c1"]').boundingBox()).toEqual(before);
  expect(await store(page, s => s.calls.some(c => c.method === 'savePositions' || c.method === 'setLevel'))).toBe(false);
});
test("the other person's move appears without reload", async ({ page }) => {
  await page.goto('dev.html'); const before = (await page.locator('[data-card-id="c4"]').boundingBox())!;
  await store(page, s => s.remote(b => { b.placements.c4!.positions['f-cost'] = 0.95; b.cards.find(c => c.id === 'c4')!.fieldOptions['f-cost'] = 'k2'; }));
  await expect.poll(async () => (await page.locator('[data-card-id="c4"]').boundingBox())!.x).toBeGreaterThan(before.x + 300);
});
test('a card being dragged is not moved by an incoming change until the drag ends', async ({ page }) => { /* mouse down on c1 and move; remote changes c1; card stays under the pointer; after mouse up the local drop is what the store holds */ });
test('a card archived by the other person mid-drag disappears and the drop is discarded', async ({ page }) => {   // Review Focus 4
  await page.goto('dev.html'); await startDrag(page, 'c1', -100, 0);
  await store(page, s => s.remote(b => { b.cards = b.cards.filter(c => c.id !== 'c1'); }));
  await page.mouse.up();
  await expect(page.locator('[data-card-id="c1"]')).toHaveCount(0);
  expect(await store(page, s => s.calls.some(c => c.args[0] === 'c1'))).toBe(false);
  await expect(page.getByTestId('toast')).toBeHidden();
});
test('a card moved to an unchosen list by the other person leaves the matrix', async ({ page }) => { /* remote sets c1.idList = 'l-doing' → c1 gone, section counts drop by one */ });
test("the other person's change does not move my view", async ({ page }) => { /* zoom in; remote change; zoom label unchanged */ });
```

- [ ] **Step 2: Run** `npx playwright test e2e/collab.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The dev page passes `?focus=<cardId>` as `focusCardId`. Images are requested through an `IntersectionObserver` on full cards and cached per card id for the session. On a snapshot from `subscribe`, re-render everything except the card being dragged; apply the held-back update when the drag ends. Before writing a drop, check the card is still in the latest snapshot and in a chosen list.
- [ ] **Step 4: Run** `npm test && npx playwright test`. Expected: PASS in both browsers.
- [ ] **Step 5: Commit** `git commit -m "feat: open cards, cover images, read-only mode and live updates"`

---

### Task 13: Trello storage codecs and REST client

Needs the results of Task 2 (`docs/proof-results.md`). Before starting, set `SYNC_MODE`, `COVER_MODE` and `RENAME_OPTIONS` in `src/config.ts` from P2, P5 and P7.

**Files:**
- Create: `src/trello/plugin-data.ts`, `src/trello/rest.ts`
- Test: `tests/trello/plugin-data.test.ts`, `tests/trello/rest.test.ts`

**Interfaces:**
- Consumes: `createPacer`, `StoreError`.
- Produces `src/trello/plugin-data.ts`:

```ts
export const KEY_PARAMS = 'params', KEY_CARD = 'mx', KEY_VIEW = 'view', KEY_REORDER = 'reorder';
export interface StoredParam { f: string; o: string[] }                          // field id; option ids worst → best
export interface StoredCard { p?: Record<string, number>; prev?: number; gen?: string }   // positions; list position before the last reorder; that reorder's id
export interface StoredReorder { gen: string; complete: boolean }
export function decodeParams(raw: unknown): StoredParam[];
export function decodeCard(raw: unknown): StoredCard;
export function encodeCard(c: StoredCard): StoredCard | null;                    // rounds to 3 decimals; null when nothing is left to store
export function decodeView(raw: unknown): ViewSettings | null;
export function joinParameters(stored: StoredParam[], fields: DropdownField[]): Parameter[];
export function assertFits(value: unknown): void;                                // throws StoreError('limit', ...) when JSON is longer than 4096
```

- Produces `src/trello/rest.ts`:

```ts
export interface Rest {
  createDropdownField(boardId: string, name: string, optionTexts: string[]): Promise<DropdownField>;
  renameField(fieldId: string, name: string): Promise<void>;
  renameOption(fieldId: string, optionId: string, text: string): Promise<void>;
  setFieldOption(cardId: string, fieldId: string, optionId: string | null): Promise<void>;
  setCardPos(cardId: string, pos: number): Promise<void>;
  boardState(boardId: string): Promise<unknown>;                                 // raw board JSON, used for polling
  imageObjectUrl(url: string): Promise<string | null>;
}
export function createRest(o: { key: string; getToken: () => Promise<string | null>; fetch: typeof fetch; pacer: Pacer; sleep: (ms: number) => Promise<void> }): Rest;
```

- [ ] **Step 1: Write the failing tests**

```ts
test('decodeCard drops anything that is not a position in range', () => {                 // Review Focus 2
  expect(decodeCard('junk')).toEqual({}); expect(decodeCard(null)).toEqual({});
  expect(decodeCard({ p: { a: 'x', b: 1.7, c: 0.5, d: -1, e: NaN }, prev: 'no' })).toEqual({ p: { c: 0.5 } });
});
test('encodeCard rounds and returns null when empty', () => {
  expect(encodeCard({ p: { a: 0.123456 } })).toEqual({ p: { a: 0.123 } }); expect(encodeCard({ p: {} })).toBeNull();
});
test('joinParameters drops parameters whose field or options are gone', () => {            // Review Focus 1
  const fields = [{ id: 'f1', name: 'Value', options: [{ id: 'a', text: 'Low', colour: 'none' }, { id: 'b', text: 'High', colour: 'none' }] }];
  expect(joinParameters([{ f: 'f1', o: ['b', 'a'] }, { f: 'gone', o: ['x', 'y'] }, { f: 'f1', o: ['a', 'zzz'] }], fields))
    .toEqual([{ id: 'f1', name: 'Value', levels: ['High', 'Low'], fieldId: 'f1', optionIds: ['b', 'a'] }]);
});
test('decodeView rejects malformed views', () => { expect(decodeView({ across: 5 })).toBeNull(); });
test('assertFits throws a limit error past 4096 characters', () => {
  expect(() => assertFits('x'.repeat(4095))).toThrow(expect.objectContaining({ kind: 'limit' })); expect(() => assertFits('x'.repeat(4000))).not.toThrow();
});
test('setFieldOption sets and clears with the documented bodies', async () => {
  const { rest, requests } = restWithFakeFetch();
  await rest.setFieldOption('card1', 'f1', 'opt1'); await rest.setFieldOption('card1', 'f1', null);
  expect(requests[0]).toMatchObject({ method: 'PUT', path: '/1/cards/card1/customField/f1/item', body: { idValue: 'opt1' } });
  expect(requests[1]!.body).toEqual({ idValue: '', value: '' });
  expect(requests[0]!.query).toMatchObject({ key: 'KEY', token: 'TOKEN' });
});
test('createDropdownField posts a list field shown on card fronts', async () => {
  const { rest, requests } = restWithFakeFetch();
  await rest.createDropdownField('board1', 'Value', ['Low', 'High']);
  expect(requests[0]).toMatchObject({ method: 'POST', path: '/1/customFields', body: { idModel: 'board1', modelType: 'board', name: 'Value', type: 'list', display_cardFront: true, options: [{ value: { text: 'Low' }, color: 'none', pos: 'bottom' }, { value: { text: 'High' }, color: 'none', pos: 'bottom' }] } });
});
test('HTTP errors map to StoreError kinds', async () => {
  for (const [status, kind] of [[401, 'auth'], [403, 'permission']] as const)
    await expect(restWithFakeFetch({ status }).rest.setCardPos('c', 1)).rejects.toMatchObject({ kind });
  await expect(restWithFakeFetch({ throws: true }).rest.setCardPos('c', 1)).rejects.toMatchObject({ kind: 'network' });
  await expect(restWithFakeFetch({ token: null }).rest.setCardPos('c', 1)).rejects.toMatchObject({ kind: 'auth' });
});
test('429 waits 10 s and retries, three times at most', async () => {
  const a = restWithFakeFetch({ statuses: [429, 429, 200] }); await a.rest.setCardPos('c', 1);
  expect(a.requests).toHaveLength(3); expect(a.slept).toEqual([10000, 10000]);
  await expect(restWithFakeFetch({ status: 429 }).rest.setCardPos('c', 1)).rejects.toMatchObject({ kind: 'rate-limit' });
});
test('the token never appears in an error message', async () => {
  await expect(restWithFakeFetch({ status: 500 }).rest.setCardPos('c', 1)).rejects.toSatisfy((e: Error) => !e.message.includes('TOKEN'));
});
```

- [ ] **Step 2: Run** `npx vitest run tests/trello`. Expected: FAIL.
- [ ] **Step 3: Implement.** Base URL `https://api.trello.com`. Other endpoints: `PUT /1/customFields/{id}` body `{ name }`; `PUT /1/customFields/{id}/options/{idOption}` body `{ value: { text } }`; `PUT /1/cards/{id}` with query `pos`; `GET /1/boards/{id}` with query `cards=open&card_fields=name,idList,pos,idLabels,idMembers,cover&card_customFieldItems=true&card_pluginData=true&lists=open&customFields=true&labels=all&members=all&pluginData=true`. Every call goes through the pacer. `imageObjectUrl` fetches with the `Authorization` header form recorded in P5 and returns `URL.createObjectURL(blob)`, or `null` on any failure. Use the request shapes that actually passed in `docs/proof-results.md` where they differ from this list, and note the difference in the commit message.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: Trello storage codecs and REST client"`

---

### Task 14: The Trello board store and the real matrix page

**Files:**
- Create: `src/trello/change-source.ts`, `src/trello/trello-store.ts`, `matrix.html`, `src/matrix-main.ts`
- Test: `tests/trello/trello-store.test.ts`, `tests/trello/change-source.test.ts`

**Interfaces:**
- Consumes: everything from Task 13, `BoardStore`, `positionsFor`, config constants, `mountMatrix`.
- Produces:

```ts
export function createChangeSource(mode: 'render' | 'poll', deps: { t: TrelloIframe; setInterval: typeof setInterval; clearInterval: typeof clearInterval; intervalMs?: number }): { subscribe(onTick: () => void): () => void };   // poll default 5000 ms
export function createTrelloStore(o: { t: TrelloIframe; rest: Rest; syncMode: 'render' | 'poll'; coverMode: 'img' | 'fetch' | 'off'; newId: () => string }): BoardStore;
```

- Storage layout: parameters in `t.set('board', 'shared', KEY_PARAMS, StoredParam[])`; per card `t.set(cardId, 'shared', KEY_CARD, StoredCard)`; view in `t.set('board', 'private', KEY_VIEW, ViewSettings)`; reorder marker in `t.set('board', 'shared', KEY_REORDER, StoredReorder)`.

- [ ] **Step 1: Write the failing tests** with a fake `t` (in-memory plugin data keyed by scope, canned `cards`, `lists`, `board`, `getContext`) and a recording fake `Rest`.

```ts
test('load joins Trello data into a snapshot', async () => {
  const s = await store.load();
  expect(s.parameters.map(p => p.name)).toEqual(['Value', 'Cost']);
  expect(s.cards[0]).toEqual({ id: 'c1', name: 'One', idList: 'l1', pos: 100, labelIds: ['lab1'], memberIds: ['m1'], hasCover: true, fieldOptions: { f1: 'optHigh' } });
  expect(s.placements.c1).toEqual({ positions: { f1: 0.9 } });
  expect(s.canEdit).toBe(true);                               // t.getContext().permissions.board === 'write'
});
test('savePositions merges into the card data and removes nulls', async () => {
  await store.savePositions('c1', { f1: 0.25, f2: null });
  expect(t.data('c1', 'shared', KEY_CARD)).toEqual({ p: { f1: 0.25 } });
});
test('savePositions keeps prev and gen that are already stored', async () => { /* card has {p:{f1:.9}, prev: 500, gen:'g1'} → after save prev and gen unchanged */ });
test('setLevel maps the level to the option id, null clears', async () => {
  await store.setLevel('c1', value, 0); await store.setLevel('c1', value, null);
  expect(rest.calls).toEqual([['setFieldOption', 'c1', 'f1', 'optLow'], ['setFieldOption', 'c1', 'f1', null]]);
});
test('createParameter creates the field in typed order and stores options worst to best', async () => {
  const p = await store.createParameter({ name: 'Risk', levels: ['Low', 'High'], bestEnd: 'first' });
  expect(rest.calls[0]).toEqual(['createDropdownField', 'board1', 'Risk', ['Low', 'High']]);
  expect(p.levels).toEqual(['High', 'Low']);
  expect(t.data('board', 'shared', KEY_PARAMS).at(-1)).toEqual({ f: p.fieldId, o: [...p.optionIds] });
});
test('removeParameter only forgets it', async () => { await store.removeParameter('f1'); expect(rest.calls).toEqual([]); expect(t.data('board', 'shared', KEY_PARAMS).some((p: StoredParam) => p.f === 'f1')).toBe(false); });
test('reorderLists saves each previous position once, then sets positions in order', async () => {
  await store.reorderLists([{ listId: 'l1', cardIds: ['c2', 'c1'] }], () => {});
  expect(t.data('c1', 'shared', KEY_CARD)).toMatchObject({ prev: 100, gen: 'gen-1' });
  expect(rest.calls).toEqual([['setCardPos', 'c2', 16384], ['setCardPos', 'c1', 32768]]);
  expect(t.data('board', 'shared', KEY_REORDER)).toEqual({ gen: 'gen-1', complete: true });
});
test('a reorder that failed part-way is resumed under the same id and does not overwrite saved positions', async () => {
  rest.failOn('setCardPos', 2);                               // second call rejects
  await expect(store.reorderLists([{ listId: 'l1', cardIds: ['c2', 'c1'] }], () => {})).rejects.toBeTruthy();
  expect(t.data('board', 'shared', KEY_REORDER)).toEqual({ gen: 'gen-1', complete: false });
  await store.reorderLists([{ listId: 'l1', cardIds: ['c2', 'c1'] }], () => {});
  expect(t.data('c2', 'shared', KEY_CARD)).toMatchObject({ prev: 200, gen: 'gen-1' });   // the original position, not 16384
});
test('undoReorder restores cards of the current reorder only, then clears the marker', async () => { /* cards with gen 'old' untouched; setCardPos called with each prev; KEY_REORDER removed; canUndoReorder false */ });
test('coverImageUrl follows the cover mode', async () => { /* 'off' → null without any call; 'img' → the cover preview URL; 'fetch' → rest.imageObjectUrl(url) */ });
test('a plugin-data write over the limit rejects with a limit error', async () => { /* t.set rejects with "PluginData length of 4096 characters exceeded" → StoreError kind 'limit' */ });
test('subscribe reloads on each tick and stops after unsubscribe', async () => { /* change source tick → onChange(snapshot); none after unsubscribe */ });
test('poll mode builds the snapshot from one board request', async () => { /* syncMode 'poll': a tick calls rest.boardState once and no t.get per card */ });
test('change source: render mode registers t.render; poll mode ticks every 5000 ms', () => { /* tests/trello/change-source.test.ts */ });
```

- [ ] **Step 2: Run** `npx vitest run tests/trello`. Expected: FAIL.
- [ ] **Step 3: Implement.** `load` in render mode reads `t.cards('id','name','idList','pos','labels','members','cover','customFieldItems')`, `t.lists('id','name')`, `t.board('id','labels','customFields','members')` and each card's `KEY_CARD` with `Promise.all`. Dropdown fields are custom fields of type `list`. `isConnected` is `t.getRestApi().isAuthorized()`; `connect` is `authorize({ scope: 'read,write', expiration: 'never' })`, mapping a refusal to `StoreError('auth', ...)`. `openCard` is `t.showCard`. `canUndoReorder` is true when `KEY_REORDER` exists. `newId` supplies reorder ids. In poll mode the snapshot is built from `rest.boardState`: there cards carry `idLabels`, `idMembers`, `customFieldItems` and a `pluginData` array whose entries hold this Power-Up's data as a JSON string in `value`; keep only entries whose `idPlugin` is this Power-Up's id (`t.getContext().plugin`). Both paths must produce equal snapshots for the same board, and one test asserts that.
- [ ] **Step 4: Implement `matrix.html` and `src/matrix-main.ts`**: `const t = TrelloPowerUp.iframe({ appKey: APP_KEY, appName: APP_NAME })`, build the pacer (`maxPerWindow: 80, windowMs: 10000`), `Rest` and store, then `mountMatrix(document.getElementById('app')!, store, { focusCardId: t.arg('focusCardId'), canRenameLevels: RENAME_OPTIONS })`.
- [ ] **Step 5: Run** `npm test && npx playwright test && npm run build`. Expected: PASS; `dist/matrix.html` exists.
- [ ] **Step 6: Commit and push** `git commit -m "feat: Trello board store and matrix page" && git push`

---

### Task 15: Live acceptance on the test board

**Files:**
- Create: `docs/acceptance.md`
- Modify: `docs/setup.md` (set repository variable `PROOF` to `0` for normal use)

**Interfaces:**
- Consumes: the deployed site and the test board from Task 2.

- [ ] **Step 1: Write `docs/acceptance.md`**, a checklist Mike and his collaborator run on the test board in Chrome and Safari. One line per spec goal (section 2), each with the action and what must be seen:
  1. Open "Matrix" from the board button; connect once; choose lists.
  2. Create parameters Value (better end High), Cost (better end Low), Ease (2 levels); check three dropdown fields appear on the board.
  3. Drag a tray card onto the matrix; open the card in Trello; both fields show the right level.
  4. Move a card inside a section; the card's fields are unchanged. Reload; the card is in the same spot.
  5. Swap Across to Ease; cards line up in the left strip at their Value heights; swap back; nothing moved.
  6. Change Value by hand on a card in Trello; the matrix redraws it in that section.
  7. Zoom from whole matrix to a full card and back; it is smooth; a cover image shows; "Show images" hides it.
  8. Click a card; the real card opens; "Show on matrix" on the card returns zoomed to it.
  9. Colour by label, by the Impacts field, by list and by member.
  10. Person B moves a card; person A sees it within 5 seconds without reloading.
  11. "Resequence lists…" preview, then "Reorder in Trello"; the Trello lists are in the previewed order; "Undo last reorder" restores them.
  12. A board observer opens the matrix and cannot move cards.
- [ ] **Step 2: Verify the build that is live** is the latest commit: the deployed `matrix.html` references the same asset hashes as a local `npm run build` of `main`.
- [ ] **Step 3: Hand the checklist to Mike** with the test-board address. Record his results in `docs/acceptance.md`. Fix any failures as new commits with a test that pins each one, and re-run the affected lines.
- [ ] **Step 4: Commit and push** `git commit -m "docs: live acceptance checklist and results" && git push`
- [ ] **Step 5: Tell Mike it is ready for the real board**, and what that takes: enable the Power-Up on `67-Pass-Play-Teamwork` and add the collaborator to the board. Do not enable it yourself.
