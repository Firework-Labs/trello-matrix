import { expect, test } from 'vitest';
import { buildReport, loadHost, loadResults, saveHost, saveResults } from '../../src/proof/results';
import type { CheckResult } from '../../src/proof/checks';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};
const row = (id: string): CheckResult => ({ id, title: `title ${id}`, status: 'pass', detail: 'ok', ms: 5 });

test('results saved by one page are loaded by the next page in the same tab', () => {
  const tab = memory();
  saveResults(tab, [row('P1'), row('P3')]);
  expect(loadResults(tab).map(r => r.id)).toEqual(['P1', 'P3']);
});
test('a new tab starts with nothing', () => { expect(loadResults(memory())).toEqual([]); });
test('junk or missing storage gives an empty list rather than an error', () => {
  const tab = memory();
  tab.setItem('mxproof.results', '{not json');
  expect(loadResults(tab)).toEqual([]);
  tab.setItem('mxproof.results', JSON.stringify([row('P1'), { id: 5 }, null]));
  expect(loadResults(tab).map(r => r.id)).toEqual(['P1']);
  expect(loadResults(undefined)).toEqual([]);
  expect(() => saveResults(undefined, [row('P1')])).not.toThrow();
});

test('the REST host P3 found is kept in the tab, and only a known host is accepted', () => {
  const tab = memory();
  expect(loadHost(tab)).toBe('https://trello.com');           // P3 has not run
  saveHost(tab, 'https://api.trello.com');
  expect(loadHost(tab)).toBe('https://api.trello.com');
  tab.setItem('mxproof.host', 'https://evil.example');
  expect(loadHost(tab)).toBe('https://trello.com');
  expect(loadHost(undefined)).toBe('https://trello.com');
  expect(() => saveHost(undefined, 'https://trello.com')).not.toThrow();
});
test('the copied report says which authorisation and which REST host were used', () => {
  const report = JSON.parse(buildReport({ browser: 'UA', at: '2026-11-16T00:00:00.000Z', restHost: 'https://trello.com', results: [row('P1')] }));
  expect(report).toEqual({ auth: 'oauth2', restHost: 'https://trello.com', browser: 'UA', at: '2026-11-16T00:00:00.000Z', results: [row('P1')] });
});
