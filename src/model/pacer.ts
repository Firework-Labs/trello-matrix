export interface Pacer { run<T>(fn: () => Promise<T>): Promise<T> }

/**
 * Runs calls one after another, in arrival order: each starts only after the previous
 * one has settled. Never starts more than maxPerWindow calls within any windowMs span.
 * Time comes only from the injected now() and sleep(), so tests need no real timers.
 */
export function createPacer(o: {
  maxPerWindow: number; windowMs: number; now: () => number; sleep: (ms: number) => Promise<void>;
}): Pacer {
  const recentStarts: number[] = [];   // ascending start times still inside the window
  let previous: Promise<unknown> = Promise.resolve();

  async function admit(): Promise<void> {
    for (;;) {
      const t = o.now();
      while (recentStarts.length > 0 && t - recentStarts[0]! >= o.windowMs) recentStarts.shift();
      if (recentStarts.length < o.maxPerWindow) {
        recentStarts.push(t);
        return;
      }
      await o.sleep(recentStarts[0]! + o.windowMs - t);
    }
  }

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = previous.then(async () => {
        await admit();
        return fn();
      });
      previous = result.catch(() => undefined);   // a rejection is the caller's, not the queue's
      return result;
    },
  };
}
