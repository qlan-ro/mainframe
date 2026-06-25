/**
 * Behavior tests for assembleAnswers (TDD red phase).
 *
 * The source module `../answers` does not exist yet. These tests define the
 * observable contract for assembleAnswers:
 *
 *  - single-select: stores first selected label as a plain string.
 *  - multi-select: stores all selected labels as a string array.
 *  - OTHER sentinel: replaced by the trimmed otherText entry.
 *  - OTHER with blank otherText: filtered out → yields '' for single-select.
 *  - two questions: both keys are present in the result.
 *
 * All expected values are hardcoded. The test never recomputes the answer by
 * iterating selections — it states the concrete outcome directly.
 */
import { describe, it, expect } from 'vitest';
import { assembleAnswers, OTHER } from '../answers';
import type { AskQuestion } from '../answers';

// ---------------------------------------------------------------------------
// 1. OTHER constant has the sentinel value
// ---------------------------------------------------------------------------

describe('OTHER', () => {
  it('is the string "__other__"', () => {
    expect(OTHER).toBe('__other__');
  });
});

// ---------------------------------------------------------------------------
// 2. Single-select: selected label stored as a plain string
// ---------------------------------------------------------------------------

describe('assembleAnswers — single-select', () => {
  it('returns the selected label as a plain string under the question text key', () => {
    const questions: AskQuestion[] = [{ question: 'Format', options: [{ label: 'MP4' }, { label: 'GIF' }] }];
    const selections = new Map([[0, new Set(['MP4'])]]);
    const otherText = new Map<number, string>();

    expect(assembleAnswers(questions, selections, otherText)).toEqual({ Format: 'MP4' });
  });
});

// ---------------------------------------------------------------------------
// 3. Multi-select: all selected labels stored as an array
// ---------------------------------------------------------------------------

describe('assembleAnswers — multi-select', () => {
  it('returns all selected labels as a string array under the question text key', () => {
    const questions: AskQuestion[] = [
      { question: 'Tags', multiSelect: true, options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] },
    ];
    const selections = new Map([[0, new Set(['a', 'b'])]]);
    const otherText = new Map<number, string>();

    expect(assembleAnswers(questions, selections, otherText)).toEqual({ Tags: ['a', 'b'] });
  });
});

// ---------------------------------------------------------------------------
// 4. OTHER selected (single-select): replaced by trimmed otherText
// ---------------------------------------------------------------------------

describe('assembleAnswers — OTHER sentinel with text', () => {
  it('replaces the OTHER sentinel with the trimmed otherText value', () => {
    const questions: AskQuestion[] = [{ question: 'Why', options: [{ label: 'X' }] }];
    const selections = new Map([[0, new Set([OTHER])]]);
    const otherText = new Map([[0, 'because reasons']]);

    expect(assembleAnswers(questions, selections, otherText)).toEqual({ Why: 'because reasons' });
  });
});

// ---------------------------------------------------------------------------
// 5. OTHER selected but otherText blank → filtered out → empty string result
// ---------------------------------------------------------------------------

describe('assembleAnswers — OTHER sentinel with blank text', () => {
  it('filters out the empty replacement and yields an empty string for single-select', () => {
    const questions: AskQuestion[] = [{ question: 'Why', options: [{ label: 'X' }] }];
    const selections = new Map([[0, new Set([OTHER])]]);
    const otherText = new Map([[0, '   ']]);

    expect(assembleAnswers(questions, selections, otherText)).toEqual({ Why: '' });
  });
});

// ---------------------------------------------------------------------------
// 6. Two questions → both keys present in the result
// ---------------------------------------------------------------------------

describe('assembleAnswers — two questions', () => {
  it('includes a key for every question, each with the correct selected value', () => {
    const questions: AskQuestion[] = [
      { question: 'Format', options: [{ label: 'MP4' }, { label: 'GIF' }] },
      { question: 'Quality', options: [{ label: 'High' }, { label: 'Low' }] },
    ];
    const selections = new Map([
      [0, new Set(['GIF'])],
      [1, new Set(['High'])],
    ]);
    const otherText = new Map<number, string>();

    expect(assembleAnswers(questions, selections, otherText)).toEqual({
      Format: 'GIF',
      Quality: 'High',
    });
  });
});
