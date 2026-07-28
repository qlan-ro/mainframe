/**
 * Splits a raw SKILL.md body into its optional YAML frontmatter and the rest,
 * so the inspect view can separate the two without rendering markdown.
 *
 * Only a block that opens on the very first line counts: a `---` further down
 * is a horizontal rule, and an unterminated opener is body text the user still
 * needs to read.
 */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface SkillContent {
  frontmatter: string | null;
  body: string;
}

export function parseSkillContent(raw: string): SkillContent {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { frontmatter: null, body: raw };
  return { frontmatter: match[1], body: raw.slice(match[0].length) };
}
