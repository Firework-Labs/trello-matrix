import { expect, test } from '@playwright/test';
import { store } from './helpers';

const dialog = (page: import('@playwright/test').Page) => page.getByTestId('param-dialog');
const row = (page: import('@playwright/test').Page, id: string) => dialog(page).locator(`[data-param="${id}"]`);

test('add a 2-level parameter where the first level is better', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  const d = page.getByTestId('param-dialog');
  await d.getByLabel('Name').fill('Risk'); await d.getByLabel('2 levels').check();
  await d.getByLabel('Better end').getByLabel('Low').check(); await d.getByRole('button', { name: 'Add parameter' }).click();
  const p = await store(page, s => s.snapshot().parameters.find(p => p.name === 'Risk'));
  expect(p!.levels).toEqual(['High', 'Low']);
  await expect(page.getByTestId('across').locator('option', { hasText: 'Risk' })).toHaveCount(1);
  await expect(page.getByTestId('up').locator('option', { hasText: 'Risk' })).toHaveCount(1);
  await expect(row(page, 'f-risk')).toHaveCount(1);                                   // the new row is in the dialog
  await expect(d.getByLabel('Name')).toHaveValue('');                                 // the form starts over
  expect(await store(page, s => s.calls.at(-1)!.args)).toEqual([{ name: 'Risk', levels: ['Low', 'High'], bestEnd: 'first' }]);
});

test('a 3-level parameter takes the names as typed, best last by default', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  const d = dialog(page);
  await d.getByLabel('Name').fill('Urgency');
  await expect(d.getByLabel('Level 1')).toHaveValue('Low');
  await expect(d.getByLabel('Level 2')).toHaveValue('Medium');
  await expect(d.getByLabel('Level 3')).toHaveValue('High');
  await expect(d.getByLabel('Better end').getByRole('radio')).toHaveCount(2);
  await expect(d.getByLabel('Better end').getByLabel('High')).toBeChecked();
  await d.getByLabel('Level 3').fill('Now');
  await expect(d.getByLabel('Better end').getByLabel('Now')).toBeChecked();           // the choice is named after the last level
  await d.getByRole('button', { name: 'Add parameter' }).click();
  await expect(row(page, 'f-urgency')).toHaveCount(1);
  const p = await store(page, s => s.snapshot().parameters.find(p => p.name === 'Urgency'));
  expect(p!.levels).toEqual(['Low', 'Medium', 'Now']);
});

test('a 2-level parameter uses the first and the last level names', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  const d = dialog(page);
  await d.getByLabel('Name').fill('Risk'); await d.getByLabel('2 levels').check();
  await expect(d.getByLabel('Level 2')).toHaveValue('High');                           // the middle input is gone, the last is now level 2
  await expect(d.getByLabel('Level 3')).toHaveCount(0);
  await d.getByRole('button', { name: 'Add parameter' }).click();
  await expect(row(page, 'f-risk')).toHaveCount(1);
  const p = await store(page, s => s.snapshot().parameters.find(p => p.name === 'Risk'));
  expect(p!.levels).toEqual(['Low', 'High']);
});

test('Add needs a name and distinct level names', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  const d = dialog(page); const add = d.getByRole('button', { name: 'Add parameter' });
  await expect(add).toBeDisabled();
  await d.getByLabel('Name').fill('Risk');
  await expect(add).toBeEnabled();
  await d.getByLabel('Level 2').fill('low');
  await expect(d.getByTestId('param-note')).toHaveText('Level names must differ.'); await expect(add).toBeDisabled();
  await d.getByLabel('Level 2').fill('');
  await expect(d.getByTestId('param-note')).toHaveText('Every level needs a name.'); await expect(add).toBeDisabled();
});

test('a name that matches an existing parameter is refused', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  const d = dialog(page); await d.getByLabel('Name').fill('  cost ');
  await expect(d).toContainText('A parameter called "cost" already exists.');
  await expect(d.getByRole('button', { name: 'Add parameter' })).toBeDisabled();
});

test('a name that matches an existing dropdown field offers to link it', async ({ page }) => {
  await page.goto('dev.html?extraField=Effort:S,M,L'); await page.getByTestId('params').click();
  const d = page.getByTestId('param-dialog'); await d.getByLabel('Name').fill('Effort');
  await expect(d).toContainText('A field called "Effort" already exists. Link to it?');
  await d.getByLabel('Better end').getByLabel('S').check(); await d.getByRole('button', { name: 'Link' }).click();
  expect(await store(page, s => s.calls.at(-1)!.method)).toBe('linkParameter');
  expect(await store(page, s => s.calls.at(-1)!.args)).toEqual(['f-effort', 'first']);
  const p = await store(page, s => s.snapshot().parameters.find(p => p.name === 'Effort'));
  expect(p!.levels).toEqual(['L', 'M', 'S']);                                           // S is the better end
  expect(await store(page, s => s.snapshot().dropdownFields.filter(f => f.name === 'Effort').length)).toBe(1);   // no duplicate field
  await expect(page.getByTestId('across').locator('option', { hasText: 'Effort' })).toHaveCount(1);
});

test('a matching field with more than 3 options cannot be linked', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  const d = dialog(page); await d.getByLabel('Name').fill('Impacts');
  await expect(d).toContainText('A field called "Impacts" exists but has 6 options. Choose another name.');
  await expect(d.getByRole('button', { name: 'Add parameter' })).toBeDisabled();
  await expect(d.getByRole('button', { name: 'Link' })).toHaveCount(0);
  expect(await store(page, s => s.calls.length)).toBe(0);
});

test('remove takes it off the matrix and leaves the field', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  const d = dialog(page);
  await row(page, 'f-ease').getByRole('button', { name: 'Remove' }).click();
  await expect(d).toContainText('The field and its values stay on the cards.');
  expect(await store(page, s => s.snapshot().parameters.some(p => p.id === 'f-ease'))).toBe(true);        // nothing removed until confirmed
  await row(page, 'f-ease').getByRole('button', { name: 'Remove' }).click();
  await expect(row(page, 'f-ease')).toHaveCount(0);
  expect(await store(page, s => s.snapshot().parameters.some(p => p.id === 'f-ease'))).toBe(false);
  expect(await store(page, s => s.snapshot().dropdownFields.some(f => f.id === 'f-ease'))).toBe(true);
  await expect(page.getByTestId('across').locator('option')).toHaveText(['Value', 'Cost']);
  await expect(page.getByTestId('up').locator('option')).toHaveText(['Value', 'Cost']);
  await expect(page.getByTestId('colour-by').locator('option', { hasText: 'Ease' })).toHaveCount(1);       // still a dropdown field to colour by
});

test('Keep puts the remove button back and changes nothing', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  await row(page, 'f-ease').getByRole('button', { name: 'Remove' }).click();
  await row(page, 'f-ease').getByRole('button', { name: 'Keep' }).click();
  await expect(row(page, 'f-ease').getByRole('button', { name: 'Remove' })).toBeVisible();
  await expect(dialog(page)).not.toContainText('The field and its values stay on the cards.');
  expect(await store(page, s => s.calls.length)).toBe(0);
});

test('removing a parameter that is on an axis moves that axis to another parameter', async ({ page }) => {
  await page.goto('dev.html');
  await expect(page.getByTestId('across')).toHaveValue('f-cost'); await expect(page.getByTestId('up')).toHaveValue('f-value');
  await page.getByTestId('params').click();
  await row(page, 'f-cost').getByRole('button', { name: 'Remove' }).click();
  await row(page, 'f-cost').getByRole('button', { name: 'Remove' }).click();
  await expect(row(page, 'f-cost')).toHaveCount(0);
  await expect(page.getByTestId('across')).toHaveValue('f-ease');
  await expect(page.getByTestId('up')).toHaveValue('f-value');
  expect(await page.locator('[data-axis="across"]').allTextContents()).toEqual(['Ease: Hard', 'Ease: Easy']);
});

test('removing down to one parameter shows the hint and keeps the dialog open', async ({ page }) => {
  await page.goto('dev.html?params=2'); await page.getByTestId('params').click();
  await row(page, 'f-cost').getByRole('button', { name: 'Remove' }).click();
  await row(page, 'f-cost').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('empty-hint')).toHaveText('Add at least two parameters to plot cards.');
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByTestId('across')).toHaveValue('');
  await expect(page.getByTestId('up')).toHaveValue('f-value');
});

test('adding the second parameter brings the matrix back', async ({ page }) => {
  await page.goto('dev.html?params=1');
  await expect(dialog(page)).toBeVisible();                                           // fewer than two parameters: it opens by itself
  await expect(page.getByTestId('empty-hint')).toHaveText('Add at least two parameters to plot cards.');
  const d = dialog(page);
  await d.getByLabel('Name').fill('Risk'); await d.getByRole('button', { name: 'Add parameter' }).click();
  await expect(page.getByTestId('up')).toHaveValue('f-risk');
  await expect(page.getByTestId('across')).toHaveValue('f-value');
  await expect(page.getByTestId('empty-hint')).toBeHidden();
  await expect(page.locator('[data-card-id]').first()).toBeAttached();
});

test('rename a parameter and a level', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  const name = row(page, 'f-value').getByTestId('param-name');
  await name.fill('Benefit'); await name.press('Enter');
  await expect(page.getByTestId('up').locator('option[value="f-value"]')).toHaveText('Benefit');
  const top = row(page, 'f-value').locator('[data-level="2"]');
  await expect(top).toHaveValue('High');
  await top.fill('Top'); await top.blur();
  await expect(page.locator('[data-axis="up"]').last()).toHaveText('Benefit: Top');
  const calls = await store(page, s => s.calls.map(c => [c.method, ...c.args]));
  expect(calls).toEqual([['renameParameter', 'f-value', 'Benefit'], ['renameLevel', 'f-value', 2, 'Top']]);
  expect(await store(page, s => s.snapshot().parameters.find(p => p.id === 'f-value')!.levels)).toEqual(['Low', 'Medium', 'Top']);
});

test('an unchanged or empty name is not written', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  const name = row(page, 'f-value').getByTestId('param-name');
  await name.fill('  Value '); await name.blur();
  await name.fill('   '); await name.blur();
  await expect(name).toHaveValue('Value');
  const low = row(page, 'f-value').locator('[data-level="0"]');
  await low.fill(''); await low.blur();
  await expect(low).toHaveValue('Low');
  expect(await store(page, s => s.calls.length)).toBe(0);
});

test('a level is shown worst first with the better end named', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  const cost = row(page, 'f-cost');
  await expect(cost.locator('[data-level]')).toHaveCount(3);
  expect(await cost.locator('[data-level]').evaluateAll(es => es.map(e => (e as HTMLInputElement).value))).toEqual(['High', 'Medium', 'Low']);
  await expect(cost.getByTestId('param-best')).toHaveText('Better end: Low');
  await expect(row(page, 'f-ease').locator('[data-level]')).toHaveCount(2);              // the number of levels is fixed: no control to change it
  await expect(dialog(page).getByLabel('Better end')).toHaveCount(1);                     // only the new-parameter form has the choice
});

test('when level renaming is unavailable, level names are read-only with a note', async ({ page }) => {
  await page.goto('dev.html?renameLevels=0'); await page.getByTestId('params').click();
  await expect(page.getByTestId('param-dialog')).toContainText("Rename levels in Trello's Custom Fields editor.");
  const low = row(page, 'f-value').locator('[data-level="0"]');
  await expect(low).toHaveAttribute('readonly', '');
  await expect(row(page, 'f-value').getByTestId('param-name')).not.toHaveAttribute('readonly', '');
  await expect(dialog(page).getByLabel('Level 1')).toBeEditable();                        // a new parameter's levels can still be named
});

test('with level renaming available there is no note', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  await expect(page.getByTestId('param-dialog')).not.toContainText("Rename levels in Trello's Custom Fields editor.");
});

test('a store error is shown in the dialog and the dialog stays open', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  await store(page, s => s.failNext('createParameter', Object.assign(new Error('This board already has 50 custom fields.'), { kind: 'limit' }) as never));
  const d = dialog(page);
  await d.getByLabel('Name').fill('Risk'); await d.getByRole('button', { name: 'Add parameter' }).click();
  await expect(d.getByTestId('param-error')).toHaveText('This board already has 50 custom fields.');
  await expect(d).toBeVisible();
  await expect(d.getByLabel('Name')).toHaveValue('Risk');                                 // what was typed is kept for another try
  expect(await store(page, s => s.snapshot().parameters.length)).toBe(3);
  await d.getByRole('button', { name: 'Add parameter' }).click();                         // and it works once the store does
  await expect(row(page, 'f-risk')).toHaveCount(1);
  await expect(d.getByTestId('param-error')).toBeHidden();
});

test('a failed rename shows the error and puts the old name back', async ({ page }) => {
  await page.goto('dev.html'); await page.getByTestId('params').click();
  await store(page, s => s.failNext('renameParameter', Object.assign(new Error('Trello said no.'), { kind: 'network' }) as never));
  const name = row(page, 'f-value').getByTestId('param-name');
  await name.fill('Benefit'); await name.press('Enter');
  await expect(dialog(page).getByTestId('param-error')).toHaveText('Trello said no.');
  await expect(name).toHaveValue('Value');
  await expect(page.getByTestId('up')).toHaveValue('f-value');
});

test('the dialog opens by itself with fewer than two parameters and only Done closes it', async ({ page }) => {
  await page.goto('dev.html?params=1');
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(page.getByTestId('empty-hint')).toHaveText('Add at least two parameters to plot cards.');
  await page.keyboard.press('Escape');                                                   // never bound
  await expect(d).toBeVisible();
  await page.mouse.click(5, 5);                                                          // outside the dialog
  await expect(d).toBeVisible();
  await d.getByRole('button', { name: 'Done' }).click();
  await expect(d).toBeHidden();
  await expect(page.getByTestId('params')).toBeFocused();
  await page.getByTestId('params').click();
  await expect(d).toBeVisible();
});

test('with two parameters the dialog stays closed until asked for', async ({ page }) => {
  await page.goto('dev.html');
  await expect(dialog(page)).toBeHidden();
  await page.getByTestId('params').click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('[data-testid="param-row"]')).toHaveCount(3);
});

test('a person who cannot edit the board has no parameters button and no dialog', async ({ page }) => {
  await page.goto('dev.html?readonly=1&params=1');
  await expect(page.getByTestId('toolbar')).toBeVisible();
  await expect(page.getByTestId('params')).toBeHidden();
  await expect(dialog(page)).toBeHidden();
});
