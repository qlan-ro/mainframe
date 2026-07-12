/**
 * SlashMenu — the curated slash-command suggestions `ChipField` opens when
 * its draft starts with "/" (ts153 `WF2_SLASH` + the inline suggestion list
 * in `WfChipField`).
 *
 * Selecting a command inserts it as ordinary literal text (see `ChipField`'s
 * doc comment) — this component is purely a fast-insert affordance, not a
 * distinct chip-part kind: the ratified `ChipPart` union
 * (`string | {token: TokenRef}`) has no third variant to carry one.
 *
 * `onMouseDown` (not `onClick`) fires the selection before the input's
 * `onBlur` can close the menu first — same trick the prototype uses.
 */
export const SLASH_COMMANDS = ['/codex-review', '/pending-work', '/ship-work', '/plan', '/summarize', '/test'];

export function matchSlashCommands(query: string): string[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.toLowerCase().startsWith(q));
}

export interface SlashMenuProps {
  /** The chip field's current draft text (e.g. "/pla"), used to filter. */
  query: string;
  onSelect: (command: string) => void;
  testId: string;
}

export function SlashMenu({ query, onSelect, testId }: SlashMenuProps) {
  const matches = matchSlashCommands(query);
  const shown = matches.length > 0 ? matches : SLASH_COMMANDS;
  return (
    <div
      data-testid={testId}
      className="absolute left-0 top-full z-30 mt-1 max-h-56 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-[var(--mf-shadow-pop)]"
    >
      <div className="px-2 py-1 text-caption font-medium text-muted-foreground">Slash commands</div>
      {shown.map((cmd) => (
        <button
          key={cmd}
          type="button"
          data-testid={`${testId}-option-${cmd}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(cmd);
          }}
          className="flex w-full items-center rounded-md px-2 py-1.5 text-left font-mono text-caption font-semibold text-primary hover:bg-accent"
        >
          {cmd}
        </button>
      ))}
    </div>
  );
}
