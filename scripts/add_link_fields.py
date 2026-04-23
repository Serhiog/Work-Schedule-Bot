#!/usr/bin/env python3
"""Add self-referencing link fields (Parent, Depends On) to the Tasks table."""
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
        "name": "Parent",
        "description": "Родительская работа (для подзадач/материалов)",
        "type": "multipleRecordLinks",
        "options": {"linkedTableId": TASKS_TABLE_ID},
    },
    {
        "name": "Depends On",
        "description": "Работы, от которых зависит начало этой",
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
        body_text = e.read().decode()
        print(f"HTTP {e.code}: {body_text}", file=sys.stderr)
        raise


def main():
    url = f"https://api.airtable.com/v0/meta/bases/{BASE_ID}/tables/{TASKS_TABLE_ID}/fields"
    for field in FIELDS:
        print(f"Adding field: {field['name']}")
        r = api_call("POST", url, field)
        print(f"  → id={r['id']}")


if __name__ == "__main__":
    main()
