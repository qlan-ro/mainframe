import { z } from 'zod';

export const CommandActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('read'), command: z.string(), name: z.string(), path: z.string() }),
  z.object({ type: z.literal('listFiles'), command: z.string(), path: z.string().nullable().optional() }),
  z.object({
    type: z.literal('search'),
    command: z.string(),
    query: z.string().nullable().optional(),
    path: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal('unknown'), command: z.string() }),
]);
export type CommandAction = z.infer<typeof CommandActionSchema>;

export const CommandExecutionMetadataSchema = z.object({
  commandActions: z.array(CommandActionSchema).optional(),
  reportedDurationMs: z.number().int().optional(),
});
export type CommandExecutionMetadata = z.infer<typeof CommandExecutionMetadataSchema>;
