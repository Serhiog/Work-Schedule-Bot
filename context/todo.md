# TODO — Work Schedule Bot

_Обновлено 2026-04-23. Phase 1 (Airtable) и Phase 2 (Bot) — DONE._

---

## Phase 3 — активные задачи

### 1. PlanRadar probe 🔴 (блокирован — ждём PAT)

- [ ] **USER:** Сгенерировать Personal Access Token в PlanRadar → Settings → API Access → прислать
- [ ] **ASSISTANT:** `scripts/planradar_probe.py` — проверить критические endpoints:
  - POST phase (создать этап)
  - POST ticket under phase
  - POST dependency with lag
  - PATCH ticket start_date → проверить каскад (automatic scheduling mode)
  - GET report
- [ ] **ASSISTANT:** Отчёт → commit/reject PlanRadar vs остаёмся Airtable

**Данные для probe:**
- Account ID: `1500855`
- Project ID: `1533951` (Vision Tower | office 1801 — чистый testbed)
- API base: `https://api.planradar.com/v2`

---

### 2. HTML Gantt renderer (Vercel)

Текущий `cyfr-schedule-app.vercel.app` — базовый HTML из `web/index.html`.
Нужен кастомный клетчатый Gantt (по vision.md):
- Каждый день = ячейка с видимой рамкой
- Весь 4-месячный проект в одном экране (~3mm/день)
- Выходные/праздники подсвечены
- Бары по категориям с цветами

**Стек:** canvas или SVG, данные из `schedule.json` (читает при загрузке).

---

### 3. Smeta parser

- Telegram doc (PDF/Word смета) → n8n → GPT-4 structured extraction → JSON
- Результат: новый `schedule.json` → новый проект
- Нужно: n8n workflow `smeta-parser`, промпт для GPT с форматом сметы CYFR

---

### 4. Полная голосовая редактура графика (ПРИОРИТЕТ)

**Принцип:** максимальная кастомизация — только голосом. Все мутации через schedule.json → GitHub → Vercel.
Всегда при добавлении задачи: уточнять подрядчика (мы / бригада X).

#### Категория А — Полоски (даты)
- [ ] `set_start_date` — «электрика начинается с 10 мая» (абсолютная дата)
- [ ] `set_end_date` — «электрику закончи к 20 мая»
- [ ] `set_both_dates` — «электрика с 10 по 25 мая»
- [ ] `set_duration` — «укорати покраску до 14 дней»
- [ ] `bulk_shift_section` — «все финишные работы сдвинь на неделю»

#### Категория Б — Задачи (список слева)
- [ ] `add_task` — многошаговый диалог: section? → dates? → contractor? → confirm
- [ ] `remove_task` — найти → предупреждение → confirm
- [ ] `rename_task` — «переименуй «уборку» в «генеральная уборка»»
- [ ] `move_task_section` — переместить задачу в другой раздел
- [ ] `mark_cancelled` — отменить задачу
- [ ] `add_note` — текстовая заметка к задаче

#### Категория В — Подрядчики
- [ ] `set_contractor` — «электрику делает бригада Ахмеда» / «это наши силы»
- [ ] `set_section_contractor` — назначить подрядчика на весь раздел

#### Категория Г — Разделы
- [ ] `add_section` — создать новый раздел
- [ ] `rename_section` — переименовать раздел
- [ ] `remove_section` — удалить раздел (предупреждение если есть задачи)

#### Что меняется в коде
1. `BuildGPTRequest` (main-telegram-bot.json): +14 интентов в INTENTS + поля в JSON schema:
   `task_name`, `section`, `planStart`, `planEnd`, `duration`, `contractor_name`, `contractor_phone`, `is_self`, `section_name`, `date_type`
2. `BuildResponse` (main-telegram-bot.json): реализация всех новых интентов с clarify/confirm flow
3. `Apply Mutation` (schedule-patch.json): +14 типов операций

#### Диалоговый flow add_task
```
«добавь монтаж кондиционеров»
  → Шаг 1: секция? (если null)
  → Шаг 2: даты? (если null)
  → Шаг 3: подрядчик? (ВСЕГДА)
  → confirm → SchedulePatch → GitHub → Vercel
```
Context-механизм (AuditLog last 5) — не нужна отдельная state-machine.

---

### 5. Multi-project routing

Сейчас в боте хардкод `orange`. Нужно:
- Читать из Airtable Projects таблицы активный проект пользователя
- Маршрутизировать schedule.json по project code

---

## Открытые вопросы

### Timeline row order в Airtable (2026-04-22)
Grid view корректно показывает 1..47 по Sort_Order (Start ASC).
Timeline/Gantt views — auto-layout по датам, сортировку игнорируют.
**Варианты:** A) принять auto-layout | B) drag-reorder | C) Interface Designer | D) внешний Gantt
→ Пользователь не выбрал. Дефолт: принять A.

---

### 6. Rollback (откат последнего изменения) — ПОСЛЕ п.4

**Механика:** GitHub хранит историю коммитов. При каждой мутации schedule-patch.json уже получает `sha` текущего файла.
Нужно:
1. Сохранять `prev_sha` в AuditLog при каждой мутации (новое поле)
2. Добавить интент `undo_last` — «отмени», «откати», «верни как было»
3. По `undo_last` → найти последнюю запись AuditLog с `prev_sha` → GitHub GET того sha → PUT обратно

Нет нужды в отдельных снапшотах — GitHub история сама по себе и есть хранилище.
Глубина отката: минимум 1 шаг (последнее действие). Потом можно N шагов.

---

## Mini-backlog

- [ ] Фото с объекта (upload → Vercel Blob → привязка к задаче)
- [ ] PDF-экспорт графика
- [ ] Загрузка сметы → парсинг → новый schedule.json → новый проект
- [ ] Авто-переезд на improved prompt из daily digest (мета-аналитика)
- [ ] Уведомления: алерты на дедлайны, смена статуса
