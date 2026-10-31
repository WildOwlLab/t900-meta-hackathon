/**
 * Final polish checks, in the FIXTURE stack and in Chromium (the only browser available in the build
 * environment): layout at phone, tablet and desktop sizes in light and dark mode, touch targets, badge
 * spacing, an automated accessibility scan, console errors, and keyboard use.
 *
 * Firefox and Safari were NOT tested. The CSS and download code are written to avoid their known traps,
 * but that is not the same as having run them.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const VIEWPORTS = [
  { name: 'small phone', width: 320, height: 640 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const SCHEMES = ['light', 'dark'] as const;

/** Everything that would look broken: sideways scrolling, off-screen content, clipped or colliding badges, tiny tap targets. */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const vw = document.documentElement.clientWidth;
    const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ').join('.')}` : ''} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };

    if (document.documentElement.scrollWidth > vw + 1) {
      problems.push(`the page scrolls sideways: content is ${document.documentElement.scrollWidth}px wide in a ${vw}px window`);
    }

    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('pre') || el.closest('select') || !visible(el)) continue; // <pre> scrolls inside its own box
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) problems.push(`${describe(el)} sticks out of the window (${Math.round(r.left)} to ${Math.round(r.right)}px of ${vw}px)`);
    }

    // Text that wraps has one box PER LINE. getBoundingClientRect() would merge them into one tall box and
    // report overlaps that are not there, so every comparison below uses the per-line boxes.
    const lineBoxes = (el: Element) => [...el.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;

    for (const tag of document.querySelectorAll<HTMLElement>('.tag')) {
      if (!visible(tag)) continue;
      if (tag.scrollWidth > tag.clientWidth + 1) problems.push(`badge text is clipped: ${describe(tag)}`);
      const mine = lineBoxes(tag);
      for (const sibling of [tag.previousElementSibling, tag.nextElementSibling]) {
        if (!sibling || !visible(sibling)) continue;
        const theirs = lineBoxes(sibling);
        if (mine.some((a) => theirs.some((b) => overlap(a, b)))) {
          problems.push(`badge overlaps its neighbour: ${describe(tag)} and ${describe(sibling)}`);
          continue;
        }
        // On the same line, the two must not touch. Whitespace between inline elements gives a few pixels.
        for (const a of mine) {
          for (const b of theirs) {
            const sameLine = a.top < b.bottom && a.bottom > b.top;
            const gap = Math.min(Math.abs(a.left - b.right), Math.abs(b.left - a.right));
            if (sameLine && gap < 2) problems.push(`badge touches its neighbour (${gap.toFixed(1)}px gap): ${describe(tag)}`);
          }
        }
      }
    }

    if (vw <= 640) {
      for (const el of document.querySelectorAll<HTMLElement>('button, select, textarea, input:not([type=checkbox]):not([type=radio])')) {
        if (!visible(el)) continue;
        const h = el.getBoundingClientRect().height;
        if (h < 43.5) problems.push(`tap target is only ${Math.round(h)}px tall (44px is comfortable): ${describe(el)}`);
      }
      for (const el of document.querySelectorAll<HTMLInputElement>('input[type=checkbox], input[type=radio]')) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 20) problems.push(`checkbox or radio is only ${Math.round(r.width)}x${Math.round(r.height)}px: ${describe(el)}`);
        const label = el.labels?.[0];
        if (label && label.getBoundingClientRect().height < 24) problems.push(`the label for a checkbox or radio is under 24px tall: ${describe(label)}`);
      }
    }
    return problems;
  });
}

async function accessibilityProblems(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.map((v) => `${v.id} (${v.impact}): ${v.help}. First elements: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

const approve = (page: Page) => page.getByRole('button', { name: 'Approve & Analyze' });

// ---------------------------------------------------------------------------

for (const viewport of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    test(`layout and accessibility: ${viewport.name} (${viewport.width}px), ${scheme} mode`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ colorScheme: scheme });
      const scanAccessibility = viewport.width === 390 || viewport.width === 1280;

      const check = async (state: string) => {
        expect(await layoutProblems(page), `layout, ${state}`).toEqual([]);
        if (scanAccessibility) expect(await accessibilityProblems(page), `accessibility, ${state}`).toEqual([]);
      };

      // 1. The built-in examples, with a preview.
      await page.goto('/');
      await expect(page.getByTestId('preview-card')).toBeVisible();
      await check('built-in examples and preview');

      // 2. Results, repairs, the revised pack and the export panel.
      await approve(page).click();
      await expect(page.getByTestId('findings')).toBeVisible();
      await page.getByTestId('repairs').getByRole('checkbox').first().check();
      await page.getByTestId('repairs').getByRole('checkbox').nth(1).check();
      await page.getByRole('button', { name: /^Apply 2/ }).click();
      await expect(page.getByTestId('export')).toBeVisible();
      await expect(page.getByTestId('revised-pack')).toBeVisible();
      await check('findings, repairs, revised pack and export');

      // 3. The custom editor, stressed with an unbroken 150-character string and a long title.
      await page.getByRole('tab', { name: 'Custom input' }).click();
      await page.getByTestId('custom-task').fill(`What is the limit for ${'x'.repeat(150)} and how does it reset every single day of the year?`);
      await page.getByTestId('custom-bulk').fill(`${'y'.repeat(150)}\n\nA normal passage about limits.\n\nAnother one.`);
      await page.getByTestId('custom-bulk-add').click();
      await page.getByTestId('custom-passage').nth(1).getByLabel('Title').fill(`A very long title ${'z'.repeat(80)} for a passage`);
      await page.getByTestId('custom-passage').nth(1).getByLabel('In the context pack').check();
      await expect(page.getByTestId('custom-valid')).toBeVisible();
      await expect(page.getByTestId('approve-blocked')).toBeVisible();
      await check('custom editor with long strings and a blocked Approve');

      // 4. The editor with a problem to report.
      await page.getByTestId('custom-passage').nth(1).getByLabel('ID', { exact: true }).fill('p1');
      await expect(page.getByTestId('custom-issues')).toBeVisible();
      await check('custom editor with validation messages');

      // 5. An error card with a long raw model answer and several issues.
      await page.getByRole('tab', { name: 'Built-in examples' }).click();
      await page.route('**/api/analyze', (route) =>
        route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'invalid_model_output',
              message: 'The model answered, but the answer failed validation, so no findings are shown.',
              issues: [
                { code: 'unknown_passage_id', path: 'requirements[0].evidence[0].passageId', message: `Unknown passage ID "${'q'.repeat(90)}".` },
                { code: 'quote_not_in_passage', path: 'requirements[1].evidence[0].quote', message: 'Quote is not an exact span of passage "refund-01".' },
              ],
              rawOutput: `{"requirements":[{"id":"r1","text":"${'long '.repeat(80)}"}]}`,
              retryable: true,
            },
          }),
        }),
      );
      await expect(page.getByTestId('preview-card')).toBeVisible();
      await approve(page).click();
      await expect(page.getByTestId('error-card')).toBeVisible();
      await check('error card');
    });
  }
}

test('a normal session produces no console errors, warnings, page errors or failed requests', async ({ page }) => {
  const noise: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') noise.push(`console ${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => noise.push(`page error: ${error.message}`));
  page.on('requestfailed', (request) => noise.push(`request failed: ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', (response) => {
    if (response.status() >= 400) noise.push(`HTTP ${response.status()}: ${response.url()}`);
  });

  await page.goto('/');
  for (const slug of ['refund-window', 'retention-conflict', 'expense-injection']) {
    await page.getByTestId(`example-${slug}`).check();
    await expect(page.getByTestId('preview-card')).toBeVisible();
    await approve(page).click();
    await expect(page.getByTestId('findings')).toBeVisible();
    await page.getByTestId('repairs').getByRole('checkbox').first().check();
    await page.getByRole('button', { name: /^Apply 1/ }).click();
    await expect(page.getByTestId('revised-pack')).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Custom input' }).click();
  await page.getByTestId('custom-load-example').click();
  await expect(page.getByTestId('custom-valid')).toBeVisible();
  await page.getByRole('tab', { name: 'Built-in examples' }).click();

  expect(noise).toEqual([]);
});

test('the page declares an icon, so no /favicon.ico request is made and none fails', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  await page.goto('/');
  await expect(page.getByTestId('preview-card')).toBeVisible();
  expect(await page.locator('link[rel="icon"]').count()).toBe(1);
  expect(requested).not.toContain('/favicon.ico');
});

test.describe('keyboard use', () => {
  test('tabs follow the standard pattern: arrows, Home and End move between them, and only the selected tab is in the tab order', async ({ page }) => {
    await page.goto('/');
    const examples = page.getByRole('tab', { name: 'Built-in examples' });
    const custom = page.getByRole('tab', { name: 'Custom input' });
    await expect(examples).toHaveAttribute('tabindex', '0');
    await expect(custom).toHaveAttribute('tabindex', '-1');

    await examples.focus();
    await page.keyboard.press('ArrowRight');
    await expect(custom).toHaveAttribute('aria-selected', 'true');
    await expect(custom).toBeFocused();
    await expect(custom).toHaveAttribute('tabindex', '0');

    await page.keyboard.press('ArrowRight'); // wraps round
    await expect(examples).toHaveAttribute('aria-selected', 'true');
    await expect(examples).toBeFocused();

    await page.keyboard.press('End');
    await expect(custom).toBeFocused();
    await page.keyboard.press('Home');
    await expect(examples).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // wraps the other way
    await expect(custom).toHaveAttribute('aria-selected', 'true');
  });

  test('the whole flow works without a mouse', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('preview-card')).toBeVisible();

    await approve(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('findings')).toBeVisible();

    const firstRepair = page.getByTestId('repairs').getByRole('checkbox').first();
    await firstRepair.focus();
    await page.keyboard.press('Space');
    await expect(firstRepair).toBeChecked();

    const apply = page.getByRole('button', { name: /^Apply 1/ });
    await apply.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('revised-pack')).toBeVisible();
  });

  test('the outbound text can be scrolled and read from the keyboard', async ({ page }) => {
    await page.goto('/');
    const preview = page.getByTestId('preview-text');
    await expect(preview).toBeVisible();
    await preview.focus();
    await expect(preview).toBeFocused();
    expect(await preview.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true); // it really is a scroll box
    expect(await preview.evaluate((el) => el.scrollTop)).toBe(0);
    await page.keyboard.press('PageDown');
    // Browsers animate keyboard scrolling, so wait for it rather than reading the position once.
    await expect.poll(() => preview.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  });

  test('keyboard focus is always visible', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Built-in examples' }).focus();
    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement!);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(outline.style).not.toBe('none');
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  });
});
