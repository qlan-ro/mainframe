import { z } from 'zod';

// --- HTTP Route Schemas ---

// Projects
export const CreateProjectBody = z.object({
  path: z.string().min(1),
  name: z.string().optional(),
});

// Attachments
export const UploadAttachmentItem = z.object({
  name: z.string().min(1),
  mediaType: z.string().min(1),
  sizeBytes: z.number().optional(),
  data: z.string().min(1),
  kind: z.enum(['image', 'file']).optional(),
  originalPath: z.string().optional(),
});
export const UploadAttachmentsBody = z.object({
  attachments: z.array(UploadAttachmentItem).min(1).max(10),
});

// Context — mentions
export const AddMentionBody = z.object({
  kind: z.enum(['file', 'agent']),
  name: z.string().min(1),
  path: z.string().optional(),
});

// Settings — provider update
export const UpdateProviderSettingsBody = z.object({
  defaultModel: z.string().optional(),
  defaultMode: z.string().optional(),
  planExecutionMode: z.string().optional(),
});

// Settings — general update
export const UpdateGeneralSettingsBody = z.object({
  worktreeDir: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Must be a simple directory name')
    .optional(),
});

// Skills
const scopeEnum = z.enum(['project', 'global']);

export const CreateSkillBody = z.object({
  projectPath: z.string().min(1),
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Name must contain only letters, numbers, hyphens, and underscores'),
  displayName: z.string().optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  scope: scopeEnum.optional(),
});
export const UpdateSkillBody = z.object({
  projectPath: z.string().min(1),
  content: z.string(),
});

// Agents
export const CreateAgentBody = z.object({
  projectPath: z.string().min(1),
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Name must contain only letters, numbers, hyphens, and underscores'),
  description: z.string().optional(),
  content: z.string().optional(),
  scope: scopeEnum.optional(),
});
export const UpdateAgentBody = z.object({
  projectPath: z.string().min(1),
  content: z.string(),
});

// --- Validation helper ---

export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (!result.success) return { success: false, error: result.error.issues.map((i) => i.message).join(', ') };
  return { success: true, data: result.data };
}
