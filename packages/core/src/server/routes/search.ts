import { Router, type Request, type Response } from 'express';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import { getEffectivePath, param } from './types.js';
import type { SearchContentResult } from '@qlan-ro/mainframe-types';
import { asyncHandler } from './async-handler.js';
import { validate } from './schemas.js';
import { listProjectFiles, hasBinaryExtension } from '../fs-utils.js';
import { searchWithRipgrep, isRipgrepAvailable } from '../ripgrep.js';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:search');

const MAX_RESULTS = 200;
const MAX_FILES_SCANNED = 5000;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_LINE_LENGTH = 500;

const ContentSearchQuery = z.object({
  q: z.string().min(2, 'Query must be at least 2 characters'),
  path: z.string().min(1, 'path is required'),
  chatId: z.string().optional(),
  includeIgnored: z.string().optional(),
});

async function isWithinBase(basePath: string, targetPath: string): Promise<string | null> {
  try {
    const realBase = await realpath(basePath);
    const realTarget = await realpath(path.resolve(basePath, targetPath));
    if (realTarget.startsWith(realBase + path.sep) || realTarget === realBase) return realTarget;
    return null;
  } catch {
    /* expected — path does not exist or symlink outside base */
    return null;
  }
}

function isBinaryBuffer(buf: Buffer): boolean {
  const end = Math.min(buf.length, 512);
  for (let i = 0; i < end; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

async function searchFile(
  filePath: string,
  relPath: string,
  query: string,
  results: SearchContentResult[],
  maxResults: number,
): Promise<void> {
  let buf: Buffer;
  try {
    buf = await readFile(filePath);
  } catch (err) {
    logger.warn({ err, filePath }, 'Failed to read file during content search');
    return;
  }

  if (isBinaryBuffer(buf)) return;

  const content = buf.toString('utf-8');
  const lines = content.split('\n');
  const lowerQuery = query.toLowerCase();

  for (let i = 0; i < lines.length && results.length < maxResults; i++) {
    const line = lines[i] ?? '';
    const truncated = line.slice(0, MAX_LINE_LENGTH);
    const lowerLine = truncated.toLowerCase();
    let col = lowerLine.indexOf(lowerQuery);
    while (col !== -1 && results.length < maxResults) {
      results.push({
        file: relPath,
        line: i + 1,
        column: col + 1,
        text: truncated,
      });
      col = lowerLine.indexOf(lowerQuery, col + 1);
    }
  }
}

/** GET /api/projects/:id/search/content */
async function handleContentSearch(ctx: RouteContext, req: Request, res: Response): Promise<void> {
  const parsed = validate(ContentSearchQuery, req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const { q, path: scopePath, chatId, includeIgnored } = parsed.data;
  const includeIgnoredFlag = includeIgnored === 'true';

  const rawBasePath = getEffectivePath(ctx, param(req, 'id'), chatId);
  if (!rawBasePath) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  // Resolve basePath symlinks so all relative computations use the canonical path
  let basePath: string;
  try {
    basePath = await realpath(rawBasePath);
  } catch (err) {
    logger.warn({ err, rawBasePath }, 'Project base path not resolvable');
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const resolvedScope = await isWithinBase(basePath, scopePath);
  if (!resolvedScope) {
    res.status(403).json({ error: 'Path outside project' });
    return;
  }

  let scopeStat: Awaited<ReturnType<typeof stat>>;
  try {
    scopeStat = await stat(resolvedScope);
  } catch (err) {
    logger.warn({ err, resolvedScope }, 'Scope path not found during content search');
    res.status(404).json({ error: 'Path not found' });
    return;
  }

  const results: SearchContentResult[] = [];

  if (!scopeStat.isDirectory()) {
    // Single file search — resolvedScope is already realpath'd
    try {
      const fileStat = await stat(resolvedScope);
      if (fileStat.size <= MAX_FILE_SIZE) {
        await searchFile(resolvedScope, path.relative(basePath, resolvedScope), q, results, MAX_RESULTS);
      }
    } catch (err) {
      logger.warn({ err, resolvedScope }, 'Failed to stat file for content search');
    }
  } else {
    // Try ripgrep first for performance
    const rgResults = await searchWithRipgrep(resolvedScope, q, {
      maxResults: MAX_RESULTS,
      maxFileSize: '1M',
      includeIgnored: includeIgnoredFlag,
    });

    if (rgResults.length > 0 || isRipgrepAvailable()) {
      // Re-relativize paths from scope-relative to basePath-relative, and filter binary extensions
      for (const r of rgResults) {
        const absFile = path.join(resolvedScope, r.file);
        const relFile = path.relative(basePath, absFile);
        if (hasBinaryExtension(relFile)) continue;
        results.push({ ...r, file: relFile });
      }
    } else {
      // Fallback to JS search when ripgrep is not available
      let allFiles: string[];
      try {
        allFiles = await listProjectFiles(basePath, { includeIgnored: includeIgnoredFlag });
      } catch (err) {
        logger.warn({ err, basePath }, 'Failed to list project files for content search');
        res.status(500).json({ error: 'Failed to list project files' });
        return;
      }

      const scopeRel = path.relative(basePath, resolvedScope);
      const scopePrefix = scopeRel === '' ? '' : scopeRel + path.sep;

      const filteredFiles = allFiles.filter((f) => {
        if (scopeRel !== '' && !f.startsWith(scopePrefix) && f !== scopeRel) return false;
        return !hasBinaryExtension(f);
      });

      let scanned = 0;
      for (const relFile of filteredFiles) {
        if (results.length >= MAX_RESULTS) break;
        if (scanned >= MAX_FILES_SCANNED) break;

        const absFile = path.join(basePath, relFile);
        let fileStat: Awaited<ReturnType<typeof stat>>;
        try {
          fileStat = await stat(absFile);
        } catch {
          continue;
        }

        if (fileStat.size > MAX_FILE_SIZE) {
          scanned++;
          continue;
        }

        await searchFile(absFile, relFile, q, results, MAX_RESULTS);
        scanned++;
      }
    }
  }

  res.json({ results });
}

export function contentSearchRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get(
    '/api/projects/:id/search/content',
    asyncHandler((req, res) => handleContentSearch(ctx, req, res)),
  );

  return router;
}
