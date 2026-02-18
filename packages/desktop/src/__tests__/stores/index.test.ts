import { describe, it, expect } from 'vitest';

// Mock the API module before importing the barrel
import { vi } from 'vitest';
vi.mock('../../renderer/lib/api/index.js', () => ({
  getSkills: vi.fn(),
  getAgents: vi.fn(),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
}));

import {
  useProjectsStore,
  useChatsStore,
  useUIStore,
  useSearchStore,
  useSkillsStore,
  useSettingsStore,
} from '../../renderer/store/index.js';

describe('store barrel export (index.ts)', () => {
  it('exports useProjectsStore', () => {
    expect(useProjectsStore).toBeDefined();
    expect(typeof useProjectsStore.getState).toBe('function');
  });

  it('exports useChatsStore', () => {
    expect(useChatsStore).toBeDefined();
    expect(typeof useChatsStore.getState).toBe('function');
  });

  it('exports useUIStore', () => {
    expect(useUIStore).toBeDefined();
    expect(typeof useUIStore.getState).toBe('function');
  });

  it('exports useSearchStore', () => {
    expect(useSearchStore).toBeDefined();
    expect(typeof useSearchStore.getState).toBe('function');
  });

  it('exports useSkillsStore', () => {
    expect(useSkillsStore).toBeDefined();
    expect(typeof useSkillsStore.getState).toBe('function');
  });

  it('exports useSettingsStore', () => {
    expect(useSettingsStore).toBeDefined();
    expect(typeof useSettingsStore.getState).toBe('function');
  });
});
