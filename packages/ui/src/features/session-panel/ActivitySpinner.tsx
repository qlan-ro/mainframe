import { LoaderCircle } from 'lucide-react';

/** The small blue spinner that marks running work. */
export function ActivitySpinner() {
  return <LoaderCircle aria-hidden className="size-3 shrink-0 animate-spin text-live motion-reduce:animate-none" />;
}
