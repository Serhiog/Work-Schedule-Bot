# DONE

## 2026-04-21 — Phase 1: миграция в Airtable

### Проект и данные
- [x] Создана папка проекта `/Users/sergeigri/Documents/Work Schedule Bot/` (отдельно от SLC SAGA)
- [x] Скопирован Excel → `source/schedule_original.xlsx`
- [x] `scripts/extract_tasks.py` распарсил 47 задач (27 parent + 20 subtasks) + 3 диапазона праздников
- [x] `data/tasks.json` сгенерирован

### Airtable
- [x] PAT получен и сохранён в `context/ids.md`
- [x] Workspace выбран: `wsp54hWpiYB21S1ER` (НЕ SLC-SEDA)
- [x] Создана база `Work Schedule — Orange Group Office 3.0` → `appQOpE3JIwwBYs7B`
- [x] Таблица **Tasks** (tblez6tXRLUgOmHK2) с полями: Name, External ID, Category, Duration (days), Start, Finish, Status, Contractor, Notes, Progress, Parent (→ self), Subtasks (← обратная), Depends On (→ self), Blocks (← обратная)
- [x] Таблица **Holidays** (tblFbGcXnwwgsDY2i): Date, End Date, Reason

### Данные залиты
- [x] 47 задач в Tasks
- [x] 3 диапазона праздников в Holidays (20–22.03, 26–29.05, 16.06)
- [x] 15 Parent-связок (подзадачи → родители)
- [x] 26 Depends On связок (зависимости между работами)
- [x] **Исправлена ошибка Excel:** «установка чистовых электроприборов» (id=4) перенесена с 18.03–05.06 на **20.05–05.06** (после окончания покраски). Depends On → 24 (покрасочные работы). Заметка об изменении записана в Notes
- [x] «Мебель из наличия/заказная/встраиваемая», «Изделия на заказ», «Декор» отцеплены от ошибочного parent «уборка» и переведены в категорию `furniture`

### Документация
- [x] `CLAUDE.md` — цели, стек, правила
- [x] `context/arch.md` — схема данных, алгоритм сдвига, интенты
- [x] `context/ids.md` — креды (в .gitignore)
- [x] `context/todo.md` — пендинги

### Скрипты (воспроизводимо)
- [x] `scripts/extract_tasks.py`
- [x] `scripts/create_base.py`
- [x] `scripts/add_link_fields.py`
- [x] `scripts/rename_inverse_fields.py`
- [x] `scripts/populate_airtable.py`

### Known limitations
- Views (Timeline, Today и т.п.) нельзя создать через Airtable API — требуется UI. Инструкция передана пользователю.

---

## 2026-04-21 (evening) — Phase 1.5: визуальные варианты Gantt

### Новая база (пересоздана чище)
- Base `apph1Z1U3OU2gBvnL`, Tasks `tblvLBhmfevWkywus`, Holidays `tblOBZOihkYm89yJn`
- Старую базу `appQOpE3JIwwBYs7B` можно удалить

### Дополненная схема (Tasks)
- `Phase` (5 значений: Demolition / Rough / Finishing / Furniture / Handover) — чище чем Category (13)
- `Start_Plan`, `Finish_Plan` — baseline-снимок для сравнения план/факт
- `Delay_Reason` (текст), `Delayed_By` (линк на задачу-виновника)

### Gantt-варианты (4 вида в разных вкладках)
- **By Category** — исходный Timeline, 13 ярких цветов (перегружено)
- **By Phase** — Timeline, 5 спокойных цветов (базовый рекомендованный)
- **Plan (baseline)** — Timeline на Start_Plan/Finish_Plan, без цветов (эталон плана)
- **Master** — нативный Airtable **Gantt** с полем Depends On, **critical path** (красный пунктир), drag-to-reschedule, каскадный сдвиг

### Скрипты
- `scripts/enhance_schema.py` — добавляет новые поля через Meta API
- `scripts/populate_phase_plan.py` — заливает Phase + Start_Plan/Finish_Plan для всех 47 записей

### Что работает прямо сейчас
- Сдвиг задачи в Gantt · Master → автоматический каскадный сдвиг зависимых через Depends On
- Сравнение план/факт: Gantt · Plan (baseline) vs Gantt · Master (по вкладкам)
- Подсветка критического пути в Master

### Known limitations (unresolved)
- Формульные поля (`Delay_Days`, `Is_Delayed`) нельзя создать через API — нужны через UI
- "4 unscheduled records hidden" в Gantt · Master — это мебельные позиции без дат
- Row colors в Gantt · Master не настроены — сейчас монохромно; можно раскрасить по Phase в UI

---

## 2026-04-22 — Sort_Order + Timeline layout investigation

### Sort_Order field (конструктивная логика сверху→вниз)
- [x] Создано поле `Sort_Order` (number, `fldYsmN9h1m3Safiz`) через Meta API
- [x] `scripts/assign_sort_order.py` присваивает 1..47 по строительной логике (demolition → procurement → MEP rough → floor/ceiling → finishing → furniture → handover)
- [x] Все 47 записей получили Sort_Order batch-PATCH'ем (10/запрос)
- [x] Sort by Sort_Order ASC добавлен в Grid view, Gantt · ФАКТ, Gantt · ПЛАН, Gantt · Master

### Grid view — подтверждён строгий порядок 1..47 ✓
- Sort by Sort_Order ASC работает корректно: 1. демонтажные работы → … → 47. уборка

### Timeline views — НЕ соблюдают Sort_Order ✗
- Проверены **Timeline Stacked**, **Timeline Gantt** (one record per row), **Gantt · Master** (native addon)
- Все три используют собственный auto-layout (пакуют бары по датам/зависимостям), сортировка view игнорируется как primary-key вертикального порядка
- Флип direction (1→9 vs 9→1) меняет порядок внутри «групп» одного диапазона дат — значит sort применяется как secondary, но не primary
- Gantt · ФАКТ переведён в layout **Gantt** (одна запись — одна строка) вместо Stacked — визуально чище, но порядок всё равно auto

### Решение — ждём от пользователя (варианты A/B/C/D)
- **A.** Принять auto-layout (Grid — канон порядка, Timeline — шкала по датам)
- **B.** Выключить auto-sort + вручную drag-reorder 47 записей в Timeline
- **C.** Airtable Interface (Designer) с Timeline-компонентом
- **D.** Внешний Gantt (TeamGantt / GanttPRO / Smartsheet)

---

## 2026-04-22 (late) — Sort_Order пересобран по Start ASC

### Проблема
Старый Sort_Order был по конструктивной фазе, но реальные Start ломают логику «сверху→вниз»:
- «Плитка фоновая» стартует 26.02 (раньше rough) — имела so=27
- «Электроприборы» стартует 02.03 — имел so=41
- «Демонтаж старой стяжки» стартует 09.03 — имел so=3 (слишком высоко)

### Решение
- `scripts/resort_by_start.py`: primary = `Start` ASC, tiebreaker = старый `Sort_Order` (фаза), NO-DATE в конец
- 43 из 47 записей пересчитаны (батчами по 10)
- Теперь Grid 1..47 строго хронологический сверху вниз
- Timeline auto-layout тоже пакует по датам → визуальный порядок совпадёт с Grid

### Визуал «день = клетка»
- В Airtable Timeline zoom-контрол справа сверху: выбрать **Day** или **Week**
- В этом режиме разметка колонок по дням, пустые промежутки читаются как N дней

---

## 2026-04-23 — Phase 2: Telegram-бот задеплоен в n8n Cloud

### Архитектура
- n8n Cloud `grishenkov.app.n8n.cloud` — бот работает здесь (не localhost)
- 3 активных workflow: Main Bot, SchedulePatch (sub), Daily Digest (cron 09:00 UTC)
- Deploy-скрипт: `n8n/scripts/migrate-to-cloud.js` (idempotent, match by name)

### Telegram бот
- `@Cyfr_work_bot` (токен `8770380445:...`)
- Голос → Whisper (`whisper-1`) → текст
- GPT-5 с JSON Schema strict output → 15 интентов:
  mark_complete, mark_started, set_progress, shift_dates, add_delay, add_note, add_task,
  query_status, query_today, query_overdue, query_period, query_section,
  greeting, smalltalk, unknown
- Дополнительно: `suggested_intents` (2–4 fallback) + `clarify_question`
- Диалоговый контекст: последние 5 сообщений из AuditLog (15 мин)

### schedule.json → GitHub → Vercel
- Данные хранятся в `Serhiog/Work-Schedule-Bot/web/schedule.json`
- Мутации через GitHub Contents API (GET→модификация→PUT base64)
- Vercel auto-deploy при каждом push в main

### Реализованные интенты (с подтверждением inline keyboard)
- `mark_complete`, `mark_started` — дата (default: today)
- `set_progress` — 0–100%
- `shift_dates` — ±N дней
- `add_delay` — причина + опционально N дней

### Аналитика (AuditLog + Daily Digest)
- Каждое сообщение → AuditLog: Transcript, Intent, Confidence, LatencyMs, ResultMessage
- Cron 09:00 UTC → GPT-5 анализирует 24ч логов → сводка + рекомендации → Telegram owner

### Airtable bot tables (created 2026-04-23)
- Projects `tblJCAgd956UPBRCn`
- Users `tblDxfO0Fue11EQmp`
- AuditLog `tblWkS72GumLM0Npm`
- PendingConfirmations `tblugbp0O3x6qlxL6`
- SectionOwners `tblXZULUmovkpopnt`

### Скрипты
- `n8n/scripts/create-bot-tables.js` — создал bot tables в Airtable
- `n8n/scripts/extend-auditlog.js` — добавил analysis-поля
- `n8n/scripts/migrate-to-cloud.js` — deploy + credential setup
- `n8n/scripts/create-credentials.js` — утилита создания credentials

---

## 2026-04-23 — create_ticket intent + PlanRadar drawer

### Что сделано

**Web (cyfr-schedule-app.vercel.app):**
- PlanRadar API работает на реальных данных (mock:false)
- Исправлен base URL: `/api/v1/{customer_id}/...` (не `/api/v2/`)
- Drawer: кнопка "➕" → форма создания тикета (title + description)
- Каждая карточка тикета: dropdown смены статуса → PUT в PlanRadar
- Кнопка "↗" открывает тикет в PlanRadar напрямую
- PAT claude-code-2 активен в Vercel env

**n8n Cloud (патч create_ticket):**
- Добавлен intent `create_ticket` в BuildGPTBody (INTENTS + schema: subject, description)
- BuildResponse: обработка create_ticket — fuzzy match → confirm
- SchedulePatch sub-workflow: IF isTicketAction → CreateTicketHTTP → TicketResult
  - Если type=create_ticket: POST https://cyfr-schedule-app.vercel.app/api/planradar
  - Иначе: обычный GitHub mutation

### Ограничение
- Создание тикетов через API требует `PLANRADAR_COMPONENT_ID` (floor plan в проекте)
- Пока компонент не загружен — бот вернёт "Создайте вручную" с ссылкой
- После загрузки плана в PlanRadar и установки PLANRADAR_COMPONENT_ID в Vercel — всё заработает
