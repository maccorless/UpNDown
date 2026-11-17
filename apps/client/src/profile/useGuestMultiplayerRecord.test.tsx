import { buildDeck, createStartedGameState } from '@upndown/engine';
import { defaultMultiplayerSettings, type GameState } from '@upndown/shared-types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalHistory } from './local-history.js';
import { useGuestMultiplayerRecord } from './useGuestMultiplayerRecord.js';

const settings = { ...defaultMultiplayerSettings, maxCardValue: 30, handSize: 5, autoRefillHand: false };
const playing = (runId: string | null = 'run-1'): GameState => ({
  ...createStartedGameState({ gameId: 'ROOM01', hostId: 'p1', players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }], settings, isSolitaire: false, deck: buildDeck(settings) }),
  ...(runId ? { runId } : {})
});
const finished = (phase: 'won' | 'lost', runId: string | null = 'run-1'): GameState => {
  const s = structuredClone(playing(runId));
  s.gamePhase = phase;
  s.statistics = { ...s.statistics, startedAtMs: Date.now() - 600_000, endedAtMs: Date.now() };
  if (phase === 'won') { s.drawPile = []; s.players.forEach((p) => { p.hand = []; }); s.statistics.finishedById = 'p1'; }
  return s;
};

type Props = { state: GameState | null; guest?: boolean; playerId?: string | null };
const setup = (initial: Props) => {
  const history = createLocalHistory();
  const hook = renderHook((p: Props) => useGuestMultiplayerRecord({ state: p.state, playerId: p.playerId === undefined ? 'p1' : p.playerId, guest: p.guest ?? true, history }), { initialProps: initial });
  return { history, ...hook };
};

describe('keeping a guest\'s multiplayer games on the device', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('writes one row when a game goes from playing to won, under the run id the server uses', () => {
    const { history, rerender } = setup({ state: playing() });
    rerender({ state: finished('won') });
    expect(history.load().rows).toMatchObject([{ gameId: 'run-1', mode: 'multiplayer', outcome: 'won', playerCount: 2, playedLastCard: true }]);
  });

  it('writes nothing more for a repeated update of the same finished game', () => {
    const { history, rerender } = setup({ state: finished('lost') });
    rerender({ state: { ...finished('lost') } });
    rerender({ state: finished('lost') });
    expect(history.load().rows).toHaveLength(1);
  });

  it('keeps a game that is already finished when its first view arrives (back online after it ended)', () => {
    const { history } = setup({ state: finished('won') });
    expect(history.load().rows).toHaveLength(1);
  });

  it('records nothing for a signed-in player, because the server writes that row', () => {
    const { history } = setup({ state: finished('won'), guest: false });
    expect(history.load().rows).toEqual([]);
  });

  it('records nothing, and does not throw, when the view has no run id', () => {
    const { history } = setup({ state: finished('won', null) });
    expect(history.load().rows).toEqual([]);
  });

  it('records nothing for a player who is not at the table', () => {
    const { history } = setup({ state: finished('won'), playerId: 'stranger' });
    expect(history.load().rows).toEqual([]);
  });

  it('writes an abandoned row for the host who ended a game in progress, with the cards played so far', () => {
    const before = playing();
    before.drawPile = before.drawPile.slice(6);
    before.statistics.players.p1 = { ...before.statistics.players.p1!, cardsPlayed: 6 };
    before.statistics = { ...before.statistics, startedAtMs: Date.now() - 100_000 };
    const { history, result } = setup({ state: before });
    act(() => result.current.recordAbandoned(before));
    expect(history.load().rows).toMatchObject([{ gameId: 'run-1', outcome: 'abandoned', cardsPlayed: 6 }]);
  });

  it('does not record an abandoned game that was not in progress, and not the same game twice', () => {
    const { history, result } = setup({ state: null });
    act(() => result.current.recordAbandoned(finished('won')));
    expect(history.load().rows).toEqual([]);
    act(() => { result.current.recordAbandoned(playing('run-2')); result.current.recordAbandoned(playing('run-2')); });
    expect(history.load().rows).toHaveLength(1);
  });
});
