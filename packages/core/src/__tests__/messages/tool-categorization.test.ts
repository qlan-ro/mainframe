import { describe, it, expect } from 'vitest';
import {
  type ToolCategories,
  isExploreTool,
  isHiddenTool,
  isTaskProgressTool,
  isSubagentTool,
} from '../../messages/tool-categorization.js';

// These functions are `set.has(name)` lookups against an adapter-declared
// ToolCategories value. The real per-adapter category sets are plain object
// literals returned from ClaudeAdapter/CodexAdapter#getToolCategories() —
// not standalone exports — so pinning "the real constants" here would just
// re-import a whole adapter class to re-assert what
// __tests__/plugins/builtin/claude/adapter.test.ts already pins directly.
// This file stays a test-local fixture and focuses on the lookup behavior.
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

// Smaller categories object with a genuinely different `hidden` set, used to
// prove the functions read from the passed-in categories argument rather
// than a hardcoded/closed-over set.
const ALT_CATEGORIES: ToolCategories = {
  explore: new Set(['Read', 'Glob', 'Grep']),
  hidden: new Set(['TaskList', 'Skill']),
  progress: new Set(['TaskCreate']),
  subagent: new Set(['Task']),
};

describe('isExploreTool', () => {
  it.each([
    ['Read', CLAUDE_CATEGORIES, true],
    ['Glob', CLAUDE_CATEGORIES, true],
    ['Grep', CLAUDE_CATEGORIES, true],
    ['Bash', CLAUDE_CATEGORIES, false],
    ['Edit', CLAUDE_CATEGORIES, false],
    ['TaskCreate', CLAUDE_CATEGORIES, false],
    ['', CLAUDE_CATEGORIES, false],
    ['read', CLAUDE_CATEGORIES, false], // case-sensitive
    ['GLOB', CLAUDE_CATEGORIES, false], // case-sensitive
  ] as const)('isExploreTool(%s) → %s', (name, categories, expected) => {
    expect(isExploreTool(name, categories)).toBe(expected);
  });
});

describe('isHiddenTool', () => {
  it.each([
    ['TodoWrite', CLAUDE_CATEGORIES, true],
    ['Skill', CLAUDE_CATEGORIES, true],
    ['TaskList', CLAUDE_CATEGORIES, true],
    ['TaskGet', CLAUDE_CATEGORIES, true],
    ['TaskOutput', CLAUDE_CATEGORIES, true],
    ['TaskStop', CLAUDE_CATEGORIES, true],
    ['EnterPlanMode', CLAUDE_CATEGORIES, true],
    ['AskUserQuestion', CLAUDE_CATEGORIES, true],
    ['Bash', CLAUDE_CATEGORIES, false],
    ['Read', CLAUDE_CATEGORIES, false], // explore tool, not hidden
    ['TaskCreate', CLAUDE_CATEGORIES, false], // task progress, not hidden
    ['', CLAUDE_CATEGORIES, false],
    // Divergent case: TodoWrite is hidden under CLAUDE_CATEGORIES but not
    // under ALT_CATEGORIES — proves the categories arg is actually consulted.
    ['TodoWrite', ALT_CATEGORIES, false],
  ] as const)('isHiddenTool(%s) → %s', (name, categories, expected) => {
    expect(isHiddenTool(name, categories)).toBe(expected);
  });
});

describe('isTaskProgressTool', () => {
  it.each([
    ['TaskCreate', CLAUDE_CATEGORIES, true],
    ['TaskUpdate', CLAUDE_CATEGORIES, true],
    ['TaskList', CLAUDE_CATEGORIES, false], // hidden, not task progress
    ['Read', CLAUDE_CATEGORIES, false],
    ['', CLAUDE_CATEGORIES, false],
  ] as const)('isTaskProgressTool(%s) → %s', (name, categories, expected) => {
    expect(isTaskProgressTool(name, categories)).toBe(expected);
  });
});

describe('isSubagentTool', () => {
  it.each([
    ['Task', CLAUDE_CATEGORIES, true],
    ['Bash', CLAUDE_CATEGORIES, false],
    ['', CLAUDE_CATEGORIES, false],
  ] as const)('isSubagentTool(%s) → %s', (name, categories, expected) => {
    expect(isSubagentTool(name, categories)).toBe(expected);
  });
});
