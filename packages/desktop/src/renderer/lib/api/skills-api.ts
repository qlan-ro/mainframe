import type { Skill, AgentConfig, CreateSkillInput, CreateAgentInput } from '@mainframe/types';
import { fetchJson, postJson, putJson, deleteRequest, API_BASE } from './http';

export async function getSkills(adapterId: string, projectPath: string): Promise<Skill[]> {
  const json = await fetchJson<{ success: boolean; data: Skill[] }>(
    `${API_BASE}/api/adapters/${adapterId}/skills?projectPath=${encodeURIComponent(projectPath)}`,
  );
  return json.data;
}

export async function getAgents(adapterId: string, projectPath: string): Promise<AgentConfig[]> {
  const json = await fetchJson<{ success: boolean; data: AgentConfig[] }>(
    `${API_BASE}/api/adapters/${adapterId}/agents?projectPath=${encodeURIComponent(projectPath)}`,
  );
  return json.data;
}

export async function createSkill(adapterId: string, data: { projectPath: string } & CreateSkillInput): Promise<Skill> {
  const json = await postJson<{ data: Skill }>(`${API_BASE}/api/adapters/${adapterId}/skills`, data);
  return json.data;
}

export async function updateSkill(
  adapterId: string,
  skillId: string,
  projectPath: string,
  content: string,
): Promise<Skill> {
  const json = await putJson<{ data: Skill }>(
    `${API_BASE}/api/adapters/${adapterId}/skills/${encodeURIComponent(skillId)}`,
    { projectPath, content },
  );
  return json.data;
}

export async function deleteSkill(adapterId: string, skillId: string, projectPath: string): Promise<void> {
  await deleteRequest(
    `${API_BASE}/api/adapters/${adapterId}/skills/${encodeURIComponent(skillId)}?projectPath=${encodeURIComponent(projectPath)}`,
  );
}

export async function createAgent(
  adapterId: string,
  data: { projectPath: string } & CreateAgentInput,
): Promise<AgentConfig> {
  const json = await postJson<{ data: AgentConfig }>(`${API_BASE}/api/adapters/${adapterId}/agents`, data);
  return json.data;
}

export async function updateAgent(
  adapterId: string,
  agentId: string,
  projectPath: string,
  content: string,
): Promise<AgentConfig> {
  const json = await putJson<{ data: AgentConfig }>(
    `${API_BASE}/api/adapters/${adapterId}/agents/${encodeURIComponent(agentId)}`,
    { projectPath, content },
  );
  return json.data;
}

export async function deleteAgent(adapterId: string, agentId: string, projectPath: string): Promise<void> {
  await deleteRequest(
    `${API_BASE}/api/adapters/${adapterId}/agents/${encodeURIComponent(agentId)}?projectPath=${encodeURIComponent(projectPath)}`,
  );
}
