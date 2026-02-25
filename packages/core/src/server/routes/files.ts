import { Router, Request, Response } from 'express';
import { readdir, stat, readFile, realpath } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import { resolveAndValidatePath } from './path-utils.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:files');

const IGNORED_DIRS = new Set([
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
]);

/** GET /api/projects/:id/tree?path=relative/dir&chatId=X */
async function handleTree(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const dirPath = (req.query.path as string) || '.';
  try {
    const fullPath = resolveAndValidatePath(basePath, dirPath);
    if (!fullPath) {
      res.status(403).json({ error: 'Path outside project' });
      return;
    }

    const dirents = await readdir(fullPath, { withFileTypes: true });
    const entries = dirents
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? ('directory' as const) : ('file' as const),
        path: path.relative(basePath, path.join(fullPath, e.name)),
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json(entries);
  } catch (err) {
    logger.warn({ err, path: dirPath }, 'Failed to read directory tree');
    res.status(404).json({ error: 'Directory not found' });
  }
}

/** GET /api/projects/:id/search/files?q=<query>&limit=50&chatId=X */
async function handleSearchFiles(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const q = ((req.query.q as string) || '').toLowerCase();
  if (q.length < 1) {
    res.json([]);
    return;
  }

  try {
    await realpath(basePath);
  } catch (err) {
    logger.warn({ err, basePath }, 'Project path not found for file search');
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);

  type FileResult = { name: string; path: string; type: string; exact: boolean };
  const substringHits: FileResult[] = [];
  const fuzzyHits: FileResult[] = [];
  const scanLimit = limit * 4;

  const fuzzyMatch = (query: string, target: string): boolean => {
    let qi = 0;
    for (let ti = 0; ti < target.length && qi < query.length; ti++) {
      if (target[ti] === query[qi]) qi++;
    }
    return qi === query.length;
  };

  const walk = async (dir: string): Promise<void> => {
    if (substringHits.length + fuzzyHits.length >= scanLimit) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      logger.warn({ err, dir }, 'Failed to read directory during file search');
      return;
    }
    for (const entry of entries) {
      if (substringHits.length + fuzzyHits.length >= scanLimit) return;
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
      if (!resolveAndValidatePath(basePath, path.join(dir, entry.name))) continue;
      const rel = path.relative(basePath, path.join(dir, entry.name));
      const relLower = rel.toLowerCase();
      if (relLower.includes(q)) {
        substringHits.push({
          name: entry.name,
          path: rel,
          type: entry.isDirectory() ? 'directory' : 'file',
          exact: true,
        });
      } else if (fuzzyMatch(q, relLower)) {
        fuzzyHits.push({ name: entry.name, path: rel, type: entry.isDirectory() ? 'directory' : 'file', exact: false });
      }
      if (entry.isDirectory()) await walk(path.join(dir, entry.name));
    }
  };
  await walk(basePath);

  const combined = [...substringHits, ...fuzzyHits].slice(0, limit);
  res.json(combined.map(({ exact: _, ...r }) => r));
}

/** GET /api/projects/:id/files-list?limit=5000&chatId=X */
async function handleFilesList(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 5000, 5000);

  try {
    await realpath(basePath);
  } catch (err) {
    logger.warn({ err, basePath }, 'Project path not found for file listing');
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (files.length >= limit) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      logger.warn({ err, dir }, 'Failed to read directory during file listing');
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
      if (!resolveAndValidatePath(basePath, path.join(dir, entry.name))) continue;
      const rel = path.relative(basePath, path.join(dir, entry.name));
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name));
      } else {
        files.push(rel);
      }
    }
  };
  await walk(basePath);
  res.json(files);
}

/** GET /api/projects/:id/files?path=relative/path&chatId=X */
async function handleFileContent(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ error: 'path query required' });
    return;
  }

  try {
    const fullPath = resolveAndValidatePath(basePath, filePath);
    if (!fullPath) {
      res.status(403).json({ error: 'Path outside project' });
      return;
    }

    const stats = await stat(fullPath);
    if (stats.size > 2 * 1024 * 1024) {
      res.status(413).json({ error: 'File too large (max 2MB)' });
      return;
    }

    const content = await readFile(fullPath, 'utf-8');
    res.json({ path: filePath, content });
  } catch (err) {
    logger.warn({ err, path: filePath }, 'Failed to read file content');
    res.status(404).json({ error: 'File not found' });
  }
}

/** GET /api/filesystem/browse?path=~ */
async function handleBrowseFilesystem(_ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const homeDir = homedir();
  const requestedPath = (req.query.path as string) || homeDir;

  const normalized = path.resolve(requestedPath);
  const normalizedHome = path.resolve(homeDir);
  if (!normalized.startsWith(normalizedHome + path.sep) && normalized !== normalizedHome) {
    res.status(403).json({ error: 'Path outside home directory' });
    return;
  }

  try {
    const dirents = await readdir(normalized, { withFileTypes: true });
    const entries = dirents
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !IGNORED_DIRS.has(e.name))
      .map((e) => ({ name: e.name, path: path.join(normalized, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ path: normalized, entries });
  } catch (err) {
    logger.warn({ err, path: requestedPath }, 'Failed to browse directory');
    res.status(404).json({ error: 'Directory not found' });
  }
}

export function fileRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/filesystem/browse',
    asyncHandler((req, res) => handleBrowseFilesystem(ctx, req, res)),
  );
  router.get(
    '/api/projects/:id/tree',
    asyncHandler((req, res) => handleTree(ctx, req, res)),
  );
  router.get(
    '/api/projects/:id/search/files',
    asyncHandler((req, res) => handleSearchFiles(ctx, req, res)),
  );
  router.get(
    '/api/projects/:id/files-list',
    asyncHandler((req, res) => handleFilesList(ctx, req, res)),
  );
  router.get(
    '/api/projects/:id/files',
    asyncHandler((req, res) => handleFileContent(ctx, req, res)),
  );

  return router;
}
