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
