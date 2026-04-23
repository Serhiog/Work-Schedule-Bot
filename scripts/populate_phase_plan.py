#!/usr/bin/env python3
"""Populate Phase, Start_Plan, Finish_Plan for all Tasks."""
import json
import sys
import time
import urllib.request
import urllib.error

import os
PAT = os.environ["AIRTABLE_PAT"]  # export AIRTABLE_PAT before running
BASE_ID = "apph1Z1U3OU2gBvnL"
TASKS = "tblvLBhmfevWkywus"

PHASE_BY_EXTID = {
    1: "1 · Demolition", 2: "1 · Demolition",
    3: "2 · Rough",
    4: "3 · Finishing",
    5: "2 · Rough", 6: "2 · Rough",
    7: "2 · Rough", 8: "2 · Rough", 9: "2 · Rough", 10: "2 · Rough",
    11: "2 · Rough", 12: "2 · Rough", 13: "2 · Rough", 14: "2 · Rough",
    15: "2 · Rough", 16: "2 · Rough",
    17: "2 · Rough", 18: "2 · Rough",
    19: "2 · Rough", 20: "2 · Rough",
    21: "3 · Finishing", 22: "3 · Finishing",
    23: "3 · Finishing", 24: "3 · Finishing",
    25: "3 · Finishing", 26: "3 · Finishing",
    27: "5 · Handover",
}

FURNITURE_NAMES = {
    "Мебель из наличия",
    "Мебель заказная отдельностоящая",
    "Мебель заказная встраиваемая",
    "Изделия на заказ (металл, стекло, панели, зеркала и т.п.)",
    "Декор",
}


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


def list_records(table_id):
    out = []
    offset = None
    url_base = f"https://api.airtable.com/v0/{BASE_ID}/{table_id}"
    while True:
        url = url_base + (f"?offset={offset}" if offset else "")
        r = api_call("GET", url)
        out.extend(r["records"])
        offset = r.get("offset")
        if not offset:
            break
    return out


def batch_update(table_id, updates):
    url = f"https://api.airtable.com/v0/{BASE_ID}/{table_id}"
    for i in range(0, len(updates), 10):
        batch = updates[i:i + 10]
        api_call("PATCH", url, {"records": batch, "typecast": True})
        time.sleep(0.25)


def phase_for(rec, by_name):
    f = rec["fields"]
    name = f.get("Name", "")
    if name in FURNITURE_NAMES:
        return "4 · Furniture"
    ext = f.get("External ID")
    if ext is not None:
        return PHASE_BY_EXTID.get(int(ext))
    # subtask: inherit from parent
    parent_link = f.get("Parent") or []
    if parent_link:
        parent = by_name.get(parent_link[0])
        if parent:
            return phase_for(parent, by_name)
    return None


def main():
    records = list_records(TASKS)
    print(f"Loaded {len(records)} records")

    by_id = {r["id"]: r for r in records}

    updates = []
    skipped = 0
    for r in records:
        f = r["fields"]
        patch = {}
        ph = phase_for(r, by_id)
        if ph:
            patch["Phase"] = ph
        if f.get("Start"):
            patch["Start_Plan"] = f["Start"]
        if f.get("Finish"):
            patch["Finish_Plan"] = f["Finish"]
        if patch:
            updates.append({"id": r["id"], "fields": patch})
        else:
            skipped += 1

    print(f"Updating {len(updates)} records, skipped {skipped}")
    batch_update(TASKS, updates)
    print("Done.")


if __name__ == "__main__":
    main()
