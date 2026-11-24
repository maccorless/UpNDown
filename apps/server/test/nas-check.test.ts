import { describe, expect, it } from 'vitest';
import { cardLookupPayloadSchema, defaultMultiplayerSettings, type CheatLimits } from '@upndown/shared-types';
import { lobbyWithUsers } from './helpers/rig.js';

// The card seeker's limit turns the cheats on: the Nas check has no setting of its own and is on whenever another cheat is.
const limits = (lookup: CheatLimits['lookup']): CheatLimits => ({ lookup, skip: 'off', trade: 'off', hint: 'off' });

// The Nas check over the server: the same lookup as the card seeker, but only a player named Nas may make it, and only while the
// game has a cheat on. Nobody else learns what it found.
describe('the Nas check on the server', () => {
  const started = (lookup: CheatLimits['lookup']) => {
    const l = lobbyWithUsers(
      [{ id: 'p1', name: 'nas' }, { id: 'p2', name: 'Ken' }],
      { ...defaultMultiplayerSettings, cheatLimits: limits(lookup) }
    );
    l.manager.startGame('p1', l.gameId);
    return l;
  };

  it('answers a player named Nas, whatever the capitals', () => {
    const l = started('unlimited');
    const answer = l.manager.lookupCardStatus(l.gameId, 'p1', 20, 'nas');
    expect(['in-draw', 'in-hand', 'played']).toContain(answer.status);
  });

  it('refuses the Nas check to anyone else', () => {
    const l = started('unlimited');
    expect(() => l.manager.lookupCardStatus(l.gameId, 'p2', 20, 'nas')).toThrow('Only a player named Nas can use the Nas check');
  });

  it('is refused for everyone while the game has no cheat on', () => {
    const l = started('off');
    expect(() => l.manager.lookupCardStatus(l.gameId, 'p1', 20, 'nas')).toThrow('This cheat is not enabled for this game');
  });

  it('accepts only the card seeker or the Nas check in a card check request, and nothing else', () => {
    expect(cardLookupPayloadSchema.safeParse({ gameId: 'ABC123', cardValue: 20, kind: 'nas' }).success).toBe(true);
    expect(cardLookupPayloadSchema.safeParse({ gameId: 'ABC123', cardValue: 20 }).success).toBe(true);
    expect(cardLookupPayloadSchema.safeParse({ gameId: 'ABC123', cardValue: 20, kind: 'hint' }).success).toBe(false);
  });
});
