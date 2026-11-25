// Prototype | app | difference, as one PNG, drawn by the browser.
export async function compose(browser, [proto, app], theme, title) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 400 } });
  const page = await ctx.newPage();
  try {
    const url = await page.evaluate(
      async ({ proto, app, dark, title }) => {
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
        const stacked = w > 900;
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
        let off = 0;
        for (let i = 0; i < P.data.length; i += 4) {
          const d = Math.max(Math.abs(P.data[i] - A.data[i]), Math.abs(P.data[i + 1] - A.data[i + 1]), Math.abs(P.data[i + 2] - A.data[i + 2]));
          if (d > 8) off++;
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
        const names = ['Prototype', 'App', `Difference (${((100 * off) / (w * h)).toFixed(2)} % of pixels)`];
        [p, a, dc].forEach((img, i) => {
          const x = stacked ? gap : gap + i * (w + gap);
          const y = stacked ? i * (h + head) + head : head;
          g.fillStyle = '#fff';
          g.font = '600 14px -apple-system, sans-serif';
          g.fillText(`${names[i]}${i === 0 ? ` · ${title}` : ''}`, x, y - 12);
          g.drawImage(img, x, y);
        });
        return canvas.toDataURL('image/png');
      },
      { proto: proto.toString('base64'), app: app.toString('base64'), dark: theme === 'dark', title },
    );
    return Buffer.from(url.split(',')[1], 'base64');
  } finally {
    await ctx.close();
  }
}
