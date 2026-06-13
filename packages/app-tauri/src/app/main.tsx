import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/globals.css';
import { applyStoredTheme } from '../store/theme';
import { TooltipProvider } from '../components/ui/tooltip';
import { App } from './App';

applyStoredTheme(); // sync FOUC guard: dark class + data-scheme before first paint

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

createRoot(root).render(
  <StrictMode>
    <TooltipProvider delayDuration={0}>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
