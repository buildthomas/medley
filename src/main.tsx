import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { migrateLegacyStorage } from './migrate';
import './styles.css';
import './discover.css';

// Carry over a library from before the rename first; the app (imported afterwards) reads its
// settings from localStorage as its modules load.
migrateLegacyStorage()
  .catch((e) => console.error('Moving your library to the new storage failed; your old data is untouched.', e))
  .then(() => import('./App'))
  .then(({ App }) =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
