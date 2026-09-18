# SI Journal Rank

A browser extension that marks the ranking systems a journal belongs to directly on academic search and publisher article pages.

- Journal ranking data stays on your machine; no ranking server is contacted
- No login and no browsing history collection
- Supports PubMed, Google Scholar, and major publisher article pages

Dedicated article-page adapters are available for ScienceDirect, Springer Nature, Wiley,
Taylor & Francis, SAGE, Nature, Oxford Academic, IEEE Xplore, and ACM Digital Library.
When a publisher shows a human-verification page, the article DOM is not loaded, so no
badges are shown.

## Supported ranking systems

The extension can display the following ranking systems. Actual coverage depends on the
data file you provide.

- CSSCI / Nanjing University Core (2025-2026)
- Peking University Core (2023)
- CSCD (2025-2026)
- China Scientific and Technical Core (2025)
- Xinrui Quartiles (2026)
- JCR 2025

## Data file

The extension requires a journal ranking data file:

```text
data/rank-data.json
```

The file may contain data for the ranking systems listed above. See
[`data/README.en.md`](data/README.en.md) for the format and build instructions.

## Install (developer mode)

1. Put `rank-data.json` in the `data/` directory
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click Load unpacked
5. Select this project directory

## Safari

The Safari Web Extension Xcode project lives in the `SIJournalRank-safari` project:
`SIJournalRank/SIJournalRank.xcodeproj`.
