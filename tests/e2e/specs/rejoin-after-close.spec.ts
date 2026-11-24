import { chromium, devices, expect, test, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A player's whole browser closes in the middle of a game, and opens again on the same profile. The game in progress must be
// offered prominently, on the front page and on the Multiplayer screen, and clicking it must return them to the table.
// Only the guest variant runs here: the server allows ten game creations per address per ten minutes, and the other specs use
// most of that budget. The host variant is the same saved seat and the same reconnect, and the unit tests cover the offer.
for (const role of ['guest'] as const) {
  test(`a ${role} whose browser closed mid-game can rejoin from the front page and from the Multiplayer screen`, async ({ browser }, testInfo: TestInfo) => {
    test.setTimeout(240_000);
    const options: BrowserContextOptions = testInfo.project.name === 'mobile-chromium'
      ? { ...devices['Pixel 7'], baseURL: 'http://localhost:5173' }
      : { baseURL: 'http://localhost:5173', viewport: { width: 1200, height: 900 } };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upndown-rejoin-'));

    // The other seat stays open. The host adds a robot, so the table is not waiting on a person.
    const other = await browser.newContext({ baseURL: 'http://localhost:5173' });
    const otherPage = await other.newPage();
    await otherPage.goto('/');
    await otherPage.getByTestId('mode-multiplayer').click();
    await otherPage.locator('#player-name-input').fill('Host');
    await otherPage.getByTestId('flow-host').click();
    const heading = otherPage.getByRole('heading', { name: /Game [A-Z0-9]{6}/ });
    await expect(heading).toBeVisible();
    const gameId = ((await heading.textContent()) ?? '').replace('Game ', '').trim();
    await otherPage.getByTestId('add-robot').click();

    // The player who will close their browser.
    const first = await chromium.launchPersistentContext(dir, options);
    const page = first.pages()[0] ?? (await first.newPage());
    await page.goto('/');
    await page.getByTestId('mode-multiplayer').click();
    if (role === 'guest') {
      await page.getByTestId('flow-join').click();
      await page.locator('#player-name-input').fill('Guest');
      await page.getByTestId('show-join-by-id').click();
      await page.locator('#game-id-input').fill(gameId);
      await page.getByTestId('lookup-game').click();
      await page.getByTestId('join-game').click();
      await expect(otherPage.getByText('Guest')).toBeVisible();
      await otherPage.getByTestId('start-game').click();
    } else {
      await page.locator('#player-name-input').fill('Ken');
      await page.getByTestId('flow-host').click();
      await expect(page.getByRole('heading', { name: /Game [A-Z0-9]{6}/ })).toBeVisible();
      await page.getByTestId('add-robot').click();
      await page.getByTestId('start-game').click();
    }
    await expect(page.getByText('Your Hand', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await first.close();

    const second = await chromium.launchPersistentContext(dir, options);
    const back = second.pages()[0] ?? (await second.newPage());
    await back.goto('/');
    await expect(back.getByTestId('rejoin-game')).toBeVisible({ timeout: 10_000 });

    await back.getByTestId('mode-multiplayer').click();
    await expect(back.getByTestId('rejoin-game')).toBeVisible();
    await back.getByTestId('rejoin-game').click();
    await expect(back.getByText('Your Hand', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    await second.close();
    await other.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}
