/**
 * Commands REST wrapper — the daemon's slash commands: Mainframe's own
 * built-ins plus whatever the registered adapters expose.
 *
 * Global, not per-project: the endpoint takes no arguments, and the registry
 * behind it is static.
 */
import type { CustomCommand } from '@qlan-ro/mainframe-types';
import { apiBase, request } from './http';

export const getCommands = (port: number): Promise<CustomCommand[]> =>
  request<CustomCommand[]>('GET', `${apiBase(port)}/api/commands`);
