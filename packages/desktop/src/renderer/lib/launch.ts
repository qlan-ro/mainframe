import { API_BASE } from './api/http';

export async function fetchLaunchStatuses(projectId: string): Promise<Record<string, string>> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/launch/status`);
  if (!res.ok) return {};
  const json = (await res.json()) as { success: boolean; data: Record<string, string> };
  return json.success ? json.data : {};
}

export async function startLaunchConfig(projectId: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/launch/${encodeURIComponent(name)}/start`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to start ${name}: ${res.status}`);
}

export async function stopLaunchConfig(projectId: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/launch/${encodeURIComponent(name)}/stop`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to stop ${name}: ${res.status}`);
}
