import { execFile } from 'node:child_process';
import path from 'node:path';
import type { SearchContentResult } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../logger.js';

const logger = createChildLogger('ripgrep');

const MAX_LINE_LENGTH = 500;
const TIMEOUT_MS = 30_000;

export function parseRipgrepOutput(output: string, basePath: string, maxResults = 200): SearchContentResult[] {
  const results: SearchContentResult[] = [];

  for (const line of output.split('\n')) {
    if (results.length >= maxResults) break;
    if (!line.trim()) continue;

    let parsed: { type: string; data?: unknown };
    try {
      parsed = JSON.parse(line) as { type: string; data?: unknown };
    } catch {
      continue;
    }

    if (parsed.type !== 'match' || !parsed.data) continue;

    const data = parsed.data as {
      path?: { text?: string };
      line_number?: number;
      lines?: { text?: string };
      submatches?: Array<{ start?: number }>;
    };

    const filePath = data.path?.text;
    const lineNumber = data.line_number;
    const lineText = data.lines?.text;
    const submatches = data.submatches;

    if (!filePath || !lineNumber || lineText == null) continue;

    const relFile = path.relative(basePath, filePath);
    const text = lineText.replace(/\n$/, '').slice(0, MAX_LINE_LENGTH);
    const column = (submatches?.[0]?.start ?? 0) + 1;

    results.push({ file: relFile, line: lineNumber, column, text });
  }

  return results;
}

let rgBinaryPath: string | null | undefined = undefined;

function getRgPath(): string | null {
  if (rgBinaryPath !== undefined) return rgBinaryPath;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { rgPath } = require('@vscode/ripgrep') as { rgPath: string };
    rgBinaryPath = rgPath;
    return rgBinaryPath;
  } catch {
    logger.warn('Failed to load @vscode/ripgrep — ripgrep search unavailable');
    rgBinaryPath = null;
    return null;
  }
}

export interface RipgrepOptions {
  maxResults?: number;
  maxFileSize?: string;
  includeIgnored?: boolean;
}

export function searchWithRipgrep(
  scopePath: string,
  query: string,
  opts?: RipgrepOptions,
): Promise<SearchContentResult[]> {
  const rgPath = getRgPath();
  if (!rgPath) return Promise.resolve([]);

  const maxResults = opts?.maxResults ?? 200;
  const maxFileSize = opts?.maxFileSize ?? '1M';

  const args = ['--json', '--ignore-case', '--max-filesize', maxFileSize, '--no-require-git', '--max-count', '50'];

  if (opts?.includeIgnored) {
    args.push('--no-ignore', '--hidden');
  }

  args.push('--', query, scopePath);

  return new Promise((resolve) => {
    const child = execFile(
      rgPath,
      args,
      { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (stderr) {
          logger.debug({ stderr: stderr.slice(0, 500) }, 'ripgrep stderr');
        }

        // Exit code 1 = no matches (not an error). Exit code 2 = partial error.
        // execFile wraps process exit codes in err with numeric status on err.
        type ExecErr = NodeJS.ErrnoException & { killed?: boolean };
        const execErr = err as ExecErr | null;
        const isNoMatches = execErr && String((execErr as { code?: unknown }).code) === '1';
        if (execErr && !isNoMatches) {
          logger.warn({ err }, 'ripgrep process error');
        }

        if (!stdout) {
          resolve([]);
          return;
        }

        resolve(parseRipgrepOutput(stdout, scopePath, maxResults));
      },
    );

    // Safety timeout — kill if still running after TIMEOUT_MS
    setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM');
    }, TIMEOUT_MS);
  });
}

export function listFilesWithRipgrep(dirPath: string, opts?: { includeIgnored?: boolean }): Promise<string[] | null> {
  const rgPath = getRgPath();
  if (!rgPath) return Promise.resolve(null);

  const args = ['--files', '--no-require-git'];

  if (opts?.includeIgnored) {
    args.push('--no-ignore', '--hidden');
  }

  args.push(dirPath);

  return new Promise((resolve) => {
    execFile(rgPath, args, { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (stderr) {
        logger.debug({ stderr: stderr.slice(0, 500) }, 'ripgrep --files stderr');
      }

      if (err) {
        logger.warn({ err }, 'ripgrep --files failed');
        resolve(null);
        return;
      }

      const files = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((absPath) => path.relative(dirPath, absPath));

      resolve(files);
    });
  });
}

export function isRipgrepAvailable(): boolean {
  return getRgPath() !== null;
}
