import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { transferFromOldOrigin } from './lib/originTransfer';
import { migrateLegacyStorage } from './migrate';
import './styles.css';
import './discover.css';

// Carry over a library from before the rename (old storage names, old :5173 address) first;
// the app (imported afterwards) reads its settings from localStorage as its modules load.
migrateLegacyStorage()
  .then(transferFromOldOrigin)
  .catch((e) => console.error('Moving your library to the new storage failed; your old data is untouched.', e))
  .then(() => import('./App'))
  .then(({ App }) =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
