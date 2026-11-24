// node shot.cjs <path/to/File.dc.html> <light|dark> [--clip x,y,w,h] [--scale n] [--out name] [--wait ms]
const E2E = require('path').resolve(__dirname, '../../../packages/e2e');
const { chromium } = require(E2E + '/node_modules/@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const W = __dirname; // render/support.js: the canvas runtime (artifact-type/dc-runtime.js), fetched locally, never committed
const args = process.argv.slice(2);
const f = path.resolve(args[0]), mode = args[1] || 'light';
const opt = (k) => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1]; };
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const roots = [path.dirname(f), path.join(W, 'render')];
let SRC = fs.readFileSync(f, 'utf8');
if (mode === 'dark') SRC = SRC.replace(/"options":\["light","dark"\],"default":"light"/g, '"options":["light","dark"],"default":"dark"').replace(/this\.props\.mode \?\? 'light'/g, "'dark'");
if (mode === 'light') SRC = SRC.replace(/"options":\["light","dark"\],"default":"dark"/g, '"options":["light","dark"],"default":"light"').replace(/this\.props\.mode \?\? 'dark'/g, "'light'");
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/_board.html') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(SRC); }
  for (const root of roots) { const p = path.join(root, u); if (fs.existsSync(p) && fs.statSync(p).isFile()) { r.writeHead(200, { 'content-type': T[path.extname(p)] || 'application/octet-stream' }); return r.end(fs.readFileSync(p)); } }
  r.writeHead(404); r.end();
});
srv.listen(0, async () => {
  const b = await chromium.launch();
  const m = /"\$preview":\{"width":(\d+),"height":(\d+)\}/.exec(SRC); const w = +m[1], h = +m[2];
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: +(opt('--scale') || 1) });
  const errs = []; p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message.slice(0, 300))); p.on('console', (c) => { if (c.type() === 'error') errs.push('console ' + c.text().slice(0, 300)); });
  await p.goto(`http://localhost:${srv.address().port}/_board.html`); await p.waitForTimeout(+(opt('--wait') || 2200));
  const clip = opt('--clip');
  const out = path.join(W, 'render/shots', (opt('--out') || path.basename(f).replace('.dc.html', '')) + '.' + mode + '.png');
  const o = { path: out };
  if (clip) { const [x, y, cw, ch] = clip.split(',').map(Number); o.clip = { x, y, width: cw, height: ch }; }
  await p.screenshot(o);
  console.log(out, w + 'x' + h, 'errors:', errs.length, errs.slice(0, 6).join(' | '));
  await b.close(); srv.close();
});
