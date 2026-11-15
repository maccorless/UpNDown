// Kept for the record of the P0 stack spike (docs/plans/2026-11-15-training-p0-report.md); not used by training. A TypeScript actor for the speed spike: plays E games in lockstep; each round sends every game's observation and legal-action mask
// to the learner on stdout and reads one action per game from stdin.
import { buildDeck, createStartedGameState, endTurn, isValidPlay, playCard, seededRandom, shuffleWith, tableById } from '../src/index.js';
import type { GameState } from '@upndown/shared-types';
const E = Number(process.argv[3] ?? 256);
const t = tableById(process.argv[2] ?? 's3-4p-99-h7');
const H = 11, F = 2 * H + 12, A = H * 4 + 1;
const random = seededRandom(3);
const fresh = (): GameState => createStartedGameState({ gameId: 'X', hostId: 'p1', players: Array.from({ length: t.players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })), settings: t.settings, isSolitaire: t.players === 1, deck: shuffleWith(buildDeck(t.settings), random) });
const games = Array.from({ length: E }, fresh);
const obsBuf = Buffer.alloc(E * F * 4), maskBuf = Buffer.alloc(E * A);
const need = E * 2; let pending = Buffer.alloc(0);
function encode(): void {
  games.forEach((s, e) => {
    const me = s.players[s.currentPlayerIndex]!;
    const req = s.drawPile.length === 0 ? 1 : t.settings.minCardsPerTurn;
    for (let k = 0; k < F; k += 1) obsBuf.writeFloatLE(0, (e * F + k) * 4);
    for (let k = 0; k < A; k += 1) maskBuf[e * A + k] = 0;
    me.hand.slice(0, H).forEach((c, slot) => {
      obsBuf.writeFloatLE(c.value / 100, (e * F + slot) * 4); obsBuf.writeFloatLE(1, (e * F + H + slot) * 4);
      s.foundationPiles.forEach((p, pi) => { if (isValidPlay(c, p)) maskBuf[e * A + slot * 4 + pi] = 1; });
    });
    s.foundationPiles.forEach((p, k) => obsBuf.writeFloatLE(p.topCard.value / 100, (e * F + 2 * H + k) * 4));
    obsBuf.writeFloatLE(s.drawPile.length / 100, (e * F + 2 * H + 4) * 4);
    if (t.players > 1 && s.cardsPlayedThisTurn >= req) maskBuf[e * A + H * 4] = 1;
  });
}
function apply(actions: Int16Array): void {
  for (let e = 0; e < E; e += 1) {
    let s = games[e]!;
    if (s.gamePhase !== 'playing') { games[e] = fresh(); continue; }
    const me = s.players[s.currentPlayerIndex]!;
    const a = actions[e]!;
    if (a === H * 4) s = endTurn(s, me.id);
    else { const card = me.hand[Math.floor(a / 4)]; if (card) s = playCard(s, me.id, card.id, a % 4); }
    games[e] = s;
  }
}
encode(); process.stdout.write(Buffer.concat([obsBuf, maskBuf]));
process.stdin.on('data', (chunk: Buffer) => {
  pending = Buffer.concat([pending, chunk]);
  if (pending.length < need) return;
  const actions = new Int16Array(E); for (let e = 0; e < E; e += 1) actions[e] = pending.readInt16LE(e * 2);
  pending = pending.subarray(need);
  apply(actions); encode(); process.stdout.write(Buffer.concat([obsBuf, maskBuf]));
});
