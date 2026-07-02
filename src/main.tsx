import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// PWA service worker — enables offline play once cached.
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline caching is a progressive enhancement */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
