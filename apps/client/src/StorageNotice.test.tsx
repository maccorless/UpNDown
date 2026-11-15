import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StorageNotice } from './StorageNotice.js';

describe('the saving-unavailable notice', () => {
  it('says so, in plain words, when the database is down, and that solitaire is fine', () => {
    render(<StorageNotice storage="down" />);
    const text = screen.getByTestId('storage-notice').textContent!;
    expect(text).toContain('Saving is unavailable right now');
    expect(text).toContain('may be lost if the server restarts');
    expect(text).toContain('solitaire is not affected');
  });

  it('says there is no database in a version that has none by design', () => {
    render(<StorageNotice storage="none" />);
    expect(screen.getByTestId('storage-notice').textContent).toContain('no database');
  });

  it.each(['ok', 'unknown'] as const)('says nothing when saving works or the server did not say (%s)', (storage) => {
    render(<StorageNotice storage={storage} />);
    expect(screen.queryByTestId('storage-notice')).toBeNull();
  });
});
