import path from 'node:path';
import { resolveSkillPath, resolveExistingSkillPath, readSkillContent } from './skill-path.js';
import type {
  ContextUsage,
  ControlRequest,
  ControlUpdate,
  MessageContent,
  SessionSink,
} from '@qlan-ro/mainframe-types';
import type { ClaudeSession } from './session.js';
import { buildToolResultBlocks, extractToolResultContent } from './history.js';
import {
  isPrCreateCommand,
  isPrMutationCommand,
  parsePrIdentifierFromArgs,
  shouldScanToolResultForPr,
  extractPrFromToolResult,
} from './pr-detection.js';
import { createChildLogger } from '../../../logger.js';
import { normalizeTodos } from '../../../todos/normalize.js';

const log = createChildLogger('claude:events');

export function handleStdout(session: ClaudeSession, chunk: Buffer, sink: SessionSink): void {
  session.state.buffer += chunk.toString();
  const lines = session.state.buffer.split('\n');
  session.state.buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    session.state.lastActivityAt = Date.now();
    log.trace({ sessionId: session.id, line }, '[stream-json]');
    try {
      const event = JSON.parse(line.trim());
      handleEvent(session, event, sink);
    } catch {
      // Not JSON, skip
    }
  }
}

const INFORMATIONAL_PATTERNS = [
  /^Debugger/i,
  /^Warning:/i,
  /^DeprecationWarning/i,
  /^ExperimentalWarning/i,
  /^\(node:\d+\)/,
  /^Cloning into/,
];

export function handleStderr(_session: ClaudeSession, chunk: Buffer, sink: SessionSink): void {
  const message = chunk.toString().trim();
  if (!message) return;
  if (INFORMATIONAL_PATTERNS.some((p) => p.test(message))) return;
  sink.onError(new Error(message));
}

function handleSystemEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  if (event.subtype === 'init') {
    session.state.chatId = event.session_id as string;
    session.state.status = 'ready';
    sink.onInit(event.session_id as string);
  } else if (event.subtype === 'compact_boundary') {
    sink.onCompact();
  } else if (event.subtype === 'task_started') {
    session.state.activeTasks.set(event.task_id as string, {
      type: event.task_type as string,
      command: event.command as string | undefined,
    });
    if (session.state.mainframeChatId) {
      session.state.taskEvents.handleTaskStarted(
        session.state.mainframeChatId,
        {
          task_id: event.task_id as string,
          tool_use_id: event.tool_use_id as string | undefined,
          description: event.description as string | undefined,
        },
        { claudeSessionId: session.state.chatId, realCwd: session.state.realProjectPath },
      );
    }
  } else if (event.subtype === 'task_notification') {
    session.state.activeTasks.delete(event.task_id as string);
    if (session.state.mainframeChatId) {
      const usage = event.usage as { total_tokens: number; tool_uses: number; duration_ms: number } | undefined;
      session.state.taskEvents.handleTaskNotification(session.state.mainframeChatId, {
        task_id: event.task_id as string,
        status: event.status as string,
        output_file: event.output_file as string | undefined,
        summary: event.summary as string | undefined,
        usage,
      });
    }
  } else if (event.subtype === 'status') {
    if (event.status === 'compacting') {
      sink.onCompactStart();
    }
  }
}

function handleAssistantEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  const message = event.message as {
    model?: string;
    content: MessageContent[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  if (message?.usage) {
    session.state.lastAssistantUsage = message.usage;
  }
  if (!message?.content) return;

  if (typeof event.parent_tool_use_id === 'string' && event.parent_tool_use_id) {
    const parentToolUseId = event.parent_tool_use_id;
    const tagged = message.content.map((b) => ({
      ...b,
      parentToolUseId,
    })) as import('@qlan-ro/mainframe-types').MessageContent[];
    sink.onSubagentChild(parentToolUseId, tagged);
    return;
  }

  for (const block of message.content) {
    if (block.type === 'tool_use') {
      if (block.name === 'TodoWrite') {
        const input = block.input as { todos?: unknown[] };
        if (Array.isArray(input?.todos)) {
          const valid = input.todos.filter(
            (t): t is import('@qlan-ro/mainframe-types').TodoItem =>
              typeof t === 'object' &&
              t !== null &&
              typeof (t as Record<string, unknown>).content === 'string' &&
              typeof (t as Record<string, unknown>).status === 'string',
          );
          if (valid.length > 0) sink.onTodoUpdate(valid);
        }
      }
      const taskV2Name = block.name as string;
      if (taskV2Name === 'TaskCreate' || taskV2Name === 'TaskUpdate' || taskV2Name === 'TaskStop') {
        handleTaskV2Event(session, taskV2Name as 'TaskCreate' | 'TaskUpdate' | 'TaskStop', block.input, sink);
      }
      const name = block.name as string;
      const id = block.id as string | undefined;
      if (id && name) {
        const command = (block.input as { command?: string } | undefined)?.command;
        session.state.toolUseRegistry.set(id, command ? { name, command } : { name });
        if (session.state.mainframeChatId) {
          session.state.taskEvents.captureToolUse(id, {
            name: block.name,
            input: block.input as { command?: string; description?: string; run_in_background?: boolean } | undefined,
          });
        }
      }
      if (name === 'Bash' || name === 'BashTool') {
        const input = block.input as { command?: string } | undefined;
        if (input?.command && isPrCreateCommand(input.command)) {
          session.state.pendingPrCreates.add(block.id as string);
        }
        if (input?.command && isPrMutationCommand(input.command)) {
          const pr = parsePrIdentifierFromArgs(input.command);
          if (pr) session.state.pendingPrMutations.set(block.id as string, pr);
        }
      }
      if (name === 'Skill') {
        const input = block.input as { skill?: string } | undefined;
        const skillName = input?.skill?.trim();
        if (skillName) {
          // Use the cached path from a prior user-event (more accurate), falling back to the probe.
          const cachedPath = session.state.skillPathCache.get(skillName);
          const resolvedPath =
            cachedPath ?? resolveSkillPath(session.projectPath, skillName, session.state.skillPathCache);
          sink.onSkillFile({ path: resolvedPath, displayName: skillName });
        }
      }
    }
  }

  sink.onMessage(message.content, {
    model: message.model,
    usage: message.usage,
  });
}

/**
 * Handle a V2 task event (TaskCreate/TaskUpdate/TaskStop), accumulating state
 * on the session and emitting onTodoUpdate with the current snapshot.
 */
function handleTaskV2Event(
  session: ClaudeSession,
  toolName: 'TaskCreate' | 'TaskUpdate' | 'TaskStop',
  input: Record<string, unknown>,
  sink: SessionSink,
): void {
  session.state.taskV2Events.push({ toolName, args: input });
  const todos = normalizeTodos('taskV2', session.state.taskV2Events);
  if (todos.length > 0) sink.onTodoUpdate(todos);
}

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

function handleUserEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
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

function handleControlRequestEvent(_session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  const request = event.request as Record<string, unknown>;
  if (request?.subtype === 'can_use_tool') {
    const permRequest: ControlRequest = {
      requestId: event.request_id as string,
      toolName: request.tool_name as string,
      toolUseId: request.tool_use_id as string,
      input: request.input as Record<string, unknown>,
      suggestions: (request.permission_suggestions as ControlUpdate[]) || [],
      decisionReason: request.decision_reason as string | undefined,
    };
    sink.onPermission(permRequest);
  } else {
    log.warn({ subtype: request?.subtype }, 'Unhandled control_request subtype');
  }
}

export function handleControlResponseEvent(
  session: ClaudeSession,
  event: Record<string, unknown>,
  sink: SessionSink,
): void {
  const response = event.response as Record<string, unknown> | undefined;
  if (!response) return;

  const innerData = response.response as Record<string, unknown> | undefined;
  if (innerData && typeof innerData.totalTokens === 'number' && typeof innerData.percentage === 'number') {
    const usage: ContextUsage = {
      totalTokens: innerData.totalTokens,
      maxTokens: (innerData.maxTokens as number) || 0,
      percentage: innerData.percentage,
    };
    sink.onContextUsage(usage);
  }

  // Route cancel_async_message responses to pending callbacks
  const requestId = (response.request_id as string) || undefined;
  const innerResponse = response.response as Record<string, unknown> | undefined;
  if (requestId && innerResponse && typeof innerResponse.cancelled === 'boolean') {
    const callback = session.state.pendingCancelCallbacks.get(requestId);
    if (callback) {
      session.state.pendingCancelCallbacks.delete(requestId);
      callback(innerResponse.cancelled);
    }
  }

  // Route stop_task responses to pending callbacks (mirrors cancel above)
  if (requestId && innerResponse && typeof innerResponse.subtype === 'string') {
    const stopCb = session.state.pendingStopTaskCallbacks.get(requestId);
    if (stopCb) {
      session.state.pendingStopTaskCallbacks.delete(requestId);
      if (innerResponse.subtype === 'success') {
        stopCb({ ok: true });
      } else {
        const errMsg = typeof innerResponse.error === 'string' ? innerResponse.error : 'unknown error';
        stopCb({ ok: false, error: errMsg });
      }
    }
  }
}

function handleResultEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  // Surface CLI slash-command errors that reach us only via the `result`
  // event. When `shouldQuery: false` (unknown /cmd, bad /cmd args), the CLI
  // filters the "Unknown skill: /X" user message out of stream-json
  // (QueryEngine.ts:556-605 only yields <local-command-stdout|stderr> entries)
  // but the error text survives on `result.result`. We forward it as a
  // system pill so the user sees why their input had no effect.
  const resultText = typeof event.result === 'string' ? event.result.trim() : '';
  if (resultText && /^Unknown (command|skill):/i.test(resultText)) {
    sink.onCliMessage(resultText);
  }

  const lastUsage = session.state.lastAssistantUsage;
  const usage =
    lastUsage ??
    (event.usage as
      | {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        }
      | undefined);
  const tokensInput =
    (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0);
  const tokensOutput = usage?.output_tokens || 0;
  session.state.lastAssistantUsage = undefined;
  session.clearInterruptTimer();

  log.debug(
    { sessionId: session.id, sessionChatId: session.state.chatId, subtype: event.subtype },
    'handling result event for parent session',
  );

  sink.onResult({
    total_cost_usd: (event.total_cost_usd as number) || 0,
    usage: usage
      ? {
          input_tokens: tokensInput,
          output_tokens: tokensOutput,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
        }
      : undefined,
    subtype: event.subtype as string | undefined,
    is_error: event.is_error as boolean | undefined,
  });

  // Request context usage after each result so the UI can show an up-to-date
  // context percentage without requiring a separate user action.
  session.requestContextUsage();
}

function handleEvent(session: ClaudeSession, event: Record<string, unknown>, sink: SessionSink): void {
  log.debug(
    { sessionId: session.id, type: event.type, subtype: event.subtype },
    'claude event: %s%s',
    event.type,
    event.subtype ? `.${event.subtype}` : '',
  );

  switch (event.type) {
    case 'system':
      return handleSystemEvent(session, event, sink);
    case 'assistant':
      return handleAssistantEvent(session, event, sink);
    case 'user':
      return handleUserEvent(session, event, sink);
    case 'control_request':
      return handleControlRequestEvent(session, event, sink);
    case 'control_response':
      return handleControlResponseEvent(session, event, sink);
    case 'result':
      // Subagent result events carry `parent_tool_use_id` and represent an
      // inner Task/Agent sub-turn completing, NOT the top-level chat turn.
      // Forwarding them to onResult() would flip processState to 'idle' while
      // the parent session is still running. Drop them here; their completion
      // is already surfaced via the tool_result block in the parent's user event.
      if (typeof event.parent_tool_use_id === 'string' && event.parent_tool_use_id) {
        log.debug(
          { sessionId: session.id, parentToolUseId: event.parent_tool_use_id },
          'claude: skipping subagent result event (parent_tool_use_id present)',
        );
        return;
      }
      return handleResultEvent(session, event, sink);
  }
}
