import { z } from 'zod';

/** Visual tint for a repo suggestion tile. `accent` = churn/neutral; `amber` = TODO/warning. */
export type SuggestionTint = 'accent' | 'amber';

/**
 * A single repo-derived starting point shown in the new-session Welcome state.
 * `icon` is a lucide icon name; `prefill` is the composer text inserted on click
 * (never auto-sent). Defined once here and imported by core (endpoint) and ui.
 */
export interface Suggestion {
  icon: string;
  tint: SuggestionTint;
  title: string;
  meta: string;
  prefill: string;
}

export const SuggestionSchema: z.ZodType<Suggestion> = z.object({
  icon: z.string().min(1),
  tint: z.enum(['accent', 'amber']),
  title: z.string().min(1),
  meta: z.string(),
  prefill: z.string().min(1),
});

export const SuggestionListSchema: z.ZodType<Suggestion[]> = z.array(SuggestionSchema);
