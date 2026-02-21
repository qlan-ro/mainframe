import { describe, it, expect } from 'vitest';
import { parseFrontmatter, buildFrontmatter } from '../adapters/frontmatter.js';

describe('parseFrontmatter', () => {
  it('returns empty attributes and full content when no frontmatter', () => {
    const { attributes, body } = parseFrontmatter('Just a body.');
    expect(attributes).toEqual({});
    expect(body).toBe('Just a body.');
  });

  it('parses standard key-value frontmatter', () => {
    const input = '---\nname: My Skill\ndescription: Does things\n---\n\nBody here.';
    const { attributes, body } = parseFrontmatter(input);
    expect(attributes['name']).toBe('My Skill');
    expect(attributes['description']).toBe('Does things');
    expect(body).toBe('Body here.');
  });

  it('returns empty attributes if closing --- is missing', () => {
    const { attributes, body } = parseFrontmatter('---\nname: broken\n');
    expect(attributes).toEqual({});
    expect(body).toBe('---\nname: broken\n');
  });

  it('handles values with colons', () => {
    const { attributes } = parseFrontmatter('---\nurl: http://example.com\n---\n');
    expect(attributes['url']).toBe('http://example.com');
  });

  it('skips lines without colons', () => {
    const { attributes } = parseFrontmatter('---\nno-colon-line\nname: valid\n---\n');
    expect(attributes['name']).toBe('valid');
    expect(Object.keys(attributes)).toHaveLength(1);
  });

  it('trims whitespace from keys and values', () => {
    const { attributes } = parseFrontmatter('---\n  name :  My Skill  \n---\n');
    expect(attributes['name']).toBe('My Skill');
  });
});

describe('buildFrontmatter', () => {
  it('produces parseable output (round-trip)', () => {
    const attrs = { name: 'Test Skill', description: 'A description' };
    const body = 'The skill content.';
    const built = buildFrontmatter(attrs, body);
    const { attributes, body: parsedBody } = parseFrontmatter(built);
    expect(attributes).toEqual(attrs);
    expect(parsedBody).toBe(body);
  });

  it('handles empty attributes', () => {
    const built = buildFrontmatter({}, 'Body only.');
    const { attributes, body } = parseFrontmatter(built);
    expect(attributes).toEqual({});
    expect(body).toBe('Body only.');
  });
});
