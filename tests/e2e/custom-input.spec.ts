/**
 * Custom input, in the FIXTURE stack (live is off). Fixture mode has hand-written answers only for the
 * built-in examples, so these tests cover editing, validation, the preview, and the rule that blocks
 * Approve for text it cannot analyse. Analysing custom text through a provider is in live-stub.spec.ts.
 */
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

async function openCustom(page: Page) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Custom input' }).click();
  await expect(page.getByTestId('custom-editor')).toBeVisible();
}

const passage = (page: Page, index: number) => page.getByTestId('custom-passage').nth(index);
const idField = (page: Page, index: number) => passage(page, index).getByLabel('ID', { exact: true });
const textField = (page: Page, index: number) => passage(page, index).getByLabel('Text', { exact: true });

async function fillValid(page: Page) {
  await page.getByTestId('custom-task').fill('What is the refund window?');
  await page.getByTestId('custom-bulk').fill('Refunds are allowed within 30 days.\n\nShipping takes 5 days.\n\nGift cards never expire.');
  await page.getByTestId('custom-bulk-add').click();
  await expect(page.getByTestId('custom-valid')).toBeVisible();
}

const approve = (page: Page) => page.getByRole('button', { name: 'Approve & Analyze' });

test('opens empty, says what is missing in plain words, and shows no preview yet', async ({ page }) => {
  await openCustom(page);
  await expect(page.getByRole('tab', { name: 'Custom input' })).toHaveAttribute('aria-selected', 'true');
  const issues = page.getByTestId('custom-issues');
  await expect(issues).toContainText('Enter a task.');
  await expect(issues).toContainText('Add at least one source passage.');
  await expect(page.getByTestId('preview-waiting')).toBeVisible();
  await expect(page.getByTestId('preview-card')).toHaveCount(0);
});

test('pasting several passages assigns IDs, and the preview appears once the input is valid', async ({ page }) => {
  await openCustom(page);
  await fillValid(page);

  await expect(page.getByTestId('custom-passage')).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) await expect(idField(page, i)).toHaveValue(`p${i + 1}`);
  await expect(page.getByTestId('custom-valid')).toHaveText('Input is valid: 3 passages, 0 in the pack.');
  await expect(page.getByTestId('custom-bulk')).toHaveValue('');

  await expect(page.getByTestId('preview-card')).toBeVisible();
  const text = (await page.getByTestId('preview-text').textContent()) ?? '';
  const hash = (await page.getByTestId('preview-hash').textContent()) ?? '';
  expect(text.startsWith('mode: fixture\n')).toBe(true);
  for (const block of ['Refunds are allowed within 30 days.', 'Shipping takes 5 days.', 'Gift cards never expire.']) expect(text).toContain(block);
  expect(text).toContain('What is the refund window?');
  expect(hash).toBe(sha256(text));
});

test('putting a passage in the pack changes the outbound text and its hash', async ({ page }) => {
  await openCustom(page);
  await fillValid(page);
  await expect(page.getByTestId('preview-card')).toBeVisible();
  const before = (await page.getByTestId('preview-hash').textContent()) ?? '';
  // The request is JSON inside a JSON string, so the flag appears as \"inPack\": true in the preview.
  const inPackFlags = /inPack\\": true/g;
  const beforeText = (await page.getByTestId('preview-text').textContent()) ?? '';
  expect(beforeText.match(/inPack\\": false/g)).toHaveLength(3); // proves the pattern matches what is on screen
  expect(beforeText.match(inPackFlags)).toBeNull();

  await passage(page, 0).getByLabel('In the context pack').check();
  await expect(page.getByTestId('custom-valid')).toHaveText('Input is valid: 3 passages, 1 in the pack.');
  await expect(page.getByTestId('preview-hash')).not.toHaveText(before);

  const text = (await page.getByTestId('preview-text').textContent()) ?? '';
  expect(text.match(inPackFlags)).toHaveLength(1);
  expect(text.match(/inPack\\": false/g)).toHaveLength(2);
  expect(await page.getByTestId('preview-hash').textContent()).toBe(sha256(text));
});

test('validation messages are specific, and update as you type', async ({ page }) => {
  await openCustom(page);
  await fillValid(page);
  const issues = page.getByTestId('custom-issues');

  await idField(page, 1).fill('p1');
  await expect(issues).toContainText('Passage 2 id: Duplicate source passage ID "p1".');
  await expect(page.getByTestId('preview-card')).toHaveCount(0); // an invalid input has no preview
  await idField(page, 1).fill('p2');
  await expect(issues).toHaveCount(0);
  await expect(page.getByTestId('preview-card')).toBeVisible();

  await textField(page, 0).fill('   ');
  await expect(issues).toContainText('Passage 1: paste the passage text.');

  await textField(page, 0).fill('x'.repeat(4001));
  await expect(issues).toContainText('Passage 1 text:');

  await idField(page, 0).fill('has space');
  await expect(issues).toContainText('Passage 1 id:');

  await page.getByRole('button', { name: 'Remove passage 1' }).click();
  await expect(page.getByTestId('custom-passage')).toHaveCount(2);
  await expect(issues).toHaveCount(0);
  await expect(page.getByTestId('custom-valid')).toBeVisible();
});

test('fixture mode explains why your own text cannot be analysed, and blocks Approve', async ({ page }) => {
  await openCustom(page);
  await fillValid(page);
  await expect(page.getByTestId('preview-card')).toBeVisible(); // the preview is still shown
  await expect(approve(page)).toBeDisabled();
  await expect(page.getByTestId('approve-blocked')).toContainText('Fixture mode has hand-written outputs only for the built-in examples');
  await expect(page.getByRole('radio', { name: /^Live/ })).toBeDisabled();
});

test('a built-in example loaded into the editor works in fixture mode, until you change it', async ({ page }) => {
  await openCustom(page);
  await page.getByTestId('custom-load-example').click();
  await expect(page.getByTestId('custom-valid')).toBeVisible();
  await expect(page.getByTestId('approve-blocked')).toHaveCount(0);
  await expect(approve(page)).toBeEnabled();

  await approve(page).click();
  await expect(page.getByTestId('findings')).toBeVisible();
  await expect(page.getByTestId('bucket-missing_evidence').getByRole('heading', { level: 3 })).toHaveText('Missing Evidence (2)');

  // One character changes the request, so the old results go away and Approve is blocked again.
  const before = (await page.getByTestId('preview-hash').textContent()) ?? '';
  await textField(page, 0).fill(((await textField(page, 0).inputValue()) ?? '') + '.');
  await expect(page.getByTestId('findings')).toHaveCount(0);
  await expect(page.getByTestId('approve-blocked')).toBeVisible();
  await expect(approve(page)).toBeDisabled();
  await expect(page.getByTestId('preview-hash')).not.toHaveText(before);
});

test('the draft survives switching tabs, and is gone after a reload', async ({ page }) => {
  await openCustom(page);
  await page.getByTestId('custom-task').fill('Keep me');

  await page.getByRole('tab', { name: 'Built-in examples' }).click();
  await expect(page.getByTestId('custom-editor')).toHaveCount(0);
  await expect(page.getByTestId('example-refund-window')).toBeVisible();

  await page.getByRole('tab', { name: 'Custom input' }).click();
  await expect(page.getByTestId('custom-task')).toHaveValue('Keep me');

  await page.reload();
  await page.getByRole('tab', { name: 'Custom input' }).click();
  await expect(page.getByTestId('custom-task')).toHaveValue('');
});

test('editing never analyses anything, and nothing leaves localhost', async ({ page }) => {
  const analyze: string[] = [];
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== 'localhost') foreign.push(request.url());
    if (url.pathname === '/api/analyze') analyze.push(request.url());
  });
  await openCustom(page);
  await fillValid(page);
  await expect(page.getByTestId('preview-card')).toBeVisible();
  await page.getByTestId('custom-task').fill('A different task');
  await expect(page.getByTestId('preview-card')).toBeVisible();
  expect(analyze).toEqual([]);
  expect(foreign).toEqual([]);
});
