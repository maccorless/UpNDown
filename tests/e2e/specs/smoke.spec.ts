import { expect, test, type Browser, type Page } from '@playwright/test';
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

interface SocketFrames {
  sent: string[];
  received: string[];
}

function recordSocketFrames(page: Page): SocketFrames {
  const frames: SocketFrames = { sent: [], received: [] };
  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => frames.sent.push(String(frame.payload)));
    ws.on('framereceived', (frame) => frames.received.push(String(frame.payload)));
  });
  return frames;
}

// Socket.IO event packets look like `42["event",payload]`, or `42<ackId>[...]` when the sender wants an ack.
function eventPayloads<T>(frames: string[], event: string): T[] {
  return frames.flatMap((frame) => {
    const match = /^42\d*(\[.*)$/s.exec(frame);
    if (!match) return [];
    try {
      const [name, payload] = JSON.parse(match[1]!) as [string, T];
      return name === event ? [payload] : [];
    } catch {
      return [];
    }
  });
}

async function startTwoPlayerGame(browser: Browser, hostPage: Page) {
  const hostFrames = recordSocketFrames(hostPage);
  await hostPage.goto('/');
  await hostPage.getByTestId('mode-multiplayer').click();
  await hostPage.locator('#player-name-input').fill('Host');
  await hostPage.getByTestId('flow-host').click();
  const headingText = await hostPage.getByRole('heading', { name: /Game [A-Z0-9]{6}/ }).textContent();
  const gameId = headingText?.replace('Game ', '').trim();
  if (!gameId) throw new Error('failed to parse game id');

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  const guestFrames = recordSocketFrames(guestPage);
  await guestPage.goto('/');
  await guestPage.getByTestId('mode-multiplayer').click();
  await guestPage.getByTestId('flow-join').click();
  await guestPage.locator('#player-name-input').fill('Guest');
  await guestPage.getByTestId('show-join-by-id').click();
  await guestPage.locator('#game-id-input').fill(gameId);
  await guestPage.getByTestId('lookup-game').click();
  await guestPage.getByTestId('join-game').click();
  await expect(hostPage.getByText('Guest')).toBeVisible();
  await hostPage.getByTestId('start-game').click();
  await expect(hostPage.getByRole('heading', { name: 'Your Hand' })).toBeVisible();
  await expect(guestPage.getByRole('heading', { name: 'Your Hand' })).toBeVisible();

  return { guestContext, guestPage, hostFrames, guestFrames };
}

interface WireState {
  players: Array<{ name: string; hand: Array<{ value: number }> }>;
  drawPile: Array<{ value: number }>;
}

test('@smoke a player never receives other hands or the draw order over the socket', async ({ browser, page }) => {
  const { guestContext, guestFrames } = await startTwoPlayerGame(browser, page);
  try {
    const updates = eventPayloads<WireState>(guestFrames.received, 'game:updated');
    const dealt = updates.filter((state) => state.players.some((player) => player.hand.length > 0));
    expect(dealt.length).toBeGreaterThan(0);

    for (const state of dealt) {
      const host = state.players.find((player) => player.name === 'Host')!;
      const guest = state.players.find((player) => player.name === 'Guest')!;
      expect(host.hand.every((card) => card.value === 0)).toBe(true);
      expect(state.drawPile.every((card) => card.value === 0)).toBe(true);
      expect(guest.hand.some((card) => card.value > 0)).toBe(true);
    }
  } finally {
    await guestContext.close();
  }
});

test('@smoke a dropped connection rejoins with its token and keeps the same seat', async ({ browser, page }) => {
  // The socket is proxied so the test can sever it; going offline does not close an open WebSocket.
  let severConnection: () => void = () => {
    throw new Error('socket was never opened');
  };
  await page.routeWebSocket(/socket\.io/, (ws) => {
    const server = ws.connectToServer();
    severConnection = () => {
      server.close();
      ws.close();
    };
  });

  const { guestContext, guestPage, hostFrames } = await startTwoPlayerGame(browser, page);
  try {
    const handCards = page.locator('[data-testid^="hand-card-"]');
    const handBefore = await handCards.count();

    severConnection();

    await expect.poll(() => eventPayloads<unknown>(hostFrames.sent, 'game:rejoin').length, {
      timeout: 30_000
    }).toBeGreaterThan(0);
    const [rejoin] = eventPayloads<{ previousPlayerId?: string; rejoinToken?: string }>(hostFrames.sent, 'game:rejoin');
    expect(rejoin?.rejoinToken).toBeTruthy();
    expect(rejoin?.previousPlayerId).toBeTruthy();

    await expect(page.getByRole('status')).toHaveText('Ready');
    await playFirstCardToPile(page, 0);
    await expect(handCards).toHaveCount(handBefore - 1);
    await expect(guestPage.getByText('Host')).toBeVisible();
  } finally {
    await guestContext.close();
  }
});
