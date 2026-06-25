/**
 * host/external-schemes.ts
 *
 * The single canonical allowlist of URL schemes safe to forward to the OS opener.
 * THIS constant is the source of truth. All hosts (Electron main process, Tauri
 * Rust shell) must derive or mirror this set so both behave 1:1.
 */
export const ALLOWED_EXTERNAL_SCHEMES = [
  'http',
  'https',
  'mailto',
  'slack',
  'vscode',
  'vscode-insiders',
  'cursor',
  'jetbrains',
  'idea',
  'zed',
  'figma',
  'linear',
  'notion',
  'discord',
  'tel',
] as const;

/** True only if `url`'s scheme is in ALLOWED_EXTERNAL_SCHEMES (case-insensitive). */
export function isAllowedExternalScheme(url: string): boolean {
  const lower = url.toLowerCase();
  return ALLOWED_EXTERNAL_SCHEMES.some((s) => lower.startsWith(`${s}://`) || lower.startsWith(`${s}:`));
}
