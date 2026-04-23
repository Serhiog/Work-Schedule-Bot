#!/usr/bin/env python3
"""Populate the Airtable base with tasks, parent/child links, dependencies, holidays."""
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

import os
PAT = os.environ["AIRTABLE_PAT"]  # export AIRTABLE_PAT before running
BASE_ID = "apph1Z1U3OU2gBvnL"
TASKS = "tblvLBhmfevWkywus"
HOLIDAYS = "tblOBZOihkYm89yJn"

ROOT = Path(__file__).parent.parent
DATA = json.load((ROOT / "data" / "tasks.json").open(encoding="utf-8"))

# Category by external_id (parent tasks)
CATEGORY_BY_ID = {
    1: "demolition",
    2: "cleaning",
    3: "electrical",
    4: "electrical",
    5: "plumbing",
    6: "fire_safety",
    7: "hvac", 8: "hvac", 9: "hvac", 10: "hvac", 11: "hvac",
    12: "hvac", 13: "hvac", 14: "hvac", 15: "hvac", 16: "hvac",
    17: "flooring", 18: "flooring",
    19: "drywall", 20: "drywall",
    21: "finishing",
    22: "finishing",
    23: "glass",
    24: "paint",
    25: "plumbing",
    26: "flooring",
    27: "cleaning",
}

# Override category for specific subtasks (identified by name)
CATEGORY_OVERRIDE = {
    "Мебель из наличия": "furniture",
    "Мебель заказная отдельностоящая": "furniture",
    "Мебель заказная встраиваемая": "furniture",
    "Изделия на заказ (металл, стекло, панели, зеркала и т.п.)": "furniture",
    "Декор": "furniture",
}

# Subtasks that should be detached from their inferred parent (rows 74-78 end up under "уборка" incorrectly)
DETACH_FROM_PARENT = {
    "Мебель из наличия",
    "Мебель заказная отдельностоящая",
    "Мебель заказная встраиваемая",
    "Изделия на заказ (металл, стекло, панели, зеркала и т.п.)",
    "Декор",
}

# Fix for the known error: id=4 (чистовая электрика) should start after paint finishes
# Original: Start=2026-03-18, Finish=2026-06-05
# Fixed:    Start=2026-05-20 (day after paint 19.05), Finish=2026-06-05 (same)
FIX_DATES = {
    4: {"start": "2026-05-20", "finish": "2026-06-05",
        "note": "Перенесено на после покраски (id=24). В исходном Excel была логическая ошибка — стояло в начале черновой электрики."},
}

# Dependencies by external_id → list of predecessor external_ids
DEPENDENCIES = {
    2: [1],
    3: [1], 5: [1], 6: [1], 7: [1],
    8: [7], 9: [7],
    10: [8], 11: [10], 12: [11], 13: [12],
    14: [9], 15: [14, 10], 16: [13, 15],
    17: [1], 18: [17],
    19: [3, 5, 7],
    20: [19],
    21: [19, 20],
    22: [21], 23: [21], 24: [21],
    4: [24],       # FIX: чистовая электрика после покраски
    25: [22, 24], 26: [24],
    27: [25, 26, 4],
}

HOLIDAYS_DATA = [
    ("2026-03-20", "2026-03-22", "Праздничные дни"),
    ("2026-05-26", "2026-05-29", "Праздничные дни"),
    ("2026-06-16", "2026-06-16", "Праздничный день"),
]


def api_call(method, url, body=None, retries=3):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {PAT}")
    req.add_header("Content-Type", "application/json")
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            text = e.read().decode()
            if e.code == 429 and attempt < retries - 1:
                time.sleep(1.5)
                continue
            print(f"HTTP {e.code}: {text}", file=sys.stderr)
            raise


def create_records(table_id, records):
    """Create records in batches of 10."""
    created = []
    url = f"https://api.airtable.com/v0/{BASE_ID}/{table_id}"
    for i in range(0, len(records), 10):
        batch = records[i:i + 10]
        r = api_call("POST", url, {"records": batch, "typecast": True})
        created.extend(r["records"])
        time.sleep(0.25)  # stay under 5 req/s
    return created


def update_records(table_id, records):
    """Patch records in batches of 10."""
    updated = []
    url = f"https://api.airtable.com/v0/{BASE_ID}/{table_id}"
    for i in range(0, len(records), 10):
        batch = records[i:i + 10]
        r = api_call("PATCH", url, {"records": batch, "typecast": True})
        updated.extend(r["records"])
        time.sleep(0.25)
    return updated


def infer_category(task):
    if task["name"] in CATEGORY_OVERRIDE:
        return CATEGORY_OVERRIDE[task["name"]]
    if task["external_id"] is not None:
        return CATEGORY_BY_ID.get(task["external_id"])
    # Subtask — inherit category from parent
    parent_name = task.get("parent")
    if parent_name:
        for t in DATA["tasks"]:
            if t["external_id"] is not None and t["name"] == parent_name:
                return CATEGORY_BY_ID.get(t["external_id"], "materials")
    return "materials"


def build_task_fields(task):
    fields = {"Name": task["name"]}
    if task["external_id"] is not None:
        fields["External ID"] = task["external_id"]
    cat = infer_category(task)
    if cat:
        fields["Category"] = cat
    if task["duration_days"] is not None:
        fields["Duration (days)"] = task["duration_days"]
    start, finish = task["start"], task["finish"]
    note = None
    if task["external_id"] in FIX_DATES:
        fix = FIX_DATES[task["external_id"]]
        start, finish = fix["start"], fix["finish"]
        note = fix["note"]
    if start:
        fields["Start"] = start
    if finish:
        fields["Finish"] = finish
    if note:
        fields["Notes"] = note
    fields["Status"] = "not_started"
    return fields


def main():
    # --- 1. Create task records (without links) ---
    print("=== Creating task records ===")
    task_records = [{"fields": build_task_fields(t)} for t in DATA["tasks"]]
    created_tasks = create_records(TASKS, task_records)
    print(f"Created {len(created_tasks)} task records")

    # Build lookup: name → record_id, external_id → record_id
    name_to_id = {}
    extid_to_id = {}
    for created, src in zip(created_tasks, DATA["tasks"]):
        rid = created["id"]
        name_to_id[src["name"]] = rid
        if src["external_id"] is not None:
            extid_to_id[src["external_id"]] = rid

    # --- 2. Second pass: set Parent links ---
    print("\n=== Setting Parent links ===")
    parent_updates = []
    for created, src in zip(created_tasks, DATA["tasks"]):
        parent_name = src.get("parent")
        if not parent_name or src["name"] in DETACH_FROM_PARENT:
            continue
        parent_id = name_to_id.get(parent_name)
        if parent_id:
            parent_updates.append({
                "id": created["id"],
                "fields": {"Parent": [parent_id]},
            })
    if parent_updates:
        update_records(TASKS, parent_updates)
    print(f"Set parent link on {len(parent_updates)} records")

    # --- 3. Third pass: set Depends On ---
    print("\n=== Setting Depends On ===")
    dep_updates = []
    for ext_id, predecessors in DEPENDENCIES.items():
        target_rid = extid_to_id.get(ext_id)
        if not target_rid:
            continue
        pred_rids = [extid_to_id[p] for p in predecessors if p in extid_to_id]
        if pred_rids:
            dep_updates.append({
                "id": target_rid,
                "fields": {"Depends On": pred_rids},
            })
    if dep_updates:
        update_records(TASKS, dep_updates)
    print(f"Set dependencies on {len(dep_updates)} records")

    # --- 4. Holidays ---
    print("\n=== Creating holiday records ===")
    holiday_records = [
        {"fields": {"Date": start, "End Date": end, "Reason": reason}}
        for start, end, reason in HOLIDAYS_DATA
    ]
    created_hol = create_records(HOLIDAYS, holiday_records)
    print(f"Created {len(created_hol)} holiday records")

    print(f"\nAll done. Base: https://airtable.com/{BASE_ID}")


if __name__ == "__main__":
    main()
