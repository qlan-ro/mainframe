export interface AskQuestion {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

/** Sentinel option label for the free-text "Other…" row. */
export const OTHER = '__other__';

/**
 * Resolve the final chosen labels for a single question — maps the OTHER
 * sentinel to the typed free-text, trims, and removes blanks.
 */
export function resolveChosen(selections: string[], otherText: string): string[] {
  return selections.map((label) => (label === OTHER ? otherText.trim() : label)).filter(Boolean);
}

/** Build the answers record sent in updatedInput. */
export function assembleAnswers(
  questions: AskQuestion[],
  selections: ReadonlyMap<number, ReadonlySet<string>>,
  otherText: ReadonlyMap<number, string>,
): Record<string, string | string[]> {
  const answers: Record<string, string | string[]> = {};
  questions.forEach((q, i) => {
    const chosen = resolveChosen([...(selections.get(i) ?? new Set<string>())], otherText.get(i) ?? '');
    answers[q.question] = q.multiSelect ? chosen : (chosen[0] ?? '');
  });
  return answers;
}
