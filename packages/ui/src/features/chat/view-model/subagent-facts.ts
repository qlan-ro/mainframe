import { z } from 'zod';
import { SubagentRowFactsSchema } from '@qlan-ro/mainframe-types';

const fact = z.object({ ...SubagentRowFactsSchema.shape, title: z.string().nullish() });

export function parseSubagentFact(value: unknown) {
  const parsed = fact.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function subagentFact(part: { providerMetadata?: unknown }) {
  return (part.providerMetadata as { mainframe?: { subagentFact?: z.infer<typeof fact> } } | undefined)?.mainframe
    ?.subagentFact;
}
