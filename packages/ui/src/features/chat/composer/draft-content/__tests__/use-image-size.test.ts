// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useImageSize } from '../use-image-size';

const images: { src: string; onload?: () => void }[] = [];
beforeEach(() => {
  images.length = 0;
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      onload?: () => void;
      naturalWidth = 10;
      naturalHeight = 20;
      constructor() {
        images.push(this);
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it('never shows one image’s size for another', () => {
  const { result, rerender } = renderHook(({ src }) => useImageSize(src), { initialProps: { src: 'blob:a' } });
  act(() => images[0]!.onload!());
  expect(result.current).toBe('10×20');
  rerender({ src: 'blob:b' });
  expect(result.current).toBeUndefined();
});
