# Docs index

Read top to bottom for the full picture, or jump to what your task touches. Each doc opens with a
short summary so you can stop early.

| Doc | Read it when you… |
|---|---|
| [architecture.md](architecture.md) | need the big picture: processes, data flow, which module owns what |
| [data-model.md](data-model.md) | touch stored data: IndexedDB tables, catalog entries, URL/localStorage keys |
| [data-pipeline.md](data-pipeline.md) | work on the game catalog, collections, covers/tags/keywords, or the monthly refresh |
| [youtube-import.md](youtube-import.md) | work on finding/importing soundtracks: scraping, ranking, title cleaning, chapters, bulk import |
| [shuffle.md](shuffle.md) | change what plays next: the picker, filters, queue, resume-after-refresh |
| [ui.md](ui.md) | change screens or styling: views, Discover components, CSS conventions |
| [operations.md](operations.md) | run scripts, configure personal data/keys, back up or bulk-import a library |
| [gotchas.md](gotchas.md) | hit something weird. Known traps and their fixes |
| [roadmap.md](roadmap.md) | look for what to build next, or why something isn't built |

Conventions in these docs: paths are relative to the repo root; "the server" means the Vite dev
server with the `/api` plugin (`server/plugin.ts`); "the catalog" means `CatalogGame[]`
(public game metadata), "the library" means the user's IndexedDB (games they imported).
