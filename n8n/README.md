# Work Schedule Bot — n8n workflows

Бэкенд для публичного Gantt'а (`cyfr-schedule-app.vercel.app`). Принимает апдейты от голосового бота / PlanRadar / форм, мутирует `web/schedule.json`, пушит в git → Vercel авто-деплой.

## Архитектура

```
Voice / Form / PlanRadar webhook
        │
        ▼
n8n webhook  (/webhook/schedule-update)
        │
        ▼
Read schedule.json (raw.githubusercontent OR local fs)
        │
        ▼
Apply mutation (Code node)
        │
        ▼
Commit + push to main (GitHub API)
        │
        ▼
Vercel auto-deploy → витрина обновилась
```

## n8n location

- Instance: `http://localhost:5678` (homebrew, v2.14.2)
- Project: Personal (`7UoCEHRs6ntAn59R`)
- Folder: `Vision Tower | office 1801` (`044e7604-fbae-4826-bf06-64a562e7f97d`)

## Workflows

| Файл | Назначение | Статус |
|------|-----------|--------|
| `workflows/schedule-json-updater.json` | Webhook → mutate schedule.json → git push | MVP skeleton (echo) |

## Payload spec (webhook body)

```json
{
  "taskId": "3",
  "field": "progress",
  "value": 0.65,
  "source": "voice|form|planradar|manual",
  "author": "Sergei",
  "note": "Optional free-text comment"
}
```

Поддерживаемые `field`:
- `progress` — number 0..1
- `actualStart` — ISO date
- `actualEnd` — ISO date
- `planStart`, `planEnd` — ISO date (правка плана)

Плюс спец-операции:
```json
{ "op": "addMilestone", "date": "2026-06-15", "name": "Передача черновых работ" }
{ "op": "addPhoto", "taskId": "3", "date": "2026-04-23", "url": "https://...", "caption": "..." }
{ "op": "addDelay", "taskId": "3", "days": 2, "reason": "Материалы" }
```

## Import / re-import workflow в n8n

Через sqlite (workflow ID фиксирован, можно обновлять):
```bash
cd /Users/sergeigri/Documents/Work\ Schedule\ Bot
node n8n/scripts/import-workflow.js workflows/schedule-json-updater.json
```

Или через UI: n8n → Vision Tower folder → Import from File → выбрать `workflows/*.json`.

## Roadmap

- [x] Folder skeleton + README
- [ ] MVP webhook (echo payload)
- [ ] Read schedule.json from GitHub raw
- [ ] Mutate via Code node
- [ ] Commit+push via GitHub API (token в n8n credentials)
- [ ] Авто-пересчёт `lastUpdated` при любом изменении
- [ ] Доп. эндпоинты: `/webhook/photo-upload`, `/webhook/milestone-add`
- [ ] Интеграция с PlanRadar (webhook → автоматический progress update)
