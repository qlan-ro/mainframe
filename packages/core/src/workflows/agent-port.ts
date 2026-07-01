import type { AgentChatPort } from './engine/executors/agent.js';

/**
 * Minimal surface of ChatManager that the agent port needs.
 * Using a structural interface avoids a circular dependency on the full
 * ChatManager class — the port only calls two methods.
 */
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
 * Build an AgentChatPort backed by the real ChatManager.
 *
 * @param chats - The ChatManager instance (typed structurally to avoid circular deps).
 * @param getDefaultProjectId - Returns the fallback projectId when the step does
 *   not specify one. Returns null when no project is available; the port will
 *   throw a clear error in that case.
 */
export function makeChatManagerPort(chats: ChatPortDeps, getDefaultProjectId: () => string | null): AgentChatPort {
  return {
    async createChatAndSend(args) {
      const projectId = args.projectId ?? getDefaultProjectId();
      if (!projectId) {
        throw new Error(
          'agent step requires a projectId — either set `agent.projectId` in the step or ensure at least one project exists in the workspace',
        );
      }

      const branchName = args.worktree?.branchName;

      const chat = await chats.createChatWithDefaults(
        projectId,
        args.adapterId,
        args.model,
        args.permissionMode,
        undefined, // worktreePath — not passed via DSL; attach worktree by branchName only
        branchName,
      );

      await chats.sendMessage(chat.id, args.prompt);

      return { chatId: chat.id };
    },
  };
}
