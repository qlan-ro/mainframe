import { expect, it } from 'vitest';
import { hasActivityDetail } from '../activity-details';
import { tool } from './fixtures';

it.each(['read', 'search', 'listFiles'])(
  'omits unfinished structured %s commands but keeps terminal failure details accessible',
  (type) => {
    const command = tool({
      toolName: 'Bash',
      args: { command: 'custom-exploration' },
      providerMetadata: {
        codex: {
          commandActions: [{ type, command: 'custom-exploration', path: '/src', name: 'src', query: 'needle' }],
        },
      },
      status: { type: 'running' },
    });
    expect(hasActivityDetail(command, new Set())).toBe(false);
    expect(hasActivityDetail({ ...command, status: { type: 'complete' } }, new Set())).toBe(false);
    expect(hasActivityDetail({ ...command, isError: true, result: 'failed' }, new Set())).toBe(true);
    expect(hasActivityDetail({ ...command, approval: { id: 'approval', approved: false } }, new Set())).toBe(true);
  },
);
