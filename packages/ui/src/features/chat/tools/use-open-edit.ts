import { useCallback } from 'react';
import { isStructuredResult, reconstructFromHunks } from './shared';
import { resolveToolDiff } from './shared/diff-data';
import { useOpenFile } from './chat-tool-context';
import { argText } from '../view-model/turn/tool-values';
import type { ToolPart } from '../view-model/turn/types';

/** Opens an edit in the diff editor: the whole files when the daemon kept them, else what its hunks show. */
export function useOpenEdit(part: ToolPart): () => void {
  const { openDiff } = useOpenFile();
  return useCallback(() => {
    const path = argText(part, 'file_path');
    const { result } = part;
    if (isStructuredResult(result) && result.originalFile && result.modifiedFile) {
      openDiff(path, result.originalFile, result.modifiedFile);
      return;
    }
    const { hunks } = resolveToolDiff('Edit', part.args, result);
    const { original, modified } = hunks
      ? reconstructFromHunks(hunks)
      : { original: argText(part, 'old_string'), modified: argText(part, 'new_string') };
    openDiff(path, original, modified);
  }, [part, openDiff]);
}
