#!/usr/bin/env node
'use strict';

/* =========================================================================
 * SI Journal Rank — release metadata regression tests (safe cleanup, Task 5)
 *
 * Node built-ins ONLY (fs, path, assert). Asserts the release metadata
 * contract between the Web Extension manifest and the Safari Xcode project:
 *
 *   1. manifest.json "version" equals EVERY MARKETING_VERSION in
 *      SIJournalRank.xcodeproj/project.pbxproj (app, appex and plugin all
 *      show the same short version).
 *   2. BOTH README files (root README.md and the Safari Xcode project's
 *      "SIJournalRank Extension/Resources/README.md") contain no stale
 *      "LocalJournalRank" path, hardcode no local home directory, and point
 *      at the Safari Xcode project by relative path.
 *
 * Run:  node tests/release-metadata.test.js
 * ========================================================================= */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'manifest.json');
const README = path.join(ROOT, 'README.md');
const SAFARI_ROOT = process.env.SIJOURNALRANK_SAFARI_DIR
  ? path.resolve(process.env.SIJOURNALRANK_SAFARI_DIR)
  : path.join(ROOT, '..', 'SIJournalRank-safari');
const RESOURCES_README = path.join(
  SAFARI_ROOT, 'SIJournalRank',
  'SIJournalRank Extension', 'Resources', 'README.md'
);
const PBXPROJ = path.join(
  SAFARI_ROOT, 'SIJournalRank',
  'SIJournalRank.xcodeproj', 'project.pbxproj'
);
const SAFARI_PRESENT = fs.existsSync(PBXPROJ) && fs.existsSync(RESOURCES_README);

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
}

const skips = [];
function skip(name, detail) {
  skips.push({ name, detail: detail || '' });
}

function main() {
  console.log('# SI Journal Rank — release metadata (manifest version == Xcode MARKETING_VERSION; READMEs carry no stale or personal paths)');
  console.log('');

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const manifestVersion = manifest.version;
  check(
    'manifest.json carries a version string',
    typeof manifestVersion === 'string' && /^\d+\.\d+\.\d+$/.test(manifestVersion),
    'version=' + JSON.stringify(manifestVersion)
  );

  if (SAFARI_PRESENT === false) {
    skip('Safari Xcode version checks (SIJournalRank-safari not found)', SAFARI_ROOT);
  } else {
    const pbx = fs.readFileSync(PBXPROJ, 'utf8');
    const marketingVersions = [];
    for (const m of pbx.matchAll(/MARKETING_VERSION\s*=\s*([^;]+);/g)) {
      marketingVersions.push(m[1].trim());
    }
    check(
      'project.pbxproj declares at least one MARKETING_VERSION',
      marketingVersions.length >= 1,
      'count=' + marketingVersions.length
    );
    check(
      'every MARKETING_VERSION equals manifest version ' + manifestVersion,
      marketingVersions.length >= 1 && marketingVersions.every((v) => v === manifestVersion),
      'versions=' + JSON.stringify(marketingVersions)
    );
  }

  // A published README must not pin the author's machine: a reader has to be
  // able to load the extension from wherever they cloned the project.
  const HOME_PATH = /\/(?:Users|home)\/[^/\s`]+/;
  const readmePairs = [
    { label: 'root README', file: README }
  ];
  if (SAFARI_PRESENT) {
    readmePairs.push({ label: 'Xcode Resources README', file: RESOURCES_README });
  } else {
    skip('Xcode Resources README checks (SIJournalRank-safari not found)', SAFARI_ROOT);
  }
  for (const pair of readmePairs) {
    const text = fs.readFileSync(pair.file, 'utf8');
    const stale = text.includes('LocalJournalRank');
    check(
      pair.label + ' contains no "LocalJournalRank" project path',
      !stale,
      stale ? 'stale project name found' : 'clean'
    );
    const home = text.match(HOME_PATH);
    check(
      pair.label + ' hardcodes no local home directory',
      !home,
      home ? 'found ' + home[0] : 'clean'
    );
    const safari = text.includes('SIJournalRank.xcodeproj');
    check(
      pair.label + ' points at the Safari Xcode project by relative path',
      safari,
      safari ? 'SIJournalRank.xcodeproj' : 'missing SIJournalRank.xcodeproj'
    );
  }

  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.pass) { passed += 1; console.log('  PASS  ' + r.name + (r.detail ? '  (' + r.detail + ')' : '')); }
    else { failed += 1; console.log('  FAIL  ' + r.name + '  (' + r.detail + ')'); }
  }
  for (const item of skips) {
    console.log('  SKIP  ' + item.name + (item.detail ? '  (' + item.detail + ')' : ''));
  }
  console.log('');
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed' + (skips.length ? ', ' + skips.length + ' skipped' : ''));
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
