import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// A guest's history is kept in the browser. These tests put a few finished games there and read them back through the page.
const row = (n: number, outcome: 'won' | 'lost', endedAtMs: number) => ({
  gameId: `e2e-${n}`, mode: 'solitaire', outcome, startedAtMs: endedAtMs - 600_000, endedAtMs, durationMs: 600_000, turns: 20,
  playerCount: 1, robotCount: 0, cardsTotal: 98, cardsLeft: outcome === 'won' ? 0 : 12, cardsPlayed: outcome === 'won' ? 98 : 86, totalMovement: 300,
  specialPlays: 3, skips: 0, trades: 0, lookups: 0, hints: 0, undos: 0, marks: 0, playedLastCard: outcome === 'won', handSize: 7, minCardsPerTurn: 2, maxCard: 99,
  cheatsAllowed: false, undoAllowed: false
});

async function withHistory(page: Page): Promise<void> {
  const now = Date.now();
  const history = { v: 1, profileId: 'e2e', createdAtMs: now, rows: [row(1, 'won', now - 7_200_000), row(2, 'lost', now - 3_600_000)], rejected: [], seen: {} };
  await page.addInitScript((h) => { if (!window.localStorage.getItem('upndown.history.v1')) window.localStorage.setItem('upndown.history.v1', JSON.stringify(h)); }, history);
}

// The menu items are plain buttons where the browser has native focus groups, and menuitems where it does not.
async function pickProfileFromMenu(page: Page): Promise<void> {
  await page.locator('.profile-trigger').click();
  await page.locator('.profile-menu-list button', { hasText: /^Profile$/ }).click();
}

async function openProfile(page: Page): Promise<void> {
  await page.goto('/');
  await pickProfileFromMenu(page);
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
}

test('@smoke a guest with no games sees an empty profile and the note that it is saved on this device', async ({ page }) => {
  await openProfile(page);
  await expect(page.getByText('No games yet. Play one and your stats will show up here.')).toBeVisible();
  await expect(page.getByText('Stats are saved on this device.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Statistics' })).toHaveAttribute('aria-selected', 'true');
});

test('@smoke a guest\'s games stay after a reload, and the badges they earned are listed', async ({ page }) => {
  await withHistory(page);
  await openProfile(page);
  await expect(page.getByText('Win rate').first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Results, oldest first' }).getByRole('listitem')).toHaveCount(2);
  await page.reload();
  await pickProfileFromMenu(page);
  await expect(page.getByRole('list', { name: 'Results, oldest first' }).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('tab', { name: /^Achievements/ }).click();
  await expect(page.getByText('First Steps')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /\d+ of 34 earned/ })).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`@smoke the profile page has no serious accessibility problems in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await withHistory(page);
    await openProfile(page);
    for (const tab of ['Statistics', 'Achievements']) {
      await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
      const analysis = await new AxeBuilder({ page }).analyze();
      expect(analysis.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
    }
  });
}

test('@smoke erasing the history on this device asks first and then empties the profile', async ({ page }) => {
  await withHistory(page);
  await openProfile(page);
  await page.getByRole('button', { name: 'Erase history on this device' }).click();
  await expect(page.getByText(/deletes 2 games/)).toBeVisible();
  await page.getByRole('button', { name: 'Erase', exact: true }).click();
  await expect(page.getByText('No games yet. Play one and your stats will show up here.')).toBeVisible();
});
