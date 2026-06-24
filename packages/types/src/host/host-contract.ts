/**
 * host/host-contract.ts
 *
 * Zod schemas for every host command payload + event. The single source of
 * payload shapes: the Electron ipcMain handlers parse args with these; the Rust
 * (Tauri) shell conforms via serde to the same documented contract (no shared
 * code across languages). Platform/DaemonStatus enums are defined HERE and
 * re-exported type-only from host-bridge.ts so there is one source.
 */
import { z } from 'zod';

export const PlatformSchema = z.enum(['macos', 'windows', 'linux', 'browser']);
export type Platform = z.infer<typeof PlatformSchema>;

/**
 * Daemon lifecycle vocabulary. Both hosts emit ONLY these values so the renderer
 * (useConnectionState) sees identical statuses on Tauri and Electron.
 * - initializing: shell starting, daemon not yet forked
 * - starting:     daemon process forked, not yet answering /health
 * - ready:        daemon answered /health (or utilityProcess 'spawn')
 * - unavailable:  daemon port could not be acquired
 * - stopped:      daemon process exited
 */
export const DaemonStatusSchema = z.enum(['initializing', 'starting', 'ready', 'unavailable', 'stopped']);
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>;

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const AppInfoSchema = z.object({
  version: z.string(),
  author: z.string(),
  homedir: z.string(),
});

export const FilePathSchema = z.string().min(1);

export const OpenExternalSchema = z.string().min(1);

export const TerminalCreateOptsSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export const TerminalWriteSchema = z.object({
  id: z.string().min(1),
  data: z.string(),
});

export const TerminalResizeSchema = z.object({
  id: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export const TerminalIdSchema = z.object({ id: z.string().min(1) });

export const NotifySchema = z.object({
  title: z.string(),
  body: z.string().optional(),
});

export const ClearSessionSchema = z.object({ projectId: z.string().min(1) });

export const RegionSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const LogRecordSchema = z.object({
  level: LogLevelSchema,
  module: z.string(),
  message: z.string(),
  data: z.unknown().optional(),
});
