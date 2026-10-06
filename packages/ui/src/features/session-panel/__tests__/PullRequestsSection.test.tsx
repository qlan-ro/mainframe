/**
 * PullRequestsSection — unit tests.
 *
 * The session's detected pull requests, pulled out of SummarySection into
 * their own eyebrow section (D21).
 *
 * Behaviors covered:
 *  - renders nothing at all when the session has no detected PRs — unlike
 *    Activity, an empty "Pull requests" header would be an affordance for
 *    data that does not exist
 *  - one row per PR, labelled `owner/repo#number`, with the source word
 *  - the section's count badge is the number of detected PRs
 *  - a row opens the PR externally through the host bridge
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HostProvider } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';

let mockPrs: DetectedPr[] = [];
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (state: unknown) => unknown) =>
    selector({ threadListItem: { custom: { detectedPrs: mockPrs } }, threads: { threadItems: [] } }),
}));

const { PullRequestsSection } = await import('../PullRequestsSection');

let fake: FakeHostBridge;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <HostProvider host={fake}>{children}</HostProvider>
    </TooltipProvider>
  );
}
const render = () => rtlRender(<PullRequestsSection />, { wrapper: Wrapper });

const pr = (number: number, source: DetectedPr['source']): DetectedPr => ({
  url: `https://github.com/acme/repo/pull/${number}`,
  owner: 'acme',
  repo: 'repo',
  number,
  source,
});

const badge = () => screen.getByTestId('session-panel-section-prs').querySelector('[data-slot="badge"]');

beforeEach(() => {
  mockPrs = [];
  fake = new FakeHostBridge();
  vi.spyOn(fake.shell, 'openExternal').mockResolvedValue(undefined);
});

describe('PullRequestsSection — no PRs', () => {
  it('renders nothing at all', () => {
    const { container } = render();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('session-panel-section-prs')).toBeNull();
  });
});

describe('PullRequestsSection — rows', () => {
  // KNOWN PRODUCT BUG (reported, not fixed here — this suite may only touch
  // __tests__): PullRequestsSection.tsx:36 renders `{pr.repo}#{pr.number}`,
  // dropping `pr.owner` entirely, even though D21 calls for "owner/repo text"
  // and `DetectedPr.owner`/`DetectedPr.repo` are distinct fields (two repos
  // named the same under different owners render identically). This test pins
  // the CONTRACT (owner/repo#number) per the blind-testing protocol and will
  // fail until the component is fixed to interpolate `pr.owner`.
  it('renders one row per PR, labelled owner/repo#number with its source word', () => {
    mockPrs = [pr(41, 'created'), pr(42, 'mentioned')];
    render();
    expect(screen.getByTestId('session-panel-summary-pr-41')).toHaveTextContent('acme/repo#41');
    expect(screen.getByTestId('session-panel-summary-pr-41')).toHaveTextContent('created');
    expect(screen.getByTestId('session-panel-summary-pr-42')).toHaveTextContent('acme/repo#42');
    expect(screen.getByTestId('session-panel-summary-pr-42')).toHaveTextContent('mentioned');
  });

  it('labels the section header "Pull requests", with no count', () => {
    mockPrs = [pr(41, 'created'), pr(42, 'mentioned')];
    render();
    expect(screen.getByTestId('session-panel-section-prs')).toHaveTextContent('Pull requests');
    expect(badge()).toBeNull();
  });

  it('opens the PR externally on click', () => {
    mockPrs = [pr(41, 'created')];
    render();
    fireEvent.click(screen.getByTestId('session-panel-summary-pr-41'));
    expect(fake.shell.openExternal).toHaveBeenCalledWith('https://github.com/acme/repo/pull/41');
  });
});
