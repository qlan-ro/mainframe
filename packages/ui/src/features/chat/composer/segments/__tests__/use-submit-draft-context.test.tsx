import { THREAD_ID, appendSpy, live } from './submit-composition-fixture';
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSubmitComposition, useCanSubmit } from '../use-submit-composition';
import type { AppendMessage } from '@assistant-ui/react';
import { clearDraftConfig, setDraftConfig } from '@/features/sessions/runtime/draft-config';
import { settleSubmittedDraft } from '../submitted-draft';
import { useSessionReferences } from '../../sessions/session-reference-store';
import { draftItemsOf, useDraftContent } from '../../draft-content/draft-content-store';

describe('useSubmitComposition — session reference lines', () => {
  it('prepends one reference line per referenced label and clears the store', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo refactor', '/tmp/a.jsonl');
    live.text = 'compare with @session[Foo refactor] please';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    const [callArg] = appendSpy.mock.calls[0] as [{ content: { text: string }[] }];
    expect(callArg.content[0]!.text).toBe(
      'Referenced session @session[Foo refactor]: /tmp/a.jsonl\n\ncompare with @session[Foo refactor] please',
    );
    expect(useSessionReferences.getState().byThread[THREAD_ID]).toEqual({});
  });

  it('drops a recorded reference whose token the user deleted from the draft', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo refactor', '/tmp/a.jsonl');
    live.text = 'never mind';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    const [callArg] = appendSpy.mock.calls[0] as [{ content: { text: string }[] }];
    expect(callArg.content[0]!.text).toBe('never mind');
  });

  it('does not send on a draft that is nothing but a stale reference record', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo refactor', '/tmp/a.jsonl');

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(appendSpy).not.toHaveBeenCalled();
  });
});

describe('captures and code annotations (C14)', () => {
  const sent = () => appendSpy.mock.calls[0]![0] as { content: { text: string }[]; attachments: { id: string }[] };
  const submit = () => {
    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());
  };
  const addCapture = () =>
    useDraftContent
      .getState()
      .add(THREAD_ID, [
        { kind: 'capture', type: 'element', imageDataUrl: 'data:image/png;base64,AA', selector: '.btn', note: 'wide' },
      ]);
  const addCode = () =>
    useDraftContent
      .getState()
      .add(THREAD_ID, [
        { kind: 'code', filePath: 'a.ts', startLine: 1, endLine: 1, lineContent: 'see @Quota', note: 'why' },
      ]);

  it('go with the text, the captures’ images ahead of the files, and the draft is empty after', () => {
    addCapture();
    const { id } = draftItemsOf(THREAD_ID)[0]!;
    live.text = 'Fix it';
    live.attachments = [
      { id: 'file', type: 'document', name: 'a.txt', content: [], status: { type: 'requires-action' } },
    ];
    submit();
    expect(sent().attachments.map((a) => a.id)).toEqual([id, 'file']);
    expect(sent().content[0]!.text).toContain('> - `element1` — selector `.btn` — "wide"\n\nFix it');
    expect(draftItemsOf(THREAD_ID)).toEqual([]);
  });

  it('are enough on their own', () => {
    addCode();
    submit();
    expect(sent().content[0]!.text).toContain('File: `a.ts`');
  });

  it('make Send ready', () => {
    expect(renderHook(() => useCanSubmit()).result.current).toBe(false);
    addCode();
    expect(renderHook(() => useCanSubmit()).result.current).toBe(true);
  });

  it('are not read as session mentions, and the text’s mentions still are', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Quota', '/x/quota.jsonl');
    addCode();
    live.text = 'Like @Quota';
    submit();
    const { text } = sent().content[0]!;
    expect(text).toContain('Like @session[Quota]');
    expect(text).toContain('see @Quota');
    expect(text.startsWith('Referenced session @session[Quota]: /x/quota.jsonl')).toBe(true);
  });

  it('are kept until the send settles, so a failed one gives the captures back', () => {
    addCapture();
    const [item] = draftItemsOf(THREAD_ID);
    submit();
    const message = appendSpy.mock.calls[0]![0] as AppendMessage;
    expect(settleSubmittedDraft(message, 'failed')).toBe(true);
    expect(draftItemsOf(THREAD_ID)).toEqual([expect.objectContaining({ id: item!.id, note: item!.note })]);
    expect(settleSubmittedDraft(message, 'failed')).toBe(false);
  });
});

it.each([undefined, 'queue', 'steer'] as const)('filters context at submit for mode %s', (mode) => {
  const origin = { daemonId: 'another-daemon', projectId: 'alpha', worktreePath: '/projects/alpha' };
  useDraftContent.getState().add(THREAD_ID, [
    {
      kind: 'code',
      filePath: '/projects/alpha/private.ts',
      startLine: 1,
      endLine: 1,
      lineContent: 'private',
      note: '',
      origin,
    },
    { kind: 'capture', type: 'screenshot', imageDataUrl: 'data:image/png;base64,AAAA', note: 'private', origin },
    {
      kind: 'mention',
      token: '@Prior',
      label: 'Prior',
      path: '/logs/prior.jsonl',
      referenceLabel: 'Prior',
      note: '',
      origin,
    },
    {
      kind: 'mention',
      token: '@/projects/alpha/private.ts',
      label: 'private.ts',
      path: '/projects/alpha/private.ts',
      note: '',
      origin,
    },
  ]);
  useSessionReferences.getState().record(THREAD_ID, 'Prior', '/logs/prior.jsonl');
  const canSend = renderHook(() => useCanSubmit());
  expect(canSend.result.current).toBe(false);
  const send = renderHook(() => useSubmitComposition());
  live.text = '/review @Prior @/projects/alpha/private.ts';
  act(() => send.result.current(mode));
  expect(appendSpy).toHaveBeenCalledTimes(1);
  expect(appendSpy.mock.calls[0]![0]).toEqual(
    expect.objectContaining({
      content: [{ type: 'text', text: '/review @Prior private.ts' }],
      attachments: [],
    }),
  );
  expect(draftItemsOf(THREAD_ID)).toHaveLength(4);
});

it('keeps legacy context active in its original target and sets it aside when the draft changes projects', () => {
  setDraftConfig(THREAD_ID, { projectId: 'alpha', adapterId: 'claude' });
  const submit = renderHook(useSubmitComposition);
  const canSend = renderHook(useCanSubmit);
  act(() =>
    useDraftContent.getState().add(THREAD_ID, [
      {
        kind: 'code',
        filePath: '/projects/alpha/a.ts',
        startLine: 1,
        endLine: 1,
        lineContent: 'code',
        note: '',
      },
    ]),
  );
  expect(canSend.result.current).toBe(true);
  act(() => setDraftConfig(THREAD_ID, { projectId: 'beta', adapterId: 'claude' }));
  expect(canSend.result.current).toBe(false);
  live.text = 'continue here';
  act(() => submit.result.current());
  expect(appendSpy.mock.calls[0]![0].content).toEqual([{ type: 'text', text: 'continue here' }]);
  act(() => clearDraftConfig(THREAD_ID));
});
