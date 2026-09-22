/**
 * SmartLink's file-reference branch (#355): a transcript link whose target is
 * a file path renders as `FileRefLink` and opens through the `open-file`
 * surface intent instead of the OS shell.
 *
 * Mock strategy: mirrors `smart-actions/__tests__/url-chip-menu.test.tsx` —
 * module-mock `@/store/surface-intents` and `@/lib/host`, render `SmartLink`
 * directly with no chat providers mounted (the four non-chat surfaces that
 * share this anchor never mount `SmartActionsProvider` either).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const emitSurfaceIntent = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (intent: unknown) => emitSurfaceIntent(intent) }));

const openExternal = vi.fn(() => Promise.resolve());
vi.mock('@/lib/host', () => ({ useHost: () => ({ shell: { openExternal } }) }));

import { SmartLink } from '../../smart-actions/SmartLink';
import { useActiveBasesStore } from '@/store/active-bases-store';

beforeEach(() => {
  emitSurfaceIntent.mockReset();
  openExternal.mockClear();
  useActiveBasesStore.setState({ bases: { projectPath: '/repo' }, scopeKey: null });
});

describe('SmartLink — file targets open via the intent bus', () => {
  it('an absolute in-project href emits open-file and never calls openExternal', () => {
    render(<SmartLink href="/repo/src/a.ts">a.ts</SmartLink>);
    fireEvent.click(screen.getByRole('link', { name: 'a.ts' }));

    expect(emitSurfaceIntent).toHaveBeenCalledWith({
      type: 'open-file',
      path: '/repo/src/a.ts',
      line: undefined,
      character: undefined,
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('a project-relative href does the same', () => {
    render(<SmartLink href="src/a.ts">a.ts</SmartLink>);
    fireEvent.click(screen.getByRole('link', { name: 'a.ts' }));

    expect(emitSurfaceIntent).toHaveBeenCalledWith({
      type: 'open-file',
      path: 'src/a.ts',
      line: undefined,
      character: undefined,
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('a file:// href does the same', () => {
    render(<SmartLink href="file:///repo/src/a.ts">a.ts</SmartLink>);
    fireEvent.click(screen.getByRole('link', { name: 'a.ts' }));

    expect(emitSurfaceIntent).toHaveBeenCalledWith({
      type: 'open-file',
      path: 'file:///repo/src/a.ts',
      line: undefined,
      character: undefined,
    });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('a path:line:col target emits the 0-based reveal position', () => {
    render(<SmartLink href="/repo/src/a.ts:42:7">a.ts:42</SmartLink>);
    fireEvent.click(screen.getByRole('link', { name: 'a.ts:42' }));

    expect(emitSurfaceIntent).toHaveBeenCalledWith({
      type: 'open-file',
      path: '/repo/src/a.ts',
      line: 41,
      character: 6,
    });
  });

  it('renders the authored markdown text, not a helper-derived label', () => {
    render(<SmartLink href="/repo/src/a.ts">click here</SmartLink>);
    expect(screen.getByRole('link', { name: 'click here' })).toBeInTheDocument();
  });
});

describe('SmartLink — file-reference context menu', () => {
  it('offers Open file plus the two copy-path items, and nothing web-link-shaped', () => {
    render(<SmartLink href="/repo/src/a.ts">a.ts</SmartLink>);
    fireEvent.contextMenu(screen.getByRole('link', { name: 'a.ts' }));

    expect(screen.getByTestId('chat-fileref-open-src/a.ts')).toBeInTheDocument();
    expect(screen.getByTestId('chat-fileref-copy-absolute-src/a.ts')).toBeInTheDocument();
    expect(screen.getByTestId('chat-fileref-copy-relative-src/a.ts')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-link-open')).toBeNull();
    expect(screen.queryByTestId('chat-link-copy')).toBeNull();
  });

  it('shows no hover Copy-URL button', () => {
    render(<SmartLink href="/repo/src/a.ts">a.ts</SmartLink>);
    expect(screen.queryByTestId('chat-link-copy-url')).toBeNull();
  });
});

describe('SmartLink — genuine web links are unaffected', () => {
  it('an https href still routes to LinkWithPreview: external open + chat-link-copy', () => {
    render(<SmartLink href="https://example.com">example</SmartLink>);
    const anchor = screen.getByRole('link', { name: 'example' });

    fireEvent.click(anchor);
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
    expect(emitSurfaceIntent).not.toHaveBeenCalled();

    fireEvent.contextMenu(anchor);
    expect(screen.getByTestId('chat-link-copy')).toBeInTheDocument();
    expect(screen.getByTestId('chat-link-open')).toBeInTheDocument();
  });
});
