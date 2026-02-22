interface Props {
  pluginId: string;
}

export function PluginError({ pluginId }: Props) {
  return (
    <div className="flex flex-col items-center justify-center p-4 text-mf-text-secondary text-sm">
      <p className="font-medium text-mf-text-primary">Plugin Error</p>
      <p className="mt-1 opacity-70">Plugin &quot;{pluginId}&quot; failed to load.</p>
    </div>
  );
}
