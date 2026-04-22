// packages/core/src/plugins/builtin/codex/approval-handler.ts
import { nanoid } from 'nanoid';
import type { ControlRequest, ControlResponse, SessionSink } from '@qlan-ro/mainframe-types';
import type { RequestId, CommandExecutionApprovalParams, FileChangeApprovalParams, ApprovalDecision } from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:approvals');

export type RespondFn = (id: RequestId, result: unknown) => void;

interface PlanContext {
  planMode: boolean;
  currentTurnPlan: { id: string; text: string } | null;
}

interface PendingApproval {
  mainframeRequestId: string;
  jsonRpcId: RequestId;
  respond: RespondFn;
  method: string;
  /**
   * The Mainframe-side routed tool name (`ExitPlanMode` or `AskUserQuestion`
   * for `item/tool/requestUserInput`, or the approval tool name otherwise).
   * `resolve()` uses this to pick the right option-selection strategy.
   */
  toolName: string;
  /**
   * For `item/tool/requestUserInput`, the rendered option labels — one inner
   * array per option group in the order emitted by Codex. Task 9's plan-mode
   * handler prefix-matches the user's Approve/Deny choice against these to
   * derive a Codex option index.
   */
  optionLabels?: string[][];
  /**
   * For `item/tool/requestUserInput`, the question objects as received from
   * Codex. Needed at resolve() time to build the `{ answers: { [id]: ... } }`
   * map when we pick an option by label.
   */
  questions?: Array<{ id: string } | string>;
}

export class ApprovalHandler {
  private pending = new Map<string, PendingApproval>();
  private planContext: PlanContext = { planMode: false, currentTurnPlan: null };

  constructor(private readonly sink: SessionSink) {}

  setPlanContext(ctx: PlanContext): void {
    this.planContext = ctx;
  }

  handleRequest(method: string, params: unknown, jsonRpcId: RequestId, respond: RespondFn): void {
    const mainframeRequestId = nanoid();

    let toolName: string;
    let toolUseId: string;
    let input: Record<string, unknown>;
    let optionLabels: string[][] | undefined;
    let questions: Array<{ id: string } | string> | undefined;

    if (method === 'item/commandExecution/requestApproval') {
      const p = params as CommandExecutionApprovalParams;
      toolName = 'command_execution';
      toolUseId = p.itemId;
      input = { command: p.command, cwd: p.cwd };
    } else if (method === 'item/fileChange/requestApproval') {
      const p = params as FileChangeApprovalParams;
      toolName = 'file_change';
      toolUseId = p.itemId;
      input = { reason: p.reason };
    } else if (method === 'item/tool/requestUserInput') {
      const p = params as {
        threadId?: string;
        turnId?: string;
        itemId?: string;
        toolCallId?: string;
        questions: Array<{ id: string; question: string } | string>;
        options?: Array<Array<{ label: string; description?: string }>>;
      };
      toolUseId = p.toolCallId ?? p.itemId ?? mainframeRequestId;
      questions = Array.isArray(p.questions) ? p.questions : undefined;

      const rawOptions = Array.isArray(p.options) ? p.options : undefined;
      optionLabels = rawOptions?.map((group) =>
        Array.isArray(group) ? group.map((o) => (typeof o?.label === 'string' ? o.label : '')) : [],
      );

      const isPlanExit =
        this.planContext.planMode &&
        this.planContext.currentTurnPlan !== null &&
        Array.isArray(rawOptions) &&
        rawOptions.length === 2;

      if (isPlanExit) {
        toolName = 'ExitPlanMode';
        input = { plan: this.planContext.currentTurnPlan!.text, allowedPrompts: [] };
      } else {
        toolName = 'AskUserQuestion';
        const questionText = Array.isArray(p.questions)
          ? p.questions
              .map((q) => (typeof q === 'string' ? q : (q?.question ?? '')))
              .filter((t) => t.length > 0)
              .join('\n')
          : '';
        input = { question: questionText, questions: p.questions, options: rawOptions };
      }
    } else {
      log.warn({ method }, 'codex: unknown server request method');
      respond(jsonRpcId, { decision: 'decline' as ApprovalDecision });
      return;
    }

    const request: ControlRequest = {
      requestId: mainframeRequestId,
      toolName,
      toolUseId,
      input,
      suggestions: [],
    };

    this.pending.set(mainframeRequestId, {
      mainframeRequestId,
      jsonRpcId,
      respond,
      method,
      toolName,
      optionLabels,
      questions,
    });

    log.info({ mainframeRequestId, jsonRpcId, toolName, toolUseId }, 'codex approval request');
    this.sink.onPermission(request);
  }

  resolve(response: ControlResponse): void {
    const entry = this.pending.get(response.requestId);
    if (!entry) {
      log.warn({ requestId: response.requestId }, 'codex: no pending approval for requestId');
      return;
    }

    this.pending.delete(response.requestId);

    // requestUserInput expects { answers: { [questionId]: { answers: string[] } } }
    if (entry.method === 'item/tool/requestUserInput') {
      const answerString = this.chooseRequestUserInputAnswer(entry, response);
      const answers: Record<string, { answers: string[] }> = {};
      const questionList = this.collectQuestionIds(entry, response);
      for (const qid of questionList) {
        answers[qid] = { answers: [answerString] };
      }
      log.info(
        { requestId: response.requestId, behavior: response.behavior, toolName: entry.toolName, answerString },
        'codex user input resolved',
      );
      entry.respond(entry.jsonRpcId, { answers });
      return;
    }

    let decision: ApprovalDecision;
    if (response.behavior === 'allow') {
      decision = 'accept';
    } else {
      decision = 'decline';
    }

    log.info({ requestId: response.requestId, decision }, 'codex approval resolved');
    entry.respond(entry.jsonRpcId, { decision });
  }

  /**
   * Gather the question IDs that need an `answers` entry. Prefer the ids we
   * captured when the request arrived (most reliable); fall back to ids
   * echoed back via `response.updatedInput.questions` for compatibility.
   */
  private collectQuestionIds(entry: PendingApproval, response: ControlResponse): string[] {
    const fromEntry = entry.questions
      ?.map((q) => (typeof q === 'string' ? null : (q?.id ?? null)))
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (fromEntry && fromEntry.length > 0) return fromEntry;
    const echoed = response.updatedInput?.questions;
    if (!Array.isArray(echoed)) return [];
    return echoed
      .map((q) =>
        typeof q === 'object' && q !== null && typeof (q as { id?: unknown }).id === 'string'
          ? (q as { id: string }).id
          : null,
      )
      .filter((id): id is string => id !== null && id.length > 0);
  }

  /**
   * Decide the single answer string to deliver for a requestUserInput.
   *
   * For ExitPlanMode the plan-mode handler only signals intent via
   * `response.behavior` (+ optional `message` for "Revise"). Codex expects
   * the user to *select one of the option labels*. We prefix-match the
   * labels:
   *   - behavior='allow' → first label starting with "yes" (fallback index 0)
   *   - behavior='deny' with no message → first label starting with "no"
   *     (fallback index 1)
   *   - behavior='deny' with message → Codex's requestUserInput for plan
   *     exit does not advertise an `isOther`/free-form option, so we log a
   *     warning and fall back to the deny option. The feedback is delivered
   *     separately as the next user turn (the chat-manager's revise path
   *     sends it via sendMessage after the approval resolves).
   *
   * For AskUserQuestion, preserve legacy behavior: forward `response.message`
   * verbatim as the answer string.
   */
  private chooseRequestUserInputAnswer(entry: PendingApproval, response: ControlResponse): string {
    if (entry.toolName !== 'ExitPlanMode') {
      return response.message ?? '';
    }

    // Flatten option groups — Codex emits one option per group for ExitPlanMode.
    const flatLabels: string[] = (entry.optionLabels ?? []).flatMap((group) => group);

    const findByPrefix = (re: RegExp, fallbackIndex: number): string => {
      const match = flatLabels.find((label) => re.test(label));
      if (match !== undefined && match.length > 0) return match;
      const fallback = flatLabels[fallbackIndex];
      return typeof fallback === 'string' && fallback.length > 0 ? fallback : (response.message ?? '');
    };

    if (response.behavior === 'allow') {
      return findByPrefix(/^yes/i, 0);
    }

    // deny path
    if (response.message && response.message.length > 0) {
      // Free-form revise — Codex's plan-exit requestUserInput has no `isOther`
      // escape hatch, so we cannot deliver the feedback as a free-text answer.
      // Log once and fall back to the "No" option; the chat-manager's revise
      // flow is responsible for sending the feedback text as the next turn.
      log.warn(
        { requestId: response.requestId, toolName: entry.toolName },
        'codex: plan-exit revise free-text not supported by requestUserInput; falling back to deny option',
      );
      return findByPrefix(/^no/i, 1);
    }
    return findByPrefix(/^no/i, 1);
  }

  rejectAll(): void {
    for (const [id, entry] of this.pending) {
      if (entry.method === 'item/tool/requestUserInput') {
        entry.respond(entry.jsonRpcId, { answers: {} });
      } else {
        entry.respond(entry.jsonRpcId, { decision: 'decline' as ApprovalDecision });
      }
      this.pending.delete(id);
    }
  }
}
