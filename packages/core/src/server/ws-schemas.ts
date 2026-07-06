import { z } from 'zod';
import { EXECUTION_MODES } from '@qlan-ro/mainframe-types';

const permissionModeSchema = z.enum(EXECUTION_MODES).optional();

// Reusable REST/WS payload bodies (no discriminator).
export const CreateChatBody = z
  .object({
    projectId: z.string().min(1),
    adapterId: z.string().min(1),
    model: z.string().optional(),
    permissionMode: permissionModeSchema,
    worktreePath: z.string().min(1).optional(),
    branchName: z.string().min(1).optional(),
  })
  .refine((m) => (m.worktreePath == null) === (m.branchName == null), {
    message: 'worktreePath and branchName must be provided together',
  });

export const UpdateChatConfigBody = z.object({
  adapterId: z.string().optional(),
  model: z.string().optional(),
  permissionMode: permissionModeSchema,
  planMode: z.boolean().optional(),
});

export const QueueEditBody = z.object({ content: z.string().min(1) });

const MessageSend = z
  .object({
    type: z.literal('message.send'),
    chatId: z.string().min(1),
    content: z.string(),
    attachmentIds: z.array(z.string()).optional(),
    metadata: z
      .object({
        command: z
          .object({
            // Interpolated into <mainframe-command name="..."> and <command-name>/...</command-name>
            // written to the CLI stdin — constrain to the identifier charset to close the injection seam.
            name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
            source: z.string().min(1),
            args: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .refine((msg) => msg.content.length > 0 || (msg.attachmentIds?.length ?? 0) > 0, {
    message: 'Either content or attachmentIds must be non-empty',
  });

const PermissionRespond = z.object({
  type: z.literal('permission.respond'),
  chatId: z.string().min(1),
  response: z.object({
    requestId: z.string(),
    toolUseId: z.string(),
    toolName: z.string().optional(),
    behavior: z.enum(['allow', 'deny']),
    updatedInput: z.record(z.string(), z.unknown()).optional(),
    updatedPermissions: z.array(z.unknown()).optional(),
    message: z.string().optional(),
    executionMode: z.enum(EXECUTION_MODES).optional(),
    clearContext: z.boolean().optional(),
  }),
});

const Subscribe = z.object({
  type: z.literal('subscribe'),
  chatId: z.string().min(1),
});

const Unsubscribe = z.object({
  type: z.literal('unsubscribe'),
  chatId: z.string().min(1),
});

const SubscribeFile = z.object({
  type: z.literal('subscribe:file'),
  path: z.string().min(1),
  /** When path is relative, the daemon resolves it against the project/worktree base. */
  projectId: z.string().min(1).optional(),
  chatId: z.string().min(1).optional(),
});

const UnsubscribeFile = z.object({
  type: z.literal('unsubscribe:file'),
  path: z.string().min(1),
  /** Must match the projectId/chatId sent with subscribe:file to look up the resolved path. */
  projectId: z.string().min(1).optional(),
  chatId: z.string().min(1).optional(),
});

export const ClientEventSchema = z.discriminatedUnion('type', [
  MessageSend,
  PermissionRespond,
  Subscribe,
  Unsubscribe,
  SubscribeFile,
  UnsubscribeFile,
]);
