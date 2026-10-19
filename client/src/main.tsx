import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './styles.css';
import './widgets.css';
import { App } from './App.tsx';
import { initialSync } from './startup.ts';
import { startAutoSync } from './sync.ts';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

startAutoSync();
void initialSync();
