#!/usr/bin/env node
'use strict';

/* =========================================================================
 * SI Journal Rank — content-style regression tests (Task 3 RED → GREEN)
 *
 * Dependency-light CDP harness — Node built-ins ONLY (child_process, http,
 * fs, os, path) plus Node's global WebSocket. It drives the installed
 * headless Chrome over the DevTools Protocol:
 *
 *   1. spawn Chrome --headless=new --disable-gpu with a unique
 *      --remote-debugging-port (9400-9800), a unique temp --user-data-dir,
 *      and the hostile publisher fixture
 *   2. poll http://127.0.0.1:PORT/json/list for <= 20s until the page target
 *      appears
 *   3. connect with Node's global WebSocket, enable Runtime, evaluate a
 *      browser expression that returns the fixture's computed styles and
 *      bounding rects by value
 *   4. try/finally: close the WebSocket, SIGKILL Chrome, remove the temp
 *      profile
 *
 * Every polling path and CDP request carries an explicit timeout so the
 * test can never hang (the previous --dump-dom approach hangs on this host).
 *
 * Run:  node tests/content-style.test.js
 *
 * The fixture (tests/fixtures/style-hostile.html) links content.css FIRST,
 * then applies hostile publisher CSS AFTER it with !important rules on
 * plain span / [role=button] (font-size ~24px, padding ~20px, block-level,
 * gray, square). That is the class of CSS that previously blew the Wiley
 * .ljr-more control up to ~90px tall. Every extension-critical declaration
 * in content.css must be scoped under .ljr-badges and !important to win.
 * ========================================================================= */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CSS_FILE = path.join(ROOT, 'content.css');
const FIXTURE = path.join(__dirname, 'fixtures', 'style-hostile.html');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
}
function between(v, lo, hi) { return typeof v === 'number' && v >= lo && v <= hi; }
function px(v) { return parseFloat(v); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* --------------------------------------------------------------------------
 * Bounded async helpers — every path below is timeout-guarded
 * ------------------------------------------------------------------------ */

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('TIMEOUT after ' + ms + 'ms — ' + label)),
      ms
    );
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function fetchJson(url, ms) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('bad JSON from ' + url + ': ' + e.message)); }
        });
      });
      req.on('error', reject);
    }),
    ms,
    'GET ' + url
  );
}

async function waitForTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const list = await fetchJson('http://127.0.0.1:' + port + '/json/list', 1500);
      const page = (list || []).find(
        (t) => t.type === 'page' && t.url && t.url.indexOf('style-hostile.html') !== -1
      );
      if (page) return page;
    } catch (e) { lastErr = e; }
    await sleep(200);
  }
  throw new Error(
    'Chrome page target did not appear within ' + timeoutMs + 'ms on port ' + port +
    (lastErr ? ' — last poll error: ' + lastErr.message : '')
  );
}

class CdpClient {
  static async connect(wsUrl, timeoutMs) {
    const ws = new WebSocket(wsUrl);
    await withTimeout(
      new Promise((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', (ev) => reject(
          new Error('WebSocket error: ' + (ev && ev.message ? ev.message : 'unknown'))
        ), { once: true });
      }),
      timeoutMs,
      'WebSocket connect ' + wsUrl
    );
    const client = new CdpClient(ws);
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.id && client.pending.has(msg.id)) {
        const p = client.pending.get(msg.id);
        client.pending.delete(msg.id);
        if (msg.error) p.reject(new Error('CDP ' + (msg.error.code || 'error') + ': ' + msg.error.message));
        else p.resolve(msg.result);
      }
    });
    return client;
  }
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
  }
  send(method, params) {
    const id = ++this.nextId;
    return withTimeout(
      new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      }),
      10000,
      'CDP ' + method
    );
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

async function measureViaChrome() {
  for (const f of [CSS_FILE, FIXTURE]) {
    if (!fs.existsSync(f)) throw new Error('missing file: ' + f);
  }
  if (!fs.existsSync(CHROME)) {
    throw new Error('Chrome not found at ' + CHROME + ' (set CHROME_PATH to override)');
  }
  const port = 9400 + Math.floor(Math.random() * 401); // 9400-9800
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ljr-style-'));
  let chrome = null;
  let ws = null;
  try {
    chrome = spawn(CHROME, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + profile,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
      '--allow-file-access-from-files',
      'file://' + FIXTURE
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    chrome.stderr.on('data', (d) => {
      stderr += String(d);
      if (stderr.length > 2000) stderr = stderr.slice(-2000);
    });
    await new Promise((resolve, reject) => {
      chrome.once('error', reject);
      chrome.once('spawn', resolve);
    });

    const target = await withTimeout(waitForTarget(port, 20000), 22000, 'wait for Chrome page target');
    ws = await CdpClient.connect(target.webSocketDebuggerUrl, 10000);
    await withTimeout(ws.send('Runtime.enable'), 12000, 'Runtime.enable');

    const expr = [
      '(function () {',
      '  var pre = document.getElementById("result");',
      '  if (!pre) return { error: "no #result element" };',
      '  var raw = (pre.textContent || "").trim();',
      '  if (!raw) return { error: "#result empty — fixture measurement script did not run" };',
      '  return JSON.parse(atob(raw));',
      '})()'
    ].join('\n');

    let value = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await withTimeout(
          ws.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
          12000,
          'Runtime.evaluate'
        );
        if (r.exceptionDetails) {
          const ed = r.exceptionDetails;
          lastErr = new Error('evaluate failed: ' +
            (ed.exception ? ed.exception.description || ed.exception.value : ed.text));
        } else {
          value = r.result && r.result.value;
          if (value && !value.error) return value;
          lastErr = new Error('fixture returned: ' + JSON.stringify(value));
        }
      } catch (e) { lastErr = e; }
      await sleep(250);
    }
    throw new Error('could not read measurements from fixture — ' +
      (lastErr ? lastErr.message : 'unknown') + (stderr ? ' | chrome stderr: ' + stderr : ''));
  } finally {
    if (ws) ws.close();
    if (chrome && chrome.pid) {
      try { chrome.kill('SIGKILL'); } catch (e) { /* ignore */ }
      await Promise.race([new Promise((res) => chrome.once('exit', res)), sleep(1000)]);
    }
    fs.rmSync(profile, { recursive: true, force: true }); // always clean the temp profile
  }
}

/* --------------------------------------------------------------------------
 * Assertions — the approved compact-isolation contract from Task 3
 * ------------------------------------------------------------------------ */

function runAssertions(d) {
  const holder = d.meta;
  const badge = d.badge;
  const more = d.more;
  const detail = d.detail;
  const group = d.group;
  const row = d.row;
  const cat = d.cat;
  const q = d.q;
  const title = d.title;
  const publisher = d.publisher;

  // Requirement 1 — metadata placement
  check('Metadata holder is inline-flex, baseline-aligned, 6px left margin',
    holder && holder.display === 'inline-flex' && holder.verticalAlign === 'baseline' &&
    Math.abs(px(holder.marginLeft) - 6) <= 0.01,
    'display=' + (holder ? holder.display : 'n/a') + ' vertical-align=' + (holder ? holder.verticalAlign : 'n/a') +
    ' margin-left=' + (holder ? holder.marginLeft : 'n/a') + 'px');
  check('Metadata holder is compact (not a full-width block)',
    holder && holder.parentWidth > 0 && holder.width > 0 && holder.width + 0.5 < holder.parentWidth,
    'holder ' + (holder ? holder.width.toFixed(2) : 'n/a') + 'px vs parent ' +
    (holder ? holder.parentWidth.toFixed(2) : 'n/a') + 'px');

  // Requirement 3 — badge geometry (hostile 24px/20px rules rejected)
  check('Badge height is 18.5-19.05px (compact 19px target)',
    badge && between(badge.height, 18.5, 19.05),
    'height=' + (badge ? badge.height.toFixed(2) : 'n/a') + 'px');
  check('Badge font-size is ~11px',
    badge && between(badge.fontSize, 10.5, 11.6),
    'font-size=' + (badge ? badge.fontSize : 'n/a') + 'px');
  check('Badge uses flex layout (inline-flex, blockified to flex as a flex item)',
    badge && (badge.display === 'inline-flex' || badge.display === 'flex'),
    'display=' + (badge ? badge.display : 'n/a'));
  check('Badge radius is ~6px (not square)',
    badge && between(badge.radiusTL, 5.5, 6.5) && between(badge.radiusTR, 5.5, 6.5) &&
    between(badge.radiusBR, 5.5, 6.5) && between(badge.radiusBL, 5.5, 6.5),
    'radius=' + (badge ? badge.radiusTL + 'px' : 'n/a'));
  check('Badge never wraps internally and is border-box',
    badge && badge.whiteSpace === 'nowrap' && badge.boxSizing === 'border-box',
    'white-space=' + (badge ? badge.whiteSpace : 'n/a') + ' box-sizing=' + (badge ? badge.boxSizing : 'n/a'));
  check('Badge background is the rank color, NOT hostile gray',
    badge && badge.backgroundColor === 'rgb(216, 27, 96)',
    'background=' + (badge ? badge.backgroundColor : 'n/a'));

  // Requirement 4 — .ljr-more control
  check('More control height is 18.5-19.05px and matches the badge',
    more && badge && between(more.height, 18.5, 19.05) && Math.abs(more.height - badge.height) <= 1.2,
    'more ' + (more ? more.height.toFixed(2) : 'n/a') + 'px vs badge ' + (badge ? badge.height.toFixed(2) : 'n/a') + 'px');
  check('More font-size is ~11px',
    more && between(more.fontSize, 10.5, 11.6),
    'font-size=' + (more ? more.fontSize : 'n/a') + 'px');
  check('More uses flex layout (inline-flex, blockified to flex as a flex item) and never wraps',
    more && (more.display === 'inline-flex' || more.display === 'flex') &&
    more.whiteSpace === 'nowrap' && (more.flexWrap === 'nowrap' || more.flexWrap === ''),
    'display=' + (more ? more.display : 'n/a') + ' white-space=' + (more ? more.whiteSpace : 'n/a') +
    ' flex-wrap=' + (more ? more.flexWrap : 'n/a'));
  check('More radius is ~6px and cursor is pointer',
    more && between(more.radiusTL, 5.5, 6.5) && more.cursor === 'pointer',
    'radius=' + (more ? more.radiusTL + 'px' : 'n/a') + ' cursor=' + (more ? more.cursor : 'n/a'));
  check('More keeps indigo ghost colors, NOT hostile gray',
    more && more.color === 'rgb(67, 56, 202)' && more.backgroundColor === 'rgb(238, 242, 255)',
    'color=' + (more ? more.color : 'n/a') + ' bg=' + (more ? more.backgroundColor : 'n/a'));
  check('Badge and more have neutral appearance (not button-like)',
    badge && more && badge.appearance === 'none' && badge.webkitAppearance === 'none' &&
    more.appearance === 'none' && more.webkitAppearance === 'none',
    'badge=' + (badge ? badge.appearance + '/' + badge.webkitAppearance : 'n/a') +
    ' more=' + (more ? more.appearance + '/' + more.webkitAppearance : 'n/a'));

  // Requirement 2 — publisher row
  check('Publisher row has zero left margin and modest vertical margins',
    publisher && Math.abs(px(publisher.marginLeft)) <= 0.01 &&
    px(publisher.marginTop) >= 4 && px(publisher.marginBottom) >= 4,
    'margin=' + (publisher ? publisher.marginTop + '/' + publisher.marginRight + '/' + publisher.marginBottom + '/' + publisher.marginLeft : 'n/a'));
  check('Publisher row is compact (not full-width, max-width <= 440px)',
    publisher && publisher.parentWidth > 0 && publisher.width > 0 &&
    publisher.width + 0.5 < publisher.parentWidth && publisher.maxWidth !== 'none' &&
    px(publisher.maxWidth) <= 440.5,
    'width=' + (publisher ? publisher.width.toFixed(2) : 'n/a') + 'px parent=' +
    (publisher ? publisher.parentWidth.toFixed(2) : 'n/a') + 'px max-width=' + (publisher ? publisher.maxWidth : 'n/a'));

  // Requirement 6 — expanded detail
  check('Detail is a separate flex-basis 100% row with max-width <= 440px',
    detail && detail.flexBasis === '100%' && detail.maxWidth !== 'none' && px(detail.maxWidth) <= 440.5,
    'flex-basis=' + (detail ? detail.flexBasis : 'n/a') + ' max-width=' + (detail ? detail.maxWidth : 'n/a'));
  check('Detail card rejects hostile gray / 24px (white, compact font)',
    detail && detail.backgroundColor === 'rgb(255, 255, 255)' && detail.fontSize <= 13,
    'background=' + (detail ? detail.backgroundColor : 'n/a') + ' font-size=' + (detail ? detail.fontSize : 'n/a') + 'px');

  // Requirement 6b — detail INNER elements reject hostile span rules
  // (hostile span !important rules set 24px font / 38.4px line-height /
  // content-box on every span; the scoped rules below must win).
  check('Detail group is block, border-box, compact inherited typography',
    group && group.display === 'block' && group.boxSizing === 'border-box' &&
    between(group.fontSize, 10.5, 12.6) && between(px(group.lineHeight), 16.5, 20.5),
    'display=' + (group ? group.display : 'n/a') + ' box-sizing=' + (group ? group.boxSizing : 'n/a') +
    ' font=' + (group ? group.fontSize : 'n/a') + 'px line-height=' + (group ? group.lineHeight : 'n/a'));
  check('Detail group inherits the detail card color, NOT hostile gray',
    group && group.color === 'rgb(51, 65, 85)',
    'color=' + (group ? group.color : 'n/a'));
  check('Detail row is flex, border-box, compact inherited typography',
    row && row.display === 'flex' && row.boxSizing === 'border-box' &&
    between(row.fontSize, 10.5, 12.6) && between(px(row.lineHeight), 16.5, 20.5),
    'display=' + (row ? row.display : 'n/a') + ' box-sizing=' + (row ? row.boxSizing : 'n/a') +
    ' font=' + (row ? row.fontSize : 'n/a') + 'px line-height=' + (row ? row.lineHeight : 'n/a'));
  check('Detail row inherits the detail card color, NOT hostile gray',
    row && row.color === 'rgb(51, 65, 85)',
    'color=' + (row ? row.color : 'n/a'));
  check('Detail category is block, border-box, compact inherited typography',
    cat && cat.display === 'block' && cat.boxSizing === 'border-box' &&
    between(cat.fontSize, 10.5, 12.6) && between(px(cat.lineHeight), 16.5, 20.5),
    'display=' + (cat ? cat.display : 'n/a') + ' box-sizing=' + (cat ? cat.boxSizing : 'n/a') +
    ' font=' + (cat ? cat.fontSize : 'n/a') + 'px line-height=' + (cat ? cat.lineHeight : 'n/a'));
  check('Detail category keeps its slate color, NOT hostile gray',
    cat && cat.color === 'rgb(75, 85, 99)',
    'color=' + (cat ? cat.color : 'n/a'));
  check('Detail quartile is block, border-box, nowrap, compact inherited typography',
    q && q.display === 'block' && q.boxSizing === 'border-box' && q.whiteSpace === 'nowrap' &&
    between(q.fontSize, 10.5, 12.6) && between(px(q.lineHeight), 16.5, 20.5),
    'display=' + (q ? q.display : 'n/a') + ' box-sizing=' + (q ? q.boxSizing : 'n/a') +
    ' white-space=' + (q ? q.whiteSpace : 'n/a') + ' font=' + (q ? q.fontSize : 'n/a') +
    'px line-height=' + (q ? q.lineHeight : 'n/a'));
  check('Detail quartile keeps its dark color, NOT hostile gray',
    q && q.color === 'rgb(31, 41, 51)',
    'color=' + (q ? q.color : 'n/a'));
  check('Detail title is block, border-box, compact 10px typography',
    title && title.display === 'block' && title.boxSizing === 'border-box' &&
    between(title.fontSize, 9.5, 10.6) && between(px(title.lineHeight), 14, 17.5) &&
    title.color === 'rgb(55, 65, 81)',
    'display=' + (title ? title.display : 'n/a') + ' box-sizing=' + (title ? title.boxSizing : 'n/a') +
    ' font=' + (title ? title.fontSize : 'n/a') + 'px line-height=' + (title ? title.lineHeight : 'n/a') +
    ' color=' + (title ? title.color : 'n/a'));

  // Requirement 7 — focus-visible and reduced-motion preserved (source-level)
  const cssText = fs.readFileSync(CSS_FILE, 'utf8');
  const fmIdx = cssText.indexOf('.ljr-more:focus-visible');
  const fmBlock = fmIdx >= 0 ? cssText.slice(fmIdx, cssText.indexOf('}', fmIdx) + 1) : '';
  check('Focus-visible outline rule is preserved with !important',
    fmBlock.indexOf('outline') !== -1 && fmBlock.indexOf('!important') !== -1,
    'content.css must keep .ljr-more:focus-visible with an !important outline');
  const rmIdx = cssText.indexOf('@media (prefers-reduced-motion: reduce)');
  const rmBlock = rmIdx >= 0 ? cssText.slice(rmIdx) : '';
  check('prefers-reduced-motion disables the chevron transition',
    rmBlock.indexOf('transition: none') !== -1,
    'content.css must keep the prefers-reduced-motion block disabling the svg transition');
}

/* --------------------------------------------------------------------------
 * Report
 * ------------------------------------------------------------------------ */

async function main() {
  console.log('# SI Journal Rank — content-style regression (Task 3, CDP headless Chrome)');
  console.log('# chrome: ' + CHROME);
  console.log('# fixture: tests/fixtures/style-hostile.html');
  console.log('');
  let d;
  try {
    d = await withTimeout(measureViaChrome(), 40000, 'overall Chrome measurement run');
  } catch (err) {
    console.error('HARNESS ERROR: ' + err.message);
    console.error('(BLOCKED — CDP could not start; content.css was NOT modified)');
    process.exitCode = 2;
    return;
  }
  console.log('MEASURED ' + JSON.stringify(d));
  console.log('');

  runAssertions(d);

  results.forEach((r, i) => {
    const num = String(i + 1).padStart(2, ' ');
    if (r.pass) {
      console.log('  PASS  ' + num + '. ' + r.name);
    } else {
      console.log('  FAIL  ' + num + '. ' + r.name);
      console.log('        ' + r.detail);
    }
  });
  console.log('');
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('HARNESS ERROR: ' + (err && err.message ? err.message : err));
  process.exitCode = 2;
});
