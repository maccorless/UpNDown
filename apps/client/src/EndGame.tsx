import { emptyPlayerStats } from '@upndown/engine';
import { CHEAT_KINDS, cheatLimitOf, type GameState } from '@upndown/shared-types';
import { cheatCount, describeCheats } from './cheats.js';
import type { CSSProperties, JSX } from 'react';
import { deckProgress, lossLine, PLAYER_COLOR_HEX, statsHighlights } from './board-helpers.js';
import { Modal } from './Modal.js';
import type { ResultSaveStatus } from './useSolitaireResult.js';

type Mode = 'solitaire' | 'multiplayer';

export function formatDurationLabel(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${(totalSeconds % 60).toString().padStart(2, '0')}s`;
}

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

// Confetti is decoration only: positions come from the index, so a re-render never reshuffles it.
const CONFETTI_COLORS = Object.values(PLAYER_COLOR_HEX);
const CONFETTI = Array.from({ length: 36 }, (_, i) => ({
  left: `${(i * 29 + 7) % 100}%`,
  delay: `${(i % 9) * 0.11}s`,
  fall: `${2.2 + (i % 5) * 0.25}s`,
  spin: `${(i % 2 === 0 ? 1 : -1) * (240 + (i % 4) * 90)}deg`,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]
}));

export function EndGameSplash({ phase, state }: { phase: 'won' | 'lost'; state: GameState }): JSX.Element {
  const progress = deckProgress(state);
  const won = phase === 'won';
  return (
    <>
      {won ? (
        <div className="confetti" aria-hidden="true">
          {CONFETTI.map((piece, i) => (
            <span
              key={i}
              style={{ '--x': piece.left, '--delay': piece.delay, '--fall': piece.fall, '--spin': piece.spin, '--c': piece.color } as CSSProperties}
            />
          ))}
        </div>
      ) : null}
      <section className={`phase-splash ${phase}`} data-testid="phase-splash" aria-live="assertive">
        <div className="phase-splash-label">{won ? 'Victory' : 'Defeat'}</div>
        <div className="phase-splash-title">{won ? 'Game Won' : 'Game Lost'}</div>
        <div className="phase-splash-subtitle">
          {won
            ? `All ${progress.total} cards played.`
            : `No legal moves remain. ${progress.left} of ${progress.total} cards left.`}
        </div>
      </section>
    </>
  );
}

interface EndGameStatisticsModalProps {
  mode: Mode;
  gameState: GameState;
  statistics: GameState['statistics'];
  isHost: boolean;
  onClose: () => void;
  onPlayAgain: () => void;
  onBackToLobby: () => void;
  // Only for a signed-in player's solitaire game: whether the result reached their history. Idle shows nothing.
  saveStatus?: ResultSaveStatus;
  onRetrySave?: () => void;
  // Solitaire only: end this game and open the settings, since they are fixed while a game is on.
  onChangeSettings?: () => void;
}

export function EndGameStatisticsModal({
  mode,
  gameState,
  statistics,
  isHost,
  onClose,
  onPlayAgain,
  onBackToLobby,
  saveStatus = 'idle',
  onRetrySave,
  onChangeSettings
}: EndGameStatisticsModalProps): JSX.Element {
  const won = gameState.gamePhase === 'won';
  const progress = deckProgress(gameState);
  const highlights = statsHighlights({ players: gameState.players, statistics });
  const fallback = emptyPlayerStats();
  const rows = gameState.players.map((player) => ({ player, stats: statistics.players[player.id] ?? fallback }));
  const mostPlayed = Math.max(1, ...rows.map((row) => row.stats.cardsPlayed));
  const totalCheatsUsed = rows.reduce((sum, row) => sum + cheatCount(row.stats), 0);
  // Shown when the game offered any cheat or one was used, so a game with none looks as it always did.
  const showCheats = totalCheatsUsed > 0 || CHEAT_KINDS.some((kind) => cheatLimitOf(gameState.settings, kind) !== 'off');
  const durationMs = statistics.startedAtMs ? (statistics.endedAtMs ?? Date.now()) - statistics.startedAtMs : 0;
  const playsLabel = mode === 'multiplayer' ? `${statistics.turns} turns` : `${highlights.totalCardsPlayed} plays`;
  const top = highlights.topBackwardTen;
  const hostOnly = mode === 'multiplayer' && !isHost;

  return (
    <Modal className="panel stats-modal" dismiss="any" label="end game statistics" onClose={onClose}>
      <header className={`stats-hero ${won ? 'won' : 'lost'}`}>
        <div className="stats-hero-label">{won ? 'Victory' : 'Defeat'}</div>
        <h2>{won ? 'Game Won' : 'Game Lost'}</h2>
        <p className="stats-hero-line">
          {won
            ? `Every one of the ${progress.total} cards is down.`
            : lossLine(progress.left, progress.total)}
        </p>
        <div className="pill">
          {mode === 'multiplayer' ? `${gameState.players.length} players` : 'Solitaire'} • {playsLabel} • {formatDurationLabel(durationMs)}
        </div>
      </header>

      {saveStatus === 'idle' ? null : (
        <p className="stats-save" role="status">
          {saveStatus === 'saving' ? 'Saving to your history...'
            : saveStatus === 'saved' ? 'Saved to your history.'
            : saveStatus === 'queued' ? 'Saved on this device, will sync when you are online.'
            : saveStatus === 'local' ? 'Saved on this device.'
            : 'Could not save this game to your history. '}
          {saveStatus === 'failed' && onRetrySave ? <button type="button" className="link-action" onClick={onRetrySave}>Try again</button> : null}
        </p>
      )}

      <div className="stats-tiles">
        <div className="stats-tile">
          <div className="stats-tile-value">{highlights.totalCardsPlayed}</div>
          <div className="stats-tile-label">Cards Played</div>
        </div>
        <div className="stats-tile">
          <div className="stats-tile-value">{highlights.totalSpecialPlays}</div>
          <div className="stats-tile-label">Backward-10 Plays</div>
        </div>
        <div className="stats-tile">
          <div className="stats-tile-value">{signed(highlights.totalMovement)}</div>
          <div className="stats-tile-label">Total Movement</div>
        </div>
        <div className="stats-tile">
          <div className="stats-tile-value">{highlights.averageMovement.toFixed(1)}</div>
          <div className="stats-tile-label">Avg Movement / Card</div>
        </div>
        {showCheats ? (
          <div className="stats-tile">
            <div className="stats-tile-value">{totalCheatsUsed}</div>
            <div className="stats-tile-label">Cheats Used</div>
          </div>
        ) : null}
      </div>

      {top ? (
        <p className="stats-callout">
          {top.names.join(' and ')} made the most backward 10s ({top.count}).
        </p>
      ) : null}
      {highlights.topLifelines ? (
        <p className="stats-callout">
          {highlights.topLifelines.names.join(' and ')} found the most lifelines ({highlights.topLifelines.count}): backward 10s that were the only way forward.
        </p>
      ) : null}
      {highlights.topFollows ? (
        <p className="stats-callout">
          {highlights.topFollows.names.join(' and ')} had the most marks followed ({highlights.topFollows.count}): teammates played on piles they marked.
        </p>
      ) : null}

      <div className="stats-table-wrap">
        <table className="stats-table">
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Cards Played</th>
              <th scope="col">Backward-10</th>
              {showCheats ? <th scope="col">Cheats</th> : null}
              <th scope="col">Avg Move / Card</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, stats }) => {
              const average = stats.cardsPlayed > 0 ? stats.totalMovement / stats.cardsPlayed : 0;
              return (
                <tr key={player.id}>
                  <td>
                    <span className="stats-dot" style={{ background: player.color ? PLAYER_COLOR_HEX[player.color] : 'var(--line-strong)' }} aria-hidden="true" />
                    {player.name}
                  </td>
                  <td>
                    <span className="stats-bar" aria-hidden="true">
                      <span style={{ width: `${Math.round((stats.cardsPlayed / mostPlayed) * 100)}%` }} />
                    </span>
                    {stats.cardsPlayed}
                  </td>
                  <td>{stats.specialPlays}</td>
                  {showCheats ? <td>{describeCheats(stats)}</td> : null}
                  <td>{average.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="button-row">
        <button type="button" className="primary" onClick={onPlayAgain}>Play Again</button>
        {onChangeSettings ? <button type="button" className="secondary" onClick={onChangeSettings} data-testid="end-change-settings">Change settings</button> : null}
        <button type="button" className="secondary" onClick={onBackToLobby} disabled={hostOnly}>
          {mode === 'multiplayer' ? (isHost ? 'Back to Lobby' : 'Host Returns to Lobby') : 'Back to Lobby'}
        </button>
        <button type="button" className="secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
