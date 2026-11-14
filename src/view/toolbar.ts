import type { ColourBy, DropdownField, List, ParamId, Parameter } from '../model/types';

/** What the toolbar shows. The toolbar holds no state of its own: every change goes out as a callback and comes back as a new model. */
export interface ToolbarModel {
  parameters: Parameter[];
  lists: List[];
  dropdownFields: DropdownField[];
  across: ParamId | null;
  up: ParamId | null;
  listIds: string[];
  colourBy: ColourBy;
  showImages: boolean;
  /** False for a person who cannot change the board: they do not see the parameters or resequence buttons. */
  canEdit: boolean;
  /** False when there is nothing to plot, so there is nothing to put in a new order. */
  canResequence: boolean;
}

export interface ToolbarHandlers {
  onAcross(id: ParamId): void;
  onUp(id: ParamId): void;
  onSwap(): void;
  onLists(listIds: string[]): void;
  onColourBy(by: ColourBy): void;
  onShowImages(show: boolean): void;
  onParams(): void;
  onResequence(): void;
  onWholeMatrix(): void;
}

export interface Toolbar {
  el: HTMLElement;
  update(model: ToolbarModel): void;
  setZoomText(text: string): void;
  /** Puts the keyboard focus on the parameters button (where it returns when the dialog closes). */
  focusParams(): void;
  /** Puts the keyboard focus on the resequence button (where it returns when the drawer closes). */
  focusResequence(): void;
}

const NO_CHOICE = '';

/** The colour-by select's values: one word for the built-in colourings, `field:` and the id for a dropdown field. */
function encodeColour(by: ColourBy): string {
  return by.kind === 'field' ? `field:${by.fieldId}` : by.kind;
}

function decodeColour(value: string): ColourBy {
  if (value.startsWith('field:')) return { kind: 'field', fieldId: value.slice('field:'.length) };
  return value === 'list' ? { kind: 'list' } : value === 'member' ? { kind: 'member' } : { kind: 'label' };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, testId: string): HTMLButtonElement {
  const b = el('button', undefined, label);
  b.type = 'button';
  b.dataset.testid = testId;
  return b;
}

function option(value: string, text: string, disabled = false): HTMLOptionElement {
  const o = el('option', undefined, text);
  o.value = value;
  o.disabled = disabled;
  return o;
}

/** A caption and a control in one `<label>`, so clicking the caption reaches the control. */
function labelled(caption: string, control: HTMLElement): HTMLLabelElement {
  const l = el('label', 'mm-field');
  l.append(el('span', 'mm-caption', caption), control);
  return l;
}

export function createToolbar(handlers: ToolbarHandlers, signal: AbortSignal): Toolbar {
  const bar = el('div', 'mm-toolbar');
  bar.dataset.testid = 'toolbar';

  const across = el('select');
  across.dataset.testid = 'across';
  const up = el('select');
  up.dataset.testid = 'up';
  const swap = button('Swap axes', 'swap');

  const listsButton = button('Lists…', 'lists');
  listsButton.setAttribute('aria-haspopup', 'true');
  listsButton.setAttribute('aria-expanded', 'false');
  const listsPanel = el('div', 'mm-popover');
  listsPanel.dataset.testid = 'lists-panel';
  listsPanel.hidden = true;
  const listsWrap = el('span', 'mm-popover-host');
  listsWrap.append(listsButton, listsPanel);

  const colourBy = el('select');
  colourBy.dataset.testid = 'colour-by';

  const showImages = el('input');
  showImages.type = 'checkbox';
  showImages.dataset.testid = 'show-images';
  const showImagesLabel = el('label', 'mm-check');
  showImagesLabel.append(showImages, 'Show images');

  const params = button('Parameters…', 'params');
  const resequence = button('Resequence lists…', 'resequence');

  const spacer = el('span', 'mm-spacer');
  const zoomLabel = el('span', 'mm-zoom-label');
  zoomLabel.dataset.testid = 'zoom-label';
  const whole = button('Whole matrix', 'whole-matrix');

  bar.append(
    labelled('Across', across), swap, labelled('Up', up), listsWrap, labelled('Colour by', colourBy),
    showImagesLabel, params, resequence, spacer, zoomLabel, whole,
  );

  // ---- the lists checklist: a popover that closes on a press outside it (never on a key) ----

  let listsKey = '';
  const boxes = new Map<string, HTMLInputElement>();

  function setPanelOpen(open: boolean): void {
    listsPanel.hidden = !open;
    listsButton.setAttribute('aria-expanded', String(open));
  }
  listsButton.addEventListener('click', () => setPanelOpen(listsPanel.hidden !== false), { signal });
  document.addEventListener('pointerdown', ev => {
    if (!listsPanel.hidden && !listsWrap.contains(ev.target as Node)) setPanelOpen(false);
  }, { signal });
  // Reading the checked boxes back in board order, so the stored list is always in that order.
  listsPanel.addEventListener('change', () => {
    handlers.onLists([...boxes].filter(([, box]) => box.checked).map(([id]) => id));
  }, { signal });

  function updateLists(lists: List[], chosen: string[]): void {
    const key = JSON.stringify(lists);
    if (key !== listsKey) {                       // rebuilt only when the lists change, so an open panel keeps its focus
      listsKey = key;
      boxes.clear();
      listsPanel.replaceChildren(...(lists.length ? lists.map(list => {
        const box = el('input');
        box.type = 'checkbox';
        boxes.set(list.id, box);
        const row = el('label', 'mm-check');
        row.append(box, list.name);
        return row;
      }) : [el('p', 'mm-popover-note', 'This board has no open lists.')]));
    }
    for (const [id, box] of boxes) box.checked = chosen.includes(id);
    listsButton.textContent = `Lists (${chosen.length})…`;
  }

  // ---- axis and colour selects ----

  function fillAxis(select: HTMLSelectElement, parameters: Parameter[], value: ParamId | null, other: ParamId | null): void {
    // The parameter on the other axis cannot be picked here, so the two can never be the same.
    const options = parameters.map(p => option(p.id, p.name, p.id === other));
    if (value === null) options.unshift(option(NO_CHOICE, '—', true));
    select.replaceChildren(...options);
    select.value = value ?? NO_CHOICE;
  }

  across.addEventListener('change', () => { if (across.value !== NO_CHOICE) handlers.onAcross(across.value); }, { signal });
  up.addEventListener('change', () => { if (up.value !== NO_CHOICE) handlers.onUp(up.value); }, { signal });
  swap.addEventListener('click', () => handlers.onSwap(), { signal });
  colourBy.addEventListener('change', () => handlers.onColourBy(decodeColour(colourBy.value)), { signal });
  showImages.addEventListener('change', () => handlers.onShowImages(showImages.checked), { signal });
  params.addEventListener('click', () => handlers.onParams(), { signal });
  resequence.addEventListener('click', () => handlers.onResequence(), { signal });
  whole.addEventListener('click', () => handlers.onWholeMatrix(), { signal });

  function update(model: ToolbarModel): void {
    fillAxis(across, model.parameters, model.across, model.up);
    fillAxis(up, model.parameters, model.up, model.across);
    swap.disabled = model.across === null || model.up === null;
    updateLists(model.lists, model.listIds);
    colourBy.replaceChildren(
      option('label', 'Label'), option('list', 'List'), option('member', 'Member'),
      ...model.dropdownFields.map(f => option(`field:${f.id}`, f.name)),
    );
    colourBy.value = encodeColour(model.colourBy);
    showImages.checked = model.showImages;
    resequence.disabled = !model.canResequence;
    params.hidden = !model.canEdit;
    resequence.hidden = !model.canEdit;
  }

  return { el: bar, update, setZoomText(text) { zoomLabel.textContent = text; }, focusParams() { params.focus(); }, focusResequence() { resequence.focus(); } };
}
