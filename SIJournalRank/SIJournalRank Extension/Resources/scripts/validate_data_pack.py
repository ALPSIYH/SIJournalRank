# -*- coding: utf-8 -*-
"""Validate a SI Journal Rank data pack.

Accepts both the versioned format:
    {"format": "si-journal-rank", "schemaVersion": 1, "dataVersion": "...",
     "generatedAt": "...", "recordCount": N, "records": {...}}
and the legacy flat record map.

Usage:
    python3 scripts/validate_data_pack.py /path/to/rank-data.json
"""
import argparse
import json
import pathlib
import sys

FORMAT = "si-journal-rank"
SCHEMA_VERSION = 1
KNOWN_FIELDS = {
    "sci", "sciCats", "ssci", "ssciCats", "esci", "esciCats",
    "ahci", "sciif", "xr", "xrCats", "xrTop", "xrWarn",
    "cssci", "pku", "cscd", "zhongguokejihexin",
}
CAT_FIELDS = ("sciCats", "ssciCats", "esciCats", "xrCats")
QUARTILES = {"Q1", "Q2", "Q3", "Q4", "1区", "2区", "3区", "4区"}


def main():
    ap = argparse.ArgumentParser(description="Validate a SI Journal Rank data pack.")
    ap.add_argument("data_pack", nargs="?", default="data/rank-data.json", help="path to a data pack JSON file")
    args = ap.parse_args()
    path = pathlib.Path(args.data_pack)

    errors = []
    warnings = []

    if not path.exists():
        print("ERROR: file not found:", path)
        return 1

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - report a short, actionable message
        print("ERROR: invalid JSON:", exc)
        return 1

    is_versioned = isinstance(raw, dict) and isinstance(raw.get("records"), dict)
    if is_versioned:
        pack = raw
        for key in ("format", "schemaVersion", "dataVersion", "generatedAt", "recordCount"):
            if key not in pack:
                errors.append("missing pack field: " + key)
        if pack.get("format") != FORMAT:
            warnings.append("unexpected format: %r" % (pack.get("format"),))
        if not isinstance(pack.get("schemaVersion"), int):
            errors.append("schemaVersion must be an integer")
        elif pack["schemaVersion"] > SCHEMA_VERSION:
            errors.append("schemaVersion %s is newer than supported %s" % (pack["schemaVersion"], SCHEMA_VERSION))
        records = pack["records"]
    else:
        warnings.append("legacy flat format: no format/schemaVersion/dataVersion/recordCount")
        pack = {}
        records = raw if isinstance(raw, dict) else {}

    if not isinstance(records, dict):
        print("ERROR: records must be a JSON object")
        return 1

    if is_versioned and pack.get("recordCount") != len(records):
        errors.append("recordCount %s != actual %s" % (pack.get("recordCount"), len(records)))

    for key, record in records.items():
        if not isinstance(key, str) or not key.strip():
            errors.append("invalid record key: %r" % (key,))
            continue
        if not isinstance(record, dict):
            errors.append("record %r must be an object" % key)
            continue
        for field in record:
            if field not in KNOWN_FIELDS:
                warnings.append("record %r has unknown field %r" % (key, field))
        for field in CAT_FIELDS:
            cats = record.get(field)
            if cats is None:
                continue
            if not isinstance(cats, list):
                errors.append("record %r field %s must be a list" % (key, field))
                continue
            for cat in cats:
                if not isinstance(cat, dict) or "category" not in cat or "quartile" not in cat:
                    errors.append("record %r field %s has a malformed category row" % (key, field))
                elif str(cat["quartile"]) not in QUARTILES:
                    warnings.append("record %r field %s has an unusual quartile %r" % (key, field, cat["quartile"]))

    print("file:", path)
    print("records:", len(records))
    print("format:", pack.get("format", "legacy-flat") if is_versioned else "legacy-flat")
    print("dataVersion:", pack.get("dataVersion", "") if is_versioned else "")
    for w in warnings[:20]:
        print("WARN:", w)
    if len(warnings) > 20:
        print("WARN: ... and %d more" % (len(warnings) - 20))
    for e in errors[:40]:
        print("ERROR:", e)
    if len(errors) > 40:
        print("ERROR: ... and %d more" % (len(errors) - 40))
    if errors:
        print("FAIL")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
