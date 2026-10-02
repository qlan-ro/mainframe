import { describe, expect, it } from 'vitest';
import { PresentationSourcesSchema, TranscriptPresentationSchema } from '../transcript-presentation.js';

const context = { version: 1, provider: 'codex', turnId: 'thread/turn', state: 'running', finalEligible: false };

describe('optional authoritative presentation', () => {
  it('preserves explicit identity, phase, eligibility and verified timing', () => {
    const value = {
      ...context,
      phase: 'final_answer',
      finalEligible: true,
      timing: { startedAtMs: 10, durationMs: 5 },
    };
    expect(TranscriptPresentationSchema.parse(value)).toEqual(value);
    expect(TranscriptPresentationSchema.parse(context).phase).toBeUndefined();
  });

  it.each([
    { version: 2 },
    { provider: '' },
    { turnId: '' },
    { phase: 'answer' },
    { state: 'done' },
    { finalEligible: 'true' },
    { timing: { durationMs: -1 } },
    { timing: { startedAtMs: 20, completedAtMs: 10 } },
  ])('rejects unsupported context %j', (patch) => {
    expect(TranscriptPresentationSchema.safeParse({ ...context, ...patch }).success).toBe(false);
  });

  it('retains UTF16 spans independently inside one coalesced block', () => {
    const source = { sourceMessageId: 'a', sourceBlockIndex: 0, presentation: context, streaming: false };
    const value = {
      version: 1,
      sources: [
        { ...source, target: { type: 'text', contentBlockIndex: 0, startUtf16: 0, endUtf16: 3 } },
        { ...source, sourceMessageId: 'b', target: { type: 'text', contentBlockIndex: 0, startUtf16: 3, endUtf16: 5 } },
      ],
    };
    expect(PresentationSourcesSchema.parse(value)).toEqual(value);
  });

  it('rejects backwards and nonintegral spans', () => {
    const source = { sourceMessageId: 'a', sourceBlockIndex: 0, presentation: context };
    for (const target of [
      { type: 'text', contentBlockIndex: 0, startUtf16: 3, endUtf16: 1 },
      { type: 'text', contentBlockIndex: 0, startUtf16: 0.5, endUtf16: 1 },
    ])
      expect(PresentationSourcesSchema.safeParse({ version: 1, sources: [{ ...source, target }] }).success).toBe(false);
  });
});

describe('presentation is independent optional metadata', () => {
  it('keeps authoritative streaming and container identity when presentation is malformed', async () => {
    const { ItemMetaSchema } = await import('../acp/extensions-payload.js');
    const parsed = ItemMetaSchema.parse({
      streaming: true,
      containerId: 'legacy',
      presentationSources: { version: 9 },
    });
    expect(parsed.streaming).toBe(true);
    expect(parsed.containerId).toBe('legacy');
    expect(parsed.presentationSources).toBeUndefined();
  });
});
