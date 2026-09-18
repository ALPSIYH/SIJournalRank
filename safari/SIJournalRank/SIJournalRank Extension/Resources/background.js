if(typeof browser=="undefined"&&typeof chrome!=="undefined"&&chrome.runtime){var browser=chrome}

let rankDataPromise = null;

function getRankData() {
  if (rankDataPromise === null) {
    var dataUrl = browser.runtime.getURL("data/rank-data.json");
    rankDataPromise = fetch(dataUrl).then(function(response) {
      return response.json();
    });
  }
  return rankDataPromise;
}

function normalize(s) {
  if (s == null) {
    return "";
  }
  var parts = String(s).toUpperCase().split(/[^A-Z0-9&\u4e00-\u9fa5]+/);
  var kept = [];
  for (var i = 0; i < parts.length; i = i + 1) {
    if (parts[i]) {
      kept.push(parts[i]);
    }
  }
  return kept.join(" ");
}

function resolveRecord(db, rawName) {
  var key = normalize(rawName);
  if (key === "") {
    return null;
  }
  if (db[key]) {
    return db[key];
  }
  // Remove a trailing ellipsis-like fragment and retry exact match.
  var compact = key.replace(/[. ]+$/, "");
  if (compact !== key && db[compact]) {
    return db[compact];
  }
  // Unique prefix fallback for truncated Google Scholar journal names.
  if (key.length >= 6) {
    var matches = [];
    for (var k in db) {
      if (k.indexOf(key) === 0) {
        matches.push(k);
      }
    }
    if (matches.length === 1) {
      return db[matches[0]];
    }
  }
  return null;
}

browser.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.action === "lookup") {
    getRankData().then(function(db) {
      var names = msg.names || [];
      var results = [];
      for (var i = 0; i < names.length; i = i + 1) {
        var rec = resolveRecord(db, names[i]);
        results.push({ name: names[i], key: rec ? normalize(names[i]) : "", record: rec });
      }
      sendResponse({ ok: true, results: results });
    }).catch(function(err) {
      sendResponse({ ok: false, error: String(err) });
    });
    return true;
  }
});
