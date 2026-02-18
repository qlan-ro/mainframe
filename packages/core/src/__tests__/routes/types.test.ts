import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEffectivePath } from '../../server/routes/types.js';
import type { RouteContext } from '../../server/routes/types.js';

function createMockContext(): RouteContext {
  return {
    db: {
      projects: { get: vi.fn() },
      chats: { list: vi.fn() },
      settings: { get: vi.fn() },
    } as any,
    chats: { getChat: vi.fn(), on: vi.fn() } as any,
    adapters: { get: vi.fn(), list: vi.fn() } as any,
  };
}

describe('getEffectivePath', () => {
  let ctx: RouteContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('returns project path when project exists and no chatId', () => {
    (ctx.db.projects.get as any).mockReturnValue({ id: 'p1', path: '/my/project' });

    const result = getEffectivePath(ctx, 'p1');
    expect(result).toBe('/my/project');
  });

  it('returns null when project not found', () => {
    (ctx.db.projects.get as any).mockReturnValue(undefined);

    const result = getEffectivePath(ctx, 'nope');
    expect(result).toBeNull();
  });

  it('returns worktreePath when chat has one', () => {
    (ctx.db.projects.get as any).mockReturnValue({ id: 'p1', path: '/my/project' });
    (ctx.chats.getChat as any).mockReturnValue({ id: 'c1', worktreePath: '/worktree/path' });

    const result = getEffectivePath(ctx, 'p1', 'c1');
    expect(result).toBe('/worktree/path');
  });

  it('returns project path when chat has no worktreePath', () => {
    (ctx.db.projects.get as any).mockReturnValue({ id: 'p1', path: '/my/project' });
    (ctx.chats.getChat as any).mockReturnValue({ id: 'c1', worktreePath: null });

    const result = getEffectivePath(ctx, 'p1', 'c1');
    expect(result).toBe('/my/project');
  });

  it('returns project path when chat not found', () => {
    (ctx.db.projects.get as any).mockReturnValue({ id: 'p1', path: '/my/project' });
    (ctx.chats.getChat as any).mockReturnValue(undefined);

    const result = getEffectivePath(ctx, 'p1', 'unknown-chat');
    expect(result).toBe('/my/project');
  });
});
