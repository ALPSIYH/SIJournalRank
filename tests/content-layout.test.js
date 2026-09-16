#!/usr/bin/env node
'use strict';

/* =========================================================================
 * SI Journal Rank — content-layout DOM regression tests (Task 1 RED → Task 2 GREEN)
 *
 * Executes the REAL content.js against fixture DOMs using a dependency-free
 * minimal DOM shim (Node built-ins only — no packages installed).
 *
 * Run:  node tests/content-layout.test.js
 *
 * The assertions below describe the approved contextual-badge contract:
 *   1. Scholar search badges live INSIDE .gs_a (publication metadata).
 *   2. Scholar profile badges live INSIDE the second .gs_gray (venue node).
 *   3. Publisher badges follow the article title, not the journal/logo anchor,
 *      and carry the ljr-publisher-row modifier.
 *   4. The category control never shows a combined /\d+\s*學科/ count.
 *   5. The category control is a keyboard-accessible element (role=button,
 *      tabindex=0), NOT a native <button>.
 *   6. Expanded details stay grouped as JCR and 新銳.
 *   7–8. Enter and Space toggle the control and are default-prevented.
 *   9. No badges render when a publisher page has only an unrelated bare h1
 *      and no explicit article-title target (generic h1 fallback is prohibited).
 *  11–15. Live publisher DOM regressions for T&F, Nature, OUP, SAGE and ACM.
 * ========================================================================= */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const CONTENT_JS = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const RANK_DATA = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'rank-data.json'), 'utf8')
);

/* --------------------------------------------------------------------------
 * Minimal DOM shim — implements only the DOM surface content.js touches
 * (createElement / querySelector(All) / textContent / className / classList /
 * attributes / childNodes / insertBefore / appendChild / remove / cloneNode /
 * closest / events / innerHTML mini-parser). Not a browser; a test fixture.
 * ------------------------------------------------------------------------ */

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&ensp;/g, '\u2002')
    .replace(/&emsp;/g, '\u2003')
    .replace(/&thinsp;/g, '\u2009')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&times;/g, '\u00d7')
    .replace(/&middot;/g, '\u00b7')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

class MiniNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
  }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
}

class MiniText extends MiniNode {
  constructor(data) {
    super(3);
    this.nodeName = '#text';
    this.data = String(data);
  }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

class MiniElement extends MiniNode {
  constructor(tagName) {
    super(1);
    this.tagName = String(tagName).toUpperCase();
    this.nodeName = this.tagName;
    this.attributes = new Map();
    this.children = [];
    this._listeners = {};
  }

  /* ---- attributes ---- */
  getAttribute(name) {
    return this.attributes.has(String(name).toLowerCase())
      ? this.attributes.get(String(name).toLowerCase())
      : null;
  }
  hasAttribute(name) { return this.attributes.has(String(name).toLowerCase()); }
  setAttribute(name, value) { this.attributes.set(String(name).toLowerCase(), String(value)); }
  removeAttribute(name) { this.attributes.delete(String(name).toLowerCase()); }

  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }

  get classList() {
    const el = this;
    return {
      add(...names) {
        const cur = new Set(el.className.split(/\s+/).filter(Boolean));
        for (const n of names) cur.add(n);
        el.className = Array.from(cur).join(' ');
      },
      remove(...names) {
        const cur = new Set(el.className.split(/\s+/).filter(Boolean));
        for (const n of names) cur.delete(n);
        el.className = Array.from(cur).join(' ');
      },
      contains(name) { return el.className.split(/\s+/).includes(name); },
      toggle(name, force) {
        const has = this.contains(name);
        const want = force === undefined ? !has : !!force;
        if (want && !has) this.add(name);
        if (!want && has) this.remove(name);
        return want;
      }
    };
  }

  /* ---- tree structure ---- */
  _syncChildren() {
    this.children = this.childNodes.filter((n) => n.nodeType === 1);
  }

  appendChild(node) {
    if (node.parentNode) node.remove();
    node.parentNode = this;
    this.childNodes.push(node);
    this._syncChildren();
    return node;
  }

  insertBefore(node, ref) {
    if (node.parentNode) node.remove();
    node.parentNode = this;
    if (ref == null || !this.childNodes.includes(ref)) {
      this.childNodes.push(node);
    } else {
      this.childNodes.splice(this.childNodes.indexOf(ref), 0, node);
    }
    this._syncChildren();
    return node;
  }

  remove() {
    if (!this.parentNode) return;
    const p = this.parentNode;
    const i = p.childNodes.indexOf(this);
    if (i >= 0) p.childNodes.splice(i, 1);
    this.parentNode = null;
    p._syncChildren();
  }

  cloneNode(deep) {
    const clone = new MiniElement(this.tagName);
    for (const [k, v] of this.attributes) clone.attributes.set(k, v);
    if (deep) {
      for (const c of this.childNodes) {
        clone.appendChild(c.nodeType === 1 ? c.cloneNode(true) : new MiniText(c.data));
      }
    }
    return clone;
  }

  /* ---- text ---- */
  get textContent() {
    let out = '';
    for (const c of this.childNodes) out += c.textContent;
    return out;
  }
  set textContent(v) {
    this.childNodes = [new MiniText(String(v))];
    this.childNodes[0].parentNode = this;
    this._syncChildren();
  }

  /* ---- html ---- */
  get innerHTML() { return serialize(this); }
  set innerHTML(html) {
    this.childNodes = [];
    this.children = [];
    for (const n of parseFragment(String(html))) this.appendChild(n);
  }

  /* ---- siblings ---- */
  get nextSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[i + 1] || null;
  }
  get previousSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[i - 1] || null;
  }
  get nextElementSibling() {
    let n = this.nextSibling;
    while (n && n.nodeType !== 1) n = n.nextSibling;
    return n;
  }
  get previousElementSibling() {
    let n = this.previousSibling;
    while (n && n.nodeType !== 1) n = n.previousSibling;
    return n;
  }

  /* ---- events ---- */
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  dispatchEvent(event) {
    const ev = typeof event === 'string' ? { type: event } : event;
    if (!ev.target) ev.target = this;
    for (const fn of this._listeners[ev.type] || []) fn(ev);
  }
  click() { this.dispatchEvent('click'); }

  /* ---- selector engine (subset: tag, .class, #id, [attr=val], [attr*=val],
   *       descendant combinator with a space) ---- */
  matches(sel) { return matchesTokens(this, String(sel).trim().split(/\s+/)); }

  closest(sel) {
    const tokens = String(sel).trim().split(/\s+/);
    let el = this;
    while (el) {
      if (matchesTokens(el, tokens)) return el;
      el = el.parentElement;
    }
    return null;
  }

  querySelectorAll(sel) {
    const tokens = String(sel).trim().split(/\s+/);
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (matchesTokens(c, tokens)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function matchToken(el, token) {
  const tagMatch = token.match(/^([a-zA-Z0-9*]+)/);
  if (tagMatch && tagMatch[1] !== '*') {
    if (el.tagName.toLowerCase() !== tagMatch[1].toLowerCase()) return false;
  }
  const idMatch = token.match(/#([\w-]+)/);
  if (idMatch && el.getAttribute('id') !== idMatch[1]) return false;
  const classRe = /\.([\w-]+)/g;
  let m;
  while ((m = classRe.exec(token))) {
    if (!el.classList.contains(m[1])) return false;
  }
  const attrRe = /\[([a-zA-Z0-9_:.-]+)(\^=|\$=|\*=)?(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  while ((m = attrRe.exec(token))) {
    if (!el.hasAttribute(m[1])) return false;
    const actual = el.getAttribute(m[1]);
    const op = m[2];
    const expected = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : (m[5] !== undefined ? m[5] : null));
    if (op === undefined && expected === null) continue; // presence-only [attr]
    if (op === '*=') {
      if (actual === null || !actual.includes(expected)) return false;
    } else if (op === '^=') {
      if (actual === null || !actual.startsWith(expected)) return false;
    } else if (op === '$=') {
      if (actual === null || !actual.endsWith(expected)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

/* Descendant-combinator matching: each token after the first must match some
 * ancestor of the node matched by the previous token. */
function matchesTokens(el, tokens) {
  let candidates = [el];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const matched = candidates.filter((c) => matchToken(c, tokens[i]));
    if (matched.length === 0) return false;
    if (i === 0) return true;
    const ancestors = new Set();
    for (const c of matched) {
      let p = c.parentElement;
      while (p) { ancestors.add(p); p = p.parentElement; }
    }
    candidates = Array.from(ancestors);
  }
  return false;
}

class MiniDocument {
  constructor() {
    this.readyState = 'complete';
    this.documentElement = new MiniElement('html');
    this.head = new MiniElement('head');
    this.body = new MiniElement('body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag) { return new MiniElement(tag); }
  createTextNode(data) { return new MiniText(String(data)); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  addEventListener() {}
  get title() { return ''; }
}

/* ---- tiny HTML parser (fixtures + the markup content.js injects) ---- */
const TAG_RE = /<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([a-zA-Z0-9_:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseFragment(html) {
  const root = new MiniElement('div');
  const stack = [root];
  let lastIndex = 0;
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html))) {
    if (m.index > lastIndex) {
      const text = decodeEntities(html.slice(lastIndex, m.index));
      if (text) stack[stack.length - 1].appendChild(new MiniText(text));
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const selfClosing = m[4] === '/' || VOID_TAGS.has(tag);
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === tag) {
          stack.length = i;
          break;
        }
      }
    } else {
      const el = new MiniElement(tag);
      ATTR_RE.lastIndex = 0;
      let am;
      while ((am = ATTR_RE.exec(m[3] || ''))) {
        const val = am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : ''));
        el.setAttribute(am[1].toLowerCase(), decodeEntities(val));
      }
      stack[stack.length - 1].appendChild(el);
      if (!selfClosing) stack.push(el);
    }
    lastIndex = TAG_RE.lastIndex;
  }
  if (lastIndex < html.length) {
    const text = decodeEntities(html.slice(lastIndex));
    if (text) root.appendChild(new MiniText(text));
  }
  return root.childNodes;
}

function serialize(el) {
  let out = '';
  for (const c of el.childNodes) {
    if (c.nodeType === 3) {
      out += c.data;
    } else {
      const attrs = Array.from(c.attributes.entries())
        .map(([k, v]) => (v === '' ? ' ' + k : ' ' + k + '="' + v + '"'))
        .join('');
      out += '<' + c.tagName.toLowerCase() + attrs + '>' + serialize(c) + '</' + c.tagName.toLowerCase() + '>';
    }
  }
  return out;
}

/* --------------------------------------------------------------------------
 * Scenario runner: execute the real content.js inside a fresh VM context
 * ------------------------------------------------------------------------ */

const silentConsole = new Proxy(console, {
  get(target, prop) {
    if (prop === 'log') return () => {};
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  }
});

function runScenario(fixtureFile, hostname, pathname) {
  const html = fs.readFileSync(path.join(FIXTURES_DIR, fixtureFile), 'utf8');
  const document = new MiniDocument();
  document.body.innerHTML = html;

  const context = {
    document,
    location: { hostname, pathname, href: 'https://' + hostname + pathname },
    browser: { runtime: { getURL: (p) => 'https://extension.local/' + p } },
    fetch: async () => ({ json: async () => RANK_DATA, text: async () => '' }),
    MutationObserver: class {
      constructor() {}
      observe() {}
      disconnect() {}
    },
    DOMParser: class {
      parseFromString() {
        return { querySelectorAll: () => [], querySelector: () => null, textContent: '' };
      }
    },
    console: silentConsole
  };
  vm.createContext(context);
  vm.runInContext(CONTENT_JS, context, { filename: 'content.js' });
  return document;
}

async function flush() {
  // Let content.js's fetch -> json -> addBadges promise chain settle.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

async function scenario(fixtureFile, hostname, pathname) {
  const doc = runScenario(fixtureFile, hostname, pathname);
  await flush();
  return doc;
}

function isDescendant(ancestor, node) {
  let cur = node;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parentNode;
  }
  return false;
}

/* --------------------------------------------------------------------------
 * Tests — assertions below pin the approved contextual-badge contract
 * ------------------------------------------------------------------------ */

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test(
  '1. Scholar search: badges are inside the .gs_a publication metadata node, not the h3 title',
  async () => {
    const doc = await scenario('scholar-search.html', 'scholar.google.com', '/scholar?hl=zh-TW&q=human+genetics');
    const ri = doc.querySelector('.gs_ri');
    assert.ok(ri, 'fixture must contain a .gs_ri result');
    const meta = ri.querySelector('.gs_a');
    const title = ri.querySelector('h3.gs_rt');
    assert.ok(meta && title, 'fixture must contain .gs_a metadata and h3.gs_rt title');
    const holders = doc.querySelectorAll('.ljr-badges');
    assert.strictEqual(holders.length, 1, 'exactly one badge holder should render');
    const holder = holders[0];
    assert.ok(
      isDescendant(meta, holder),
      'badges must be inside the .gs_a metadata node — currently they are appended inside h3.gs_rt after the title link'
    );
    assert.ok(
      !isDescendant(title, holder),
      'badges must not be inside the h3.gs_rt title node'
    );
  }
);

test(
  '2. Scholar profile: badges are inside the second .gs_gray venue node, not after a.gsc_a_at',
  async () => {
    const doc = await scenario('scholar-profile.html', 'scholar.google.com', '/citations?user=abc&hl=en');
    const row = doc.querySelector('tr.gsc_a_tr');
    assert.ok(row, 'fixture must contain a gsc_a_tr row');
    const grays = row.querySelectorAll('.gs_gray');
    assert.ok(grays.length >= 2, 'fixture must contain the venue .gs_gray');
    const venue = grays[1];
    const holders = doc.querySelectorAll('.ljr-badges');
    assert.strictEqual(holders.length, 1, 'exactly one badge holder should render');
    const holder = holders[0];
    assert.ok(
      isDescendant(venue, holder),
      'badges must be inside the second .gs_gray venue node — currently they are inserted after a.gsc_a_at'
    );
    const titleLink = row.querySelector('a.gsc_a_at');
    assert.ok(
      !(isDescendant(titleLink.parentNode, holder) && holder.previousSibling === titleLink),
      'badges must not sit immediately after the a.gsc_a_at title link'
    );
  }
);

test(
  '3. Publisher: badges follow the article title, not the journal/logo anchor',
  async () => {
    const doc = await scenario('publisher-article.html', 'www.sciencedirect.com', '/science/article/pii/S0123456789');
    const title = doc.querySelector('h1.article-title');
    const journal = doc.querySelector('a.publication-title');
    assert.ok(title && journal, 'fixture must contain an article title and a journal anchor');
    const holders = doc.querySelectorAll('.ljr-badges');
    assert.strictEqual(holders.length, 1, 'exactly one badge holder should render');
    const holder = holders[0];
    assert.ok(
      title.nextElementSibling === holder,
      'badges must immediately follow the article title — currently they are appended after the journal/logo anchor'
    );
    assert.ok(
      !isDescendant(journal.parentNode, holder),
      'badges must not be placed inside the journal/logo anchor container'
    );
    assert.ok(
      holder.classList.contains('ljr-publisher-row'),
      'publisher badge holder must carry the ljr-publisher-row modifier class'
    );
  }
);


test(
  '10. Wiley: badges immediately follow h1.citation__title, journal read from #journal-banner-text a (never the empty logo)',
  async () => {
    const doc = await scenario('publisher-wiley.html', 'onlinelibrary.wiley.com', '/doi/10.1111/nana.70008');
    const logoImg = doc.querySelector('a.citation--logo img#journal-banner-image');
    assert.ok(logoImg, 'fixture must contain the logo anchor with img#journal-banner-image');
    const logoLink = doc.querySelector('a.citation--logo');
    assert.ok(
      logoLink && logoLink.getAttribute('href') === '/journal/14698129',
      'logo anchor must carry the /journal/14698129 href (and precede #journal-banner-text a)'
    );
    const bannerText = doc.querySelector('#journal-banner-text a');
    assert.ok(bannerText, 'fixture must contain #journal-banner-text a');
    const title = doc.querySelector('h1.citation__title');
    assert.ok(title, 'fixture must contain h1.citation__title');
    const holders = doc.querySelectorAll('.ljr-badges');
    assert.strictEqual(
      holders.length,
      1,
      'exactly one badge holder should render — currently the generic a[href*=\'/journal/\'] selects the empty logo anchor and renders nothing'
    );
    const holder = holders[0];
    assert.ok(
      title.nextElementSibling === holder,
      'badges must immediately follow h1.citation__title — the ranking row belongs below the article title, never after the journal/logo anchor'
    );
    assert.ok(
      holder.classList.contains('ljr-publisher-row'),
      'publisher badge holder must carry the ljr-publisher-row modifier class'
    );
    assert.ok(
      !isDescendant(logoLink.parentNode, holder),
      'badges must not be placed inside the logo anchor container'
    );
  }
);

async function assertPublisherFixture(fixture, hostname, pathname, titleSelector, expectedJournal) {
  const doc = await scenario(fixture, hostname, pathname);
  const title = doc.querySelector(titleSelector);
  assert.ok(title, 'fixture must contain the publisher-specific article title target');
  const holders = doc.querySelectorAll('.ljr-badges');
  assert.strictEqual(
    holders.length,
    1,
    expectedJournal + ' must resolve from the publisher-specific journal selector'
  );
  assert.strictEqual(
    title.nextElementSibling,
    holders[0],
    'publisher badges must immediately follow the article title'
  );
  assert.ok(
    holders[0].classList.contains('ljr-publisher-row'),
    'publisher badge holder must carry the ljr-publisher-row modifier class'
  );
}

test(
  '11. Taylor & Francis: current journal-heading and literatumPublicationHeader selectors render below the title',
  async () => {
    await assertPublisherFixture(
      'publisher-tandfonline.html',
      'www.tandfonline.com',
      '/doi/full/10.1080/13501763.2025.2509755',
      'div.literatumPublicationHeader h1',
      'Journal of European Public Policy'
    );
  }
);

test(
  '12. Nature: current data-test=journal-link selector renders below the article title',
  async () => {
    await assertPublisherFixture(
      'publisher-nature.html',
      'www.nature.com',
      '/articles/s41562-025-02232-3',
      'h1.c-article-title',
      'Nature Human Behaviour'
    );
  }
);

test(
  '13. OUP: live title class and path-derived journal link render on article-abstract pages',
  async () => {
    await assertPublisherFixture(
      'publisher-oup.html',
      'academic.oup.com',
      '/psq/article-abstract/140/3/657/8172534',
      'h1.at-articleTitle',
      'Political Science Quarterly'
    );
  }
);

test(
  '14. SAGE: current journal-title and article header title selectors render below the title',
  async () => {
    await assertPublisherFixture(
      'publisher-sage.html',
      'journals.sagepub.com',
      '/doi/10.1177/13540688241248008',
      'article header h1',
      'Party Politics'
    );
  }
);

test(
  '15. ACM: property=name article title and journal link render below the title',
  async () => {
    await assertPublisherFixture(
      'publisher-acm.html',
      'dl.acm.org',
      '/doi/10.1145/3767324',
      "h1[property='name']",
      'ACM Transactions on Information Systems'
    );
  }
);
test(
  '4. Category control never shows a combined "N 學科" count',
  async () => {
    const doc = await scenario('scholar-search.html', 'scholar.google.com', '/scholar?hl=zh-TW&q=human+genetics');
    const more = doc.querySelector('.ljr-more');
    assert.ok(more, 'category control should render');
    const label = more.querySelector('.ljr-more-label');
    assert.ok(label, 'category control should expose a label element');
    const text = label.textContent;
    assert.ok(
      !/\d+\s*學科/.test(text),
      'category control must not contain a combined count like "3 學科" — found: ' + JSON.stringify(text)
    );
    assert.strictEqual(
      text.trim(),
      '分類詳情',
      'category control label should be the fixed "分類詳情" label, not a dynamic count'
    );
    assert.strictEqual(
      more.getAttribute('aria-label'),
      '分類詳情',
      'closed aria-label must be exactly "分類詳情"'
    );
  }
);

test(
  '5. Category control is a keyboard-accessible role=button element, not a native <button>',
  async () => {
    const doc = await scenario('scholar-search.html', 'scholar.google.com', '/scholar?hl=zh-TW&q=human+genetics');
    const more = doc.querySelector('.ljr-more');
    assert.ok(more, 'category control should render');
    assert.notStrictEqual(
      more.tagName,
      'BUTTON',
      'category control must not be a native <button> — currently it is a <button>'
    );
    assert.strictEqual(
      more.getAttribute('role'),
      'button',
      'category control must expose role="button"'
    );
    assert.strictEqual(
      more.getAttribute('tabindex'),
      '0',
      'category control must be keyboard-focusable via tabindex="0"'
    );
  }
);

test(
  '6. Expanded details stay grouped as JCR and 新銳',
  async () => {
    const doc = await scenario('scholar-search.html', 'scholar.google.com', '/scholar?hl=zh-TW&q=human+genetics');
    const more = doc.querySelector('.ljr-more');
    assert.ok(more, 'category control should render');
    more.click();
    assert.strictEqual(
      more.getAttribute('aria-expanded'),
      'true',
      'aria-expanded must flip to true when details are shown'
    );
    const openLabel = more.querySelector('.ljr-more-label');
    assert.strictEqual(
      openLabel.textContent.trim(),
      '\u6536\u8d77',
      'open state label must be exactly "\u6536\u8d77"'
    );
    assert.strictEqual(
      more.getAttribute('aria-label'),
      '收起',
      'open aria-label must be exactly "收起"'
    );
    const groupTitles = doc.querySelectorAll('.ljr-detail-title').map((e) => e.textContent.trim());
    assert.ok(
      groupTitles.length >= 2,
      'detail card must render at least two groups — got: ' + JSON.stringify(groupTitles)
    );
    assert.ok(
      groupTitles.includes('JCR'),
      'expanded details must keep a JCR group — currently split as: ' + JSON.stringify(groupTitles)
    );
    assert.ok(
      groupTitles.includes('新銳'),
      'expanded details must keep the 新銳 group — got: ' + JSON.stringify(groupTitles)
    );
  }
);

test(
  '9. Publisher renders nothing when only an unrelated bare h1 exists (no generic h1 fallback)',
  async () => {
    const doc = await scenario('publisher-no-title.html', 'link.springer.com', '/article/10.1007/s00535-024-02172-8');
    const siteH1 = doc.querySelector('.site-header h1');
    assert.ok(siteH1 && siteH1.tagName === 'H1', 'fixture must contain an unrelated bare h1 heading');
    assert.strictEqual(
      doc.querySelector('h1.c-article-title'),
      null,
      'fixture must lack any explicit Springer article-title target (h1.c-article-title)'
    );
    assert.strictEqual(
      doc.querySelector('h1[data-test="article-title"]'),
      null,
      'fixture must lack any explicit Springer article-title target (h1[data-test=article-title])'
    );
    assert.strictEqual(
      doc.querySelectorAll('.ljr-badges').length,
      0,
      'no badge holder may render when only an unrelated bare h1 is present — the bare h1 fallback must not be used as an article-title anchor'
    );
  }
);

test(
  '7. Enter key toggles the category control and is default-prevented',
  async () => {
    const doc = await scenario('scholar-search.html', 'scholar.google.com', '/scholar?hl=zh-TW&q=human+genetics');
    const more = doc.querySelector('.ljr-more');
    assert.ok(more, 'category control should render');
    const event = { type: 'keydown', key: 'Enter', preventDefault() { this.prevented = true; } };
    more.dispatchEvent(event);
    assert.strictEqual(
      more.getAttribute('aria-expanded'),
      'true',
      'Enter must open the details'
    );
    assert.strictEqual(
      more.getAttribute('aria-label'),
      '收起',
      'Enter must set open aria-label to "收起"'
    );
    assert.ok(
      doc.querySelector('.ljr-detail'),
      'Enter must render the detail card'
    );
    assert.strictEqual(event.prevented, true, 'Enter keydown default must be prevented');
    more.dispatchEvent(event);
    assert.strictEqual(
      more.getAttribute('aria-expanded'),
      'false',
      'Enter must collapse the details again'
    );
    assert.strictEqual(
      more.getAttribute('aria-label'),
      '分類詳情',
      'Enter must restore closed aria-label to "分類詳情"'
    );
  }
);

test(
  '8. Space key toggles the category control and is default-prevented',
  async () => {
    const doc = await scenario('scholar-search.html', 'scholar.google.com', '/scholar?hl=zh-TW&q=human+genetics');
    const more = doc.querySelector('.ljr-more');
    assert.ok(more, 'category control should render');
    const event = { type: 'keydown', key: ' ', preventDefault() { this.prevented = true; } };
    more.dispatchEvent(event);
    assert.strictEqual(
      more.getAttribute('aria-expanded'),
      'true',
      'Space must open the details'
    );
    assert.strictEqual(
      more.getAttribute('aria-label'),
      '收起',
      'Space must set open aria-label to "收起"'
    );
    assert.ok(
      doc.querySelector('.ljr-detail'),
      'Space must render the detail card'
    );
    assert.strictEqual(event.prevented, true, 'Space keydown default must be prevented');
    more.dispatchEvent(event);
    assert.strictEqual(
      more.getAttribute('aria-expanded'),
      'false',
      'Space must collapse the details again'
    );
    assert.strictEqual(
      more.getAttribute('aria-label'),
      '分類詳情',
      'Space must restore closed aria-label to "分類詳情"'
    );
  }
);

/* --------------------------------------------------------------------------
 * Tiny runner
 * ------------------------------------------------------------------------ */

async function main() {
  let passed = 0;
  let failed = 0;
  console.log('# SI Journal Rank — content-layout DOM regression (Task 1–2, GREEN)');
  console.log('# fixtures: tests/fixtures/{scholar-search,scholar-profile,publisher-article,publisher-no-title,publisher-wiley}.html');
  console.log('');
  for (const t of tests) {
    try {
      await t.fn();
      passed += 1;
      console.log('  PASS  ' + t.name);
    } catch (err) {
      failed += 1;
      console.log('  FAIL  ' + t.name);
      const msg = (err && err.message ? err.message : String(err)).split('\n');
      for (const line of msg) console.log('        ' + line);
    }
  }
  console.log('');
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    console.log('(RED as required for Task 1 — do not make these pass yet.)');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { runScenario, scenario, isDescendant, MiniDocument, parseFragment };
