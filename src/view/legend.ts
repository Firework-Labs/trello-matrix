import { legendFor } from '../model/colour';
import type { BoardSnapshot, Card, ColourBy } from '../model/types';

/** The strip under the matrix that says what each card colour means. */
export interface Legend {
  el: HTMLElement;
  /** Shows the colours in use by these cards; does nothing when none of the inputs is a new object. */
  update(cards: Card[], colourBy: ColourBy, snapshot: BoardSnapshot): void;
}

export function createLegend(): Legend {
  const el = document.createElement('div');
  el.className = 'mm-legend';
  el.dataset.testid = 'legend';
  el.hidden = true;

  let shown: [Card[], ColourBy, BoardSnapshot] | null = null;

  function update(cards: Card[], colourBy: ColourBy, snapshot: BoardSnapshot): void {
    if (shown && shown[0] === cards && shown[1] === colourBy && shown[2] === snapshot) return;
    shown = [cards, colourBy, snapshot];
    const entries = legendFor(cards, colourBy, snapshot);
    el.replaceChildren(...entries.map(entry => {
      const item = document.createElement('span');
      item.className = 'mm-legend-item';
      const dot = document.createElement('i');
      dot.style.setProperty('--c', entry.colour);
      item.append(dot, entry.label);
      return item;
    }));
    el.hidden = entries.length === 0;
  }

  return { el, update };
}
