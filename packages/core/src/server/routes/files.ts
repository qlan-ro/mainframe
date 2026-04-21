import { Router, Request, Response } from 'express';
import { readdir, stat, readFile, writeFile, realpath } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import { resolveAndValidatePath, resolveClaudeConfigPath } from './path-utils.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';
import { BrowseFilesystemQuery, validate } from './schemas.js';
import { IGNORED_DIRS, hasBinaryExtension } from '../fs-utils.js';
import { listFilesWithRipgrep } from '../ripgrep.js';

const logger = createChildLogger('routes:files');

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
    const resolved = await Promise.all(
      dirents
        .filter((e) => !IGNORED_DIRS.has(e.name))
        .map(async (e) => {
          const entryPath = path.join(fullPath, e.name);
          let type: 'file' | 'directory';
          if (e.isSymbolicLink()) {
            try {
              const st = await stat(entryPath);
              type = st.isDirectory() ? 'directory' : 'file';
            } catch {
              /* broken symlink, loop, or race — skip */
              return null;
            }
          } else {
            type = e.isDirectory() ? 'directory' : 'file';
          }
          return {
            name: e.name,
            type,
            path: path.relative(basePath, entryPath),
          };
        }),
    );
    const entries = resolved
      .filter((e): e is NonNullable<typeof e> => e !== null)
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

  const addResult = (relPath: string, isDir: boolean): void => {
    // File picker only surfaces files users can open in a text editor.
    if (isDir) return;
    if (hasBinaryExtension(relPath)) return;
    const relLower = relPath.toLowerCase();
    const name = path.basename(relPath);
    if (relLower.includes(q)) {
      substringHits.push({ name, path: relPath, type: 'file', exact: true });
    } else if (fuzzyMatch(q, relLower)) {
      fuzzyHits.push({ name, path: relPath, type: 'file', exact: false });
    }
  };

  // Use builtin-ignore-only mode: skips .gitignore so gitignored config files
  // (e.g. .env) appear in results, while still excluding build artifacts via
  // IGNORED_DIRS globs (node_modules, dist, .next, etc).
  const rgFiles = await listFilesWithRipgrep(basePath, { useBuiltinIgnoreOnly: true });

  if (rgFiles !== null) {
    for (const relFile of rgFiles) {
      if (substringHits.length + fuzzyHits.length >= scanLimit) break;
      addResult(relFile, false);
    }
  } else {
    // Fallback to recursive walk when ripgrep is unavailable
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
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (!resolveAndValidatePath(basePath, path.join(dir, entry.name))) continue;
        const rel = path.relative(basePath, path.join(dir, entry.name));
        addResult(rel, entry.isDirectory());
        if (entry.isDirectory()) await walk(path.join(dir, entry.name));
      }
    };
    await walk(basePath);
  }

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
      if (IGNORED_DIRS.has(entry.name)) continue;
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

  const encoding = req.query.encoding as string | undefined;

  try {
    const fullPath = resolveAndValidatePath(basePath, filePath) ?? resolveClaudeConfigPath(basePath, filePath);
    if (!fullPath) {
      res.status(403).json({ error: 'Path outside project' });
      return;
    }

    const stats = await stat(fullPath);
    const maxSize = encoding === 'base64' ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
    if (stats.size > maxSize) {
      res.status(413).json({ error: `File too large (max ${maxSize / 1024 / 1024}MB)` });
      return;
    }

    if (encoding === 'base64') {
      const buffer = await readFile(fullPath);
      res.json({ path: filePath, content: buffer.toString('base64'), encoding: 'base64' });
    } else {
      const content = await readFile(fullPath, 'utf-8');
      res.json({ path: filePath, content });
    }
  } catch (err) {
    logger.warn({ err, path: filePath }, 'Failed to read file content');
    res.status(404).json({ error: 'File not found' });
  }
}

/** PUT /api/projects/:id/files — write file content */
async function handleWriteFile(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.body?.chatId as string | undefined);
  if (!basePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const filePath = req.body?.path as string;
  const content = req.body?.content as string;
  if (!filePath || content == null) {
    res.status(400).json({ error: 'path and content required' });
    return;
  }

  try {
    const fullPath = resolveAndValidatePath(basePath, filePath);
    if (!fullPath) {
      res.status(403).json({ error: 'Path outside project' });
      return;
    }

    await writeFile(fullPath, content, 'utf-8');
    res.json({ path: filePath, success: true });
  } catch (err) {
    logger.warn({ err, path: filePath }, 'Failed to write file');
    res.status(500).json({ error: 'Failed to write file' });
  }
}

/** GET /api/filesystem/browse?path=~&includeFiles=true&includeHidden=true */
async function handleBrowseFilesystem(_ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const parsed = validate(BrowseFilesystemQuery, req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const { includeFiles, includeHidden } = parsed.data;
  const homeDir = homedir();
  let requestedPath = parsed.data.path || homeDir;
  // Expand leading ~
  if (requestedPath.startsWith('~')) {
    requestedPath = path.join(homeDir, requestedPath.slice(1));
  }

  const normalized = path.resolve(requestedPath);

  // Resolve symlinks; return 404 if path doesn't exist.
  let real: string;
  try {
    real = await realpath(normalized);
  } catch {
    res.status(404).json({ error: 'Directory not found' });
    return;
  }

  try {
    const dirents = await readdir(real, { withFileTypes: true });
    const entries = dirents
      .filter((e) => {
        const isDir = e.isDirectory();
        const isFile = e.isFile();
        const isSymlink = e.isSymbolicLink();
        if (!isDir && !isFile && !isSymlink) return false;
        if (!includeHidden && e.name.startsWith('.')) return false;
        if (IGNORED_DIRS.has(e.name)) return false;
        // If only dirs requested, drop plain files. Symlinks pass through to be
        // resolved below and then filtered by type if needed.
        if (!includeFiles && !isDir && !isSymlink) return false;
        return true;
      })
      .map(async (e) => {
        let type: 'file' | 'directory';
        if (e.isSymbolicLink()) {
          try {
            const st = await stat(path.join(real, e.name));
            type = st.isDirectory() ? 'directory' : 'file';
          } catch {
            return null;
          }
        } else {
          type = e.isDirectory() ? 'directory' : 'file';
        }
        if (!includeFiles && type === 'file') return null;
        return { name: e.name, path: path.join(real, e.name), type };
      });
    const resolved = (await Promise.all(entries)).filter((e): e is NonNullable<typeof e> => e !== null);
    resolved.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ path: real, entries: resolved });
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
  router.put(
    '/api/projects/:id/files',
    asyncHandler((req, res) => handleWriteFile(ctx, req, res)),
  );

  return router;
}
