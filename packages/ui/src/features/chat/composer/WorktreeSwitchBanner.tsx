/**
 * WorktreeSwitchBanner — offers to move the session into a worktree the agent
 * just created, and reports the restart while it happens.
 *
 * The copy is load-bearing: accepting restarts the CLI process (a running
 * process can't change its own working directory), so every state says so
 * before the user commits.
 *
 * Data: `useWorktreeOffer()` over `extras.state.worktreeOffers` / `.switching`,
 * fed by the daemon's `worktree.offer.*` events (see chat-thread-state).
 */
import { useEffect } from 'react';
import { Check, GitBranch, Loader2 } from 'lucide-react';
import type { WorktreeSwitchOffer } from '@qlan-ro/mainframe-types';
import { useChatExtras, useWorktreeOffer } from '../runtime/use-chat-thread-runtime';

/** How long the "session is now in …" confirmation stays up before it clears itself. */
const SETTLED_LINGER_MS = 2000;

const LIST_WARNING =
  "Switching restarts the agent in the chosen folder — a running process can't change directory. " +
  'History carries over.';

const BUSY_NOTE = 'Available once the current response finishes — restarting now would cut it off.';

const PANEL_CLASS = 'rounded-lg border border-primary/40 bg-primary/10 p-3';

/** A detached worktree has no branch — the folder name is the only human label left. */
function branchLabel(worktreePath: string, branchName: string | null): string {
  if (branchName !== null && branchName !== '') return branchName;
  const segments = worktreePath.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? worktreePath;
}

function SwitchingLine({ label }: { label: string }) {
  return (
    <div data-testid="worktree-switch-status" className="flex items-center gap-1.5 text-xs text-primary">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      {`Switching — restarting the agent in ${label}…`}
    </div>
  );
}

function OfferActions({
  worktreePath,
  disabled,
  onAccept,
  onDismiss,
}: {
  worktreePath: string;
  disabled: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        data-testid="worktree-switch-accept"
        data-path={worktreePath}
        disabled={disabled}
        onClick={onAccept}
        className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Switch session
      </button>
      <button
        type="button"
        data-testid="worktree-switch-dismiss"
        data-path={worktreePath}
        onClick={onDismiss}
        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        Stay here
      </button>
    </div>
  );
}

function WorktreeOfferRow({
  offer,
  restartingPath,
  busy,
  onAccept,
  onDismiss,
}: {
  offer: WorktreeSwitchOffer;
  restartingPath: string | null;
  busy: boolean;
  onAccept: (worktreePath: string) => void;
  onDismiss: (worktreePath: string) => void;
}) {
  const label = branchLabel(offer.worktreePath, offer.branchName);
  return (
    <div
      data-testid="worktree-switch-row"
      data-path={offer.worktreePath}
      className="flex items-center justify-between gap-2 rounded-md bg-card/60 px-2 py-1.5"
    >
      <div className="min-w-0">
        <div className="text-xs font-medium">{label}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">{offer.worktreePath}</div>
      </div>
      {restartingPath === offer.worktreePath ? (
        <SwitchingLine label={label} />
      ) : (
        <OfferActions
          worktreePath={offer.worktreePath}
          disabled={busy || restartingPath !== null}
          onAccept={() => onAccept(offer.worktreePath)}
          onDismiss={() => onDismiss(offer.worktreePath)}
        />
      )}
    </div>
  );
}

export function WorktreeSwitchBanner() {
  const extras = useChatExtras();
  const { offers, switching, current, busy, accept, dismiss, clear } = useWorktreeOffer();
  const settled = switching?.phase === 'settled';

  useEffect(() => {
    if (!settled) return;
    const timer = setTimeout(() => clear(), SETTLED_LINGER_MS);
    return () => clearTimeout(timer);
  }, [settled, clear]);

  const chatId = extras?.state.chatId ?? '';
  // A draft thread has no daemon chat to rebind yet.
  if (chatId.startsWith('__LOCALID_')) return null;
  if (offers.length === 0 && switching === null) return null;

  const restartingPath = switching !== null && switching.phase === 'restarting' ? switching.worktreePath : null;
  const orphanRestart = restartingPath !== null && !offers.some((o) => o.worktreePath === restartingPath);
  const settledPath = current.worktreePath ?? switching?.worktreePath ?? '';
  const onAccept = (worktreePath: string) => void accept(worktreePath).catch(() => undefined);
  const onDismiss = (worktreePath: string) => void dismiss(worktreePath).catch(() => undefined);

  return (
    <div data-testid="worktree-switch-banner" className="flex flex-col gap-1.5 px-1 pb-1.5">
      {settled ? (
        <div className="rounded-lg border border-success/40 bg-success/10 p-3">
          <div data-testid="worktree-switch-status" className="flex items-center gap-1.5 text-xs text-success">
            <Check className="size-3.5" aria-hidden />
            {`Session is now in ${settledPath} on ${branchLabel(settledPath, current.branchName)}.`}
          </div>
        </div>
      ) : null}

      {/* The daemon can resolve the offer before the restart lands — keep reporting it. */}
      {orphanRestart && restartingPath !== null ? (
        <div className={PANEL_CLASS}>
          <SwitchingLine label={branchLabel(restartingPath, null)} />
        </div>
      ) : null}

      {offers.length === 1 && offers[0] !== undefined ? (
        <SingleOfferPanel
          offer={offers[0]}
          restartingPath={restartingPath}
          busy={busy}
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
      ) : null}

      {offers.length > 1 ? (
        <div className={`${PANEL_CLASS} flex flex-col gap-2`}>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <GitBranch className="size-3.5 text-primary" aria-hidden />
            {`${offers.length} new worktrees — switch this session?`}
          </p>
          <p className="text-xs text-muted-foreground">{busy ? BUSY_NOTE : LIST_WARNING}</p>
          <div className="flex flex-col gap-1.5">
            {offers.map((offer) => (
              <WorktreeOfferRow
                key={offer.worktreePath}
                offer={offer}
                restartingPath={restartingPath}
                busy={busy}
                onAccept={onAccept}
                onDismiss={onDismiss}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SingleOfferPanel({
  offer,
  restartingPath,
  busy,
  onAccept,
  onDismiss,
}: {
  offer: WorktreeSwitchOffer;
  restartingPath: string | null;
  busy: boolean;
  onAccept: (worktreePath: string) => void;
  onDismiss: (worktreePath: string) => void;
}) {
  const label = branchLabel(offer.worktreePath, offer.branchName);
  if (restartingPath === offer.worktreePath) {
    return (
      <div className={PANEL_CLASS}>
        <SwitchingLine label={label} />
      </div>
    );
  }
  return (
    <div className={`${PANEL_CLASS} flex flex-col gap-2`}>
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <GitBranch className="size-3.5 text-primary" aria-hidden />
        {`New worktree: ${label}`}
      </p>
      <p className="text-xs text-muted-foreground">
        {busy
          ? `Created at ${offer.worktreePath}. ${BUSY_NOTE}`
          : `Created at ${offer.worktreePath}. Switch this session into it? The agent restarts in the new folder — ` +
            "a running process can't change directory. History carries over."}
      </p>
      <OfferActions
        worktreePath={offer.worktreePath}
        disabled={busy || restartingPath !== null}
        onAccept={() => onAccept(offer.worktreePath)}
        onDismiss={() => onDismiss(offer.worktreePath)}
      />
    </div>
  );
}
