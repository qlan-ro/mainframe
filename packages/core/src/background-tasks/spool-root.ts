import os from 'node:os';
import path from 'node:path';

/**
 * Absolute path of the Claude CLI's per-user spool root.
 *  - Linux/mac: /tmp/claude-{uid}
 *  - Win: %TEMP%/claude
 *  - CLAUDE_CODE_TMPDIR overrides the base.
 */
export function spoolRoot(): string {
  const tmpdir = process.env['CLAUDE_CODE_TMPDIR'] ?? (process.platform === 'win32' ? os.tmpdir() : '/tmp');
  const uidPart =
    process.platform === 'win32' ? 'claude' : `claude-${typeof process.getuid === 'function' ? process.getuid() : 0}`;
  return path.join(tmpdir, uidPart);
}
