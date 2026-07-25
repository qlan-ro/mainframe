/**
 * A worktree the daemon noticed an agent register mid-session, offered to the
 * chat as a switch target. `worktreePath` is canonical and is the offer's
 * identity — dismissals, accepts and expiries are all keyed by it.
 */
export interface WorktreeSwitchOffer {
  chatId: string;
  worktreePath: string;
  /** Short name (`refs/heads/` stripped); null for a detached worktree. */
  branchName: string | null;
  /** Epoch ms; orders the multi-offer list. */
  detectedAt: number;
}

export type WorktreeOfferOutcome = 'accepted' | 'dismissed' | 'expired';
