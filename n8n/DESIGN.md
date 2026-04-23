# Work Schedule Bot — архитектура n8n

Цель: Telegram-бот с голосом, который умеет читать/менять состояние стройки (Orange + будущие проекты) и обновлять публичный Gantt автоматически.

## 1. Роли компонентов

| Компонент | Роль |
|-----------|------|
| Telegram | Интерфейс пользователя: голос, текст, команды, inline-кнопки |
| OpenAI Whisper | Распознавание голосовых → текст |
| OpenAI GPT-4o-mini | Классификация intent + извлечение сущностей (task, date, section, value) |
| n8n | Оркестрация — приём, маршрутизация, мутации, ответы |
| Airtable (config) | Users, Projects, AuditLog, PendingConfirmations, SectionOwners |
| GitHub repo (state) | `schedule.json` = источник правды для Gantt |
| Vercel | Авто-deploy при push → витрина `cyfr-schedule-app.vercel.app` обновляется |

## 2. Схема потока

```
┌─────────────┐
│  Telegram   │  (user: voice, text, photo)
└──────┬──────┘
       │
       ▼
┌────────────────────────────┐
│ WSB.Main.TelegramBot       │   [trigger + dispatcher]
│  ├─ auth check (Users)     │
│  ├─ route by message type  │
│  └─ log to AuditLog        │
└──────┬─────────────────────┘
       │
       ├──(voice)──▶ WSB.Voice.Transcribe ──(text)──┐
       │                                             │
       ├──(text)─────────────────────────────────────┤
       │                                             ▼
       │                              ┌──────────────────────┐
       │                              │ WSB.Intent.Classify  │
       │                              │  (GPT, structured)   │
       │                              └──────┬───────────────┘
       │                                     │
       │                          ┌──────────┴───────────┐
       │                          ▼                      ▼
       │                  [READ intents]          [WRITE intents]
       │                          │                      │
       │                          ▼                      ▼
       │                ┌────────────────┐     ┌─────────────────┐
       │                │ WSB.Status.Read│     │ WSB.Task.Mutate │
       │                └───────┬────────┘     └────────┬────────┘
       │                        │                       │
       │                        │              ┌────────▼───────────┐
       │                        │              │ WSB.Confirm.Handler│
       │                        │              │ (inline Yes/No)    │
       │                        │              └────────┬───────────┘
       │                        │                       │
       │                        │              ┌────────▼───────────┐
       │                        │              │WSB.Schedule.Commit │
       │                        │              │ (GitHub API push)  │
       │                        │              └────────┬───────────┘
       │                        │                       │
       │                        └───────┬───────────────┘
       │                                ▼
       │                      ┌────────────────────┐
       │                      │WSB.Response.Format │
       │                      │ (Markdown + emoji) │
       │                      └─────────┬──────────┘
       │                                │
       └────────────────────────────────┴────▶  Telegram reply
```

## 3. Модель данных

### 3.1 Airtable: `Work Schedule Bot` (новая база)

**Users** — кто может писать в бота
```
telegramUserId (text, PK)   : "123456789"
telegramUsername             : "sergei_g"
name                         : "Sergei Grishenkov"
role                         : owner | foreman | viewer
language                     : ru | en
allowedSections              : multi-select (или "all")
projectId                    : link → Projects
active                       : bool
```

**Projects** — мульти-проектная архитектура с самого начала
```
projectId (PK)               : "orange" | "vision-tower"
name                         : "Orange Group Office 3.0"
repoUrl                      : "https://github.com/..."
scheduleJsonPath             : "web/schedule.json"
telegramChatId               : "-1001234567" (group) или userId (personal)
defaultAssignees             : JSON — { "electrical": "+971...", ... }
vercelDeployHook             : URL или null (если без webhook — git push триггерит сам)
active                       : bool
```

**AuditLog** — полная история действий
```
id (autonum)
timestamp
telegramUserId (link)
projectId (link)
intent                       : "task.mark_done" | ...
messageText                  : text (original)
parsedPayload                : JSON (intent + entities)
resultStatus                 : ok | error | rejected | pending_confirm
resultMessage                : text
commitSha                    : text (если была запись в git)
```

**PendingConfirmations** — ожидающие Yes/No от пользователя
```
confirmId (PK, short)
telegramUserId
projectId
action                       : JSON — полный payload мутации
expiresAt                    : +15 мин от создания
confirmed                    : bool | null
resolvedAt                   : datetime
```

**SectionOwners** — кто ответственен за секцию (для routing уведомлений)
```
projectId (link)
sectionId                    : "electrical"
name                         : "СУ-Электрик"
contact                      : "+971..." / telegram handle
type                         : cyfr | sub
```

### 3.2 schedule.json — расширенная схема

Уже есть: `project, sections, stages, milestones, holidays, tasks`.
Добавить при необходимости:
```json
{
  "tasks": [
    {
      "id": "3",
      "progress": 0.45,
      "delays": [
        { "date": "2026-04-18", "days": 2, "reason": "Материалы не пришли" }
      ],
      "photos": [
        { "date": "2026-04-22", "url": "...", "caption": "...", "author": "..." }
      ],
      "assignee": "СУ-Электрик",
      "dependsOn": ["1"]
    }
  ]
}
```

## 4. Каталог intent'ов

### Read (без мутаций)
| Intent | Пример | Output |
|--------|--------|--------|
| `status.overview` | "как дела", "покажи прогресс" | % по времени / по задачам, сколько в работе / не начато / в риске |
| `status.today` | "что сегодня", "что завтра" | Список задач активных на дату |
| `status.section` | "как электрика", "по сантехнике" | Прогресс по секции + ближайшие задачи |
| `status.at_risk` | "что в риске", "где просрочки" | Overdue + ближайшие к дедлайну |
| `status.tomorrow` | "что завтра стартует" | Tasks with planStart = tomorrow |
| `query.contact` | "кто делает электрику" | Ответ из SectionOwners |

### Write (с подтверждением)
| Intent | Пример | Entities |
|--------|--------|----------|
| `task.mark_done` | "электрика готова" / "закрой 3" | taskId/name, actualEnd (optional) |
| `task.mark_started` | "стартовали стяжку сегодня" | taskId/name, actualStart |
| `task.set_progress` | "малярка 60%" | taskId/name, progress |
| `task.shift_dates` | "сдвинь потолки на 3 дня позже" | taskId/name, deltaDays или newDate |
| `task.add_new` | "добавь залив воды на вторник, 1 день, сантехника" | name, section, planStart, planEnd |
| `task.add_delay` | "по ГКЛ задержка 2 дня, материалы" | taskId/name, days, reason |
| `milestone.add` | "добавь веху: сдача чистовой 20 мая" | date, name |
| `photo.add` | голос + фото | taskId/name (implied by conversation) |

### Meta
| Intent | Смысл |
|--------|-------|
| `confirm` | "да", "подтверждаю" → apply pending confirmation |
| `cancel` | "нет", "отмени" → drop pending confirmation |
| `help` | "что ты умеешь", "/help" |
| `undo` | "откати последнее" → revert last commit |

## 5. Workflows — иерархия

### Main (trigger-workflows)

| Workflow | Trigger | Описание |
|----------|---------|----------|
| `WSB.Main.TelegramBot` | Telegram Trigger | Главный роутер (voice/text/photo/callback) |
| `WSB.Webhook.ScheduleUpdate` | HTTP Webhook | Внешний API (PlanRadar, формы) — уже скелет есть |
| `WSB.Cron.DailyReminder` | Schedule (9:00 AM) | Утренняя сводка в чат |

### Sub-workflows (вызываются через Execute Workflow)

| Workflow | Назначение |
|----------|-----------|
| `WSB.Voice.Transcribe` | Download Telegram voice → Whisper → text |
| `WSB.Intent.Classify` | GPT-4o-mini: text + context → { intent, entities } |
| `WSB.Status.Read` | Read-only queries (5 sub-intents) |
| `WSB.Task.Mutate` | Write ops (6 sub-intents) |
| `WSB.Milestone.Mutate` | Milestone CRUD |
| `WSB.Confirm.Handler` | Inline Yes/No keyboard + PendingConfirmations |
| `WSB.Schedule.CommitToGit` | **Shared:** read JSON → apply diff → GitHub API commit → bump lastUpdated |
| `WSB.Response.Format` | Telegram Markdown + emoji icons |
| `WSB.AuditLog.Write` | Airtable insert after every action |
| `WSB.Auth.Check` | Verify Users.role vs intent |

## 6. Ключевые паттерны

### 6.1 Confirmation flow (критично для write-ops)

```
1. User: "электрика готова"
2. Intent classify → { intent: "task.mark_done", entities: { taskId: "3", date: null } }
3. Bot stages action:
   - insert into Airtable PendingConfirmations (confirmId = abc123, TTL 15 min)
   - reply: "Подтверди: отметить «Электромонтажные работы» завершённой сегодня?"
     Inline keyboard: [✅ Да] [❌ Нет]
4a. User taps Да → callback_query "confirm:abc123"
     - Main.TelegramBot receives callback
     - lookup PendingConfirmations by confirmId
     - if not expired + not consumed → apply mutation
     - commit to git
     - reply: "Готово. Прогресс витрины обновлён."
4b. User taps Нет → "cancel:abc123" → mark cancelled
```

### 6.2 Task lookup (важно для UX)

Пользователь редко говорит ID. GPT извлекает `taskName`, далее `WSB.Task.Mutate`:
1. Exact match по имени → use it
2. Fuzzy match (Levenshtein) → 1 кандидат → use it
3. >1 кандидат → ask user with inline keyboard: "Какую именно?"
4. 0 матчей → "Не нашёл задачу «X». Ближайшие: [...]"

### 6.3 Date parsing

GPT даёт относительные даты ("завтра", "в среду") + абсолютные ("20 мая").
Normalize в Code node: `{ date: "2026-04-24" }` — всегда ISO.
Edge cases: "следующая пятница", "через 2 дня". Пусть GPT возвращает ISO — Whisper + GPT-4o справляется лучше regex.

### 6.4 Git commit

```
GET https://api.github.com/repos/<owner>/<repo>/contents/web/schedule.json
  → { content (base64), sha }
decode → mutate → encode base64
PUT с message "WSB: <intent> by <user>", content, sha (same ref), branch=main
```
Credentials: GitHub PAT stored in n8n credentials (scope: repo).

### 6.5 Context для GPT

Каждый intent-classify получает компактный контекст:
```
Tasks (30): [{id, name, section, planStart..planEnd, progress, status}, ...]
Sections: [{id, name}]
Today: 2026-04-23
Last 3 user msgs: [...]
```
~2-3 KB, укладывается в контекстное окно, не влияет на cost значимо.

### 6.6 Мульти-проектность

`telegramChatId → projectId` (lookup в `Projects`).
Один бот-токен на все проекты, routing по chat.
Пользователь в личке — дефолтный project или список через inline keyboard.

## 7. Безопасность / авторизация

- `Users` table is source of truth.
- Роль `viewer`: только READ intents.
- Роль `foreman`: READ + WRITE, но только задачи своих `allowedSections`.
- Роль `owner`: всё.
- Unknown user → ignore (не отвечать, чтобы бот не раскрывал себя).
- Rate limit: Code node check — max 30 команд/час на user.

## 8. Фазы реализации

### Phase A — Foundation (~1 сессия)
- [ ] Airtable: создать базу `Work Schedule Bot` с 5 таблицами + sample rows (1 user = owner, 1 project = orange)
- [ ] n8n credentials: GitHub PAT, Telegram Bot token, OpenAI key, Airtable PAT
- [ ] `WSB.Schedule.CommitToGit` — shared workflow (полноценный, с real git push)
- [ ] `WSB.AuditLog.Write` — простой helper
- [ ] `WSB.Main.TelegramBot` — skeleton: auth + /help + /status отвечает «OK работаю»
- [ ] Тест: `/help` end-to-end

### Phase B — Read queries (~1 сессия)
- [ ] `WSB.Intent.Classify` — GPT-4o-mini с структурированным output
- [ ] `WSB.Status.Read` — 4 sub-intents
- [ ] `WSB.Response.Format` — MD + emoji helpers
- [ ] Тест: "покажи прогресс" возвращает данные

### Phase C — Mutations (~1-2 сессии)
- [ ] `WSB.Confirm.Handler` + inline keyboard callback routing
- [ ] `WSB.Task.Mutate` — mark_done, set_progress, shift_dates
- [ ] Fuzzy task lookup (Levenshtein в Code node)
- [ ] Тест: "закрой электрику" → confirm → commit видно в gantt

### Phase D — Voice + task.add + milestone (~1 сессия)
- [ ] `WSB.Voice.Transcribe` (Whisper)
- [ ] `task.add_new` branch в Task.Mutate
- [ ] `WSB.Milestone.Mutate`
- [ ] Тест: голосовое «добавь задачу...» создаёт task

### Phase E — Polish
- [ ] `WSB.Cron.DailyReminder` (9:00)
- [ ] `photo.add` (Telegram photo → Vercel Blob → `photos[]`)
- [ ] `task.add_delay`
- [ ] Multi-project routing
- [ ] Undo last commit

## 9. Что НЕ делаем в n8n

- Рендер PDF — либо client-side (уже есть `window.print()`), либо отдельный Vercel serverless function.
- Хранение фото — Vercel Blob или S3. n8n только принимает и отправляет URL.
- Real-time updates в браузере (без перезагрузки) — push через SSE/websocket. Пока нет потребности; reload достаточно.
- Сложная аналитика (critical path) — когда появится `dependsOn`.

## 10. Риски и open questions

1. **Whisper качество русских стройтерминов** — проверить на реальных голосовых («ГКЛ», «фанкоил», «шпаклёвка»).
2. **GitHub API rate limit** — 5000/hr для авторизованного. Не проблема для одного проекта.
3. **Collision при параллельных мутациях** — два пользователя одновременно → SHA mismatch на PUT → retry. Добавить retry логику в CommitToGit.
4. **Credentials security** — все токены в n8n credentials, не в workflow JSON. Git не должен содержать ключи.
5. **Telegram voice формат** — OGG Opus. Whisper жрёт напрямую.
6. **Backup schedule.json** — git history сам по себе backup. AuditLog дублирует intent payload.
