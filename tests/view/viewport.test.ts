import { describe, expect, test } from 'vitest';
import { clampPan, detailOf, fitSection, toModel, toScreen, zoomAt } from '../../src/view/viewport';

const s = { w: 900, h: 600 };

describe('viewport', () => {
  test('detail thresholds', () => {
    expect([1, 1.69, 1.7, 3.39, 3.4, 9].map(detailOf)).toEqual(['dot', 'dot', 'chip', 'chip', 'full', 'full']);
  });

  test('toScreen puts the best corner at the top right, and toModel inverts it', () => {
    expect(toScreen(1, 1, { zoom: 1, panX: 0, panY: 0 }, s)).toEqual({ left: 900, top: 0 });
    const vp = { zoom: 2.5, panX: -300, panY: -120 };
    const p = toScreen(0.3, 0.7, vp, s);
    const m = toModel(p.left, p.top, vp, s);
    expect(m.x).toBeCloseTo(0.3, 9);
    expect(m.y).toBeCloseTo(0.7, 9);
  });

  test('zoomAt keeps the pointed-at spot still and respects the limits', () => {
    const vp = zoomAt({ zoom: 1, panX: 0, panY: 0 }, 2, 450, 300, s);
    expect(vp).toEqual({ zoom: 2, panX: -450, panY: -300 });
    expect(zoomAt(vp, 100, 0, 0, s).zoom).toBe(9);
    expect(zoomAt(vp, 0.001, 0, 0, s)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  test('zoomAt keeps the point under an off-centre pointer fixed', () => {
    const before = { zoom: 2, panX: -400, panY: -200 };
    const at = toModel(700, 150, before, s);
    const after = zoomAt(before, 1.5, 700, 150, s);
    const p = toScreen(at.x, at.y, after, s);
    expect(p.left).toBeCloseTo(700, 6);
    expect(p.top).toBeCloseTo(150, 6);
  });

  test('clampPan keeps at least half the stage on the matrix, and zoom 1 pins the pan to 0', () => {
    expect(clampPan({ zoom: 1, panX: 80, panY: -40 }, s)).toEqual({ zoom: 1, panX: 0, panY: 0 });
    // zoom 2: the matrix is 1800 by 1200, so pan may run from half-stage minus size to half-stage
    expect(clampPan({ zoom: 2, panX: 5000, panY: 5000 }, s)).toEqual({ zoom: 2, panX: 450, panY: 300 });
    expect(clampPan({ zoom: 2, panX: -5000, panY: -5000 }, s)).toEqual({ zoom: 2, panX: -1350, panY: -900 });
    expect(clampPan({ zoom: 2, panX: -100, panY: -100 }, s)).toEqual({ zoom: 2, panX: -100, panY: -100 });
  });

  test('fitSection centres the section', () => {
    const vp = fitSection(2, 2, 3, 3, s);                      // top-right section of a 3 by 3
    expect(vp.zoom).toBeCloseTo(2.82, 6);
    expect(toScreen(5 / 6, 5 / 6, vp, s)).toEqual({ left: expect.closeTo(450, 3), top: expect.closeTo(300, 3) });
  });

  test('fitSection works for a 2 by 3 grid and the bottom-left section', () => {
    const vp = fitSection(0, 0, 2, 3, s);
    expect(vp.zoom).toBeCloseTo(1.88, 6);                       // min(2, 3) * 0.94
    expect(toScreen(1 / 4, 1 / 6, vp, s)).toEqual({ left: expect.closeTo(450, 3), top: expect.closeTo(300, 3) });
  });
});
