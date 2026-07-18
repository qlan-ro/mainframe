/** How long a session window stays trusted when the provider gives no resetsAt. */
export const SESSION_WINDOW_DURATION_MS = 5 * 60 * 60 * 1000;

/** How long a weekly/weekly-model window stays trusted when the provider gives no resetsAt. */
export const WEEKLY_WINDOW_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Age past which a provider blob is flagged stale, ahead of its expiry ceiling. */
export const STALE_THRESHOLD_MS = 12 * 60 * 1000;
