/** A request that failed before it was written to a socket: the daemon certainly did not get it. */
export class NotSentError extends Error {
  /** The code a closed connection rejects with, sent or not. */
  readonly code = -32000;

  constructor(message: string) {
    super(message);
    this.name = 'NotSentError';
  }
}
