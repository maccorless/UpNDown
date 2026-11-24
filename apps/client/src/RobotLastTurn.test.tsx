import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RobotLastTurn } from './RobotLastTurn.js';

// The robots play too fast to follow, so their last turn stays beside their name. Someone who cannot see the chips still hears
// what was played, from the label.
describe('a robot\'s last turn, beside its name', () => {
  it('shows the cards it played, in the order played, and says them in its label', () => {
    render(<RobotLastTurn cards={[{ id: 'c-12', value: 12 }, { id: 'c-9', value: 9 }]} />);
    expect(screen.getByRole('img', { name: 'Last turn: 12, 9' })).toBeTruthy();
  });

  it('says skipped after a skip, and shows nothing before its first turn', () => {
    const skipped = render(<RobotLastTurn cards={[]} />);
    expect(screen.getByText('skipped')).toBeTruthy();
    skipped.unmount();
    const beforeFirstTurn = render(<RobotLastTurn cards={undefined} />);
    expect(beforeFirstTurn.container.textContent).toBe('');
  });
});
