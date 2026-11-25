// Prototype | app | difference, as one PNG, drawn by the browser.
export async function compose(browser, [proto, app], theme, title, transcript, regions, sideBySide) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 400 } });
  const page = await ctx.newPage();
  try {
    const result = await page.evaluate(
      async ({ proto, app, dark, title, transcript, regions, sideBySide }) => {
        const load = (b) =>
          new Promise((ok, no) => {
            const i = new Image();
            i.onload = () => ok(i);
            i.onerror = no;
            i.src = `data:image/png;base64,${b}`;
          });
        const [p, a] = [await load(proto), await load(app)];
        const w = Math.max(p.width, a.width);
        const h = Math.max(p.height, a.height);
        const gap = 16;
        const head = 44;
        const stacked = !sideBySide && w > 900;
        const canvas = document.createElement('canvas');
        canvas.width = stacked ? w + 2 * gap : 3 * w + 4 * gap;
        canvas.height = stacked ? 3 * (h + head) + gap : h + head + gap;
        const g = canvas.getContext('2d');
        g.fillStyle = dark ? '#000' : '#8a8a90';
        g.fillRect(0, 0, canvas.width, canvas.height);
        const read = (img) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const x = c.getContext('2d');
          x.drawImage(img, 0, 0);
          return x.getImageData(0, 0, w, h);
        };
        const [P, A] = [read(p), read(a)];
        const D = new ImageData(w, h);
        const [pThread, aThread] = transcript ?? [];
        const shift = pThread ? Math.round(aThread.bottom - pThread.bottom) : 0;
        const threadTop = pThread ? Math.max(pThread.top, aThread.top - shift) : 0;
        const aligned = document.createElement('canvas');
        aligned.width = w;
        aligned.height = h;
        const alignedContext = aligned.getContext('2d');
        alignedContext.drawImage(a, 0, 0);
        if (shift) {
          const width = pThread.right - pThread.x;
          const height = pThread.bottom - threadTop;
          alignedContext.drawImage(a, pThread.x, threadTop + shift, width, height, pThread.x, threadTop, width, height);
        }
        const alignedPixels = shift ? alignedContext.getImageData(0, 0, w, h) : A;
        const totals = {};
        const inside = (rect, x, y) => rect && x >= rect[0] && y >= rect[1] && x < rect[2] && y < rect[3];
        const regionAt = (x, y) => {
          if (pThread && x >= pThread.x && x < pThread.right && y >= threadTop && y < pThread.bottom)
            return 'transcript';
          for (const key of ['picker', 'title', 'rail', 'sidebar', 'panel', 'strip', 'activity']) {
            if (regions?.some((side) => inside(side[key], x, y))) return key;
          }
          return 'other';
        };
        let off = 0;
        for (let i = 0; i < P.data.length; i += 4) {
          const x = (i / 4) % w;
          const y = Math.floor(i / 4 / w);
          const region = regionAt(x, y);
          const d = Math.max(
            Math.abs(P.data[i] - alignedPixels.data[i]),
            Math.abs(P.data[i + 1] - alignedPixels.data[i + 1]),
            Math.abs(P.data[i + 2] - alignedPixels.data[i + 2]),
          );
          const tally = totals[region] ??= { pixels: 0, different: 0 };
          tally.pixels++;
          if (d > 8) {
            off++;
            tally.different++;
          }
          const grey = 235 + (P.data[i] - 235) * 0.12;
          const hot = Math.min(1, d / 90);
          D.data[i] = d > 8 ? 255 - 35 * (1 - hot) : grey;
          D.data[i + 1] = d > 8 ? 200 * (1 - hot) : grey;
          D.data[i + 2] = d > 8 ? 200 * (1 - hot) : grey;
          D.data[i + 3] = 255;
        }
        const dc = document.createElement('canvas');
        dc.width = w;
        dc.height = h;
        dc.getContext('2d').putImageData(D, 0, 0);
        const names = ['Prototype', shift ? 'App (transcript bottom aligned)' : 'App', `Difference (${((100 * off) / (w * h)).toFixed(2)} % of pixels)`];
        [p, shift ? aligned : a, dc].forEach((img, i) => {
          const x = stacked ? gap : gap + i * (w + gap);
          const y = stacked ? i * (h + head) + head : head;
          g.fillStyle = '#fff';
          g.font = '600 14px -apple-system, sans-serif';
          g.fillText(`${names[i]}${i === 0 ? ` · ${title}` : ''}`, x, y - 12);
          g.drawImage(img, x, y);
        });
        return { png: canvas.toDataURL('image/png'), stats: { pixels: w * h, different: off, regions: totals } };
      },
      { proto: proto.toString('base64'), app: app.toString('base64'), dark: theme === 'dark', title, transcript, regions, sideBySide },
    );
    return { png: Buffer.from(result.png.split(',')[1], 'base64'), stats: result.stats };
  } finally {
    await ctx.close();
  }
}
