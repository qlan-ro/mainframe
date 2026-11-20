import type { CreateExternalMcpClient, CreatedExternalMcpClient, ExternalMcpClients } from '@qlan-ro/mainframe-types';
import { apiBase, request, requestEmpty } from './http';

export function getExternalMcpClients(port: number): Promise<ExternalMcpClients> {
  return request('GET', `${apiBase(port)}/api/external-mcp/clients`);
}

export function createExternalMcpClient(
  port: number,
  input: CreateExternalMcpClient,
): Promise<CreatedExternalMcpClient> {
  return request('POST', `${apiBase(port)}/api/external-mcp/clients`, input);
}

export function revokeExternalMcpClient(port: number, id: string): Promise<void> {
  return requestEmpty('DELETE', `${apiBase(port)}/api/external-mcp/clients/${encodeURIComponent(id)}`);
}
