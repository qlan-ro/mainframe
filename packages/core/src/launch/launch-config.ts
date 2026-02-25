import { z } from 'zod';
import type { LaunchConfig, LaunchConfiguration } from '@mainframe/types';

// Allowed executables: common package managers + node. No shell operators.
const SAFE_EXECUTABLE = /^(node|pnpm|npm|yarn|bun|python|python3|[a-zA-Z0-9_\-./]+)$/;

const LaunchConfigurationSchema = z.object({
  name: z.string().min(1),
  runtimeExecutable: z
    .string()
    .min(1)
    .refine((v) => SAFE_EXECUTABLE.test(v) && !v.includes(';') && !v.includes('|') && !v.includes('&'), {
      message: 'runtimeExecutable must be a safe executable name (no shell operators)',
    }),
  runtimeArgs: z.array(z.string()),
  port: z.number().int().positive().nullable(),
  url: z.string().url().nullable(),
  preview: z.boolean().optional(),
});

const LaunchConfigSchema = z
  .object({
    version: z.string(),
    configurations: z.array(LaunchConfigurationSchema).min(1, 'At least one configuration is required'),
  })
  .refine((v) => v.configurations.filter((c) => c.preview).length <= 1, {
    message: 'At most one configuration may have preview: true',
  });

export function parseLaunchConfig(
  data: unknown,
): { success: true; data: LaunchConfig } | { success: false; error: string } {
  const result = LaunchConfigSchema.safeParse(data);
  if (!result.success) {
    return { success: false, error: result.error.issues.map((i) => i.message).join(', ') };
  }
  return { success: true, data: result.data as LaunchConfig };
}

export function getPreviewUrl(configurations: LaunchConfiguration[]): string | null {
  const preview = configurations.find((c) => c.preview);
  if (!preview) return null;
  if (preview.url) return preview.url;
  if (preview.port) return `http://localhost:${preview.port}`;
  return null;
}
