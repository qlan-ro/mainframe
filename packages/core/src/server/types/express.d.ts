import type { TokenPayload } from '../../auth/token.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: TokenPayload;
  }
}

export {};
