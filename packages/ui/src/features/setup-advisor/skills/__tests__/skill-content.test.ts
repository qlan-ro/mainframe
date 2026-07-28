/**
 * Contract for splitting a raw SKILL.md body into an optional YAML
 * frontmatter block and the remaining body (plan T23).
 */
import { describe, it, expect } from 'vitest';
import { parseSkillContent } from '../skill-content';

describe('parseSkillContent', () => {
  it('splits a leading frontmatter block off from the body', () => {
    const raw = '---\nname: review\ndescription: reviews code\n---\nBody text here';

    expect(parseSkillContent(raw)).toEqual({
      frontmatter: 'name: review\ndescription: reviews code',
      body: 'Body text here',
    });
  });

  it('returns null frontmatter and the whole input as body when there is no leading delimiter', () => {
    const raw = 'Just a plain markdown body, no frontmatter.';

    expect(parseSkillContent(raw)).toEqual({ frontmatter: null, body: raw });
  });

  it('does not treat a `---` appearing only mid-body as frontmatter', () => {
    const raw = 'Intro paragraph.\n---\nMore text after a horizontal rule.';

    expect(parseSkillContent(raw)).toEqual({ frontmatter: null, body: raw });
  });

  it('treats an unterminated opening `---` as no frontmatter, returning the whole input as body', () => {
    const raw = '---\nname: review\nthere is no closing delimiter';

    expect(parseSkillContent(raw)).toEqual({ frontmatter: null, body: raw });
  });

  it('splits frontmatter correctly across CRLF line endings', () => {
    const raw = '---\r\nname: review\r\n---\r\nBody text';

    expect(parseSkillContent(raw)).toEqual({ frontmatter: 'name: review', body: 'Body text' });
  });

  it('returns null frontmatter and empty body for an empty string', () => {
    expect(parseSkillContent('')).toEqual({ frontmatter: null, body: '' });
  });
});
