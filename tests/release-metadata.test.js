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
 *      "LocalJournalRank" path and contain the correct SIJournalRank path.
 *
 * Run:  node tests/release-metadata.test.js
 * ========================================================================= */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'manifest.json');
const README = path.join(ROOT, 'README.md');
const RESOURCES_README = path.join(
  ROOT, '..', 'SIJournalRank-safari', 'SIJournalRank',
  'SIJournalRank Extension', 'Resources', 'README.md'
);
const PBXPROJ = path.join(
  ROOT, '..', 'SIJournalRank-safari', 'SIJournalRank',
  'SIJournalRank.xcodeproj', 'project.pbxproj'
);

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
}

function main() {
  console.log('# SI Journal Rank — release metadata (manifest version == Xcode MARKETING_VERSION; no stale LocalJournalRank path)');
  console.log('');

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const manifestVersion = manifest.version;
  check(
    'manifest.json carries a version string',
    typeof manifestVersion === 'string' && /^\d+\.\d+\.\d+$/.test(manifestVersion),
    'version=' + JSON.stringify(manifestVersion)
  );

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

  const CORRECT_PATH = '/path/to/SIJournalRank';
  const readmePairs = [
    { label: 'root README', file: README },
    { label: 'Xcode Resources README', file: RESOURCES_README }
  ];
  for (const pair of readmePairs) {
    const text = fs.readFileSync(pair.file, 'utf8');
    check(
      pair.label + ' contains no "LocalJournalRank" project path',
      !text.includes('LocalJournalRank'),
      text.includes('LocalJournalRank')
        ? 'stale path found: /path/to/LocalJournalRank'
        : 'clean'
    );
    check(
      pair.label + ' contains the correct SIJournalRank path',
      text.includes(CORRECT_PATH),
      text.includes(CORRECT_PATH)
        ? CORRECT_PATH
        : 'missing ' + CORRECT_PATH
    );
  }

  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.pass) { passed += 1; console.log('  PASS  ' + r.name + (r.detail ? '  (' + r.detail + ')' : '')); }
    else { failed += 1; console.log('  FAIL  ' + r.name + '  (' + r.detail + ')'); }
  }
  console.log('');
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
