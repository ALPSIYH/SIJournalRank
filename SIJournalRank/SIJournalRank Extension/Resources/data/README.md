# SI Journal Rank data pack

`rank-data.json` 是外部資料檔，不進 Git，也不隨 GitHub repo 發布。
GitHub 上的版本只有程式碼與這份合約文件，沒有期刊排名 records。

## 檔案

| 檔案 | 用途 | Git |
|---|---|---|
| `rank-data.json` | 外部 data pack；產生後放到 extension 的 `data/` 使用 | 不追蹤 |
| `README.md` | 本文件 | 追蹤 |

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

- `records` 的 key 是正規化後的期刊名／別名（英文大寫；中文保留）。
- `recordCount` 必須等於 `records` 的實際筆數。
- 程式也向後相容舊的 flat map（沒有最外層 metadata 的版本）。
- data pack 只放排名必要欄位，不要把來源檔、路徑、授權資訊、URL 或私有 metadata 放進去。

## 安裝與更新（方案 A）

1. 取得或產生新的 `rank-data.json`。
2. 驗證：

   ```bash
   python3 scripts/validate_data_pack.py data/rank-data.json
   ```

3. 把檔案放到 `data/rank-data.json`。
4. 到 `chrome://extensions` 重新載入 SI Journal Rank。
5. Safari 版把同一份檔案複製到 Xcode 專案的
   `SIJournalRank Extension/Resources/data/rank-data.json`，再重新 build app。

如果 `data/rank-data.json` 不存在，擴充功能不會顯示任何期刊 badge，
popup 會顯示「未安裝資料包：請放入 data/rank-data.json」。

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

`--no-sync` 只更新本地 data pack；`--safari-resources` 可覆寫 Safari 路徑。
