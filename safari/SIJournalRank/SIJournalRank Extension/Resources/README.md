# SI Journal Rank

> [English](README.en.md) | 繁體中文


在學術搜尋與出版社文章頁上，直接標出這本期刊收錄於哪些評價體系的瀏覽器擴充功能。

- 期刊評價資料儲存在本機，不連任何伺服器
- 不要求登入，也不收集瀏覽紀錄
- 支援 PubMed、Google Scholar，以及主要出版社文章頁顯示期刊標籤

目前有專用文章頁 adapter 的出版社：ScienceDirect、Springer Nature、Wiley、
Taylor & Francis、SAGE、Nature、Oxford Academic、IEEE Xplore 與 ACM Digital Library。
遇到出版社的人機驗證頁時，文章 DOM 尚未載入，因此不會顯示標籤。

## 支援的評價體系

擴充功能可顯示下列評價體系；實際內容取決於你提供的資料檔。

- CSSCI / 南大核心（2025-2026）
- 北大核心（2023）
- CSCD（2025-2026）
- 科技核心（2025）
- 新銳分區（2026）
- JCR 2025

## 資料檔

擴充功能需要一份期刊評價資料檔：

```text
data/rank-data.json
```

資料檔可包含上述評價體系的資料。格式與產生方式見
[`data/README.md`](data/README.md)。

## 安裝（開發者模式）

1. 將 `rank-data.json` 放到 `data/` 目錄
2. 開啟 `chrome://extensions`
3. 開啟「開發人員模式」
4. 點「載入未封裝項目」
5. 選擇這個專案的資料夾

## Safari

Safari Web Extension 的 Xcode 專案位於 `SIJournalRank-safari` 專案：
`SIJournalRank/SIJournalRank.xcodeproj`。
