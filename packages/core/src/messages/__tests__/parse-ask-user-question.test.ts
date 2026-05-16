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

  it('returns [] for non-AskUserQuestion or malformed content, never throws', () => {
    expect(parseAskUserQuestionResult('')).toEqual([]);
    expect(parseAskUserQuestionResult('totally unrelated tool output')).toEqual([]);
    expect(parseAskUserQuestionResult(`${PREFIX}garbage no quotes${SUFFIX}`)).toEqual([]);
  });

  it('parser output for the canonical CLI string equals the shared fixture', () => {
    const s =
      'User has answered your questions: "Which DB?"="Postgres", "Pick"="Red,Blue" user notes: dense' +
      ". You can now continue with the user's answers in mind.";
    expect(parseAskUserQuestionResult(s)).toEqual(ASK_USER_QUESTION_FIXTURE);
  });
});
