import { describe, expect, it } from 'vitest';
import { GameManager, defaultMultiplayerSettings } from '../src/game-manager.js';

const settings = { ...defaultMultiplayerSettings, maxPlayers: 6 };

function lobby(hostName: string) {
  const manager = new GameManager();
  let latest = manager.createGame('p1', { playerName: hostName, settings, isSolitaire: false });
  const created = latest;
  const join = (id: string, name: string) => { latest = manager.joinGame(id, { gameId: created.gameId, playerName: name }); };
  const kick = (id: string) => { latest = manager.kickPlayer('p1', { gameId: created.gameId, targetPlayerId: id }); };
  const names = () => latest.players.map((p) => p.name);
  const seatOf = (index: number) => latest.players[index]!.id;
  return { join, kick, names, seatOf };
}

// Two players both called "Abe" in one game cannot be told apart on the board, in the turn banner or in the stats.
describe('player names in a game', () => {
  it('suffixes a second and third player with the same name', () => {
    const { join, names } = lobby('Abe');
    join('p2', 'Abe');
    join('p3', 'Abe');
    expect(names()).toEqual(['Abe', 'Abe-1', 'Abe-2']);
  });

  it('shows a generated president name as first name and last initial', () => {
    const { names } = lobby('Donald Washington');
    expect(names()).toEqual(['Donald W']);
  });

  it('treats two different president mash-ups that shorten the same way as a collision', () => {
    const { join, names } = lobby('Donald Washington');
    join('p2', 'Donald Wilson');
    expect(names()).toEqual(['Donald W', 'Donald W-1']);
  });

  it('is case-insensitive and keeps each joiner\'s own spelling', () => {
    const { join, names } = lobby('Ken');
    join('p2', 'KEN');
    expect(names()).toEqual(['Ken', 'KEN-1']);
  });

  it('frees a name when its owner is kicked, so the next joiner gets it plain', () => {
    const { join, kick, names } = lobby('Host');
    join('p2', 'Sam');
    kick('p2');
    join('p3', 'Sam');
    expect(names()).toEqual(['Host', 'Sam']);
  });

  it('keeps existing names stable when someone else joins, and a rejoining socket keeps its seat name', () => {
    const { join, names, seatOf } = lobby('Abe');
    join('p2', 'Abe');
    join('p2', 'Abe'); // same socket joining twice returns the existing seat
    expect(names()).toEqual(['Abe', 'Abe-1']);
    expect(seatOf(1)).toBe('p2');
  });
});
