# -*- coding: utf-8 -*-
"""Add PubMed (NLM) journal-abbreviation aliases to data/rank-data.json.

PubMed shows abbreviated journal names ("Hum Genet", "Am J Kidney Dis"), while
rank-data.json is keyed by full titles, so PubMed pages resolved 0/10 before this
step. NLM publishes the MedAbbr -> JournalTitle mapping in J_Medline.txt; this
script copies each abbreviation into the database as an alias of the same record.

Run AFTER scripts/build_rank_data.py (that script rewrites rank-data.json from the
raw CSSCI/XR/JCR sources and would drop these aliases).

Usage:
    python3 scripts/add_nlm_aliases.py                    # download J_Medline.txt if needed
    python3 scripts/add_nlm_aliases.py --nlm path/to/J_Medline.txt
    python3 scripts/add_nlm_aliases.py --no-sync          # only update data/rank-data.json
"""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DB = DATA / "rank-data.json"
RAW = DATA / "raw"
NLM_FILE = RAW / "J_Medline.txt"
NLM_URL = "https://ftp.ncbi.nlm.nih.gov/pubmed/J_Medline.txt"
SAFARI_RESOURCES = (
    ROOT.parent / "SIJournalRank-safari" / "SIJournalRank"
    / "SIJournalRank Extension" / "Resources" / "data" / "rank-data.json"
)


def load_data():
    """Return (data_pack, flat_records), accepting both versioned and legacy files."""
    raw = json.loads(DB.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and isinstance(raw.get("records"), dict):
        return raw, raw["records"]
    records = raw if isinstance(raw, dict) else {}
    return {
        "format": "si-journal-rank",
        "schemaVersion": 0,
        "dataVersion": "legacy",
        "generatedAt": "",
        "recordCount": len(records),
        "records": records,
    }, records


def save_data(pack, records):
    pack["records"] = records
    pack["recordCount"] = len(records)
    DB.write_text(json.dumps(pack, ensure_ascii=False, indent=1), encoding="utf-8")


def normalize(name):
    if not name:
        return ""
    s = str(name).upper()
    s = re.sub(r"[^A-Z0-9&\u4e00-\u9fa5 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def resolve(db, raw_name):
    """Same fallback chain as content.js resolveRecord."""
    key = normalize(raw_name)
    if key == "":
        return None
    if db.get(key):
        return db[key]
    compact = key.rstrip(". ")
    if compact != key and db.get(compact):
        return db[compact]
    if len(key) >= 6:
        matches = [k for k in db if k.startswith(key)]
        if len(matches) == 1:
            return db[matches[0]]
    return None


def lookup_by_title(db, title):
    """NLM full titles often carry a subtitle ("... genetics : EJHG"); try both."""
    candidates = [title]
    idx = title.find(" : ")
    if idx > 0:
        candidates.append(title[:idx])
    for cand in candidates:
        rec = db.get(normalize(cand)) or resolve(db, cand)
        if rec:
            return rec
    return None


def load_nlm(path):
    records = path.read_text(encoding="utf-8", errors="ignore").split("\n" + "-" * 10)
    pairs = []
    for block in records:
        title = re.search(r"^JournalTitle:\s*(.+)$", block, re.M)
        abbr = re.search(r"^MedAbbr:\s*(.+)$", block, re.M)
        if title and abbr:
            pairs.append((abbr.group(1).strip(), title.group(1).strip()))
    return pairs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nlm", default=None, help="existing J_Medline.txt path")
    ap.add_argument("--no-sync", action="store_true", help="do not copy into the Xcode Resources")
    ap.add_argument("--safari-resources", default=None, help="override the Safari Resources rank-data.json path")
    args = ap.parse_args()
    safari_resources = pathlib.Path(args.safari_resources) if args.safari_resources else SAFARI_RESOURCES

    nlm_path = pathlib.Path(args.nlm) if args.nlm else NLM_FILE
    if not nlm_path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        print("downloading", NLM_URL)
        urllib.request.urlretrieve(NLM_URL, nlm_path)

    pairs = load_nlm(nlm_path)
    print("nlm records:", len(pairs))

    pack, db = load_data()
    before = len(db)
    added = 0
    for abbr, title in pairs:
        abbr_key = normalize(abbr)
        if not abbr_key or abbr_key == normalize(title) or abbr_key in db:
            continue
        rec = lookup_by_title(db, title)
        if not rec:
            continue
        db[abbr_key] = rec
        added += 1

    save_data(pack, db)
    print("entries: %d -> %d (aliases added %d)" % (before, len(db), added))

    if not args.no_sync:
        if safari_resources.parent.exists():
            shutil.copyfile(DB, safari_resources)
            src = hashlib.sha256(DB.read_bytes()).hexdigest()
            dst = hashlib.sha256(safari_resources.read_bytes()).hexdigest()
            print("synced to Xcode Resources, sha256 match:", src == dst)
            if src != dst:
                sys.exit(1)
        else:
            print("safari resources not found, skipped:", safari_resources)
    print("next: rebuild the Safari app (xcodebuild) so the appex picks up the new data")


if __name__ == "__main__":
    main()
