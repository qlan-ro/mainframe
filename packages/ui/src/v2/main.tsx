/**
 * Entry for the v2 clone. Dev-only — `vite build` takes index.html as its sole
 * input, so nothing here reaches a packaged app.
 *
 *   pnpm --filter @qlan-ro/mainframe-ui exec vite --port 5199
 *   open http://localhost:5199/v2.html
 *
 * Until the app shell is ported this mounts the scale lab, which is what
 * verifies the token layer actually landed.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import { applyStoredTheme } from '@/store/theme';
import { ScaleLab } from './lab/ScaleLab';

applyStoredTheme(); // dark class + data-scheme before first paint

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

createRoot(root).render(
  <StrictMode>
    <ScaleLab />
  </StrictMode>,
);
