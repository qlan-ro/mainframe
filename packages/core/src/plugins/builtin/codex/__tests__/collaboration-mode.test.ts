import { describe, it, expect } from 'vitest';
import { CodexSession } from '../session.js';

describe('CodexSession.buildCollaborationMode', () => {
  it('returns plan when planMode=true', () => {
    const s = new CodexSession({ projectPath: '/x' });
    (s as any).pendingPlanMode = true;
    const mode = (s as any).buildCollaborationMode();
    expect(mode.mode).toBe('plan');
  });
  it('returns default when planMode=false', () => {
    const s = new CodexSession({ projectPath: '/x' });
    (s as any).pendingPlanMode = false;
    const mode = (s as any).buildCollaborationMode();
    expect(mode.mode).toBe('default');
  });
});
