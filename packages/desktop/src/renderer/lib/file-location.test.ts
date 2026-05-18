import { describe, it, expect } from 'vitest';
import { resolveFileLocation } from './file-location';

const project = { id: 'p1', path: '/Users/me/Projects/app' };
const chat = { id: 'c1', worktreePath: '/Users/me/Projects/app/.worktrees/feat' };

describe('resolveFileLocation', () => {
  it('resolves a relative path against the worktree first', () => {
    const loc = resolveFileLocation('src/foo.ts', { activeChat: chat, project });
    expect(loc).toEqual({
      absolutePath: '/Users/me/Projects/app/.worktrees/feat/src/foo.ts',
      relativePath: 'src/foo.ts',
      basePath: chat.worktreePath,
      isExternal: false,
      chatIdForApi: 'c1',
    });
  });

  it('resolves a relative path against the project when no chat is active', () => {
    const loc = resolveFileLocation('src/foo.ts', { activeChat: null, project });
    expect(loc).toEqual({
      absolutePath: '/Users/me/Projects/app/src/foo.ts',
      relativePath: 'src/foo.ts',
      basePath: project.path,
      isExternal: false,
      chatIdForApi: undefined,
    });
  });

  it('classifies an absolute path inside the worktree as internal and computes its relative form', () => {
    const loc = resolveFileLocation('/Users/me/Projects/app/.worktrees/feat/packages/core/src/x.ts', {
      activeChat: chat,
      project,
    });
    expect(loc?.isExternal).toBe(false);
    expect(loc?.relativePath).toBe('packages/core/src/x.ts');
    expect(loc?.basePath).toBe(chat.worktreePath);
    expect(loc?.chatIdForApi).toBe('c1');
  });

  it('classifies an absolute path inside the project root (but outside any worktree) as internal', () => {
    const loc = resolveFileLocation('/Users/me/Projects/app/src/x.ts', { activeChat: chat, project });
    expect(loc?.isExternal).toBe(false);
    expect(loc?.basePath).toBe(project.path);
    expect(loc?.relativePath).toBe('src/x.ts');
    expect(loc?.chatIdForApi).toBeUndefined();
  });

  it('classifies an absolute path outside every known base as external', () => {
    const loc = resolveFileLocation('/etc/hosts', { activeChat: chat, project });
    expect(loc).toEqual({
      absolutePath: '/etc/hosts',
      relativePath: null,
      basePath: null,
      isExternal: true,
    });
  });

  it('does not match a sibling path that shares a prefix with the base (no slash boundary)', () => {
    // `/Users/me/Projects/app-other/...` must not be considered inside `/Users/me/Projects/app`.
    const loc = resolveFileLocation('/Users/me/Projects/app-other/src/x.ts', { activeChat: null, project });
    expect(loc?.isExternal).toBe(true);
  });

  it('returns null when given a relative path with no base available', () => {
    expect(resolveFileLocation('foo.ts', { activeChat: null, project: null })).toBeNull();
  });

  it('handles a base path that ends with a trailing slash', () => {
    const loc = resolveFileLocation('/Users/me/Projects/app/src/x.ts', {
      activeChat: null,
      project: { id: 'p', path: '/Users/me/Projects/app/' },
    });
    expect(loc?.isExternal).toBe(false);
    expect(loc?.relativePath).toBe('src/x.ts');
  });

  it('treats the base path itself as internal with empty relative path', () => {
    const loc = resolveFileLocation('/Users/me/Projects/app', { activeChat: null, project });
    expect(loc?.isExternal).toBe(false);
    expect(loc?.relativePath).toBe('');
  });

  it('uses fallbackChatId when activeChat is null but a chatId is otherwise known', () => {
    const loc = resolveFileLocation('src/foo.ts', { activeChat: null, project, fallbackChatId: 'c-fallback' });
    expect(loc?.chatIdForApi).toBe('c-fallback');
  });
});
