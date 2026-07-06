/**
 * resolveDraftChatContext — draft-aware project/adapter/chat resolution for the
 * composer's skills, agents and file pickers.
 *
 * Regression: before the first send a `__LOCALID_*` thread has no daemon chat, so
 * the controller's `chatConfig` is null and the pickers came up EMPTY (they only
 * read chatConfig). The in-memory draft already knows the project/adapter — fall
 * back to it so the pickers populate on a fresh thread.
 */
import { describe, it, expect } from 'vitest';
import type { DraftCfg } from '@/features/sessions/runtime/draft-config';
import { resolveDraftChatContext } from '../resolve-draft-chat-context';

const DRAFT: DraftCfg = { projectId: 'proj-draft', adapterId: 'claude' };

describe('resolveDraftChatContext', () => {
  it('prefers the live chatConfig when a real chat exists (draft ignored)', () => {
    const ctx = resolveDraftChatContext('chat-1', { projectId: 'proj-real', adapterId: 'codex' }, DRAFT);
    expect(ctx).toEqual({
      projectId: 'proj-real',
      adapterId: 'codex',
      fileChatId: 'chat-1',
      isLocalDraft: false,
    });
  });

  it('falls back to the draft project + adapter for a __LOCALID_* thread with no chatConfig', () => {
    const ctx = resolveDraftChatContext('__LOCALID_7', null, DRAFT);
    expect(ctx.projectId).toBe('proj-draft');
    expect(ctx.adapterId).toBe('claude');
    expect(ctx.isLocalDraft).toBe(true);
  });

  it('never scopes file lookups to a not-yet-created draft (fileChatId is null)', () => {
    const ctx = resolveDraftChatContext('__LOCALID_7', null, DRAFT);
    // A __LOCALID_* placeholder is not a real daemon chat id — don't pass it to the
    // worktree-scoped file API; a draft has no worktree, so search the project root.
    expect(ctx.fileChatId).toBeNull();
  });

  it('yields nulls for a draft with no stashed config yet', () => {
    const ctx = resolveDraftChatContext('__LOCALID_7', null, undefined);
    expect(ctx.projectId).toBeNull();
    expect(ctx.adapterId).toBeNull();
    expect(ctx.isLocalDraft).toBe(true);
  });

  it('does not treat a non-local id with a transiently-missing chatConfig as a draft', () => {
    // Existing chat still loading its config from REST: not a local draft, no draft fallback.
    const ctx = resolveDraftChatContext('chat-1', null, undefined);
    expect(ctx.isLocalDraft).toBe(false);
    expect(ctx.projectId).toBeNull();
    expect(ctx.fileChatId).toBe('chat-1');
  });

  it('returns nulls when there is no active thread at all', () => {
    const ctx = resolveDraftChatContext(null, null, undefined);
    expect(ctx).toEqual({ projectId: null, adapterId: null, fileChatId: null, isLocalDraft: false });
  });
});
