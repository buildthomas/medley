import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { checkAuth } from './lib/auth';
import { transferFromOldOrigin } from './lib/originTransfer';
import { migrateLegacyStorage } from './migrate';
import './styles.css';
import './discover.css';

const root = createRoot(document.getElementById('root')!);

async function showApp() {
  // The app (imported only now) reads its settings from localStorage as its modules load.
  const { App } = await import('./App');
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

async function start() {
  // Carry over a library from before the rename (old storage names, old :5173 address) first.
  await migrateLegacyStorage()
    .then(transferFromOldOrigin)
    .catch((e) => console.error('Moving your library to the new storage failed; your old data is untouched.', e));

  // A hosted, invite-only Medley asks you to sign in first (never locally).
  const auth = await checkAuth();
  if (auth.required && !auth.user) {
    const { SignIn } = await import('./components/SignIn');
    root.render(<SignIn onSignedIn={showApp} />);
    return;
  }
  await showApp();
}

void start();
