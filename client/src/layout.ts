import type { WidgetRec } from '../../shared/src/types.ts';

export const COLS = 12;

/** Top-most, then left-most position where a w×h widget fits without overlapping others. */
export function findFreeSlot(widgets: Pick<WidgetRec, 'x' | 'y' | 'w' | 'h'>[], w: number, h: number): { x: number; y: number } {
  const overlaps = (x: number, y: number) =>
    widgets.some((o) => x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h);
  const bottom = widgets.reduce((max, o) => Math.max(max, o.y + o.h), 0);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + w <= COLS; x++) {
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}
