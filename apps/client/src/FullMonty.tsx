import type { JSX } from 'react';
import { MONTY_GRID_MIN, type MontyCell } from '@upndown/shared-types';
import { Modal } from './Modal.js';

// What each color means, in words too, so nobody has to tell the colors apart to read the grid.
const STATUS_LABEL: Record<MontyCell, string> = {
  draw: 'In the draw pile',
  hand: 'In a hand',
  played: 'Played to a pile',
  out: 'Not one of this game’s cards'
};
const STATUSES: MontyCell[] = ['draw', 'hand', 'played', 'out'];

// The full Monty: every card from 1 to 100, colored by where it is. A gray card is not one of this game's cards at all.
export function FullMontyModal({ cells, onClose }: { cells: MontyCell[]; onClose: () => void }): JSX.Element {
  const count = (status: MontyCell): number => cells.filter((cell) => cell === status).length;
  return (
    <Modal className="panel full-monty-modal" dismiss="any" label="The full Monty" onClose={onClose}>
      <h2>The full Monty</h2>
      <p className="full-monty-summary">
        {count('draw')} in the draw pile, {count('hand')} in hands, {count('played')} played. {count('out')} are not cards in this game.
      </p>
      <ul className="full-monty-legend">
        {STATUSES.map((status) => (
          <li key={status}>
            <span className={`full-monty-swatch monty-${status}`} aria-hidden="true" />
            {STATUS_LABEL[status]}
          </li>
        ))}
      </ul>
      <div className="full-monty-grid" role="list" aria-label="Every card from 1 to 100">
        {cells.map((status, index) => {
          const value = MONTY_GRID_MIN + index;
          return (
            <span key={value} role="listitem" className={`full-monty-cell monty-${status}`} title={`${value}: ${STATUS_LABEL[status]}`} aria-label={`${value}, ${STATUS_LABEL[status]}`}>
              {value}
            </span>
          );
        })}
      </div>
    </Modal>
  );
}
