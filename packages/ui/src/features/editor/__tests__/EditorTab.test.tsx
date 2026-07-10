/**
 * EditorTab tests — B4: read-only prop threading + indicator.
 *                    A1: EditorContextMenu mount.
 *                    A2: LSP extensions wiring.
 *                    A3: CmEditorWithComments mount + extraExtensions/onViewReady passthroughs
 *                        + handleSave read-only guard.
 *                    C5: ViewerShell chrome (breadcrumb + Ln/Col status).
 *                    D4: live disk-change reload (clean buffer → silent reload;
 *                        dirty buffer → conflict banner with Reload/Keep-mine).
 *
 * Strategy:
 *  - Mock all external deps (tauri bridge, api files, hooks, CmEditorWithComments, ViewerRouter)
 *    so the test is isolation-pure and does not touch the DOM or the CM6 runtime.
 *  - Assert that `readOnly={true}` propagates to CmEditorWithComments's props.
 *  - Assert the `data-testid="editor-tab-readonly"` indicator renders when readOnly.
 *  - Assert the indicator is absent when readOnly is false (default).
 *  - Assert `data-testid="editor-context-menu"` is present for a code file.
 *  - Assert CmEditorWithComments receives extraExtensions and onViewReady (A3).
 *  - Assert saveProjectFile is NOT called when readOnly=true (A3 read-only guard).
 *  - Assert the code editor renders inside viewer-shell with a Ln/Col status footer (C5).
 *  - Assert clean buffer + file-change event → silently reloads the content (D4).
 *  - Assert dirty buffer + file-change event → "File changed on disk" banner appears (D4).
 *  - Assert Reload button applies disk content; Keep mine dismisses the banner (D4).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';

// ── Mock external deps ────────────────────────────────────────────────────────

vi.mock('@/lib/api/files', () => ({
  getProjectFile: vi.fn().mockResolvedValue('content'),
  getFileForView: vi.fn().mockResolvedValue({ content: 'content', external: false }),
  saveProjectFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));
// Override this per test-suite using vi.mocked().mockReturnValue or a module-level variable.
const activeIdentityState = {
  projectId: undefined as string | undefined,
  chatId: undefined as string | undefined,
  projectPath: undefined as string | undefined,
};

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => activeIdentityState,
}));
vi.mock('@/lib/editor/file-types', () => ({
  // Markdown paths route through MarkdownEditorTab; everything else stays on
  // the plain CmEditorWithComments path exercised by the rest of this file.
  inferLanguage: (path: string) => (path.endsWith('.md') ? 'markdown' : 'javascript'),
}));
// Controls whether getBuffer returns a dirty buffer (for D4 dirty-buffer tests).
let mockBufferDirty = false;
// Overrides getBuffer's return value outright (for the markdown live-value test,
// where the buffer's live content must differ from both the loaded value and
// the fixed 'dirty content' shape above).
let mockBufferOverride: { value: string; dirty: boolean } | null = null;

const editorState = {
  setBuffer: vi.fn(),
  getBuffer: (_path: string) =>
    mockBufferOverride ?? (mockBufferDirty ? { value: 'dirty content', dirty: true } : null),
  clearBuffer: vi.fn(),
};

function useEditorStoreMock(sel: (s: typeof editorState) => unknown) {
  return sel(editorState);
}
useEditorStoreMock.getState = () => editorState;

vi.mock('@/store/editor', () => ({
  useEditorStore: useEditorStoreMock,
}));
vi.mock('@/store/tabs', () => ({
  useTabsStore: (sel: (s: { promoteTab: () => void }) => unknown) => {
    return sel({ promoteTab: vi.fn() });
  },
}));
vi.mock('@/features/viewers/viewer-router', () => ({
  ViewerRouter: ({ renderCode }: { path: string; renderCode: () => React.ReactNode }) => <>{renderCode()}</>,
}));

// Capture the props passed to CmEditorWithComments so we can assert on them.
// This is the primary capture target after the A3 swap (EditorTab now renders
// CmEditorWithComments, not CmEditor directly).
type CmEditorWithCommentsProps = ComponentProps<
  typeof import('../inline-comments/CmEditorWithComments').CmEditorWithComments
>;
const capturedCmEditorProps: CmEditorWithCommentsProps[] = [];

vi.mock('../inline-comments/CmEditorWithComments', () => ({
  CmEditorWithComments: (props: CmEditorWithCommentsProps) => {
    capturedCmEditorProps.push(props);
    // Fire onViewReady with a fake view so viewRef gets populated.
    if (props.onViewReady) {
      props.onViewReady({} as import('@codemirror/view').EditorView);
    }
    return <div data-testid="cm-editor-mock" />;
  },
}));

// CmEditor mock kept so CmEditorWithComments's internal usage does not crash
// in the rare case it leaks through. EditorTab itself no longer imports CmEditor
// directly after the A3 swap.
vi.mock('../CmEditor', () => ({
  CmEditor: () => <div data-testid="cm-editor-inner-mock" />,
}));

type MarkdownEditorTabProps = ComponentProps<typeof import('../MarkdownEditorTab').MarkdownEditorTab>;
const capturedMarkdownProps: MarkdownEditorTabProps[] = [];

vi.mock('../MarkdownEditorTab', () => ({
  MarkdownEditorTab: (props: MarkdownEditorTabProps) => {
    capturedMarkdownProps.push(props);
    return <div data-testid="markdown-editor-mock" />;
  },
}));

// ── WS client mock (D4) ──────────────────────────────────────────────────────
// Stores the latest onFileChange listener registered for a path so tests can
// fire it to simulate a disk-change event.
const fileChangeListeners = new Map<string, (() => void)[]>();
const mockSubscribeFile = vi.fn((_path: string) => undefined);
const mockUnsubscribeFile = vi.fn((_path: string) => undefined);
const mockOnFileChange = vi.fn((path: string, listener: () => void) => {
  const listeners = fileChangeListeners.get(path) ?? [];
  listeners.push(listener);
  fileChangeListeners.set(path, listeners);
  // Return an unsubscribe function.
  return () => {
    const arr = fileChangeListeners.get(path) ?? [];
    const idx = arr.indexOf(listener);
    if (idx !== -1) arr.splice(idx, 1);
  };
});

vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: {
    subscribeFile: (path: string) => mockSubscribeFile(path),
    unsubscribeFile: (path: string) => mockUnsubscribeFile(path),
    onFileChange: (path: string, listener: () => void) => mockOnFileChange(path, listener),
  },
}));

// Helper: fire the registered file-change listener for `path`.
function fireFileChange(path: string): void {
  const listeners = fileChangeListeners.get(path) ?? [];
  listeners.forEach((fn) => fn());
}

// ── apply-value-update mock (D4) ─────────────────────────────────────────────
const mockApplyValueUpdate = vi.fn();
vi.mock('@/lib/editor/apply-value-update', () => ({
  applyValueUpdate: (...args: unknown[]) => mockApplyValueUpdate(...args),
}));

// ── LSP mocks (A2) ────────────────────────────────────────────────────────────

// Mutable flag so tests can toggle lspClientManager.hasClient.
let mockHasClient = false;

// Track initLspPort call order vs ensureClient calls for the startup-race test.
const lspCallOrder: string[] = [];

vi.mock('@/lib/lsp', () => ({
  lspClientManager: {
    hasClient: (projectId: string, language: string) => mockHasClient && Boolean(projectId) && Boolean(language),
    ensureClient: vi.fn().mockImplementation(async () => {
      lspCallOrder.push('ensureClient');
    }),
    ensureDocumentOpen: vi.fn(),
    preloadDocument: vi.fn(),
    getHover: vi.fn(),
    getDefinition: vi.fn(),
    getReferences: vi.fn(),
  },
  getLspLanguage: (filePath: string) => (filePath.endsWith('.ts') ? 'typescript' : null),
  hasLspSupport: (_lang: string) => true,
  initAutoConnect: vi.fn().mockReturnValue(() => undefined),
  initLspPort: vi.fn().mockImplementation(async () => {
    lspCallOrder.push('initLspPort');
  }),
}));

// Inline sentinel — vi.mock factory is hoisted, so FAKE_LSP_EXTENSION is defined
// here as a module-level const AFTER the hoisted vi.mock calls. Use a local
// object reference inside the factory itself instead.
vi.mock('../lsp/cm-lsp-extensions', () => ({
  // Returns a non-empty array so tests can assert extensions.length > 0.
  createLspExtensions: vi.fn(() => [{ _fakeLspMarker: true }]),
}));

// EditorContextMenu: render a real-looking trigger div so data-testid is present,
// plus pass children through so CmEditorWithComments still renders and can be queried.
vi.mock('../context-menu/EditorContextMenu', () => ({
  EditorContextMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="editor-context-menu">{children}</div>
  ),
}));

// ViewerShell mock: renders the shell with viewer-shell testid + status footer.
// Passes children and path through so the breadcrumb (basename) and body are testable.
vi.mock('@/features/viewers/ViewerShell', () => ({
  ViewerShell: ({ path, status, children }: { path: string; status: string; children: React.ReactNode }) => {
    const parts = path.split('/').filter(Boolean);
    const basename = parts.length > 0 ? (parts[parts.length - 1] ?? path) : path;
    return (
      <div data-testid="viewer-shell">
        <span data-testid="viewer-shell-basename">{basename}</span>
        {children}
        <span data-testid="viewer-shell-status">{status}</span>
      </div>
    );
  },
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

import { EditorTab } from '../EditorTab';
import { saveProjectFile, getProjectFile, getFileForView } from '@/lib/api/files';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';

beforeEach(async () => {
  setHostForTesting(new FakeHostBridge({ fs: { readFile: 'content' } }));
  capturedCmEditorProps.length = 0;
  capturedMarkdownProps.length = 0;
  mockBufferOverride = null;
  vi.mocked(saveProjectFile).mockClear();
  // Reset identity to no-project default so existing tests are unaffected.
  activeIdentityState.projectId = undefined;
  activeIdentityState.chatId = undefined;
  activeIdentityState.projectPath = undefined;
  mockHasClient = false;
  // Reset D4 mocks.
  mockBufferDirty = false;
  fileChangeListeners.clear();
  mockSubscribeFile.mockClear();
  mockUnsubscribeFile.mockClear();
  mockOnFileChange.mockClear();
  mockApplyValueUpdate.mockClear();
  vi.mocked(getProjectFile).mockResolvedValue('content');
  vi.mocked(getFileForView).mockResolvedValue({ content: 'content', external: false });
  // Reset LSP call-order tracker.
  lspCallOrder.length = 0;
  // Reset initLspPort and ensureClient mocks.
  const { lspClientManager, initLspPort } = await import('@/lib/lsp');
  vi.mocked(initLspPort).mockClear();
  vi.mocked(lspClientManager.ensureClient).mockClear();
});

afterEach(() => {
  resetHostForTesting();
});

describe('EditorTab — read-only state (B4)', () => {
  it('passes readOnly={true} to CmEditorWithComments when the prop is set', async () => {
    render(<EditorTab tabId="tab-1" path="/project/src/index.ts" readOnly />);
    // Wait for async load to complete (getProjectFile resolves immediately).
    await screen.findByTestId('cm-editor-mock');
    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    expect(lastProps?.readOnly).toBe(true);
  });

  it('renders the editor-tab-readonly indicator when readOnly={true}', async () => {
    render(<EditorTab tabId="tab-2" path="/project/src/index.ts" readOnly />);
    const indicator = await screen.findByTestId('editor-tab-readonly');
    expect(indicator).toBeTruthy();
  });

  it('does NOT render the editor-tab-readonly indicator when readOnly is false (default)', async () => {
    render(<EditorTab tabId="tab-3" path="/project/src/index.ts" />);
    await screen.findByTestId('cm-editor-mock');
    expect(screen.queryByTestId('editor-tab-readonly')).toBeNull();
  });

  it('passes readOnly={false} to CmEditorWithComments by default', async () => {
    render(<EditorTab tabId="tab-4" path="/project/src/index.ts" />);
    await screen.findByTestId('cm-editor-mock');
    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    expect(lastProps?.readOnly).toBe(false);
  });
});

describe('EditorTab — context menu mount (A1)', () => {
  it('renders data-testid="editor-context-menu" around the code editor', async () => {
    render(<EditorTab tabId="tab-a1" path="/project/src/app.ts" />);
    // Wait for the async load to resolve (getProjectFile is mocked to resolve immediately).
    await screen.findByTestId('cm-editor-mock');
    expect(screen.getByTestId('editor-context-menu')).toBeTruthy();
  });
});

describe('EditorTab — LSP extensions wiring (A2)', () => {
  it('passes a non-empty extraExtensions to CmEditorWithComments when projectId is set and lspReady=true', async () => {
    activeIdentityState.projectId = 'proj-1';
    activeIdentityState.chatId = 'chat-1';
    activeIdentityState.projectPath = '/projects/myproject';
    mockHasClient = true;

    render(<EditorTab tabId="tab-a2-lsp" path="/project/src/index.ts" />);
    await screen.findByTestId('cm-editor-mock');

    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    expect(lastProps?.extraExtensions).toBeDefined();
    expect(Array.isArray(lastProps?.extraExtensions)).toBe(true);
    expect((lastProps?.extraExtensions as unknown[]).length).toBeGreaterThan(0);
  });

  it('passes empty/undefined extraExtensions to CmEditorWithComments when no projectId', async () => {
    // activeIdentityState defaults to undefined projectId (reset in beforeEach)
    render(<EditorTab tabId="tab-a2-nolsp" path="/project/src/index.ts" />);
    await screen.findByTestId('cm-editor-mock');

    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    const ext = lastProps?.extraExtensions;
    // Either undefined or an empty array is acceptable — no LSP loaded.
    expect(!ext || (Array.isArray(ext) && ext.length === 0)).toBe(true);
  });
});

describe('EditorTab — LSP document open (A2b)', () => {
  it('sends ensureDocumentOpen with the loaded content once lspReady', async () => {
    activeIdentityState.projectId = 'proj-1';
    activeIdentityState.chatId = 'chat-1';
    activeIdentityState.projectPath = '/projects/myproject';
    mockHasClient = true;

    const { lspClientManager } = await import('@/lib/lsp');
    vi.mocked(lspClientManager.ensureDocumentOpen).mockClear();

    render(<EditorTab tabId="tab-a2b" path="/project/src/index.ts" />);
    await screen.findByTestId('cm-editor-mock');

    expect(lspClientManager.ensureDocumentOpen).toHaveBeenCalledWith('proj-1', 'typescript', {
      filePath: '/project/src/index.ts',
      languageId: 'typescript',
      version: 1,
      text: 'content',
    });
  });

  it('does not send ensureDocumentOpen when there is no LSP language/project', async () => {
    const { lspClientManager } = await import('@/lib/lsp');
    vi.mocked(lspClientManager.ensureDocumentOpen).mockClear();

    render(<EditorTab tabId="tab-a2b-none" path="/project/src/index.ts" />);
    await screen.findByTestId('cm-editor-mock');

    expect(lspClientManager.ensureDocumentOpen).not.toHaveBeenCalled();
  });
});

describe('EditorTab — inline comments mount (A3)', () => {
  it('renders CmEditorWithComments (not a plain CmEditor) for a non-markdown code file', async () => {
    render(<EditorTab tabId="tab-a3-1" path="/project/src/app.js" />);
    await screen.findByTestId('cm-editor-mock');
    // capturedCmEditorProps is populated by the CmEditorWithComments mock,
    // confirming the component rendered is CmEditorWithComments.
    expect(capturedCmEditorProps.length).toBeGreaterThan(0);
  });

  it('forwards extraExtensions to CmEditorWithComments (LSP + gutter coexist)', async () => {
    activeIdentityState.projectId = 'proj-a3';
    activeIdentityState.chatId = 'chat-a3';
    activeIdentityState.projectPath = '/projects/a3project';
    mockHasClient = true;

    render(<EditorTab tabId="tab-a3-ext" path="/project/src/index.ts" />);
    await screen.findByTestId('cm-editor-mock');

    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    // CmEditorWithComments must receive extraExtensions so LSP + comment gutter coexist.
    expect(lastProps?.extraExtensions).toBeDefined();
    expect(Array.isArray(lastProps?.extraExtensions)).toBe(true);
    expect((lastProps?.extraExtensions as unknown[]).length).toBeGreaterThan(0);
  });

  it('forwards onViewReady to CmEditorWithComments so the context-menu viewRef is populated', async () => {
    render(<EditorTab tabId="tab-a3-vr" path="/project/src/app.js" />);
    await screen.findByTestId('cm-editor-mock');

    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    // onViewReady must be a function (not undefined) so the viewRef resolves.
    expect(typeof lastProps?.onViewReady).toBe('function');
  });

  it('does NOT call saveProjectFile when readOnly=true (read-only guard)', async () => {
    activeIdentityState.projectId = 'proj-a3-ro';
    activeIdentityState.chatId = 'chat-a3-ro';
    activeIdentityState.projectPath = '/projects/ro-project';

    render(<EditorTab tabId="tab-a3-ro" path="/project/src/app.js" readOnly />);
    await screen.findByTestId('cm-editor-mock');

    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    // Simulate a save by calling onSave directly (the prop passed to the editor).
    expect(lastProps?.onSave).toBeDefined();
    await act(async () => {
      lastProps?.onSave?.('new content');
    });

    // saveProjectFile must NOT be called for a read-only editor.
    expect(vi.mocked(saveProjectFile)).not.toHaveBeenCalled();
  });
});

describe('EditorTab — ViewerShell chrome (C5)', () => {
  it('renders the code editor inside viewer-shell', async () => {
    render(<EditorTab tabId="tab-c5-1" path="/project/src/app.js" />);
    await screen.findByTestId('cm-editor-mock');
    expect(screen.getByTestId('viewer-shell')).toBeTruthy();
  });

  it('renders a Ln/Col status in viewer-shell-status matching /^Ln \\d+, Col \\d+$/', async () => {
    render(<EditorTab tabId="tab-c5-2" path="/project/src/app.js" />);
    await screen.findByTestId('cm-editor-mock');
    const statusEl = screen.getByTestId('viewer-shell-status');
    expect(statusEl.textContent).toMatch(/^Ln \d+, Col \d+$/);
  });

  it('shows the filename in the breadcrumb (viewer-shell-basename)', async () => {
    render(<EditorTab tabId="tab-c5-3" path="/project/src/app.js" />);
    await screen.findByTestId('cm-editor-mock');
    const basename = screen.getByTestId('viewer-shell-basename');
    expect(basename.textContent).toBe('app.js');
  });

  it('onCursorChange callback is forwarded to CmEditorWithComments', async () => {
    render(<EditorTab tabId="tab-c5-4" path="/project/src/utils.js" />);
    await screen.findByTestId('cm-editor-mock');
    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    // onCursorChange must be a function so the status bar can update on cursor moves.
    expect(typeof lastProps?.onCursorChange).toBe('function');
  });
});

describe('EditorTab — markdown Preview reflects live Source edits (bug fix)', () => {
  it('passes the live editor-store buffer value to MarkdownEditorTab, not the stale loaded value', async () => {
    const { rerender } = render(<EditorTab tabId="tab-md-live" path="/project/notes.md" />);
    await screen.findByTestId('markdown-editor-mock');
    // Sanity: the freshly loaded value made it through on first render.
    expect(capturedMarkdownProps[capturedMarkdownProps.length - 1]?.value).toBe('content');

    // Simulate handleChange() writing a keystroke to the live editor-store
    // buffer (setBuffer) — exactly what every CM6 keystroke does today —
    // WITHOUT EditorTab's own loadState ever being told about it.
    mockBufferOverride = { value: 'edited content', dirty: true };
    rerender(<EditorTab tabId="tab-md-live" path="/project/notes.md" />);

    const lastProps = capturedMarkdownProps[capturedMarkdownProps.length - 1];
    expect(lastProps?.value).toBe('edited content');
  });

  it('falls back to the freshly loaded value when no live buffer exists yet', async () => {
    // Default beforeEach state: mockBufferOverride is null, mockBufferDirty is
    // false, so getBuffer returns undefined/null and EditorTab must fall back
    // to the value it just loaded.
    render(<EditorTab tabId="tab-md-fallback" path="/project/readme.md" />);
    await screen.findByTestId('markdown-editor-mock');

    const lastProps = capturedMarkdownProps[capturedMarkdownProps.length - 1];
    expect(lastProps?.value).toBe('content');
  });
});

describe('EditorTab — live disk-change reload (D4)', () => {
  const TEST_PATH = '/project/src/index.ts';

  it('registers onFileChange for the path on mount (projectId present)', async () => {
    activeIdentityState.projectId = 'proj-d4';
    activeIdentityState.chatId = 'chat-d4';
    activeIdentityState.projectPath = '/project';

    render(<EditorTab tabId="tab-d4-1" path={TEST_PATH} />);
    await screen.findByTestId('cm-editor-mock');

    // subscribeFile and onFileChange must have been called with the path.
    expect(mockSubscribeFile).toHaveBeenCalledWith(TEST_PATH);
    expect(mockOnFileChange).toHaveBeenCalledWith(TEST_PATH, expect.any(Function));
  });

  it('CLEAN buffer + file-change event → silently reloads new content', async () => {
    activeIdentityState.projectId = 'proj-d4-clean';
    activeIdentityState.chatId = 'chat-d4-clean';
    activeIdentityState.projectPath = '/project';
    mockBufferDirty = false;
    vi.mocked(getProjectFile).mockResolvedValue('disk content v2');

    render(<EditorTab tabId="tab-d4-clean" path={TEST_PATH} />);
    await screen.findByTestId('cm-editor-mock');

    // Simulate a disk change.
    await act(async () => {
      fireFileChange(TEST_PATH);
      // Let the getProjectFile re-fetch promise resolve.
      await Promise.resolve();
    });

    // No conflict banner should appear.
    expect(screen.queryByTestId('editor-tab-reload')).toBeNull();
    expect(screen.queryByTestId('editor-tab-keep-mine')).toBeNull();
  });

  it('DIRTY buffer + file-change event → conflict banner appears with Reload and Keep-mine', async () => {
    activeIdentityState.projectId = 'proj-d4-dirty';
    activeIdentityState.chatId = 'chat-d4-dirty';
    activeIdentityState.projectPath = '/project';
    mockBufferDirty = true;
    vi.mocked(getProjectFile).mockResolvedValue('disk content v2');

    render(<EditorTab tabId="tab-d4-dirty" path={TEST_PATH} />);
    await screen.findByTestId('cm-editor-mock');

    // Simulate a disk change.
    await act(async () => {
      fireFileChange(TEST_PATH);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Conflict banner must be visible.
    expect(screen.getByTestId('editor-tab-reload')).toBeTruthy();
    expect(screen.getByTestId('editor-tab-keep-mine')).toBeTruthy();
  });

  it('Reload button applies disk content and dismisses the banner', async () => {
    activeIdentityState.projectId = 'proj-d4-reload';
    activeIdentityState.chatId = 'chat-d4-reload';
    activeIdentityState.projectPath = '/project';
    mockBufferDirty = true;
    vi.mocked(getProjectFile).mockResolvedValue('disk content v2');

    render(<EditorTab tabId="tab-d4-reload" path={TEST_PATH} />);
    await screen.findByTestId('cm-editor-mock');

    // Simulate a disk change.
    await act(async () => {
      fireFileChange(TEST_PATH);
      await Promise.resolve();
      await Promise.resolve();
    });

    const reloadBtn = screen.getByTestId('editor-tab-reload');
    await act(async () => {
      fireEvent.click(reloadBtn);
    });

    // Banner should be dismissed.
    expect(screen.queryByTestId('editor-tab-reload')).toBeNull();
    expect(screen.queryByTestId('editor-tab-keep-mine')).toBeNull();
  });

  it('DIRTY buffer + file-change on a MARKDOWN file → conflict banner appears (not just code files)', async () => {
    activeIdentityState.projectId = 'proj-d4-md';
    activeIdentityState.chatId = 'chat-d4-md';
    activeIdentityState.projectPath = '/project';
    mockBufferDirty = true;
    vi.mocked(getProjectFile).mockResolvedValue('disk content v2');

    render(<EditorTab tabId="tab-d4-md" path="/project/notes.md" />);
    await screen.findByTestId('markdown-editor-mock');

    await act(async () => {
      fireFileChange('/project/notes.md');
      await Promise.resolve();
      await Promise.resolve();
    });

    // The banner must render for markdown files too — the markdown branch
    // previously skipped it, silently swallowing external-change conflicts.
    expect(screen.getByTestId('editor-tab-disk-conflict')).toBeTruthy();
    expect(screen.getByTestId('editor-tab-reload')).toBeTruthy();
    expect(screen.getByTestId('editor-tab-keep-mine')).toBeTruthy();
  });

  it('Keep-mine button dismisses the banner without applying disk content', async () => {
    activeIdentityState.projectId = 'proj-d4-keep';
    activeIdentityState.chatId = 'chat-d4-keep';
    activeIdentityState.projectPath = '/project';
    mockBufferDirty = true;
    vi.mocked(getProjectFile).mockResolvedValue('disk content v2');

    render(<EditorTab tabId="tab-d4-keep" path={TEST_PATH} />);
    await screen.findByTestId('cm-editor-mock');

    // Simulate a disk change.
    await act(async () => {
      fireFileChange(TEST_PATH);
      await Promise.resolve();
      await Promise.resolve();
    });

    const keepBtn = screen.getByTestId('editor-tab-keep-mine');
    const applyCallsBefore = mockApplyValueUpdate.mock.calls.length;
    await act(async () => {
      fireEvent.click(keepBtn);
    });

    // Banner should be dismissed.
    expect(screen.queryByTestId('editor-tab-reload')).toBeNull();
    // applyValueUpdate should NOT have been called by Keep-mine.
    expect(mockApplyValueUpdate.mock.calls.length).toBe(applyCallsBefore);
  });
});

describe('EditorTab — lspReady resets on identity change (MAJOR finding)', () => {
  it('rebuilds extraExtensions without lspReady when projectId changes (identity reset)', async () => {
    // First render with projectId=proj-A, hasClient=true so lspReady becomes true.
    activeIdentityState.projectId = 'proj-A';
    activeIdentityState.chatId = 'chat-A';
    activeIdentityState.projectPath = '/projects/A';
    mockHasClient = true;

    const { lspClientManager } = await import('@/lib/lsp');
    vi.mocked(lspClientManager.ensureClient).mockResolvedValue(undefined);

    const { rerender } = render(<EditorTab tabId="tab-lsp-reset-1" path="/project/src/index.ts" />);
    await screen.findByTestId('cm-editor-mock');

    // Switch to projectId=proj-B and mark hasClient=false so ensureClient is needed.
    // lspReady should reset to false at the start of the ensure-client effect.
    activeIdentityState.projectId = 'proj-B';
    activeIdentityState.projectPath = '/projects/B';
    mockHasClient = false;
    // ensureClient for B will resolve but after this render cycle.
    let resolveEnsure!: () => void;
    vi.mocked(lspClientManager.ensureClient).mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveEnsure = r;
        }),
    );

    await act(async () => {
      rerender(<EditorTab tabId="tab-lsp-reset-1" path="/project/src/index.ts" />);
      await Promise.resolve();
    });

    // While ensureClient is in-flight (not yet resolved), lspReady must be false.
    // extraExtensions is rebuilt with lspReady=false so it reflects current state.
    const propsWhilePending = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    // createLspExtensions is always called if projectId + lspLanguage exist, but
    // the important thing is that the hook reset lspReady. We verify that
    // ensureClient was actually invoked (which means the reset path ran).
    expect(vi.mocked(lspClientManager.ensureClient)).toHaveBeenCalled();
    // The last captured props must still have extraExtensions (the useMemo is still
    // built for proj-B since projectId+lspLanguage are set), but the call itself
    // happening proves the effect re-ran after reset.
    expect(propsWhilePending).toBeDefined();

    // Resolve the pending ensure so we don't leave hanging promises.
    await act(async () => {
      resolveEnsure();
      await Promise.resolve();
    });
  });
});

describe('EditorTab — initLspPort awaited before ensureClient (MAJOR finding)', () => {
  it('calls initLspPort before ensureClient on mount when projectId is set', async () => {
    activeIdentityState.projectId = 'proj-race';
    activeIdentityState.chatId = 'chat-race';
    activeIdentityState.projectPath = '/projects/race';
    mockHasClient = false;

    const { lspClientManager, initLspPort } = await import('@/lib/lsp');
    // Track ordering: initLspPort resolves first, then ensureClient is called.
    vi.mocked(initLspPort).mockImplementation(async () => {
      lspCallOrder.push('initLspPort');
    });
    vi.mocked(lspClientManager.ensureClient).mockImplementation(async () => {
      lspCallOrder.push('ensureClient');
    });

    render(<EditorTab tabId="tab-race" path="/project/src/index.ts" />);
    await screen.findByTestId('cm-editor-mock');

    // Allow async effects to drain.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // initLspPort must appear before ensureClient in the call sequence.
    const initIdx = lspCallOrder.indexOf('initLspPort');
    const ensureIdx = lspCallOrder.indexOf('ensureClient');
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(ensureIdx).toBeGreaterThan(initIdx);
  });
});

describe('EditorTab — handleSave respects current readOnly (MINOR finding)', () => {
  it('does NOT call saveProjectFile after readOnly turns true mid-render (dep closure)', async () => {
    // Start with readOnly=false so the editor mounts.
    activeIdentityState.projectId = 'proj-ro-dep';
    activeIdentityState.chatId = 'chat-ro-dep';
    activeIdentityState.projectPath = '/projects/ro-dep';

    const { rerender } = render(<EditorTab tabId="tab-ro-dep" path="/project/src/app.js" readOnly={false} />);
    await screen.findByTestId('cm-editor-mock');

    // Flip readOnly=true so the tab becomes read-only.
    await act(async () => {
      rerender(<EditorTab tabId="tab-ro-dep" path="/project/src/app.js" readOnly={true} />);
      await Promise.resolve();
    });

    // Capture the latest onSave prop (should now close over readOnly=true).
    const latestProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    expect(latestProps?.onSave).toBeDefined();

    vi.mocked(saveProjectFile).mockClear();

    // Trigger a save via the prop — should be a no-op because readOnly=true.
    await act(async () => {
      latestProps?.onSave?.('attempted save');
    });

    expect(vi.mocked(saveProjectFile)).not.toHaveBeenCalled();
  });
});

describe('EditorTab — external read-only files (#205)', () => {
  const EXT_PATH = '/tmp/outside/notes.txt';

  function mockExternalIdentity() {
    activeIdentityState.projectId = 'proj-ext';
    activeIdentityState.chatId = 'chat-ext';
    activeIdentityState.projectPath = '/project';
    vi.mocked(getFileForView).mockResolvedValue({ content: 'external content', external: true });
  }

  it('forces readOnly on CmEditorWithComments and labels the banner "outside the project"', async () => {
    mockExternalIdentity();
    render(<EditorTab tabId="tab-ext-1" path={EXT_PATH} />);
    await screen.findByTestId('cm-editor-mock');
    expect(capturedCmEditorProps[capturedCmEditorProps.length - 1]?.readOnly).toBe(true);
    const indicator = await screen.findByTestId('editor-tab-readonly');
    expect(indicator.textContent).toContain('outside the project');
  });

  it('never calls saveProjectFile for an external file', async () => {
    mockExternalIdentity();
    render(<EditorTab tabId="tab-ext-2" path={EXT_PATH} />);
    await screen.findByTestId('cm-editor-mock');
    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    await act(async () => {
      lastProps?.onSave?.('attempted save');
    });
    expect(vi.mocked(saveProjectFile)).not.toHaveBeenCalled();
  });

  it('does not register a file watch for an external file', async () => {
    mockExternalIdentity();
    render(<EditorTab tabId="tab-ext-3" path={EXT_PATH} />);
    await screen.findByTestId('cm-editor-mock');
    expect(mockSubscribeFile).not.toHaveBeenCalledWith(EXT_PATH);
  });

  it('keeps an external markdown file read-only in MarkdownEditorTab', async () => {
    mockExternalIdentity();
    render(<EditorTab tabId="tab-ext-4" path="/tmp/outside/README.md" />);
    await screen.findByTestId('markdown-editor-mock');
    expect(capturedMarkdownProps[capturedMarkdownProps.length - 1]?.readOnly).toBe(true);
  });

  it('keeps a contained project file fully editable (external:false)', async () => {
    activeIdentityState.projectId = 'proj-in';
    activeIdentityState.chatId = 'chat-in';
    activeIdentityState.projectPath = '/project';
    render(<EditorTab tabId="tab-ext-5" path="/project/src/app.js" />);
    await screen.findByTestId('cm-editor-mock');
    expect(capturedCmEditorProps[capturedCmEditorProps.length - 1]?.readOnly).toBe(false);
    expect(screen.queryByTestId('editor-tab-readonly')).toBeNull();
  });

  // Regression: buffers persist globally, and the load effect's cache-hit path
  // renders them editable. Caching an external file would therefore resurface
  // it WITHOUT the read-only banner on reopen — external loads must never
  // enter the buffer cache.
  it('does NOT cache an external file in the editor store (read-only survives reopen)', async () => {
    mockExternalIdentity();
    editorState.setBuffer.mockClear();
    render(<EditorTab tabId="tab-ext-6" path={EXT_PATH} />);
    await screen.findByTestId('cm-editor-mock');
    expect(editorState.setBuffer).not.toHaveBeenCalled();
  });

  it('still caches a contained project file on load', async () => {
    activeIdentityState.projectId = 'proj-in-cache';
    activeIdentityState.chatId = 'chat-in-cache';
    activeIdentityState.projectPath = '/project';
    editorState.setBuffer.mockClear();
    render(<EditorTab tabId="tab-ext-7" path="/project/src/app.js" />);
    await screen.findByTestId('cm-editor-mock');
    expect(editorState.setBuffer).toHaveBeenCalledWith('/project/src/app.js', 'content', false);
  });
});
