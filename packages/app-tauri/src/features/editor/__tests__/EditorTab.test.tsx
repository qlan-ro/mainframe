/**
 * EditorTab tests — B4: read-only prop threading + indicator.
 *
 * Strategy:
 *  - Mock all external deps (tauri bridge, api files, hooks, CmEditor, ViewerRouter)
 *    so the test is isolation-pure and does not touch the DOM or the CM6 runtime.
 *  - Assert that `readOnly={true}` propagates to CmEditor's props.
 *  - Assert the `data-testid="editor-tab-readonly"` indicator renders when readOnly.
 *  - Assert the indicator is absent when readOnly is false (default).
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
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: undefined, chatId: undefined }),
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

// ── Tests ─────────────────────────────────────────────────────────────────────

import { EditorTab } from '../EditorTab';

beforeEach(() => {
  capturedCmEditorProps.length = 0;
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
