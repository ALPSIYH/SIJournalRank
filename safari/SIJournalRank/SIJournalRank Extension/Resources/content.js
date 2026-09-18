if(typeof browser=="undefined"&&typeof chrome!=="undefined"&&chrome.runtime){var browser=chrome}

(function() {
  var rankDataPromise = null;
  var RANK_DATA_URL = "data/rank-data.json";
  var RANK_DATA_SCHEMA_VERSION = 1;

  // 调试日志默认关闭：在页面控制台执行 localStorage.setItem("ljr-debug","1") 并刷新即可打开。
  var DEBUG = false;
  try {
    DEBUG = localStorage.getItem("ljr-debug") === "1";
  } catch (e) {
    DEBUG = false;
  }

  function log() {
    if (DEBUG && typeof console !== "undefined" && console.log) {
      console.log.apply(console, arguments);
    }
  }

  function normalizeDataPack(raw) {
    if (raw && typeof raw === "object" && Array.isArray(raw) === false && raw.records && typeof raw.records === "object" && (raw.format === "si-journal-rank" || raw.schemaVersion || raw.dataVersion || typeof raw.recordCount === "number")) {
      if (raw.schemaVersion && raw.schemaVersion > RANK_DATA_SCHEMA_VERSION) {
        log("[LJR] data pack schema newer than extension", raw.schemaVersion);
      }
      return raw.records;
    }
    return raw && typeof raw === "object" ? raw : {};
  }

  function fetchRankJson(url) {
    return fetch(browser.runtime.getURL(url)).then(function(r) {
      if (r && r.ok === false) {
        throw new Error("HTTP " + r.status);
      }
      return r.json();
    });
  }

  function getRankData() {
    if (rankDataPromise === null) {
      rankDataPromise = fetchRankJson(RANK_DATA_URL).then(normalizeDataPack).catch(function(err) {
        rankDataPromise = null;
        log("[LJR] data pack unavailable; no journal badges will render", err);
        throw err;
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

  function canonical(s) {
    if (s == null) {
      return "";
    }
    return normalize(String(s).replace(/&/g, " AND "));
  }

  function resolveRecord(db, rawName) {
    var key = normalize(rawName);
    if (key === "") {
      return null;
    }
    var candidates = [key];
    if (key.indexOf("THE ") === 0) {
      candidates.push(key.substring(4));
    }
    for (var c = 0; c < candidates.length; c = c + 1) {
      var cand = candidates[c];
      if (db[cand]) {
        return db[cand];
      }
      var compact = cand.replace(/[. ]+$/, "");
      if (compact !== cand && db[compact]) {
        return db[compact];
      }
    }
    var prefixKey = candidates[candidates.length - 1];
    if (prefixKey.length >= 6) {
      var matches = [];
      for (var k in db) {
        if (k.indexOf(prefixKey) === 0) {
          matches.push(k);
        }
      }
      if (matches.length === 1) {
        return db[matches[0]];
      }
    }
    return null;
  }

  var canonDbCache = null;

  function getCanonDb(db) {
    if (canonDbCache === null) {
      canonDbCache = {};
      for (var key in db) {
        var c = canonical(key);
        if (!(c in canonDbCache)) {
          canonDbCache[c] = db[key];
        }
      }
    }
    return canonDbCache;
  }

  function resolveRecordFromVenue(db, venueText) {
    var canon = canonical(venueText);
    if (canon.length < 3) {
      return null;
    }
    var canonDb = getCanonDb(db);
    var words = canon.split(" ");
    for (var n = words.length; n >= 1; n = n - 1) {
      var candidate = words.slice(0, n).join(" ");
      if (candidate.length < 3) {
        continue;
      }
      if (canonDb[candidate]) {
        return canonDb[candidate];
      }
    }
    return null;
  }

  function isPubMed() {
    return location.hostname.indexOf("pubmed.ncbi.nlm.nih.gov") >= 0;
  }
  function isGoogleScholar() {
    return location.hostname.indexOf("scholar.google.com") >= 0;
  }
  function isScholarProfile() {
    return isGoogleScholar() && location.pathname.indexOf("/citations") === 0;
  }
  function extractPubMed(text) {
    var m = text.match(/^([A-Za-z0-9&()\-' ]+?)\s*\.\s*\d{4}/);
    if (m) {
      return m[1].trim();
    }
    return "";
  }
  function extractGoogleScholar(text) {
    text = text.replace(/[\u00a0\u2009\u200a]/g, " ");
    var m = text.match(/- .*?(?=, [0-9]{4})/);
    if (m) {
      return m[0].substring(2).toUpperCase().trim();
    }
    return "";
  }


  var QRANK = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };
  var XRANK = { "1区": 1, "2区": 2, "3区": 3, "4区": 4 };

  function bestQuartile(cats, rankMap) {
    var best = "";
    var bestRank = 99;
    if (cats) {
      for (var i = 0; i < cats.length; i = i + 1) {
        var q = cats[i].quartile;
        var r = rankMap[q] || 99;
        if (r < bestRank) {
          bestRank = r;
          best = q;
        }
      }
    }
    return best;
  }

  var JCR_PRIORITY = ["POLITICAL SCIENCE", "INTERNATIONAL RELATIONS", "PUBLIC ADMINISTRATION"];
  var XR_PRIORITY = ["政治学", "国际关系学", "公共管理"];

  function priorityIndex(cat, priorityList) {
    var n = normalize(cat);
    for (var i = 0; i < priorityList.length; i = i + 1) {
      if (n === normalize(priorityList[i])) {
        return i;
      }
    }
    return priorityList.length;
  }

  function pickQuartileByPriority(cats, priorityList, rankMap) {
    var rows = dedupeCats(cats);
    for (var p = 0; p < priorityList.length; p = p + 1) {
      var matches = [];
      for (var i = 0; i < rows.length; i = i + 1) {
        if (normalize(rows[i].category) === normalize(priorityList[p])) {
          matches.push(rows[i]);
        }
      }
      if (matches.length > 0) {
        return bestQuartile(matches, rankMap);
      }
    }
    return bestQuartile(rows, rankMap);
  }

  function jcrQuartile(record, catsField, scalarField) {
    if (record[catsField] && record[catsField].length > 0) {
      return pickQuartileByPriority(record[catsField], JCR_PRIORITY, QRANK);
    }
    return record[scalarField] || "";
  }

  function xrQuartile(record) {
    if (record.xrCats && record.xrCats.length > 0) {
      return pickQuartileByPriority(record.xrCats, XR_PRIORITY, XRANK);
    }
    return record.xr || "";
  }

  function quartileClass(q) {
    var s = String(q || "").toUpperCase();
    if (s.indexOf("Q1") === 0 || s.indexOf("1") === 0) {
      return "ljr-q1";
    }
    if (s.indexOf("Q2") === 0 || s.indexOf("2") === 0) {
      return "ljr-q2";
    }
    if (s.indexOf("Q3") === 0 || s.indexOf("3") === 0) {
      return "ljr-q3";
    }
    if (s.indexOf("Q4") === 0 || s.indexOf("4") === 0) {
      return "ljr-q4";
    }
    return "ljr-q4";
  }

  function titleCaseCategory(cat) {
    var words = String(cat || "").split(" ");
    var out = [];
    for (var i = 0; i < words.length; i = i + 1) {
      var w = words[i];
      if (!w) {
        continue;
      }
      if (w.length > 3) {
        out.push(w.charAt(0) + w.substring(1).toLowerCase());
      } else {
        out.push(w);
      }
    }
    return out.join(" ");
  }

  function dedupeCats(cats) {
    var seen = {};
    var out = [];
    if (!cats) {
      return out;
    }
    for (var i = 0; i < cats.length; i = i + 1) {
      var key = (cats[i].category || "") + "|" + (cats[i].quartile || "");
      if (!seen[key]) {
        seen[key] = 1;
        out.push(cats[i]);
      }
    }
    return out;
  }

  function buildBadges(record) {
    var badges = [];
    function push(text, cls) {
      badges.push({ text: text, cls: cls });
    }
    var sciQ = jcrQuartile(record, "sciCats", "sci");
    if (sciQ) {
      push("SCI " + sciQ, quartileClass(sciQ));
    }
    var ssciQ = jcrQuartile(record, "ssciCats", "ssci");
    if (ssciQ) {
      push("SSCI " + ssciQ, quartileClass(ssciQ));
    }
    var esciQ = jcrQuartile(record, "esciCats", "esci");
    if (esciQ) {
      push("ESCI " + esciQ, quartileClass(esciQ));
    }
    if (record.ahci) {
      push("A&HCI", "ljr-ahci");
    }
    var xrQ = xrQuartile(record);
    if (xrQ) {
      push("新銳" + xrQ, quartileClass(xrQ));
    }
    if (record.xrTop) {
      push("新銳Top", "ljr-top");
    }
    if (record.cssci) {
      push(record.cssci === "CSSCI" ? "CSSCI" : "CSSCI扩展", "ljr-cssci");
    }
    if (record.pku) {
      push("北大核心", "ljr-pku");
    }
    if (record.cscd) {
      push(record.cscd === "CSCD核心库" ? "CSCD核心" : "CSCD扩展", "ljr-cscd");
    }
    if (record.sciif) {
      push("IF " + record.sciif, "ljr-if");
    }
    return badges;
  }

  function buildCategoryGroups(record) {
    var groups = [];
    function prepareRows(cats, titleCase, priorityList, rankMap) {
      var rows = dedupeCats(cats);
      if (rows.length === 0) {
        return null;
      }
      rows.sort(function(a, b) {
        var pa = priorityIndex(a.category, priorityList);
        var pb = priorityIndex(b.category, priorityList);
        if (pa !== pb) {
          return pa - pb;
        }
        var ra = rankMap[a.quartile] || 99;
        var rb = rankMap[b.quartile] || 99;
        return ra - rb;
      });
      var prepared = [];
      for (var i = 0; i < rows.length; i = i + 1) {
        var cat = rows[i].category || "";
        prepared.push({
          cat: titleCase ? titleCaseCategory(cat) : cat,
          q: rows[i].quartile || "",
          top: rows[i].top === true
        });
      }
      return prepared;
    }
    var jcrCats = [];
    function mergeCats(src) {
      if (src) {
        for (var i = 0; i < src.length; i = i + 1) {
          jcrCats.push(src[i]);
        }
      }
    }
    mergeCats(record.sciCats);
    mergeCats(record.ssciCats);
    mergeCats(record.esciCats);
    var jcrRows = prepareRows(jcrCats, true, JCR_PRIORITY, QRANK);
    if (jcrRows) {
      groups.push({ label: "JCR", rows: jcrRows });
    }
    var xrRows = prepareRows(record.xrCats, false, XR_PRIORITY, XRANK);
    if (xrRows) {
      groups.push({ label: "新銳", rows: xrRows });
    }
    return groups;
  }

  function buildDetailEl(groups) {
    var box = document.createElement("span");
    box.className = "ljr-detail";
    for (var g = 0; g < groups.length; g = g + 1) {
      var group = groups[g];
      var gdiv = document.createElement("span");
      gdiv.className = "ljr-detail-group";
      var title = document.createElement("span");
      title.className = "ljr-detail-title";
      title.textContent = group.label;
      gdiv.appendChild(title);
      for (var r = 0; r < group.rows.length; r = r + 1) {
        var row = document.createElement("span");
        row.className = "ljr-detail-row";
        var cat = document.createElement("span");
        cat.className = "ljr-detail-cat";
        cat.textContent = group.rows[r].cat;
        var q = document.createElement("span");
        q.className = "ljr-detail-q";
        q.textContent = group.rows[r].q + (group.rows[r].top ? " · Top" : "");
        row.appendChild(cat);
        row.appendChild(q);
        gdiv.appendChild(row);
      }
      box.appendChild(gdiv);
    }
    return box;
  }

  function appendBadges(holder, name, record) {
    var badges = buildBadges(record);
    for (var i = 0; i < badges.length; i = i + 1) {
      var span = document.createElement("span");
      span.className = "ljr-badge " + badges[i].cls;
      span.textContent = badges[i].text;
      holder.appendChild(span);
    }
    var groups = buildCategoryGroups(record);
    if (groups.length > 0) {
      var btn = document.createElement("span");
      btn.className = "ljr-more";
      btn.setAttribute("role", "button");
      btn.setAttribute("tabindex", "0");
      btn.setAttribute("aria-label", "分類詳情");
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = '<span class="ljr-more-label">分類詳情</span><svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true"><path d="M1 1l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      var labelEl = btn.querySelector(".ljr-more-label");
      var detail = null;
      function toggleDetail() {
        if (detail) {
          detail.remove();
          detail = null;
          btn.classList.remove("ljr-open");
          btn.setAttribute("aria-expanded", "false");
          btn.setAttribute("aria-label", "分類詳情");
          if (labelEl) {
            labelEl.textContent = "分類詳情";
          }
        } else {
          detail = buildDetailEl(groups);
          holder.appendChild(detail);
          btn.classList.add("ljr-open");
          btn.setAttribute("aria-expanded", "true");
          btn.setAttribute("aria-label", "收起");
          if (labelEl) {
            labelEl.textContent = "收起";
          }
        }
      }
      btn.addEventListener("click", toggleDetail);
      btn.addEventListener("keydown", function(e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          if (e.preventDefault) {
            e.preventDefault();
          }
          toggleDetail();
        }
      });
      holder.appendChild(btn);
    }
  }

  function addBadges(anchor, name, record, options) {
    if (record) {
      var holder = document.createElement("span");
      holder.className = "ljr-badges";
      if (options && options.extraClass) {
        holder.classList.add(options.extraClass);
      }
      appendBadges(holder, name, record);
      if (holder.childNodes.length > 0) {
        if (options && options.placement === "inside") {
          anchor.appendChild(holder);
        } else if (anchor.nextSibling) {
          anchor.parentNode.insertBefore(holder, anchor.nextSibling);
        } else {
          anchor.parentNode.appendChild(holder);
        }
      }
    }
  }

  function getCitationJournalName(item) {
    var container = item.closest ? item.closest(".gs_r") : null;
    if (container) {
      var cid = container.getAttribute("data-cid");
      if (cid) {
        var host = location.hostname;
        var url;
        if (location.href.indexOf("scholar?scilib=") >= 0) {
          url = "https://" + host + "/scholar?scila=" + encodeURIComponent(cid) + "&output=cite&scirp=1&hl=zh-TW";
        } else {
          url = "https://" + host + "/scholar?q=info:" + encodeURIComponent(cid) + ":scholar.google.com/&output=cite&scirp=0&hl=zh-TW";
        }
        return fetch(url).then(function(r) { return r.text(); }).then(function(html) {
          var doc = new DOMParser().parseFromString(html, "text/html");
          var rows = doc.querySelectorAll("tr");
          for (var i = 0; i < rows.length; i = i + 1) {
            var th = rows[i].querySelector("th.gs_cith");
            if (th) {
              var label = th.textContent.trim();
              if (label === "MLA" || label === "APA") {
                var italic = rows[i].querySelector("td .gs_citr i");
                if (italic) {
                  return italic.textContent.trim();
                }
              }
            }
          }
          return null;
        }).catch(function() { return null; });
      }
    }
    return Promise.resolve(null);
  }

  function lookupAndRender(item, name, anchor, options) {
    if (name) {
      getRankData().then(function(db) {
        var rec = resolveRecord(db, name);
        log("[LJR] match", name, rec ? Object.keys(rec) : null);
        if (rec) {
          addBadges(anchor, name, rec, options);
        } else if (isGoogleScholar() && name.indexOf("\u2026") >= 0) {
          getCitationJournalName(item).then(function(fullName) {
            if (fullName) {
              log("[LJR] citation full", fullName);
              var fullRec = resolveRecord(db, fullName);
              log("[LJR] citation match", fullName, fullRec ? Object.keys(fullRec) : null);
              addBadges(anchor, fullName, fullRec, options);
            }
          });
        }
      }).catch(function(err) {
        log("[LJR] fetch error", err);
      });
    }
  }

  function lookupVenueAndRender(item, venueText, anchor, options) {
    if (venueText) {
      getRankData().then(function(db) {
        var rec = resolveRecordFromVenue(db, venueText);
        log("[LJR] venue match", venueText, rec ? Object.keys(rec) : null);
        if (rec) {
          addBadges(anchor, venueText, rec, options);
        }
      }).catch(function(err) {
        log("[LJR] venue fetch error", err);
      });
    }
  }

  function processPubMed() {
    var items = document.querySelectorAll("article.docsum-content");
    for (var i = 0; i < items.length; i = i + 1) {
      var item = items[i];
      if (item.getAttribute("data-ljr") === "1") {
        continue;
      }
      var cit = item.querySelector(".full-journal-citation, .docsum-journal-citation");
      if (cit) {
        var name = extractPubMed(cit.textContent);
        if (name) {
          item.setAttribute("data-ljr", "1");
          lookupAndRender(item, name, cit);
        }
      }
    }
    var detail = document.querySelector("#full-view-journal-trigger, .journal-actions-trigger");
    if (detail) {
      if (detail.getAttribute("data-ljr") === "1") {
        return;
      }
      var dname = detail.textContent.trim();
      if (dname) {
        detail.setAttribute("data-ljr", "1");
        lookupAndRender(detail, dname, detail);
      }
    }
  }

  function processGoogleScholar() {
    var items = document.querySelectorAll(".gs_ri");
    for (var i = 0; i < items.length; i = i + 1) {
      var item = items[i];
      if (item.getAttribute("data-ljr") === "1") {
        continue;
      }
      var meta = item.querySelector(".gs_a");
      if (meta) {
        var name = extractGoogleScholar(meta.textContent);
        log("[LJR] candidate", name);
        if (name) {
          item.setAttribute("data-ljr", "1");
          lookupAndRender(item, name, meta, { placement: "inside" });
        }
      }
    }
  }

  function extractVenueText(venueDiv) {
    if (!venueDiv) {
      return "";
    }
    var clone = venueDiv.cloneNode(true);
    var oph = clone.querySelector(".gs_oph");
    if (oph) {
      oph.remove();
    }
    return clone.textContent.trim();
  }

  function processScholarProfile() {
    var rows = document.querySelectorAll("tr.gsc_a_tr");
    for (var i = 0; i < rows.length; i = i + 1) {
      var row = rows[i];
      if (row.getAttribute("data-ljr") === "1") {
        continue;
      }
      var gray = row.querySelectorAll(".gs_gray");
      var venue = gray.length > 1 ? gray[1] : null;
      var venueText = extractVenueText(venue);
      log("[LJR] profile venue", venueText);
      if (venueText) {
        row.setAttribute("data-ljr", "1");
        lookupVenueAndRender(row, venueText, venue, { placement: "inside" });
      }
    }
  }

  var PUBLISHERS = [
    { id: "sciencedirect", match: function() { return location.hostname.indexOf("sciencedirect.com") >= 0 && location.pathname.indexOf("/article/") >= 0; }, journalSelectors: ["a.publication-title", ".publication-title a", ".publication-title"], titleSelectors: ["h1.article-title", ".article-title", "h1.title", "#screen-reader-main-title"] },
    { id: "springer", match: function() { return location.hostname === "link.springer.com" && location.pathname.indexOf("/article/") >= 0; }, journalSelectors: ["a[data-test='journal-title']", "[data-test='journal-title']", "a.c-article-header__journal", "a.c-breadcrumbs__link[href^='/journal/']"], titleSelectors: ["h1.c-article-title", ".c-article-title", "h1[data-test='article-title']"] },
    { id: "wiley", match: function() { return location.hostname.indexOf("onlinelibrary.wiley.com") >= 0 && location.pathname.indexOf("/doi/") >= 0; }, journalSelectors: ["#journal-banner-text a", "div.journal-banner-text a"], titleSelectors: ["h1.citation__title"] },
    { id: "tandfonline", match: function() { return location.hostname.indexOf("tandfonline.com") >= 0 && location.pathname.indexOf("/doi/") >= 0; }, journalSelectors: ["span.journal-heading", "a.bc-click[href^='/journals/']"], titleSelectors: ["div.literatumPublicationHeader h1", "h1.article-title", "h1.entry-title", "h1.title"] },
    { id: "sagepub", match: function() { return location.hostname.indexOf("journals.sagepub.com") >= 0 && location.pathname.indexOf("/doi/") >= 0; }, journalSelectors: ["a.journal-title", "a.journal-logo", ".journal-logo a", "a[href*='/journal/']"], titleSelectors: ["article header h1", "h1.article-title", "h1.entry-title", ".article-title"] },
    { id: "nature", match: function() { return location.hostname.indexOf("nature.com") >= 0 && location.pathname.indexOf("/articles/") >= 0; }, journalSelectors: ["a[data-test='journal-link']", "[data-test='journal-name']", "a[data-test='journal-name']", "a.c-article-header__journal"], titleSelectors: ["h1.c-article-title", "h1[data-test='article-title']", "h1#article-title"] },
    { id: "oup", match: function() { return location.hostname.indexOf("academic.oup.com") >= 0 && (location.pathname.indexOf("/article/") >= 0 || location.pathname.indexOf("/article-abstract/") >= 0); }, journalFromPath: true, journalSelectors: ["a.journal-title", ".journal-title", "a[href*='/issue/']"], titleSelectors: ["h1.at-articleTitle", "h1.article-title-main", "h1.article-title", "h1.title"] },
    { id: "ieee", match: function() { return location.hostname.indexOf("ieeexplore.ieee.org") >= 0 && location.pathname.indexOf("/document/") >= 0; }, journalSelectors: [".doc-abstract-pubname a", "a.stats-document-abstract-publishedIn", ".stats-document-abstract-publishedIn a"], titleSelectors: ["h1.document-title", ".document-title"] },
    { id: "acm", match: function() { return location.hostname.indexOf("dl.acm.org") >= 0 && location.pathname.indexOf("/doi/") >= 0; }, journalSelectors: ["a.article__tocHeading[href*='/journal/']", "div.issue-item__detail a", ".citation__journal a", "a[href*='/journal/']"], titleSelectors: ["h1[property='name']", "h1.citation__title", "h1.article-title"] }
  ];

  function findSelector(selectors) {
    if (!selectors) {
      return null;
    }
    for (var i = 0; i < selectors.length; i = i + 1) {
      var cand = document.querySelector(selectors[i]);
      if (cand) {
        return cand;
      }
    }
    return null;
  }

  function findPublisherJournal(ad) {
    if (ad.journalFromPath) {
      var pathParts = location.pathname.split("/").filter(function(part) { return part; });
      var journalPath = pathParts.length ? "/" + pathParts[0] : "";
      if (journalPath) {
        var links = document.querySelectorAll("a[href]");
        for (var i = 0; i < links.length; i = i + 1) {
          if (links[i].getAttribute("href") === journalPath) {
            return links[i];
          }
        }
      }
    }
    return findSelector(ad.journalSelectors);
  }

  function processPublisherElement(ad, journalEl, titleEl) {
    if (titleEl.getAttribute("data-ljr") === "1") {
      return;
    }
    var name = (journalEl.textContent || "").replace(/\s+/g, " ").trim();
    if (!name) {
      var journalImage = journalEl.querySelector("img[alt]");
      name = journalImage ? (journalImage.getAttribute("alt") || "").replace(/\s+/g, " ").trim() : "";
    }
    if (!name) {
      return;
    }
    titleEl.setAttribute("data-ljr", "1");
    log("[LJR] publisher " + ad.id + " candidate", name);
    getRankData().then(function(db) {
      var rec = resolveRecord(db, name) || resolveRecordFromVenue(db, name);
      log("[LJR] publisher " + ad.id, name, rec ? "HIT" : "miss");
      if (rec) {
        addBadges(titleEl, name, rec, { placement: "after", extraClass: "ljr-publisher-row" });
      }
    }).catch(function(err) {
      log("[LJR] publisher fetch error", err);
    });
  }

  function runPublisherAdapter(ad) {
    var journalEl = findPublisherJournal(ad);
    var titleEl = findSelector(ad.titleSelectors);
    if (!journalEl || !titleEl) {
      return;
    }
    processPublisherElement(ad, journalEl, titleEl);
  }

  function runPublishers() {
    for (var i = 0; i < PUBLISHERS.length; i = i + 1) {
      if (PUBLISHERS[i].match()) {
        runPublisherAdapter(PUBLISHERS[i]);
        return;
      }
    }
  }

  function run() {
    log("[LJR] run on", location.hostname);
    log("[LJR] gs_ri", document.querySelectorAll(".gs_ri").length);
    log("[LJR] gs_a", document.querySelectorAll(".gs_a").length);
    log("[LJR] gsc_a_tr", document.querySelectorAll("tr.gsc_a_tr").length);
    if (isPubMed()) {
      processPubMed();
    } else if (isScholarProfile()) {
      processScholarProfile();
    } else if (isGoogleScholar()) {
      processGoogleScholar();
    } else {
      runPublishers();
    }
    log("[LJR] badges after run", document.querySelectorAll(".ljr-badge").length);
  }

  var RESCAN_DELAY_MS = 300;
  var rescanTimer = null;

  // 页面持续变动时把重扫合并成每 300ms 一次，避免每个 DOM 变更都全量重扫一遍。
  function scheduleRun() {
    if (typeof setTimeout !== "function") {
      run();
      return;
    }
    if (rescanTimer !== null) {
      return;
    }
    rescanTimer = setTimeout(function() {
      rescanTimer = null;
      run();
    }, RESCAN_DELAY_MS);
  }

  function start() {
    run();
    new MutationObserver(scheduleRun).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
