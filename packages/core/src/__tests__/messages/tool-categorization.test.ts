import { describe, it, expect } from 'vitest';
import {
  EXPLORE_TOOLS,
  HIDDEN_TOOLS,
  TASK_PROGRESS_TOOLS,
  isExploreTool,
  isHiddenTool,
  isTaskProgressTool,
} from '../../messages/tool-categorization.js';

describe('tool-categorization', () => {
  describe('EXPLORE_TOOLS set', () => {
    it('contains Read, Glob, Grep', () => {
      expect(EXPLORE_TOOLS.has('Read')).toBe(true);
      expect(EXPLORE_TOOLS.has('Glob')).toBe(true);
      expect(EXPLORE_TOOLS.has('Grep')).toBe(true);
    });

    it('has exactly 3 entries', () => {
      expect(EXPLORE_TOOLS.size).toBe(3);
    });
  });

  describe('HIDDEN_TOOLS set', () => {
    it('contains all expected hidden tools', () => {
      for (const name of [
        'TaskList',
        'TaskGet',
        'TaskOutput',
        'TaskStop',
        'TodoWrite',
        'Skill',
        'EnterPlanMode',
        'AskUserQuestion',
      ]) {
        expect(HIDDEN_TOOLS.has(name)).toBe(true);
      }
    });

    it('has exactly 8 entries', () => {
      expect(HIDDEN_TOOLS.size).toBe(8);
    });
  });

  describe('TASK_PROGRESS_TOOLS set', () => {
    it('contains TaskCreate and TaskUpdate', () => {
      expect(TASK_PROGRESS_TOOLS.has('TaskCreate')).toBe(true);
      expect(TASK_PROGRESS_TOOLS.has('TaskUpdate')).toBe(true);
    });

    it('has exactly 2 entries', () => {
      expect(TASK_PROGRESS_TOOLS.size).toBe(2);
    });
  });

  describe('isExploreTool', () => {
    it('returns true for Read', () => {
      expect(isExploreTool('Read')).toBe(true);
    });

    it('returns true for Glob', () => {
      expect(isExploreTool('Glob')).toBe(true);
    });

    it('returns true for Grep', () => {
      expect(isExploreTool('Grep')).toBe(true);
    });

    it('returns false for Bash', () => {
      expect(isExploreTool('Bash')).toBe(false);
    });

    it('returns false for Edit', () => {
      expect(isExploreTool('Edit')).toBe(false);
    });

    it('returns false for TaskCreate (not an explore tool)', () => {
      expect(isExploreTool('TaskCreate')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isExploreTool('')).toBe(false);
    });

    it('is case-sensitive', () => {
      expect(isExploreTool('read')).toBe(false);
      expect(isExploreTool('GLOB')).toBe(false);
    });
  });

  describe('isHiddenTool', () => {
    it('returns true for TodoWrite', () => {
      expect(isHiddenTool('TodoWrite')).toBe(true);
    });

    it('returns true for Skill', () => {
      expect(isHiddenTool('Skill')).toBe(true);
    });

    it('returns true for TaskList', () => {
      expect(isHiddenTool('TaskList')).toBe(true);
    });

    it('returns true for TaskGet', () => {
      expect(isHiddenTool('TaskGet')).toBe(true);
    });

    it('returns true for TaskOutput', () => {
      expect(isHiddenTool('TaskOutput')).toBe(true);
    });

    it('returns true for TaskStop', () => {
      expect(isHiddenTool('TaskStop')).toBe(true);
    });

    it('returns true for EnterPlanMode', () => {
      expect(isHiddenTool('EnterPlanMode')).toBe(true);
    });

    it('returns true for AskUserQuestion', () => {
      expect(isHiddenTool('AskUserQuestion')).toBe(true);
    });

    it('returns false for Bash', () => {
      expect(isHiddenTool('Bash')).toBe(false);
    });

    it('returns false for Read (explore tool, not hidden)', () => {
      expect(isHiddenTool('Read')).toBe(false);
    });

    it('returns false for TaskCreate (task progress, not hidden)', () => {
      expect(isHiddenTool('TaskCreate')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isHiddenTool('')).toBe(false);
    });
  });

  describe('isTaskProgressTool', () => {
    it('returns true for TaskCreate', () => {
      expect(isTaskProgressTool('TaskCreate')).toBe(true);
    });

    it('returns true for TaskUpdate', () => {
      expect(isTaskProgressTool('TaskUpdate')).toBe(true);
    });

    it('returns false for TaskList (hidden, not task progress)', () => {
      expect(isTaskProgressTool('TaskList')).toBe(false);
    });

    it('returns false for Read', () => {
      expect(isTaskProgressTool('Read')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isTaskProgressTool('')).toBe(false);
    });
  });
});
