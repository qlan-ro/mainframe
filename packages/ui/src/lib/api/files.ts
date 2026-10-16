/**
 * File search, project tree, and filesystem browse REST wrappers.
 */
import { apiBase, request } from './http';
import type { SearchContentResult } from '@qlan-ro/mainframe-types';

export interface FileResult {
  name: string;
  path: string;
  type: string;
  exact: boolean;
}

export interface FileTreeEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
}

export const searchFiles = (port: number, projectId: string, query: string, chatId?: string): Promise<FileResult[]> => {
  const qs = new URLSearchParams({ q: query, limit: '30' });
  if (chatId) qs.set('chatId', chatId);
  return request<FileResult[]>(
    'GET',
    `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/search/files?${qs}`,
  );
};

export const getFileTree = (port: number, projectId: string, dir = '.', chatId?: string): Promise<FileTreeEntry[]> => {
  const qs = new URLSearchParams({ path: dir });
  if (chatId) qs.set('chatId', chatId);
  return request<FileTreeEntry[]>('GET', `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/tree?${qs}`);
};

interface FileContentResponse {
  path: string;
  content: string;
}

/** A file the agent wrote or edited during a chat session. */
export interface SessionFile {
  /** Relative to the session's worktree (or project). */
  path: string;
  /** `added` when the session created it, `deleted` when it no longer exists. */
  status: 'added' | 'modified' | 'deleted';
}

/** Every file the agent wrote or edited during a chat session, committed or not. */
export async function getSessionFiles(port: number, chatId: string): Promise<SessionFile[]> {
  const data = await request<{ files: SessionFile[] }>(
    'GET',
    `${apiBase(port)}/api/chats/${encodeURIComponent(chatId)}/session-files`,
  );
  return data.files ?? [];
}

export interface SessionDiff {
  original: string;
  modified: string;
  /**
   * `session`: the file before the session's first edit and after its last,
   * replayed from the transcript. `git`: the edits could not be replayed
   * (later work changed the file), so this is the file at the last commit
   * before the session started against the working tree.
   */
  source: 'session' | 'git';
}

/** One session file before and after the session's edits. */
export async function getSessionDiff(port: number, chatId: string, file: string): Promise<SessionDiff> {
  const qs = new URLSearchParams({ file });
  return request<SessionDiff>('GET', `${apiBase(port)}/api/chats/${encodeURIComponent(chatId)}/session-diff?${qs}`);
}

/**
 * Read a project file's UTF-8 content via the daemon (worktree-aware). Accepts
 * a repo-relative path (file tree) OR an absolute path under the project
 * (chat tool-cards) — the daemon resolves both against the worktree base.
 */
export async function getProjectFile(port: number, projectId: string, path: string, chatId?: string): Promise<string> {
  const qs = new URLSearchParams({ path });
  if (chatId) qs.set('chatId', chatId);
  const data = await request<FileContentResponse>(
    'GET',
    `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/files?${qs}`,
  );
  return data.content;
}

/**
 * Read a project file's content as a base64 string via the daemon
 * (worktree-aware). Same path resolution as `getProjectFile` but appends
 * `encoding=base64` — suitable for binary files (images, PDFs).
 */
export async function getProjectFileBase64(
  port: number,
  projectId: string,
  path: string,
  chatId?: string,
): Promise<string> {
  const qs = new URLSearchParams({ path, encoding: 'base64' });
  if (chatId) qs.set('chatId', chatId);
  const data = await request<FileContentResponse>(
    'GET',
    `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/files?${qs}`,
  );
  return data.content;
}

/**
 * Read a file OUTSIDE any project root via the daemon's read-only external
 * endpoint (`GET /api/files/external`). Absolute paths only. The daemon
 * blocklists known-sensitive paths (SSH keys, shadow, sudoers, …) and rejects
 * directories. There is deliberately NO write counterpart — external files are
 * view-only.
 */
export async function getExternalFile(port: number, path: string, encoding?: 'base64'): Promise<string> {
  const qs = new URLSearchParams({ path });
  if (encoding) qs.set('encoding', encoding);
  const data = await request<FileContentResponse>('GET', `${apiBase(port)}/api/files/external?${qs}`);
  return data.content;
}

export interface ViewFileResult {
  content: string;
  /** True when the file was served by the read-only external endpoint. */
  external: boolean;
}

/**
 * Absolute-path test matching the daemon HOST's semantics (not the renderer's):
 * POSIX (`/…`), Windows drive-letter (`C:\…` / `C:/…`), or UNC (`\\server\…`).
 */
const isAbsolutePath = (p: string): boolean => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');

/**
 * Read a file for VIEWING: tries the project route first (worktree-aware,
 * editable), and when the daemon rejects an absolute path as outside the
 * project, falls back to the read-only external endpoint. Relative escapes
 * (`../..`) never fall back — only genuine absolute out-of-project paths do.
 */
export async function getFileForView(
  port: number,
  projectId: string,
  path: string,
  chatId?: string,
  opts: { base64?: boolean } = {},
): Promise<ViewFileResult> {
  const encoding = opts.base64 ? ('base64' as const) : undefined;
  try {
    const content = encoding
      ? await getProjectFileBase64(port, projectId, path, chatId)
      : await getProjectFile(port, projectId, path, chatId);
    return { content, external: false };
  } catch (err) {
    const outside = err instanceof Error && err.message === 'Path outside project';
    if (!outside || !isAbsolutePath(path)) throw err;
    const content = await getExternalFile(port, path, encoding);
    return { content, external: true };
  }
}

interface WriteFileResponse {
  path: string;
}

/**
 * Write a project file's UTF-8 content via the daemon (worktree-aware).
 * Calls PUT /api/projects/:id/files with a JSON body `{ path, content, chatId? }`.
 * The daemon validates and writes the file, returning `{ path }` on success.
 */
export async function saveProjectFile(
  port: number,
  projectId: string,
  path: string,
  content: string,
  chatId?: string,
): Promise<void> {
  const body: { path: string; content: string; chatId?: string } = { path, content };
  if (chatId) body.chatId = chatId;
  await request<WriteFileResponse>('PUT', `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/files`, body);
}

/** Shape returned by GET /api/projects/:id/paths/resolve */
export interface ResolvePathResult {
  /** Path relative to the effective base (project root or worktree). */
  relative: string;
  /** Realpath-resolved absolute path on the host filesystem. */
  absolute: string;
  /** Whether the base is the project root or a live worktree. */
  baseKind: 'project' | 'worktree';
  /** The effective base directory (realpath-resolved). */
  basePath: string;
  /** True when absolute is strictly inside basePath; false for external paths. */
  contained: boolean;
}

/**
 * Resolve a path through the daemon's validated resolver (worktree-aware).
 * Accepts relative or absolute paths; returns the canonical absolute, relative,
 * baseKind, basePath, and containment flag.
 *
 * Use this whenever a feature needs the HOST absolute path — never reconstruct
 * it client-side by concatenating basePath + relative.
 */
export async function resolvePath(
  port: number,
  projectId: string,
  filePath: string,
  chatId?: string,
): Promise<ResolvePathResult> {
  const qs = new URLSearchParams({ path: filePath });
  if (chatId) qs.set('chatId', chatId);
  return request<ResolvePathResult>(
    'GET',
    `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/paths/resolve?${qs}`,
  );
}

interface BrowseOpts {
  includeFiles?: boolean;
  includeHidden?: boolean;
}

/** The daemon wraps browse as `{success:true, data:{path, entries:[…]}}`. */
interface BrowseResponseData {
  path: string;
  entries: FileTreeEntry[];
}

export async function browseFilesystem(port: number, dir: string, opts: BrowseOpts = {}): Promise<FileTreeEntry[]> {
  const qs = new URLSearchParams({ path: dir });
  if (opts.includeFiles !== undefined) qs.set('includeFiles', String(opts.includeFiles));
  if (opts.includeHidden !== undefined) qs.set('includeHidden', String(opts.includeHidden));
  const data = await request<BrowseResponseData>('GET', `${apiBase(port)}/api/filesystem/browse?${qs}`);
  return data.entries;
}

export const searchContent = (
  port: number,
  projectId: string,
  query: string,
  scopePath: string,
  opts: { includeIgnored?: boolean; chatId?: string } = {},
): Promise<SearchContentResult[]> => {
  const qs = new URLSearchParams({ q: query, path: scopePath });
  if (opts.includeIgnored) qs.set('includeIgnored', 'true');
  if (opts.chatId) qs.set('chatId', opts.chatId);
  return request<{ results: SearchContentResult[] }>(
    'GET',
    `${apiBase(port)}/api/projects/${encodeURIComponent(projectId)}/search/content?${qs}`,
  ).then((data) => data.results);
};
