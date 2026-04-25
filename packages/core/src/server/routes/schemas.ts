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
  defaultPlanMode: z.enum(['true', 'false']).optional(),
  executablePath: z.string().optional(),
  systemPrompt: z.string().optional(),
});

// Settings — general update
const NotificationConfigSchema = z
  .object({
    chat: z
      .object({
        taskComplete: z.boolean(),
        sessionError: z.boolean(),
      })
      .optional(),
    permission: z
      .object({
        toolRequest: z.boolean(),
        userQuestion: z.boolean(),
        planApproval: z.boolean(),
      })
      .optional(),
    other: z
      .object({
        plugin: z.boolean(),
      })
      .optional(),
  })
  .optional();

export const UpdateGeneralSettingsBody = z.object({
  worktreeDir: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Must be a simple directory name')
    .optional(),
  notifications: NotificationConfigSchema,
});

// Filesystem browsing
export const BrowseFilesystemQuery = z.object({
  path: z.string().optional(),
  includeFiles: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
  includeHidden: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
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

// Git write operations
const gitBranchName = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/, 'Invalid branch name');

export const GitCheckoutBody = z.object({ branch: z.string().min(1) });
export const GitCreateBranchBody = z.object({ name: gitBranchName, startPoint: z.string().optional() });
export const GitFetchBody = z.object({ remote: z.string().optional() });
export const GitPullBody = z
  .object({
    remote: z.string().optional(),
    branch: z.string().optional(),
    localBranch: z.string().optional(),
  })
  .refine((d) => !d.localBranch || d.branch, { message: 'branch is required when localBranch is set' });
export const GitPushBody = z.object({ branch: z.string().optional(), remote: z.string().optional() });
export const GitMergeBody = z.object({ branch: z.string().min(1) });
export const GitRebaseBody = z.object({ branch: z.string().min(1) });
export const GitRenameBranchBody = z.object({ oldName: z.string().min(1), newName: gitBranchName });
export const GitDeleteBranchBody = z.object({
  name: z.string().min(1),
  force: z.boolean().optional(),
  remote: z.boolean().optional(),
});
export const GitDeleteWorktreeBody = z.object({
  worktreePath: z.string().min(1),
  branchName: z.string().optional(),
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
