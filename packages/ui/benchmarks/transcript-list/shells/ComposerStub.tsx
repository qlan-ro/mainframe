/** A composer-sized footer: the real composer needs a daemon, and only its height matters here. */
export function ComposerStub() {
  return (
    <div className="mx-auto flex w-[calc(100%-0.5rem)] max-w-(--mf-transcript-width) flex-col px-5 pb-4">
      <div data-rig-composer className="h-24 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        Composer
      </div>
    </div>
  );
}
