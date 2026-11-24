import type { Dispatch, SetStateAction } from 'react';
import { maxPlayersFor, type GameSettings, type GameState, type JoinableGameSummary, type JoinLookupSummary } from '@upndown/shared-types';
import { PLAYER_COLOR_HEX } from './board-helpers.js';
import { RejoinNotice } from './RejoinNotice.js';
import { describeMultiplayerSettings, MySettingsSummary } from './setup-summary.js';
import type { SeatOffer } from './useSavedSeat.js';
import { buildInviteLink } from './game-url.js';

type Task = void | Promise<void>;

// The screen before a game is joined: pick a name, then host a game or join one.
export function JoinPanel(props: {
  playerName: string;
  setPlayerName: (name: string) => void;
  confirmName: () => void;
  multiplayerInteractionDisabled: boolean;
  multiplayerFlow: 'choose' | 'join';
  setMultiplayerFlow: (flow: 'choose' | 'join') => void;
  pendingAction: string | null;
  createSettingsError: string | null;
  handleCreateGame: () => Task;
  setShowJoinById: Dispatch<SetStateAction<boolean>>;
  setJoinLookup: (lookup: JoinLookupSummary | null) => void;
  setError: (error: string | null) => void;
  refreshJoinableGames: () => Promise<boolean>;
  loadingJoinableGames: boolean;
  joinableGames: JoinableGameSummary[];
  handleJoinGame: (gameId?: string) => Task;
  showJoinById: boolean;
  joinGameId: string;
  setJoinGameId: (id: string) => void;
  handleLookupGame: () => Task;
  joinLookup: JoinLookupSummary | null;
  // Games in progress this browser can go back to. Offered here as well as on the front page, since this is where players go.
  rejoinSeats: SeatOffer[];
  onRejoin: (seatKey: string) => void;
  // The table rules a host would create now, and this person's own settings.
  settings: GameSettings;
  enableSounds: boolean;
  showArrows: boolean;
  autoMark: boolean;
}): JSX.Element {
  const { playerName, setPlayerName, confirmName, multiplayerInteractionDisabled, multiplayerFlow, setMultiplayerFlow, pendingAction, createSettingsError, handleCreateGame, setShowJoinById, setJoinLookup, setError, refreshJoinableGames, loadingJoinableGames, joinableGames, handleJoinGame, showJoinById, joinGameId, setJoinGameId, handleLookupGame, joinLookup, settings, enableSounds, showArrows, autoMark } = props;
  return (
    <section className="panel lobby" aria-label="multiplayer lobby">
      <h2>Multiplayer</h2>
      {multiplayerFlow === 'choose' ? <RejoinNotice seats={props.rejoinSeats} onRejoin={props.onRejoin} /> : null}
      <div className="lobby-grid">
        <label htmlFor="player-name-input">
          Player Name
          <input
            id="player-name-input"
            value={playerName}
            onChange={(e) => { setPlayerName(e.target.value); confirmName(); }}
            name="playerName"
            autoComplete="nickname"
            autoCapitalize="words"
            spellCheck={false}
            maxLength={32}
            placeholder="Your Name"
            disabled={multiplayerInteractionDisabled}
          />
        </label>
      </div>
      {multiplayerFlow === 'choose' ? (
        <>
          <section aria-labelledby="table-settings-title" data-testid="multiplayer-summary">
            <h3 id="table-settings-title">Table settings</h3>
            <ul className="setup-summary">
              {describeMultiplayerSettings(settings).map((line) => <li key={line}>{line}</li>)}
            </ul>
          </section>
          <MySettingsSummary solitaire={false} enableSounds={enableSounds} showArrows={showArrows} autoMark={autoMark} />
        </>
      ) : null}
      {multiplayerFlow === 'choose' ? (
        <div className="flow-choice" data-testid="flow-choice">
          <button
            type="button"
            className="choice-card primary"
            onClick={() => {
              void handleCreateGame();
              setShowJoinById(false);
              setJoinLookup(null);
              setError(null);
            }}
            disabled={multiplayerInteractionDisabled || !playerName.trim() || !!createSettingsError}
            data-testid="flow-host"
          >
            {pendingAction === 'create' ? 'Hosting...' : 'Host Game'}
          </button>
          <button
            type="button"
            className="choice-card secondary"
            onClick={() => {
              setMultiplayerFlow('join');
              setShowJoinById(false);
              setJoinLookup(null);
              setError(null);
            }}
            disabled={multiplayerInteractionDisabled}
            data-testid="flow-join"
          >
            Join Game
          </button>
        </div>
      ) : null}

      {multiplayerFlow === 'join' ? (
        <>
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => { void refreshJoinableGames(); }} disabled={multiplayerInteractionDisabled || loadingJoinableGames}>
              {loadingJoinableGames ? 'Refreshing...' : 'Refresh Games'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setMultiplayerFlow('choose')}
              disabled={multiplayerInteractionDisabled}
            >
              Back
            </button>
          </div>

          <section className="joinable-list" aria-labelledby="joinable-games-title">
            <h3 id="joinable-games-title">Public Games</h3>
            {joinableGames.length === 0 ? (
              <div className="info-message">No public lobby games right now.</div>
            ) : (
              joinableGames.map((game) => (
                <div key={game.gameId} className="joinable-item">
                  <span>{game.hostName} • {game.playerCount}/{game.maxPlayers}</span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => { void handleJoinGame(game.gameId); }}
                    disabled={multiplayerInteractionDisabled || !playerName.trim()}
                    data-testid={`join-list-${game.gameId}`}
                  >
                    Join
                  </button>
                </div>
              ))
            )}
          </section>

          <div className="button-row">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setShowJoinById((value) => {
                  const next = !value;
                  if (!next) {
                    setJoinLookup(null);
                  }
                  return next;
                });
              }}
              disabled={multiplayerInteractionDisabled}
              data-testid="show-join-by-id"
            >
              {showJoinById ? 'Hide Join by ID' : 'Join by ID'}
            </button>
          </div>

          {showJoinById ? (
            <div className="private-join">
              <label htmlFor="game-id-input">
                Private Game ID
                <input
                  id="game-id-input"
                  value={joinGameId}
                  onChange={(e) => setJoinGameId(e.target.value.toUpperCase())}
                  maxLength={6}
                  disabled={multiplayerInteractionDisabled}
                />
              </label>
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => { void handleLookupGame(); }}
                  disabled={multiplayerInteractionDisabled || joinGameId.trim().length !== 6}
                  data-testid="lookup-game"
                >
                  {pendingAction === 'lookup' ? 'Checking...' : 'Check'}
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => { void handleJoinGame(); }}
                  disabled={multiplayerInteractionDisabled || !playerName.trim() || joinGameId.trim().length !== 6}
                  data-testid="join-game"
                >
                  {pendingAction === 'join' ? 'Joining...' : 'Join Private'}
                </button>
              </div>
            </div>
          ) : null}

          {showJoinById && joinLookup ? (
            <div className="info-message" data-testid="private-lookup-result">
              {joinLookup.privateGame ? 'Private' : 'Public'} game • {joinLookup.playerCount}/{joinLookup.maxPlayers} joined
            </div>
          ) : null}
        </>
      ) : null}

      {createSettingsError ? <div className="error">{createSettingsError}</div> : null}
    </section>
  );
}

// The waiting room: who is here, and (for the host) start, add a robot or remove someone.
export function WaitingRoom(props: {
  multiplayerState: GameState;
  playerId: string | null;
  isHostInLobby: boolean;
  multiplayerInteractionDisabled: boolean;
  pendingAction: string | null;
  inviteCopied: boolean;
  handleCopyInviteLink: () => Task;
  handleRemoveRobot: (robotId: string) => Task;
  handleKickPlayer: (playerId: string) => Task;
  handleStartGame: () => Task;
  handleAddRobot: () => Task;
  handleLeaveMultiplayer: () => Task;
}): JSX.Element {
  const { multiplayerState, playerId, isHostInLobby, multiplayerInteractionDisabled, pendingAction, inviteCopied, handleCopyInviteLink, handleRemoveRobot, handleKickPlayer, handleStartGame, handleAddRobot, handleLeaveMultiplayer } = props;
  return (
    <section className="panel lobby" aria-label="waiting room">
      <h2>Game {multiplayerState.gameId}</h2>
      <div className="invite-share">
        <label htmlFor="invite-link-input">
          Invite Link
          <input id="invite-link-input" value={buildInviteLink(multiplayerState.gameId)} readOnly data-testid="invite-link-input" />
        </label>
        <button
          type="button"
          className="secondary"
          onClick={() => { void handleCopyInviteLink(); }}
          disabled={multiplayerInteractionDisabled}
          data-testid="copy-invite-link"
        >
          {inviteCopied ? 'Copied' : 'Copy Link'}
        </button>
      </div>
      {inviteCopied ? <div className="info-message">Invite link copied.</div> : null}
      <div className="pill">
        Players in Lobby: {multiplayerState.players.length}/{maxPlayersFor(multiplayerState.settings)}
      </div>
      <div className="players-list">
        {multiplayerState.players.map((player, index) => (
          <div className="player-line" key={player.id}>
            <span>
              {player.color && <span className="player-color-pip" style={{ background: PLAYER_COLOR_HEX[player.color] }} aria-hidden="true" />}
              {index + 1}. {player.name}{player.id === playerId ? ' (You)' : ''}{player.isHost ? ' [Host]' : ''}{player.robot ? ' [Robot]' : ''}
            </span>
            {isHostInLobby && player.id !== playerId && !player.isHost ? (
              <button
                type="button"
                className="kick-btn"
                onClick={() => { void (player.robot ? handleRemoveRobot(player.id) : handleKickPlayer(player.id)); }}
                disabled={!!pendingAction}
                title={`Remove ${player.name}`}
                data-testid={`kick-${player.id}`}
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="button-row">
        {isHostInLobby ? (
          <button
            type="button"
            className="primary"
            onClick={() => { void handleStartGame(); }}
            disabled={multiplayerInteractionDisabled}
            data-testid="start-game"
          >
            {pendingAction === 'start' ? 'Starting...' : 'Start Game'}
          </button>
        ) : (
          <div className="info-message">Only host can start the game.</div>
        )}
        {isHostInLobby ? (
          <button
            type="button"
            className="secondary"
            onClick={() => { void handleAddRobot(); }}
            disabled={multiplayerInteractionDisabled || multiplayerState.players.length >= maxPlayersFor(multiplayerState.settings)}
            data-testid="add-robot"
          >
            Add Robot
          </button>
        ) : null}
        <button
          type="button"
          className="secondary"
          onClick={() => { void handleLeaveMultiplayer(); }}
          disabled={multiplayerInteractionDisabled}
          data-testid="leave-game"
        >
          {pendingAction === 'leave' ? 'Leaving...' : 'Leave'}
        </button>
      </div>
    </section>
  );
}
