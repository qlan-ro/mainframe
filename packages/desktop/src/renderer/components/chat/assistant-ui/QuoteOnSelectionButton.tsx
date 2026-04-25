import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Quote } from 'lucide-react';
import { useComposerRuntime } from '@assistant-ui/react';
import { focusComposerInput } from '../../../lib/focus';
import { createLogger } from '../../../lib/logger';

const log = createLogger('renderer:quote-on-selection');

const THREAD_SELECTOR = '[data-mf-chat-thread]';
const COMPOSER_INPUT_SELECTOR = '[data-mf-composer-input]';
const BUTTON_OFFSET_Y = 8;
const BUTTON_HEIGHT = 28;

type ButtonPosition = { top: number; left: number };

function isWithinThread(node: Node | null): boolean {
  if (!node) return false;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return false;
  if (el.closest(COMPOSER_INPUT_SELECTOR)) return false;
  return !!el.closest(THREAD_SELECTOR);
}

function getSelectionInsideThread(): { text: string; rect: DOMRect } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const text = selection.toString();
  if (!text.trim()) return null;
  const range = selection.getRangeAt(0);
  if (!isWithinThread(range.startContainer) || !isWithinThread(range.endContainer)) return null;
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { text, rect };
}

function quotify(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function placeButton(rect: DOMRect): ButtonPosition {
  const desiredTop = rect.top - BUTTON_HEIGHT - BUTTON_OFFSET_Y;
  const top = desiredTop < 0 ? rect.bottom + BUTTON_OFFSET_Y : desiredTop;
  const left = Math.max(8, rect.left);
  return { top, left };
}

export function QuoteOnSelectionButton(): React.ReactElement | null {
  const composerRuntime = useComposerRuntime();
  const [pos, setPos] = useState<ButtonPosition | null>(null);
  const selectedTextRef = useRef('');

  const update = useCallback(() => {
    const found = getSelectionInsideThread();
    if (!found) {
      setPos(null);
      selectedTextRef.current = '';
      return;
    }
    selectedTextRef.current = found.text;
    setPos(placeButton(found.rect));
  }, []);

  useEffect(() => {
    const onMouseUp = () => {
      // Defer one tick: selection isn't finalized synchronously on mouseup.
      window.setTimeout(update, 0);
    };
    const onSelectionChange = () => {
      // Only hide on collapse; don't relocate during drag.
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setPos(null);
        selectedTextRef.current = '';
      }
    };
    const onScroll = () => setPos(null);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [update]);

  const onQuote = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const text = selectedTextRef.current;
      if (!text) return;
      const quoted = quotify(text);
      let current = '';
      try {
        current = composerRuntime.getState()?.text ?? '';
      } catch (err) {
        log.warn('composer not ready when reading state', { err: String(err) });
      }
      const separator = current.length === 0 ? '' : current.endsWith('\n') ? '\n' : '\n\n';
      const next = `${current}${separator}${quoted}\n\n`;
      try {
        composerRuntime.setText(next);
      } catch (err) {
        log.warn('composer not ready when setting text', { err: String(err) });
        return;
      }
      window.getSelection()?.removeAllRanges();
      setPos(null);
      selectedTextRef.current = '';
      focusComposerInput();
    },
    [composerRuntime],
  );

  if (!pos) return null;

  return (
    <button
      type="button"
      // mousedown in capture would clear the selection; prevent default to keep it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onQuote}
      style={{ position: 'fixed', top: pos.top, left: pos.left, height: BUTTON_HEIGHT, width: BUTTON_HEIGHT }}
      className="z-50 flex items-center justify-center rounded-mf-input bg-mf-panel-bg border border-mf-border shadow-lg text-mf-text-primary hover:bg-mf-hover transition-colors"
      aria-label="Quote selection in composer"
      title="Quote selection"
    >
      <Quote size={14} />
    </button>
  );
}
