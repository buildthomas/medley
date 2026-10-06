import { useEffect, useState } from 'react';
import { AddView } from './components/AddView';
import { DiscoverView } from './components/DiscoverView';
import { FiltersPanel } from './components/FiltersPanel';
import { LibraryView } from './components/LibraryView';
import { BulkStatus } from './components/BulkStatus';
import { Home } from './components/Home';
import { Logo } from './components/Logo';
import { Overlays } from './components/Overlays';
import { setTabHandler } from './lib/nav';
import { backfillPositions } from './lib/trackOrder';
import { NewArrivals } from './components/NewArrivals';
import { ListenView } from './components/ListenView';
import { db } from './db';
import { loadFilters, saveFilters } from './lib/settings';
import { requestPersistence } from './lib/storage';
import { readUrlState, writeUrlState } from './lib/urlState';
import { ensureMyGames, resumeInterrupted, runUpdate, syncLibraryMeta } from './lib/updater';
import type { Filters } from './types';
import { useSession } from './useSession';

type Tab = 'home' | 'listen' | 'library' | 'discover' | 'add';
const TABS: { id: Tab; label: string }[] = [
  { id: 'discover', label: 'Discover' },
  { id: 'listen', label: 'Listen' },
  { id: 'library', label: 'Library' },
  { id: 'add', label: 'Add link' },
];

export function App() {
  const [tab, setTabState] = useState<Tab>(() => {
    const t = readUrlState().tab;
    return t === 'home' || TABS.some((x) => x.id === t) ? (t as Tab) : 'discover';
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    writeUrlState({ tab: t });
  };
  // Any view can switch tabs through lib/nav (e.g. following a composer to Discover).
  useEffect(() => setTabHandler(setTab), []);
  const [filters, setFiltersState] = useState<Filters>(loadFilters);
  const session = useSession(filters);

  const setFilters = (f: Filters) => {
    setFiltersState(f);
    saveFilters(f);
  };

  // Background jobs on start-up: own games, then the monthly catalog refresh.
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      await syncLibraryMeta();
      // Ask the browser to keep the library once there is one (see lib/storage.ts).
      if (session.games.length || (await db.games.count())) void requestPersistence();
      await resumeInterrupted();
      await ensureMyGames();
      await runUpdate();
      void backfillPositions(); // album order for libraries imported before positions were stored
    }, 4000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const t = session.current;
    const g = session.currentGame;
    document.title = t && g ? `${t.title} · ${g.title}` : 'Medley';
  }, [session.current, session.currentGame]);

  const compact = tab !== 'listen';

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setTab('home')} title="Home">
          <Logo /> <span className="wordmark">medley</span>
        </button>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <BulkStatus />

      <main>
        {(tab === 'listen' || tab === 'discover') && <NewArrivals session={session} onBrowse={() => setTab('discover')} />}
        {tab === 'home' && <Home onNavigate={setTab} />}
        {tab === 'library' && <LibraryView session={session} />}
        {tab === 'discover' && <DiscoverView session={session} />}
        {tab === 'add' && <AddView />}

        {/* Always mounted so playback continues on other tabs; docks as a mini player. On the
            home page it stays out of sight until something plays (hidden, not unmounted: the
            YouTube player inside must survive). */}
        <div className={`listen-layout ${compact ? 'compact' : ''} ${tab === 'home' && !session.current ? 'dock-hidden' : ''}`}>
          <ListenView session={session} compact={compact} goTo={setTab} />
          {!compact && session.tracks.length > 0 && (
            <FiltersPanel filters={filters} setFilters={setFilters} games={session.games} tracks={session.tracks} />
          )}
        </div>
      </main>
      {/* Title and track pages, over any tab (lib/nav.ts). */}
      <Overlays session={session} />
    </div>
  );
}
