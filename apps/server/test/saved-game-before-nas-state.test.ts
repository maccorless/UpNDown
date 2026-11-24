import { gameStateSchema } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { lobbyWithUsers } from './helpers/rig.js';

// A game saved before the old Nas swap state was removed still carries that field. It must still be read back as a game, so a
// restart does not lose the table, and the field is dropped rather than kept.
describe('a game saved before the old Nas state was removed', () => {
  it('still parses, and the old field is dropped', () => {
    const l = lobbyWithUsers([{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Ben' }]);
    l.manager.startGame('p1', l.gameId);
    const saved = { ...l.room().gameState, nasCheat: { enabledPlayerIds: [], usedThisTurnByPlayerId: { p1: false, p2: false } } };

    const parsed = gameStateSchema.safeParse(saved);
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'nasCheat' in parsed.data).toBe(false);
    expect(parsed.success && parsed.data.gameId).toBe(l.gameId);
  });
});
