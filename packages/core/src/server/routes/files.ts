import { Router, Request, Response } from 'express';
import { readdir, stat, readFile, writeFile, realpath } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import { resolveAndValidatePath, resolveReadablePath } from './path-utils.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';
import { BrowseFilesystemQuery, validate } from './schemas.js';
import { IGNORED_DIRS, hasBinaryExtension } from '../fs-utils.js';
import { listFilesWithRipgrep } from '../ripgrep.js';
import { ok, fail } from './respond.js';

const logger = createChildLogger('routes:files');

const TREE_HIDDEN_NAMES = new Set(['.git']);

/** GET /api/projects/:id/tree?path=relative/dir&chatId=X */
async function handleTree(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    fail(res, 404, 'Project not found');
    return;
  }

  const dirPath = (req.query.path as string) || '.';
  try {
    const fullPath = resolveAndValidatePath(basePath, dirPath);
    if (!fullPath) {
      fail(res, 403, 'Path outside project');
      return;
    }

    const dirents = await readdir(fullPath, { withFileTypes: true });
    const resolved = await Promise.all(
      dirents
        .filter((e) => !TREE_HIDDEN_NAMES.has(e.name))
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
    ok(res, entries);
  } catch (err) {
    logger.warn({ err, path: dirPath }, 'Failed to read directory tree');
    fail(res, 404, 'Directory not found');
  }
}

/** GET /api/projects/:id/search/files?q=<query>&limit=50&chatId=X */
async function handleSearchFiles(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    fail(res, 404, 'Project not found');
    return;
  }

  const q = ((req.query.q as string) || '').toLowerCase();
  if (q.length < 1) {
    ok(res, []);
    return;
  }

  try {
    await realpath(basePath);
  } catch (err) {
    logger.warn({ err, basePath }, 'Project path not found for file search');
    fail(res, 404, 'Project not found');
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
  ok(
    res,
    combined.map(({ exact: _, ...r }) => r),
  );
}

/** GET /api/projects/:id/files-list?limit=5000&chatId=X */
async function handleFilesList(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    fail(res, 404, 'Project not found');
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 5000, 5000);

  try {
    await realpath(basePath);
  } catch (err) {
    logger.warn({ err, basePath }, 'Project path not found for file listing');
    fail(res, 404, 'Project not found');
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
  ok(res, files);
}

/** GET /api/projects/:id/files?path=relative/path&chatId=X */
async function handleFileContent(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const basePath = getEffectivePath(ctx, param(req, 'id'), req.query.chatId as string | undefined);
  if (!basePath) {
    fail(res, 404, 'Project not found');
    return;
  }

  const filePath = req.query.path as string;
  if (!filePath) {
    fail(res, 400, 'path query required');
    return;
  }

  const encoding = req.query.encoding as string | undefined;

  try {
    const fullPath = resolveReadablePath(basePath, filePath);
    if (!fullPath) {
      fail(res, 403, 'Path outside project');
      return;
    }

    const stats = await stat(fullPath);
    const maxSize = encoding === 'base64' ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
    if (stats.size > maxSize) {
      fail(res, 413, `File too large (max ${maxSize / 1024 / 1024}MB)`);
      return;
    }

    if (encoding === 'base64') {
      const buffer = await readFile(fullPath);
      ok(res, { path: filePath, content: buffer.toString('base64'), encoding: 'base64' });
    } else {
      const content = await readFile(fullPath, 'utf-8');
      ok(res, { path: filePath, content });
    }
  } catch (err) {
    logger.warn({ err, path: filePath }, 'Failed to read file content');
    fail(res, 404, 'File not found');
  }
}

const WriteFileBody = z.object({
  chatId: z.string().optional(),
  path: z.string().min(1),
  content: z.string(),
});

/** PUT /api/projects/:id/files — write file content */
async function handleWriteFile(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const parsed = validate(WriteFileBody, req.body);
  if (!parsed.success) {
    fail(res, 400, parsed.error);
    return;
  }

  const basePath = getEffectivePath(ctx, param(req, 'id'), parsed.data.chatId);
  if (!basePath) {
    fail(res, 404, 'Project not found');
    return;
  }

  const filePath = parsed.data.path;
  const content = parsed.data.content;

  try {
    const fullPath = resolveAndValidatePath(basePath, filePath);
    if (!fullPath) {
      fail(res, 403, 'Path outside project');
      return;
    }

    await writeFile(fullPath, content, 'utf-8');
    ok(res, { path: filePath });
  } catch (err) {
    logger.warn({ err, path: filePath }, 'Failed to write file');
    fail(res, 500, 'Failed to write file');
  }
}

const ResolvePathQuery = z.object({
  path: z.string().min(1),
  chatId: z.string().optional(),
});

/** GET /api/projects/:id/paths/resolve?path=<relative-or-absolute>&chatId=<optional> */
async function handleResolvePath(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const parsed = validate(ResolvePathQuery, req.query);
  if (!parsed.success) {
    fail(res, 400, parsed.error);
    return;
  }

  const { path: requestedPath, chatId } = parsed.data;
  const projectId = param(req, 'id');

  // Distinguish worktree-missing from project-not-found before calling getEffectivePath.
  const project = ctx.db.projects.get(projectId);
  if (!project) {
    fail(res, 404, 'Project not found');
    return;
  }

  if (chatId) {
    const chat = ctx.chats.getChat(chatId);
    if (chat?.worktreeMissing) {
      fail(res, 409, 'Worktree missing');
      return;
    }
  }

  const basePath = getEffectivePath(ctx, projectId, chatId);
  if (!basePath) {
    fail(res, 404, 'Project not found');
    return;
  }

  // Determine baseKind: worktree when basePath differs from project root.
  const baseKind: 'project' | 'worktree' = basePath !== project.path ? 'worktree' : 'project';

  // resolveAndValidatePath = strict containment inside basePath → contained:true.
  // resolveReadablePath also accepts ~/.claude fallback → contained:false for that branch.
  // Neither returns non-null for a truly external path — fall back to raw realpath.
  let absolute: string;
  let contained: boolean;

  const strictValidated = resolveAndValidatePath(basePath, requestedPath);
  if (strictValidated) {
    absolute = strictValidated;
    contained = true;
  } else {
    const broadValidated = resolveReadablePath(basePath, requestedPath);
    if (broadValidated) {
      absolute = broadValidated;
      contained = false;
    } else {
      // Path is outside all known bases — resolve best-effort with realpath.
      try {
        absolute = await realpath(path.resolve(basePath, requestedPath));
      } catch {
        /* expected: path doesn't exist — use the normalized form */
        absolute = path.resolve(basePath, requestedPath);
      }
      contained = false;
    }
  }

  // Resolve basePath to its realpath for a canonical response.
  let realBase: string;
  try {
    realBase = await realpath(basePath);
  } catch {
    /* expected: basePath symlink chain broken or race */
    realBase = basePath;
  }

  const relative = path.relative(realBase, absolute);

  ok(res, { relative, absolute, baseKind, basePath: realBase, contained });
}

const ExternalFileQuery = z.object({
  path: z.string().min(1),
  encoding: z.enum(['base64']).optional(),
});

/**
 * Sensitive path prefixes that should never be served through the external file endpoint.
 * This is a minimal blocklist — the user is opening these explicitly, so most paths are allowed.
 */
const BLOCKED_PREFIXES = ['/etc/shadow', '/etc/master.passwd', '/etc/sudoers'];

const BLOCKED_PATTERNS = [
  /\/\.ssh\/id_/, // private SSH keys
  /\/\.aws\/credentials$/,
  /\/\.netrc$/,
  /\/\.gnupg\//, // private keyrings
];

function isBlockedExternalPath(resolved: string): boolean {
  if (BLOCKED_PREFIXES.some((p) => resolved === p || resolved.startsWith(p + '/'))) return true;
  if (BLOCKED_PATTERNS.some((re) => re.test(resolved))) return true;
  return false;
}

/** GET /api/files/external?path=/absolute/path/to/file
 *  Reads a file at an absolute path outside any project root.
 *  Only real files (no directories) are served; a minimal blocklist rejects
 *  known sensitive paths (SSH private keys, shadow passwords, sudoers).
 */
async function handleExternalFileContent(_ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const parsed = validate(ExternalFileQuery, req.query);
  if (!parsed.success) {
    fail(res, 400, parsed.error);
    return;
  }

  const { path: requestedPath, encoding } = parsed.data;

  // Check blocklist against the raw requested path first (before realpath) so that
  // attempts to access sensitive paths are rejected even when the file doesn't exist.
  if (isBlockedExternalPath(requestedPath)) {
    fail(res, 403, 'Access to this path is not allowed');
    return;
  }

  let resolved: string;
  try {
    resolved = await realpath(requestedPath);
  } catch {
    fail(res, 404, 'File not found');
    return;
  }

  // Check again after realpath in case a symlink resolves to a blocked path.
  if (isBlockedExternalPath(resolved)) {
    fail(res, 403, 'Access to this path is not allowed');
    return;
  }

  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(resolved);
  } catch (err) {
    logger.warn({ err, path: resolved }, 'Failed to stat external file');
    fail(res, 404, 'File not found');
    return;
  }

  if (!fileStat.isFile()) {
    fail(res, 400, 'Path is not a file');
    return;
  }

  // Same limits as the project files route: binary viewers need more headroom.
  const maxSize = encoding === 'base64' ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
  if (fileStat.size > maxSize) {
    fail(res, 413, `File too large (max ${maxSize / 1024 / 1024}MB)`);
    return;
  }

  try {
    if (encoding === 'base64') {
      const buffer = await readFile(resolved);
      ok(res, { path: resolved, content: buffer.toString('base64'), encoding: 'base64' });
    } else {
      const content = await readFile(resolved, 'utf-8');
      ok(res, { path: resolved, content });
    }
  } catch (err) {
    logger.warn({ err, path: resolved }, 'Failed to read external file');
    fail(res, 500, 'Failed to read file');
  }
}

/** GET /api/filesystem/browse?path=~&includeFiles=true&includeHidden=true */
async function handleBrowseFilesystem(_ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const parsed = validate(BrowseFilesystemQuery, req.query);
  if (!parsed.success) {
    fail(res, 400, parsed.error);
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
    fail(res, 404, 'Directory not found');
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

    ok(res, { path: real, entries: resolved });
  } catch (err) {
    logger.warn({ err, path: requestedPath }, 'Failed to browse directory');
    fail(res, 404, 'Directory not found');
  }
}

export function fileRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/filesystem/browse',
    asyncHandler((req, res) => handleBrowseFilesystem(ctx, req, res)),
  );
  router.get(
    '/api/files/external',
    asyncHandler((req, res) => handleExternalFileContent(ctx, req, res)),
  );
  router.get(
    '/api/projects/:id/paths/resolve',
    asyncHandler((req, res) => handleResolvePath(ctx, req, res)),
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
