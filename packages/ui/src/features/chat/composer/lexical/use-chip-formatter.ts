/**
 * The chip formatter for the active thread, keyed on the draft's recorded
 * session labels so it (and the re-parse react-lexical runs when it changes)
 * moves only when a label does.
 */
import { useMemo } from 'react';
import type { Unstable_DirectiveFormatter } from '@assistant-ui/react';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import { useSessionReferences } from '../sessions/session-reference-store';
import { createComposerChipFormatter } from './composer-chip-formatter';

const NO_LABELS: readonly string[] = [];

export function useChipFormatter(): Unstable_DirectiveFormatter {
  const threadId = useActiveThreadId();
  const references = useSessionReferences((s) => (threadId == null ? undefined : s.byThread[threadId]));
  const key = references ? Object.keys(references).join('\0') : '';
  return useMemo(() => createComposerChipFormatter(key ? key.split('\0') : NO_LABELS), [key]);
}
