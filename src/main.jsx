import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// Importing supabaseClient has a side-effect: it sets globalThis.__B44_DB__
// to the Supabase-backed `db` wrapper, so every page that does
// `const db = globalThis.__B44_DB__` continues working without changes.
import '@/api/supabaseClient';

import ErrorBoundary from '@/components/ErrorBoundary';
import { ThemeProvider } from "next-themes";

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
