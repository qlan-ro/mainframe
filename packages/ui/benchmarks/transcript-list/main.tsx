import { Profiler, StrictMode, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { ThreadPrimitive } from '@assistant-ui/react';
import { useUiPrefs } from '@/store/ui-prefs';
import { TRANSCRIPT_WIDTH_VAR } from '@/features/chat/thread/TranscriptWidthHandle';
import './rig.css';
import { params } from './params';
import { RigRuntime } from './runtime';
import { store } from './store';
import { buildLongTurn } from './fixture';
import { controls } from './controls';
import { commits } from './commits';
import { tail } from './tail';
import { watchBoot } from './scenarios/boot';
import { p1, p2, p3 } from './scenarios/anchor';
import { p4follow, p4release } from './scenarios/follow';
import { p6scroll, p6tail, p7proxy } from './scenarios/cost';
import { startManual } from './scenarios/manual';
import { sNoise, sTop } from './scenarios/short-window';
import { installOverlayScrollbars } from '@/lib/overlay-scrollbars/manager';
import { V0Shell } from './shells/V0Shell';
import { V1Shell } from './shells/V1Shell';
import { V1sShell } from './shells/V1sShell';
import { V2Shell } from './shells/V2Shell';
import { openSomeTurns } from './open-turns';

const SHELLS = { v0: V0Shell, v1: V1Shell, v1s: V1sShell, 'v1s-patched': V1sShell, v2: V2Shell };
const SCENARIOS = { p1, p2, p3, p4follow, p4release, p6scroll, p6tail, p7proxy, sTop, sNoise } as Record<
  string,
  (o: object) => Promise<unknown>
>;

openSomeTurns();
if (params.live && params.shape !== 'real')
  store.set({ messages: [...store.get().messages, ...buildLongTurn(9000)], running: true });

function Rig() {
  const Shell = SHELLS[params.variant];
  const width = useUiPrefs((s) => s.transcriptWidth);
  return (
    <div
      className={`flex h-full flex-col bg-background${params.contentVisibility ? ' rig-cv' : ''}`}
      style={{ [TRANSCRIPT_WIDTH_VAR]: `${width}px` } as CSSProperties}
    >
      <RigRuntime>
        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <Profiler id="transcript" onRender={(_id, _phase, duration) => commits.push(duration)}>
            <Shell />
          </Profiler>
        </ThreadPrimitive.Root>
      </RigRuntime>
    </div>
  );
}

const start = performance.now();
tail.start = start;
const boot = watchBoot(start);
// Manual mode draws the app's own overlay scrollbar thumb (native bars are hidden app-wide).
if (params.manual && params.scrollbar) installOverlayScrollbars();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Rig />
  </StrictMode>,
);

if (params.manual) void startManual();

Object.assign(window, {
  __rig: {
    params,
    store,
    controls,
    boot,
    async run(name: string, options: object = {}) {
      const scenario = SCENARIOS[name];
      if (!scenario) throw new Error(`unknown scenario ${name}`);
      try {
        return { ok: true, variant: params.variant, result: await scenario(options) };
      } catch (error) {
        return { ok: false, variant: params.variant, error: String(error) };
      }
    },
  },
});
