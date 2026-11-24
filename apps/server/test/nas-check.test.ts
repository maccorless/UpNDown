import { describe, expect, it } from 'vitest';
import { cardLookupPayloadSchema, defaultMultiplayerSettings, type CheatLimits } from '@upndown/shared-types';
import { lobbyWithUsers } from './helpers/rig.js';

const limits = (nas: CheatLimits['nas']): CheatLimits => ({ lookup: 'off', skip: 'off', trade: 'off', hint: 'off', nas });

// The Nas check over the server: the same lookup as the card seeker, but only a player named Nas may make it, and only while the
// game has it on. Nobody else learns what it found.
describe('the Nas check on the server', () => {
  const started = (nas: CheatLimits['nas']) => {
    const l = lobbyWithUsers(
      [{ id: 'p1', name: 'nas' }, { id: 'p2', name: 'Ken' }],
      { ...defaultMultiplayerSettings, cheatLimits: limits(nas) }
    );
    l.manager.startGame('p1', l.gameId);
    return l;
  };

  it('answers a player named Nas, whatever the capitals', () => {
    const l = started('unlimited');
    const answer = l.manager.lookupCardStatus(l.gameId, 'p1', 20, 'nas');
    expect(['in-draw', 'in-hand', 'played']).toContain(answer.status);
  });

  it('refuses the Nas check to anyone else, and refuses the card seeker, which is off', () => {
    const l = started('unlimited');
    expect(() => l.manager.lookupCardStatus(l.gameId, 'p2', 20, 'nas')).toThrow('Only a player named Nas can use the Nas check');
    expect(() => l.manager.lookupCardStatus(l.gameId, 'p1', 20)).toThrow('This cheat is not enabled for this game');
  });

  it('is refused for everyone while the game has it off', () => {
    const l = started('off');
    expect(() => l.manager.lookupCardStatus(l.gameId, 'p1', 20, 'nas')).toThrow('This cheat is not enabled for this game');
  });

  it('accepts only the card seeker or the Nas check in a card check request, and nothing else', () => {
    expect(cardLookupPayloadSchema.safeParse({ gameId: 'ABC123', cardValue: 20, kind: 'nas' }).success).toBe(true);
    expect(cardLookupPayloadSchema.safeParse({ gameId: 'ABC123', cardValue: 20 }).success).toBe(true);
    expect(cardLookupPayloadSchema.safeParse({ gameId: 'ABC123', cardValue: 20, kind: 'hint' }).success).toBe(false);
  });
});
