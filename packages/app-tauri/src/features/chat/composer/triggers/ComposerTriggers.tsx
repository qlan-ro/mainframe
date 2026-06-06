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
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ComposerPrimitive } from '@assistant-ui/react';
import type { Unstable_TriggerItem } from '@assistant-ui/react';
import { useChatExtras } from '../../runtime/use-chat-thread-runtime';
import { useChatSkills, useChatAgents } from '@/features/skills/use-chat-skills';
import { searchFiles, getFileTree, browseFilesystem } from '@/lib/api/files';
import { buildSkillsTriggerAdapter } from './skills-trigger-adapter';
import { createMentionCache, buildMentionTriggerAdapter, type MentionCache } from './mention-adapter';
import { literalDirectiveFormatter, mentionDirectiveFormatter } from './directive-formatter';

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
      {item.description != null && <span className="text-xs text-muted-foreground">{item.description}</span>}
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

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ComposerTriggers({ children }: { children: ReactNode }) {
  const extras = useChatExtras();
  const port = extras?.port ?? null;
  const projectId = extras?.state.chatConfig?.projectId ?? null;
  const chatId = extras?.state.chatId ?? null;

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

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      {/* `/` skills trigger. PopoverShell renders INSIDE the items render-prop so
          the bordered box only appears when there are results (no empty shell). */}
      <TP char="/" adapter={skillsAdapter}>
        <TP.Directive formatter={slashFmt} />
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
        <TP.Directive formatter={atFmt} />
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
