import { useEffect, useState } from 'react';

/** An image's own dimensions, "1280×800"; undefined until it has loaded, or when it cannot. */
export function useImageSize(src: string | undefined): string | undefined {
  const [size, setSize] = useState<{ src: string; label: string }>();
  useEffect(() => {
    if (!src) return;
    let stale = false;
    const image = new Image();
    image.onload = () => {
      if (!stale) setSize({ src, label: `${image.naturalWidth}×${image.naturalHeight}` });
    };
    image.src = src;
    return () => {
      stale = true;
    };
  }, [src]);
  return size?.src === src ? size?.label : undefined;
}
