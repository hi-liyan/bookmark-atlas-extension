import React from 'react';
import { createRoot } from 'react-dom/client';
import '../assets/styles.css';
import { OptionsApp } from './options-app';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing options root element.');
}

createRoot(container).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>
);
