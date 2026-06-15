import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth/AuthProvider';
import { queryClient, persister, shouldPersistQuery } from './lib/queryClient';
import { ErrorBoundary } from './components/ErrorBoundary';
import App from './App.tsx';
import './index.css';

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
