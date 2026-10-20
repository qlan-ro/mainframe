import type { Page } from '@playwright/test';

type PaintKind = 'open' | 'page' | 'key';

interface PaintProbe {
  replays: number;
  measured?: Promise<number>;
  begin?: (event: Event) => void;
  ready: (kind: PaintKind, replays: number, edited: boolean) => boolean;
}

declare global {
  interface Window {
    historyPaintProbe: PaintProbe;
  }
}

export async function installHistoryPaintProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.historyPaintProbe = {
      replays: 0,
      ready(kind, replays, edited) {
        if (kind === 'key') return edited;
        if (kind === 'page') return document.querySelectorAll('[data-testid="chat-user-message"]').length === 40;
        const tail = Array.from(document.querySelectorAll('[data-testid="chat-user-message"]')).find((node) =>
          node.textContent?.includes('Needle turn 249'),
        );
        const rect = tail?.getBoundingClientRect();
        return Boolean(
          window.historyPaintProbe.replays > replays &&
          !document.querySelector('[data-testid="chat-thread-loading"]') &&
          rect &&
          rect.bottom > 0 &&
          rect.top < innerHeight,
        );
      },
    };
    for (const name of ['click', 'keydown'])
      window.addEventListener(name, (event) => window.historyPaintProbe.begin?.(event), true);
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (typeof event.data !== 'string') return;
          const frame = JSON.parse(event.data) as { method?: string };
          if (frame.method === '_mainframe.dev/replay_complete') window.historyPaintProbe.replays++;
        });
      }
    };
  });
}

export async function armHistoryPaint(page: Page, selector: string, kind: PaintKind): Promise<void> {
  await page.locator(selector).evaluate((element, kind) => {
    const probe = window.historyPaintProbe;
    const eventType = kind === 'open' ? 'click' : 'keydown';
    probe.measured = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`No painted ${kind} within 30 seconds`)), 30_000);
      probe.begin = (event) => {
        if (event.type !== eventType || !element.contains(event.target as Node)) return;
        probe.begin = undefined;
        const start = performance.now();
        const replays = probe.replays;
        let edited = kind !== 'key';
        if (!edited)
          element.addEventListener(
            'input',
            () => {
              edited = true;
            },
            { once: true },
          );
        const tick = () => {
          if (!probe.ready(kind, replays, edited)) return void requestAnimationFrame(tick);
          requestAnimationFrame(() => {
            clearTimeout(timeout);
            resolve(performance.now() - start);
          });
        };
        requestAnimationFrame(tick);
      };
    });
  }, kind);
}

export async function historyPaintMs(page: Page): Promise<number> {
  return page.evaluate(() => {
    if (!window.historyPaintProbe.measured) throw new Error('Paint measurement was not armed');
    return window.historyPaintProbe.measured;
  });
}
