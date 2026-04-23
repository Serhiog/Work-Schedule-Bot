# Архитектура — Work Schedule Bot

## Airtable — схема данных

### База: `Work Schedule — Orange Group Office 3.0`

#### Таблица `Tasks` (основная)

| Поле | Тип | Описание |
|------|-----|----------|
| `Name` | Single line text | Название работы (primary) |
| `External ID` | Number | ID из Excel (1–27 для родителей, пусто для подзадач) |
| `Category` | Single select | demolition, electrical, plumbing, fire_safety, hvac, flooring, drywall, finishing, glass, paint, furniture, cleaning, materials |
| `Parent` | Link to Tasks | Родительская работа (для подзадач/материалов) |
| `Subtasks` | Link to Tasks | (обратная ссылка) |
| `Duration (days)` | Number | Длительность в днях |
| `Start` | Date | Дата начала |
| `Finish` | Date | Дата окончания |
| `Status` | Single select | not_started, in_progress, done, delayed, blocked |
| `Depends On` | Link to Tasks | От каких работ зависит (предшественники) |
| `Blocks` | Link to Tasks | (обратная ссылка) — что блокирует эта работа |
| `Contractor` | Single line text | Подрядчик (пока text, потом — link to Contractors) |
| `Notes` | Long text | Заметки |
| `Progress (%)` | Percent | Процент выполнения |

#### Таблица `Holidays`

| Поле | Тип |
|------|-----|
| `Date` | Date (primary) |
| `Reason` | Single line text |

Известные праздничные периоды:
- 20.03.2026 – 22.03.2026
- 26.05.2026 – 29.05.2026
- 16.06.2026

---

## Views (Tasks)

1. **Timeline** — встроенный Gantt по Start/Finish, группировка по Category
2. **Grid — All** — дефолтный список, сортировка по Start
3. **By Category** — сгруппировано по Category
4. **Today** — фильтр: Start ≤ today AND Finish ≥ today
5. **This Week** — overlap с текущей неделей
6. **Overdue** — Finish < today AND Status ≠ done
7. **Hierarchy** — сгруппировано по Parent

---

## Задачи и зависимости (из Excel)

Родительские задачи с последовательностью по датам:

| # | Задача | Start | Finish | Зависит от |
|---|--------|-------|--------|-----------|
| 1 | демонтажные работы | 24.02 | 11.03 | — |
| 2 | вывоз мусора | 26.02 | — | 1 (параллельно) |
| 3 | электромонтажные работы (черновая) | 03.03 | 08.04 | 1 |
| 5 | сантехнические работы (черновая) | 02.03 | 18.04 | 1 |
| 6 | системы пожаробезопасности | — | — | 1 |
| 7 | вентиляция Frost | 06.03 | 22.04 | 1 |
| 17 | демонтаж старой стяжки | 09.03 | 14.03 | 1 |
| 18 | наливной пол | 16.03 | 28.03 | 17 |
| 19 | ГКЛ стены и перегородки | 06.03 | 11.04 | 3, 5, 7 (черновые) |
| 20 | ГКЛ потолки | 30.03 | 13.04 | 19 |
| 21 | штукатурно-малярные работы | 17.03 | 01.04 (позже) | 19, 20 |
| 22 | укладка плитки | 23.04 | 24.04 (?) | 21 |
| 23 | стеклянные перегородки | 21.04 | 11.05 | 21 |
| 24 | покрасочные работы | 31.03 | 19.05 | 21 |
| 4 | установка чистовых электроприборов | **ПЕРЕНЕСТИ** | — | **21, 24** (финиш покраски) |
| 25 | монтаж сантехоборудования | 18.05 | 23.05 | 24, 22 |
| 26 | укладка ковролина | 05.05 | 18.05 | 24 |
| 27 | уборка | — | — | 25, 26, 4 (конец) |

### ⚠ Известная ошибка

**«установка чистовых электроприборов» (id=4)** стоит в Excel как продолжение черновой электрики (id=3), но по логике должна быть **после финишной отделки** (после покраски и плитки). Исправить при миграции.

---

## Алгоритм сдвига (Phase 2)

```
shift_task(task_name, days, cascade=True):
  t = find_task(task_name)
  t.Start += days  (с пропуском holidays если days измеряется в рабочих днях)
  t.Finish = t.Start + t.Duration (также с пропуском holidays)
  if cascade:
    for dep in t.Blocks:  # задачи, которые зависят от t
      if dep.Start < t.Finish:
        delta = t.Finish - dep.Start + 1
        shift_task(dep.name, delta, cascade=True)
```

---

## Интенты бота (Phase 2)

| Intent | Пример | Параметры |
|--------|--------|-----------|
| `shift_task` | «перенеси электромонтажку на 3 дня вперёд» | task, days, direction |
| `query_period` | «что у меня на этой неделе?» | period (today/week/month) |
| `query_overdue` | «что просрочено?» | — |
| `set_status` | «демонтаж закончили» | task, status |
| `report` | «сделай отчёт за неделю» | period |
| `add_note` | «добавь заметку к плитке: заказчик выбрал акцент» | task, note |
