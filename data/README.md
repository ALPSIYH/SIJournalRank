# 期刊評價資料格式

> [English](README.en.md) | 繁體中文


`rank-data.json` 是 SI Journal Rank 使用的期刊評價資料檔，放在擴充功能的
`data/` 目錄。資料檔可包含 CSSCI、北大核心、CSCD、科技核心、新銳分區、
JCR 等體系；實際顯示內容依資料檔內容而定。

## 格式

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

- `records` 的 key 是正規化後的期刊名或別名，英文大寫，中文保留。
- `recordCount` 必須等於 `records` 的實際筆數。
- 程式也支援舊版沒有外層 metadata 的 flat map。
- 只放入排名必要欄位。

## 安裝與更新

1. 取得或產生 `rank-data.json`。
2. 驗證資料檔：

   ```bash
   python3 scripts/validate_data_pack.py data/rank-data.json
   ```

3. 將檔案放到 `data/rank-data.json`。
4. 到 `chrome://extensions` 重新載入 SI Journal Rank。
5. Safari 版將同一份檔案放到 Xcode 專案的
   `safari/SIJournalRank/SIJournalRank Extension/Resources/data/rank-data.json`，再重新 build app。

## 從 raw 檔重建

```bash
python3 scripts/build_rank_data.py \
  --raw-dir /path/to/raw \
  --output /path/to/rank-data.json \
  --data-version 2026.09.1
```

`--official-jcr-dir` 預設是 `<raw-dir>/official_jcr2025`。
`--data-version` 沒給時會寫入 `build-YYYY-MM-DD`。

若還要加入 PubMed 縮寫別名：

```bash
python3 scripts/add_nlm_aliases.py \
  --nlm /path/to/J_Medline.txt \
  --safari-resources /path/to/Safari/Resources/data/rank-data.json
```

`--no-sync` 只更新本地資料檔；`--safari-resources` 可覆寫 Safari 路徑。
