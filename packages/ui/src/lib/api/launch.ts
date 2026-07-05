/**
 * Launch REST client for the daemon API.
 *
 * Wraps the live launch endpoints (no daemon contract change):
 *   GET  /api/projects/:id/launch/status   → LaunchStatusData
 *   GET  /api/projects/:id/launch/configs  → LaunchConfiguration[]
 *   POST /api/projects/:id/launch/:name/start
 *   POST /api/projects/:id/launch/:name/stop
 *
 * Uses WS4 `request`/`requestEmpty` helpers (ApiResponse<T> envelope aware).
 * Port is passed dynamically — never hard-coded.
 */
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import { apiBase, request, requestEmpty } from './http';

export interface LaunchOutputEntry {
  stream: 'stdout' | 'stderr';
  data: string;
}

export interface LaunchStatusData {
  statuses: Record<string, string>;
  tunnelUrls: Record<string, string>;
  effectivePath: string;
  /**
   * Recent stdout/stderr per config name, kept by the daemon independent of
   * live WS delivery (see LaunchManager.getOutputBuffer). Optional so older
   * daemon builds without this field still parse — treat a missing entry the
   * same as an empty buffer.
   */
  outputBuffer?: Record<string, LaunchOutputEntry[]>;
}

function chatParam(chatId?: string): string {
  return chatId ? `?chatId=${encodeURIComponent(chatId)}` : '';
}

function projLaunch(port: number, projectId: string): string {
  return `${apiBase(port)}/api/projects/${projectId}/launch`;
}

export function fetchLaunchStatuses(port: number, projectId: string, chatId?: string): Promise<LaunchStatusData> {
  return request<LaunchStatusData>('GET', `${projLaunch(port, projectId)}/status${chatParam(chatId)}`);
}

export function fetchLaunchConfigs(port: number, projectId: string, chatId?: string): Promise<LaunchConfiguration[]> {
  return request<LaunchConfiguration[]>('GET', `${projLaunch(port, projectId)}/configs${chatParam(chatId)}`);
}

export function startLaunchConfig(port: number, projectId: string, name: string, chatId?: string): Promise<void> {
  return requestEmpty('POST', `${projLaunch(port, projectId)}/${encodeURIComponent(name)}/start${chatParam(chatId)}`);
}

export function stopLaunchConfig(port: number, projectId: string, name: string, chatId?: string): Promise<void> {
  return requestEmpty('POST', `${projLaunch(port, projectId)}/${encodeURIComponent(name)}/stop${chatParam(chatId)}`);
}
