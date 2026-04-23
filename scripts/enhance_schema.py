#!/usr/bin/env python3
"""Add Phase, Start_Plan, Finish_Plan, Is_Delayed, Delay_Reason, Delayed_By fields to Tasks."""
import json
import sys
import urllib.request
import urllib.error

import os
PAT = os.environ["AIRTABLE_PAT"]  # export AIRTABLE_PAT before running
BASE_ID = "apph1Z1U3OU2gBvnL"
TASKS_TABLE_ID = "tblvLBhmfevWkywus"

FIELDS = [
    {
        "name": "Delay_Reason",
        "description": "Причина сдвига (текст)",
        "type": "multilineText",
    },
    {
        "name": "Delayed_By",
        "description": "Задача-виновник сдвига (линк)",
        "type": "multipleRecordLinks",
        "options": {"linkedTableId": TASKS_TABLE_ID},
    },
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
    url = f"https://api.airtable.com/v0/meta/bases/{BASE_ID}/tables/{TASKS_TABLE_ID}/fields"
    created = {}
    for field in FIELDS:
        print(f"Adding: {field['name']}")
        r = api_call("POST", url, field)
        created[field["name"]] = r["id"]
        print(f"  → {r['id']}")
    print(json.dumps(created, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
