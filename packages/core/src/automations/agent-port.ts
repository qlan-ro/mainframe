// packages/core/src/automations/agent-port.ts
//
// Task 23. Builds the ask_agent verb's AgentChatPort (verbs/ask-agent.ts)
// backed by the real ChatManager — ports v1 workflows/agent-port.ts, minus
// its `origin` field (v2's AskAgentStep carries no equivalent) and plus
// `sendMessage` (A2's corrective retry messages an already-created chat).
import type { AgentChatPort } from './verbs/ask-agent.js';

/** Structural subset of ChatManager, matching v1's agent-port.ts pattern to avoid a circular import on the full class. */
interface ChatPortDeps {
  createChatWithDefaults(
    projectId: string,
    adapterId: string,
    model?: string,
    permissionMode?: string,
    worktreePath?: string,
    branchName?: string,
  ): Promise<{ id: string }>;
  sendMessage(chatId: string, content: string): Promise<void>;
}

/**
 * @param getDefaultProjectId - Fallback projectId when a step doesn't specify one.
 *   Returns null when no project exists; the port throws a clear error in that case.
 */
export function makeAutomationChatPort(chats: ChatPortDeps, getDefaultProjectId: () => string | null): AgentChatPort {
  return {
    async createChatAndSend(args) {
      const projectId = args.projectId ?? getDefaultProjectId();
      if (!projectId) {
        throw new Error(
          'ask_agent step requires a projectId — either set `projectId` on the step or ensure at least one project exists in the workspace',
        );
      }

      const chat = await chats.createChatWithDefaults(
        projectId,
        args.adapterId,
        args.model,
        args.permissionMode,
        undefined, // worktreePath — attach worktree by branchName only, matching v1
        args.worktree?.branchName,
      );

      await chats.sendMessage(chat.id, args.prompt);
      return { chatId: chat.id };
    },
    sendMessage: (chatId, content) => chats.sendMessage(chatId, content),
  };
}
