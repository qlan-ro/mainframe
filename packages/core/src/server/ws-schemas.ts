import { z } from 'zod';

const permissionModeSchema = z.enum(['default', 'acceptEdits', 'plan', 'yolo']).optional();

const ChatCreate = z.object({
  type: z.literal('chat.create'),
  projectId: z.string().min(1),
  adapterId: z.string().min(1),
  model: z.string().optional(),
  permissionMode: permissionModeSchema,
});

const ChatResume = z.object({
  type: z.literal('chat.resume'),
  chatId: z.string().min(1),
});

const ChatEnd = z.object({
  type: z.literal('chat.end'),
  chatId: z.string().min(1),
});

const ChatInterrupt = z.object({
  type: z.literal('chat.interrupt'),
  chatId: z.string().min(1),
});

const ChatUpdateConfig = z.object({
  type: z.literal('chat.updateConfig'),
  chatId: z.string().min(1),
  adapterId: z.string().optional(),
  model: z.string().optional(),
  permissionMode: permissionModeSchema,
});

const MessageSend = z.object({
  type: z.literal('message.send'),
  chatId: z.string().min(1),
  content: z.string().min(1),
  attachmentIds: z.array(z.string()).optional(),
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
    updatedPermissions: z.array(z.string()).optional(),
    message: z.string().optional(),
    executionMode: z.enum(['default', 'acceptEdits', 'yolo']).optional(),
    clearContext: z.boolean().optional(),
  }),
});

const ChatEnableWorktree = z.object({
  type: z.literal('chat.enableWorktree'),
  chatId: z.string().min(1),
});

const ChatDisableWorktree = z.object({
  type: z.literal('chat.disableWorktree'),
  chatId: z.string().min(1),
});

const Subscribe = z.object({
  type: z.literal('subscribe'),
  chatId: z.string().min(1),
});

const Unsubscribe = z.object({
  type: z.literal('unsubscribe'),
  chatId: z.string().min(1),
});

export const ClientEventSchema = z.discriminatedUnion('type', [
  ChatCreate,
  ChatResume,
  ChatEnd,
  ChatInterrupt,
  ChatUpdateConfig,
  MessageSend,
  PermissionRespond,
  ChatEnableWorktree,
  ChatDisableWorktree,
  Subscribe,
  Unsubscribe,
]);
