import { describe, it, expect } from 'vitest';
import { parseAskUserQuestionResult } from '../parse-ask-user-question.js';
import { ASK_USER_QUESTION_FIXTURE } from '@qlan-ro/mainframe-types';

const PREFIX = 'User has answered your questions: ';
const SUFFIX = ". You can now continue with the user's answers in mind.";

describe('parseAskUserQuestionResult', () => {
  it('parses a single question/answer', () => {
    const s = `${PREFIX}"Which DB?"="Postgres"${SUFFIX}`;
    expect(parseAskUserQuestionResult(s)).toEqual([{ question: 'Which DB?', answer: ['Postgres'] }]);
  });

  it('parses multiple questions', () => {
    const s = `${PREFIX}"Q1"="A1", "Q2"="A2"${SUFFIX}`;
    expect(parseAskUserQuestionResult(s)).toEqual([
      { question: 'Q1', answer: ['A1'] },
      { question: 'Q2', answer: ['A2'] },
    ]);
  });

  it('splits a multi-select answer on commas', () => {
    const s = `${PREFIX}"Pick"="Red,Green,Blue"${SUFFIX}`;
    expect(parseAskUserQuestionResult(s)).toEqual([{ question: 'Pick', answer: ['Red', 'Green', 'Blue'] }]);
  });

  it('captures preview and notes segments', () => {
    const s = `${PREFIX}"Layout?"="Grid" selected preview:\n<div>grid</div> user notes: prefer dense, "Theme?"="Dark"${SUFFIX}`;
    expect(parseAskUserQuestionResult(s)).toEqual([
      { question: 'Layout?', answer: ['Grid'], preview: '<div>grid</div>', notes: 'prefer dense' },
      { question: 'Theme?', answer: ['Dark'] },
    ]);
  });

  it('tolerates answers containing commas inside when no preview/notes follow', () => {
    const s = `${PREFIX}"Name"="Doe, John"${SUFFIX}`;
    expect(parseAskUserQuestionResult(s)).toEqual([{ question: 'Name', answer: ['Doe', 'John'] }]);
  });

  it('captures a preview that uses CRLF before the body', () => {
    const s = `${PREFIX}"Layout?"="Grid" selected preview:\r\n<div/> user notes: dense${SUFFIX}`;
    expect(parseAskUserQuestionResult(s)).toEqual([
      { question: 'Layout?', answer: ['Grid'], preview: '<div/>', notes: 'dense' },
    ]);
  });

  describe('anchored parsing with known questions', () => {
    it('preserves a question whose text contains double quotes (real session data)', () => {
      const q = '"Prepare Release Bugs" is ambiguous to me — what do you want done?';
      const s = `${PREFIX}"${q}"="1. cannot paste/attach images anymore in composer"${SUFFIX}`;
      expect(parseAskUserQuestionResult(s, [{ question: q, multiSelect: false }])).toEqual([
        { question: q, answer: ['1. cannot paste/attach images anymore in composer'] },
      ]);
    });

    it('keeps free-text answers verbatim, including internal commas and quotes (real session data)', () => {
      const q1 = 'When you try to paste or attach an image in the composer, what exactly happens?';
      const q2 = 'Which entry points are broken?';
      const a1 =
        'nothing happens at all, but forgot to mention that i run on that debug/queued-messages branch which also contains latest main';
      const a2 =
        'both, paperclip works until i choose the image i want to upload. once i hit "open" nothing shows up in the composer';
      const s = `${PREFIX}"${q1}"="${a1}", "${q2}"="${a2}"${SUFFIX}`;
      expect(
        parseAskUserQuestionResult(s, [
          { question: q1, multiSelect: false },
          { question: q2, multiSelect: false },
        ]),
      ).toEqual([
        { question: q1, answer: [a1] },
        { question: q2, answer: [a2] },
      ]);
    });

    it('splits multi-select answers by comma only for multiSelect questions', () => {
      const s = `${PREFIX}"Pick"="Red,Blue"${SUFFIX}`;
      expect(
        parseAskUserQuestionResult(s, [
          { question: 'Pick', multiSelect: true, options: [{ label: 'Red' }, { label: 'Blue' }] },
        ]),
      ).toEqual([{ question: 'Pick', answer: ['Red', 'Blue'] }]);
    });

    it('extracts preview and notes on the anchored path', () => {
      const s = `${PREFIX}"Layout?"="Grid" selected preview:\n<div>grid</div> user notes: prefer dense, "Theme?"="Dark"${SUFFIX}`;
      expect(
        parseAskUserQuestionResult(s, [
          { question: 'Layout?', multiSelect: false },
          { question: 'Theme?', multiSelect: false },
        ]),
      ).toEqual([
        { question: 'Layout?', answer: ['Grid'], preview: '<div>grid</div>', notes: 'prefer dense' },
        { question: 'Theme?', answer: ['Dark'] },
      ]);
    });

    it('omits questions the user did not answer', () => {
      const s = `${PREFIX}"Q1"="A1"${SUFFIX}`;
      expect(
        parseAskUserQuestionResult(s, [
          { question: 'Q1', multiSelect: false },
          { question: 'Q2', multiSelect: false },
        ]),
      ).toEqual([{ question: 'Q1', answer: ['A1'] }]);
    });

    it('falls back to legacy parsing when no question matches', () => {
      const s = `${PREFIX}"Different"="X"${SUFFIX}`;
      expect(parseAskUserQuestionResult(s, [{ question: 'Unrelated', multiSelect: false }])).toEqual([
        { question: 'Different', answer: ['X'] },
      ]);
    });
  });

  it('returns [] for non-AskUserQuestion or malformed content, never throws', () => {
    expect(parseAskUserQuestionResult('')).toEqual([]);
    expect(parseAskUserQuestionResult('totally unrelated tool output')).toEqual([]);
    expect(parseAskUserQuestionResult(`${PREFIX}garbage no quotes${SUFFIX}`)).toEqual([]);
  });

  describe('new CLI wording (Your questions have been answered: …)', () => {
    const NEW_PREFIX = 'Your questions have been answered: ';
    const NEW_SUFFIX = '. You can now continue with these answers in mind.';

    it('single question — suffix does not leak into the answer', () => {
      const s = `${NEW_PREFIX}"What size pizza?"="Small"${NEW_SUFFIX}`;
      expect(parseAskUserQuestionResult(s, [{ question: 'What size pizza?' }])).toEqual([
        { question: 'What size pizza?', answer: ['Small'] },
      ]);
    });

    it('multiple questions — each answer is isolated', () => {
      const s = `${NEW_PREFIX}"Q1"="A1", "Q2"="A2"${NEW_SUFFIX}`;
      expect(
        parseAskUserQuestionResult(s, [
          { question: 'Q1', multiSelect: false },
          { question: 'Q2', multiSelect: false },
        ]),
      ).toEqual([
        { question: 'Q1', answer: ['A1'] },
        { question: 'Q2', answer: ['A2'] },
      ]);
    });

    it('no questions arg (legacy/regex path) — suffix is still stripped', () => {
      const s = `${NEW_PREFIX}"What size pizza?"="Small"${NEW_SUFFIX}`;
      expect(parseAskUserQuestionResult(s)).toEqual([{ question: 'What size pizza?', answer: ['Small'] }]);
    });

    it('old wording still parses correctly (regression guard)', () => {
      const s = `User has answered your questions: "What size pizza?"="Small". You can now continue with the user's answers in mind.`;
      expect(parseAskUserQuestionResult(s, [{ question: 'What size pizza?' }])).toEqual([
        { question: 'What size pizza?', answer: ['Small'] },
      ]);
    });

    it('unrecognised prefix returns []', () => {
      expect(parseAskUserQuestionResult('User skipped the question')).toEqual([]);
    });
  });

  it('parser output for the canonical CLI string equals the shared fixture', () => {
    const s =
      'User has answered your questions: "Which DB?"="Postgres", "Pick"="Red,Blue" user notes: dense' +
      ". You can now continue with the user's answers in mind.";
    expect(parseAskUserQuestionResult(s)).toEqual(ASK_USER_QUESTION_FIXTURE);
  });
});
