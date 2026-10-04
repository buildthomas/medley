import { useEffect, useState } from 'react';
import { AddView } from './components/AddView';
import { DiscoverView } from './components/DiscoverView';
import { FiltersPanel } from './components/FiltersPanel';
import { LibraryView } from './components/LibraryView';
import { BulkStatus } from './components/BulkStatus';
import { ListenView } from './components/ListenView';
import { loadFilters, saveFilters } from './lib/settings';
import { readUrlState, writeUrlState } from './lib/urlState';
import { ensureMyGames, monthlyUpdate, syncLibraryMeta } from './lib/updater';
import type { Filters } from './types';
import { useSession } from './useSession';

type Tab = 'listen' | 'library' | 'discover' | 'add';
const TABS: { id: Tab; label: string }[] = [
  { id: 'listen', label: 'Listen' },
  { id: 'library', label: 'Library' },
  { id: 'discover', label: 'Discover' },
  { id: 'add', label: 'Add link' },
];

export function App() {
  const [tab, setTabState] = useState<Tab>(() => {
    const t = readUrlState().tab;
    return TABS.some((x) => x.id === t) ? (t as Tab) : 'listen';
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    writeUrlState({ tab: t === 'listen' ? undefined : t });
  };
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
      await ensureMyGames();
      await monthlyUpdate();
    }, 4000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const t = session.current;
    const g = session.currentGame;
    document.title = t && g ? `${t.title} · ${g.title}` : 'VGM Shuffle';
  }, [session.current, session.currentGame]);

  const compact = tab !== 'listen';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">♫</span> VGM Shuffle
        </div>
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
        {tab === 'library' && <LibraryView session={session} />}
        {tab === 'discover' && <DiscoverView session={session} />}
        {tab === 'add' && <AddView />}

        {/* Always mounted so playback continues on other tabs; docks as a mini player. */}
        <div className={`listen-layout ${compact ? 'compact' : ''}`}>
          <ListenView session={session} compact={compact} goTo={setTab} />
          {!compact && session.tracks.length > 0 && (
            <FiltersPanel filters={filters} setFilters={setFilters} games={session.games} tracks={session.tracks} />
          )}
        </div>
      </main>
    </div>
  );
}
