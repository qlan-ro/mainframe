export function parseFrontmatter(content: string): { attributes: Record<string, string>; body: string } {
  const attributes: Record<string, string> = {};

  if (!content.startsWith('---')) {
    return { attributes, body: content };
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { attributes, body: content };
  }

  const frontmatterBlock = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 3).trim();

  for (const line of frontmatterBlock.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key) attributes[key] = value;
  }

  return { attributes, body };
}

export function buildFrontmatter(attrs: Record<string, string>, body: string): string {
  const lines = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}
