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

test('replay playback, exact locations, shared episodes and paired rainfall maps work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#customers')).toHaveText('20');
  await page.locator('#previous').click();
  await expect(page.locator('#customers')).toHaveText('10');
  await page.locator('#play').click();
  await expect(page.locator('#customers')).toHaveText('20');
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-map-view="locations"]').click();
  await expect(page.locator('#spatial-status')).toHaveText('1 exact reporting location · 0 reused by 2+ source records');
  await expect(page.locator('#locations-csv')).toHaveAttribute('href', /view=locations/);
  const to = new Date(), from = new Date(to.getTime() - 2 * 3600000);
  await page.goto(`/?${new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), view: 'history' })}`);
  await expect(page.locator('#map-period')).toHaveValue('episode');
  await expect(page.locator('[data-days="episode"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#spatial-status')).toContainText('1 reported events');
  await page.locator('#episode-to').fill('2020-01-01T00:00');
  await page.locator('#episode-form button[type=submit]').click();
  await expect(page.locator('#episode-status')).toHaveText('The end must be after the start.');
  await page.locator('[data-map-view="rainfall"]').click();
  await expect(page.locator('#outage-map-figure')).toBeVisible();
  await expect(page.locator('#rainfall-status')).toContainText('No prepared rainfall period');
  expect(errors).toEqual([]);
});
