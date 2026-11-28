/** What a variant hands the probe and the scenarios: its scroller, its jump-to-latest action, and its follow state. */
export const controls = {
  viewport: null as HTMLElement | null,
  jump: () => {},
  /** `app`: whether the scroll owner follows the tail (the per-frame log reads it). */
  isFollowing: null as null | (() => boolean),
  /** `composer=real`: puts text in the real composer field. */
  setDraft: null as null | ((text: string) => void),
};
