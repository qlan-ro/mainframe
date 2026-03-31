import { readdir, realpath } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { createChildLogger } from '../logger.js';
import { execGit } from './routes/exec-git.js';

const logger = createChildLogger('fs-utils');

export const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'out',
  '.cache',
  '__pycache__',
  '.venv',
  'vendor',
  'coverage',
  '.turbo',
  '.gradle',
  '.cargo',
  'target',
  '.parcel-cache',
  '.nuxt',
  '.output',
  'bower_components',
]);

export const BINARY_EXTENSIONS = new Set([
  '.class',
  '.jar',
  '.war',
  '.o',
  '.so',
  '.dylib',
  '.dll',
  '.exe',
  '.pyc',
  '.pyo',
  '.wasm',
  '.min.js',
  '.min.css',
  '.map',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp3',
  '.mp4',
  '.zip',
  '.tar',
  '.gz',
  '.pdf',
]);

export function hasBinaryExtension(filePath: string): boolean {
  const base = path.basename(filePath);
  // Handle double extensions like .min.js or .min.css
  const dotIndex = base.indexOf('.');
  if (dotIndex !== -1) {
    const doubleExt = base.slice(dotIndex);
    if (BINARY_EXTENSIONS.has(doubleExt)) return true;
  }
  const ext = path.extname(base);
  return ext !== '' && BINARY_EXTENSIONS.has(ext);
}

const WALK_LIMIT = 10_000;

async function walkProjectFiles(projectPath: string, skipIgnoredDirs: boolean): Promise<string[]> {
  const files: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    if (files.length >= WALK_LIMIT) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      logger.warn({ err, dir }, 'Failed to read directory during project walk');
      return;
    }
    for (const entry of entries) {
      if (files.length >= WALK_LIMIT) return;
      if (entry.name === '.git') continue;
      if (skipIgnoredDirs && IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      // Symlink safety: resolve and verify within project root
      let realFull: string;
      try {
        realFull = await realpath(fullPath);
      } catch {
        /* expected — broken symlink or race; skip */
        continue;
      }
      if (!realFull.startsWith(projectPath + path.sep) && realFull !== projectPath) continue;

      const rel = path.relative(projectPath, realFull);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        files.push(rel);
      }
    }
  };

  await walk(projectPath);
  return files;
}

export async function listProjectFiles(projectPath: string, options?: { includeIgnored?: boolean }): Promise<string[]> {
  if (options?.includeIgnored) {
    return walkProjectFiles(projectPath, false);
  }

  try {
    const output = await execGit(['ls-files', '--cached', '--others', '--exclude-standard'], projectPath);
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== 128) {
      logger.warn({ err, projectPath }, 'git ls-files failed unexpectedly, falling back to walk');
    }
    return walkProjectFiles(projectPath, true);
  }
}
