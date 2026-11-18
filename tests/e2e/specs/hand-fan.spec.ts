import { expect, test, type Page } from '@playwright/test';
import { defaultMultiplayerSettings, defaultSolitaireSettings } from '@upndown/shared-types';

// A large hand is a fan of overlapping cards. The number on each card must stay readable: it is never covered where the screen has room,
// and where it must be, hovering the card brings it to the top.
async function openHand(page: Page, handSize: number): Promise<void> {
  await page.addInitScript((settings) => window.localStorage.setItem('upndown.settings.v1', JSON.stringify(settings)), { solitaire: { ...defaultSolitaireSettings, handSize }, multiplayer: defaultMultiplayerSettings });
  await page.goto('/');
  await page.getByTestId('mode-solitaire').click();
  await page.getByTestId('start-solitaire').click();
  await page.waitForSelector('.cards-fan .card');
}

// Indexes of cards whose digits reach under the next card.
const coveredDigits = (page: Page): Promise<number[]> => page.evaluate(() => {
  const cards = [...document.querySelectorAll<HTMLElement>('.cards-fan .card')];
  return cards.flatMap((card, i) => {
    const range = document.createRange();
    range.selectNodeContents(card);
    const next = cards[i + 1];
    return next && range.getBoundingClientRect().right > next.getBoundingClientRect().left + 0.5 ? [i] : [];
  });
});

for (const [width, height] of [[1280, 700], [768, 1024], [390, 844]] as const) {
  test(`@smoke the numbers on an 11 card hand never overlap at ${width}x${height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await openHand(page, 11);
    expect(await coveredDigits(page)).toEqual([]);
    await context.close();
  });
}

test('@smoke on the smallest phone a hovered card comes to the top so its number can be read', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  await openHand(page, 11);
  const [covered] = await coveredDigits(page);
  expect(covered, 'on 320px wide, 11 cards cannot all show their numbers').toBeDefined();
  await page.locator('.cards-fan .card').nth(covered!).hover({ position: { x: 4, y: 20 } });
  const readable = await page.evaluate((i) => {
    const card = document.querySelectorAll<HTMLElement>('.cards-fan .card')[i]!;
    const range = document.createRange();
    range.selectNodeContents(card);
    const box = range.getBoundingClientRect();
    return document.elementFromPoint(box.right - 1, box.top + box.height / 2) === card;
  }, covered!);
  expect(readable).toBe(true);
  await context.close();
});
