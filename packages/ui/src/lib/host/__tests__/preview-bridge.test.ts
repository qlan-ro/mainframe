// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it('reports a cached document again while deduplicating ordinary URL reports', () => {
  const source = readFileSync(
    new URL('../../../../../app-tauri/src-tauri/src/preview/bridge.rs', import.meta.url),
    'utf8',
  );
  const script = /pub const BRIDGE_JS: &str = r#"([\s\S]+?)"#;/.exec(source)?.[1];
  expect(script).toBeDefined();
  const invoke = vi.fn();
  const window = Object.assign(new EventTarget(), {
    __TAURI_INTERNALS__: { invoke },
    __mfPreviewTabId: 'preview-a',
  });
  const location = { href: 'https://example.com/a' };
  const history = { pushState: vi.fn(), replaceState: vi.fn() };
  runInNewContext(script!, { window, location, history, document: new EventTarget() });

  const pageShow = (persisted: boolean) => window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));
  pageShow(false);
  window.dispatchEvent(new Event('popstate'));
  expect(invoke).toHaveBeenCalledTimes(1);

  pageShow(true);
  expect(invoke).toHaveBeenNthCalledWith(2, 'plugin:preview-bridge|navigate_event', {
    result: { tabId: 'preview-a', url: location.href },
  });
  window.dispatchEvent(new Event('hashchange'));
  expect(invoke).toHaveBeenCalledTimes(2);

  location.href = 'https://example.com/a#section';
  window.dispatchEvent(new Event('hashchange'));
  location.href = 'https://example.com/a';
  window.dispatchEvent(new Event('popstate'));
  expect(invoke.mock.calls.map(([, payload]) => payload.result.url)).toEqual([
    'https://example.com/a',
    'https://example.com/a',
    'https://example.com/a#section',
    'https://example.com/a',
  ]);
});
