import { z } from 'zod';

export interface DaemonTarget {
  id: string;
  kind: 'local' | 'remote';
  label: string;
  baseUrl: string; // 'http://127.0.0.1:<port>' | 'https://<tunnel-host>'
  token: string | null; // null => loopback trust (local); JWT => remote bearer
}

// Persisted registry shape — NEVER carries a token (tokens live in the
// keyring/safeStorage). `host` is the bare host[:port]; baseUrl is derived.
// `scheme` is the scheme the daemon was paired with; absent means https, so
// registry entries written before this field existed keep resolving as before.
export const DaemonMetaSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['local', 'remote']),
  label: z.string().min(1),
  host: z.string().min(1),
  scheme: z.enum(['http', 'https']).optional(),
  device: z.string().optional(),
  paired: z.string().optional(),
});

export type DaemonMeta = z.infer<typeof DaemonMetaSchema>;
