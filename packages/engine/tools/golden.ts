// Writes golden traces for checking a faster port of the engine: full games played by the strategy, with a snapshot of the
// state after every action. A port must reproduce every snapshot exactly.
//   npm run golden --workspace @upndown/engine -- <out.jsonl> [games per table] [random]
// With `random`, every action is a uniformly random legal one instead of the strategy's, which reaches odd states the strategy never does.
import { writeFileSync } from 'node:fs';
import { buildDeck, chooseAction, createStartedGameState, endTurn, isValidPlay, observe, playCard, seededRandom, seedsFor, shuffleWith, STAGE_TABLES } from '../src/index.js';
import type { GameState } from '@upndown/shared-types';

const out = process.argv[2];
if (!out) throw new Error('Usage: golden <out.jsonl> [games per table]');
const perTable = Number(process.argv[3] ?? 20);
const randomMode = process.argv[4] === 'random';
const pick = seededRandom(99);

const snapshot = (s: GameState): number[] => [
  s.gamePhase === 'playing' ? 0 : s.gamePhase === 'won' ? 1 : 2, s.currentPlayerIndex, s.cardsPlayedThisTurn, s.drawPile.length,
  ...s.foundationPiles.map((p) => p.topCard.value),
  ...s.players.map((p) => p.hand.length),
  ...s.players.map((p) => p.hand.reduce((n, c) => n + c.value, 0))
];

const lines: string[] = [];
for (const t of STAGE_TABLES) {
  for (const seed of seedsFor('train', perTable)) {
    const deck = shuffleWith(buildDeck(t.settings), seededRandom(seed));
    let state = createStartedGameState({ gameId: 'GOLD', hostId: 'p1', players: Array.from({ length: t.players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })), settings: t.settings, isSolitaire: t.players === 1, deck: [...deck] });
    const steps: Array<{ a: [number, number, number]; after: number[] }> = [];
    const start = snapshot(state);
    for (let n = 0; n < 5000 && state.gamePhase === 'playing'; n += 1) {
      const id = state.players[state.currentPlayerIndex]!.id;
      let act = chooseAction(observe(state, id));
      if (randomMode) {
        const me = state.players[state.currentPlayerIndex]!;
        const moves = me.hand.flatMap((c) => state.foundationPiles.filter((p) => isValidPlay(c, p)).map((p) => ({ cardId: c.id, pileId: p.id })));
        const need = state.drawPile.length === 0 ? 1 : t.settings.minCardsPerTurn;
        const canEnd = t.players > 1 && state.cardsPlayedThisTurn >= need;
        const k = Math.floor(pick() * (moves.length + (canEnd ? 1 : 0)));
        act = k === moves.length ? { type: 'endTurn' } : { type: 'play', ...moves[k]! };
      }
      if (act.type === 'play') {
        const card = state.players[state.currentPlayerIndex]!.hand.find((c) => c.id === act.cardId)!;
        state = playCard(state, id, act.cardId, act.pileId);
        steps.push({ a: [0, card.value, act.pileId], after: snapshot(state) });
      } else if (act.type === 'endTurn') {
        state = endTurn(state, id);
        steps.push({ a: [1, 0, 0], after: snapshot(state) });
      } else break;
    }
    lines.push(JSON.stringify({ table: t.id, players: t.players, top: t.settings.maxCardValue, min: t.settings.minCardValue, hand: t.settings.handSize, perTurn: t.settings.minCardsPerTurn, refill: t.settings.autoRefillHand, deck: deck.map((c) => c.value), start, steps }));
  }
}
writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${lines.length} games (${lines.reduce((n, l) => n + l.length, 0)} bytes) to ${out}`);
