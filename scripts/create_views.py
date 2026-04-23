#!/usr/bin/env python3
"""Create additional views on the Tasks table (Timeline, Today, This Week, Overdue, By Category)."""
import json
import sys
import urllib.request
import urllib.error

import os
PAT = os.environ["AIRTABLE_PAT"]  # export AIRTABLE_PAT before running
BASE_ID = "appQOpE3JIwwBYs7B"
TASKS_TABLE_ID = "tblez6tXRLUgOmHK2"

VIEWS = [
    {"name": "Timeline", "type": "timeline"},
    {"name": "Calendar", "type": "calendar"},
    {"name": "Today", "type": "grid"},
    {"name": "This Week", "type": "grid"},
    {"name": "Overdue", "type": "grid"},
    {"name": "By Category", "type": "grid"},
    {"name": "Hierarchy", "type": "grid"},
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
        return None


def main():
    url = f"https://api.airtable.com/v0/meta/bases/{BASE_ID}/tables/{TASKS_TABLE_ID}/views"
    for v in VIEWS:
        r = api_call("POST", url, v)
        if r:
            print(f"Created view: {v['name']:15} [{v['type']}] → {r['id']}")
        else:
            print(f"FAILED: {v['name']}")


if __name__ == "__main__":
    main()
