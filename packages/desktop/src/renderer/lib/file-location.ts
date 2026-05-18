/**
 * Resolves a file path that may be either project-relative or absolute against
 * the active chat's worktree and the active project's root.
 *
 * Why: tool cards (Edit/Write) emit absolute worktree paths, while file-tree
 * and search palette emit project-relative paths. Editors need both shapes
 * (relative for the project-scoped API, absolute for fs.watch + matching
 * `context.updated.filePaths` which the daemon emits as absolute).
 *
 * "External" means the absolute path lives outside every known base — only
 * such files should fall back to the external-file API; an absolute path
 * inside the worktree is *not* external just because it's spelled absolutely.
 */

interface ProjectLike {
  id: string;
  path: string;
}

interface ChatLike {
  id: string;
  worktreePath?: string;
}

export interface FileLocation {
  /** Always present; used for fs.watch subscriptions and event matching. */
  absolutePath: string;
  /** Path relative to {@link basePath}; null for external files. */
  relativePath: string | null;
  /** Resolved base path; null for external files. */
  basePath: string | null;
  /** True when the path lives outside every known project/worktree base. */
  isExternal: boolean;
  /**
   * ChatId to pass to the API so the server resolves to the chat's worktree
   * base instead of the project root. Undefined when the path resolved against
   * the project root (no chat scoping needed).
   */
  chatIdForApi?: string;
}

interface ResolveOpts {
  activeChat?: ChatLike | null;
  project?: ProjectLike | null;
  /** Fallback chatId when activeChat is unknown (e.g. only the id is in scope). */
  fallbackChatId?: string | null;
}

export function resolveFileLocation(inputPath: string, opts: ResolveOpts): FileLocation | null {
  const { activeChat, project, fallbackChatId } = opts;

  const bases: { base: string; chatId?: string }[] = [];
  if (activeChat?.worktreePath) bases.push({ base: activeChat.worktreePath, chatId: activeChat.id });
  if (project?.path) bases.push({ base: project.path });

  if (!inputPath.startsWith('/')) {
    const first = bases[0];
    if (!first) return null;
    return {
      absolutePath: joinPath(first.base, inputPath),
      relativePath: inputPath,
      basePath: first.base,
      isExternal: false,
      chatIdForApi: first.chatId ?? fallbackChatId ?? undefined,
    };
  }

  for (const { base, chatId } of bases) {
    const rel = relativeUnder(base, inputPath);
    if (rel === null) continue;
    return {
      absolutePath: inputPath,
      relativePath: rel,
      basePath: base,
      isExternal: false,
      chatIdForApi: chatId ?? fallbackChatId ?? undefined,
    };
  }

  return {
    absolutePath: inputPath,
    relativePath: null,
    basePath: null,
    isExternal: true,
  };
}

function joinPath(base: string, rel: string): string {
  return base.endsWith('/') ? base + rel : `${base}/${rel}`;
}

/** Returns `path` relative to `base` if it's contained, else null. */
function relativeUnder(base: string, path: string): string | null {
  const normBase = base.endsWith('/') ? base.slice(0, -1) : base;
  if (path === normBase) return '';
  const prefix = normBase + '/';
  if (path.startsWith(prefix)) return path.slice(prefix.length);
  return null;
}
