/**
 * Markdown renderer for assistant text parts.
 *
 * Wires MarkdownTextPrimitive from @assistant-ui/react-markdown with:
 *   - remarkGfm: tables, strikethrough, task lists, footnotes
 *   - remarkAppLinks: bare app-protocol URLs → clickable links
 *   - remarkSmartActions: slash instructions → marker spans the `span` override chips
 *   - urlTransform: extends default URL sanitiser to allow app schemes
 *   - markdownComponents: warm-chrome styled component overrides
 *   - SyntaxHighlighter slot: shiki-based token highlighter on mf-code-* tokens
 *   - CodeHeader slot: language label + copy button (data-testid chat-code-copy)
 *   - markdown-lists.tsx: ul/ol/li markers + task-list checkbox visual
 *   - markdown-table.tsx: table/thead/th/td/tr components
 *
 * Code-block layout follows the native single path:
 *   primitive detects fenced block → calls CodeHeader slot, then SyntaxHighlighter slot.
 * Both slots run for every fence, tagged or not (a language-less fence arrives
 * as language "unknown"), so CodeHeader is the one seam that emits the block
 * chip for a single-instruction fence and SyntaxHighlighter suppresses the body.
 * The `code` override here handles inline code.
 *
 * `MarkdownText` is the `TextMessagePartComponent` wired into AssistantMessage.
 * `markdownComponents` is exported separately so UserMessage can reuse it.
 */
import React, { memo, useCallback, useRef, type FC } from 'react';
import type { TextMessagePartComponent } from '@assistant-ui/react';
import { useAuiState } from '@assistant-ui/react';
import {
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import type { Pluggable } from 'unified';
import { cn } from '@/lib/utils';
import { InstructionChip } from '../smart-actions/InstructionChip';
import { INSTRUCTION_ATTR, remarkSmartActions } from '../smart-actions/remark-smart-actions';
import { SmartActionsProvider } from '../smart-actions/smart-actions-context';
import { useInstructionChipForLine, useInstructionChipForToken } from '../smart-actions/use-instruction-chip';
import { SmartLink } from '../smart-actions/SmartLink';
import { urlTransform, remarkAppLinks } from './markdown-url-transform';
import { SyntaxHighlighter } from './syntax-highlight';
import { CodeHeader } from './CodeHeader';
import { MarkdownUl, MarkdownOl, MarkdownLi, MarkdownTaskCheckbox } from './markdown-lists';
import { MarkdownTable, MarkdownThead, MarkdownTh, MarkdownTd, MarkdownTr } from './markdown-table';
import { useSelectionHold } from './selection-hold';

// ── Inline code ───────────────────────────────────────────────────────────────
// Handles inline `code` spans. Fenced code blocks are handled by the native
// CodeHeader + SyntaxHighlighter slots (registered at the bottom of
// markdownComponents); those slots are always called for block-level code.

function Code({ className, children, ...props }: React.ComponentProps<'code'>) {
  const isCodeBlock = useIsMarkdownCodeBlock();
  const chip = useInstructionChipForLine(children);

  if (isCodeBlock) {
    // Reached only when a fence's children are not one string (`CodeOverride`
    // routes every normal fence body to SyntaxHighlighter instead). CodeHeader
    // has already emitted the chip, so printing the instruction here repeats it.
    if (chip) return null;
    // The primitive owns the block layout — just pass through so CodeHeader and
    // SyntaxHighlighter slots receive the fully-assembled pre+code children.
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  if (chip) return <InstructionChip target={chip} />;

  return (
    <code
      className={cn(
        'aui-md-inline-code',
        // `mf-code-inline-fg` stays: the code palette is deliberately
        // bridge-owned (see the v2 ledger), unlike the surface it sits on.
        'bg-muted text-mf-code-inline-fg',
        'rounded-sm border border-border px-1.5 py-0.5',
        'font-mono text-xs',
        className,
      )}
      {...props}
    >
      {children}
    </code>
  );
}

// ── Instruction marker span ───────────────────────────────────────────────────
// remarkSmartActions wraps each prose instruction in a span carrying its token.
// `unstable_memoizeMarkdownComponents` strips `node`, so that DOM prop is the
// only channel from the plugin to this seam. Nothing else in the chat pipeline
// emits `span` (no rehype-raw), so every other case is a passthrough.

function SmartActionSpan({ children, ...props }: React.ComponentProps<'span'>) {
  const marker = (props as Record<string, unknown>)[INSTRUCTION_ATTR];
  const chip = useInstructionChipForToken(typeof marker === 'string' ? marker : undefined);

  if (chip) return <InstructionChip target={chip} />;
  // Unresolved token: render the text exactly as it arrived, with no wrapper
  // element, so a negative is byte-for-byte the pre-feature output.
  return <>{children}</>;
}

// ── Component map ─────────────────────────────────────────────────────────────

export const markdownComponents = unstable_memoizeMarkdownComponents({
  // All heading levels share one flat top margin (mt-0.5). On the v2 scale the
  // top two levels carry the size step (18/16) and the bottom two the weight
  // step, since `text-sm` (13px) is the body rung and nothing sits between.
  h1: ({ className, ...props }) => (
    <h1 className={cn('aui-md-h1 text-lg font-bold mt-0.5 mb-2 first:mt-0', className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn('aui-md-h2 text-base font-bold mt-0.5 mb-1.5 first:mt-0', className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn('aui-md-h3 text-sm font-bold mt-0.5 mb-1 first:mt-0', className)} {...props} />
  ),
  h4: ({ className, ...props }) => (
    <h4 className={cn('aui-md-h4 text-sm font-semibold mt-0.5 mb-1 first:mt-0', className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cn('aui-md-p my-2.5 leading-relaxed first:mt-0 last:mb-0', className)} {...props} />
  ),
  a: SmartLink as FC<React.AnchorHTMLAttributes<HTMLAnchorElement>>,
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        'aui-md-blockquote border-s-[3px] border-primary/40 text-muted-foreground',
        'my-2.5 ps-3.5 italic',
        className,
      )}
      {...props}
    />
  ),
  ul: MarkdownUl,
  ol: MarkdownOl,
  li: MarkdownLi,
  input: MarkdownTaskCheckbox as FC<React.ComponentProps<'input'>>,
  hr: ({ className, ...props }) => <hr className={cn('aui-md-hr border-border my-0.5', className)} {...props} />,
  table: MarkdownTable,
  thead: MarkdownThead,
  th: MarkdownTh,
  td: MarkdownTd,
  tr: MarkdownTr,
  strong: ({ className, ...props }) => <strong className={cn('aui-md-strong font-semibold', className)} {...props} />,
  del: ({ className, ...props }) => (
    <del className={cn('aui-md-del line-through text-muted-foreground', className)} {...props} />
  ),
  // pre is rendered inside the primitive's block layout — suppress the default wrapper
  pre: ({ children }) => <>{children}</>,
  // code handles only inline spans; the primitive routes fenced blocks to
  // the CodeHeader + SyntaxHighlighter slots below.
  code: Code,
  span: SmartActionSpan,
  // Fenced code-block slots: primitive calls CodeHeader first, then SyntaxHighlighter.
  // Together they render the header bar + shiki-highlighted <pre> exactly once.
  SyntaxHighlighter,
  CodeHeader,
});

// ── remark plugin set (stable reference — must not be defined inline) ─────────

const REMARK_PLUGINS: Pluggable[] = [remarkGfm, remarkAppLinks, remarkSmartActions];

// v1's uniform `tracking-tight` is gone: it was a warm-chrome choice, and v2
// prose runs at the stock tracking its 13px body rung was measured for.
export const MARKDOWN_ROOT_CLASS = 'aui-md';

// ── MarkdownText: TextMessagePartComponent ────────────────────────────────────

/**
 * Holds this part's text at its last snapshot while a non-collapsed selection
 * intersects it — see `selection-hold.ts`'s module doc for the mechanism this
 * guards against. `useAuiState` (not the deprecated `useMessagePartText`)
 * gives the same live `{ text, status }` the primitive's own internal
 * subscription reads, so we can decide "hold or not" without touching
 * `useSmooth` itself: `preprocess` (an `@assistant-ui/react-markdown` prop
 * that runs BEFORE `useSmooth` sees the text) swaps in the frozen snapshot
 * instead. Dropping `effectivelyHeld` the instant the part completes — even
 * if the selection itself is still up — is required, not optional: once a
 * part is done streaming, nothing will ever trigger another render that
 * could release the hold on its own, so staying frozen past completion would
 * strand the user on a truncated snapshot forever.
 *
 * Freezing the INPUT alone is not enough: `useSmooth`'s own reveal timer
 * keeps ticking forward toward whatever text it was LAST given, independent
 * of whether that text is still growing — a selection made mid-reveal of the
 * settle-delayed final snippet (D7; no new text ever arrives after) would
 * still see the in-progress reveal replace the node's data tick by tick. So
 * `smooth` itself also drops to `false` while held: combined with the frozen
 * snapshot, the primitive has nothing left to animate toward and renders the
 * snapshot statically until release, when `smooth` flips back on to animate
 * the catch-up.
 */
function useHeldText(containerRef: React.RefObject<HTMLDivElement | null>): {
  preprocess: (text: string) => string;
  smooth: boolean;
} {
  const held = useSelectionHold(containerRef);
  const part = useAuiState((s) => (s.part.type === 'text' || s.part.type === 'reasoning' ? s.part : null));
  const effectivelyHeld = held && part?.status?.type !== 'complete';
  const frozenTextRef = useRef<string | null>(null);

  const preprocess = useCallback(
    (text: string) => {
      if (!effectivelyHeld) {
        frozenTextRef.current = null;
        return text;
      }
      if (frozenTextRef.current === null) frozenTextRef.current = text;
      return frozenTextRef.current;
    },
    // A fresh callback identity on every hold/release flip is the point: it
    // is what forces `MarkdownTextPrimitive`'s internal `useMemo` to
    // re-evaluate `preprocess` even when the live text itself hasn't
    // changed since the last render (e.g. the selection just started).
    [effectivelyHeld],
  );
  return { preprocess, smooth: !effectivelyHeld };
}

const MarkdownTextImpl: TextMessagePartComponent = () => {
  // `data-text-part` marks the searchable text container for in-chat Find
  // (FindBar walks [data-message-id] → [data-text-part]). The wrapper guarantees
  // the attribute lands on a real DOM node regardless of primitive prop-forwarding.
  const containerRef = useRef<HTMLDivElement>(null);
  const { preprocess, smooth } = useHeldText(containerRef);
  return (
    <div data-text-part ref={containerRef}>
      <SmartActionsProvider>
        <MarkdownTextPrimitive
          className={MARKDOWN_ROOT_CLASS}
          remarkPlugins={REMARK_PLUGINS}
          urlTransform={urlTransform}
          smooth={smooth}
          components={markdownComponents}
          preprocess={preprocess}
        />
      </SmartActionsProvider>
    </div>
  );
};

export const MarkdownText: TextMessagePartComponent = memo(MarkdownTextImpl);
MarkdownText.displayName = 'MarkdownText';
