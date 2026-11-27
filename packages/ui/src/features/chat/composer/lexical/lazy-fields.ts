/**
 * The chip fields load on first use. With the chip setting off, no Lexical
 * code is fetched or parsed, so the textarea composer runs exactly as before.
 */
import { lazy } from 'react';

export const LazyComposerLexicalField = lazy(() =>
  import('./ComposerLexicalField').then((m) => ({ default: m.ComposerLexicalField })),
);

export const LazyChipTextEditor = lazy(() => import('./ChipTextEditor').then((m) => ({ default: m.ChipTextEditor })));
