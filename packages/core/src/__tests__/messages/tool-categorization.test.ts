import { describe, it, expect } from 'vitest';
import {
  type ToolCategories,
  isExploreTool,
  isHiddenTool,
  isTaskProgressTool,
  isSubagentTool,
} from '../../messages/tool-categorization.js';

const CLAUDE_CATEGORIES: ToolCategories = {
  explore: new Set(['Read', 'Glob', 'Grep']),
  hidden: new Set([
    'TaskList',
    'TaskGet',
    'TaskOutput',
    'TaskStop',
    'TodoWrite',
    'Skill',
    'EnterPlanMode',
    'AskUserQuestion',
  ]),
  progress: new Set(['TaskCreate', 'TaskUpdate']),
  subagent: new Set(['Task']),
};

describe('isExploreTool', () => {
  it('returns true for Read', () => {
    expect(isExploreTool('Read', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns true for Glob', () => {
    expect(isExploreTool('Glob', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns true for Grep', () => {
    expect(isExploreTool('Grep', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns false for Bash', () => {
    expect(isExploreTool('Bash', CLAUDE_CATEGORIES)).toBe(false);
  });

  it('returns false for Edit', () => {
    expect(isExploreTool('Edit', CLAUDE_CATEGORIES)).toBe(false);
  });

  it('returns false for TaskCreate (not an explore tool)', () => {
    expect(isExploreTool('TaskCreate', CLAUDE_CATEGORIES)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isExploreTool('', CLAUDE_CATEGORIES)).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(isExploreTool('read', CLAUDE_CATEGORIES)).toBe(false);
    expect(isExploreTool('GLOB', CLAUDE_CATEGORIES)).toBe(false);
  });
});

describe('isHiddenTool', () => {
  it('returns true for TodoWrite', () => {
    expect(isHiddenTool('TodoWrite', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns true for Skill', () => {
    expect(isHiddenTool('Skill', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns true for TaskList', () => {
    expect(isHiddenTool('TaskList', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns true for TaskGet', () => {
    expect(isHiddenTool('TaskGet', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns true for TaskOutput', () => {
    expect(isHiddenTool('TaskOutput', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns true for TaskStop', () => {
    expect(isHiddenTool('TaskStop', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns true for EnterPlanMode', () => {
    expect(isHiddenTool('EnterPlanMode', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns true for AskUserQuestion', () => {
    expect(isHiddenTool('AskUserQuestion', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns false for Bash', () => {
    expect(isHiddenTool('Bash', CLAUDE_CATEGORIES)).toBe(false);
  });

  it('returns false for Read (explore tool, not hidden)', () => {
    expect(isHiddenTool('Read', CLAUDE_CATEGORIES)).toBe(false);
  });

  it('returns false for TaskCreate (task progress, not hidden)', () => {
    expect(isHiddenTool('TaskCreate', CLAUDE_CATEGORIES)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isHiddenTool('', CLAUDE_CATEGORIES)).toBe(false);
  });
});

describe('isTaskProgressTool', () => {
  it('returns true for TaskCreate', () => {
    expect(isTaskProgressTool('TaskCreate', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns true for TaskUpdate', () => {
    expect(isTaskProgressTool('TaskUpdate', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns false for TaskList (hidden, not task progress)', () => {
    expect(isTaskProgressTool('TaskList', CLAUDE_CATEGORIES)).toBe(false);
  });

  it('returns false for Read', () => {
    expect(isTaskProgressTool('Read', CLAUDE_CATEGORIES)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isTaskProgressTool('', CLAUDE_CATEGORIES)).toBe(false);
  });
});

describe('isSubagentTool', () => {
  it('returns true for Task', () => {
    expect(isSubagentTool('Task', CLAUDE_CATEGORIES)).toBe(true);
  });

  it('returns false for Bash', () => {
    expect(isSubagentTool('Bash', CLAUDE_CATEGORIES)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSubagentTool('', CLAUDE_CATEGORIES)).toBe(false);
  });
});

describe('parameterized categorization', () => {
  const categories: ToolCategories = {
    explore: new Set(['Read', 'Glob', 'Grep']),
    hidden: new Set(['TaskList', 'Skill']),
    progress: new Set(['TaskCreate']),
    subagent: new Set(['Task']),
  };

  it('isExploreTool checks against provided categories', () => {
    expect(isExploreTool('Read', categories)).toBe(true);
    expect(isExploreTool('Bash', categories)).toBe(false);
  });

  it('isHiddenTool checks against provided categories', () => {
    expect(isHiddenTool('TaskList', categories)).toBe(true);
    expect(isHiddenTool('Read', categories)).toBe(false);
  });

  it('isTaskProgressTool checks against provided categories', () => {
    expect(isTaskProgressTool('TaskCreate', categories)).toBe(true);
    expect(isTaskProgressTool('Bash', categories)).toBe(false);
  });

  it('isSubagentTool checks against provided categories', () => {
    expect(isSubagentTool('Task', categories)).toBe(true);
    expect(isSubagentTool('Bash', categories)).toBe(false);
  });
});
