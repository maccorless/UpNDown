import { defaultMultiplayerSettings, normalSolitaireSettings, type GameSettings } from '@upndown/shared-types';

// The tables training and evaluation use (docs/plans/2026-11-15-training-mode-plan.md, section 4.4). All of them are played with
// no cheats and undo off. Stage 1 and 2 are simpler (a lower top card, bigger hands); stage 3 is the shipped defaults, and is
// what a strategy is judged on.
export interface StageTable {
  id: string;
  stage: 1 | 2 | 3;
  label: string;
  players: number;
  settings: GameSettings;
}

const NO_CHEATS = { cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off' }, allowCardLookup: false, allowUndo: false } as const;

function table(stage: 1 | 2 | 3, players: number, topCard: number, handSize: number, perTurn?: number): StageTable {
  // Solitaire tables keep the Normal preset whatever the player default is: the training results were measured on it.
  const base = players === 1 ? normalSolitaireSettings : defaultMultiplayerSettings;
  const name = players === 1 ? 'solo' : `${players}p`;
  return {
    id: `s${stage}-${name}-${topCard}-h${handSize}${perTurn === undefined ? '' : `-m${perTurn}`}`,
    stage,
    label: `${players === 1 ? 'Solitaire' : `${players} players`}, 2 to ${topCard}, hand ${handSize}`,
    players,
    settings: {
      ...base,
      ...NO_CHEATS,
      maxCardValue: topCard,
      handSize,
      ...(perTurn === undefined ? {} : { minCardsPerTurn: perTurn }),
      // Whether hands refill after each play is part of the table: solitaire refills, a table does not (the shipped defaults).
      autoRefillHand: players === 1,
      ...(players === 1 ? { minPlayers: 1, maxPlayers: 1 } : { minPlayers: 2, maxPlayers: Math.max(base.maxPlayers, players) })
    }
  };
}

export const STAGE_TABLES: readonly StageTable[] = [
  table(1, 1, 79, 9), table(1, 2, 79, 9), table(1, 4, 79, 9),
  table(2, 1, 79, 7), table(2, 2, 79, 7), table(2, 4, 79, 7),
  table(2, 1, 99, 9), table(2, 2, 99, 9), table(2, 4, 99, 9),
  table(2, 1, 99, 11),
  table(3, 1, 99, 7), table(3, 2, 99, 7), table(3, 4, 99, 7)
];

// Tables outside the training set, used only to check where a trained network can be trusted (stage 3 here means the shipped default deck).
export const EXTRA_TABLES: readonly StageTable[] = [
  table(3, 3, 99, 7), table(3, 5, 99, 7), table(3, 6, 99, 7),
  table(3, 2, 99, 5), table(3, 2, 99, 9), table(3, 4, 99, 5), table(3, 4, 99, 9),
  table(3, 2, 59, 7), table(3, 4, 59, 7),
  table(3, 2, 99, 7, 1), table(3, 4, 99, 7, 1), table(3, 2, 99, 7, 3), table(3, 4, 99, 7, 3), table(3, 4, 99, 7, 4)
];

export const tableById = (id: string): StageTable => {
  const found = [...STAGE_TABLES, ...EXTRA_TABLES].find((t) => t.id === id);
  if (!found) throw new Error(`No table "${id}". Choose one of: ${[...STAGE_TABLES, ...EXTRA_TABLES].map((t) => t.id).join(', ')}`);
  return found;
};

// The tables a strategy is judged on: the shipped defaults.
export const REAL_TABLES: readonly StageTable[] = STAGE_TABLES.filter((t) => t.stage === 3);
