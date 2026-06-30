export interface DaemonTarget {
  id: string;
  kind: 'local' | 'remote';
  label: string;
  baseUrl: string; // 'http://127.0.0.1:<port>' | 'https://<tunnel-host>'
  token: string | null; // null => loopback trust (local); JWT => remote bearer
}

// Persisted registry shape — NEVER carries a token (tokens live in the
// keyring/safeStorage). `host` is the bare host[:port]; baseUrl is derived.
export interface DaemonMeta {
  id: string;
  kind: 'local' | 'remote';
  label: string;
  host: string;
  device?: string;
  paired?: string;
}
