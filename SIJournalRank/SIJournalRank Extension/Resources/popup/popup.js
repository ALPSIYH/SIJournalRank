if(typeof browser=="undefined"&&typeof chrome!=="undefined"&&chrome.runtime){var browser=chrome}

fetch(browser.runtime.getURL("data/rank-data.json"))
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var count = Object.keys(data).length;
    document.getElementById("count").textContent = "本機資料：約 " + count + " 筆期刊/別名";
  })
  .catch(function() {
    document.getElementById("count").textContent = "資料載入失敗";
  });
