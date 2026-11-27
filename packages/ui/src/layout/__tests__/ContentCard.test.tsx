import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { beginBootRestore, decideBootRestore, resetBootRestore } from '@/features/sessions/runtime/boot-restore';
import { ContentCard } from '../ContentCard';

beforeEach(() => resetBootRestore());

describe('ContentCard — boot restore hold', () => {
  it('draws the card empty while the last chat is restored, then paints what is inside', () => {
    beginBootRestore();
    render(
      <ContentCard>
        <div data-testid="inside" />
      </ContentCard>,
    );
    const card = screen.getByTestId('content-card');
    expect(card).toHaveAttribute('data-boot-restoring');
    // The children stay mounted and laid out; only their painting is held. The card's own ground stays.
    expect(card).toHaveClass('[&>*]:invisible', 'bg-background');
    expect(screen.getByTestId('inside')).toBeInTheDocument();

    act(() => decideBootRestore(null));
    expect(card).not.toHaveAttribute('data-boot-restoring');
    expect(card).not.toHaveClass('[&>*]:invisible');
  });

  it('is a plain card when nothing is being restored', () => {
    render(<ContentCard />);
    expect(screen.getByTestId('content-card')).not.toHaveAttribute('data-boot-restoring');
  });
});
