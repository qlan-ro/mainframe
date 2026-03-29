// packages/core/src/plugins/builtin/codex/approval-handler.ts
import { nanoid } from 'nanoid';
import type { ControlRequest, ControlResponse, SessionSink } from '@qlan-ro/mainframe-types';
import type { RequestId, CommandExecutionApprovalParams, FileChangeApprovalParams, ApprovalDecision } from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:approvals');

export type RespondFn = (id: RequestId, result: unknown) => void;

interface PendingApproval {
  mainframeRequestId: string;
  jsonRpcId: RequestId;
  respond: RespondFn;
  method: string;
}

export class ApprovalHandler {
  private pending = new Map<string, PendingApproval>();

  constructor(private readonly sink: SessionSink) {}

  handleRequest(method: string, params: unknown, jsonRpcId: RequestId, respond: RespondFn): void {
    const mainframeRequestId = nanoid();

    let toolName: string;
    let toolUseId: string;
    let input: Record<string, unknown>;

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
        threadId: string;
        turnId: string;
        itemId: string;
        questions: Array<{ id: string; question: string }>;
      };
      toolName = 'AskUserQuestion';
      toolUseId = p.itemId;
      const questionText = p.questions.map((q) => q.question).join('\n');
      input = { question: questionText, questions: p.questions };
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

    this.pending.set(mainframeRequestId, { mainframeRequestId, jsonRpcId, respond, method });

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
      const userMessage = response.message ?? '';
      const questions = (response.updatedInput?.questions as Array<{ id: string }>) ?? [];
      const answers: Record<string, { answers: string[] }> = {};
      for (const q of questions) {
        answers[q.id] = { answers: [userMessage] };
      }
      log.info({ requestId: response.requestId, behavior: response.behavior }, 'codex user input resolved');
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
