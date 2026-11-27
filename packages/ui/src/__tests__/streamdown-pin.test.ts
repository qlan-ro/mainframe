/**
 * The production build stubs three modules Streamdown imports for its default
 * HTML plugins (`stubStreamdownHtmlPlugins` in `vite.config.ts`). That is safe
 * only because of how this Streamdown version uses them, so a version change
 * must be a deliberate, checked one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const VERIFIED = '2.8.1';

describe('streamdown version', () => {
  it(`is ${VERIFIED}, the version the build stubs were verified against`, () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../node_modules/streamdown/package.json'), 'utf8'));
    expect(
      manifest.version,
      [
        `Streamdown is ${manifest.version}; the build stubs were verified against ${VERIFIED}.`,
        'Before bumping: check that rehype-raw, rehype-sanitize and rehype-harden are still used only by its',
        'default rehypePlugins (we pass none), and that the `vite build` entry chunk still shrinks.',
        'Then update VERIFIED here and the pin in package.json together.',
      ].join(' '),
    ).toBe(VERIFIED);
  });
});
