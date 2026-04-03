import type * as monacoType from 'monaco-editor';

/** Singleton ref for the active diff editor — used by FileViewHeader for navigation. */
let activeDiffEditor: monacoType.editor.IStandaloneDiffEditor | null = null;

export function setActiveDiffEditor(editor: monacoType.editor.IStandaloneDiffEditor | null): void {
  activeDiffEditor = editor;
}

export function navigateDiff(direction: 'prev' | 'next'): void {
  if (!activeDiffEditor) return;
  const inner = activeDiffEditor.getModifiedEditor();
  const changes = activeDiffEditor.getLineChanges();
  if (!changes || changes.length === 0) return;
  const cursorLine = inner.getPosition()?.lineNumber ?? 0;
  if (direction === 'next') {
    const next = changes.find((c) => c.modifiedStartLineNumber > cursorLine);
    const target = next ?? changes[0]!;
    inner.revealLineInCenter(target.modifiedStartLineNumber);
    inner.setPosition({ lineNumber: target.modifiedStartLineNumber, column: 1 });
  } else {
    const prev = [...changes].reverse().find((c) => c.modifiedStartLineNumber < cursorLine);
    const target = prev ?? changes[changes.length - 1]!;
    inner.revealLineInCenter(target.modifiedStartLineNumber);
    inner.setPosition({ lineNumber: target.modifiedStartLineNumber, column: 1 });
  }
}
