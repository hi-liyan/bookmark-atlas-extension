import React from 'react';
import { createRoot } from 'react-dom/client';
import '../assets/styles.css';
import { PopupApp } from './popup-app';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing popup root element.');
}

createRoot(container).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>
);
