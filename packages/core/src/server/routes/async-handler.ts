import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Returns the wrapped Promise so callers (tests in particular) can await the
// handler's work without relying on timer-based polling. Express itself
// ignores the return value — behavior in the running server is unchanged.
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}
