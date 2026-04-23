#!/usr/bin/env python3
"""Rename auto-generated inverse link fields in Tasks table."""
import json
import sys
import urllib.request
import urllib.error

import os
PAT = os.environ["AIRTABLE_PAT"]  # export AIRTABLE_PAT before running
BASE_ID = "apph1Z1U3OU2gBvnL"
TASKS_TABLE_ID = "tblvLBhmfevWkywus"

RENAMES = [
    ("fld4zY2Km7Kq5bpT5", "Subtasks", "Дочерние задачи (обратная ссылка Parent)"),
    ("fldfmUQ3DrZqdRkCD", "Blocks", "Работы, которые блокирует эта (обратная ссылка Depends On)"),
]


def api_call(method, url, body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {PAT}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        raise


def main():
    for field_id, new_name, desc in RENAMES:
        url = f"https://api.airtable.com/v0/meta/bases/{BASE_ID}/tables/{TASKS_TABLE_ID}/fields/{field_id}"
        r = api_call("PATCH", url, {"name": new_name, "description": desc})
        print(f"Renamed {field_id} → {r['name']}")


if __name__ == "__main__":
    main()
