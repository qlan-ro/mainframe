/** Successful response carrying a payload. */
export type ApiOk<T> = { success: true; data: T };

/** Successful response with no payload (state-only mutations). */
export type ApiOkEmpty = { success: true };

/** Failed response. `error` is a human-readable message. */
export type ApiErr = { success: false; error: string };

/** Canonical daemon HTTP response envelope for routes that return a payload. */
export type ApiResponse<T> = ApiOk<T> | ApiErr;

/**
 * Envelope for state-only routes that reply via `okEmpty` (no `data`). Kept
 * separate from `ApiResponse<T>` so payload routes can read `.data` after the
 * `success` check without `T` leaking an optional/`never` data field.
 */
export type ApiResponseEmpty = ApiOkEmpty | ApiErr;
