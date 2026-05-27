export function encodeCwdSegment(absPath: string): string {
  return absPath.replace(/[/.]/g, '-');
}
