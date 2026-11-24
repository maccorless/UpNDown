import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RejoinNotice } from './RejoinNotice.js';

describe('the rejoin offer', () => {
  it('shows nothing when this browser holds no seat in a game being played', () => {
    const { container } = render(<RejoinNotice seats={[]} onRejoin={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  // A player with two games still going must be able to tell them apart by code, and pick the one they meant.
  it('names each game by its code and rejoins the one that was clicked', async () => {
    const onRejoin = vi.fn();
    render(<RejoinNotice seats={[{ seatKey: 'k1', gameId: 'ABC123', claimId: 'k1' }, { seatKey: 'k2', gameId: 'XYZ789', claimId: 'k2' }]} onRejoin={onRejoin} />);
    expect(screen.getAllByTestId('rejoin-game').map((b) => b.textContent)).toEqual(['Rejoin game ABC123', 'Rejoin game XYZ789']);
    await userEvent.click(screen.getByText('Rejoin game XYZ789'));
    expect(onRejoin).toHaveBeenCalledWith('k2');
  });
});
