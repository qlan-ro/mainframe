// @vitest-environment jsdom
/** Inspect in an artifact, from the picker's report to the row the message carries. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseSandboxCaptureBlock } from '@/features/chat/view-model/parse-captures';
import { formatCaptures } from '../format-captures';

const PICKER = resolve(
  __dirname,
  '../../../../../core-rs/crates/mainframe-server/src/routes/artifact_preview/picker.js',
);

const invoke = vi.fn();

function pick(page: string, id: string, text: string): string {
  history.replaceState(null, '', `/api/artifact-preview/slug1/v1/${encodeURIComponent(page)}`);
  document.body.innerHTML = '';
  const element = document.createElement('button');
  element.id = id;
  element.textContent = text;
  document.body.append(element);
  document.elementFromPoint = () => element;
  Object.assign(window, { __TAURI_INTERNALS__: { invoke } });
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^\w-]/g, (c) => `\\${c}`) });

  new Function(readFileSync(PICKER, 'utf8'))();
  (window as unknown as { __mfInspectInstall: (tab: string) => void }).__mfInspectInstall('tab');
  document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return (invoke.mock.calls[0]![1] as { result: { selector: string } }).result.selector;
}

function inRow(selector: string) {
  const capture = { id: '1', type: 'element' as const, imageDataUrl: 'data:image/png;base64,A', selector };
  const { markdown } = formatCaptures([capture, { ...capture, id: '2' }]);
  return parseSandboxCaptureBlock(markdown)!.rows.map((row) => row.selector);
}

beforeEach(() => invoke.mockClear());
afterEach(() => vi.unstubAllGlobals());

it('reaches the message as it was reported, separators and all', () => {
  const selector = pick('boards/Home.dc.html', 'save', 'Save');
  expect(selector).toBe(
    'artifact https://claude.ai/artifact/slug1 | board boards/Home.dc.html | button#save | text "Save"',
  );
  expect(inRow(selector)).toEqual([selector, selector]);
});

it('keeps a page name, an id or text from imitating a field', () => {
  const selector = pick('a | text "b`.html', 'x|"`y', 'ok" | board other');
  expect(selector.split(' | ')).toEqual([
    'artifact https://claude.ai/artifact/slug1',
    'board a \\u007c text \\u0022b\\u0060.html',
    'button#x\\7c \\22 \\60 y',
    'text "ok\\u0022 \\u007c board other"',
  ]);
  expect(inRow(selector)).toEqual([selector, selector]);
});
