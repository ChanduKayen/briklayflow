import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth/AuthProvider';
import { queryClient, persister, shouldPersistQuery } from './lib/queryClient';
import { ErrorBoundary } from './components/ErrorBoundary';
import App from './App.tsx';
import './index.css';

// A new deploy changes every lazy chunk's content hash, and Vercel serves only the LATEST build's
// assets — so a tab still running the previous index.html asks for e.g. PurchaseOrders-<oldhash>.js,
// which now 404s ("Failed to fetch dynamically imported module"). Vite fires `vite:preloadError` in
// that case; reload once to pull the fresh index.html + new hashes. Guard with a short-lived flag so a
// genuinely missing chunk (a real build/deploy fault) surfaces instead of reload-looping forever.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'vite:preloadError:lastReload';
  let last = 0;
  try { last = Number(sessionStorage.getItem(KEY) || 0); } catch { /* private mode — proceed */ }
  if (Date.now() - last < 10_000) return;   // already reloaded seconds ago → stop, let it error
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: persister!,
        // Persisted data is valid for 24h before being discarded on hydrate.
        maxAge: 24 * 60 * 60 * 1000,
        // Bump on shape-breaking changes to invalidate stale clients.
        buster: 'briklay-v1',
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => shouldPersistQuery(query.queryKey),
        },
      }}
    >
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </PersistQueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
);
