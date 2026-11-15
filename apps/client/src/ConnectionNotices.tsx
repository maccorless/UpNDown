import type { ReconnectionView } from '@upndown/shared-types';
import { useEffect, useState } from 'react';
import { Modal } from './Modal.js';

interface ConnectionNoticesProps {
  // What the server says about dropped connections, for this viewer. Missing when nobody has been gone for 10 seconds.
  reconnection: ReconnectionView | undefined;
  viewerId: string;
  players: Array<{ id: string; name: string }>;
  onKick: (targetId: string) => void;
  onTakeOver: (hostId: string) => void;
}

// The server decides who has been gone long enough and who may do what. This only shows it.
const kickTargets = (reconnection: ReconnectionView | undefined, viewerId: string): string[] =>
  (reconnection?.canKick ?? []).filter((id) => id !== viewerId);
const takeOverTarget = (reconnection: ReconnectionView | undefined, viewerId: string): string | null =>
  reconnection?.canTakeOver && reconnection.canTakeOver !== viewerId ? reconnection.canTakeOver : null;

// The board adds a row for the notices only while there is something to show, so a normal game does not move.
export function hasConnectionNotices(reconnection: ReconnectionView | undefined, viewerId: string): boolean {
  if (!reconnection) return false;
  return reconnection.lost.some((entry) => entry.playerId !== viewerId)
    || kickTargets(reconnection, viewerId).length > 0
    || takeOverTarget(reconnection, viewerId) !== null;
}

export function ConnectionNotices({ reconnection, viewerId, players, onKick, onTakeOver }: ConnectionNoticesProps): JSX.Element {
  // Players the viewer chose to keep waiting for. A choice lasts until that player's prompt goes away.
  const [waiting, setWaiting] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<{ kind: 'kick' | 'takeover'; id: string } | null>(null);

  const kickIds = kickTargets(reconnection, viewerId);
  const takeOverId = takeOverTarget(reconnection, viewerId);
  const promptKey = [...kickIds, ...(takeOverId ? [takeOverId] : [])].sort().join('|');
  useEffect(() => {
    const live = new Set(promptKey.split('|'));
    setWaiting((previous) => {
      const kept = [...previous].filter((id) => live.has(id));
      return kept.length === previous.size ? previous : new Set(kept);
    });
  }, [promptKey]);

  const nameOf = (id: string): string =>
    reconnection?.lost.find((entry) => entry.playerId === id)?.name ?? players.find((p) => p.id === id)?.name ?? 'A player';
  // A player's own drop is already shown by the "Disconnected from server" banner.
  const lost = (reconnection?.lost ?? []).filter((entry) => entry.playerId !== viewerId);
  const prompts = [
    ...kickIds.filter((id) => !waiting.has(id)).map((id) => ({ kind: 'kick' as const, id })),
    ...(takeOverId && !waiting.has(takeOverId) ? [{ kind: 'takeover' as const, id: takeOverId }] : [])
  ];

  const keepWaiting = (id: string): void => setWaiting((previous) => new Set(previous).add(id));
  const confirmingName = confirming ? nameOf(confirming.id) : '';

  return (
    <>
      {/* Always present, so a screen reader announces the text when it appears. Empty, it takes no room. */}
      <div className="connection-notices" aria-live="polite">
        {lost.map((entry) => (
          <p key={entry.playerId} className="connection-line">{`${entry.name} has lost their connection. Trying to reconnect...`}</p>
        ))}
        {prompts.map((prompt) => {
          const name = nameOf(prompt.id);
          return (
            <div key={`${prompt.kind}:${prompt.id}`} className="connection-prompt">
              <span>{prompt.kind === 'kick' ? `${name} has not come back.` : `${name}, the host, has not come back.`}</span>
              <span className="connection-actions">
                {prompt.kind === 'kick' ? (
                  <button type="button" className="danger" onClick={() => setConfirming(prompt)}>{`Kick ${name}`}</button>
                ) : (
                  <button type="button" className="primary" onClick={() => setConfirming(prompt)}>Take over as host</button>
                )}
                <button type="button" className="secondary" onClick={() => keepWaiting(prompt.id)}>Keep waiting</button>
              </span>
            </div>
          );
        })}
      </div>

      {confirming ? (
        <Modal
          className="panel end-game-confirm-modal"
          dismiss="esc"
          label={confirming.kind === 'kick' ? 'remove a disconnected player' : 'take over as host'}
          onClose={() => setConfirming(null)}
        >
          <h2>{confirming.kind === 'kick' ? `Remove ${confirmingName}?` : 'Take over as host?'}</h2>
          <p>
            {confirming.kind === 'kick'
              ? 'Their cards go back into the draw pile and the game goes on without them. It counts as a quit for them.'
              : `${confirmingName} will be removed from the game, and it counts as a quit for them. You will then control kicking and ending the game.`}
          </p>
          <div className="button-row">
            <button type="button" className="secondary" data-autofocus onClick={() => setConfirming(null)}>Cancel</button>
            <button
              type="button"
              className={confirming.kind === 'kick' ? 'danger' : 'primary'}
              onClick={() => {
                const choice = confirming;
                setConfirming(null);
                if (choice.kind === 'kick') onKick(choice.id);
                else onTakeOver(choice.id);
              }}
            >
              {confirming.kind === 'kick' ? `Remove ${confirmingName}` : 'Take over'}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
