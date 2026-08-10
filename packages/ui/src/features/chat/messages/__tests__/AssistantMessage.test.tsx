/**
 * AssistantMessage — MessagePathContextMenu mounting (274-A7) and the
 * GroupedParts indicator mode.
 *
 * Heavy assistant-ui/view-model deps are stubbed so only the wrapper
 * placement is under test: normal branch wraps GroupedParts in the menu
 * (skipped inside a nested/subagent transcript); the error branch never
 * wraps, in either context. The indicator mode follows the same nesting
 * split — `never` at the top level, the default `no-text` when nested.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

let mockMeta: { errorText?: string; partGroups?: Record<string, string>; groupSummaries?: Record<string, string> } = {};

vi.mock('@assistant-ui/react', () => ({
  MessagePrimitive: {
    Root: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
    GroupedParts: ({ children, indicator }: { children: (arg: unknown) => ReactNode; indicator?: string }) => (
      <div data-testid="grouped-parts-stub" data-indicator={indicator}>
        {children({ part: { type: 'text', text: 'hi' }, children: null })}
      </div>
    ),
  },
  useAuiState: () => 'msg-1',
}));

vi.mock('../../view-model/message-meta', () => ({
  useMainframeMeta: () => mockMeta,
}));

vi.mock('../../parts/markdown-text', () => ({ MarkdownText: () => <div data-testid="markdown-text-stub" /> }));
vi.mock('../ReasoningGroup', () => ({ ReasoningGroup: ({ children }: { children?: ReactNode }) => <>{children}</> }));
vi.mock('../../tools/tool-dispatch', () => ({
  MessageToolLeaf: () => null,
  MessageToolGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../parts/ZoomableImage', () => ({ ZoomableImage: () => null }));
vi.mock('../MessageActionBar', () => ({ MessageActionBar: () => null }));
vi.mock('../MessageTiming', () => ({ MessageTiming: () => null }));
vi.mock('../MessageTimestamp', () => ({ MessageTimestamp: () => null }));
vi.mock('../AssistantErrorBlock', () => ({ AssistantErrorBlock: ({ text }: { text: string }) => <div>{text}</div> }));

import { AssistantMessage } from '../AssistantMessage';
import { NestedTranscriptProvider } from '../nested-transcript-context';

describe('AssistantMessage — MessagePathContextMenu mounting', () => {
  it('wraps the normal branch in exactly one chat-message-menu-trigger when top-level', () => {
    mockMeta = { partGroups: {}, groupSummaries: {} };
    render(<AssistantMessage />);
    expect(screen.getAllByTestId('chat-message-menu-trigger')).toHaveLength(1);
    expect(screen.getByTestId('grouped-parts-stub')).toBeInTheDocument();
  });

  it('does not wrap when rendered inside a nested (subagent) transcript, markup otherwise identical', () => {
    mockMeta = { partGroups: {}, groupSummaries: {} };
    render(
      <NestedTranscriptProvider>
        <AssistantMessage />
      </NestedTranscriptProvider>,
    );
    expect(screen.queryByTestId('chat-message-menu-trigger')).toBeNull();
    expect(screen.getByTestId('grouped-parts-stub')).toBeInTheDocument();
  });

  it('the error branch never mounts the wrapper, top-level', () => {
    mockMeta = { errorText: 'boom' };
    render(<AssistantMessage />);
    expect(screen.queryByTestId('chat-message-menu-trigger')).toBeNull();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('the error branch never mounts the wrapper, nested', () => {
    mockMeta = { errorText: 'boom' };
    render(
      <NestedTranscriptProvider>
        <AssistantMessage />
      </NestedTranscriptProvider>,
    );
    expect(screen.queryByTestId('chat-message-menu-trigger')).toBeNull();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});

describe('AssistantMessage — running-indicator mode', () => {
  it('suppresses the per-message indicator at the top level, where ChatThread renders its own', () => {
    mockMeta = { partGroups: {}, groupSummaries: {} };
    render(<AssistantMessage />);
    expect(screen.getByTestId('grouped-parts-stub')).toHaveAttribute('data-indicator', 'never');
  });

  it('keeps the per-message indicator inside a nested transcript, which has no thread-level one', () => {
    mockMeta = { partGroups: {}, groupSummaries: {} };
    render(
      <NestedTranscriptProvider>
        <AssistantMessage />
      </NestedTranscriptProvider>,
    );
    expect(screen.getByTestId('grouped-parts-stub')).toHaveAttribute('data-indicator', 'no-text');
  });
});
