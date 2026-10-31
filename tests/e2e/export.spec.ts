/**
 * Exports, in the FIXTURE stack, for all three built-in examples. Every file is downloaded through the
 * real UI and checked: passage text copied unchanged, fixture exports labelled as not a model result,
 * and the JSON report parsing against its schema and re-validating against its own sources.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { examples, type Example } from '../../src/examples';
import { validateModelOutput } from '../../src/server/validator';
import { EvidenceReportSchema } from '../../src/shared/export';
import { FIXTURE_NOTICE } from '../../src/shared/types';

async function download(page: Page, button: string) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
  return { name: file.suggestedFilename(), content: readFileSync(await file.path(), 'utf8') };
}

async function analyze(page: Page, example: Example): Promise<string> {
  await page.goto('/');
  await page.getByTestId(`example-${example.slug}`).check();
  await expect(page.getByTestId('preview-card')).toBeVisible();
  const hash = (await page.getByTestId('preview-hash').textContent()) ?? '';
  await page.getByRole('button', { name: 'Approve & Analyze' }).click();
  await expect(page.getByTestId('export')).toBeVisible();
  return hash;
}

async function applyAll(page: Page, example: Example) {
  const count = example.fixtureOutput.repairs.length;
  const boxes = page.getByTestId('repairs').getByRole('checkbox');
  for (let i = 0; i < count; i += 1) await boxes.nth(i).check();
  await page.getByRole('button', { name: `Apply ${count} approved repair${count === 1 ? '' : 's'}` }).click();
  await expect(page.getByTestId('revised-pack')).toBeVisible();
}

for (const example of examples) {
  test.describe(`exports: ${example.slug}`, () => {
    test('all four files, after applying every repair', async ({ page }) => {
      const hash = await analyze(page, example);

      const apiCalls: string[] = [];
      await applyAll(page, example);
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url());
      });

      const exportPanel = page.getByTestId('export');
      await expect(exportPanel.getByRole('heading', { level: 3 }).first()).toHaveText('Export Revised Context Pack');
      await expect(exportPanel).toContainText('Nothing is uploaded');

      const revisedIds = [...example.input.pack, ...example.expected.repairPassageIds];
      const addedIds = example.expected.repairPassageIds;

      // Revised pack, Markdown.
      const markdown = await download(page, 'Revised pack: Markdown (.md)');
      expect(markdown.name).toBe('revised-context-pack.md');
      expect(markdown.content).toContain('# Revised context pack');
      expect(markdown.content).toContain(FIXTURE_NOTICE);
      for (const id of revisedIds) {
        const source = example.input.sources.find((p) => p.id === id)!;
        expect(markdown.content).toContain(`## [${id}] ${source.title}`);
        expect(markdown.content).toContain(source.text);
      }
      for (const source of example.input.sources.filter((p) => !revisedIds.includes(p.id))) {
        expect(markdown.content).not.toContain(source.text);
      }
      expect(markdown.content.match(/Added by an approved repair/g)).toHaveLength(addedIds.length);

      // Revised pack, plain text.
      const text = await download(page, 'Revised pack: Plain text (.txt)');
      expect(text.name).toBe('revised-context-pack.txt');
      expect(text.content.startsWith('REVISED CONTEXT PACK')).toBe(true);
      expect(text.content).toContain(FIXTURE_NOTICE);
      for (const id of revisedIds) expect(text.content).toContain(example.input.sources.find((p) => p.id === id)!.text);

      // Evidence report, JSON.
      const json = await download(page, 'Report: JSON (.json)');
      expect(json.name).toBe('evidence-report.json');
      const report = EvidenceReportSchema.parse(JSON.parse(json.content));
      expect(report.mode).toBe('fixture');
      expect(report.notice).toBe(FIXTURE_NOTICE);
      expect(report.source).toEqual({ kind: 'example', slug: example.slug, title: example.title });
      expect(report.approval).toEqual({ hashAlgorithm: 'SHA-256', approvedHash: hash, sentToProvider: false, destination: null });
      expect(report.provider.model).toBeNull();
      expect(report.repairs.revisedPack).toEqual(revisedIds);
      expect(report.analysis).toEqual(example.fixtureOutput);
      expect(validateModelOutput(report.analysis, report.input).ok).toBe(true);

      // Evidence report, summary.
      const summary = await download(page, 'Report: Summary (.md)');
      expect(summary.name).toBe('evidence-report-summary.md');
      expect(summary.content).toContain(FIXTURE_NOTICE);
      expect(summary.content).toContain(hash);
      for (const status of ['supported', 'missing_evidence', 'conflicting', 'unanswerable'] as const) {
        const title = { supported: 'Supported', missing_evidence: 'Missing Evidence', conflicting: 'Conflicting', unanswerable: 'Unanswerable' }[status];
        const count = example.fixtureOutput.requirements.filter((r) => r.status === status).length;
        expect(summary.content).toContain(`## ${title} (${count})`);
      }

      // Exports are built in the browser. Making them calls no API.
      expect(apiCalls).toEqual([]);
    });
  });
}

test.describe('exporting before applying any repair', () => {
  const example = examples.find((e) => e.slug === 'refund-window')!;

  test('is honest that the pack is unchanged', async ({ page }) => {
    const hash = await analyze(page, example);
    const exportPanel = page.getByTestId('export');
    await expect(exportPanel.getByRole('heading', { level: 3 }).first()).toHaveText('Export Context Pack (no repairs applied yet)');

    const markdown = await download(page, 'Pack: Markdown (.md)');
    expect(markdown.name).toBe('context-pack.md');
    expect(markdown.content).toContain('# Context pack (unchanged)');
    expect(markdown.content).toContain('no repairs were applied');
    expect(markdown.content).not.toContain('Added by an approved repair');

    const report = EvidenceReportSchema.parse(JSON.parse((await download(page, 'Report: JSON (.json)')).content));
    expect(report.repairs.revisedPack).toBeNull();
    expect(report.repairs.applied).toEqual([]);
    expect(report.approval.approvedHash).toBe(hash);

    const summary = await download(page, 'Report: Summary (.md)');
    expect(summary.content).toContain('Applied: none');
    expect(summary.content).toContain('Revised: not produced (no repairs applied)');
  });

  test('the export heading changes once repairs are applied', async ({ page }) => {
    await analyze(page, example);
    await applyAll(page, example);
    await expect(page.getByTestId('export').getByRole('heading', { level: 3 }).first()).toHaveText('Export Revised Context Pack');
    await expect(page.getByRole('button', { name: 'Revised pack: Markdown (.md)' })).toBeVisible();
  });
});

test('there is nothing to export before an analysis', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('preview-card')).toBeVisible();
  await expect(page.getByTestId('export')).toHaveCount(0);
});
