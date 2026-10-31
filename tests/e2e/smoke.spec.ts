import { expect, test } from '@playwright/test';

test('scaffold lists the synthetic examples and labels fixture mode', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'T900 Evidence Check', level: 1 })).toBeVisible();

  const banner = page.getByRole('status');
  await expect(banner).toContainText('Fixture mode');
  await expect(banner).toContainText('Not a model result');
  await expect(banner).toContainText('No model is called');

  await expect(page.getByTestId('example-card')).toHaveCount(3);
  await expect(page.getByText('Synthetic example', { exact: true })).toHaveCount(3);
});
