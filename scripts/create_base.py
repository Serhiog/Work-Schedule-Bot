#!/usr/bin/env python3
"""Create the Airtable base 'Work Schedule — Orange Group Office 3.0' with Tasks and Holidays tables."""
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

import os
PAT = os.environ["AIRTABLE_PAT"]  # export AIRTABLE_PAT before running
WORKSPACE_ID = "wspSqhjDBaj5c0rnY"  # paid workspace

API = "https://api.airtable.com/v0/meta"

TABLES = [
    {
        "name": "Tasks",
        "description": "Work schedule tasks for Orange Group Office 3.0 fit-out",
        "fields": [
            {"name": "Name", "type": "singleLineText"},
            {"name": "External ID", "type": "number", "options": {"precision": 0}},
            {
                "name": "Category",
                "type": "singleSelect",
                "options": {
                    "choices": [
                        {"name": "demolition", "color": "grayBright"},
                        {"name": "electrical", "color": "yellowBright"},
                        {"name": "plumbing", "color": "blueBright"},
                        {"name": "fire_safety", "color": "redBright"},
                        {"name": "hvac", "color": "cyanBright"},
                        {"name": "flooring", "color": "orangeBright"},
                        {"name": "drywall", "color": "pinkBright"},
                        {"name": "finishing", "color": "purpleBright"},
                        {"name": "glass", "color": "tealBright"},
                        {"name": "paint", "color": "greenBright"},
                        {"name": "furniture", "color": "grayDark1"},
                        {"name": "cleaning", "color": "greenLight2"},
                        {"name": "materials", "color": "yellowLight2"},
                    ]
                },
            },
            {"name": "Duration (days)", "type": "number", "options": {"precision": 0}},
            {"name": "Start", "type": "date", "options": {"dateFormat": {"name": "european"}}},
            {"name": "Finish", "type": "date", "options": {"dateFormat": {"name": "european"}}},
            {
                "name": "Status",
                "type": "singleSelect",
                "options": {
                    "choices": [
                        {"name": "not_started", "color": "grayBright"},
                        {"name": "in_progress", "color": "yellowBright"},
                        {"name": "done", "color": "greenBright"},
                        {"name": "delayed", "color": "orangeBright"},
                        {"name": "blocked", "color": "redBright"},
                    ]
                },
            },
            {"name": "Contractor", "type": "singleLineText"},
            {"name": "Notes", "type": "multilineText"},
            {"name": "Progress", "type": "percent", "options": {"precision": 0}},
        ],
    },
    {
        "name": "Holidays",
        "description": "Non-working days (public holidays, site closures)",
        "fields": [
            {"name": "Date", "type": "date", "options": {"dateFormat": {"name": "european"}}},
            {"name": "End Date", "type": "date", "options": {"dateFormat": {"name": "european"}}},
            {"name": "Reason", "type": "singleLineText"},
        ],
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
    payload = {
        "name": "Work Schedule — Orange Group Office 3.0",
        "workspaceId": WORKSPACE_ID,
        "tables": TABLES,
    }
    result = api_call("POST", f"{API}/bases", payload)
    print(json.dumps(result, ensure_ascii=False, indent=2))

    ids_path = Path(__file__).parent.parent / "data" / "base_info.json"
    ids_path.parent.mkdir(exist_ok=True)
    with ids_path.open("w") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\nSaved base info → {ids_path}")


if __name__ == "__main__":
    main()
