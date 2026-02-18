import { create } from 'zustand';
import type { Skill, AgentConfig, CreateSkillInput, CreateAgentInput } from '@mainframe/types';
import {
  getSkills,
  getAgents,
  createSkill as apiCreateSkill,
  updateSkill as apiUpdateSkill,
  deleteSkill as apiDeleteSkill,
  createAgent as apiCreateAgent,
  updateAgent as apiUpdateAgent,
  deleteAgent as apiDeleteAgent,
} from '../lib/api';

interface SkillsState {
  skills: Skill[];
  agents: AgentConfig[];
  loading: boolean;
  pendingInvocation: string | null;

  setPendingInvocation(text: string | null): void;
  fetchSkills(adapterId: string, projectPath: string): Promise<void>;
  fetchAgents(adapterId: string, projectPath: string): Promise<void>;

  createSkill(adapterId: string, projectPath: string, input: CreateSkillInput): Promise<Skill>;
  updateSkill(adapterId: string, skillId: string, projectPath: string, content: string): Promise<Skill>;
  deleteSkill(adapterId: string, skillId: string, projectPath: string): Promise<void>;

  createAgent(adapterId: string, projectPath: string, input: CreateAgentInput): Promise<AgentConfig>;
  updateAgent(adapterId: string, agentId: string, projectPath: string, content: string): Promise<AgentConfig>;
  deleteAgent(adapterId: string, agentId: string, projectPath: string): Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  agents: [],
  loading: false,
  pendingInvocation: null,

  setPendingInvocation: (text) => set({ pendingInvocation: text }),

  fetchSkills: async (adapterId, projectPath) => {
    set({ loading: true });
    try {
      const skills = await getSkills(adapterId, projectPath);
      set({ skills });
    } catch (err) {
      console.error('[skills] fetch failed:', err);
    } finally {
      set({ loading: false });
    }
  },

  fetchAgents: async (adapterId, projectPath) => {
    set({ loading: true });
    try {
      const agents = await getAgents(adapterId, projectPath);
      set({ agents });
    } catch (err) {
      console.error('[agents] fetch failed:', err);
    } finally {
      set({ loading: false });
    }
  },

  createSkill: async (adapterId, projectPath, input) => {
    const skill = await apiCreateSkill(adapterId, { projectPath, ...input });
    await get().fetchSkills(adapterId, projectPath);
    return skill;
  },

  updateSkill: async (adapterId, skillId, projectPath, content) => {
    const skill = await apiUpdateSkill(adapterId, skillId, projectPath, content);
    await get().fetchSkills(adapterId, projectPath);
    return skill;
  },

  deleteSkill: async (adapterId, skillId, projectPath) => {
    await apiDeleteSkill(adapterId, skillId, projectPath);
    await get().fetchSkills(adapterId, projectPath);
  },

  createAgent: async (adapterId, projectPath, input) => {
    const agent = await apiCreateAgent(adapterId, { projectPath, ...input });
    await get().fetchAgents(adapterId, projectPath);
    return agent;
  },

  updateAgent: async (adapterId, agentId, projectPath, content) => {
    const agent = await apiUpdateAgent(adapterId, agentId, projectPath, content);
    await get().fetchAgents(adapterId, projectPath);
    return agent;
  },

  deleteAgent: async (adapterId, agentId, projectPath) => {
    await apiDeleteAgent(adapterId, agentId, projectPath);
    await get().fetchAgents(adapterId, projectPath);
  },
}));
