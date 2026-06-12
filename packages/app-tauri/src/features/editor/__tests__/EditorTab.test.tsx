/**
 * EditorTab tests — B4: read-only prop threading + indicator.
 *                    A1: EditorContextMenu mount.
 *
 * Strategy:
 *  - Mock all external deps (tauri bridge, api files, hooks, CmEditor, ViewerRouter)
 *    so the test is isolation-pure and does not touch the DOM or the CM6 runtime.
 *  - Assert that `readOnly={true}` propagates to CmEditor's props.
 *  - Assert the `data-testid="editor-tab-readonly"` indicator renders when readOnly.
 *  - Assert the indicator is absent when readOnly is false (default).
 *  - Assert `data-testid="editor-context-menu"` is present for a code file.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';

// ── Mock external deps ────────────────────────────────────────────────────────

vi.mock('@/lib/tauri/bridge', () => ({ readFile: vi.fn().mockResolvedValue('content') }));
vi.mock('@/lib/api/files', () => ({
  getProjectFile: vi.fn().mockResolvedValue('content'),
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
  inferLanguage: () => 'javascript',
}));
const editorState = {
  setBuffer: vi.fn(),
  getBuffer: () => null,
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

// Capture the props passed to CmEditor so we can assert on them.
const capturedCmEditorProps: ComponentProps<typeof import('../CmEditor').CmEditor>[] = [];

vi.mock('../CmEditor', () => ({
  CmEditor: (props: ComponentProps<typeof import('../CmEditor').CmEditor>) => {
    capturedCmEditorProps.push(props);
    return <div data-testid="cm-editor-mock" />;
  },
}));

vi.mock('../MarkdownEditorTab', () => ({
  MarkdownEditorTab: () => <div data-testid="markdown-editor-mock" />,
}));

// ── LSP mocks (A2) ────────────────────────────────────────────────────────────

// Mutable flag so tests can toggle lspClientManager.hasClient.
let mockHasClient = false;

vi.mock('@/lib/lsp', () => ({
  lspClientManager: {
    hasClient: (projectId: string, language: string) => mockHasClient && Boolean(projectId) && Boolean(language),
    ensureClient: vi.fn().mockResolvedValue(undefined),
    preloadDocument: vi.fn(),
    getHover: vi.fn(),
    getDefinition: vi.fn(),
    getReferences: vi.fn(),
  },
  getLspLanguage: (filePath: string) => (filePath.endsWith('.ts') ? 'typescript' : null),
  hasLspSupport: (_lang: string) => true,
  initAutoConnect: vi.fn().mockReturnValue(() => undefined),
}));

// Inline sentinel — vi.mock factory is hoisted, so FAKE_LSP_EXTENSION is defined
// here as a module-level const AFTER the hoisted vi.mock calls. Use a local
// object reference inside the factory itself instead.
vi.mock('../lsp/cm-lsp-extensions', () => ({
  // Returns a non-empty array so tests can assert extensions.length > 0.
  createLspExtensions: vi.fn(() => [{ _fakeLspMarker: true }]),
}));

// EditorContextMenu: render a real-looking trigger div so data-testid is present,
// plus pass children through so CmEditor still renders and can be queried.
vi.mock('../context-menu/EditorContextMenu', () => ({
  EditorContextMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="editor-context-menu">{children}</div>
  ),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

import { EditorTab } from '../EditorTab';

beforeEach(() => {
  capturedCmEditorProps.length = 0;
  // Reset identity to no-project default so existing tests are unaffected.
  activeIdentityState.projectId = undefined;
  activeIdentityState.chatId = undefined;
  activeIdentityState.projectPath = undefined;
  mockHasClient = false;
});

describe('EditorTab — read-only state (B4)', () => {
  it('passes readOnly={true} to CmEditor when the prop is set', async () => {
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

  it('passes readOnly={false} to CmEditor by default', async () => {
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
  it('passes a non-empty extraExtensions to CmEditor when projectId is set and lspReady=true', async () => {
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

  it('passes empty/undefined extraExtensions to CmEditor when no projectId', async () => {
    // activeIdentityState defaults to undefined projectId (reset in beforeEach)
    render(<EditorTab tabId="tab-a2-nolsp" path="/project/src/index.ts" />);
    await screen.findByTestId('cm-editor-mock');

    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    const ext = lastProps?.extraExtensions;
    // Either undefined or an empty array is acceptable — no LSP loaded.
    expect(!ext || (Array.isArray(ext) && ext.length === 0)).toBe(true);
  });
});
