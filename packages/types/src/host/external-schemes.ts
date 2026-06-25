/**
 * host/external-schemes.ts
 *
 * The single canonical allowlist of URL schemes safe to forward to the OS opener.
 * Source of truth = the Electron main-process list in
 * packages/desktop/src/main/index.ts (ALLOWED_SCHEMES). The Tauri Rust shell's
 * is_allowed_external_scheme mirrors this exact set so both hosts behave 1:1.
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
