# TODO

## Phase 1 — миграция в Airtable — ✅ DONE (см. done.md)

Остался ручной шаг: пользователь создаёт views в UI (2 минуты, инструкция в ответе ассистента).

### Открытый вопрос (2026-04-22): Timeline row order
Grid view корректно отображает 1..47 по Sort_Order. Timeline views (Stacked/Gantt/Master) используют auto-layout и игнорируют сортировку для вертикального порядка. Варианты ответа ждут пользователя:
- A) принять auto-layout
- B) manual drag-reorder (долго)
- C) Airtable Interface Designer
- D) внешний Gantt (TeamGantt/GanttPRO/Smartsheet)

### 2026-04-22 (late) update
Sort_Order пересобран по Start ASC (скрипт `resort_by_start.py`). Теперь Grid 1..47 = хронология и Timeline auto-layout должен с ним совпадать.
Ручной шаг пользователю: в Gantt · ФАКТ переключить zoom в **Day** или **Week** — чтобы пустые промежутки между барами визуально читались как N клеток-дней.

### 2026-04-22 (night) — vision + стек согласованы
См. `context/vision.md`. Терминология: **n8n = backend** (оркестратор). PlanRadar/Airtable = data store тикетов. Vercel = витрина (кастомный HTML).

**Сценарий подтверждён:** смета → AI-парсинг → тикеты в PlanRadar с зависимостями. Голос в Telegram → Whisper+GPT → n8n → PATCH тикет → каскад → HTML-ссылка обновилась.

**PlanRadar Schedule structure:** Project → Phases → Tickets. Dependencies до 10 per phase/ticket, с lag. Есть automatic scheduling mode (каскад). Rate limit 30 req/min. API Pro+ only ($179/user/мес), 1 seat достаточно (API ключ общий).

### Next action — PlanRadar probe (unblock backend decision)
- [ ] **USER:** Зарегистрировать 30-day trial https://www.planradar.com/ (email + пароль, без карты)
- [ ] **USER:** Settings → API Access → сгенерировать Personal Access Token, прислать
- [ ] **ASSISTANT:** `scripts/planradar_probe.py` — проверить critical endpoints:
  - create phase (POST)
  - create ticket under phase
  - create dependency with lag
  - PATCH ticket start_date → проверить каскад (automatic mode)
  - generate report
- [ ] **ASSISTANT:** Отчёт по probe → окончательное решение: commit PlanRadar / остаёмся Airtable / гибрид

### После probe — реализация (5 недель)
1. HTML-renderer (клетчатый Gantt, Vercel): `scripts/render_gantt.py` + deploy
2. Smeta parser (n8n workflow): Telegram doc → GPT-4 structured extraction → JSON
3. Voice-bot (n8n): Telegram voice → Whisper → GPT tool-use → PlanRadar/Airtable API
4. Каскадный алгоритм сдвига (если PlanRadar auto mode не через API — пишем в n8n, учитывая Holidays)
5. Миграция Orange-проекта (47 задач) в выбранный data store

## Phase 2 — Telegram-бот (следующая итерация)

- [ ] Создать бота через @BotFather, сохранить токен в `ids.md`
- [ ] Определиться с n8n: cloud tenant или self-hosted (не localhost)
- [ ] Workflow «voice → intent»:
  - [ ] Telegram Trigger на voice сообщения
  - [ ] OpenAI Whisper — транскрибация
  - [ ] LLM (GPT-4 с tool use) для разбора интентов
- [ ] Tools:
  - [ ] `shift_task(name, days, direction)` — сдвинуть задачу + каскад по Blocks
  - [ ] `query_tasks(period)` — сегодня / эта неделя / месяц
  - [ ] `query_overdue()` — просроченное
  - [ ] `set_status(task, status)` — отметить начало/окончание
  - [ ] `add_note(task, text)` — заметка
  - [ ] `report(period)` — краткий отчёт
- [ ] Алгоритм каскадного сдвига с учётом Holidays
- [ ] Тестирование с реальными голосовыми запросами

## Phase 3 — мульти-юзер и роли

- [ ] Таблица Users в Airtable (Telegram user ID, роль, подрядчик)
- [ ] Роли: admin (всё), contractor (только свои задачи), viewer (read only)
- [ ] Уведомления: алерты на дедлайны, смена статуса
- [ ] Ежедневный дайджест утром

## Mini-backlog

- [ ] Поле `Contractor` → Linked table `Contractors` (когда появятся данные о подрядчиках)
- [ ] View `By Contractor` после того, как подрядчики будут привязаны
- [ ] Проверить и скорректировать зависимости (сейчас выведены автоматически из дат, могут требовать правок)
