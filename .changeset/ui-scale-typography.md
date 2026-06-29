---
"@qlan-ro/mainframe-ui": patch
---

Add a UI Scale setting (Compact / Normal / Large, default Normal) in Settings → Appearance, applied via CSS zoom so text, spacing, and icons scale uniformly — Normal ships at the macOS-HIG body size (~13px) instead of the previous 11px-dominant default. Also greens the design-token audit: every arbitrary font-size/leading/tracking value now uses a scale token, and raw color literals (shadows, overlays, scrims, accent glyphs) are tokenized — which fixes latent dark-mode shadow bugs where hardcoded black rgba only looked right in light mode.
