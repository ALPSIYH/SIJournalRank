# -*- coding: utf-8 -*-
"""Build SI Journal Rank's data/rank-data.json from raw CSSCI, XR2026, JCR2025 and official JCR xlsx."""
import csv
import json
import pathlib
import re

import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OFFICIAL_JCR_DIR = RAW / "official_jcr2025"
OUT = ROOT / "data" / "rank-data.json"

def normalize(name):
    if not name:
        return ""
    s = str(name).upper()
    s = re.sub(r"[^A-Z0-9&\u4e00-\u9fa5 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def clean_qu(str_qu):
    if not str_qu:
        return ""
    return str_qu.replace(" ", "").replace("\u3000", "")

def quartile_rank(q):
    if q == "Q1":
        return 1
    if q == "Q2":
        return 2
    if q == "Q3":
        return 3
    if q == "Q4":
        return 4
    return 9

def best_quartile(cats):
    vals = [c["quartile"] for c in cats if c.get("quartile") in ("Q1", "Q2", "Q3", "Q4")]
    if not vals:
        return ""
    return min(vals, key=quartile_rank)

def add_jcr_categories(entry, field, category, quartile):
    if not category or not quartile:
        return
    if field not in entry:
        entry[field] = []
    entry[field].append({"category": category.strip(), "quartile": quartile.strip()})
    primary = "sci" if field == "sciCats" else "ssci" if field == "ssciCats" else "esci"
    entry[primary] = best_quartile(entry[field])

def read_official_jcr(data, path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        for ws in wb.worksheets:
            rows = list(ws.iter_rows(values_only=True))
            header_idx = None
            header_map = {}
            for idx, row in enumerate(rows):
                cleaned = ["" if c is None else str(c).strip().lower() for c in row]
                if "journal name" not in cleaned:
                    continue
                header_idx = idx
                for col, name in enumerate(cleaned):
                    if name == "journal name":
                        header_map[col] = "journal"
                    elif name == "edition":
                        header_map[col] = "edition"
                    elif name == "category":
                        header_map[col] = "category"
                    elif name == "jif" or re.fullmatch(r"\d{4}\s+jif", name):
                        header_map[col] = "jif"
                    elif name == "jif quartile" or re.fullmatch(r"\d{4}\s+jif quartile", name):
                        header_map[col] = "jif_quartile"
                break
            if header_idx is None:
                continue
            for row in rows[header_idx + 1:]:
                values = {}
                for col, field in header_map.items():
                    values[field] = row[col] if col < len(row) else None
                journal = str(values.get("journal") or "").strip()
                if not journal:
                    continue
                edition = str(values.get("edition") or "").upper()
                category = str(values.get("category") or "").strip()
                q = str(values.get("jif_quartile") or "").strip()
                try:
                    jif = float(values.get("jif"))
                except (TypeError, ValueError):
                    jif = None
                key = normalize(journal)
                if not key:
                    continue
                if key not in data:
                    data[key] = {}
                entry = data[key]
                if "SCIE" in edition:
                    add_jcr_categories(entry, "sciCats", category, q)
                if "SSCI" in edition:
                    add_jcr_categories(entry, "ssciCats", category, q)
                if "ESCI" in edition:
                    add_jcr_categories(entry, "esciCats", category, q)
                if "AHCI" in edition:
                    entry["ahci"] = "A&HCI检索"
                if jif is not None:
                    old = entry.get("sciif")
                    try:
                        old_float = float(old)
                    except (TypeError, ValueError):
                        old_float = None
                    if old_float is None or jif > old_float:
                        entry["sciif"] = str(jif)
    finally:
        wb.close()

def main():
    data = {}

    # 1) CSSCI / 北大核心 / CSCD / 科技核心
    csci_path = RAW / "csci_2025_2026.json"
    if csci_path.exists():
        raw = json.loads(csci_path.read_text(encoding="utf-8"))
        index = raw.get("index", {})
        alias = raw.get("alias", {})
        for name, info in index.items():
            tags = info.get("t", "")
            entry = {}
            if "CSSCI来源期刊（2025-2026）" in tags:
                entry["cssci"] = "CSSCI"
            elif "CSSCI扩展版" in tags:
                entry["cssci"] = "CSSCI扩展版"
            if "北大核心" in tags:
                entry["pku"] = "北大中文核心"
            if "CSCD核心" in tags:
                entry["cscd"] = "CSCD核心库"
            elif "CSCD扩展" in tags:
                entry["cscd"] = "CSCD扩展库"
            if "科技核心" in tags:
                entry["zhongguokejihexin"] = "中国科技核心期刊"
            if entry:
                key = normalize(name)
                if key:
                    if key not in data:
                        data[key] = {}
                    data[key].update(entry)

        for alias_name, real_name in alias.items():
            real_key = normalize(real_name)
            alias_key = normalize(alias_name)
            if real_key in data and alias_key:
                data[alias_key] = data[real_key]

    # 2) XR2026
    xr_path = RAW / "XR2026-UTF8.csv"
    if xr_path.exists():
        with xr_path.open(encoding="utf-8", errors="ignore") as f:
            reader = csv.DictReader(f)
            for row in reader:
                journal = (row.get("Journal") or "").strip()
                if not journal:
                    continue
                entry = {}
                qu = clean_qu(row.get("大类新锐分区") or "")
                if qu:
                    entry["xr"] = qu
                top = (row.get("Top") or "").strip()
                if top == "Top" and qu:
                    entry["xrTop"] = qu
                mark = (row.get("标注") or "").strip()
                if mark and ("Under Review" in mark or "预警" in mark):
                    entry["xrWarn"] = mark
                if entry:
                    key = normalize(journal)
                    if key:
                        if key not in data:
                            data[key] = {}
                        data[key].update(entry)
                zh = (row.get("中文刊名") or "").strip()
                if zh:
                    zkey = normalize(zh)
                    if zkey:
                        if zkey not in data:
                            data[zkey] = {}
                        data[zkey].update(entry)

    # 3) JCR2025 full CSV
    jcr_path = RAW / "JCR2025-UTF8.csv"
    if jcr_path.exists():
        with jcr_path.open(encoding="utf-8", errors="ignore") as f:
            reader = csv.DictReader(f)
            for row in reader:
                journal = (row.get("Journal") or "").strip()
                if not journal:
                    continue
                wos = (row.get("Web of Science") or "").upper()
                entry = {}
                for i in range(1, 7):
                    category = (row.get("Category_%d" % i) or "").strip()
                    q = (row.get("IF Quartile(2025)_%d" % i) or "").strip()
                    if not category or not q:
                        continue
                    if "SCIE" in wos:
                        add_jcr_categories(entry, "sciCats", category, q)
                    if "SSCI" in wos:
                        add_jcr_categories(entry, "ssciCats", category, q)
                    if "ESCI" in wos:
                        add_jcr_categories(entry, "esciCats", category, q)
                if "AHCI" in wos:
                    entry["ahci"] = "A&HCI检索"
                if row.get("IF(2025)"):
                    entry["sciif"] = str(row.get("IF(2025)")).strip()
                if entry:
                    key = normalize(journal)
                    if key:
                        if key not in data:
                            data[key] = {}
                        data[key].update(entry)

    # 4) Official JCR 2025 xlsx exports
    if OFFICIAL_JCR_DIR.exists():
        for xlsx in sorted(OFFICIAL_JCR_DIR.glob("*.xlsx")):
            read_official_jcr(data, xlsx)
            print("official jcr:", xlsx.name)

    # 5) write
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", OUT)
    print("entries", len(data))

if __name__ == "__main__":
    main()
