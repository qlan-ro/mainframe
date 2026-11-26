import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import type { Call, Turn } from './transcript-fixture';

export const parityReviewWorkflow: ClaudeWorkflowRun = {
  taskId: 'parity-workflow-task',
  runId: 'parity-review',
  workflowName: 'review-changes',
  status: 'completed',
  source: 'record',
  totalTokens: 1850,
  durationMs: 72_000,
  phases: [{ index: 0, title: 'Review' }],
  agents: ['Correctness', 'Coverage', 'Accessibility'].map((label, index) => ({
    agentId: `parity-review-${index}`,
    index,
    phaseIndex: 0,
    label,
    state: 'done',
    tokens: 500 + index * 100,
    toolCalls: 3,
    durationMs: 60_000 + index * 6000,
  })),
};

export function extraTools(turn: Turn, call: Call) {
  const image = {
    type: 'image',
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Xf8AAAAASUVORK5CYII=',
  };
  const read = call('parity-image', 'Read', { file_path: 'docs/screenshot-capsule.png' }, '', 12.9);
  const screenshot = call('parity-browser-image', 'mcp__playwright__browser_take_screenshot', {}, '', 12.85, {
    toolCallTiming: { startedAt: Date.now() - 2_000, completedAt: Date.now() - 1_100 },
  });
  turn('Show the image, workflow and artifact.', 'Here are the results.', 13, [
    { ...read, content: [{ type: 'content', content: image }] },
    { ...screenshot, content: [{ type: 'content', content: image }] },
    {
      sessionUpdate: 'agent_message',
      messageId: 'parity-generated-image',
      toolCallId: 'parity-generated-image',
      content: [
        { type: 'text', text: 'Prompt: a flat usage-capsule icon in three sizes on a transparent background' },
        image,
      ],
    },
    call(
      'parity-workflow',
      'Workflow',
      { workflow: 'review-changes' },
      JSON.stringify({
        runId: 'parity-review',
        taskId: 'parity-workflow-task',
        workflowName: 'review-changes',
      }),
      12.8,
    ),
    call(
      'parity-artifact',
      'Artifact',
      { action: 'publish', title: 'Quota report' },
      'Published quota report at https://claude.ai/artifact/parity-quota-report',
      12.7,
    ),
  ]);
}

export function workspaceAgent(turn: Turn, call: Call) {
  turn(
    'Now tool calls, images and agents.',
    '**Tool calls, images and agents.** MCP and tools with no card share one row. Only the last failure can open by itself, if no later step succeeded. Sub-agents list their steps as rows.',
    13,
    [
      call(
        'parity-agent',
        'Task',
        {
          description: 'Review the quota reset diff',
          prompt: 'Review the uncommitted quota changes for correctness and test coverage.',
          subagent_type: 'code-reviewer',
        },
        undefined,
        12.9,
        { subagent: true, toolCallTiming: { startedAt: Date.now() - 240_000 } },
      ),
      call(
        'parity-agent-search',
        'Grep',
        { pattern: 'useQuota', path: 'mobile/src' },
        Array.from({ length: 6 }, (_, i) => `mobile/src/quota/capsule.tsx:${i + 1}:useQuota`).join('\n'),
        12.8,
        { parentToolCallId: 'parity-agent' },
      ),
      call(
        'parity-agent-read',
        'Read',
        { file_path: 'mobile/src/quota/capsule.tsx' },
        Array.from({ length: 48 }, (_, i) => `${i + 1}\t// quota capsule`).join('\n'),
        12.7,
        { parentToolCallId: 'parity-agent' },
      ),
      call('parity-agent-step', 'Bash', { command: 'pnpm test capsule' }, undefined, 12.6, {
        parentToolCallId: 'parity-agent',
        toolCallTiming: { startedAt: Date.now() - 12_000 },
      }),
    ],
  );
}
