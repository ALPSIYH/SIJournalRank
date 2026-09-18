# Journal ranking data format

`rank-data.json` is the journal ranking data file used by SI Journal Rank. It is placed
in the extension's `data/` directory. The file may contain CSSCI, Peking University Core,
CSCD, China Scientific and Technical Core, Xinrui Quartiles, JCR, and other fields.
Actual display depends on the file contents.

## Format

```json
{
  "format": "si-journal-rank",
  "schemaVersion": 1,
  "dataVersion": "2026.09.1",
  "generatedAt": "2026-09-16T00:00:00Z",
  "recordCount": 25975,
  "records": {
    "EXAMPLE JOURNAL OF STUDIES": {
      "sci": "Q1",
      "sciCats": [
        { "category": "EXAMPLE CATEGORY", "quartile": "Q1" }
      ],
      "sciif": "9.9",
      "xr": "1区",
      "xrCats": [
        { "category": "示例学科", "quartile": "1区" }
      ]
    }
  }
}
```

- `records` keys are normalized journal names or aliases. English names are uppercase;
  Chinese names are kept as-is.
- `recordCount` must equal the number of entries in `records`.
- The loader also supports the legacy flat map without outer metadata.
- Include only the fields required for ranking display.

## Install and update

1. Obtain or generate `rank-data.json`.
2. Validate the data file:

   ```bash
   python3 scripts/validate_data_pack.py data/rank-data.json
   ```

3. Put the file at `data/rank-data.json`.
4. Reload SI Journal Rank at `chrome://extensions`.
5. For Safari, place the same file at the Xcode project's
   `SIJournalRank Extension/Resources/data/rank-data.json`, then rebuild the app.

## Rebuild from raw files

```bash
python3 scripts/build_rank_data.py \
  --raw-dir /path/to/raw \
  --output /path/to/rank-data.json \
  --data-version 2026.09.1
```

`--official-jcr-dir` defaults to `<raw-dir>/official_jcr2025`.
If `--data-version` is omitted, the build writes `build-YYYY-MM-DD`.

To add PubMed abbreviation aliases:

```bash
python3 scripts/add_nlm_aliases.py \
  --nlm /path/to/J_Medline.txt \
  --safari-resources /path/to/Safari/Resources/data/rank-data.json
```

`--no-sync` updates only the local data file. `--safari-resources` overrides the Safari path.
