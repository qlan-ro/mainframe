import { decodeDataUrl } from './image-source';

/**
 * Writes a `data:image/*` URI to the system clipboard as PNG bytes.
 *
 * Not `async`: WebKit requires `navigator.clipboard.write` to run inside the
 * user activation of the click that triggered it, and an `await` before the
 * call would end that activation. The PNG branch decodes and constructs the
 * blob synchronously; a non-PNG source is re-encoded through a canvas, whose
 * promise rides inside the `ClipboardItem` value instead of being awaited here.
 *
 * @throws synchronously when `src` is a malformed `image/png` data URI —
 * before any clipboard call, so a bad source never touches the clipboard.
 */
export function writeImageToClipboard(src: string): Promise<void> {
  const png = src.startsWith('data:image/png;base64,') ? Promise.resolve(pngBlobFromDataUrl(src)) : reencodeToPng(src);
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

function pngBlobFromDataUrl(src: string): Blob {
  const decoded = decodeDataUrl(src);
  if (!decoded) throw new Error('That image could not be decoded.');
  return new Blob([decoded.bytes], { type: 'image/png' });
}

async function reencodeToPng(src: string): Promise<Blob> {
  const img = new Image();
  img.src = src;
  await img.decode();

  const canvas = drawToCanvas(img);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The image could not be re-encoded as PNG.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

function drawToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const { naturalWidth, naturalHeight } = img;
  if (!naturalWidth || !naturalHeight) {
    throw new Error('The image has no dimensions to copy.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = naturalWidth;
  canvas.height = naturalHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('This browser has no 2D canvas context.');
  }
  ctx.drawImage(img, 0, 0);
  return canvas;
}
