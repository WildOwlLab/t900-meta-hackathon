/**
 * The LIVE path in a real browser, against a stub provider on 127.0.0.1. No external network call is made.
 *
 * The stub is test plumbing: it returns hand-written answers for known inputs, so these tests prove the
 * wiring (mode switch, destination, approval, exact bytes sent, the key staying on the server, errors,
 * custom input, exports) and say nothing about how a real model behaves.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { examples } from '../../src/examples';
import { validateModelOutput } from '../../src/server/validator';
import { EvidenceReportSchema } from '../../src/shared/export';
import { FIXTURE_NOTICE } from '../../src/shared/types';
import { STUB_CHAT_URL, STUB_KEY, STUB_MODEL_RETURNED, STUB_ORIGIN } from './support/constants';
import { customBlocks, customInput, customPackNumbers, customTask } from './support/custom-case';

// The stub keeps shared state (requests received, a queued one-off reply), so these run one at a time.
test.describe.configure({ mode: 'serial' });

interface Recorded {
  authorization: string | null;
  body: string;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const received = async (request: APIRequestContext): Promise<Recorded[]> => (await request.get(`${STUB_ORIGIN}/__requests`)).json();
const queueReply = (request: APIRequestContext, reply: { status: number; body?: string; content?: string }) =>
  request.post(`${STUB_ORIGIN}/__next`, { data: reply });

test.beforeEach(async ({ request }) => {
  await request.delete(`${STUB_ORIGIN}/__requests`);
});

const approve = (page: Page) => page.getByRole('button', { name: 'Approve & Analyze' });
const refund = examples.find((e) => e.slug === 'refund-window')!;

async function chooseLive(page: Page) {
  await page.goto('/');
  await page.getByRole('radio', { name: /^Live/ }).check();
  await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'live');
  await expect(page.getByTestId('preview-text')).toContainText('mode: live');
}

async function download(page: Page, button: string) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
  return { name: file.suggestedFilename(), content: readFileSync(await file.path(), 'utf8') };
}

test('live is offered but never preselected, and its destination is shown', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('radio', { name: /^Fixture/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /^Live/ })).toBeEnabled();
  await expect(page.getByTestId('mode-banner')).toHaveAttribute('data-mode', 'fixture');
  const note = page.getByTestId('live-configured');
  await expect(note).toContainText('stub-model');
  await expect(note).toContainText(STUB_CHAT_URL);
  await expect(page.getByTestId('live-unavailable')).toHaveCount(0);
});

test('switching to live names the destination and model, and the preview sends nothing', async ({ page, request }) => {
  await chooseLive(page);
  await expect(page.getByTestId('mode-banner')).toContainText(STUB_CHAT_URL);

  const card = page.getByTestId('preview-card');
  await expect(card).toContainText('Approving sends exactly the text below to');
  await expect(card).toContainText(STUB_CHAT_URL);
  await expect(card).toContainText('stub-model');

  const text = (await page.getByTestId('preview-text').textContent()) ?? '';
  expect(text.startsWith(`mode: live\ndestination: POST ${STUB_CHAT_URL}\n\n`)).toBe(true);
  expect(await page.getByTestId('preview-hash').textContent()).toBe(sha256(text));

  expect(await received(request)).toEqual([]); // previewing contacts nobody
});

test('approving sends exactly the previewed bytes, once, with the key; the browser never sees the key', async ({ page, request }) => {
  const pending: Promise<string>[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/api/')) pending.push(response.text().catch(() => ''));
  });

  await chooseLive(page);
  const text = (await page.getByTestId('preview-text').textContent()) ?? '';
  await approve(page).click();
  await expect(page.getByTestId('findings')).toBeVisible();

  const requests = await received(request);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.authorization).toBe(`Bearer ${STUB_KEY}`);
  expect(requests[0]!.body).toBe(text.slice(text.indexOf('\n\n') + 2)); // byte-identical to what was approved

  // Labelled as a live result, not a fixture.
  await expect(page.getByTestId('result-source')).toContainText(STUB_MODEL_RETURNED);
  await expect(page.getByTestId('result-notice')).toHaveCount(0);
  const headings = page.getByTestId('findings').locator('h3');
  await expect(headings).toHaveText(
    ['Supported', 'Missing Evidence', 'Conflicting', 'Unanswerable'].map((title, i) => {
      const status = (['supported', 'missing_evidence', 'conflicting', 'unanswerable'] as const)[i]!;
      return `${title} (${refund.fixtureOutput.requirements.filter((r) => r.status === status).length})`;
    }),
  );

  // The key lives on the server only.
  for (const body of await Promise.all(pending)) expect(body).not.toContain(STUB_KEY);
  expect(await page.content()).not.toContain(STUB_KEY);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage, cookie: document.cookie }))).not.toContain(STUB_KEY);
});

test('custom input end to end: paste, preview, approve, repair, export', async ({ page, request }) => {
  await chooseLive(page);
  await page.getByRole('tab', { name: 'Custom input' }).click();
  await page.getByTestId('custom-task').fill(customTask);
  await page.getByTestId('custom-bulk').fill(customBlocks.join('\n\n'));
  await page.getByTestId('custom-bulk-add').click();
  for (const n of customPackNumbers) await page.getByTestId('custom-passage').nth(n - 1).getByLabel('In the context pack').check();
  await expect(page.getByTestId('custom-valid')).toHaveText('Input is valid: 5 passages, 3 in the pack.');

  // Live mode can analyse text that is not a built-in example, so Approve is open.
  await expect(page.getByTestId('approve-blocked')).toHaveCount(0);
  await expect(page.getByTestId('preview-text')).toContainText('mode: live');
  const text = (await page.getByTestId('preview-text').textContent()) ?? '';
  const hash = (await page.getByTestId('preview-hash').textContent()) ?? '';
  expect(hash).toBe(sha256(text));
  expect(await received(request)).toEqual([]);

  await approve(page).click();
  await expect(page.getByTestId('findings')).toBeVisible();
  await expect(page.getByTestId('findings').locator('h3')).toHaveText(['Supported (1)', 'Missing Evidence (1)', 'Conflicting (1)', 'Unanswerable (1)']);
  await expect(page.getByTestId('bucket-conflicting')).toContainText('Backups are kept for 30 days');
  await expect(page.getByTestId('bucket-conflicting')).toContainText('Backups are kept for 90 days');

  const requests = await received(request);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.body).toBe(text.slice(text.indexOf('\n\n') + 2));
  for (const block of customBlocks) expect(requests[0]!.body).toContain(block);

  // Approve the one proposed repair and apply it.
  await page.getByTestId('repairs').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Apply 1 approved repair' }).click();
  const revised = page.getByTestId('revised-pack');
  await expect(revised.getByTestId('revised-pack-item')).toHaveCount(4);
  await expect(revised.locator('[data-passage-id="p2"]').getByTestId('added-text')).toHaveText(customBlocks[1]);

  // Exports from a live custom run.
  const report = EvidenceReportSchema.parse(JSON.parse((await download(page, 'Report: JSON (.json)')).content));
  expect(report.source).toEqual({ kind: 'custom' });
  expect(report.mode).toBe('live');
  expect(report.notice).toBeNull();
  expect(report.provider.model).toBe(STUB_MODEL_RETURNED);
  expect(report.approval).toEqual({ hashAlgorithm: 'SHA-256', approvedHash: hash, sentToProvider: true, destination: STUB_CHAT_URL });
  expect(report.input).toEqual(customInput);
  expect(report.repairs.revisedPack).toEqual(['p1', 'p3', 'p5', 'p2']);
  expect(validateModelOutput(report.analysis, report.input).ok).toBe(true);
  expect(JSON.stringify(report)).not.toContain(STUB_KEY);

  const summary = await download(page, 'Report: Summary (.md)');
  expect(summary.content).toContain('Custom input');
  expect(summary.content).toContain('Live model result');
  expect(summary.content).toContain(`Yes, to ${STUB_CHAT_URL}`);
  expect(summary.content).not.toContain(FIXTURE_NOTICE);

  const markdown = await download(page, 'Revised pack: Markdown (.md)');
  expect(markdown.content).toContain('Added by an approved repair for r2.');
  expect(markdown.content).toContain(customBlocks[1]);
});

test('a provider error is shown as an error, never as findings, and never falls back to a fixture', async ({ page, request }) => {
  await queueReply(request, { status: 500, body: 'provider is down' });
  await chooseLive(page);
  await approve(page).click();

  const error = page.getByTestId('error-card');
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('data-error-code', 'model_upstream');
  await expect(error).toContainText('server error');
  await expect(error).toContainText('provider is down');
  await expect(page.getByTestId('findings')).toHaveCount(0);
  await expect(page.getByTestId('result-notice')).toHaveCount(0);
  expect(await received(request)).toHaveLength(1);
});

test('a rejected key is reported as such', async ({ page, request }) => {
  await queueReply(request, { status: 401, body: 'invalid api key' });
  await chooseLive(page);
  await approve(page).click();
  const error = page.getByTestId('error-card');
  await expect(error).toHaveAttribute('data-error-code', 'model_auth');
  await expect(error).toContainText('rejected the API key');
  await expect(page.getByTestId('findings')).toHaveCount(0);
});

test('an answer that fails validation shows the issues and the raw text, and no findings', async ({ page, request }) => {
  await queueReply(request, { status: 200, content: 'Sure! Here is my analysis.' });
  await chooseLive(page);
  await approve(page).click();

  const error = page.getByTestId('error-card');
  await expect(error).toHaveAttribute('data-error-code', 'invalid_model_output');
  await expect(error).toContainText('invalid_json');
  await error.getByText('What the model returned').click();
  await expect(error).toContainText('Sure! Here is my analysis.');
  await expect(page.getByTestId('findings')).toHaveCount(0);
});

test('going back to fixture mode after a live run labels results as a fixture again', async ({ page }) => {
  await chooseLive(page);
  await approve(page).click();
  await expect(page.getByTestId('result-source')).toContainText(STUB_MODEL_RETURNED);

  await page.getByRole('radio', { name: /^Fixture/ }).check();
  await expect(page.getByTestId('findings')).toHaveCount(0); // live results do not linger under a fixture label
  await expect(page.getByTestId('preview-text')).toContainText('mode: fixture');
  await approve(page).click();
  await expect(page.getByTestId('result-notice')).toHaveText(FIXTURE_NOTICE);
});
