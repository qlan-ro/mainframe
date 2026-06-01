/** Successful response carrying a payload. */
export type ApiOk<T> = { success: true; data: T };

/** Successful response with no payload (state-only mutations). */
export type ApiOkEmpty = { success: true };

/** Failed response. `error` is a human-readable message. */
export type ApiErr = { success: false; error: string };

/** Canonical daemon HTTP response envelope. */
export type ApiResponse<T> = ApiOk<T> | ApiErr;
