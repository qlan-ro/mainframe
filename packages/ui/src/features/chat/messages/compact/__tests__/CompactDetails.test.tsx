import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { useUiPrefs } from '@/store/ui-prefs';
import { onSurfaceIntent } from '@/store/surface-intents';
import { CompactFixture, fixtureMessage, fixtureTool } from './fixtures';
import { getToolResultContent } from '@/lib/api/chats';

vi.mock('@/lib/api/chats', () => ({ getToolResultContent: vi.fn().mockResolvedValue('full daemon output') }));
beforeEach(() => {
  useUiPrefs.getState().setTranscriptMode('compact');
  setHostForTesting(new FakeHostBridge({ daemon: { port: 31415 } }));
});
afterEach(() => {
  vi.clearAllMocks();
  resetHostForTesting();
});

it.each([
  ['Bash', { command: 'echo hello' }, 'shell detail', 'chat-bash-output', 'Ran echo hello'],
  ['CustomAnalytics', { input: 'query' }, 'custom detail', 'chat-tool-fallback-result', null],
  ['mcp__server__query', { query: 'a' }, 'mcp failure detail', 'marker-body', 'Failed to run mcp__server__query'],
])('opens %s details immediately through the existing registry', (toolName, args, result, testId, detailLabel) => {
  render(
    <CompactFixture
      rootId={`detail-${toolName}`}
      messages={[fixtureMessage([fixtureTool({ toolName, args, result, isError: toolName.startsWith('mcp__') })])]}
    />,
  );
  const toggle = screen.getAllByRole('button')[0]!;
  fireEvent.click(toggle);
  if (detailLabel) fireEvent.click(screen.getByRole('button', { name: detailLabel }));
  expect(screen.getByTestId(testId)).toHaveTextContent(result);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

it('preserves file and open-diff actions without closing the outer row', () => {
  const intents: unknown[] = [];
  const unsubscribe = onSurfaceIntent((intent) => intents.push(intent));
  render(
    <CompactFixture
      rootId="diff-action"
      messages={[
        fixtureMessage([
          fixtureTool({
            toolName: 'Edit',
            args: { file_path: '/src/a.ts', old_string: 'old', new_string: 'new' },
            result: { content: 'updated', structuredPatch: [], originalFile: 'old', modifiedFile: 'new' },
          }),
        ]),
      ]}
    />,
  );
  const toggle = screen.getAllByRole('button')[0]!;
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Edited /src/a.ts' }));
  fireEvent.click(screen.getByTestId('tool-card-file-path'));
  fireEvent.click(screen.getByTestId('chat-edit-open-diff'));
  expect(intents).toContainEqual({ type: 'open-file', path: '/src/a.ts', line: undefined, character: undefined });
  expect(intents).toContainEqual({ type: 'open-diff', path: '/src/a.ts', original: 'old', modified: 'new' });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  unsubscribe();
});

it('routes nested full-output requests through the inherited root chat ID', async () => {
  const child = fixtureMessage([
    fixtureTool({
      toolName: 'Bash',
      toolCallId: 'nested-shell',
      args: { command: 'echo hello' },
      result: { content: 'preview', truncated: true, fullBytes: 9000 },
    }),
  ]);
  render(
    <CompactFixture
      rootId="full-output"
      messages={[
        fixtureMessage([
          fixtureTool({ toolName: 'Task', toolCallId: 'agent', args: { subagent_type: 'worker' }, messages: [child] }),
        ]),
      ]}
    />,
  );
  fireEvent.click(screen.getAllByRole('button')[0]!);
  const shell = await screen.findByRole('button', { name: 'Ran a command' });
  fireEvent.click(shell);
  fireEvent.click(screen.getByRole('button', { name: 'Ran echo hello' }));
  await waitFor(() => expect(screen.getByTestId('tool-result-expand-toggle')).toBeEnabled());
  fireEvent.click(screen.getByTestId('tool-result-expand-toggle'));
  await screen.findByText('full daemon output');
  expect(getToolResultContent).toHaveBeenCalledWith(expect.any(Number), 'chat-fixture', 'nested-shell');
  expect(shell).toHaveAttribute('aria-expanded', 'true');
});

it('keeps full cards visible between compact tool rows', () => {
  render(
    <CompactFixture
      rootId="full-cards"
      messages={[
        fixtureMessage([
          fixtureTool(),
          fixtureTool({ toolCallId: 'plan', toolName: 'ExitPlanMode', result: 'Plan steps' }),
          fixtureTool({
            toolCallId: 'ask',
            toolName: 'AskUserQuestion',
            args: { questions: [{ question: 'Pick one', options: [{ label: 'A' }] }] },
            result: 'A',
          }),
          fixtureTool({ toolCallId: 'workflow', toolName: 'Workflow', result: 'Started' }),
          fixtureTool({ toolCallId: 'read-last' }),
        ]),
      ]}
    />,
  );
  expect(screen.getByTestId('chat-plan-card')).toBeInTheDocument();
  expect(screen.getByTestId('chat-ask-card')).toBeInTheDocument();
  expect(screen.getByTestId('chat-workflow-launcher-workflow')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Read files' })).toHaveLength(2);
});

it('opens native image thumbnails without closing the expanded compact row', () => {
  const result = { content: 'Image result', images: [{ mediaType: 'image/png', data: 'aGVsbG8=' }] };
  render(
    <CompactFixture
      rootId="image-action"
      messages={[fixtureMessage([fixtureTool({ toolName: 'CustomImage', result })])]}
    />,
  );
  const toggle = screen.getAllByRole('button')[0]!;
  fireEvent.click(toggle);
  const thumb = screen.getByTestId('tool-result-image-read-a-0');
  fireEvent.load(thumb.querySelector('img')!);
  fireEvent.click(screen.getByRole('button', { name: 'Open image' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
});
