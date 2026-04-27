import { z } from 'zod';
import type { PluginManifest } from '@qlan-ro/mainframe-types';

const VALID_CAPABILITIES = [
  'storage',
  'ui:panels',
  'ui:notifications',
  'daemon:public-events',
  'chat:read',
  'chat:read:content',
  'chat:create',
  'adapters',
  'process:exec',
  'http:outbound',
] as const;

const UIZoneContributionSchema = z.object({
  zone: z.enum([
    'fullview',
    'left-top',
    'left-bottom',
    'right-top',
    'right-bottom',
    'bottom-left',
    'bottom-right',
    // Legacy zone names supported in manifest.json for backwards compatibility
    'left-panel',
    'right-panel',
    'left-tab',
    'right-tab',
  ]),
  label: z.string(),
  icon: z.string().optional(),
});

/**
 * Accepts both legacy single-object and new array forms.
 * Both are valid on disk; the validator normalizes to the TypeScript union.
 */
const UIFieldSchema = z.union([UIZoneContributionSchema, z.array(UIZoneContributionSchema)]).optional();

const ManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id must be lowercase alphanumeric with hyphens'),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    author: z.string().optional(),
    license: z.string().optional(),
    capabilities: z.array(z.enum(VALID_CAPABILITIES)),
    ui: UIFieldSchema,
    adapter: z
      .object({
        binaryName: z.string().min(1),
        displayName: z.string().min(1),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.capabilities.includes('adapters') && !data.adapter) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'adapter field is required when "adapters" capability is declared',
      });
    }
    const contributions = data.ui ? (Array.isArray(data.ui) ? data.ui : [data.ui]) : [];
    const hasZone = contributions.length > 0;
    if (hasZone && !data.capabilities.includes('ui:panels')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Manifest declares ui zone(s) but is missing the "ui:panels" capability',
        path: ['capabilities'],
      });
    }
  });

export function validateManifest(
  raw: unknown,
): { success: true; manifest: PluginManifest } | { success: false; error: string } {
  const result = ManifestSchema.safeParse(raw);
  if (result.success) {
    return { success: true, manifest: result.data as PluginManifest };
  }
  return { success: false, error: result.error.issues.map((i) => i.message).join('; ') };
}
