// Keeps the results table across page reloads and reopening in the same browser tab,
// so "Copy results" holds every check, not just the ones run since the last load.
import type { CheckResult } from './checks';

const KEY = 'mxproof.results';

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
