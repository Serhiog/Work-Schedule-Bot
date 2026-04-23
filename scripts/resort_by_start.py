#!/usr/bin/env python3
"""
Пересобирает Sort_Order по правилу:
  primary = Start ASC (кто раньше начинает — выше)
  tiebreaker = текущий Sort_Order (конструктивная фаза)
  NO-DATE — в конец, с сохранением их взаимного порядка по старому Sort_Order
"""
import json
import urllib.request

import os
TOKEN = os.environ["AIRTABLE_PAT"]
BASE = "apph1Z1U3OU2gBvnL"
TABLE = "tblvLBhmfevWkywus"


def api_get(path):
    req = urllib.request.Request(
        f"https://api.airtable.com/v0/{path}",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def api_patch(path, body):
    req = urllib.request.Request(
        f"https://api.airtable.com/v0/{path}",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        method="PATCH",
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


recs = api_get(f"{BASE}/{TABLE}?pageSize=100")["records"]

dated, undated = [], []
for r in recs:
    f = r["fields"]
    entry = (f.get("Start"), f.get("Sort_Order", 999), r["id"], f.get("Name", ""))
    (undated if not entry[0] else dated).append(entry)

dated.sort(key=lambda x: (x[0], x[1]))
undated.sort(key=lambda x: x[1])
ordered = dated + undated

updates = []
print(f"{'new':>3}  {'old':>3}  start       name")
for i, (start, old_so, rid, name) in enumerate(ordered, 1):
    diff = "  " if i == old_so else ("↑↑" if i < old_so else "↓↓")
    print(f" {i:>3}  {old_so:>3} {diff} {start or 'NO-DATE   '}  {name}")
    if i != old_so:
        updates.append({"id": rid, "fields": {"Sort_Order": i}})

print(f"\n{len(updates)} records need reordering (of {len(ordered)})")

for i in range(0, len(updates), 10):
    batch = updates[i : i + 10]
    res = api_patch(f"{BASE}/{TABLE}", {"records": batch})
    print(f"  Batch {i // 10 + 1}: updated {len(res['records'])}")

print("\n✓ Sort_Order rebuilt by Start ASC")
