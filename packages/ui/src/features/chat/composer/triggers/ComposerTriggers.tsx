'use client';

/**
 * Wires our own trigger engine (`@/components/trigger-engine`) into the
 * composer:
 *   `/` — skills picker (sync, preloaded via SkillsProvider)
 *   `@` — desktop-parity mention picker (agents + project files fuzzy;
 *         `@dir/` project-tree + `@/`,`@~` filesystem drill-down) via an
 *         async-over-sync cache.
 *
 * The suggestion list itself is a portalled popover anchored to the composer
 * (`TriggerFieldPopover`), not a composer sibling — in flow it would grow the
 * thread's sticky viewport footer and push thread content up.
 *
 * `Unstable_TriggerPopoverRoot` is kept mounted with NO `<TP>` children —
 * purely so assistant-ui's `ComposerInputPluginProvider` exists (it's the
 * only public mounter of that registry). Our own field's
 * `{handleKeyDown, setCursorPosition}` is registered into that same registry,
 * so `ComposerPrimitive.Input` routes keys/cursor to it exactly as it would
 * to a native `<TP>`.
 */

import { useEffect, useMemo, type ReactNode, type RefObject } from 'react';
import { ComposerPrimitive, INTERNAL, useAui, useAuiState } from '@assistant-ui/react';
import { useChatExtras } from '../../runtime/use-chat-thread-runtime';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import { useChatSkills, useChatAgents } from '@/features/skills/use-chat-skills';
import { useDraftConfig } from '@/features/sessions/runtime/draft-config';
import { resolveDraftChatContext } from './resolve-draft-chat-context';
import { useSessionMentionSource } from '../sessions/use-session-mention-source';
import { createSessionInsertion, sessionItemGlyph, sessionItemTestId } from '../sessions/session-trigger-wiring';
import { searchFiles, getFileTree, browseFilesystem } from '@/lib/api/files';
import { buildSkillsTriggerAdapter } from './skills-trigger-adapter';
import { createMentionCache } from './mention-adapter';
import { useMentionTriggerAdapter } from './use-mention-trigger-adapter';
import {
  literalDirectiveFormatter,
  mentionDirectiveFormatter,
  shouldCloseTriggerOnInsert,
} from './directive-formatter';
import { useTriggerField, type TriggerField } from '@/components/trigger-engine/use-trigger-field';
import { TriggerFieldPopover } from '@/components/trigger-engine/TriggerFieldPopover';
import type { TriggerConfig } from '@/components/trigger-engine/types';
import { TriggerFieldAriaProvider } from './trigger-field-aria-context';

/**
 * Builds the `/` skills and `@` mention trigger configs for the active chat,
 * plus the callback that re-asks the daemon which sessions are referenceable.
 */
function useComposerTriggerConfigs(): { triggers: TriggerConfig[]; refreshSessions: () => void } {
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
  const skillsAdapter = useMemo(() => buildSkillsTriggerAdapter(skills), [skills]);

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

  const sessions = useSessionMentionSource({ port, projectId, activeChatId });
  const mentionAdapter = useMentionTriggerAdapter(mentionCache, agents, sessions.items);

  // The reference store and `useSubmitComposition` must key on the SAME id —
  // the aui thread item id, not the daemon chat id — or every reference line is
  // dropped at send.
  const threadId = useActiveThreadId() ?? null;
  const insertion = useMemo(
    () => createSessionInsertion({ threadId, pathByChatId: sessions.pathByChatId }),
    [threadId, sessions.pathByChatId],
  );

  const triggers = useMemo(
    () => [
      {
        char: '/',
        adapter: skillsAdapter,
        formatter: literalDirectiveFormatter('/'),
        itemTestIdPrefix: 'composer-skill-item',
      },
      {
        char: '@',
        adapter: mentionAdapter,
        formatter: mentionDirectiveFormatter(insertion.resolveSessionLabel),
        itemTestIdPrefix: 'composer-file-item',
        itemTestId: sessionItemTestId,
        itemGlyph: sessionItemGlyph,
        onInserted: insertion.onInserted,
        closeOnInsert: shouldCloseTriggerOnInsert,
      },
    ],
    [skillsAdapter, mentionAdapter, insertion],
  );

  return { triggers, refreshSessions: sessions.refresh };
}

/**
 * Registers the field's key/cursor handling into assistant-ui's composer-input
 * plugin registry — the same seam `ComposerPrimitive.Input` uses for a native
 * `<TP>`. `field.handleKeyDown`/`setCursorPosition` are referentially stable
 * (see `useTriggerField`), so this registers once and never churns.
 *
 * Must be rendered as a CHILD of `Unstable_TriggerPopoverRoot`, not inline in
 * the component that mounts it: a component's own hooks run before the JSX it
 * returns is committed, so calling this in that parent would look for the
 * registry context one level too high and always see `null`.
 */
function ComposerInputPluginBridge({ field }: { field: TriggerField }) {
  const registry = INTERNAL.useComposerInputPluginRegistryOptional();
  useEffect(() => {
    if (!registry) {
      // An assistant-ui bump that renames this INTERNAL export takes `/` and `@`
      // out of the composer with no other symptom — say so rather than no-op.
      console.warn('[composer-triggers] assistant-ui composer-input plugin registry missing — / and @ are disabled');
      return;
    }
    return registry.register({ handleKeyDown: field.handleKeyDown, setCursorPosition: field.setCursorPosition });
  }, [registry, field.handleKeyDown, field.setCursorPosition]);
  return null;
}

export function ComposerTriggers({
  children,
  textareaRef,
}: {
  children: ReactNode;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const { triggers, refreshSessions } = useComposerTriggerConfigs();
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const field = useTriggerField({
    value: text,
    onChange: (next) => aui.composer().setText(next),
    triggers,
    textareaRef,
  });

  // Re-ask on open, not per keystroke: a session started since the last read
  // becomes offerable, and one whose transcript was deleted stops being.
  const triggerChar = field.trigger?.char;
  useEffect(() => {
    if (field.open && triggerChar === '@') refreshSessions();
  }, [field.open, triggerChar, refreshSessions]);

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerInputPluginBridge field={field} />
      {/* Outside TriggerFieldPopover's PopoverAnchor slot on purpose — that slot
          clones props onto its single child for Radix's anchor measurement, and
          a context provider isn't a forwardable DOM element. */}
      <TriggerFieldAriaProvider value={field.ariaProps}>
        <TriggerFieldPopover field={field} testId="composer-trigger-popover">
          {children}
        </TriggerFieldPopover>
      </TriggerFieldAriaProvider>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}
