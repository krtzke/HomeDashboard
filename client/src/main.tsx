import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './styles.css';
import './widgets.css';
import { App } from './App.tsx';
import { seedIfEmpty } from './seed.ts';
import { startAutoSync, syncNow } from './sync.ts';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Pull from the server first so a new device gets the existing dashboard instead of seeding one.
startAutoSync();
void syncNow().finally(seedIfEmpty);
