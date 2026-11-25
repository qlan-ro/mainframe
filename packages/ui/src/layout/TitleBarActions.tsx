/**
 * TitleBarActions — the app-level controls at the title bar's far right: Search,
 * then the Chat and Workspace toggles. Per-chat controls live in each chat
 * column's header.
 */
import { Search } from 'lucide-react';
import { chordHint } from '@/features/shortcuts/chord-hint';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { SurfaceRail } from './SurfaceRail';
import { TitleBarButton } from './TitleBarButton';

export function TitleBarActions() {
  const searchChord = chordHint('app.search-palette');

  return (
    <div data-testid="title-bar-actions" className="flex shrink-0 items-center gap-3 @max-[32rem]/trailing:gap-1">
      <TitleBarButton
        testId="main-toolbar-search"
        data-tut="search"
        label="Search"
        hint={searchChord == null ? 'Search' : `Search\u00a0\u00a0${searchChord}`}
        onClick={() => emitSurfaceIntent({ type: 'open-search-palette' })}
      >
        <Search className="size-4" />
      </TitleBarButton>
      <SurfaceRail />
    </div>
  );
}
