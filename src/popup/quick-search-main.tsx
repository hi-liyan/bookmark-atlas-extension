import React from 'react';
import { createRoot } from 'react-dom/client';
import '../assets/styles.css';
import { QuickSearchApp } from './quick-search-app';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing quick search root element.');
}

createRoot(container).render(
  <React.StrictMode>
    <QuickSearchApp />
  </React.StrictMode>
);
