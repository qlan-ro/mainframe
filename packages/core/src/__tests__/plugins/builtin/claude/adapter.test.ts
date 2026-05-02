import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../../../plugins/builtin/claude/adapter.js';

describe('ClaudeAdapter.getToolCategories', () => {
  it('hides all internal/dormant tools per the rendering audit', () => {
    const adapter = new ClaudeAdapter();
    const cats = adapter.getToolCategories();
    const hidden = cats.hidden;

    // V1 task tools
    expect(hidden.has('TodoWrite')).toBe(true);
    // V2 task tools (added — _TaskProgress fires on these)
    expect(hidden.has('TaskCreate')).toBe(true);
    expect(hidden.has('TaskUpdate')).toBe(true);
    expect(hidden.has('TaskList')).toBe(true);
    expect(hidden.has('TaskGet')).toBe(true);
    expect(hidden.has('TaskOutput')).toBe(true);
    expect(hidden.has('TaskStop')).toBe(true);
    // Mode/internal
    expect(hidden.has('EnterPlanMode')).toBe(true);
    expect(hidden.has('AskUserQuestion')).toBe(true); // pending state goes to BottomCard
    expect(hidden.has('ToolSearch')).toBe(true);

    // Skill is NOT hidden — model-driven Skill tool_use renders via SlashCommandCard
    // (skill activation flows through SkillLoadedCard system message instead)
    expect(hidden.has('Skill')).toBe(false);
  });
});
