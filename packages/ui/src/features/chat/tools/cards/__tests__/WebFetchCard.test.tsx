/**
 * Behavior tests for WebFetchCard (WebFetch + WebSearch).
 *
 * Design contract (09-toolcards.jsx: TOOL_META.web + web body):
 *  - globe icon, verb "Fetch", clickable url (accent, mono), summary paragraph.
 *
 * Each test passes a fixed, concrete props object and asserts observable DOM
 * output — no re-derivation of the card's internal logic.
 *
 * Mocked seams:
 *  - lib/host: useHost().shell.openExternal is a spy so link clicks are
 *    observable without a real Tauri/Electron bridge.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockOpenExternal = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/host', () => ({
  useHost: () => ({ shell: { openExternal: mockOpenExternal } }),
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { WebFetchCard } from '../WebFetchCard';

function Wrap({ children }: { children: React.ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

const noop = () => {};
const baseProps = {
  type: 'tool-call' as const,
  toolCallId: 'tc-web-001',
  argsText: '',
  addResult: noop,
  resume: noop,
  respondToApproval: noop,
  messages: [],
  status: { type: 'complete' as const },
};

// ---------------------------------------------------------------------------
// WebFetch
// ---------------------------------------------------------------------------

describe('WebFetchCard — WebFetch', () => {
  it('renders the "Fetch" verb', () => {
    render(
      <Wrap>
        <WebFetchCard
          {...baseProps}
          toolName="WebFetch"
          args={{ url: 'https://example.com/docs', prompt: 'summarize' }}
          result={'The docs page explains X.'}
          isError={false}
        />
      </Wrap>,
    );
    expect(screen.getByText('Fetch')).toBeInTheDocument();
  });

  it('renders the url as a clickable link in the body', () => {
    render(
      <Wrap>
        <WebFetchCard
          {...baseProps}
          toolName="WebFetch"
          args={{ url: 'https://example.com/docs', prompt: 'summarize' }}
          result={'The docs page explains X.'}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('web-fetch-card-trigger'));
    expect(screen.getByTestId('web-fetch-card-url')).toHaveTextContent('https://example.com/docs');
  });

  it('opens the url via the host shell when clicked', () => {
    render(
      <Wrap>
        <WebFetchCard
          {...baseProps}
          toolName="WebFetch"
          args={{ url: 'https://example.com/docs', prompt: 'summarize' }}
          result={'The docs page explains X.'}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('web-fetch-card-trigger'));
    fireEvent.click(screen.getByTestId('web-fetch-card-url'));
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('renders the result text as the summary paragraph', () => {
    render(
      <Wrap>
        <WebFetchCard
          {...baseProps}
          toolName="WebFetch"
          args={{ url: 'https://example.com/docs', prompt: 'summarize' }}
          result={'The docs page explains X.'}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('web-fetch-card-trigger'));
    expect(screen.getByTestId('web-fetch-card-summary')).toHaveTextContent('The docs page explains X.');
  });
});

// ---------------------------------------------------------------------------
// WebSearch
// ---------------------------------------------------------------------------

describe('WebFetchCard — WebSearch', () => {
  it('renders the search query as the header target instead of a url', () => {
    render(
      <Wrap>
        <WebFetchCard
          {...baseProps}
          toolName="WebSearch"
          args={{ query: 'react suspense' }}
          result={'Found 5 results for react suspense.'}
          isError={false}
        />
      </Wrap>,
    );
    expect(screen.getByText('"react suspense"')).toBeInTheDocument();
  });

  it('renders "Search" as the verb for WebSearch', () => {
    render(
      <Wrap>
        <WebFetchCard
          {...baseProps}
          toolName="WebSearch"
          args={{ query: 'react suspense' }}
          result={'Found 5 results.'}
          isError={false}
        />
      </Wrap>,
    );
    expect(screen.getByText('Search')).toBeInTheDocument();
  });

  it('does not render a clickable url row for WebSearch', () => {
    render(
      <Wrap>
        <WebFetchCard
          {...baseProps}
          toolName="WebSearch"
          args={{ query: 'react suspense' }}
          result={'Found 5 results.'}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('web-fetch-card-trigger'));
    expect(screen.queryByTestId('web-fetch-card-url')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error / pending states
// ---------------------------------------------------------------------------

describe('WebFetchCard — error state', () => {
  it('renders the error body and strips sentinel tags', () => {
    render(
      <Wrap>
        <WebFetchCard
          {...baseProps}
          toolName="WebFetch"
          args={{ url: 'https://example.com', prompt: 'x' }}
          result={'<error>fetch failed</error>'}
          isError={true}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('web-fetch-card-trigger'));
    const body = screen.getByTestId('web-fetch-card-error-body');
    expect(body).toHaveTextContent('fetch failed');
    expect(body).not.toHaveTextContent('<error>');
  });
});

describe('WebFetchCard — pending state', () => {
  it('renders the verb while result is undefined, with no body', () => {
    render(
      <Wrap>
        <WebFetchCard
          {...baseProps}
          toolName="WebFetch"
          args={{ url: 'https://example.com', prompt: 'x' }}
          result={undefined}
          isError={undefined}
        />
      </Wrap>,
    );
    expect(screen.getByText('Fetch')).toBeInTheDocument();
    expect(screen.queryByTestId('web-fetch-card-summary')).not.toBeInTheDocument();
  });
});
