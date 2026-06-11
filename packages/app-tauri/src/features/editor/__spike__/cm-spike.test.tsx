/**
 * Phase 0 spike test (ADR-001 step 1): prove CodeMirror 6 mounts under our
 * jsdom + Testing Library harness with a language pack and the warm theme.
 *
 * jsdom recipe (to hoist into src/__tests__/setup.ts in Phase 2): CM6 measures
 * text via Range client rects, which jsdom doesn't implement — stub them.
 */
import { beforeAll, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CmSpike } from './CmSpike';

const zeroRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
} as DOMRect;

function zeroRectList(): DOMRectList {
  const list = {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {
      /* empty — jsdom measurement stub */
    },
  };
  return list as unknown as DOMRectList;
}

beforeAll(() => {
  Range.prototype.getClientRects = zeroRectList;
  Range.prototype.getBoundingClientRect = () => zeroRect;
});

it('mounts a CodeMirror view with the given doc', () => {
  render(<CmSpike doc={'const x = 1\n'} language="javascript" />);
  const host = screen.getByTestId('editor-cm-spike');
  expect(host.querySelector('.cm-editor')).toBeTruthy();
  expect(host.querySelector('.cm-content')?.textContent).toContain('const x = 1');
});
