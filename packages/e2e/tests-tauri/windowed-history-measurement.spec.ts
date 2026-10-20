import { test, expect } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { armHistoryPaint, historyPaintMs, installHistoryPaintProbe } from '../helpers/tauri/history-paint.js';

test('keypress-to-paint includes synchronous keyboard handlers before the input update', async ({ page }) => {
  await installHistoryPaintProbe(page);
  await page.goto('data:text/html,<input data-testid="probe-input">');
  await page.evaluate(() => {
    window.addEventListener(
      'keydown',
      () => {
        const start = performance.now();
        while (performance.now() - start < 120) {
          /* Simulate a slow application shortcut handler. */
        }
      },
      true,
    );
  });
  await page.getByTestId('probe-input').focus();
  await armHistoryPaint(page, '[data-testid="probe-input"]', 'key');
  await page.keyboard.type('a');
  expect(await historyPaintMs(page)).toBeGreaterThanOrEqual(120);
  await expect(page.getByTestId('probe-input')).toHaveValue('a');
});

test('opening waits for the measured chat replay rather than another chat', async ({ page }) => {
  const http = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<button data-testid="probe-row" data-chat-id="target">Open</button><p data-testid="chat-user-message">Needle turn 249</p>',
    );
  });
  const server = new WebSocketServer({ server: http });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (typeof address === 'string' || !address) throw new Error('Missing probe socket address');
  server.on('connection', (socket) =>
    socket.on('message', () => {
      const frame = (sessionId: string) =>
        JSON.stringify({
          method: '_mainframe.dev/replay_complete',
          params: { sessionId },
        });
      socket.send(frame('other'));
      setTimeout(() => socket.send(frame('target')), 120);
    }),
  );
  try {
    await installHistoryPaintProbe(page);
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(
      (port) =>
        new Promise<void>((resolve, reject) => {
          const socket = new WebSocket(`ws://127.0.0.1:${port}`);
          socket.addEventListener('error', () => reject(new Error('Probe WebSocket did not connect')));
          socket.addEventListener('open', () => {
            document.querySelector('button')!.addEventListener('click', () => socket.send('open'));
            resolve();
          });
        }),
      address.port,
    );
    await armHistoryPaint(page, '[data-testid="probe-row"]', 'open');
    await page.getByTestId('probe-row').click();
    await expect.poll(() => page.evaluate(() => window.historyPaintProbe.replays['target'])).toBe(1);
    expect(await historyPaintMs(page)).toBeGreaterThanOrEqual(120);
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
