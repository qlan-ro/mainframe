import { API_BASE } from './api/http';

interface LaunchStatusResponse {
  success: boolean;
  data: { statuses: Record<string, string>; tunnelUrls: Record<string, string> };
}

export async function fetchLaunchStatuses(
  projectId: string,
): Promise<{ statuses: Record<string, string>; tunnelUrls: Record<string, string> }> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/launch/status`);
  if (!res.ok) return { statuses: {}, tunnelUrls: {} };
  const json = (await res.json()) as LaunchStatusResponse;
  return json.success ? json.data : { statuses: {}, tunnelUrls: {} };
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
