// Static server for the built rig, plus the image endpoints: `/rig-img?id=&delay=&hold=1`
// answers after `delay` ms, or holds until `/rig-release?id=` is requested.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function svg(id) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160"><rect width="320" height="160" fill="#cbd5e1"/><text x="16" y="88" font-size="20" font-family="sans-serif">image ${id}</text></svg>`;
}

export function startServer(root, port) {
  const held = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/rig-img') {
      const id = url.searchParams.get('id');
      const send = () =>
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }).end(svg(id));
      if (url.searchParams.get('hold') === '1') held.set(id, send);
      else setTimeout(send, Number(url.searchParams.get('delay') ?? 0));
      return;
    }
    if (url.pathname === '/rig-release') {
      held.get(url.searchParams.get('id'))?.();
      held.delete(url.searchParams.get('id'));
      res.writeHead(204).end();
      return;
    }
    const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
      return res.writeHead(404).end();
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  server.on('connection', (socket) => socket.unref());
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () =>
      resolve({
        close: () => {
          for (const send of held.values()) send();
          server.close();
        },
      }),
    ),
  );
}
