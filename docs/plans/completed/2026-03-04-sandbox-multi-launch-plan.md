# Sandbox Multi-Launch Pages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-WebView mobile sandbox with swipeable per-config pages — preview configs show WebView, non-preview configs show fullscreen console.

**Architecture:** `react-native-pager-view` provides native horizontal swipe between pages. Each page is a self-contained component (`PreviewPage` or `ConsolePage`) that manages its own content. The header updates dynamically based on the active page index.

**Tech Stack:** React Native, Expo, react-native-pager-view, zustand, @qlan-ro/mainframe-types

---

### Task 1: Install react-native-pager-view and update getLaunchConfigs API

**Files:**
- Modify: `packages/mobile/package.json`
- Modify: `packages/mobile/lib/api.ts:98-108`

**Step 1: Install the dependency**

Run: `cd /Users/doruchiulan/Projects/qlan/mainframe/packages/mobile && pnpm add react-native-pager-view`

**Step 2: Update `getLaunchConfigs` to return `preview` field**

In `packages/mobile/lib/api.ts`, change the `getLaunchConfigs` function:

```typescript
export async function getLaunchConfigs(
  projectId: string,
): Promise<{ name: string; command: string; preview: boolean }[]> {
  const data = await fetchJson<{ name: string; runtimeExecutable: string; runtimeArgs: string[]; preview?: boolean }[]>(
    `/api/projects/${projectId}/launch/configs`,
  );
  return (data ?? []).map((c) => ({
    name: c.name,
    command: `${c.runtimeExecutable} ${c.runtimeArgs.join(' ')}`,
    preview: c.preview === true,
  }));
}
```

**Step 3: Verify the app still builds**

Run: `cd /Users/doruchiulan/Projects/qlan/mainframe/packages/mobile && npx expo start --clear` — confirm no import errors.

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml lib/api.ts
git commit -m "feat(mobile): install react-native-pager-view, add preview to getLaunchConfigs"
```

---

### Task 2: Create the PreviewPage component

Extract the WebView + loading/error states from `sandbox.tsx` into a standalone page component.

**Files:**
- Create: `packages/mobile/components/sandbox/PreviewPage.tsx`

**Step 1: Create PreviewPage**

```tsx
import { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { WifiOff, RefreshCw } from 'lucide-react-native';
import { useSandboxStore } from '../../store/sandbox';

interface PreviewPageProps {
  projectId: string;
  configName: string;
}

export function PreviewPage({ projectId, configName }: PreviewPageProps) {
  const webViewRef = useRef<WebView>(null);
  const [navUrl, setNavUrl] = useState('');
  const [webViewKey, setWebViewKey] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tunnelUrl = useSandboxStore((s) => {
    const k = `${projectId}:${configName}`;
    return s.tunnelUrls.get(k) ?? null;
  });

  const processStatus = useSandboxStore((s) => {
    const k = `${projectId}:${configName}`;
    return s.processStatuses.get(k) ?? 'stopped';
  });

  const isRunning = processStatus === 'running' || processStatus === 'starting';

  // Clear retry timer on unmount or tunnel URL change
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [tunnelUrl]);

  const handleRefresh = useCallback(() => setWebViewKey((k) => k + 1), []);

  if (tunnelUrl) {
    return (
      <WebView
        key={webViewKey}
        ref={webViewRef}
        source={{ uri: tunnelUrl }}
        style={{ flex: 1, backgroundColor: '#18181b' }}
        onNavigationStateChange={(navState) => setNavUrl(navState.url)}
        onHttpError={(syntheticEvent) => {
          const { statusCode } = syntheticEvent.nativeEvent;
          if (statusCode >= 500) {
            console.log('[PreviewPage] HTTP error:', statusCode);
          }
        }}
        renderError={(errorDomain, errorCode, errorDesc) => {
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => setWebViewKey((k) => k + 1), 4000);

          return (
            <View
              style={{
                flex: 1,
                backgroundColor: '#18181b',
                alignItems: 'center',
                justifyContent: 'flex-start',
                paddingTop: 80,
                paddingHorizontal: 32,
              }}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: '#ffffff08',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 20,
                }}
              >
                <WifiOff color="#f97312" size={28} />
              </View>
              <Text style={{ color: '#f4f4f5', fontSize: 17, fontWeight: '600', marginBottom: 8 }}>
                Tunnel Unavailable
              </Text>
              <Text style={{ color: '#71717a', fontSize: 14, textAlign: 'center', marginBottom: 8, maxWidth: 260 }}>
                The preview server isn't reachable yet. This usually means the dev server is still starting.
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 }}>
                <ActivityIndicator size="small" color="#71717a" />
                <Text style={{ color: '#71717a', fontSize: 13 }}>Retrying automatically...</Text>
              </View>
              <Pressable
                onPress={() => {
                  if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
                  setWebViewKey((k) => k + 1);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: '#ffffff10',
                  borderWidth: 0.5,
                  borderColor: '#ffffff15',
                }}
              >
                <RefreshCw color="#a1a1aa" size={14} />
                <Text style={{ color: '#e4e4e7', fontSize: 14, fontWeight: '500' }}>Retry Now</Text>
              </Pressable>
            </View>
          );
        }}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        allowsBackForwardNavigationGestures
      />
    );
  }

  if (isRunning) {
    return (
      <View style={{ flex: 1, alignItems: 'center', paddingTop: 80, backgroundColor: '#18181b' }}>
        <ActivityIndicator color="#f97312" size="large" style={{ marginBottom: 16 }} />
        <Text style={{ color: '#a1a1aa', fontSize: 15 }}>Starting server...</Text>
        <Text style={{ color: '#52525b', fontSize: 12, marginTop: 6 }}>Waiting for tunnel URL</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', paddingTop: 80, backgroundColor: '#18181b' }}>
      <Text style={{ color: '#71717a', fontSize: 15 }}>Start the server to preview it here</Text>
    </View>
  );
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit` from mobile package root (or just confirm no red squiggles).

**Step 3: Commit**

```bash
git add components/sandbox/PreviewPage.tsx
git commit -m "feat(mobile): extract PreviewPage component from sandbox screen"
```

---

### Task 3: Create the ConsolePage component

A fullscreen console log viewer for non-preview launch configurations.

**Files:**
- Create: `packages/mobile/components/sandbox/ConsolePage.tsx`

**Step 1: Create ConsolePage**

Reuse the log rendering logic from `ConsoleSheet.tsx` — same colors, same font, same FlatList pattern — but as a full page.

```tsx
import { useCallback, useMemo, useRef, useEffect } from 'react';
import { View, Text, FlatList } from 'react-native';
import { Play } from 'lucide-react-native';
import { useSandboxStore } from '../../store/sandbox';

interface LogEntry {
  timestamp: number;
  level: string;
  text: string;
}

const EMPTY_LOGS: LogEntry[] = [];

interface ConsolePageProps {
  projectId: string;
  configName: string;
  onRun: () => void;
}

export function ConsolePage({ projectId, configName, onRun }: ConsolePageProps) {
  const listRef = useRef<FlatList>(null);

  const processStatus = useSandboxStore((s) => {
    const k = `${projectId}:${configName}`;
    return s.processStatuses.get(k) ?? 'stopped';
  });

  const logs = useSandboxStore((s) => {
    const k = `${projectId}:${configName}`;
    return s.logs.get(k) ?? EMPTY_LOGS;
  });

  const isRunning = processStatus === 'running' || processStatus === 'starting';

  // Auto-scroll to end when new logs arrive
  useEffect(() => {
    if (logs.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [logs.length]);

  const renderItem = useCallback(({ item }: { item: LogEntry }) => {
    const color =
      item.level === 'error'
        ? '#f97066'
        : item.level === 'warn'
          ? '#eab305'
          : item.level === 'info' && item.text.startsWith('✓')
            ? '#1ec55f'
            : item.text.startsWith('Hot reload')
              ? '#61a5fa'
              : '#ffffff70';
    return (
      <Text
        style={{
          color,
          fontFamily: 'JetBrains Mono',
          fontSize: 12,
          paddingHorizontal: 16,
          paddingVertical: 3,
        }}
      >
        {item.text}
      </Text>
    );
  }, []);

  if (!isRunning && logs.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#18181b' }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: '#ffffff10',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
          }}
        >
          <Play color="#34d399" size={24} />
        </View>
        <Text style={{ color: '#71717a', fontSize: 15 }}>Tap play to start</Text>
        <Text style={{ color: '#52525b', fontSize: 12, marginTop: 4 }}>{configName}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#18181b' }}>
      <FlatList
        ref={listRef}
        data={logs}
        keyExtractor={(_, i) => String(i)}
        renderItem={renderItem}
        contentContainerStyle={{ paddingVertical: 8, paddingBottom: 20 }}
      />
    </View>
  );
}
```

**Step 2: Commit**

```bash
git add components/sandbox/ConsolePage.tsx
git commit -m "feat(mobile): add ConsolePage component for non-preview launch configs"
```

---

### Task 4: Rewrite SandboxHeader with config name, dot indicators, and dynamic controls

**Files:**
- Modify: `packages/mobile/components/sandbox/SandboxHeader.tsx` (full rewrite)

**Step 1: Rewrite SandboxHeader**

The header now receives the active config's name, preview flag, status, tunnel URL, page count, and active page index. It renders:
- Left: back button
- Center: config name (bold) + subtitle (URL for preview, status pill for console) + dot indicators
- Right: process controls (play/restart/stop) + refresh/fullscreen for preview pages

```tsx
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { ChevronLeft, RefreshCw, Maximize2, Play, Square, RotateCcw } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

interface SandboxHeaderProps {
  configName: string;
  isPreview: boolean;
  processStatus: string;
  tunnelUrl: string | null;
  pageCount: number;
  activePageIndex: number;
  isFullscreen: boolean;
  onRefresh: () => void;
  onToggleFullscreen: () => void;
  onRun: () => void;
  onStop: () => void;
  onRestart: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  running: '#34d399',
  starting: '#f97312',
  stopped: '#71717a',
  failed: '#f87171',
};

export function SandboxHeader({
  configName,
  isPreview,
  processStatus,
  tunnelUrl,
  pageCount,
  activePageIndex,
  isFullscreen,
  onRefresh,
  onToggleFullscreen,
  onRun,
  onStop,
  onRestart,
}: SandboxHeaderProps) {
  const insets = useSafeAreaInsets();

  if (isFullscreen) return null;

  const isRunning = processStatus === 'running' || processStatus === 'starting';
  const statusColor = STATUS_COLORS[processStatus] ?? '#71717a';

  return (
    <View
      style={{
        backgroundColor: '#09090b',
        borderBottomWidth: 0.5,
        borderBottomColor: '#ffffff12',
        paddingTop: insets.top + 8,
        paddingBottom: 10,
        paddingHorizontal: 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {/* Left: back */}
        <TouchableOpacity
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: '#ffffff10',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 12,
          }}
          onPress={() => router.back()}
        >
          <ChevronLeft color="#f4f4f5" size={18} />
        </TouchableOpacity>

        {/* Center: config name + subtitle */}
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#f4f4f5', fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
            {configName}
          </Text>
          {isPreview && tunnelUrl ? (
            <Text
              style={{ color: '#71717a', fontSize: 11, fontFamily: 'JetBrains Mono', marginTop: 2 }}
              numberOfLines={1}
            >
              {tunnelUrl}
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
              <Text style={{ color: '#71717a', fontSize: 12 }}>{processStatus}</Text>
            </View>
          )}
        </View>

        {/* Right: process controls */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {processStatus === 'starting' ? (
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: '#ffffff10',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ActivityIndicator size="small" color="#f97312" />
            </View>
          ) : isRunning ? (
            <>
              <TouchableOpacity
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: '#ffffff10',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={onRestart}
              >
                <RotateCcw color="#ffffff80" size={14} />
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: '#ffffff10',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={onStop}
              >
                <Square color="#f97066" size={14} />
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: '#ffffff10',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onPress={onRun}
            >
              <Play color="#34d399" size={14} />
            </TouchableOpacity>
          )}

          {isPreview && (
            <>
              <TouchableOpacity
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: '#ffffff10',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={onRefresh}
              >
                <RefreshCw color="#f4f4f5" size={14} />
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: '#ffffff10',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={onToggleFullscreen}
              >
                <Maximize2 color="#f4f4f5" size={14} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Dot indicators */}
      {pageCount > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 }}>
          {Array.from({ length: pageCount }, (_, i) => (
            <View
              key={i}
              style={{
                width: i === activePageIndex ? 16 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === activePageIndex ? '#f97312' : '#ffffff25',
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
```

**Step 2: Commit**

```bash
git add components/sandbox/SandboxHeader.tsx
git commit -m "feat(mobile): rewrite SandboxHeader with config name, dots, and process controls"
```

---

### Task 5: Rewrite sandbox.tsx with PagerView

Wire everything together: PagerView, new header, PreviewPage/ConsolePage, remove old components.

**Files:**
- Modify: `packages/mobile/app/sandbox.tsx` (full rewrite)

**Step 1: Rewrite sandbox.tsx**

```tsx
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, StatusBar, Platform } from 'react-native';
import PagerView from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { SandboxHeader } from '../components/sandbox/SandboxHeader';
import { PreviewPage } from '../components/sandbox/PreviewPage';
import { ConsolePage } from '../components/sandbox/ConsolePage';
import { ConsoleSheet } from '../components/sandbox/ConsoleSheet';
import { useSandboxStore, filterByProject } from '../store/sandbox';
import { getLaunchConfigs, getLaunchStatus, startLaunch, stopLaunch } from '../lib/api';

interface LaunchConfig {
  name: string;
  command: string;
  preview: boolean;
}

export default function SandboxScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<PagerView>(null);
  const [launchConfigs, setLaunchConfigs] = useState<LaunchConfig[]>([]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const consoleVisible = useSandboxStore((s) => s.consoleVisible);
  const setConsoleVisible = useSandboxStore((s) => s.setConsoleVisible);
  const setProcessStatuses = useSandboxStore((s) => s.setProcessStatuses);
  const setTunnelUrls = useSandboxStore((s) => s.setTunnelUrls);

  // Sort: preview configs first
  const sortedConfigs = useMemo(() => {
    const preview = launchConfigs.filter((c) => c.preview);
    const nonPreview = launchConfigs.filter((c) => !c.preview);
    return [...preview, ...nonPreview];
  }, [launchConfigs]);

  const activeConfig = sortedConfigs[activePageIndex];
  const configNames = useMemo(() => sortedConfigs.map((c) => c.name), [sortedConfigs]);

  // Per-config store lookups for the active config
  const activeTunnelUrl = useSandboxStore((s) => {
    if (!projectId || !activeConfig) return null;
    return s.tunnelUrls.get(`${projectId}:${activeConfig.name}`) ?? null;
  });

  const activeProcessStatus = useSandboxStore((s) => {
    if (!projectId || !activeConfig) return 'stopped';
    return s.processStatuses.get(`${projectId}:${activeConfig.name}`) ?? 'stopped';
  });

  // Fetch configs and statuses on mount
  useEffect(() => {
    if (!projectId) return;
    getLaunchConfigs(projectId)
      .then(setLaunchConfigs)
      .catch((err) => console.warn('[SandboxScreen] failed to load launch configs:', err));

    getLaunchStatus(projectId)
      .then(({ statuses, tunnelUrls }) => {
        setProcessStatuses(projectId, statuses);
        if (tunnelUrls && Object.keys(tunnelUrls).length > 0) {
          setTunnelUrls(projectId, tunnelUrls);
        }
      })
      .catch((err) => console.warn('[SandboxScreen] failed to load launch statuses:', err));
  }, [projectId, setProcessStatuses, setTunnelUrls]);

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => {
      const entering = !prev;
      StatusBar.setHidden(entering);
      if (entering) setConsoleVisible(false);
      return entering;
    });
  }, [setConsoleVisible]);

  const handleRefresh = useCallback(() => {
    // PreviewPage handles its own refresh via key increment.
    // This is a no-op placeholder; we'll wire it via ref if needed.
  }, []);

  const handleRun = useCallback(() => {
    if (!projectId || !activeConfig) return;
    startLaunch(projectId, activeConfig.name).catch((err) =>
      console.warn('[SandboxScreen] start failed:', err),
    );
  }, [projectId, activeConfig]);

  const handleStop = useCallback(() => {
    if (!projectId || !activeConfig) return;
    stopLaunch(projectId, activeConfig.name).catch((err) =>
      console.warn('[SandboxScreen] stop failed:', err),
    );
  }, [projectId, activeConfig]);

  const handleRestart = useCallback(() => {
    if (!projectId || !activeConfig) return;
    stopLaunch(projectId, activeConfig.name)
      .then(() => startLaunch(projectId, activeConfig.name))
      .catch((err) => console.warn('[SandboxScreen] restart failed:', err));
  }, [projectId, activeConfig]);

  return (
    <View style={{ flex: 1, backgroundColor: '#09090b' }}>
      <SandboxHeader
        configName={activeConfig?.name ?? 'Sandbox'}
        isPreview={activeConfig?.preview ?? false}
        processStatus={activeProcessStatus}
        tunnelUrl={activeTunnelUrl}
        pageCount={sortedConfigs.length}
        activePageIndex={activePageIndex}
        isFullscreen={isFullscreen}
        onRefresh={handleRefresh}
        onToggleFullscreen={handleToggleFullscreen}
        onRun={handleRun}
        onStop={handleStop}
        onRestart={handleRestart}
      />

      {sortedConfigs.length > 0 ? (
        <PagerView
          ref={pagerRef}
          style={{ flex: 1 }}
          initialPage={0}
          onPageSelected={(e) => setActivePageIndex(e.nativeEvent.position)}
        >
          {sortedConfigs.map((config) => (
            <View key={config.name} style={{ flex: 1 }}>
              {config.preview ? (
                <PreviewPage projectId={projectId ?? ''} configName={config.name} />
              ) : (
                <ConsolePage
                  projectId={projectId ?? ''}
                  configName={config.name}
                  onRun={() => {
                    if (projectId) startLaunch(projectId, config.name).catch(() => {});
                  }}
                />
              )}
            </View>
          ))}
        </PagerView>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', paddingTop: 80 }}>
          {/* Empty state while configs load */}
        </View>
      )}

      {/* ConsoleSheet only for preview pages */}
      {activeConfig?.preview && (
        <ConsoleSheet projectId={projectId ?? ''} configNames={configNames} />
      )}
    </View>
  );
}
```

**Step 2: Verify the app runs**

Run: `npx expo start --clear` — navigate to the sandbox screen, confirm pages render and swipe works.

**Step 3: Commit**

```bash
git add app/sandbox.tsx
git commit -m "feat(mobile): rewrite sandbox screen with PagerView multi-launch pages"
```

---

### Task 6: Remove unused components (LaunchConfigSheet, SandboxTabBar)

**Files:**
- Delete: `packages/mobile/components/sandbox/LaunchConfigSheet.tsx`
- Delete: `packages/mobile/components/sandbox/SandboxTabBar.tsx`
- Modify: `packages/mobile/app/sandbox.tsx` (remove any leftover imports — should already be clean from Task 5)

**Step 1: Delete the files**

```bash
rm packages/mobile/components/sandbox/LaunchConfigSheet.tsx
rm packages/mobile/components/sandbox/SandboxTabBar.tsx
```

**Step 2: Verify no dangling imports**

Run: `npx tsc --noEmit` (or `grep -r "LaunchConfigSheet\|SandboxTabBar" packages/mobile/`) — confirm zero references.

**Step 3: Commit**

```bash
git add -A components/sandbox/LaunchConfigSheet.tsx components/sandbox/SandboxTabBar.tsx
git commit -m "chore(mobile): remove LaunchConfigSheet and SandboxTabBar (replaced by pager pages)"
```

---

### Task 7: Wire fullscreen mode for preview pages

Fullscreen mode hides the header and shows a minimal floating pill (Console + Exit buttons) at the bottom. This was in the old `sandbox.tsx` and needs to work with the new PagerView layout.

**Files:**
- Modify: `packages/mobile/app/sandbox.tsx`
- Modify: `packages/mobile/components/sandbox/PreviewPage.tsx` (expose refresh via callback)

**Step 1: Add fullscreen overlay to sandbox.tsx**

Inside the `SandboxScreen` component, after the PagerView, add the fullscreen floating pill. This is a direct copy of the existing fullscreen overlay from the old sandbox.tsx (the `BlurView` pill with Console + Exit buttons). It renders only when `isFullscreen && activeConfig?.preview`.

```tsx
{isFullscreen && activeConfig?.preview && (
  <View
    style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      alignItems: 'center',
      paddingBottom: insets.bottom + 8,
    }}
  >
    <View
      style={{
        width: 160,
        height: 56,
        borderRadius: 28,
        overflow: 'hidden',
        borderWidth: 0.5,
        borderColor: '#ffffff30',
        backgroundColor: '#ffffff22',
      }}
    >
      {Platform.OS === 'ios' ? (
        <BlurView
          intensity={40}
          tint="dark"
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-around',
            paddingHorizontal: 16,
          }}
        >
          <Pressable onPress={() => setConsoleVisible(!consoleVisible)} style={{ alignItems: 'center', gap: 2 }}>
            <Terminal color="#ffffff80" size={20} />
            <Text style={{ color: '#ffffff60', fontSize: 10, fontWeight: '500' }}>Console</Text>
          </Pressable>
          <Pressable onPress={handleToggleFullscreen} style={{ alignItems: 'center', gap: 2 }}>
            <Minimize2 color="#ffffff80" size={20} />
            <Text style={{ color: '#ffffff60', fontSize: 10, fontWeight: '500' }}>Exit</Text>
          </Pressable>
        </BlurView>
      ) : (
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-around',
            paddingHorizontal: 16,
          }}
        >
          <Pressable onPress={() => setConsoleVisible(!consoleVisible)} style={{ alignItems: 'center', gap: 2 }}>
            <Terminal color="#ffffff80" size={20} />
            <Text style={{ color: '#ffffff60', fontSize: 10, fontWeight: '500' }}>Console</Text>
          </Pressable>
          <Pressable onPress={handleToggleFullscreen} style={{ alignItems: 'center', gap: 2 }}>
            <Minimize2 color="#ffffff80" size={20} />
            <Text style={{ color: '#ffffff60', fontSize: 10, fontWeight: '500' }}>Exit</Text>
          </Pressable>
        </View>
      )}
    </View>
  </View>
)}
```

Add the required imports at the top of sandbox.tsx: `BlurView` from `expo-blur`, `Minimize2`, `Terminal` from `lucide-react-native`, `Pressable`, `Text` from `react-native`.

**Step 2: Verify fullscreen works**

Run app → sandbox → start preview config → tap fullscreen → verify header hides, floating pill appears, Console/Exit buttons work.

**Step 3: Commit**

```bash
git add app/sandbox.tsx
git commit -m "feat(mobile): wire fullscreen overlay for preview pages in pager layout"
```
