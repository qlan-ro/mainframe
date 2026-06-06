'use client';

/**
 * Wires both native trigger popovers into the composer:
 *   `/` — skills picker (sync, preloaded via SkillsProvider)
 *   `@` — file picker (async-over-sync, debounced fetch into a local cache)
 *
 * Both triggers use a literal directive formatter so the inserted text is plain
 * `/skill-name ` / `@rel/path ` — the CLI/daemon parses those, no chip tokens.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ComposerPrimitive } from '@assistant-ui/react';
import type { Unstable_TriggerItem } from '@assistant-ui/react';
import { useChatExtras } from '../../runtime/use-chat-thread-runtime';
import { useChatSkills } from '@/features/skills/use-chat-skills';
import { searchFiles } from '@/lib/api/files';
import { buildSkillsTriggerAdapter } from './skills-trigger-adapter';
import { createFileSearchCache, buildFileTriggerAdapter } from './file-trigger-adapter';
import { literalDirectiveFormatter } from './directive-formatter';

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
 * Reads the live `@` query, debounces it, and calls `cache.request(q)` so the
 * async fetch is kicked off. Rendered as a child of the `@` `<TP>`, so
 * `unstable_useTriggerPopoverScopeContext` resolves to the `@` trigger's scope.
 */
function FileSearchDriver({ cache }: { cache: ReturnType<typeof createFileSearchCache> }) {
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

  // Skills adapter: rebuilt only when the skills list changes.
  const skillsAdapter = useMemo(() => buildSkillsTriggerAdapter(skills), [skills]);

  // Force re-render counter — incremented by the cache's onChange subscriber so
  // newly-fetched file results flow into the popover without a full remount.
  const [, forceUpdate] = useState(0);

  // File search cache: rebuilt when the chat context changes.
  const fileCache = useMemo(
    () =>
      createFileSearchCache((q) =>
        port != null && projectId != null ? searchFiles(port, projectId, q, chatId ?? undefined) : Promise.resolve([]),
      ),
    [port, projectId, chatId],
  );

  // Subscribe to cache changes so the popover re-renders when results land.
  useEffect(() => fileCache.subscribe(() => forceUpdate((n) => n + 1)), [fileCache]);

  const fileAdapter = useMemo(() => buildFileTriggerAdapter(fileCache), [fileCache]);

  const slashFmt = useMemo(() => literalDirectiveFormatter('/'), []);
  const atFmt = useMemo(() => literalDirectiveFormatter('@'), []);

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      {/* `/` skills trigger */}
      <TP char="/" adapter={skillsAdapter}>
        <TP.Directive formatter={slashFmt} />
        <PopoverShell>
          <ComposerPrimitive.Unstable_TriggerPopoverItems>
            {(items) => items.map((it) => <ItemRow key={it.id} item={it} testidPrefix="composer-skill-item" />)}
          </ComposerPrimitive.Unstable_TriggerPopoverItems>
        </PopoverShell>
      </TP>

      {/* `@` file trigger */}
      <TP char="@" adapter={fileAdapter}>
        <TP.Directive formatter={atFmt} />
        <FileSearchDriver cache={fileCache} />
        <PopoverShell>
          <ComposerPrimitive.Unstable_TriggerPopoverItems>
            {(items) => items.map((it) => <ItemRow key={it.id} item={it} testidPrefix="composer-file-item" />)}
          </ComposerPrimitive.Unstable_TriggerPopoverItems>
        </PopoverShell>
      </TP>

      {children}
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}
