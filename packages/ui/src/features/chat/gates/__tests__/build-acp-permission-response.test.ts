/**
 * build-acp-permission-response — behavior tests for the ACP facade's
 * `session/request_permission` answer builder.
 *
 * Strategy:
 *  - All expected values are hardcoded; no logic is duplicated from the
 *    function under test.
 *
 * Behaviors covered:
 *  - buildAcpRichAnswer: wraps a ControlResponse under
 *    `_meta["_mainframe.dev"].controlResponse` alongside the plain outcome.
 */
import { describe, it, expect } from 'vitest';
import { buildAcpRichAnswer } from '../build-acp-permission-response';

describe('buildAcpRichAnswer', () => {
  it('wraps the given ControlResponse under _meta["_mainframe.dev"].controlResponse', () => {
    const controlResponse = {
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      behavior: 'allow' as const,
      updatedInput: { cmd: 'ls' },
    };
    const res = buildAcpRichAnswer('allow-once', controlResponse);
    expect(res).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
      _meta: { '_mainframe.dev': { controlResponse } },
    });
  });
});
