export interface AskQuestion {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

/** Sentinel option label for the free-text "Other…" row. */
export const OTHER = '__other__';

/** Build the answers record sent in updatedInput. */
export function assembleAnswers(
  questions: AskQuestion[],
  selections: ReadonlyMap<number, ReadonlySet<string>>,
  otherText: ReadonlyMap<number, string>,
): Record<string, string | string[]> {
  const answers: Record<string, string | string[]> = {};
  questions.forEach((q, i) => {
    const chosen = [...(selections.get(i) ?? new Set<string>())]
      .map((label) => (label === OTHER ? (otherText.get(i) ?? '').trim() : label))
      .filter(Boolean);
    answers[q.question] = q.multiSelect ? chosen : (chosen[0] ?? '');
  });
  return answers;
}
