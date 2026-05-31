import type { Response } from 'express';

/** Send a successful response wrapping `data` in the canonical envelope. */
export function ok<T>(res: Response, data: T): void {
  res.json({ success: true, data });
}

/** Send a successful response with no payload (state-only mutations). */
export function okEmpty(res: Response): void {
  res.json({ success: true });
}

/** Send a failed response with the given HTTP status and error message. */
export function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ success: false, error });
}
