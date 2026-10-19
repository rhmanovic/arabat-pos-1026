import '@arabat/ui/fonts';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

// The native app installs `window.ArabatApp` before any script runs; a fake bridge for tests
// (`@arabat/device-core/testing`) may still be opening its in-memory database.
const bridgeReady =
  (window as { __arabatBridgeReady?: Promise<unknown> }).__arabatBridgeReady ?? Promise.resolve();
void bridgeReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
