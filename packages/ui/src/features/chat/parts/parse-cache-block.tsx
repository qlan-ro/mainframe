/**
 * Streamdown's own `Block`, told whether the parse cache may keep it (`markdown-parse-cache.ts`).
 *
 * A part keeps one plugin list (the caching one) for its whole life, so settling does not change
 * any block's `remarkPlugins` and Streamdown's per-block memo holds. Only the block still growing
 * (the last one of a streaming or still-revealing text) gets the list's read-only twin: it reads
 * the cache but adds none of its passing versions. When the text settles, that one block switches
 * lists and renders once more; every finished block was kept when it finished.
 */
import { createContext, useContext } from 'react';
import { Block, type BlockProps } from 'streamdown';
import { withoutKeep } from './markdown-parse-cache';

/** The text of a part that is still growing, or null once it has settled. */
export const GrowingTextContext = createContext<string | null>(null);

/**
 * Whether `block` is the growing end of `text`. Streamdown's blocks partition the text, and every
 * block but the last ends with a newline (the next block starts on a new line), so a block that
 * does not end with one is the last. A last block that does (the stream paused on a line break)
 * is the end of the text. A repeated block at the very end reads as the tail too, which only
 * means it is not kept yet.
 */
export function isGrowingTail(block: string, text: string): boolean {
  return !block.endsWith('\n') || text.endsWith(block);
}

export function ParseCacheBlock(props: BlockProps) {
  const growing = useContext(GrowingTextContext);
  const plugins = props.remarkPlugins;
  const tail = growing !== null && plugins != null && isGrowingTail(props.content, growing);
  return <Block {...props} remarkPlugins={tail ? withoutKeep(plugins) : plugins} />;
}
