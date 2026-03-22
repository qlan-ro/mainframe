import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useThemeStore } from './store/theme';
import './index.css';

// Trigger LSP auto-connect for open editor files.
import './lib/lsp/index';

// Apply persisted theme class before first paint
useThemeStore.getState();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
