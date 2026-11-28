/** What a variant hands the probe and the scenarios: its scroller, its jump-to-latest action, and its follow state. */
export const controls = {
  viewport: null as HTMLElement | null,
  jump: () => {},
  /** `app`: whether the scroll owner follows the tail (the per-frame log reads it). */
  isFollowing: null as null | (() => boolean),
  /** `composer=real`: puts text in the real composer field. */
  setDraft: null as null | ((text: string) => void),
  /** `queue=1`: what else changes in the send's task (the scenario moves the activity strip). */
  onSend: null as null | (() => void),
  /** `queue=1&rtt=0`: the queue snapshot, landed by the composer right after its reset commits. */
  afterSend: null as null | (() => void),
};
