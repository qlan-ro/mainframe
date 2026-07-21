import { z } from 'zod';

export const TodoSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  body: z.string().default(''),
  status: z.enum(['open', 'in_progress', 'done']).default('open'),
  type: z
    .enum(['bug', 'feature', 'enhancement', 'documentation', 'question', 'wont_fix', 'duplicate', 'invalid'])
    .default('feature'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  labels: z.array(z.string()).default([]),
  assignees: z.array(z.string()).default([]),
  milestone: z.string().optional(),
  dependencies: z.array(z.number()).default([]),
  closed_at: z.string().optional(),
  state_reason: z.string().optional(),
  author: z.string().optional(),
  remote_repo: z.string().optional(),
  remote_number: z.number().optional(),
  remote_url: z.string().optional(),
  synced_at: z.string().optional(),
});

export const TodoUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  status: z.enum(['open', 'in_progress', 'done']).optional(),
  type: z
    .enum(['bug', 'feature', 'enhancement', 'documentation', 'question', 'wont_fix', 'duplicate', 'invalid'])
    .optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
  milestone: z.string().optional(),
  dependencies: z.array(z.number()).optional(),
  closed_at: z.string().optional(),
  state_reason: z.string().optional(),
  author: z.string().optional(),
  remote_repo: z.string().optional(),
  remote_number: z.number().optional(),
  remote_url: z.string().optional(),
  synced_at: z.string().optional(),
});

export type TodoUpdatePayload = z.infer<typeof TodoUpdateSchema>;

export const AttachmentUploadSchema = z.object({
  filename: z.string().min(1),
  // Allow empty base64: a zero-byte file is valid and has data ''. sizeBytes
  // carries the real length; rejecting '' would 400 a legitimate empty file.
  data: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().nonnegative().optional(),
});
