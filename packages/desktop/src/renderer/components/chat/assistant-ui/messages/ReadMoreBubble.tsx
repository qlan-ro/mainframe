import React, { useState } from 'react';
import { cn } from '../../../../lib/utils.js';

const CHAR_THRESHOLD = 600;

interface ReadMoreBubbleProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps user-message bubble content with a WhatsApp-style "Read more / Show less"
 * toggle when the text exceeds CHAR_THRESHOLD characters. The bubble is clamped to
 * 6 lines via Tailwind's line-clamp-6, with a fade-out gradient.
 *
 * Only the character-length heuristic is used here because jsdom has no layout
 * engine to measure rendered line height. The component falls through to the
 * untruncated path for short content.
 */
export function ReadMoreBubble({ children, className }: ReadMoreBubbleProps) {
  const [expanded, setExpanded] = useState(false);

  const textLength = extractTextLength(children);
  const needsToggle = textLength > CHAR_THRESHOLD;
  const collapsed = needsToggle && !expanded;

  return (
    <div className={cn('relative', className)}>
      <div
        data-clamp={needsToggle ? '' : undefined}
        data-text-part
        className={cn('aui-md text-mf-chat text-mf-text-primary', collapsed && 'line-clamp-6')}
      >
        {children}
      </div>

      {collapsed && (
        <div className="pointer-events-none absolute bottom-6 left-0 right-0 h-8 bg-gradient-to-b from-transparent to-mf-hover" />
      )}

      {needsToggle && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-mf-accent text-mf-small font-medium hover:underline"
          aria-label={expanded ? 'Show less' : 'Read more'}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}

function extractTextLength(node: React.ReactNode): number {
  if (typeof node === 'string') return node.length;
  if (typeof node === 'number') return String(node).length;
  if (Array.isArray(node)) return node.reduce<number>((acc, child) => acc + extractTextLength(child), 0);
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return extractTextLength(props.children);
  }
  return 0;
}
