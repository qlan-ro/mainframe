import React from 'react';

// Re-export pure functions from core
export {
  COMMAND_NAME_RE,
  ATTACHED_FILE_PATH_RE,
  IMAGE_COORDINATE_NOTE_RE,
  parseCommandMessage,
  resolveSkillName,
  parseRawCommand,
  decodeXmlAttr,
  parseAttachedFilePathTags,
  formatTurnDuration,
} from '@mainframe/core/messages';

export const MENTION_RE = /(?:^|\s)(@[\w.\/\-]+)/g;
export const PLAN_PREFIX = 'Implement the following plan:\n\n';

export function renderHighlights(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let offset = 0;

  const cmdMatch = text.match(/^\/[\w:.\/-]+/);
  if (cmdMatch) {
    parts.push(
      <span key="cmd" className="text-mf-accent">
        {cmdMatch[0]}
      </span>,
    );
    offset = cmdMatch[0].length;
  }

  const rest = text.slice(offset);
  let lastIdx = 0;
  for (const m of rest.matchAll(/(@[\w.\/\-]+)/g)) {
    const idx = m.index!;
    if (idx > 0 && !/\s/.test(rest[idx - 1]!)) continue;
    if (idx > lastIdx) parts.push(rest.slice(lastIdx, idx));
    parts.push(
      <span key={offset + idx} className="text-mf-accent">
        {m[0]}
      </span>,
    );
    lastIdx = idx + m[0].length;
  }
  if (lastIdx < rest.length) parts.push(rest.slice(lastIdx));

  return parts;
}

export function highlightMentions(children: React.ReactNode): React.ReactNode {
  if (typeof children === 'string') {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    for (const match of children.matchAll(MENTION_RE)) {
      const mention = match[1]!;
      const mentionStart = match.index! + match[0].indexOf(mention);
      if (mentionStart > lastIndex) {
        parts.push(children.slice(lastIndex, mentionStart));
      }
      parts.push(
        <span key={mentionStart} className="font-semibold bg-mf-accent/15 text-mf-accent px-1 py-0.5 rounded">
          {mention}
        </span>,
      );
      lastIndex = mentionStart + mention.length;
    }
    if (lastIndex < children.length) parts.push(children.slice(lastIndex));
    return parts.length > 0 ? parts : children;
  }
  if (Array.isArray(children))
    return children.map((c, i) => <React.Fragment key={i}>{highlightMentions(c)}</React.Fragment>);
  return children;
}
