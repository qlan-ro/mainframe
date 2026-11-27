import { render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useUiPrefs } from '@/store/ui-prefs';
import { useTranscriptScroll } from '@/features/chat/thread/transcript-scroll-context';
import { SubagentScroller } from '../SubagentScroller';

function Probe() {
  const scroll = useTranscriptScroll();
  return <p data-testid="probe">{scroll?.owned ? `owned:${scroll.isFollowing()}` : 'none'}</p>;
}

afterEach(() => useUiPrefs.setState({ plainTranscript: false }));

it('gives the tab the scroll owner on the plain list, opened at the top', () => {
  useUiPrefs.setState({ plainTranscript: true });
  render(
    <SubagentScroller label="Review agent">
      <Probe />
    </SubagentScroller>,
  );
  const region = screen.getByRole('region', { name: 'Review agent' });
  expect(region).toHaveAttribute('data-conversation-scroller');
  expect(region).toContainElement(screen.getByTestId('probe'));
  expect(screen.getByTestId('probe')).toHaveTextContent('owned:false');
});

it('keeps the plain scroll area on the other list', () => {
  render(
    <SubagentScroller label="Review agent">
      <Probe />
    </SubagentScroller>,
  );
  expect(screen.getByRole('region', { name: 'Review agent' })).toContainElement(screen.getByTestId('probe'));
  expect(screen.getByTestId('probe')).toHaveTextContent('none');
});
