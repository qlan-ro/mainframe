import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Skill, AgentConfig } from '@mainframe/types';

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

import { useSkillsStore } from '../../renderer/store/skills.js';
import {
  getSkills,
  getAgents,
  createSkill as apiCreateSkill,
  updateSkill as apiUpdateSkill,
  deleteSkill as apiDeleteSkill,
  createAgent as apiCreateAgent,
  updateAgent as apiUpdateAgent,
  deleteAgent as apiDeleteAgent,
} from '../../renderer/lib/api/index.js';

const mockGetSkills = vi.mocked(getSkills);
const mockGetAgents = vi.mocked(getAgents);
const mockApiCreateSkill = vi.mocked(apiCreateSkill);
const mockApiUpdateSkill = vi.mocked(apiUpdateSkill);
const mockApiDeleteSkill = vi.mocked(apiDeleteSkill);
const mockApiCreateAgent = vi.mocked(apiCreateAgent);
const mockApiUpdateAgent = vi.mocked(apiUpdateAgent);
const mockApiDeleteAgent = vi.mocked(apiDeleteAgent);

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    adapterId: 'claude',
    name: 'test-skill',
    displayName: 'Test Skill',
    description: 'A test skill',
    scope: 'project',
    filePath: '/tmp/skills/test.md',
    content: '# Test skill content',
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    adapterId: 'claude',
    name: 'test-agent',
    description: 'A test agent',
    scope: 'project',
    filePath: '/tmp/agents/test.md',
    content: '# Test agent content',
    ...overrides,
  };
}

function resetStore(): void {
  useSkillsStore.setState({
    skills: [],
    agents: [],
    loading: false,
    pendingInvocation: null,
  });
}

describe('useSkillsStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts with empty skills array', () => {
      expect(useSkillsStore.getState().skills).toEqual([]);
    });

    it('starts with empty agents array', () => {
      expect(useSkillsStore.getState().agents).toEqual([]);
    });

    it('starts with loading false', () => {
      expect(useSkillsStore.getState().loading).toBe(false);
    });

    it('starts with null pendingInvocation', () => {
      expect(useSkillsStore.getState().pendingInvocation).toBeNull();
    });
  });

  describe('setPendingInvocation', () => {
    it('sets the pending invocation text', () => {
      useSkillsStore.getState().setPendingInvocation('/commit');
      expect(useSkillsStore.getState().pendingInvocation).toBe('/commit');
    });

    it('clears with null', () => {
      useSkillsStore.getState().setPendingInvocation('/commit');
      useSkillsStore.getState().setPendingInvocation(null);
      expect(useSkillsStore.getState().pendingInvocation).toBeNull();
    });
  });

  describe('fetchSkills', () => {
    it('fetches skills and updates state', async () => {
      const skills = [makeSkill({ id: 'a' }), makeSkill({ id: 'b' })];
      mockGetSkills.mockResolvedValue(skills);

      await useSkillsStore.getState().fetchSkills('claude', '/tmp/project');

      expect(mockGetSkills).toHaveBeenCalledWith('claude', '/tmp/project');
      expect(useSkillsStore.getState().skills).toEqual(skills);
      expect(useSkillsStore.getState().loading).toBe(false);
    });

    it('sets loading to true during fetch', async () => {
      let resolvePromise: (value: Skill[]) => void;
      const promise = new Promise<Skill[]>((resolve) => {
        resolvePromise = resolve;
      });
      mockGetSkills.mockReturnValue(promise);

      const fetchPromise = useSkillsStore.getState().fetchSkills('claude', '/tmp');
      expect(useSkillsStore.getState().loading).toBe(true);

      resolvePromise!([]);
      await fetchPromise;
      expect(useSkillsStore.getState().loading).toBe(false);
    });

    it('sets loading to false on error', async () => {
      mockGetSkills.mockRejectedValue(new Error('Network error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useSkillsStore.getState().fetchSkills('claude', '/tmp');

      expect(useSkillsStore.getState().loading).toBe(false);
      expect(useSkillsStore.getState().skills).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe('fetchAgents', () => {
    it('fetches agents and updates state', async () => {
      const agents = [makeAgent({ id: 'a' })];
      mockGetAgents.mockResolvedValue(agents);

      await useSkillsStore.getState().fetchAgents('claude', '/tmp');

      expect(mockGetAgents).toHaveBeenCalledWith('claude', '/tmp');
      expect(useSkillsStore.getState().agents).toEqual(agents);
      expect(useSkillsStore.getState().loading).toBe(false);
    });

    it('sets loading to false on error', async () => {
      mockGetAgents.mockRejectedValue(new Error('Network error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useSkillsStore.getState().fetchAgents('claude', '/tmp');

      expect(useSkillsStore.getState().loading).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('createSkill', () => {
    it('creates a skill and refreshes the list', async () => {
      const newSkill = makeSkill({ id: 'new' });
      mockApiCreateSkill.mockResolvedValue(newSkill);
      mockGetSkills.mockResolvedValue([newSkill]);

      const input = {
        name: 'new-skill',
        displayName: 'New Skill',
        description: 'desc',
        content: '# content',
        scope: 'project' as const,
      };
      const result = await useSkillsStore.getState().createSkill('claude', '/tmp', input);

      expect(result).toEqual(newSkill);
      expect(mockApiCreateSkill).toHaveBeenCalledWith('claude', { projectPath: '/tmp', ...input });
      expect(mockGetSkills).toHaveBeenCalledWith('claude', '/tmp');
    });
  });

  describe('updateSkill', () => {
    it('updates a skill and refreshes the list', async () => {
      const updated = makeSkill({ id: 'skill-1', content: 'updated' });
      mockApiUpdateSkill.mockResolvedValue(updated);
      mockGetSkills.mockResolvedValue([updated]);

      const result = await useSkillsStore.getState().updateSkill('claude', 'skill-1', '/tmp', 'updated');

      expect(result).toEqual(updated);
      expect(mockApiUpdateSkill).toHaveBeenCalledWith('claude', 'skill-1', '/tmp', 'updated');
      expect(mockGetSkills).toHaveBeenCalled();
    });
  });

  describe('deleteSkill', () => {
    it('deletes a skill and refreshes the list', async () => {
      mockApiDeleteSkill.mockResolvedValue(undefined);
      mockGetSkills.mockResolvedValue([]);

      await useSkillsStore.getState().deleteSkill('claude', 'skill-1', '/tmp');

      expect(mockApiDeleteSkill).toHaveBeenCalledWith('claude', 'skill-1', '/tmp');
      expect(mockGetSkills).toHaveBeenCalled();
    });
  });

  describe('createAgent', () => {
    it('creates an agent and refreshes the list', async () => {
      const newAgent = makeAgent({ id: 'new' });
      mockApiCreateAgent.mockResolvedValue(newAgent);
      mockGetAgents.mockResolvedValue([newAgent]);

      const input = {
        name: 'new-agent',
        description: 'desc',
        content: '# content',
        scope: 'project' as const,
      };
      const result = await useSkillsStore.getState().createAgent('claude', '/tmp', input);

      expect(result).toEqual(newAgent);
      expect(mockApiCreateAgent).toHaveBeenCalledWith('claude', { projectPath: '/tmp', ...input });
      expect(mockGetAgents).toHaveBeenCalledWith('claude', '/tmp');
    });
  });

  describe('updateAgent', () => {
    it('updates an agent and refreshes the list', async () => {
      const updated = makeAgent({ id: 'agent-1', content: 'updated' });
      mockApiUpdateAgent.mockResolvedValue(updated);
      mockGetAgents.mockResolvedValue([updated]);

      const result = await useSkillsStore.getState().updateAgent('claude', 'agent-1', '/tmp', 'updated');

      expect(result).toEqual(updated);
      expect(mockApiUpdateAgent).toHaveBeenCalledWith('claude', 'agent-1', '/tmp', 'updated');
      expect(mockGetAgents).toHaveBeenCalled();
    });
  });

  describe('deleteAgent', () => {
    it('deletes an agent and refreshes the list', async () => {
      mockApiDeleteAgent.mockResolvedValue(undefined);
      mockGetAgents.mockResolvedValue([]);

      await useSkillsStore.getState().deleteAgent('claude', 'agent-1', '/tmp');

      expect(mockApiDeleteAgent).toHaveBeenCalledWith('claude', 'agent-1', '/tmp');
      expect(mockGetAgents).toHaveBeenCalled();
    });
  });
});
