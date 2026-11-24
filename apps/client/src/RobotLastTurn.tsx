import type { Card } from '@upndown/shared-types';
import type { JSX } from 'react';

// The cards a robot played on its last turn, beside its name. Nothing before its first turn; "skipped" after a skip.
export function RobotLastTurn({ cards }: { cards: readonly Card[] | undefined }): JSX.Element | null {
  if (!cards) return null;
  if (cards.length === 0) {
    return <span className="robot-last-turn robot-last-turn-none">skipped</span>;
  }
  return (
    <span className="robot-last-turn" role="img" aria-label={`Last turn: ${cards.map((card) => card.value).join(', ')}`}>
      {cards.map((card) => (
        <span key={card.id} className="last-turn-card" aria-hidden="true">{card.value}</span>
      ))}
    </span>
  );
}
