'use client';

/**
 * Wires both native trigger popovers into the composer:
 *   `/` — skills picker (sync, preloaded via SkillsProvider)
 *   `@` — desktop-parity mention picker (agents + project files fuzzy;
 *         `@dir/` project-tree + `@/`,`@~` filesystem drill-down) via an
 *         async-over-sync cache.
 *
 * `/` inserts plain `/skill `; `@` inserts `@<id> ` for files/agents and
 * `@<dir>/` (no space, keeps the token open) for directories — drill-down.
 * The single trailing space comes from assistant-ui's own native insertion,
 * not our formatters (see directive-formatter.ts) — never add one there too.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ComposerPrimitive, useAui } from '@assistant-ui/react';
import type { Unstable_TriggerItem } from '@assistant-ui/react';
import { useChatExtras } from '../../runtime/use-chat-thread-runtime';
import { useChatSkills, useChatAgents } from '@/features/skills/use-chat-skills';
import { useDraftConfig } from '@/features/sessions/runtime/draft-config';
import { resolveDraftChatContext } from './resolve-draft-chat-context';
import { searchFiles, getFileTree, browseFilesystem } from '@/lib/api/files';
import { buildSkillsTriggerAdapter } from './skills-trigger-adapter';
import { createMentionCache, buildMentionTriggerAdapter, type MentionCache } from './mention-adapter';
import {
  literalDirectiveFormatter,
  mentionDirectiveFormatter,
  dropDirectoryClosingSpace,
  shouldCloseTriggerOnInsert,
} from './directive-formatter';

// ---------------------------------------------------------------------------
// Alias for brevity
// ---------------------------------------------------------------------------

const TP = ComposerPrimitive.Unstable_TriggerPopover;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ItemRow({ item, testidPrefix }: { item: Unstable_TriggerItem; testidPrefix: string }) {
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverItem
      item={item}
      data-testid={`${testidPrefix}-${item.id}`}
      className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left
                 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
    >
      <span className="font-medium text-foreground">{item.label}</span>
      {item.description != null && <span className="text-caption text-muted-foreground">{item.description}</span>}
    </ComposerPrimitive.Unstable_TriggerPopoverItem>
  );
}

function PopoverShell({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="composer-trigger-popover"
      className="z-50 max-h-64 w-80 overflow-auto rounded-xl border border-border bg-popover p-1 shadow-md"
    >
      {children}
    </div>
  );
}

/**
 * Reads the live `@` token body, debounces it, and calls `cache.request(body)`
 * so the right async fetch (file search / project tree / filesystem browse) is
 * kicked off. Rendered as a child of the `@` `<TP>`, so
 * `unstable_useTriggerPopoverScopeContext` resolves to the `@` trigger's scope.
 */
function MentionDriver({ cache }: { cache: MentionCache }) {
  const { query } = ComposerPrimitive.unstable_useTriggerPopoverScopeContext();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      cache.request(query);
    }, 150);
    return () => {
      if (timer.current != null) clearTimeout(timer.current);
    };
  }, [query, cache]);

  return null;
}

/**
 * Captures the parent `<TP>`'s scope `close()` into a ref so `onInserted` (a
 * plain callback, not a hook — it can't call `unstable_useTriggerPopoverScopeContext`
 * itself) can force-close the popover after a pick. Mirrors the library's own
 * Escape-key path (`triggerSelectionResource`'s `close()`, which resets the
 * category nav AND moves the tracked cursor position back to the trigger's
 * start offset — the same thing `detectTrigger` needs to stop matching).
 * Rendered as a child of `<TP>` so the scope resolves to that trigger.
 */
function TriggerCloseCapture({ closeRef }: { closeRef: { current: (() => void) | null } }) {
  const { close } = ComposerPrimitive.unstable_useTriggerPopoverScopeContext();
  closeRef.current = close;
  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ComposerTriggers({ children }: { children: ReactNode }) {
  const extras = useChatExtras();
  const port = extras?.port ?? null;
  const activeChatId = extras?.state.chatId ?? null;
  const chatConfig = extras?.state.chatConfig ?? null;
  // Draft-aware: before the first send a __LOCALID_* thread has no daemon chat, so
  // fall back to the draft's project (fileChatId stays null — a draft has no
  // worktree) so `@` file search works on a fresh thread. See resolveDraftChatContext.
  const draft = useDraftConfig(activeChatId != null && chatConfig == null ? activeChatId : null);
  const { projectId, fileChatId: chatId } = resolveDraftChatContext(activeChatId, chatConfig, draft);

  const { skills } = useChatSkills();
  const agents = useChatAgents();

  // Skills adapter: rebuilt only when the skills list changes.
  const skillsAdapter = useMemo(() => buildSkillsTriggerAdapter(skills), [skills]);

  // Mention cache (files / project-tree / filesystem): rebuilt when the chat context changes.
  const mentionCache = useMemo(
    () =>
      createMentionCache({
        searchFiles: (q) =>
          port != null && projectId != null
            ? searchFiles(port, projectId, q, chatId ?? undefined)
            : Promise.resolve([]),
        getFileTree: (dir) =>
          port != null && projectId != null
            ? getFileTree(port, projectId, dir, chatId ?? undefined)
            : Promise.resolve([]),
        browseFilesystem: (dir) =>
          port != null ? browseFilesystem(port, dir, { includeFiles: true, includeHidden: true }) : Promise.resolve([]),
      }),
    [port, projectId, chatId],
  );

  // Bump a version counter every time the cache emits so the mentionAdapter memo
  // deps change, forcing a new adapter reference and invalidating the native
  // trigger memo that memoizes adapter.search(query) on [open, adapter, query].
  const [version, bump] = useState(0);
  useEffect(() => mentionCache.subscribe(() => bump((n) => n + 1)), [mentionCache]);

  // agents merge into fuzzy results → rebuild when agents change too.
  const mentionAdapter = useMemo(
    () => buildMentionTriggerAdapter(mentionCache, agents),
    [mentionCache, agents, version],
  );

  const slashFmt = useMemo(() => literalDirectiveFormatter('/'), []);
  const atFmt = useMemo(() => mentionDirectiveFormatter(), []);

  // The native popover always appends a closing space on accept; for a DIRECTORY
  // that ends the `@` token and breaks drill-down. After insertion, drop that
  // trailing space so the token stays open and the popover re-lists the folder.
  const aui = useAui();
  const keepDirectoryTokenOpen = (item: Unstable_TriggerItem) => {
    if (item.type !== 'directory') return;
    const composer = aui.composer();
    // `composer.getState()` is a tap-memoized snapshot that only refreshes on
    // the NEXT render; reading it here — synchronously, in the same tick as the
    // native insertion's own `setText` call — returns the PRE-insertion text
    // (a stale read), so the trailing-space strip below silently no-ops and
    // the space leaks through. `__internal_getRuntime()` reaches the raw
    // ComposerRuntimeCore, whose `getState()` is always live; it's `?`-typed by
    // assistant-ui itself (unstable escape hatch) but always present for a
    // thread composer, so fall back to the (stale-safe) client read if absent.
    const runtime = composer.__internal_getRuntime?.();
    const text = runtime ? runtime.getState().text : composer.getState().text;
    const next = dropDirectoryClosingSpace(text, item.id);
    if (next !== text) composer.setText(next);
  };

  // Force-closes the popover after a non-directory pick (file/agent/skill) —
  // the native `selectItem` never re-syncs the tracked cursor position after a
  // MOUSE click (only real typing/onSelect DOM events do), so `detectTrigger`
  // keeps matching the old token and the popover never closes on its own. Reuse
  // the library's own Escape-key mechanism (`close()`) instead of reimplementing it.
  const skillsCloseRef = useRef<(() => void) | null>(null);
  const mentionCloseRef = useRef<(() => void) | null>(null);

  const onSkillInserted = () => skillsCloseRef.current?.();
  const onMentionInserted = (item: Unstable_TriggerItem) => {
    if (shouldCloseTriggerOnInsert(item)) {
      mentionCloseRef.current?.();
      return;
    }
    keepDirectoryTokenOpen(item);
  };

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      {/* `/` skills trigger. PopoverShell renders INSIDE the items render-prop so
          the bordered box only appears when there are results (no empty shell). */}
      <TP char="/" adapter={skillsAdapter}>
        <TP.Directive formatter={slashFmt} onInserted={onSkillInserted} />
        <TriggerCloseCapture closeRef={skillsCloseRef} />
        <ComposerPrimitive.Unstable_TriggerPopoverItems>
          {(items) =>
            items.length === 0 ? null : (
              <PopoverShell>
                {items.map((it) => (
                  <ItemRow key={it.id} item={it} testidPrefix="composer-skill-item" />
                ))}
              </PopoverShell>
            )
          }
        </ComposerPrimitive.Unstable_TriggerPopoverItems>
      </TP>

      {/* `@` mention trigger (agents + files + tree/filesystem drill-down) */}
      <TP char="@" adapter={mentionAdapter}>
        <TP.Directive formatter={atFmt} onInserted={onMentionInserted} />
        <TriggerCloseCapture closeRef={mentionCloseRef} />
        <MentionDriver cache={mentionCache} />
        <ComposerPrimitive.Unstable_TriggerPopoverItems>
          {(items) =>
            items.length === 0 ? null : (
              <PopoverShell>
                {items.map((it) => (
                  <ItemRow key={it.id} item={it} testidPrefix="composer-file-item" />
                ))}
              </PopoverShell>
            )
          }
        </ComposerPrimitive.Unstable_TriggerPopoverItems>
      </TP>

      {children}
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}
