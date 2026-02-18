export interface Skill {
  id: string;
  adapterId: string;
  name: string;
  displayName: string;
  description: string;
  scope: 'project' | 'global' | 'plugin';
  pluginName?: string;
  filePath: string;
  content: string;
  invocationName?: string;
}

export interface AgentConfig {
  id: string;
  adapterId: string;
  name: string;
  description: string;
  scope: 'project' | 'global';
  filePath: string;
  content: string;
}

export interface CreateSkillInput {
  name: string;
  displayName: string;
  description: string;
  content: string;
  scope: 'project' | 'global';
}

export interface CreateAgentInput {
  name: string;
  description: string;
  content: string;
  scope: 'project' | 'global';
}
