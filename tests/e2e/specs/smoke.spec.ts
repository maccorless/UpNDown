import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function playFirstCardToPile(page: Page, pileId: number): Promise<void> {
  await expect(page.getByRole('status')).toHaveText('Ready');

  const handCards = page.locator('[data-testid^="hand-card-"]');
  const handBefore = await handCards.count();
  if (handBefore === 0) {
    throw new Error('No cards in hand');
  }

  const firstCard = handCards.first();
  await firstCard.dispatchEvent('click');
  await page.getByTestId(`pile-${pileId}`).dispatchEvent('click');
  await expect(page.getByRole('status')).toHaveText('Ready');
  await expect(handCards).toHaveCount(handBefore - 1);
}

test('@smoke app shell renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'UpNDown' })).toBeVisible();
  await expect(page.getByTestId('mode-solitaire')).toBeVisible();
  await expect(page.getByTestId('mode-multiplayer')).toBeVisible();
});

test('@smoke accessibility baseline has no serious violations', async ({ page }) => {
  await page.goto('/');

  const analysis = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = analysis.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? '')
  );

  expect(seriousOrWorse).toEqual([]);
});

test('multiplayer create/join/start/play/end-turn flow', async ({ browser, page }) => {
  await page.goto('/');
  await page.getByTestId('mode-multiplayer').click();
  await page.locator('#player-name-input').fill('Host');
  await page.getByTestId('flow-host').click();

  await expect(page.getByRole('heading', { name: /Game [A-Z0-9]{6}/ })).toBeVisible();

  const headingText = await page.getByRole('heading', { name: /Game [A-Z0-9]{6}/ }).textContent();
  const gameId = headingText?.replace('Game ', '').trim();
  if (!gameId) {
    throw new Error('failed to parse game id');
  }

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();

  try {
    await guestPage.goto('/');
    await guestPage.getByTestId('mode-multiplayer').click();
    await guestPage.getByTestId('flow-join').click();
    await guestPage.locator('#player-name-input').fill('Guest');
    await guestPage.getByTestId('show-join-by-id').click();
    await guestPage.locator('#game-id-input').fill(gameId);
    await guestPage.getByTestId('lookup-game').click();
    await expect(guestPage.getByTestId('private-lookup-result')).toBeVisible();
    await guestPage.getByTestId('join-game').click();

    await expect(page.getByText('Guest')).toBeVisible();

    await page.getByTestId('start-game').click();

    await expect(page.getByRole('heading', { name: 'Your Hand' })).toBeVisible();
    await expect(guestPage.getByRole('heading', { name: 'Your Hand' })).toBeVisible();

    await playFirstCardToPile(page, 0);
    await expect(page.getByTestId('end-turn')).toBeDisabled();

    await playFirstCardToPile(page, 2);
    await expect(page.getByTestId('end-turn')).toBeEnabled();
    await page.getByTestId('end-turn').click();
    await expect(page.getByRole('status')).toHaveText('Ready');

    await expect(page.getByTestId('end-turn')).toBeDisabled();
    await expect(guestPage.getByTestId('end-turn')).toBeDisabled();
  } finally {
    await guestContext.close();
  }
});
