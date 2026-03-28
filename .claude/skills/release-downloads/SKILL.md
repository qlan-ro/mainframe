---
name: release-downloads
description: Use when checking GitHub release download counts, asset popularity, or tracking adoption across versions
---

# Release Downloads

## Overview

Report GitHub release download stats per version and asset. Only surfaces assets with 1+ downloads to cut noise.

## When to Use

- Checking how many times releases have been downloaded
- Comparing adoption across versions
- Identifying which platforms users download (macOS, Windows, Linux)

## Quick Reference

Run this script via Bash and present the output as-is:

```bash
total=0
for tag in $(gh release list --json tagName --jq '.[].tagName'); do
  assets=$(gh release view "$tag" --json assets --jq '[.assets[] | select(.downloadCount > 0) | {name, downloads: .downloadCount}]')
  if [ "$assets" != "[]" ]; then
    echo "## $tag"
    echo "$assets" | jq -r '.[] | "  \(.name): \(.downloads)"'
    subtotal=$(echo "$assets" | jq '[.[].downloads] | add')
    total=$((total + subtotal))
    echo "  Subtotal: $subtotal"
    echo ""
  fi
done
echo "Total downloads across all releases: $total"
```

Versions with zero downloads across all assets are omitted entirely.

## Common Mistakes

- GitHub only counts downloads from the Releases page or API asset URLs — `gh release download`, `git clone`, and auto-updater fetches may not register.
- Draft releases don't track download counts.
- Counts can lag behind due to CDN caching.
