import { describe, expect, it } from 'vitest';
import { createGamePayloadSchema, defaultMultiplayerSettings, joinGamePayloadSchema } from '../src/index.js';

// A name is shown to every other player and in the public lobby list. A bidirectional override can make "Abraham"
// display as something else, so a name is cleaned on the way into a game as it is on the way into an account.
describe('the name a player takes into a game', () => {
  const create = (playerName: string) => createGamePayloadSchema.safeParse({ playerName, settings: defaultMultiplayerSettings, isSolitaire: false });
  const join = (playerName: string) => joinGamePayloadSchema.safeParse({ gameId: 'ABC123', playerName });

  it('is cleaned of control and bidirectional characters when creating and when joining', () => {
    expect(create('  Ab‮e\u0007  ').success && create('  Ab‮e\u0007  ').data!.playerName).toBe('Abe');
    expect(join('⁦Sam⁩').success && join('⁦Sam⁩').data!.playerName).toBe('Sam');
  });

  it('is refused when nothing is left after cleaning', () => {
    expect(create('‮\u0000 ').success).toBe(false);
    expect(join('   ').success).toBe(false);
  });

  it('still allows an ordinary name, and a name with spaces inside it', () => {
    expect(create('Mary Ann').success && create('Mary Ann').data!.playerName).toBe('Mary Ann');
  });

  it('is cut to 32 characters, not refused', () => {
    const r = join('x'.repeat(40));
    expect(r.success && r.data.playerName).toHaveLength(32);
  });
});
