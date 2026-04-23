# Work Schedule Bot — Orange Group Office 3.0

Telegram-бот с голосовым управлением графиком работ подрядчиков.
Первый пилот: офис Orange Group 3.0, Dubai. Окно работ: 21.02.2026 → 30.06.2026.

---

## Цели

1. **Фаза 1 (текущая):** перенести существующий Excel-график в Airtable. Красивый Gantt/Timeline view.
2. **Фаза 2:** Telegram-бот
   - Voice (Whisper) → интент
   - Сдвиг задач + каскад по зависимостям
   - Запросы: «что на сегодня / эту неделю / месяц?»
   - Отчёты
3. **Фаза 3:** доступ для нескольких пользователей, роли.

---

## Стек

- **n8n** (cloud, НЕ localhost) — бэкенд и оркестратор
- **Airtable** (отдельная база, не CYFR SLC-SEDA) — хранение и UI графика
- **OpenAI** — Whisper + GPT (tool use для разбора интентов)
- **Telegram Bot API**
- **Claude Code + VS Code** — разработка

---

## Контекст-файлы (читать перед работой)

- `context/arch.md` — схема данных Airtable, зависимости, алгоритм сдвига
- `context/ids.md` — IDs баз/таблиц, токены (не коммитить секреты!)
- `context/todo.md` — pending задачи с приоритетами
- `context/done.md` — выполненные задачи
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

## Phase 1 — план

1. [x] Распарсить Excel → JSON (`scripts/extract_tasks.py`)
2. [ ] Получить Airtable PAT с правами `data.records:write`, `schema.bases:write`
3. [ ] Создать базу «Work Schedule» в workspace пользователя
4. [ ] Создать таблицы: Tasks, Holidays, (опц.) Contractors
5. [ ] Залить данные через API
6. [ ] Настроить views: Timeline, Grid, «Сегодня», «Эта неделя», «Просрочено»
7. [ ] Зафиксировать зависимости (Depends On) на основе фактических дат Excel
8. [ ] Исправить ошибку: «установка чистовых электроприборов» → после штукатурно-малярных

---

## Phase 2 — набросок

- n8n workflow: Telegram Trigger (voice) → Whisper → LLM (tool use) → Airtable (GET/PATCH) → Telegram reply
- Tools: `shift_task`, `query_tasks_by_period`, `get_overdue`, `report_week`
- Сдвиг: пересчитать Finish учитывая Holidays + каскад на Depends On
