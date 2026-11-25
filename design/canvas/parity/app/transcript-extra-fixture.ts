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
  turn('Show the image, workflow and artifact.', 'Here are the results.', 13, [
    { ...read, content: [{ type: 'content', content: image }] },
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
