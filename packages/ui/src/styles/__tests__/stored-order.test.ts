/** Text to approve shows its characters in stored order, whatever their script. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('stored-order overrides the direction of every character, left to right', () => {
  const css = readFileSync(resolve(__dirname, '../globals.css'), 'utf8');
  const rule = /@utility stored-order \{([^}]*)\}/.exec(css)?.[1] ?? '';

  expect(rule).toMatch(/direction:\s*ltr;/);
  expect(rule).toMatch(/unicode-bidi:\s*bidi-override;/);
});
