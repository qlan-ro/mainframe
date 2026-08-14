/**
 * The one `navigator` read the shortcut layer performs. Every other module
 * takes `isMac: boolean` as a parameter so tests can pass it explicitly
 * without mocking `navigator`.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/.test(platform);
}
