/** Zoom and pan of the matrix. Pure arithmetic, no DOM. */

export interface Viewport { zoom: number; panX: number; panY: number }   // zoom 1: whole matrix fills the stage
export interface Size { w: number; h: number }                           // the matrix area at zoom 1, in px

export const MIN_ZOOM = 1, MAX_ZOOM = 9, CHIP_ZOOM = 1.7, FULL_ZOOM = 3.4;

export type Detail = 'dot' | 'chip' | 'full';

export function detailOf(zoom: number): Detail {
  return zoom >= FULL_ZOOM ? 'full' : zoom >= CHIP_ZOOM ? 'chip' : 'dot';
}

/** Pixels from the top-left of the matrix area. A model y of 1 is the top. */
export function toScreen(x: number, y: number, vp: Viewport, s: Size): { left: number; top: number } {
  return { left: vp.panX + x * s.w * vp.zoom, top: vp.panY + (1 - y) * s.h * vp.zoom };
}

export function toModel(left: number, top: number, vp: Viewport, s: Size): { x: number; y: number } {
  return { x: (left - vp.panX) / (s.w * vp.zoom), y: 1 - (top - vp.panY) / (s.h * vp.zoom) };
}

/** Keep at least half the stage showing matrix; at zoom 1 the matrix exactly fills it. */
export function clampPan(vp: Viewport, s: Size): Viewport {
  if (vp.zoom <= MIN_ZOOM) return { zoom: vp.zoom, panX: 0, panY: 0 };
  const panX = Math.min(s.w * 0.5, Math.max(vp.panX, s.w * 0.5 - s.w * vp.zoom));
  const panY = Math.min(s.h * 0.5, Math.max(vp.panY, s.h * 0.5 - s.h * vp.zoom));
  return { zoom: vp.zoom, panX, panY };
}

/** Zoom by `factor` (within the limits) so the point (px, py) of the matrix area stays under the pointer. */
export function zoomAt(vp: Viewport, factor: number, px: number, py: number, s: Size): Viewport {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor));
  const ratio = zoom / vp.zoom;
  return clampPan({ zoom, panX: px - (px - vp.panX) * ratio, panY: py - (py - vp.panY) * ratio }, s);
}

/** Fill the stage with one section: i counts from the left, j from the bottom. */
export function fitSection(i: number, j: number, nx: number, ny: number, s: Size): Viewport {
  const zoom = Math.min(nx, ny) * 0.94;
  const x = (i + 0.5) / nx, y = (j + 0.5) / ny;
  return { zoom, panX: s.w / 2 - x * s.w * zoom, panY: s.h / 2 - (1 - y) * s.h * zoom };
}
