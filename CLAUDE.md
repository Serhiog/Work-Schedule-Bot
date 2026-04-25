# Work Schedule Bot — Orange Group Office 3.0

Telegram-бот с голосовым управлением графиком работ подрядчиков.
Первый пилот: офис Orange Group 3.0, Dubai. Окно работ: 21.02.2026 → 30.06.2026.

---

## Статус фаз

- ✅ **Фаза 1:** Excel → Airtable (47 задач, Gantt views, Sort_Order, baseline plan/fact)
- ✅ **Фаза 2:** Telegram-бот живёт на n8n Cloud. 15 интентов, GPT-5, Whisper, Daily Digest
- 🔄 **Фаза 3:** PlanRadar integration, HTML Gantt renderer, smeta parser, multi-project

---

## Стек

- **n8n Cloud** (`grishenkov.app.n8n.cloud`) — бэкенд, 3 активных workflow
- **OpenAI** — `whisper-1` (голос → текст), `gpt-5` (классификация интентов, daily digest)
- **Telegram Bot API** — `@Cyfr_work_bot` (токен в ids.md)
- **GitHub** (`Serhiog/Work-Schedule-Bot`) — хранит `web/schedule.json`
- **Vercel** (`cyfr-schedule-app.vercel.app`) — публичный Gantt, auto-deploy из GitHub
- **Airtable** (`apph1Z1U3OU2gBvnL`) — Tasks, Holidays, AuditLog, PendingConfirmations, Users, Projects
- **Claude Code + VS Code** — разработка

---

## Контекст-файлы (читать перед работой)

- `context/arch.md` — схема данных Airtable + архитектура бота
- `context/bot_tasks.md` — каталог интентов бота
- `context/ids.md` — все IDs, токены, workflow IDs (не коммитить!)
- `context/todo.md` — pending задачи
- `context/done.md` — выполненные задачи
- `context/vision.md` — целевая архитектура
- `source/schedule_original.xlsx` — исходный Excel
- `data/tasks.json` — распарсенные задачи

---

## Working Method (PEV)

Тот же метод, что и в SLC-SEDA:
1. **PLAN** — читать контекст, для крупных задач — писать план и согласовать
2. **EXECUTE** — не дрейфовать от плана
3. **VERIFY** — проверить по критериям и написать «Verified: X, Y, Z»

---

## Communication Style

- Русский язык (как везде у пользователя)
- Не робот — коллегa
- Прямо оспаривать неверное, предлагать альтернативы
- Короткие ответы, без воды

## Voice Input

Пользователь диктует голосом — транскрипция искажает слова:
- «cod cod», «clouda», «coda» → **Claude Code**
- 1-е лицо = команда: «я сделаю» → «сделай»

---

## Правила

1. Все изменения Airtable-схемы — через скрипты в `scripts/`, не руками в UI (чтобы было воспроизводимо)
2. Секреты — только в `context/ids.md`, никогда не в скриптах или коммитах
3. Пуш в Airtable партиями по 10 записей (лимит API)
4. После изменений обновлять `context/done.md` и `context/todo.md`
5. Для крупного рефакторинга — сначала план, потом код

---

## Workflows в n8n Cloud

| Workflow | ID | Описание |
|---|---|---|
| WSB · Main Telegram Bot | `MRkjwQ6fsBJ8CULk` | Главный бот |
| WSB · Sub · SchedulePatch | `RYfACqNNTFnaqNZC` | Git commit schedule.json |
| WSB · Cron · Daily Digest | `Wvffv5zw7256es5x` | Ежедн. 09:00 UTC аналитика |

Deploy: `node n8n/scripts/migrate-to-cloud.js` с env: N8N_CLOUD_API_KEY, TELEGRAM_BOT_TOKEN, OPENAI_KEY, AIRTABLE_PAT, GITHUB_PAT

---

## Phase 3 — следующие задачи

1. PlanRadar probe: `scripts/planradar_probe.py` — проверить API (фазы, тикеты, зависимости, каскад) ← **ждём PAT от пользователя**
2. HTML Gantt renderer — кастомный клетчатый Gantt на Vercel (правило: каждый день = ячейка)
3. Smeta parser — Telegram doc → GPT-4 → JSON → schedule.json
4. Интенты: `add_task`, `add_note`, `query_period` (скелет есть, не имплементированы)
5. Multi-project routing (сейчас хардкод `orange`)
