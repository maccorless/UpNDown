import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/client/public/how-to-play');
const shot = async (page: Page, name: string): Promise<void> => {
  // Let entrance animations finish, so the picture shows the screen as it settles.
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
};

// Multiplayer settings with every cheat on (once), so the cheats panel has something to show.
const withCheats = (): string => JSON.stringify({
  solitaire: { minCardValue: 2, maxCardValue: 99, handSize: 7, minPlayers: 1, maxPlayers: 1, minCardsPerTurn: 2, autoRefillHand: true, allowUndo: false, privateGame: false, allowCardLookup: false },
  multiplayer: { minCardValue: 2, maxCardValue: 99, handSize: 7, minPlayers: 2, maxPlayers: 6, minCardsPerTurn: 2, autoRefillHand: false, allowUndo: true, privateGame: false, allowCardLookup: false, cheatLimits: { lookup: 'once', skip: 'once', trade: 'once', hint: 'once' } }
});

test('pictures for the How to Play page', async ({ page }) => {
  await page.addInitScript((settings) => {
    // A name the player chose, so nothing waits on a prompt; settings with the cheats on.
    window.localStorage.setItem('upndown.multiplayer.playerName.v1', 'Alex');
    window.localStorage.setItem('upndown.settings.v1', settings);
  }, withCheats());

  // The home page.
  await page.goto('/');
  await expect(page.getByTestId('mode-solitaire')).toBeVisible();
  await shot(page, 'landing');

  // Solitaire: the board, then a card chosen.
  await page.getByTestId('mode-solitaire').click();
  await page.getByTestId('start-solitaire').click();
  await expect(page.locator('[data-testid^="hand-card-"]').first()).toBeVisible();
  await shot(page, 'solitaire-board');
  await page.locator('[data-testid^="hand-card-"]').first().click();
  await shot(page, 'solitaire-card-chosen');

  // Multiplayer: a table with a robot, then the game, then the cheats.
  await page.goto('/');
  await page.getByTestId('mode-multiplayer').click();
  await page.getByTestId('flow-host').click();
  await expect(page.getByTestId('add-robot')).toBeVisible();
  await page.getByTestId('add-robot').click();
  await expect(page.locator('.players-list')).toContainText('[Robot]');
  await shot(page, 'lobby');
  // Settings, as the host, where they can be changed: the game rules tab, scrolled to the cheats.
  await page.getByRole('button', { name: /settings/i }).first().click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await page.locator('dialog[open]').getByText('Trade a card').first().scrollIntoViewIfNeeded();
  await shot(page, 'settings');
  await page.keyboard.press('Escape');
  await page.getByTestId('start-game').click();
  await expect(page.locator('[data-testid^="hand-card-"]').first()).toBeVisible();
  await shot(page, 'multiplayer-turn');
  await page.getByTestId('open-cheats').click();
  await expect(page.getByRole('dialog', { name: 'cheats' })).toBeVisible();
  await shot(page, 'cheats');
});
