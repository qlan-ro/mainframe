import { z } from 'zod';

const fact = z.object({
  status: z.enum(['completed', 'failed', 'stopped', 'unknown']),
  title: z.string().nullish(),
  summary: z.string().nullish(),
  durationMs: z.number().nonnegative().nullish(),
  tokens: z.number().int().nonnegative().nullish(),
  toolUseCount: z.number().int().nonnegative().nullish(),
});

export function parseSubagentFact(value: unknown) {
  const parsed = fact.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function subagentFact(part: { providerMetadata?: unknown }) {
  return (part.providerMetadata as { mainframe?: { subagentFact?: z.infer<typeof fact> } } | undefined)?.mainframe
    ?.subagentFact;
}
