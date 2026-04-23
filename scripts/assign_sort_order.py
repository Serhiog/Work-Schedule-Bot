#!/usr/bin/env python3
"""
Назначает Sort_Order всем записям в Tasks по логике строительной последовательности
(сверху вниз: демонтаж → MEP rough → полы/потолки → отделка → мебель → уборка).
"""
import json
import urllib.request

import os
TOKEN = os.environ["AIRTABLE_PAT"]
BASE = "apph1Z1U3OU2gBvnL"
TABLE = "tblvLBhmfevWkywus"

# Construction-logic order (1 = top/first, N = bottom/last)
ORDER = [
    # Phase 1 — Demolition
    "демонтажные работы",
    "вывоз мусора",
    "демонтаж старой стяжки пола",
    # Phase 2 — Procurement (early, embed & MEP materials)
    "Закладные детали подсветка",
    "Закладные сантехнических приборов",
    "Напольные розетки",
    "Терморегуляторы, решетки радиаторов",
    "закуп фанкоилов",
    "закупка воздуховодов и фасонных изделий",
    # Phase 2 — MEP rough
    "сантехнические работы",
    "электромонтажные работы",
    "монтаж гипсокартоновых стен и перегородок",
    "сборка и монтаж воздуховодов",
    "работы по вентиляционным системам Frost",
    "Изоляция воздуховодов",
    "установка фанкоилов",
    "монтаж х/с",
    "монтаж узлов обвязки фанкоилов",
    "опрессовка, промывка и хим обработка труб хладоснабжения",
    "подключение слаботочной электрики и установка термостатов",
    "FAS укладка кабелей",
    "работы по системам пожаробезопасности",
    # Phase 2 — floor & ceiling
    "устройство наливного пола",
    "монтаж гипсокартоновых потолков",
    "пусконаладочные работы, акты приемки",
    # Phase 3 — Finishing (plaster → tiles → paint → glass → sanitary → carpet → fixtures)
    "штукатурно-малярные работы",
    "Плитка фоновая для санузлов",
    "Плитка акцентная для санузлов",
    "Плитка акцентная для кухни",
    "Декоративная штукатурка",
    "укладка плитки",
    "Краска",
    "покрасочные работы",
    "Стеклянные перегородки",
    "монтаж стеклянных перегородок",
    "Сантехническое оборудование",
    "монтаж сантехнического оборудования",
    "Ковролин",
    "укладка ковролина",
    "установка чистовых электроприборов",
    "Электроприборы",
    # Phase 4 — Furniture
    "Изделия на заказ (металл, стекло, панели, зеркала и т.п.)",
    "Мебель заказная встраиваемая",
    "Мебель заказная отдельностоящая",
    "Мебель из наличия",
    "Декор",
    # Phase 5 — Handover
    "уборка",
]

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

# 1. Fetch all records
recs = api_get(f"{BASE}/{TABLE}?pageSize=100")["records"]
print(f"Fetched {len(recs)} records")

# 2. Build name → record_id map
by_name = {r["fields"].get("Name", ""): r["id"] for r in recs}

# 3. Match and assign orders
updates = []
matched = set()
for i, name in enumerate(ORDER, start=1):
    if name in by_name:
        updates.append({"id": by_name[name], "fields": {"Sort_Order": i}})
        matched.add(name)
    else:
        print(f"!! UNMATCHED in ORDER list: '{name}'")

leftover = [n for n in by_name if n not in matched]
if leftover:
    print(f"!! RECORDS NOT IN ORDER LIST ({len(leftover)}):")
    for n in leftover:
        print(f"   - {n}")

print(f"\nMatched: {len(updates)}/{len(recs)}")

# 4. Batch update (max 10 per PATCH)
for i in range(0, len(updates), 10):
    batch = updates[i : i + 10]
    res = api_patch(f"{BASE}/{TABLE}", {"records": batch})
    print(f"  Batch {i//10 + 1}: updated {len(res['records'])} records")

print("\n✓ Sort_Order assigned")
