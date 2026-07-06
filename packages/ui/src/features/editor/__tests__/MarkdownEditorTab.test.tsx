import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MarkdownEditorTab } from '../MarkdownEditorTab';
import { MarkdownPreview } from '../MarkdownPreview';

const MD = '# Title\n\nSome **bold** text.\n\n- one\n- two\n';

// Mock surface-intents so ViewerShell's reveal button doesn't crash in preview mode.
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock for shiki to avoid loading WASM in jsdom.
// Returns fake colored tokens so we can assert the highlighted output.
// ---------------------------------------------------------------------------

vi.mock('@/lib/shiki-highlighter', () => {
  type FakeToken = { color?: string; content: string };
  type FakeResult = { tokens: FakeToken[][] };

  const SUPPORTED = new Set([
    'typescript',
    'javascript',
    'jsx',
    'tsx',
    'python',
    'rust',
    'go',
    'java',
    'json',
    'yaml',
    'toml',
    'xml',
    'bash',
    'css',
    'html',
    'sql',
    'markdown',
    'diff',
  ]);

  const ALIASES: Record<string, string> = {
    ts: 'typescript',
    js: 'javascript',
    py: 'python',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    md: 'markdown',
    rs: 'rust',
  };

  function resolveLanguage(raw: string | undefined): string | null {
    if (!raw) return null;
    const lower = raw.toLowerCase();
    const mapped = ALIASES[lower] ?? lower;
    return SUPPORTED.has(mapped) ? mapped : null;
  }

  const fakeHighlighter = {
    codeToTokens: (code: string, { lang }: { lang: string }): FakeResult => {
      if (lang === 'javascript') {
        return {
          tokens: [[{ color: '#c792ea', content: 'const' }, { content: ' x = 1' }]],
        };
      }
      // Other languages: single plain line (no color)
      return { tokens: [[{ content: code }]] };
    },
  };

  const listeners = new Set<() => void>();

  return {
    resolveLanguage,
    getShikiHighlighter: () => Promise.resolve({ highlighter: fakeHighlighter, theme: 'mf-warm-chrome-0' }),
    invalidateShikiTheme: () => {
      listeners.forEach((l) => l());
    },
    getShikiThemeVersion: () => 0,
    subscribeShikiTheme: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
});

// Capture props passed to CmEditor to assert readOnly forwarding.
type CmEditorProps = ComponentProps<typeof import('../CmEditor').CmEditor>;
const capturedCmEditorProps: CmEditorProps[] = [];

vi.mock('../CmEditor', () => ({
  CmEditor: (props: CmEditorProps) => {
    capturedCmEditorProps.push(props);
    return <div data-testid="cm-editor-mock" className="cm-editor" />;
  },
}));

describe('MarkdownPreview', () => {
  it('renders markdown as HTML (heading + list + bold)', () => {
    render(<MarkdownPreview value={MD} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Title');
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('has a centered max-width prose column (max-w-[720px] mx-auto)', () => {
    const { container } = render(<MarkdownPreview value={MD} />);
    // The outer scroll wrapper (data-testid="markdown-preview") must contain an
    // inner div that carries the centering classes.
    const outer = container.querySelector('[data-testid="markdown-preview"]');
    expect(outer).toBeTruthy();
    const inner = outer?.firstElementChild as HTMLElement | null;
    expect(inner?.className).toContain('max-w-[720px]');
    expect(inner?.className).toContain('mx-auto');
  });

  it('renders a fenced JS code block as a plain pre initially', () => {
    const md = '```javascript\nconst x = 1\n```';
    render(<MarkdownPreview value={md} />);
    // Before shiki resolves, the code block is a plain pre with the raw code.
    const pre = screen.getByRole('code');
    expect(pre).toBeInTheDocument();
  });

  it('swaps in shiki-highlighted spans after the highlighter resolves', async () => {
    const md = '```javascript\nconst x = 1\n```';
    render(<MarkdownPreview value={md} />);
    // After the async highlighter resolves, colored spans appear inside the pre.
    await waitFor(() => {
      const colored = document.querySelector('span[style*="color"]');
      expect(colored).not.toBeNull();
    });
  });

  it('falls back to plain pre for unknown languages', async () => {
    const md = '```unknownlang\nsome code\n```';
    render(<MarkdownPreview value={md} />);
    // Wait a tick to let any async work settle.
    await act(async () => {
      await Promise.resolve();
    });
    // The code block should still render — just unstyled.
    const pre = screen.getAllByRole('code');
    expect(pre.length).toBeGreaterThan(0);
    // No colored spans should appear for an unsupported language.
    const colored = document.querySelector('span[style*="color"]');
    expect(colored).toBeNull();
  });
});

describe('MarkdownEditorTab', () => {
  beforeEach(() => {
    capturedCmEditorProps.length = 0;
  });

  it('toggle labels are "Preview" and "Source" (not "Edit" and "Preview")', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);
    expect(screen.getByTestId('markdown-mode-preview').textContent).toBe('Preview');
    expect(screen.getByTestId('markdown-mode-edit').textContent).toBe('Source');
  });

  it('starts in Preview mode showing the rendered preview, not the CM6 editor', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);
    expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('cm-editor-mock')).toBeNull();
  });

  it('switches to Source mode and back to Preview', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);

    // Default is Preview.
    expect(screen.getByTestId('markdown-preview')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Title');

    fireEvent.click(screen.getByTestId('markdown-mode-edit'));
    expect(screen.queryByTestId('markdown-preview')).toBeNull();
    expect(screen.getByTestId('cm-editor-mock')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('markdown-mode-preview'));
    expect(screen.getByTestId('markdown-preview')).toBeTruthy();
  });

  it('has exactly one viewer-shell regardless of mode (no duplicate chrome)', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);

    // Preview mode (default): the single persistent ViewerShell should be present.
    expect(screen.getAllByTestId('viewer-shell')).toHaveLength(1);

    // Source mode: still only ONE ViewerShell.
    fireEvent.click(screen.getByTestId('markdown-mode-edit'));
    expect(screen.getAllByTestId('viewer-shell')).toHaveLength(1);
  });

  it('ViewerShell is always present and contains the toggle in the header', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);
    // Shell present in Source mode (not just the default Preview mode).
    fireEvent.click(screen.getByTestId('markdown-mode-edit'));
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
    expect(screen.getByTestId('viewer-shell-status')).toBeInTheDocument();
  });

  it('wraps the preview in ViewerShell when in preview mode', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);

    // Switch to Preview mode
    fireEvent.click(screen.getByTestId('markdown-mode-preview'));

    // ViewerShell should be present
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
    expect(screen.getByTestId('viewer-shell-status')).toBeInTheDocument();
  });

  it('status shows "Markdown · UTF-8" on the left and word/line counts on the right', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);

    // Left slot: always "Markdown · UTF-8"
    const status = screen.getByTestId('viewer-shell-status');
    expect(status.textContent).toMatch(/Markdown/);

    // Right slot: word and line counts — search the full body text
    const bodyText = document.body.textContent ?? '';
    expect(bodyText).toMatch(/words/);
    expect(bodyText).toMatch(/lines/);
  });

  it('passes readOnly={true} to CmEditor when readOnly prop is set', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} readOnly />);
    // CmEditor only mounts in Source mode (Preview is the default).
    fireEvent.click(screen.getByTestId('markdown-mode-edit'));

    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    expect(lastProps?.readOnly).toBe(true);
  });

  it('passes readOnly={false} to CmEditor by default', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);
    // CmEditor only mounts in Source mode (Preview is the default).
    fireEvent.click(screen.getByTestId('markdown-mode-edit'));

    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    expect(lastProps?.readOnly).toBe(false);
  });

  it('Preview/Source toggle buttons use rounded-sm (6px) inner radius, not rounded-md (8px)', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);
    expect(screen.getByTestId('markdown-mode-preview').className).toContain('rounded-sm');
    expect(screen.getByTestId('markdown-mode-edit').className).toContain('rounded-sm');
  });
});
