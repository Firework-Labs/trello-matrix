import { expect, test } from 'vitest';
import { createPacer } from '../../src/model/pacer';

/** A clock whose sleep advances time instantly, so no real timers run. */
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

test('pacer never starts more than maxPerWindow calls in any window', async () => {
  const clock = fakeClock();
  const pacer = createPacer({ maxPerWindow: 3, windowMs: 1000, ...clock });
  const starts: number[] = [];
  await Promise.all(Array.from({ length: 7 }, () => pacer.run(async () => { starts.push(clock.now()); })));
  expect(starts).toEqual([0, 0, 0, 1000, 1000, 1000, 2000]);
});
test('pacer passes results and rejections through, in call order', async () => {
  const clock = fakeClock();
  const pacer = createPacer({ maxPerWindow: 3, windowMs: 1000, ...clock });
  const first = pacer.run(async () => 'one');
  const failing = pacer.run(async (): Promise<string> => { throw new Error('boom'); });
  const third = pacer.run(async () => 'three');
  await expect(first).resolves.toBe('one');
  await expect(failing).rejects.toThrow('boom');
  await expect(third).resolves.toBe('three');
});

/** Lets everything that can run without a timer run: calls that are able to start have started. */
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test('pacer starts a call only after the one before it has settled', async () => {
  const pacer = createPacer({ maxPerWindow: 100, windowMs: 1000, ...fakeClock() });   // the window never limits here
  const log: string[] = [];
  let releaseFirst!: () => void;
  const gate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const first = pacer.run(async () => { log.push('start 1'); await gate; log.push('end 1'); });
  const second = pacer.run(async () => { log.push('start 2'); log.push('end 2'); });
  const third = pacer.run(async () => { log.push('start 3'); log.push('end 3'); });
  await settle();
  expect(log).toEqual(['start 1']);                                   // the second has not started while the first is still running
  releaseFirst();
  await Promise.all([first, second, third]);
  expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
});
test('pacer starts the next call, in arrival order, after one that rejected', async () => {
  const pacer = createPacer({ maxPerWindow: 100, windowMs: 1000, ...fakeClock() });
  const log: string[] = [];
  let failFirst!: (e: Error) => void;
  const gate = new Promise<void>((_, reject) => { failFirst = reject; });
  const first = pacer.run(async () => { log.push('start 1'); await gate; log.push('end 1'); });
  const second = pacer.run(async () => { log.push('start 2'); log.push('end 2'); });
  const third = pacer.run(async () => { log.push('start 3'); log.push('end 3'); });
  await settle();
  expect(log).toEqual(['start 1']);
  failFirst(new Error('first failed'));
  await expect(first).rejects.toThrow('first failed');
  await Promise.all([second, third]);
  expect(log).toEqual(['start 1', 'start 2', 'end 2', 'start 3', 'end 3']);
});
test('createPacer throws a RangeError for a limit or a window that cannot work', () => {
  const clock = fakeClock();
  for (const maxPerWindow of [0, 0.5, -1, NaN, Infinity]) {
    expect(() => createPacer({ maxPerWindow, windowMs: 1000, ...clock })).toThrow(RangeError);
  }
  for (const windowMs of [0, -5, NaN, Infinity]) {
    expect(() => createPacer({ maxPerWindow: 3, windowMs, ...clock })).toThrow(RangeError);
  }
  expect(() => createPacer({ maxPerWindow: 1, windowMs: 1, ...clock })).not.toThrow();
});
