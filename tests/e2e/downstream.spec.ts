/**
 * The Downstream Comparison panel in FIXTURE mode, in a real browser, for all three built-in examples.
 *
 * The answers on screen are hand-written (src/examples/downstream.ts). These tests prove the panel's behaviour:
 * what it shows, how it is labelled, that it makes no server call, that it resets when the pack changes, and that
 * it lays out and passes an accessibility scan. They say nothing about how any model behaves. The live path is
 * tested in live-stub.spec.ts against a stub provider.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { examples, type Example } from '../../src/examples';
import { getDownstreamIllustration } from '../../src/examples/downstream';
import { FIXTURE_NOTICE } from '../../src/shared/types';

const compareButton = (page: Page) => page.getByTestId('downstream').getByRole('button', { name: 'Compare Downstream Task' });

/** Analyze an example, then approve and apply `count` of its proposed repairs (all of them by default). */
async function reachRevisedPack(page: Page, example: Example, count = example.fixtureOutput.repairs.length) {
  await page.goto('/');
  await page.getByTestId(`example-${example.slug}`).check();
  await expect(page.getByTestId('preview-card')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & Analyze' }).click();
  await expect(page.getByTestId('findings')).toBeVisible();
  const boxes = page.getByTestId('repairs').getByRole('checkbox');
  for (let i = 0; i < count; i += 1) await boxes.nth(i).check();
  await page.getByRole('button', { name: `Apply ${count} approved repair${count === 1 ? '' : 's'}` }).click();
  await expect(page.getByTestId('revised-pack')).toBeVisible();
}

function watchDownstreamCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/downstream')) calls.push(request.url());
  });
  return calls;
}

for (const example of examples) {
  const illustration = getDownstreamIllustration(example.slug)!;

  test.describe(`downstream comparison: ${example.slug}`, () => {
    test('the panel sits under the revised pack and shows nothing until the button is clicked', async ({ page }) => {
      await reachRevisedPack(page, example);
      const panel = page.getByTestId('downstream');
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('heading', { name: 'Downstream Comparison', level: 3 })).toBeVisible();
      await expect(compareButton(page)).toBeEnabled();
      await expect(panel.getByTestId('downstream-result')).toHaveCount(0);
      await expect(page.getByTestId('revised-pack').getByTestId('downstream')).toHaveCount(1); // inside the revised pack section

      // It comes after the list of revised passages.
      const order = await page.getByTestId('revised-pack').evaluate((section) =>
        [...section.children].map((child) => child.getAttribute('data-testid') ?? child.tagName.toLowerCase()),
      );
      expect(order.at(-1)).toBe('downstream');
    });

    test('shows both hand-written answers side by side, labelled as not a model result, with no server call', async ({ page }) => {
      const calls = watchDownstreamCalls(page);
      await reachRevisedPack(page, example);
      await compareButton(page).click();

      const result = page.getByTestId('downstream-result');
      await expect(result).toHaveAttribute('data-source', 'fixture');
      await expect(page.getByTestId('downstream-notice')).toContainText(FIXTURE_NOTICE);
      await expect(page.getByTestId('downstream-notice')).toContainText('No model was called');

      const left = page.getByTestId('downstream-initial');
      const right = page.getByTestId('downstream-repaired');
      await expect(left.getByRole('heading', { name: 'Initial Pack Response', level: 4 })).toBeVisible();
      await expect(right.getByRole('heading', { name: 'T900 Repaired Pack Response', level: 4 })).toBeVisible();

      await expect(page.getByTestId('downstream-initial-answer')).toHaveText(illustration.initial.answer);
      await expect(page.getByTestId('downstream-repaired-answer')).toHaveText(illustration.repaired.answer);

      // Each side says which passages it was given.
      await expect(page.getByTestId('downstream-initial-context')).toHaveText(
        `Context: ${example.input.pack.length} passages (${example.input.pack.join(', ')})`,
      );
      const revised = [...example.input.pack, ...illustration.needs];
      await expect(page.getByTestId('downstream-repaired-context')).toHaveText(`Context: ${revised.length} passages (${revised.join(', ')})`);

      // What goes wrong on the left, what stays open on the right.
      await expect(page.getByTestId('downstream-problems').getByRole('listitem')).toHaveText(illustration.initial.problems as string[]);
      await expect(page.getByTestId('downstream-limits').getByRole('listitem')).toHaveText(illustration.repaired.limits as string[]);

      // Side by side on a desktop window: same row, left before right.
      const a = (await left.boundingBox())!;
      const b = (await right.boundingBox())!;
      expect(a.x).toBeLessThan(b.x);
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);

      expect(calls).toEqual([]); // fixture mode never calls the server for this
    });

    test('the right side cites the passages the repair added, and the left side does not', async ({ page }) => {
      await reachRevisedPack(page, example);
      await compareButton(page).click();
      for (const id of illustration.needs) {
        await expect(page.getByTestId('downstream-repaired-answer')).toContainText(`[${id}]`);
        await expect(page.getByTestId('downstream-initial-answer')).not.toContainText(`[${id}]`);
      }
    });

    test('is gone when the repairs change, and starts closed again when they are re-applied', async ({ page }) => {
      const count = example.fixtureOutput.repairs.length;
      await reachRevisedPack(page, example);
      await compareButton(page).click();
      await expect(page.getByTestId('downstream-result')).toBeVisible();

      // Changing the selection discards the revised pack, and the comparison with it.
      const first = page.getByTestId('repairs').getByRole('checkbox').first();
      await first.uncheck();
      await expect(page.getByTestId('revised-pack')).toHaveCount(0);
      await expect(page.getByTestId('downstream')).toHaveCount(0);
      await expect(page.getByTestId('downstream-result')).toHaveCount(0);

      // Selecting it again and re-applying gives the same pack, but the old comparison is not carried over.
      await first.check();
      await page.getByRole('button', { name: `Apply ${count} approved repair${count === 1 ? '' : 's'}` }).click();
      await expect(page.getByTestId('revised-pack')).toBeVisible();
      await expect(page.getByTestId('downstream')).toBeVisible();
      await expect(page.getByTestId('downstream-result')).toHaveCount(0);
      await expect(compareButton(page)).toBeEnabled();
    });

    test('is gone when another example is chosen', async ({ page }) => {
      await reachRevisedPack(page, example);
      await compareButton(page).click();
      await expect(page.getByTestId('downstream-result')).toBeVisible();
      const other = examples.find((candidate) => candidate.slug !== example.slug)!;
      await page.getByTestId(`example-${other.slug}`).check();
      await expect(page.getByTestId('downstream')).toHaveCount(0);
      await expect(page.getByTestId('downstream-result')).toHaveCount(0);
    });
  });
}

test.describe('downstream comparison: a partly repaired pack', () => {
  const refund = examples.find((example) => example.slug === 'refund-window')!;
  const illustration = getDownstreamIllustration('refund-window')!;

  test('shows the initial side, and says the hand-written repaired answer needs every proposed repair', async ({ page }) => {
    expect(illustration.needs.length).toBeGreaterThan(1);
    await reachRevisedPack(page, refund, 1);
    await compareButton(page).click();

    await expect(page.getByTestId('downstream-initial-answer')).toHaveText(illustration.initial.answer);
    await expect(page.getByTestId('downstream-repaired-answer')).toHaveCount(0);
    const note = page.getByTestId('downstream-needs-more');
    await expect(note).toBeVisible();
    await expect(note).toContainText('refund-05'); // the repair that was not applied
    await expect(note).toContainText('Apply every proposed repair');
    // The right side is not shown as if it were this pack's answer.
    await expect(page.getByTestId('downstream-limits')).toHaveCount(0);
  });
});

test.describe('downstream comparison: layout and accessibility', () => {
  const refund = examples.find((example) => example.slug === 'refund-window')!;

  for (const viewport of [
    { name: 'small phone', width: 320, height: 640 },
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1280, height: 800 },
  ]) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${viewport.name} (${viewport.width}px), ${scheme} mode: no sideways scrolling, nothing off-screen, no accessibility violations`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.emulateMedia({ colorScheme: scheme });
        await reachRevisedPack(page, refund);
        await compareButton(page).click();
        await expect(page.getByTestId('downstream-result')).toBeVisible();

        const problems = await page.evaluate(() => {
          const out: string[] = [];
          const vw = document.documentElement.clientWidth;
          if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth}px in ${vw}px`);
          for (const el of document.querySelectorAll('[data-testid=downstream] *')) {
            if (el.closest('pre')) continue;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) out.push(`${el.tagName.toLowerCase()} sticks out (${Math.round(r.left)} to ${Math.round(r.right)} of ${vw})`);
          }
          return out;
        });
        expect(problems).toEqual([]);

        const left = (await page.getByTestId('downstream-initial').boundingBox())!;
        const right = (await page.getByTestId('downstream-repaired').boundingBox())!;
        if (viewport.width >= 768) {
          expect(right.x).toBeGreaterThan(left.x); // side by side
          expect(Math.abs(left.y - right.y)).toBeLessThan(2);
        } else {
          expect(right.y).toBeGreaterThan(left.y + left.height - 2); // stacked, left first
          expect(Math.abs(left.x - right.x)).toBeLessThan(2);
        }

        if (viewport.width === 390 || viewport.width === 1280) {
          const { violations } = await new AxeBuilder({ page }).analyze();
          expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
        }
      });
    }
  }
});
