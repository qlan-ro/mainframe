import { useEffect, useState } from 'react';

/** An image's own dimensions, "1280×800"; undefined until it has loaded, or when it cannot. */
export function useImageSize(src: string | undefined): string | undefined {
  const [size, setSize] = useState<{ src: string; label: string }>();
  useEffect(() => {
    if (!src) return;
    const image = new Image();
    image.onload = () => setSize({ src, label: `${image.naturalWidth}×${image.naturalHeight}` });
    image.src = src;
  }, [src]);
  // A late answer for another image is not this one's.
  return size?.src === src ? size?.label : undefined;
}
