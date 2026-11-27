import { searchItemId } from '../find/search-item';
import '../transcript.css';
/**
 * Markdown for the transcript, rendered by Streamdown.
 *
 * Streamdown splits the text into top-level blocks and memoizes each one, so
 * while a reply streams only its last block is parsed and rendered again; the
 * finished blocks above it keep their elements (and any selection in them).
 * While running it also closes unfinished syntax (an open fence, `**bold`, a
 * link cut mid-URL) so the tail renders as what it is becoming.
 *
 * Every element goes through `markdownComponents`, which keeps the warm-chrome
 * look. Streamdown's own renderers, controls and HTML plugins are all replaced:
 * raw HTML shows as text, as it did with react-markdown, and `urlTransform`
 * stays the one URL sanitiser. The plain react-markdown surfaces (user bubbles,
 * plan gate, review comments, sub-agent text) reuse the same map.
 *
 * `MarkdownText` is the reply's text part: the typing reveal (`useSmoothText`)
 * over `MarkdownBody`, held while a selection sits inside it.
 */
import { createElement, useEffect, useRef, type ComponentType, type FC } from 'react';
import { useAui, useAuiState, type TextMessagePartComponent } from '@assistant-ui/react';
import remarkGfm from 'remark-gfm';
import { Streamdown } from 'streamdown';
import type { PluggableList } from 'unified';
import { cn } from '@/lib/utils';
import { INSTRUCTION_ATTR, remarkSmartActions } from '../smart-actions/remark-smart-actions';
import { SmartActionsProvider } from '../smart-actions/smart-actions-context';
import { useInstructionChipForToken } from '../smart-actions/use-instruction-chip';
import { InstructionChip } from '../smart-actions/InstructionChip';
import { SmartLink } from '../smart-actions/SmartLink';
import { MarkdownImage } from './MarkdownImage';
import { urlTransform, remarkAppLinks } from './markdown-url-transform';
import { MarkdownInlineCode, MarkdownPre } from './markdown-code';
import { MarkdownUl, MarkdownOl, MarkdownLi, MarkdownTaskCheckbox } from './markdown-lists';
import { MarkdownTable, MarkdownThead, MarkdownTh, MarkdownTd, MarkdownTr } from './markdown-table';
import { useSelectionHold, recheckHeld } from './selection-hold';
import { hasFootnoteSyntax, splitFootnoteBlocks } from './split-blocks';
import { useSmoothText } from './use-smooth-text';

// ── Instruction marker span ───────────────────────────────────────────────────
// remarkSmartActions wraps each prose instruction in a span carrying its token.
// Nothing else emits `span` (no raw HTML), so every other case is a passthrough.

function SmartActionSpan({ children, ...props }: React.ComponentProps<'span'>) {
  const marker = (props as Record<string, unknown>)[INSTRUCTION_ATTR];
  const chip = useInstructionChipForToken(typeof marker === 'string' ? marker : undefined);
  if (chip) return <InstructionChip target={chip} />;
  // Unresolved token: the text exactly as it arrived, with no wrapper element.
  return <>{children}</>;
}

// ── Component map ─────────────────────────────────────────────────────────────

/** Any element's props, as both parsers pass them: assignable from every tag's. */
type Props = { node?: unknown; className?: string };

/** Both parsers pass the hast `node` to every component; it must not reach the DOM. */
function withoutNode<P extends object>(Component: ComponentType<P> | string, className?: string) {
  const Rendered = ({ node: _node, ...props }: Props) =>
    createElement(Component, {
      ...props,
      ...(className ? { className: cn(className, props.className) } : {}),
    } as P);
  Rendered.displayName = typeof Component === 'string' ? `Markdown.${Component}` : Component.displayName;
  return Rendered;
}

export const markdownComponents = {
  // Sizes stay on the native scale: no heading above 15 px (T1b).
  h1: withoutNode('h1', 'aui-md-h1 mf-tr-h1 first:mt-0'),
  h2: withoutNode('h2', 'aui-md-h2 mf-tr-h2 first:mt-0'),
  h3: withoutNode('h3', 'aui-md-h3 mf-tr-h3 first:mt-0'),
  h4: withoutNode('h4', 'aui-md-h4 mf-tr-h4 first:mt-0'),
  h5: withoutNode('h5'),
  h6: withoutNode('h6'),
  p: withoutNode('p', 'aui-md-p my-2 first:mt-0 last:mb-0'),
  a: withoutNode(SmartLink as FC<React.AnchorHTMLAttributes<HTMLAnchorElement>>),
  img: withoutNode(MarkdownImage),
  blockquote: withoutNode(
    'blockquote',
    'aui-md-blockquote my-2.5 border-s-[3px] border-input ps-3.5 text-muted-foreground',
  ),
  ul: withoutNode(MarkdownUl),
  ol: withoutNode(MarkdownOl),
  li: withoutNode(MarkdownLi),
  input: withoutNode(MarkdownTaskCheckbox),
  hr: withoutNode('hr', 'aui-md-hr mt-4 mb-2 border-border'),
  table: withoutNode(MarkdownTable),
  thead: withoutNode(MarkdownThead),
  tbody: withoutNode('tbody'),
  th: withoutNode(MarkdownTh),
  td: withoutNode(MarkdownTd),
  tr: withoutNode(MarkdownTr),
  strong: withoutNode('strong', 'aui-md-strong font-semibold'),
  del: withoutNode('del', 'aui-md-del line-through text-muted-foreground'),
  sup: withoutNode('sup'),
  sub: withoutNode('sub'),
  section: withoutNode('section'),
  pre: withoutNode(MarkdownPre),
  code: withoutNode(MarkdownInlineCode),
  span: withoutNode(SmartActionSpan),
};

// v1's uniform `tracking-tight` is gone: it was a warm-chrome choice, and v2
// prose runs at the stock tracking its 13px body rung was measured for.
export const MARKDOWN_ROOT_CLASS = 'aui-md';

const REPLY_PLUGINS: PluggableList = [remarkGfm, remarkAppLinks, remarkSmartActions];
/** No raw HTML, so nothing to sanitise: HTML in a reply shows as text. */
const NO_REHYPE_PLUGINS: PluggableList = [];
const NO_LINK_SAFETY = { enabled: false };

interface MarkdownBodyProps {
  text: string;
  /** The text is still streaming: close unfinished syntax at its end. */
  running?: boolean;
  remarkPlugins?: PluggableList;
}

export function MarkdownBody({ text, running = false, remarkPlugins = REPLY_PLUGINS }: MarkdownBodyProps) {
  return (
    <Streamdown
      className={MARKDOWN_ROOT_CLASS}
      components={markdownComponents}
      remarkPlugins={remarkPlugins}
      rehypePlugins={NO_REHYPE_PLUGINS}
      urlTransform={urlTransform}
      parseIncompleteMarkdown={running}
      // Streamdown's root is memoized and its comparator ignores `parseIncompleteMarkdown`
      // but compares `data-*`: this is what re-renders a settled reply without the repair.
      data-running={running}
      // Only when needed: Streamdown's own splitter also repairs the stream's tail incrementally.
      parseMarkdownIntoBlocksFn={hasFootnoteSyntax(text) ? splitFootnoteBlocks : undefined}
      controls={false}
      linkSafety={NO_LINK_SAFETY}
    >
      {text}
    </Streamdown>
  );
}

// ── MarkdownText: TextMessagePartComponent ────────────────────────────────────

export const MarkdownText: TextMessagePartComponent = (props) => {
  const text = useAuiState((s) => (s.part.type === 'text' || s.part.type === 'reasoning' ? s.part.text : ''));
  const running = useAuiState((s) => s.part.status.type === 'running');
  // The part scope's identity, not its state: another part reusing this element.
  const aui = useAui();
  const part = useAuiState(() => aui.part);
  // `data-text-part` marks the searchable container for in-chat Find and the
  // selection hold.
  const containerRef = useRef<HTMLDivElement>(null);
  const held = useSelectionHold(containerRef);
  const shown = useSmoothText(text, running, { paused: held, part });
  // WebKit does not always fire `selectionchange` for a programmatic change
  // (`removeAllRanges()` after Quote), so a re-render re-checks the hold.
  useEffect(() => {
    if (held && containerRef.current) recheckHeld(containerRef.current);
  }, [held, text]);
  return (
    <div data-text-part data-search-item-id={searchItemId(props)} ref={containerRef}>
      <SmartActionsProvider>
        <MarkdownBody text={shown} running={running} />
      </SmartActionsProvider>
    </div>
  );
};
MarkdownText.displayName = 'MarkdownText';
