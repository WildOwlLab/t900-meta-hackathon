/**
 * End-to-end flow in the browser, in FIXTURE mode only.
 *
 * playwright.config.ts starts its own server with every provider variable blanked, so these
 * tests cannot reach a live provider whatever the shell has set. Fixture output is hand-written,
 * so these tests prove the interface and the approval flow, not any model's quality.
 */
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { examples, type Example } from '../../src/examples';
import { FIXTURE_NOTICE, type RequirementStatus } from '../../src/shared/types';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const BUCKETS: readonly (readonly [RequirementStatus, string])[] = [
  ['supported', 'Supported'],
  ['missing_evidence', 'Missing Evidence'],
  ['conflicting', 'Conflicting'],
  ['unanswerable', 'Unanswerable'],
];

async function open(page: Page, example: Example) {
  await page.goto('/');
  await page.getByTestId(`example-${example.slug}`).check();
  await expect(page.getByTestId('preview-card')).toBeVisible();
}

const approve = (page: Page) => page.getByRole('button', { name: 'Approve & Analyze' });

test.describe('start-up', () => {
  test('opens in fixture mode, with live switched off and the reason shown', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'T900 Evidence Check', level: 1 })).toBeVisible();

    const banner = page.getByTestId('mode-banner');
    await expect(banner).toHaveAttribute('data-mode', 'fixture');
    await expect(banner).toContainText(FIXTURE_NOTICE);
    await expect(banner).toContainText('Nothing is sent to any provider');

    await expect(page.getByRole('radio', { name: /^Fixture/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: /^Live/ })).toBeDisabled();
    await expect(page.getByTestId('live-unavailable')).toContainText('META_API_KEY');
  });

  test('lists the three synthetic examples, each labelled as synthetic', async ({ page }) => {
    await page.goto('/');
    for (const example of examples) {
      await expect(page.getByTestId(`example-${example.slug}`)).toBeVisible();
    }
    await expect(page.getByText('Synthetic example', { exact: true })).toHaveCount(examples.length);
  });

  test('shows the task, every source passage, and which are in the pack', async ({ page }) => {
    const example = examples[0]!;
    await open(page, example);
    const sources = page.getByTestId('sources');
    await expect(sources).toContainText(example.input.task);
    for (const passage of example.input.sources) {
      const row = sources.locator(`[data-passage-id="${passage.id}"]`);
      await expect(row).toContainText(passage.text);
      await expect(row).toContainText(example.input.pack.includes(passage.id) ? 'In pack' : 'Not in pack');
    }
  });
});

for (const example of examples) {
  test.describe(`example: ${example.slug}`, () => {
    test('preview, explicit approval, four-bucket findings, repairs and revised pack', async ({ page }) => {
      const analyzeRequests: string[] = [];
      const foreignRequests: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.hostname !== 'localhost') foreignRequests.push(request.url());
        if (url.pathname === '/api/analyze') analyzeRequests.push(request.url());
      });

      await open(page, example);

      // 1. The preview shows the exact text, and its hash is the SHA-256 of that text.
      const text = (await page.getByTestId('preview-text').textContent()) ?? '';
      const hash = (await page.getByTestId('preview-hash').textContent()) ?? '';
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(hash).toBe(sha256(text));
      expect(text.startsWith('mode: fixture\n')).toBe(true);
      expect(text).toContain(example.input.task);
      for (const passage of example.input.sources) expect(text).toContain(passage.id);
      await expect(page.getByTestId('preview-card')).toContainText('nothing is sent anywhere');

      // 2. Nothing has been analysed yet, and nothing was requested.
      await expect(page.getByTestId('findings')).toHaveCount(0);
      await expect(approve(page)).toBeEnabled();
      expect(analyzeRequests).toEqual([]);

      // 3. Approve & Analyze is the only trigger.
      await approve(page).click();
      await expect(page.getByTestId('findings')).toBeVisible();
      expect(analyzeRequests).toHaveLength(1);

      await expect(page.getByTestId('result-notice')).toHaveText(FIXTURE_NOTICE);
      await expect(page.getByTestId('result-source')).toContainText('No model was called');

      // 4. All four buckets, in order, with the right counts and contents.
      const headings = page.getByTestId('findings').locator('h3');
      await expect(headings).toHaveText(
        BUCKETS.map(([status, title]) => `${title} (${example.fixtureOutput.requirements.filter((r) => r.status === status).length})`),
      );
      for (const [status] of BUCKETS) {
        const expected = example.fixtureOutput.requirements.filter((r) => r.status === status);
        const bucket = page.getByTestId(`bucket-${status}`);
        await expect(bucket.getByTestId('requirement')).toHaveCount(expected.length);
        if (expected.length === 0) await expect(bucket).toContainText('None.');
        for (const requirement of expected) {
          const card = bucket.locator(`[data-requirement-id="${requirement.id}"]`);
          await expect(card).toContainText(requirement.text);
          await expect(card).toContainText(requirement.rationale);
          for (const evidence of requirement.evidence) {
            await expect(card).toContainText(evidence.quote);
            await expect(card).toContainText(evidence.passageId);
          }
        }
      }

      // 5. Repairs are proposed, none is pre-selected, and Apply is disabled.
      const repairs = page.getByTestId('repairs');
      const boxes = repairs.getByRole('checkbox');
      await expect(boxes).toHaveCount(example.fixtureOutput.repairs.length);
      for (let i = 0; i < example.fixtureOutput.repairs.length; i += 1) await expect(boxes.nth(i)).not.toBeChecked();
      await expect(repairs.getByRole('button', { name: /^Apply/ })).toBeDisabled();
      await expect(page.getByTestId('revised-pack')).toHaveCount(0);

      // 6. Approve every repair and apply.
      for (let i = 0; i < example.fixtureOutput.repairs.length; i += 1) await boxes.nth(i).check();
      const count = example.fixtureOutput.repairs.length;
      await repairs.getByRole('button', { name: `Apply ${count} approved repair${count === 1 ? '' : 's'}` }).click();

      const revised = page.getByTestId('revised-pack');
      await expect(revised).toBeVisible();
      const added = [...new Set(example.fixtureOutput.repairs.map((r) => r.passageId))];
      const size = example.input.pack.length + added.length;
      await expect(revised.getByRole('heading', { level: 2 })).toHaveText(`Revised context pack (${size} passages)`);
      await expect(revised.getByTestId('revised-pack-item')).toHaveCount(size);
      await expect(revised.getByTestId('added-tag')).toHaveCount(added.length);

      // 7. Added text is the original source text, byte for byte. Original pack items are untouched.
      for (const id of added) {
        const source = example.input.sources.find((p) => p.id === id)!;
        await expect(revised.locator(`[data-passage-id="${id}"]`).getByTestId('added-text')).toHaveText(source.text);
      }
      for (const id of example.input.pack) {
        await expect(revised.locator(`[data-passage-id="${id}"]`).getByTestId('added-tag')).toHaveCount(0);
      }

      // 8. Fixture mode never leaves localhost.
      expect(foreignRequests).toEqual([]);
    });
  });
}

test.describe('approval and repair behaviour', () => {
  const refund = examples.find((e) => e.slug === 'refund-window')!;

  test('applying a subset adds only that repair', async ({ page }) => {
    await open(page, refund);
    await approve(page).click();
    const repairs = page.getByTestId('repairs');
    await expect(repairs).toBeVisible();

    await repairs.getByRole('checkbox').first().check();
    await repairs.getByRole('button', { name: 'Apply 1 approved repair' }).click();

    const revised = page.getByTestId('revised-pack');
    await expect(revised.getByTestId('revised-pack-item')).toHaveCount(refund.input.pack.length + 1);
    await expect(revised.getByTestId('added-tag')).toHaveCount(1);
  });

  test('changing the selection after applying hides the stale revised pack', async ({ page }) => {
    await open(page, refund);
    await approve(page).click();
    const repairs = page.getByTestId('repairs');
    await repairs.getByRole('checkbox').first().check();
    await repairs.getByRole('button', { name: /^Apply 1/ }).click();
    await expect(page.getByTestId('revised-pack')).toBeVisible();

    await repairs.getByRole('checkbox').nth(1).check();
    await expect(page.getByTestId('revised-pack')).toHaveCount(0);
    await expect(repairs.getByRole('button', { name: 'Apply 2 approved repairs' })).toBeEnabled();
  });

  test('switching example discards the old preview, findings and selections', async ({ page }) => {
    const other = examples.find((e) => e.slug !== refund.slug)!;
    await open(page, refund);
    const firstHash = await page.getByTestId('preview-hash').textContent();
    await approve(page).click();
    await page.getByTestId('repairs').getByRole('checkbox').first().check();
    await expect(page.getByTestId('findings')).toBeVisible();

    await page.getByTestId(`example-${other.slug}`).check();
    await expect(page.getByTestId('findings')).toHaveCount(0);
    await expect(page.getByTestId('repairs')).toHaveCount(0);
    await expect(page.getByTestId('revised-pack')).toHaveCount(0);
    await expect(page.getByTestId('preview-hash')).not.toHaveText(firstHash ?? '');
  });

  test('an approval that does not match the text is refused, and no findings appear', async ({ page }) => {
    await page.route('**/api/analyze', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      await route.continue({ postData: JSON.stringify({ ...body, approvedHash: 'a'.repeat(64) }) });
    });
    await open(page, refund);
    await approve(page).click();

    const error = page.getByTestId('error-card');
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('data-error-code', 'approval_mismatch');
    await expect(error).toContainText('approve it again');
    await expect(page.getByTestId('findings')).toHaveCount(0);
  });

  test('a server error is shown as an error, not as findings', async ({ page }) => {
    await page.route('**/api/analyze', (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'model_upstream', message: 'The provider had a server error (HTTP 500).', retryable: true } }),
      }),
    );
    await open(page, refund);
    await approve(page).click();
    await expect(page.getByTestId('error-card')).toContainText('server error');
    await expect(page.getByTestId('findings')).toHaveCount(0);
  });

  test('a failed validation shows the issues and what the model returned', async ({ page }) => {
    await page.route('**/api/analyze', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'invalid_model_output',
            message: 'The model answered, but the answer failed validation, so no findings are shown.',
            issues: [{ code: 'unknown_passage_id', path: 'requirements[0].evidence[0].passageId', message: 'Unknown passage ID "refund-99".' }],
            rawOutput: '{"requirements":[]}',
            retryable: true,
          },
        }),
      }),
    );
    await open(page, refund);
    await approve(page).click();
    const error = page.getByTestId('error-card');
    await expect(error).toContainText('unknown_passage_id');
    await expect(error).toContainText('refund-99');
    await expect(error.getByText('What the model returned')).toBeVisible();
    await expect(page.getByTestId('findings')).toHaveCount(0);
  });
});
