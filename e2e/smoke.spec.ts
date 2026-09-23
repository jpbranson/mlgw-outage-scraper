import { test, expect } from '@playwright/test';

test('current and historical captures, spatial views, and exports work together', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#customers')).toHaveText('20');
  await expect(page.locator('#selected-note')).toContainText('Counts accepted; some source details need review');
  await page.locator('#previous').click();
  await expect(page.locator('#customers')).toHaveText('10');
  await expect(page.locator('#selection-mode')).toHaveText('Historical capture');
  await expect(page.locator('#geojson')).toHaveAttribute('href', /browser-a/);
  await page.locator('[data-map-view="history"]').click();
  await expect(page.locator('#spatial-status')).toContainText('1 reported events');
  await page.locator('[data-map-view="percapita"]').click();
  await expect(page.locator('#spatial-status')).toContainText('block groups');
  await page.locator('[data-map-view="capture"]').click();
  await expect(page.locator('#customers')).toHaveText('10');
  await page.locator('#latest').click();
  await expect(page.locator('#customers')).toHaveText('20');
  expect(errors).toEqual([]);
});

test('failed selection clears stale values and can recover', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#customers')).toHaveText('20');
  await page.route('**/api/snapshot/browser-a', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary failure' }) }));
  await page.locator('#previous').click();
  await expect(page.locator('#error-text')).toHaveText('Temporary failure');
  await expect(page.locator('#customers')).toHaveText('—');
  await page.unroute('**/api/snapshot/browser-a');
  await page.locator('#latest').click();
  await expect(page.locator('#customers')).toHaveText('20');
});
