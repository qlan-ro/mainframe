/**
 * Streams a CLI build through the surface extractor without loading it whole:
 * a Claude binary is ~350MB, near V8's string-length ceiling.
 */
import { createReadStream } from 'node:fs';

import { MAX_MATCH_LENGTH, emptySurfaceSets, extractSurfaces } from './surface-extract.mjs';

const DEFAULT_CHUNK_BYTES = 16 * 1024 * 1024;
// Twice the longest match: a match that starts before the tail is complete
// within the chunk, and a cut-off one would be longer than MAX_MATCH_LENGTH,
// which extractSurfaces discards.
const OVERLAP = MAX_MATCH_LENGTH * 2;

/**
 * Each chunk is scanned with the previous chunk's tail prepended. Matches that
 * start in a chunk's tail are left for the next scan, which sees them whole.
 */
export async function scanFile(file, { chunkBytes = DEFAULT_CHUNK_BYTES } = {}) {
  const sets = emptySurfaceSets();
  let carry = '';
  for await (const chunk of createReadStream(file, { highWaterMark: chunkBytes })) {
    const text = carry + chunk.toString('latin1');
    const limit = Math.max(0, text.length - OVERLAP);
    extractSurfaces(text, sets, limit);
    carry = text.slice(limit);
  }
  extractSurfaces(carry, sets);
  return sets;
}
