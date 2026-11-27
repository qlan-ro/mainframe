/**
 * Typography and placeholder for a chip field's wrapper, matching the textarea
 * it replaces (`font-sans text-composer-input`). Both chip fields render
 * react-lexical's class names (`aui-lexical-input`, `aui-lexical-placeholder`).
 * Each field places the placeholder over its own padding.
 */
export const CHIP_EDITOR_CLASS = [
  'font-sans text-composer-input text-foreground',
  '[&_.aui-lexical-input]:min-h-[1lh] [&_.aui-lexical-input]:outline-none',
  '[&_.aui-lexical-input]:break-words [&_.aui-lexical-input]:whitespace-pre-wrap',
  '[&_.aui-lexical-input_p]:m-0',
  '[&_.aui-lexical-placeholder]:pointer-events-none [&_.aui-lexical-placeholder]:absolute',
  '[&_.aui-lexical-placeholder]:text-muted-foreground',
].join(' ');
