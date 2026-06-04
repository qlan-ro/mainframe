import { useConnectionState, type ConnectionState } from './useConnectionState';

const COLOR: Record<ConnectionState, string> = {
  connecting: '#f59e0b',
  connected: '#22c55e',
  disconnected: '#ef4444',
};

const LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting...',
  connected: 'Connected',
  disconnected: 'Disconnected',
};

export function App() {
  const { state, daemonStatus, port } = useConnectionState();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#1e1e2e',
        color: '#cdd6f4',
        fontFamily: 'system-ui, sans-serif',
        gap: 16,
      }}
    >
      {/* Traffic-light drag region placeholder */}
      <div
        data-tauri-drag-region
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 40,
        }}
      />

      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: COLOR[state],
          boxShadow: `0 0 8px ${COLOR[state]}`,
        }}
      />
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{LABEL[state]}</h2>
      <p style={{ margin: 0, fontSize: 12, color: '#6c7086' }}>
        daemon: {daemonStatus} {port != null ? `· port ${port}` : ''}
      </p>
    </div>
  );
}
