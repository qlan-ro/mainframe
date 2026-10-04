/**
 * The one source for a provider's brand hue. `ProviderLogo` paints its avatar
 * badge from it and `ProviderDot` paints its 8px dot from it, so the two can
 * never disagree about what colour "Claude" is.
 *
 * Brand identity, not theme: these hues belong to Anthropic, OpenAI and Google,
 * so they are literals rather than tokens — a preset swap must not re-tint a
 * brand. Providers without a brand mark fall back to the muted ink at the
 * call site (`null` here), which is also how the unknown provider reads.
 */
export type ProviderAvatarId = 'claude' | 'openai' | 'gemini' | 'opencode' | 'unknown';

export interface ProviderAvatarMeta {
  background: string;
  color: string;
}

/** Badge paint for the logo avatar — only the providers with a filled mark. */
export const PROVIDER_AVATAR: Partial<Record<ProviderAvatarId, ProviderAvatarMeta>> = {
  claude: { background: '#d97757', color: '#ffffff' },
  openai: { background: '#19c37d', color: '#ffffff' },
};

/** Dot fill — the avatar background where one exists, plus Gemini's blue, which has no badge. */
const PROVIDER_DOT: Partial<Record<ProviderAvatarId, string>> = {
  claude: PROVIDER_AVATAR.claude?.background,
  openai: PROVIDER_AVATAR.openai?.background,
  gemini: '#4285f4',
};

export function providerAvatarId(adapterId: string): ProviderAvatarId {
  switch (adapterId) {
    case 'claude':
      return 'claude';
    case 'codex':
      return 'openai';
    case 'gemini':
      return 'gemini';
    case 'opencode':
      return 'opencode';
    default:
      return 'unknown';
  }
}

/** The dot's fill, or null when the provider has no brand hue (render the muted ink). */
export function providerDotColor(adapterId: string): string | null {
  return PROVIDER_DOT[providerAvatarId(adapterId)] ?? null;
}
