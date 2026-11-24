import { gameStateSchema } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { toPlayerView } from '../src/player-view.js';
import { lobbyWithUsers } from './helpers/rig.js';

// The cards a robot played on its last turn are public, so every player's view carries them, and the saved game keeps them.
describe('a robot\'s last-turn cards reach every player', () => {
  it('is in the view of each player, not only the one who played them, and survives the saved-game check', () => {
    const l = lobbyWithUsers([{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Ben' }]);
    l.manager.startGame('p1', l.gameId);
    const state = { ...l.room().gameState, lastTurnPlays: { p2: [{ id: 'c-12', value: 12 }] } };

    expect(toPlayerView(state, 'p1').lastTurnPlays).toEqual({ p2: [{ id: 'c-12', value: 12 }] });
    expect(toPlayerView(state, 'p2').lastTurnPlays).toEqual({ p2: [{ id: 'c-12', value: 12 }] });
    const saved = gameStateSchema.safeParse(state);
    expect(saved.success && saved.data.lastTurnPlays).toEqual({ p2: [{ id: 'c-12', value: 12 }] });
  });
});
