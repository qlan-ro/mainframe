/**
 * Behavior tests for SearchCard.
 *
 * Each test passes a fixed, concrete props object and asserts observable DOM
 * output — no re-derivation of the card's internal logic.
 *
 * Body content lives inside a Radix Collapsible that starts closed. Tests
 * that assert on body content first click the trigger to open it.
 *
 * Mocked seams:
 *  - chat-tool-context: useChatId returns undefined; useOpenFile returns stubs.
 *  - ToolResultExpand: stubbed — the Tauri bridge fetch is not under test here.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockOpenFile = vi.fn();

vi.mock('@/features/chat/tools/chat-tool-context', () => ({
  useChatId: () => undefined,
  useOpenFile: () => ({ openFile: mockOpenFile, revealFile: () => {} }),
}));

vi.mock('@/features/chat/tools/ToolResultExpand', () => ({
  ToolResultExpand: () => <div data-testid="tool-result-expand-mock">expand-mock</div>,
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { SearchCard } from '../SearchCard';

// ---------------------------------------------------------------------------
// Wrapper — satisfies Radix Tooltip requirement
// ---------------------------------------------------------------------------

function Wrap({ children }: { children: React.ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

// ---------------------------------------------------------------------------
// Shared stub callbacks
// ---------------------------------------------------------------------------

const noop = () => {};
const baseProps = {
  type: 'tool-call' as const,
  toolCallId: 'tc-search-001',
  argsText: '',
  addResult: noop,
  resume: noop,
  respondToApproval: noop,
  messages: [],
  status: { type: 'complete' as const },
};

// ---------------------------------------------------------------------------
// Verb mapping tests (Glob / Grep / List)
// ---------------------------------------------------------------------------

describe('SearchCard — verb mapping', () => {
  it('renders "Glob" for toolName="Glob"', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="Glob"
          args={{ glob: '**/*.ts' }}
          result={'/a/b.ts\n/a/c.ts'}
          isError={false}
        />
      </Wrap>,
    );
    expect(screen.getByText('Glob')).toBeInTheDocument();
  });

  it('renders "Grep" for toolName="Grep"', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="Grep"
          args={{ pattern: 'useState' }}
          result={'no matches'}
          isError={false}
        />
      </Wrap>,
    );
    expect(screen.getByText('Grep')).toBeInTheDocument();
  });

  it('renders "List" for toolName="LS"', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="LS"
          args={{ path: '/home/user/project' }}
          result={'src/\ndist/'}
          isError={false}
        />
      </Wrap>,
    );
    expect(screen.getByText('List')).toBeInTheDocument();
  });

  it('renders "Glob" for an unknown toolName (fallback)', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="UnknownTool"
          args={{ glob: '*.json' }}
          result={'result.json'}
          isError={false}
        />
      </Wrap>,
    );
    expect(screen.getByText('Glob')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pattern display
// ---------------------------------------------------------------------------

describe('SearchCard — pattern display', () => {
  it('displays the pattern from args.pattern for Grep', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="Grep"
          args={{ pattern: 'useEffect' }}
          result={'no matches'}
          isError={false}
        />
      </Wrap>,
    );
    // Pattern is rendered as "useEffect" inside a code element
    expect(screen.getByText('"useEffect"')).toBeInTheDocument();
  });

  it('displays the glob pattern from args.glob', () => {
    render(
      <Wrap>
        <SearchCard {...baseProps} toolName="Glob" args={{ glob: '**/*.tsx' }} result={'App.tsx'} isError={false} />
      </Wrap>,
    );
    expect(screen.getByText('"**/*.tsx"')).toBeInTheDocument();
  });

  it('displays the search path sub-header when args.path is set', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="Grep"
          args={{ pattern: 'foo', path: '/project/src' }}
          result={'match'}
          isError={false}
        />
      </Wrap>,
    );
    expect(screen.getByTestId('search-card-path')).toHaveTextContent('in /project/src');
  });

  it('does not render a path sub-header when args.path is absent', () => {
    render(
      <Wrap>
        <SearchCard {...baseProps} toolName="Grep" args={{ pattern: 'bar' }} result={'match'} isError={false} />
      </Wrap>,
    );
    expect(screen.queryByTestId('search-card-path')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Done state — plain body
// ---------------------------------------------------------------------------

describe('SearchCard — done state (plain body)', () => {
  it('renders the card root', () => {
    render(
      <Wrap>
        <SearchCard {...baseProps} toolName="Glob" args={{ glob: '*.ts' }} result={'file.ts'} isError={false} />
      </Wrap>,
    );
    expect(screen.getByTestId('search-card-root')).toBeInTheDocument();
  });

  it('renders the plain body with the result text', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="Glob"
          args={{ glob: '*.ts' }}
          result={'src/index.ts\nsrc/app.ts'}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('search-card-trigger'));
    const body = screen.getByTestId('search-card-plain-body');
    expect(body).toHaveTextContent('src/index.ts');
    expect(body).toHaveTextContent('src/app.ts');
  });

  it('renders a JSON result serialized as pretty-printed text', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="Glob"
          args={{ glob: '*.ts' }}
          result={{ files: ['a.ts', 'b.ts'] }}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('search-card-trigger'));
    const body = screen.getByTestId('search-card-plain-body');
    // The card JSON.stringify's the object — the rendered text must include
    // the field name "files"
    expect(body).toHaveTextContent('files');
    expect(body).toHaveTextContent('a.ts');
  });
});

// ---------------------------------------------------------------------------
// Pending state
// ---------------------------------------------------------------------------

describe('SearchCard — pending state (result === undefined)', () => {
  it('does not render the body content element when result is absent', () => {
    render(
      <Wrap>
        <SearchCard {...baseProps} toolName="Grep" args={{ pattern: 'todo' }} result={undefined} isError={undefined} />
      </Wrap>,
    );
    expect(screen.queryByTestId('search-card-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('search-card-plain-body')).not.toBeInTheDocument();
  });

  it('still renders the verb and pattern in the header while pending', () => {
    render(
      <Wrap>
        <SearchCard {...baseProps} toolName="Grep" args={{ pattern: 'todo' }} result={undefined} isError={undefined} />
      </Wrap>,
    );
    expect(screen.getByText('Grep')).toBeInTheDocument();
    expect(screen.getByText('"todo"')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('SearchCard — error state', () => {
  it('renders the error body element', () => {
    render(
      <Wrap>
        <SearchCard {...baseProps} toolName="Grep" args={{ pattern: 'foo' }} result={'Access denied'} isError={true} />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('search-card-trigger'));
    expect(screen.getByTestId('search-card-error-body')).toBeInTheDocument();
  });

  it('strips <error> sentinel tags from the error text', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="Grep"
          args={{ pattern: 'foo' }}
          result={'<error>pattern too broad</error>'}
          isError={true}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('search-card-trigger'));
    const errorBody = screen.getByTestId('search-card-error-body');
    expect(errorBody).toHaveTextContent('pattern too broad');
    expect(errorBody).not.toHaveTextContent('<error>');
  });

  it('does not render the plain body when isError is true', () => {
    render(
      <Wrap>
        <SearchCard {...baseProps} toolName="Grep" args={{ pattern: 'foo' }} result={'error text'} isError={true} />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('search-card-trigger'));
    expect(screen.queryByTestId('search-card-plain-body')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Grep structured match rows
// ---------------------------------------------------------------------------

describe('SearchCard — Grep structured matches', () => {
  const grepResult = JSON.stringify([
    { file: '/project/src/App.tsx', line: 42, text: 'const x = useEffect' },
    { file: '/project/src/util.ts', line: 7, text: 'export function helper' },
  ]);

  it('renders match rows for each structured grep result', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="Grep"
          args={{ pattern: 'useEffect' }}
          result={grepResult}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('search-card-trigger'));
    const rows = screen.getAllByTestId('search-card-match-row');
    // Two entries in the fixture → two rows
    expect(rows).toHaveLength(2);
  });

  it('renders the short filename (last two segments) in a match row', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="Grep"
          args={{ pattern: 'useEffect' }}
          result={grepResult}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('search-card-trigger'));
    // shortFilename('/project/src/App.tsx') → 'src/App.tsx'
    const rows = screen.getAllByTestId('search-card-match-row');
    expect(rows[0]).toHaveTextContent('src/App.tsx');
  });

  it('renders the line number in a match row', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="Grep"
          args={{ pattern: 'useEffect' }}
          result={grepResult}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('search-card-trigger'));
    const rows = screen.getAllByTestId('search-card-match-row');
    expect(rows[0]).toHaveTextContent(':42');
  });

  it('renders the match text snippet in a match row', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="Grep"
          args={{ pattern: 'useEffect' }}
          result={grepResult}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('search-card-trigger'));
    const rows = screen.getAllByTestId('search-card-match-row');
    expect(rows[0]).toHaveTextContent('const x = useEffect');
  });

  it('calls openFile with the full path when a match row is clicked', () => {
    mockOpenFile.mockClear();
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="Grep"
          args={{ pattern: 'useEffect' }}
          result={grepResult}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('search-card-trigger'));
    const rows = screen.getAllByTestId('search-card-match-row');
    fireEvent.click(rows[0]!);
    expect(mockOpenFile).toHaveBeenCalledWith('/project/src/App.tsx');
  });

  it('renders structured matches from a raw array (not a JSON string)', () => {
    const rawArray = [{ file: '/a/b/c.ts', line: 1, text: 'hello' }];
    render(
      <Wrap>
        <SearchCard {...baseProps} toolName="Grep" args={{ pattern: 'hello' }} result={rawArray} isError={false} />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('search-card-trigger'));
    expect(screen.getAllByTestId('search-card-match-row')).toHaveLength(1);
  });

  it('falls back to plain body when Grep result is a non-match JSON string', () => {
    render(
      <Wrap>
        <SearchCard
          {...baseProps}
          toolName="Grep"
          args={{ pattern: 'foo' }}
          // valid JSON but not an array of {file:...} objects
          result={'{"message":"no matches"}'}
          isError={false}
        />
      </Wrap>,
    );
    fireEvent.click(screen.getByTestId('search-card-trigger'));
    expect(screen.queryByTestId('search-card-grep-matches')).not.toBeInTheDocument();
    expect(screen.getByTestId('search-card-plain-body')).toBeInTheDocument();
  });
});
