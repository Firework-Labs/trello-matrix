// Keeps the results table across page reloads and reopening in the same browser tab,
// so "Copy results" holds every check, not just the ones run since the last load.
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

/** The REST host P3 found in this tab; trello.com until P3 has found one. */
export function loadHost(storage: ResultStorage | undefined): RestHost {
  try {
    const value = storage?.getItem(HOST_KEY);
    return value === 'https://api.trello.com' || value === 'https://trello.com' ? value : DEFAULT_HOST;
  } catch {
    return DEFAULT_HOST;
  }
}

export function saveHost(storage: ResultStorage | undefined, host: RestHost): void {
  try { storage?.setItem(HOST_KEY, host); } catch { /* carry on without it */ }
}

/** The text "Copy results" copies. It never holds a token: nothing here is given one. */
export function buildReport(r: { browser: string; at: string; restHost: RestHost; results: CheckResult[] }): string {
  return JSON.stringify({ auth: 'oauth2', restHost: r.restHost, browser: r.browser, at: r.at, results: r.results }, null, 2);
}
