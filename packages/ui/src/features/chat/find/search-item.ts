export function searchItemId(part: {
  readonly providerMetadata?: Readonly<Record<string, unknown>>;
}): string | undefined {
  const mainframe = part.providerMetadata?.mainframe;
  if (!mainframe || typeof mainframe !== 'object' || !('itemId' in mainframe)) return undefined;
  return typeof mainframe.itemId === 'string' ? mainframe.itemId : undefined;
}
