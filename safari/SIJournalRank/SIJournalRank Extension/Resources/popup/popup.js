if(typeof browser=="undefined"&&typeof chrome!=="undefined"&&chrome.runtime){var browser=chrome}

function fetchRankJson(url) {
  return fetch(browser.runtime.getURL(url)).then(function(r) {
    if (r && r.ok === false) {
      throw new Error("HTTP " + r.status);
    }
    return r.json();
  });
}

function normalizeDataPack(raw) {
  if (raw && typeof raw === "object" && Array.isArray(raw) === false && raw.records && typeof raw.records === "object" && (raw.format === "si-journal-rank" || raw.schemaVersion || raw.dataVersion || typeof raw.recordCount === "number")) {
    return { records: raw.records, dataVersion: raw.dataVersion || "" };
  }
  return { records: raw && typeof raw === "object" ? raw : {}, dataVersion: "" };
}

fetchRankJson("data/rank-data.json")
  .then(normalizeDataPack)
  .then(function(pack) {
    var count = Object.keys(pack.records).length;
    var version = pack.dataVersion ? "（" + pack.dataVersion + "）" : "";
    document.getElementById("count").textContent = "本機資料：" + count + " 筆期刊/別名" + version;
  })
  .catch(function() {
    document.getElementById("count").textContent = "未安裝資料包：請放入 data/rank-data.json";
  });
