# About Modal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `window.alert()` About button with the Settings modal opened on the About tab, displaying real app info.

**Architecture:** Extend `open()` in the settings store to accept an optional `tab` argument. Create an `AboutSection` component that fetches and renders version/author from `getAppInfo()`. Wire `SettingsModal` to render `AboutSection` for the `about` tab. Update the `ProjectRail` Help button to open the modal on the about tab.

**Tech Stack:** React, Zustand, TypeScript strict, Vitest

---

### Task 1: Extend settings store `open()` to accept a tab parameter

**Files:**
- Modify: `packages/desktop/src/renderer/store/settings.ts`
- Test: `packages/desktop/src/__tests__/stores/settings.test.ts`

**Step 1: Write the failing test**

Add inside the existing `describe('open', ...)` block in `packages/desktop/src/__tests__/stores/settings.test.ts`:

```ts
it('opens directly to a given tab', () => {
  useSettingsStore.getState().open(undefined, 'about');
  expect(useSettingsStore.getState().isOpen).toBe(true);
  expect(useSettingsStore.getState().activeTab).toBe('about');
  expect(useSettingsStore.getState().selectedProvider).toBeNull();
});
```

**Step 2: Run the test to verify it fails**

```bash
pnpm --filter @mainframe/desktop test src/__tests__/stores/settings.test.ts
```

Expected: FAIL — `open` doesn't accept a second argument, `activeTab` will be `'general'` instead of `'about'`.

**Step 3: Update the store**

In `packages/desktop/src/renderer/store/settings.ts`, change the `open` signature and implementation:

```ts
// Before:
open: (defaultProvider?: string) => void;
// ...
open: (defaultProvider?: string) =>
  set({
    isOpen: true,
    activeTab: defaultProvider ? 'providers' : 'general',
    selectedProvider: defaultProvider ?? null,
  }),

// After:
open: (defaultProvider?: string, tab?: SettingsTab) => void;
// ...
open: (defaultProvider?: string, tab?: SettingsTab) =>
  set({
    isOpen: true,
    activeTab: tab ?? (defaultProvider ? 'providers' : 'general'),
    selectedProvider: defaultProvider ?? null,
  }),
```

**Step 4: Run tests to verify they pass**

```bash
pnpm --filter @mainframe/desktop test src/__tests__/stores/settings.test.ts
```

Expected: All tests PASS (new test + all existing tests).

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/store/settings.ts packages/desktop/src/__tests__/stores/settings.test.ts
git commit -m "feat: extend settings store open() to accept optional tab parameter"
```

---

### Task 2: Create the AboutSection component

**Files:**
- Create: `packages/desktop/src/renderer/components/settings/AboutSection.tsx`

No unit test needed — this is a simple presentational component with a single IPC fetch; it will be verified visually in Task 4.

**Step 1: Create the file**

```tsx
import React, { useEffect, useState } from 'react';

interface AppInfo {
  version: string;
  author: string;
}

export function AboutSection(): React.ReactElement {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    window.mainframe
      .getAppInfo()
      .then(setInfo)
      .catch((err: unknown) => console.warn('[about] failed to load app info:', err));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-mf-title font-semibold text-mf-text-primary mb-1">Mainframe</h3>
        <p className="text-mf-body text-mf-text-secondary">AI-native development environment</p>
      </div>

      <div className="space-y-2">
        <Row label="Version" value={info?.version ?? '—'} />
        <Row label="Author" value={info?.author ?? '—'} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-4">
      <span className="w-16 text-mf-small text-mf-text-secondary shrink-0">{label}</span>
      <span className="text-mf-small text-mf-text-primary">{value}</span>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @mainframe/desktop build
```

Expected: no type errors.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/settings/AboutSection.tsx
git commit -m "feat: add AboutSection component for settings modal"
```

---

### Task 3: Wire AboutSection into SettingsModal

**Files:**
- Modify: `packages/desktop/src/renderer/components/SettingsModal.tsx:1-10,43-44`

**Step 1: Import and render**

In `SettingsModal.tsx`, add the import at the top:

```ts
import { AboutSection } from './settings/AboutSection';
```

Then update the `TabContent` switch:

```tsx
// Before:
case 'about':
  return <PlaceholderContent label="About" />;

// After:
case 'about':
  return <AboutSection />;
```

**Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @mainframe/desktop build
```

Expected: no errors.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/SettingsModal.tsx
git commit -m "feat: render AboutSection in settings modal about tab"
```

---

### Task 4: Update ProjectRail Help button to open the modal

**Files:**
- Modify: `packages/desktop/src/renderer/components/ProjectRail.tsx:23-30,73-79`

**Step 1: Remove handleShowHelp and update the button**

Delete the `handleShowHelp` callback (lines 23–30) entirely. Update the Help button's `onClick`:

```tsx
// Before:
const handleShowHelp = useCallback(async () => {
  try {
    const info = await window.mainframe.getAppInfo();
    window.alert(`Mainframe v${info.version}\nAuthor: ${info.author}`);
  } catch (error) {
    console.warn('[project-rail] failed to load app info:', error);
  }
}, []);

// ...button:
onClick={handleShowHelp}

// After (remove handleShowHelp entirely, and update button):
onClick={() => useSettingsStore.getState().open(undefined, 'about')}
```

Also remove `useCallback` from imports if it's no longer used after this change (check whether it's still used elsewhere in the file).

**Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @mainframe/desktop build
```

Expected: no errors.

**Step 3: Run the full desktop test suite**

```bash
pnpm --filter @mainframe/desktop test
```

Expected: all tests PASS.

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/ProjectRail.tsx
git commit -m "feat: open about tab in settings modal from help button"
```
