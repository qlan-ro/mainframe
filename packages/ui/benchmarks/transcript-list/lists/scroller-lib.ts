/** The Message Scroller behind the v1s variants: shadcn's published build, or the vendored copy with two patches. */
import { MessageScroller as Published, useMessageScroller as usePublished } from '@shadcn/react/message-scroller';
import { MessageScroller as Patched, useMessageScroller as usePatched } from '../vendor/message-scroller';
import { params } from '../params';

const patched = params.variant === 'v1s-patched';
export const MessageScroller = patched ? Patched : Published;
export const useMessageScroller = patched ? usePatched : usePublished;
