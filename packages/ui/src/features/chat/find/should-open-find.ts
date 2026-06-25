/**
 * Whether a Cmd/Ctrl+F keydown should open the chat Find bar.
 *
 * Returns false when the event target is inside a CodeMirror editor (`.cm-editor`)
 * so the editor keeps its own CM6 search (registered via searchKeymap in
 * features/editor/cm-setup.ts). Returns true everywhere else.
 */
export function shouldOpenFind(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return target.closest('.cm-editor') === null;
}
