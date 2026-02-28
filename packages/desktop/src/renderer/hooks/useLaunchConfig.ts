import { useEffect, useState } from 'react';
import type { LaunchConfig } from '@mainframe/types';
import { useProjectsStore } from '../store/projects';

export function useLaunchConfig(): LaunchConfig | null {
  const activeProject = useProjectsStore((s) =>
    s.activeProjectId ? (s.projects.find((p) => p.id === s.activeProjectId) ?? null) : null,
  );
  const [config, setConfig] = useState<LaunchConfig | null>(null);

  useEffect(() => {
    if (!activeProject) {
      setConfig(null);
      return;
    }
    void window.mainframe
      ?.readFile(`${activeProject.path}/.mainframe/launch.json`)
      .then((content) => {
        if (!content) {
          setConfig(null);
          return;
        }
        setConfig(JSON.parse(content) as LaunchConfig);
      })
      .catch(() => setConfig(null));
  }, [activeProject?.id]);

  return config;
}
