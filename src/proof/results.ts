// Keeps the results table across page reloads and reopening in the same browser tab,
// so "Copy results" holds every check, not just the ones run since the last load.
import { RUN_ORDER } from './checks';
import type { CheckResult, RestHost } from './checks';

const KEY = 'mxproof.results';
const HOST_KEY = 'mxproof.host';
const DEFAULT_HOST: RestHost = 'https://trello.com';

export interface ResultStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function saveResults(storage: ResultStorage | undefined, results: Iterable<CheckResult>): void {
  try { storage?.setItem(KEY, JSON.stringify([...results])); } catch { /* storage full or blocked: carry on without it */ }
}

export function loadResults(storage: ResultStorage | undefined): CheckResult[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is CheckResult =>
      !!r && typeof r.id === 'string' && typeof r.title === 'string' && typeof r.detail === 'string' && ['pass', 'fail', 'manual'].includes(r.status));
  } catch {
    return [];
  }
}

/** The REST host an earlier P3 found in this tab, or null when none did. */
export function savedHost(storage: ResultStorage | undefined): RestHost | null {
  try {
    const value = storage?.getItem(HOST_KEY);
    return value === 'https://api.trello.com' || value === 'https://trello.com' ? value : null;
  } catch {
    return null;
  }
}

/** The REST host to use: the one P3 found in this tab; trello.com until P3 has found one. */
export function loadHost(storage: ResultStorage | undefined): RestHost {
  return savedHost(storage) ?? DEFAULT_HOST;
}

export function saveHost(storage: ResultStorage | undefined, host: RestHost): void {
  try { storage?.setItem(HOST_KEY, host); } catch { /* carry on without it */ }
}

/** A copy of the results in run order; an id the page does not know goes last. */
export function inRunOrder(results: Iterable<CheckResult>): CheckResult[] {
  const rank = (id: string) => { const i = RUN_ORDER.indexOf(id); return i < 0 ? RUN_ORDER.length : i; };
  return [...results].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

/** The text "Copy results" copies. It never holds a token: nothing here is given one. */
export function buildReport(r: { browser: string; at: string; restHost: RestHost; results: CheckResult[] }): string {
  return JSON.stringify({ auth: 'oauth2', restHost: r.restHost, browser: r.browser, at: r.at, results: inRunOrder(r.results) }, null, 2);
}
