import { CLIENT_ID, REDIRECT_URI } from '../config';
import { createAuth } from '../trello/auth';
import { RUN_ORDER, checks, p3AfterReload, p4Closed, p4Survived, writeCheckIds, writePing } from './checks';
import type { CheckDeps, CheckResult } from './checks';
import { buildReport, inRunOrder, loadHost, savedHost, loadResults, saveHost, saveResults } from './results';

const storage = (() => { try { return window.sessionStorage; } catch { return undefined; } })();
const t = TrelloPowerUp.iframe({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
const deps: CheckDeps = {
  t,
  auth: createAuth(t),
  fetch: (...args) => window.fetch(...args),
  host: { get: () => loadHost(storage), saved: () => savedHost(storage), set: host => saveHost(storage, host) },   // kept in this tab, with the saved results
  now: () => Date.now(),
};
const results = new Map<string, CheckResult>(loadResults(storage).map(r => [r.id, r]));
const writeButtons: HTMLButtonElement[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const resultsBody = el('tbody');

const RUNNING = 'Running…';

function renderResults() {
  resultsBody.replaceChildren(
    ...inRunOrder(results.values()).map(r =>
      el('tr', {}, el('td', {}, r.id), el('td', {}, r.title), el('td', { className: r.status }, r.status),
        el('td', {}, r.detail), el('td', {}, r.ms === undefined ? '' : String(r.ms)))),
  );
}

function show(result: CheckResult) {
  results.set(result.id, result);
  saveResults(storage, [...results.values()].filter(r => r.detail !== RUNNING));
  renderResults();
}

const testBoard = el('input', { type: 'checkbox', id: 'testboard' });
testBoard.addEventListener('change', () => { for (const b of writeButtons) b.disabled = !testBoard.checked; });

function runButton(id: string, run: () => Promise<void>, writes: boolean) {
  const button = el('button', { textContent: 'Run' });
  button.disabled = writes;
  if (writes) writeButtons.push(button);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await run(); } finally { button.disabled = writes && !testBoard.checked; }
  });
  return button;
}

const PING_LABEL = 'Write ping (press in the other window)';
const inRunOrderChecks = RUN_ORDER.map(id => checks.find(c => c.id === id)!);

const checkRows = inRunOrderChecks.map((c, i) => {
  const actions: HTMLElement[] = [runButton(c.id, async () => {
    show({ id: c.id, title: c.title, status: 'manual', detail: RUNNING });
    show(await c.run(deps));
  }, writeCheckIds.includes(c.id))];
  if (c.id === 'P2') {
    const ping = el('button', { textContent: PING_LABEL });
    ping.disabled = true;
    writeButtons.push(ping);
    ping.addEventListener('click', async () => {
      try { await writePing(deps); ping.textContent = 'Ping written'; } catch (e) { ping.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`; }
    });
    actions.push(ping);
  }
  const note = c.needsClick ? ' (press this yourself)' : '';
  return el('tr', {}, el('td', {}, `${i + 1}. ${c.id}`),
    el('td', {}, c.title, el('span', { className: 'note', textContent: note }), el('div', { className: 'note', textContent: c.instruction })),
    el('td', {}, ...actions));
});

const copyBox = el('textarea', { readOnly: true, hidden: true });
const copyButton = el('button', { textContent: 'Copy results' });
copyButton.addEventListener('click', async () => {
  // The results never contain the access token; nothing here reads it.
  const json = buildReport({ browser: navigator.userAgent, at: new Date().toISOString(), restHost: deps.host.get(), results: [...results.values()] });
  copyBox.value = json;
  copyBox.hidden = false;
  copyBox.select();
  try { await navigator.clipboard.writeText(json); copyButton.textContent = 'Copied'; } catch { copyButton.textContent = 'Copy failed: select the text below and copy it'; }
});

document.getElementById('app')!.append(
  el('h1', {}, 'Matrix checks'),
  el('p', {}, 'These checks find out what Trello allows. Follow the script you were sent. The results stay in this browser tab until it is closed, and are sent nowhere.'),
  ...(CLIENT_ID ? [] : [el('p', { className: 'fail' }, 'This page was built without a Trello client ID, so sign-in (P3) will fail. See docs/setup.md, Part 3.')]),
  el('p', {}, 'Run the checks from top to bottom.'),
  el('label', {}, testBoard, ' This is a test board'),
  el('p', { className: 'note' }, 'The checks that write to the board stay switched off until you tick the box.'),
  el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Step and check'), el('th', {}, 'What it finds out'), el('th', {}, ''))), el('tbody', {}, ...checkRows)),
  el('h2', {}, 'Results'),
  el('table', {}, el('thead', {}, el('tr', {}, ...['Check', 'Title', 'Result', 'Detail', 'ms'].map(h => el('th', {}, h)))), resultsBody),
  copyButton,
  copyBox,
);

renderResults(); // results kept from before a reload
// Things that happen on their own: after a reload (P3, P4) and when focus returns (P4).
const closed = p4Closed();
if (closed) show(closed);
void p3AfterReload(deps).then(r => { if (r) show(r); });
window.addEventListener('focus', () => { const r = p4Survived(); if (r) show(r); });
