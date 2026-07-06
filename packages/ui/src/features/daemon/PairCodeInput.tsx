/**
 * PairCodeInput — segmented 6-character code entry, grouped 3 + dash + 3.
 *
 * Each box is ~40×48px, font-mono 22px bold. Border colours:
 *   filled + valid → border-primary + bg-primary/10 ring
 *   invalid        → border-destructive
 *   otherwise      → border-border
 *
 * Auto-advances on valid input (A–Z, 0–9 uppercase); Backspace on empty box
 * focuses the previous one. value is a 6-char string (blanks held as ' ').
 */
import { useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PairCodeInputProps {
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALLOWED = /^[A-Z0-9]$/;

function normalise(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 1);
}

function padSix(s: string): string {
  return (s + '      ').slice(0, 6);
}

// ---------------------------------------------------------------------------
// Single box
// ---------------------------------------------------------------------------

interface BoxProps {
  idx: number;
  ch: string;
  invalid: boolean;
  disabled: boolean;
  autoFocus: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onBoxChange: (idx: number, ch: string) => void;
  onBoxKeyDown: (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => void;
}

function CodeBox({ idx, ch, invalid, disabled, autoFocus, inputRef, onBoxChange, onBoxKeyDown }: BoxProps) {
  const filled = ch !== ' ' && ch !== '';
  const borderClass = invalid ? 'border-destructive' : filled ? 'border-primary' : 'border-border';
  const ringClass = filled && !invalid ? 'ring-1 ring-primary/10' : '';

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="text"
      maxLength={1}
      value={ch === ' ' ? '' : ch}
      autoFocus={autoFocus && idx === 0}
      disabled={disabled}
      aria-label={`Pairing code character ${idx + 1}`}
      onChange={(e) => {
        const n = normalise(e.target.value);
        if (n && ALLOWED.test(n)) onBoxChange(idx, n);
      }}
      onKeyDown={(e) => onBoxKeyDown(idx, e)}
      className={cn(
        'w-[40px] h-[48px] rounded-md border text-center font-mono text-display font-bold',
        'bg-card text-foreground outline-none transition-colors',
        'focus:border-primary focus:ring-1 focus:ring-primary/20',
        'disabled:opacity-45 disabled:cursor-not-allowed',
        borderClass,
        ringClass,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// PairCodeInput
// ---------------------------------------------------------------------------

export function PairCodeInput({
  value,
  onChange,
  invalid = false,
  disabled = false,
  autoFocus = false,
}: PairCodeInputProps) {
  const chars = padSix(value).split('');
  const ref0 = useRef<HTMLInputElement>(null);
  const ref1 = useRef<HTMLInputElement>(null);
  const ref2 = useRef<HTMLInputElement>(null);
  const ref3 = useRef<HTMLInputElement>(null);
  const ref4 = useRef<HTMLInputElement>(null);
  const ref5 = useRef<HTMLInputElement>(null);

  const focusAt = useCallback(
    (idx: number) => {
      const refMap: Record<number, React.RefObject<HTMLInputElement | null>> = {
        0: ref0,
        1: ref1,
        2: ref2,
        3: ref3,
        4: ref4,
        5: ref5,
      };
      refMap[idx]?.current?.focus();
    },
    [ref0, ref1, ref2, ref3, ref4, ref5],
  );

  const handleBoxChange = useCallback(
    (idx: number, ch: string) => {
      const next = chars.slice();
      next[idx] = ch;
      onChange(next.join(''));
      if (idx < 5) focusAt(idx + 1);
    },
    [chars, onChange, focusAt],
  );

  const handleBoxKeyDown = useCallback(
    (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace') {
        const current = chars[idx] ?? ' ';
        if (current !== ' ' && current !== '') {
          // Clear current box
          const next = chars.slice();
          next[idx] = ' ';
          onChange(next.join(''));
        } else if (idx > 0) {
          // Move focus to previous
          focusAt(idx - 1);
        }
        e.preventDefault();
      }
    },
    [chars, onChange, focusAt],
  );

  const boxProps = (i: 0 | 1 | 2 | 3 | 4 | 5, r: React.RefObject<HTMLInputElement | null>) => ({
    idx: i,
    ch: chars[i] ?? ' ',
    invalid,
    disabled,
    autoFocus,
    inputRef: r,
    onBoxChange: handleBoxChange,
    onBoxKeyDown: handleBoxKeyDown,
  });

  return (
    <div data-testid="daemon-pair-code" className="flex items-center gap-[6px]">
      <CodeBox key={0} {...boxProps(0, ref0)} />
      <CodeBox key={1} {...boxProps(1, ref1)} />
      <CodeBox key={2} {...boxProps(2, ref2)} />
      <span className="select-none text-title font-bold text-muted-foreground">–</span>
      <CodeBox key={3} {...boxProps(3, ref3)} />
      <CodeBox key={4} {...boxProps(4, ref4)} />
      <CodeBox key={5} {...boxProps(5, ref5)} />
    </div>
  );
}
