import path from 'node:path';
import { resolveSkillPath, resolveExistingSkillPath, readSkillContent } from './skill-path.js';
import type { MessageContent, SessionSink } from '@qlan-ro/mainframe-types';
import type { ClaudeSession } from './session.js';
import { buildToolResultBlocks, extractToolResultContent } from './history.js';
import { shouldScanToolResultForPr, extractPrFromToolResult } from './pr-detection.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('claude:user-event');

/**
 * Extract a skill_loaded block from a text block when it carries the CLI's
 * skill-injection markers. Returns null when the text isn't a skill injection.
 *
 * Two shapes:
 *   (A) <skill-format>true</skill-format> — model-initiated SkillTool output + subagent preloads
 *   (B) Text starting with "Base directory for this skill: <path>" — user-typed /skill-name
 */
function extractSkillBlock(
  text: string,
  session: ClaudeSession,
  parentToolUseId?: string,
): (import('@qlan-ro/mainframe-types').MessageContent & { type: 'skill_loaded' }) | null {
  const hasSkillFormat = text.includes('<skill-format>true</skill-format>');
  const baseDirMatch = /^Base directory for this skill:\s*(.+?)(?:\n|$)/m.exec(text);
  if (!hasSkillFormat && !baseDirMatch) return null;

  const nameFromTag = /<command-name>([^<]+)<\/command-name>/.exec(text)?.[1]?.replace(/^\//, '').trim();
  const rawDir = baseDirMatch?.[1]?.trim() ?? '';
  const skillName = nameFromTag || (rawDir ? path.basename(rawDir) : '');
  if (!skillName) return null;

  const resolvedPath = rawDir && !path.extname(rawDir) ? path.join(rawDir, 'SKILL.md') : rawDir;
  const finalPath = resolvedPath || resolveSkillPath(session.projectPath, skillName, session.state.skillPathCache);
  session.state.skillPathCache.set(skillName, finalPath);

  const content = text
    .replace(/<command-message>[^<]*<\/command-message>\n?/g, '')
    .replace(/<command-name>[^<]*<\/command-name>\n?/g, '')
    .replace(/<skill-format>[^<]*<\/skill-format>\n?/g, '')
    .replace(/^Base directory for this skill:[^\n]*\n?/m, '')
    .trim();

  return parentToolUseId
    ? { type: 'skill_loaded', skillName, path: finalPath, content, parentToolUseId }
    : { type: 'skill_loaded', skillName, path: finalPath, content };
}

function handleSubagentUserEvent(
  session: ClaudeSession,
  event: Record<string, unknown>,
  parentToolUseId: string,
  message: { content: Array<Record<string, unknown>> | string },
  sink: SessionSink,
): void {
  const collected: import('@qlan-ro/mainframe-types').MessageContent[] = [];

  if (typeof message.content === 'string') {
    // Pre-normalize edge case (model-switch breadcrumbs etc.). Treat as text,
    // but if it's a `<command-name>...</command-name>` skill echo, surface as
    // a skill_loaded child instead.
    const nameMatch = /<command-name>\/?([^<]+)<\/command-name>/.exec(message.content);
    if (nameMatch?.[1]) {
      const skillName = nameMatch[1].trim();
      const cached = session.state.skillPathCache.get(skillName);
      const skillPath = cached ?? resolveExistingSkillPath(session.projectPath, skillName);
      if (skillPath) {
        session.state.skillPathCache.set(skillName, skillPath);
        const content = readSkillContent(skillPath) ?? '';
        collected.push({ type: 'skill_loaded', skillName, path: skillPath, content, parentToolUseId });
      } else {
        collected.push({ type: 'text', text: message.content, parentToolUseId });
      }
    } else {
      collected.push({ type: 'text', text: message.content, parentToolUseId });
    }
  } else {
    const tur = (event.tool_use_result ?? event.toolUseResult) as Record<string, unknown> | undefined;
    const toolResults = buildToolResultBlocks(message as Record<string, unknown>, tur);
    for (const r of toolResults) collected.push({ ...r, parentToolUseId });

    for (const block of message.content) {
      if (block.type === 'tool_result') continue; // already handled above
      if (block.type === 'text') {
        const text = (block.text as string) || '';
        if (!text.trim()) continue;
        // Skill-injection shape: surface as a skill_loaded child (inner pill).
        const skillBlock = extractSkillBlock(text, session, parentToolUseId);
        if (skillBlock) {
          collected.push(skillBlock);
          continue;
        }
        collected.push({ type: 'text', text, parentToolUseId });
      }
      // Image blocks intentionally skipped — same as the existing parent-level path.
    }
  }

  if (collected.length > 0) sink.onSubagentChild(parentToolUseId, collected);
}

// Canonical preamble the CLI prepends to the synthesized post-compaction
// "continuation" user message. Used as a defensive fallback when the
// `isCompactSummary` / `isVisibleInTranscriptOnly` flags are missing —
// e.g. older CLI versions or third-party SDK shims that drop them.
const COMPACT_SUMMARY_PREAMBLE = 'This session is being continued from a previous conversation that ran out of context';

export function handleUserEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  // Drop the post-compaction continuation user message — the CLI emits it to
  // seed the new context with the prior conversation summary, but Mainframe
  // already shows a CompactionPill, so the raw text becomes a giant pill
  // containing the whole summary (#150). Filter strictly on `isCompactSummary`;
  // `isVisibleInTranscriptOnly` is broader and may apply to entries we want
  // to render, so we don't use it here. The string-content branch below also
  // matches against the canonical preamble as a defensive fallback for CLI
  // versions / SDK shims that drop the flag.
  if (event.isCompactSummary === true) return;

  // Detect queued message processed by CLI (isReplay from SDK mode).
  // The uuid identifying the original user message can land in any of three
  // places depending on CLI version and event shape:
  //   - event.uuid              (stream-json entry-level)
  //   - event.message.uuid      (some SDK builds)
  //   - event.message.id        (when treated as a regular Anthropic message id)
  // Reading only event.uuid leaves a stranded queued flag in the cache when
  // the CLI uses one of the other shapes — see issue #147.
  const isReplay = event.isReplay === true || event.is_replay === true;
  const messageObj = event.message as { uuid?: string; id?: string } | undefined;
  const uuid = (event.uuid as string) || messageObj?.uuid || messageObj?.id || undefined;
  if (isReplay && uuid) {
    sink.onQueuedProcessed(uuid);
  } else if (isReplay) {
    log.warn(
      { sessionId: session.id, eventKeys: Object.keys(event) },
      'isReplay user event without recognizable uuid — queued flag may strand',
    );
  }

  // Live stream handles ONLY tool_result blocks from user events.
  // Text blocks in user entries are ignored when isReplay (user-typed text already created
  // by chat-manager.sendMessage()) or when isMeta (CLI-internal command wrappers like
  // <local-command-caveat>). Text blocks that are neither are CLI-synthesized feedback
  // messages (e.g. "Unknown command: /foo. Did you mean /bar?") and ARE surfaced.
  // Image blocks: not surfaced in live mode (no UX for them).
  // History loading (convertUserEntry) reconstructs these from JSONL since it
  // has no sendMessage() counterpart. See docs/plans/2026-02-17-unified-event-pipeline.md.
  // TODO(task-support): handle <task-notification> string content as TaskGroupCard
  const isMeta = event.isMeta === true || event.is_meta === true;
  const message = event.message as { content: Array<Record<string, unknown>> | string } | undefined;
  if (!message?.content) return;

  // Subagent activity: every block in this event belongs inside the parent's
  // Agent/Task tool_use card. Tag each block with parentToolUseId and forward
  // via onSubagentChild — the event-handler appends them to the parent's
  // assistant message and the display pipeline groups them under _TaskGroup.
  if (typeof event.parent_tool_use_id === 'string' && event.parent_tool_use_id) {
    handleSubagentUserEvent(session, event, event.parent_tool_use_id, message, sink);
    return;
  }

  // User-typed /skill-name path: the CLI emits a string-content metadata
  // event (<command-message>+<command-name>) over stream-json, but it writes
  // the isMeta:true skill-content to JSONL only — stream-json never shows
  // the skill body. Detect here from the <command-name> XML and read the
  // SKILL.md off disk ourselves so the card renders live.
  if (typeof message.content === 'string') {
    const nameMatch = /<command-name>\/?([^<]+)<\/command-name>/.exec(message.content);
    if (nameMatch?.[1]) {
      const skillName = nameMatch[1].trim();
      const cached = session.state.skillPathCache.get(skillName);
      const skillPath = cached ?? resolveExistingSkillPath(session.projectPath, skillName);
      if (skillPath) {
        session.state.skillPathCache.set(skillName, skillPath);
        const content = readSkillContent(skillPath) ?? '';
        sink.onSkillLoaded({ skillName, path: skillPath, content });
        sink.onSkillFile({ path: skillPath, displayName: skillName });
      }
      return;
    }

    // Any other string-content user event is CLI feedback that doesn't belong
    // to a skill/command echo — e.g. "Unknown command: /foo". Surface it as a
    // system pill so the user sees why their input had no effect. The user's
    // original text already exists as a transient from chat-manager.sendMessage.
    if (!isReplay && !isMeta) {
      const trimmed = message.content.trim();
      // Defensive: catch post-compaction continuation messages whose flags
      // were stripped by the CLI/SDK (see COMPACT_SUMMARY_PREAMBLE).
      if (trimmed && !trimmed.startsWith(COMPACT_SUMMARY_PREAMBLE)) {
        sink.onCliMessage(trimmed);
      }
    }
    return;
  }

  // Stream-json uses snake_case; JSONL uses camelCase
  const tur = (event.tool_use_result ?? event.toolUseResult) as Record<string, unknown> | undefined;

  // Use shared builder — same logic as convertUserEntry in claude-history.ts
  const toolResultContent: MessageContent[] = buildToolResultBlocks(message as Record<string, unknown>, tur);

  if (toolResultContent.length > 0) {
    sink.onToolResult(toolResultContent);
  }

  for (const block of message.content) {
    if (block.type === 'tool_result') {
      // tool_result.content is a string for Bash and most tools, but an array
      // of typed blocks for Agent (Task) subagent results — flatten both.
      const text = extractToolResultContent(block.content);
      const toolUseId = block.tool_use_id as string | undefined;
      const meta = toolUseId ? session.state.toolUseRegistry.get(toolUseId) : undefined;
      const planMatch = text.match(/Your plan has been saved to: (\/\S+\.md)/);
      if (planMatch?.[1]) {
        sink.onPlanFile(planMatch[1].trim());
      }
      // Path A — gated by originating tool. Without this gate, a Read/Grep/Edit
      // of any file containing a PR URL would falsely tag this chat with that PR.
      if (shouldScanToolResultForPr(meta)) {
        const pr = extractPrFromToolResult(text);
        if (pr) {
          const source = toolUseId && session.state.pendingPrCreates.has(toolUseId) ? 'created' : 'mentioned';
          if (source === 'created') session.state.pendingPrCreates.delete(toolUseId!);
          sink.onPrDetected({ ...pr, source });
        }
      }

      // Path B: command-arg-based mutation detection. Consume any pending stash
      // keyed by this tool_use_id, regardless of whether the output contained a URL.
      if (toolUseId && session.state.pendingPrMutations.has(toolUseId)) {
        const stashed = session.state.pendingPrMutations.get(toolUseId)!;
        session.state.pendingPrMutations.delete(toolUseId);
        if (block.is_error !== true) {
          sink.onPrDetected({ ...stashed, source: 'mentioned' });
        }
      }
      if (toolUseId) session.state.toolUseRegistry.delete(toolUseId);
    } else if (block.type === 'text') {
      const text = (block.text as string) || '';
      if (!text.trim()) continue;

      // Skill injection — must be checked regardless of isReplay/isMeta.
      // The CLI marks the skill-content user message as isMeta: true for
      // user-typed /skill-name (processSlashCommand.tsx:905-907), so
      // filtering isMeta out first would miss it entirely.
      //
      // Two shapes:
      //   (A) <skill-format>true</skill-format> — model-initiated SkillTool
      //       output + subagent preloads
      //   (B) Text starting with "Base directory for this skill: <path>" —
      //       user-typed /skill-name injection (isMeta: true, no XML tag)
      const skillBlock = extractSkillBlock(text, session);
      if (skillBlock) {
        sink.onSkillLoaded({ skillName: skillBlock.skillName, path: skillBlock.path, content: skillBlock.content });
        sink.onSkillFile({ path: skillBlock.path, displayName: skillBlock.skillName });
        continue;
      }

      // CLI-synthesized feedback (e.g. unknown-command errors, notices).
      // Discriminator: not a replay of user-typed text AND not a CLI meta wrapper.
      //
      // Additional suppress list — CLI-internal notifications that Mainframe
      // either already handles via its own UI (interrupts, permissions) or that
      // carry context for the model, not the user:
      //   • <local-command-stdout|stderr|caveat> wrappers (e.g. /model reply)
      //   • "[Request interrupted by user]" /
      //     "[Request interrupted by user for tool use]"
      //     (Claude source: utils/messages.ts:207-209)
      if (!isReplay && !isMeta) {
        const trimmed = text.trim();
        const isLocalCommandWrapper =
          /^<local-command-(?:stdout|stderr|caveat)>[\s\S]*<\/local-command-(?:stdout|stderr|caveat)>\s*$/.test(
            trimmed,
          );
        const isInterruptMarker = /^\[Request interrupted by user[^\]]*\]\s*$/.test(trimmed);
        const isCompactPreamble = trimmed.startsWith(COMPACT_SUMMARY_PREAMBLE);
        if (!isLocalCommandWrapper && !isInterruptMarker && !isCompactPreamble) {
          sink.onCliMessage(trimmed);
        }
      }
    }
  }
}
