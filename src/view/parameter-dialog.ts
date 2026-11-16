import type { BoardSnapshot, DropdownField, ParamId, Parameter } from '../model/types';
import type { BoardStore } from '../store/board-store';
import { createModalLock } from './modal';

/**
 * The parameter setup dialog: add, link, rename and remove the parameters that can go on the matrix axes.
 * It is closed only by its Done button (never by a key, never by a press outside it). Every change goes to the
 * store, then the board is read again and handed to `onChanged`, so the matrix and the toolbar follow.
 */
export interface ParameterDialogDeps {
  store: BoardStore;
  /** False when the store cannot rename a level (the level names are then read-only, with a note). */
  canRenameLevels: boolean;
  /** False when the store cannot rename a parameter (the parameter names are then read-only, with a note). */
  canRenameParameters: boolean;
  /** Called with the board as the store now holds it, after every successful change. */
  onChanged(snapshot: BoardSnapshot): void;
  /** Called when the dialog has been closed with Done. */
  onClosed(): void;
  signal: AbortSignal;
}

export interface ParameterDialog {
  el: HTMLElement;
  open(snapshot: BoardSnapshot): void;
  close(): void;
}

type BestEnd = 'first' | 'last';

/** What the typed name means for the board: a new field, an existing field to link, or a name that cannot be used. */
type NameCheck =
  | { kind: 'empty' }
  | { kind: 'taken' }
  | { kind: 'link'; field: DropdownField }
  | { kind: 'unlinkable'; field: DropdownField }
  | { kind: 'new' };

const DEFAULT_LEVELS = ['Low', 'Medium', 'High'];
const MIN_LEVELS = 2;
const MAX_LEVELS = 3;
const NOTE_RENAME_LEVELS = "Rename levels in Trello's Custom Fields editor.";
const NOTE_RENAME_PARAMETERS = "Rename parameters in Trello's Custom Fields editor.";
const NOTE_RENAME_BOTH = "Rename parameters and levels in Trello's Custom Fields editor. The matrix shows the new names.";
const MESSAGE_UNREAD = 'The change was made, but the board could not be read again.';
const NOTE_REMOVE = 'The field and its values stay on the cards.';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, testId: string, className?: string): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.dataset.testid = testId;
  return b;
}

function textInput(testId: string, ariaLabel?: string): HTMLInputElement {
  const input = el('input');
  input.type = 'text';
  input.dataset.testid = testId;
  input.autocomplete = 'off';
  if (ariaLabel) input.setAttribute('aria-label', ariaLabel);
  return input;
}

/** A caption and a control in one `<label>`, so clicking the caption reaches the control. */
function labelled(caption: string, control: HTMLElement): HTMLLabelElement {
  const l = el('label', 'mm-pd-field');
  l.append(el('span', 'mm-caption', caption), control);
  return l;
}

function radio(group: string, value: string, label: string, testId: string): { label: HTMLLabelElement; input: HTMLInputElement; text: Text } {
  const input = el('input');
  input.type = 'radio';
  input.name = group;
  input.value = value;
  input.dataset.testid = testId;
  const text = document.createTextNode(label);
  const wrap = el('label', 'mm-check');
  wrap.append(input, text);
  return { label: wrap, input, text };
}

/** Writes `value` into an input unless the person is in the middle of typing something else there. */
function syncInput(input: HTMLInputElement, value: string): void {
  if (input.value === value) return;
  if (document.activeElement === input && input.value.trim() !== value) return;
  input.value = value;
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createParameterDialog(deps: ParameterDialogDeps): ParameterDialog {
  const { store, signal } = deps;
  let snapshot: BoardSnapshot | null = null;
  /**
   * Parameters the store returned from a write that the next read may leave out (a store that reads from a lagging cache).
   * They are shown, and their names count as taken, until a read includes them, so the same one is never created twice.
   */
  const kept = new Map<ParamId, Parameter>();

  const backdrop = el('div', 'mm-dialog-backdrop');
  backdrop.hidden = true;
  const dialog = el('div', 'mm-dialog');
  dialog.dataset.testid = 'param-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Parameters');
  dialog.tabIndex = -1;
  backdrop.append(dialog);
  const modal = createModalLock(backdrop);

  const heading = el('h2', undefined, 'Parameters');
  const intro = el('p', 'mm-pd-note',
    'A parameter is a dropdown field with two or three levels. Cards are placed on the matrix by two of them.');
  const errorBox = el('div', 'mm-pd-error');
  errorBox.setAttribute('role', 'alert');
  errorBox.hidden = true;
  const errorText = el('span');
  errorText.dataset.testid = 'param-error';
  const reload = button('Reload', 'param-reload');
  reload.hidden = true;
  errorBox.append(errorText, reload);
  const list = el('div', 'mm-pd-list');
  list.dataset.testid = 'param-list';
  const levelsNote = el('p', 'mm-pd-note');
  levelsNote.dataset.testid = 'param-levels-note';

  // ---- the "new parameter" form ----

  const form = el('form', 'mm-pd-add');
  form.noValidate = true;
  form.dataset.testid = 'param-add-form';
  const nameInput = textInput('new-name');
  nameInput.maxLength = 100;
  const countGroup = el('div', 'mm-pd-row');
  countGroup.setAttribute('role', 'radiogroup');
  countGroup.setAttribute('aria-label', 'Number of levels');
  const two = radio('mm-count', '2', '2 levels', 'new-count-2');
  const three = radio('mm-count', '3', '3 levels', 'new-count-3');
  three.input.checked = true;
  countGroup.append(two.label, three.label);
  const levelInputs = DEFAULT_LEVELS.map((name, i) => {
    const input = textInput(`new-level-${i}`);
    input.value = name;
    const field = labelled(`Level ${i + 1}`, input);
    return { input, field, caption: field.firstElementChild as HTMLElement };
  });
  const levelsRow = el('div', 'mm-pd-levels');
  levelsRow.append(...levelInputs.map(l => l.field));
  const bestGroup = el('div', 'mm-pd-row');
  bestGroup.setAttribute('role', 'radiogroup');
  bestGroup.setAttribute('aria-label', 'Better end');
  bestGroup.dataset.testid = 'new-best-end';
  const bestFirst = radio('mm-best', 'first', '', 'new-best-first');
  const bestLast = radio('mm-best', 'last', '', 'new-best-last');
  bestLast.input.checked = true;
  bestGroup.append(el('span', 'mm-caption', 'Better end'), bestFirst.label, bestLast.label);
  const formNote = el('p', 'mm-pd-note');
  formNote.dataset.testid = 'param-note';
  const addButton = button('Add parameter', 'add-param');
  addButton.type = 'submit';
  addButton.className = 'mm-primary';
  form.append(el('h3', undefined, 'New parameter'), labelled('Name', nameInput), countGroup, levelsRow, bestGroup, formNote, addButton);

  const done = button('Done', 'param-done', 'mm-primary');
  const footer = el('div', 'mm-pd-footer');
  footer.append(done);
  dialog.append(heading, intro, errorBox, list, levelsNote, form, footer);

  // ---- what the typed name means ----

  function checkName(): NameCheck {
    const typed = nameInput.value.trim();
    if (typed === '') return { kind: 'empty' };
    const parameters = snapshot?.parameters ?? [];
    if (parameters.some(p => sameName(p.name, typed))) return { kind: 'taken' };
    // A field that is already a parameter is covered above; this finds a dropdown field that is not one.
    const field = snapshot?.dropdownFields.find(f => sameName(f.name, typed) && !parameters.some(p => p.fieldId === f.id));
    if (!field) return { kind: 'new' };
    return field.options.length >= MIN_LEVELS && field.options.length <= MAX_LEVELS ? { kind: 'link', field } : { kind: 'unlinkable', field };
  }

  const levelCount = (): number => (two.input.checked ? 2 : 3);
  /** The inputs in use: all three, or the first and last when there are two levels. */
  const usedLevels = () => (levelCount() === 2 ? [levelInputs[0]!, levelInputs[2]!] : levelInputs);
  /** The level names as typed, in the order typed. */
  const typedLevels = (): string[] => usedLevels().map(l => l.input.value.trim());

  /** Shows or hides the parts of the form that fit what the name means, and says whether Add can be pressed. */
  let busy = 0;
  function updateForm(): void {
    const check = checkName();
    const linking = check.kind === 'link';
    const typed = nameInput.value.trim();
    countGroup.hidden = levelsRow.hidden = linking || check.kind === 'unlinkable';
    levelInputs[1]!.field.hidden = levelCount() === 2;
    levelInputs[1]!.caption.textContent = levelCount() === 2 ? 'Middle level' : 'Level 2';    // the last is level 2 when there are two
    levelInputs[2]!.caption.textContent = levelCount() === 2 ? 'Level 2' : 'Level 3';
    bestGroup.hidden = check.kind === 'unlinkable' || check.kind === 'taken';

    // The two ends of the better-end choice are named after the first and last level.
    const ends = linking
      ? [check.field.options[0]!.text, check.field.options[check.field.options.length - 1]!.text]
      : [typedLevels()[0] ?? '', typedLevels().at(-1) ?? ''];
    bestFirst.text.data = ends[0] || 'First';
    bestLast.text.data = ends[1] || 'Last';

    let note = '';
    let valid = false;
    switch (check.kind) {
      case 'empty': break;
      case 'taken': note = `A parameter called "${typed}" already exists.`; break;
      case 'unlinkable': {
        const n = check.field.options.length;
        note = `A field called "${check.field.name}" exists but has ${n} option${n === 1 ? '' : 's'}. Choose another name.`;
        break;
      }
      case 'link': note = `A field called "${check.field.name}" already exists. Link to it?`; valid = true; break;
      case 'new': {
        const levels = typedLevels();
        if (levels.some(l => l === '')) note = 'Every level needs a name.';
        else if (new Set(levels.map(l => l.toLowerCase())).size !== levels.length) note = 'Level names must differ.';
        else valid = true;
      }
    }
    formNote.textContent = note;
    formNote.hidden = note === '';
    addButton.textContent = linking ? 'Link' : 'Add parameter';
    addButton.disabled = !valid || busy > 0 || unread;
  }

  for (const input of [nameInput, ...levelInputs.map(l => l.input)]) input.addEventListener('input', () => { clearError(); updateForm(); }, { signal });
  for (const r of [two.input, three.input, bestFirst.input, bestLast.input]) r.addEventListener('change', () => { clearError(); updateForm(); }, { signal });

  function resetForm(): void {
    nameInput.value = '';
    DEFAULT_LEVELS.forEach((name, i) => { levelInputs[i]!.input.value = name; });
    three.input.checked = true;
    bestLast.input.checked = true;
  }

  // ---- doing the work: one change at a time, then read the board again ----

  let queue: Promise<unknown> = Promise.resolve();
  function setBusy(delta: number): void {
    busy += delta;
    applyBusy();
    updateForm();
  }
  /**
   * True from a change the store accepted until the board has been read again. The dialog then shows a state the store
   * no longer holds, so nothing in it can be changed until Reload has worked (Done always can be pressed).
   */
  let unread = false;
  /** While a change is in flight, or the board is unread, no other button or input can be used. Reload is only for the unread board. */
  function applyBusy(): void {
    for (const b of dialog.querySelectorAll('button')) if (b !== done && b !== reload) b.disabled = busy > 0 || unread;
    reload.disabled = busy > 0;
    for (const i of dialog.querySelectorAll('input')) i.disabled = unread;
    dialog.setAttribute('aria-busy', String(busy > 0));
  }
  function showError(text: string, withReload = false): void {
    errorText.textContent = text;
    reload.hidden = !withReload;
    errorBox.hidden = text === '';
  }
  function clearError(): void { if (!unread) showError(''); }

  /** Reads the board again and shows it. False (and the Reload message) when the store cannot be read. */
  async function reread(): Promise<boolean> {
    let next: BoardSnapshot;
    try {
      next = await store.load();
    } catch {
      if (!signal.aborted) {
        unread = true;
        showError(MESSAGE_UNREAD, true);
        applyBusy();
        updateForm();
      }
      return false;
    }
    if (signal.aborted) return true;               // the matrix has gone away: nothing is left to draw on
    unread = false;
    showError('');
    for (const id of [...kept.keys()]) if (next.parameters.some(p => p.id === id)) kept.delete(id);
    snapshot = kept.size === 0 ? next : { ...next, parameters: [...next.parameters, ...structuredClone([...kept.values()])] };
    deps.onChanged(snapshot);
    render();
    return true;
  }

  /** What became of a change: 'failed' (the store refused it, so nothing changed), 'unread' (made, but the board could not be read again) or 'done'. */
  type Outcome = 'done' | 'failed' | 'unread';

  /** Runs one change at a time. Only a failure of the change itself is reported as 'failed'; a failed re-read is 'unread'. */
  function run(change: () => Promise<unknown>): Promise<Outcome> {
    clearError();
    setBusy(1);
    const result = queue.then(async (): Promise<Outcome> => {
      try {
        if (unread || signal.aborted) return 'failed';       // an earlier change is not yet shown: this one waits for Reload, and is dropped
        try {
          await change();
        } catch (error) {
          if (!signal.aborted) showError(messageOf(error));
          return 'failed';
        }
        return (await reread()) ? 'done' : 'unread';
      } finally {
        setBusy(-1);
      }
    });
    queue = result.then(() => undefined, () => undefined);     // a throw below must not stop later changes
    return result;
  }

  reload.addEventListener('click', () => {
    setBusy(1);
    void reread().finally(() => setBusy(-1));
  }, { signal });

  const keep = (param: Parameter): void => { kept.set(param.id, structuredClone(param)); };

  form.addEventListener('submit', ev => {
    ev.preventDefault();
    if (addButton.disabled) return;
    const check = checkName();
    if (check.kind === 'link') {
      const best: BestEnd = bestFirst.input.checked ? 'first' : 'last';
      void run(async () => { keep(await store.linkParameter(check.field.id, best)); }).then(outcome => { if (outcome !== 'failed') resetForm(); updateForm(); });
    } else if (check.kind === 'new') {
      const input = { name: nameInput.value.trim(), levels: typedLevels(), bestEnd: (bestFirst.input.checked ? 'first' : 'last') as BestEnd };
      void run(async () => { keep(await store.createParameter(input)); }).then(outcome => { if (outcome !== 'failed') resetForm(); updateForm(); });
    }
  }, { signal });

  done.addEventListener('click', () => close(), { signal });

  // ---- the rows: one per parameter ----

  interface Row {
    el: HTMLElement;
    name: HTMLInputElement;
    levels: HTMLInputElement[];
    best: HTMLElement;
  }
  const rows = new Map<ParamId, Row>();
  let rowsKey = '';

  function buildRow(param: Parameter): Row {
    const id = param.id;
    const row = el('div', 'mm-pd-param');
    row.dataset.param = id;
    row.dataset.testid = 'param-row';

    const name = textInput('param-name');
    name.maxLength = 100;
    name.readOnly = !deps.canRenameParameters;
    name.addEventListener('change', () => commitName(id, name), { signal });

    const levelsWrap = el('div', 'mm-pd-levels');
    const levels = param.levels.map((_, i) => {
      const input = textInput(`param-level-${i}`);
      input.dataset.level = String(i);
      input.readOnly = !deps.canRenameLevels;
      input.addEventListener('change', () => commitLevel(id, i, input), { signal });
      const caption = i === 0 ? 'Worse' : i === param.levels.length - 1 ? 'Better' : '';
      const field = el('span', 'mm-pd-level');
      field.append(el('span', 'mm-caption', caption), input);
      levelsWrap.append(field);
      return input;
    });
    const best = el('span', 'mm-pd-best');
    best.dataset.testid = 'param-best';

    const actions = el('div', 'mm-pd-actions');
    const remove = button('Remove', 'remove-param');
    const confirm = el('span', 'mm-pd-confirm');
    confirm.hidden = true;
    const sure = button('Remove', 'confirm-remove', 'mm-danger');
    const keep = button('Keep', 'keep-param');
    // The question is in the page only while it is asked.
    const askFirst = (asking: boolean): void => {
      remove.hidden = asking;
      confirm.hidden = !asking;
      confirm.replaceChildren(...(asking ? [el('span', undefined, NOTE_REMOVE), sure, keep] : []));
    };
    remove.addEventListener('click', () => { askFirst(true); keep.focus(); }, { signal });
    keep.addEventListener('click', () => { askFirst(false); remove.focus(); }, { signal });
    sure.addEventListener('click', () => {
      void run(async () => { await store.removeParameter(id); kept.delete(id); }).then(outcome => {
        if (outcome === 'failed' && row.isConnected) askFirst(false);     // when it was removed, the next render takes the row away
      });
    }, { signal });
    actions.append(remove, confirm);

    row.append(name, levelsWrap, best, actions);
    return { el: row, name, levels, best };
  }

  /**
   * What each input was last asked to hold, while that change is on its way: an edit is compared with this, not with the
   * snapshot, which is only brought up to date when the board has been read again.
   */
  const sent = new Map<string, string>();

  /** Sends one rename for an input, unless the trimmed text is empty or is what the store holds (or is about to hold). */
  function commit(key: string, input: HTMLInputElement, stored: () => string, write: (text: string) => Promise<unknown>): void {
    const current = sent.get(key) ?? stored();
    const typed = input.value.trim();
    if (typed === '' || typed === current) { input.value = current; return; }
    sent.set(key, typed);
    void run(() => write(typed)).then(outcome => {
      if (sent.get(key) !== typed) return;           // a newer edit of this input is on its way, and it settles the input
      sent.delete(key);
      if (outcome === 'failed') input.value = stored();
    });
  }

  function commitName(id: ParamId, input: HTMLInputElement): void {
    if (!deps.canRenameParameters) { input.value = snapshot?.parameters.find(p => p.id === id)?.name ?? ''; return; }
    commit(`${id}/name`, input, () => snapshot?.parameters.find(p => p.id === id)?.name ?? '', text => store.renameParameter(id, text));
  }

  function commitLevel(id: ParamId, level: number, input: HTMLInputElement): void {
    if (!deps.canRenameLevels) { input.value = snapshot?.parameters.find(p => p.id === id)?.levels[level] ?? ''; return; }
    const levels = snapshot?.parameters.find(p => p.id === id)?.levels ?? [];
    const typed = input.value.trim();
    // What each sibling holds, or is about to hold (a rename of it may still be on its way).
    const sibling = levels.findIndex((stored, j) => j !== level && sameName(sent.get(`${id}/${j}`) ?? stored, typed));
    if (typed !== '' && sibling !== -1) {
      input.value = sent.get(`${id}/${level}`) ?? levels[level] ?? '';
      showError(`Another level is already called "${typed}".`);
      return;
    }
    commit(`${id}/${level}`, input, () => snapshot?.parameters.find(p => p.id === id)?.levels[level] ?? '', text => store.renameLevel(id, level, text));
  }

  /** What cannot be renamed here, and where to do it instead (empty when everything can). */
  function renameNote(): string {
    if (!deps.canRenameLevels) return deps.canRenameParameters ? NOTE_RENAME_LEVELS : NOTE_RENAME_BOTH;
    return deps.canRenameParameters ? '' : NOTE_RENAME_PARAMETERS;
  }

  /** Draws the rows from the snapshot. A row is rebuilt only when the set of parameters changes, so typing is never interrupted. */
  function render(): void {
    const parameters = snapshot?.parameters ?? [];
    const key = parameters.map(p => `${p.id}:${p.levels.length}`).join('|');
    if (key !== rowsKey) {
      rowsKey = key;
      rows.clear();
      for (const p of parameters) rows.set(p.id, buildRow(p));
      list.replaceChildren(...(parameters.length
        ? parameters.map(p => rows.get(p.id)!.el)
        : [el('p', 'mm-pd-note', 'This board has no parameters yet.')]));
    }
    for (const p of parameters) {
      const row = rows.get(p.id)!;
      syncInput(row.name, p.name);
      row.name.setAttribute('aria-label', `${p.name} parameter`);
      p.levels.forEach((level, i) => {
        syncInput(row.levels[i]!, level);
        row.levels[i]!.setAttribute('aria-label', `${p.name}: ${i === 0 ? 'worst' : i === p.levels.length - 1 ? 'best' : 'middle'} level`);
      });
      row.best.textContent = `Better end: ${p.levels[p.levels.length - 1]}`;
    }
    levelsNote.textContent = parameters.length === 0 ? '' : renameNote();
    applyBusy();
    updateForm();
  }

  // ---- opening and closing ----

  function open(next: BoardSnapshot): void {
    snapshot = next;
    clearError();
    render();
    backdrop.hidden = false;
    modal.lock();
    dialog.focus();
  }

  function close(): void {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    kept.clear();
    modal.unlock();
    deps.onClosed();
  }

  render();
  return { el: backdrop, open, close };
}
