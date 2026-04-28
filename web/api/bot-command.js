// Bot command parser & executor.
// Принимает text/voice-transcript от Telegram бота, классифицирует через GPT-5.4-pro,
// применяет к Airtable через /api/data, возвращает короткий ответ для бота.
//
// POST /api/bot-command
// body: { slug, text, chatId? }
// → { ok, replyHtml, action, applied }
//
// Поддерживает естественные формулировки:
//   • «по тикету T001 апдейт: подрядчик подтвердил»
//   • «назначь Антона М. на тикет T003»
//   • «по задаче 18 заказали плитку»
//   • «на работу 5 нужно 3 маляра»
//   • «что в риске?», «что сегодня в работе?»

const OPENAI_KEY = process.env.OPENAI_API_KEY;
// Дефолт — стандартная gpt-5.4 (не -pro), reasoning тут оверкилл для intent-классификации.
// Можно переопределить через BOT_COMMAND_MODEL, например 'gpt-4o-mini' (ещё дешевле).
const MODEL = process.env.BOT_COMMAND_MODEL || 'gpt-5.4-mini';
const APP_HOST = 'https://cyfr-schedule-app.vercel.app';

const ASSIGNEES = ['Александр', 'Андрей', 'Антон П.', 'Антон М.'];
const RESOURCE_TYPES = ['workers', 'plumbers', 'electricians', 'hvac_installers', 'fire_techs',
  'gypsum_workers', 'painters', 'tilers', 'floor_layers', 'carpenters', 'door_installers',
  'glass_installers', 'movers', 'cleaners', 'subcontractors'];

function bad(res, code, msg, extra) { res.status(code).json({ error: msg, ...(extra || {}) }); }

async function fetchProjectData(slug) {
  const r = await fetch(`${APP_HOST}/api/data?slug=${encodeURIComponent(slug)}`);
  return r.json();
}
async function fetchOperational(slug) {
  const r = await fetch(`${APP_HOST}/api/operational?slug=${encodeURIComponent(slug)}`);
  return r.json();
}
async function fetchSchedule(slug) {
  const r = await fetch(`${APP_HOST}/schedules/${slug}.json`);
  if (!r.ok) return null;
  return r.json();
}
async function postData(action, payload) {
  const r = await fetch(`${APP_HOST}/api/data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function escapeHtmlSimple(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function classify(text, ctx) {
  const systemPrompt = [
    'Ты — парсер команд для строительного project-management бота.',
    'Распознай намерение русскоязычной фразы и верни СТРОГИЙ JSON.',
    '',
    'Доступные команды:',
    '1. add_ticket_update    — пользователь добавляет апдейт к существующему тикету',
    '   → { action:"add_ticket_update", ticketId, text }',
    '',
    '2. set_ticket_assignees — назначить ответственных на тикет (1–4 человека)',
    '   Имена ОБЯЗАТЕЛЬНО из списка: Александр, Андрей, "Антон П.", "Антон М." (с точкой).',
    '   → { action:"set_ticket_assignees", ticketId, names:[...] }',
    '',
    '3. mark_material_ordered — пометить материалы задачи как заказанные',
    '   Если не уточнено что заказали — ставит ordered=true для ВСЕХ материалов задачи.',
    '   → { action:"mark_material_ordered", taskId, materialNames:[...] | null }',
    '',
    '4. set_task_resources   — задать команду на задачу',
    '   resourceType из: workers, plumbers, electricians, hvac_installers, fire_techs,',
    '   gypsum_workers, painters, tilers, floor_layers, carpenters, door_installers,',
    '   glass_installers, movers, cleaners, subcontractors.',
    '   subcontractors = «субподрядчики» (внешняя бригада, не штатные).',
    '   → { action:"set_task_resources", taskId, resources:[{type, count}, ...] }',
    '',
    '5. add_task_meeting_note — добавить заметку к работе (не к тикету)',
    '   → { action:"add_task_meeting_note", taskId, text }',
    '',
    '6. query_status — пользователь спрашивает статус, риски, активные задачи, прогресс',
    '   → { action:"query_status", topic:"materials"|"active"|"resources"|"progress"|"general" }',
    '',
    '7. rename_task — переименовать работу',
    '   Примеры: «Переименуй задачу 5 в монтаж керамогранита», «Работу 18 назови чистка вентиляции».',
    '   → { action:"rename_task", taskId, newName }',
    '',
    '8. shift_task_dates — сдвинуть даты работы на N дней (план или факт)',
    '   Примеры: «Сдвинь укладку плитки на 3 дня вперёд», «Перенеси демонтаж на неделю позже»,',
    '   «Факт по покраске сдвинь на 2 дня раньше».',
    '   deltaDays: положительное = вперёд, отрицательное = назад. kind: "plan" (по умолчанию) или "fact".',
    '   → { action:"shift_task_dates", taskId, deltaDays, kind:"plan"|"fact" }',
    '',
    '9. set_task_dates — задать конкретные даты работе',
    '   Примеры: «У плитки старт 5 мая, финиш 12 мая», «Демонтаж: фактически начали 28 апреля».',
    '   ISO YYYY-MM-DD. Поля любые из: planStart, planEnd, actualStart, actualEnd.',
    '   → { action:"set_task_dates", taskId, dates:{planStart?, planEnd?, actualStart?, actualEnd?} }',
    '',
    '10. delete_task — удалить работу',
    '    Пример: «Удали работу 34».',
    '    → { action:"delete_task", taskId }',
    '',
    '11. add_section — создать новый раздел в проекте',
    '    Пример: «Добавь раздел Декорирование», «Создай раздел субподрядчиков Слаботочные системы».',
    '    color по умолчанию задаст система.',
    '    → { action:"add_section", name, sub?:boolean }',
    '',
    '12. delete_project — удалить ТЕКУЩИЙ проект полностью (schedule.json + Airtable)',
    '    Только если пользователь явно сказал «удали проект» / «снеси проект» / «обнули проект».',
    '    Требует, чтобы ОН ЯВНО назвал имя проекта в фразе для безопасности (передавай в confirmName).',
    '    Пример: «Удали проект Офис JLT Cluster X».',
    '    → { action:"delete_project", confirmName }',
    '',
    '13. unknown — фраза не относится к бот-командам',
    '    → { action:"unknown", reason }',
    '',
    'СПИСОК ТИКЕТОВ ПРОЕКТА (id → краткое название):',
    ctx.ticketsList || '(тикетов нет)',
    '',
    'СПИСОК ЗАДАЧ ПРОЕКТА (id → название):',
    ctx.tasksList || '(нет)',
    '',
    'Верни СТРОГИЙ JSON одной командой. Если в фразе несколько команд — выбери самую явную.'
  ].join('\n');

  const isReasoning = /-pro\b/.test(MODEL) || /^o\d/.test(MODEL);
  const r = await fetch(
    isReasoning ? 'https://api.openai.com/v1/responses' : 'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(isReasoning ? {
        model: MODEL,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        reasoning: { effort: 'medium' },
        text: { format: { type: 'json_object' } },
        max_output_tokens: 600
      } : {
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 600
      })
    }
  );
  const data = await r.json();
  if (!r.ok) throw new Error(`OpenAI: ${JSON.stringify(data).slice(0, 400)}`);

  let outText = '';
  if (isReasoning) {
    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item?.content) for (const c of item.content) {
          if (c?.text) outText += c.text;
        }
      }
    }
    if (!outText && data.output_text) outText = data.output_text;
  } else {
    outText = data.choices?.[0]?.message?.content || '';
  }
  return JSON.parse(outText);
}

module.exports = async function handler(req, res) {
  if (!OPENAI_KEY) return bad(res, 500, 'OPENAI_API_KEY env missing');
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { return bad(res, 400, 'Invalid JSON'); }
  }
  const { slug, text } = body || {};
  if (!slug || !text) return bad(res, 400, 'slug and text required');

  try {
    // Build context for classifier
    const [op, schedule] = await Promise.all([fetchOperational(slug), fetchSchedule(slug)]);
    const tasks = schedule?.tasks || [];
    const tasksList = tasks.slice(0, 60)
      .map(t => `- ${t.id}: ${t.name}`).join('\n');
    // Need tickets list — fetch via planradar
    const trRes = await fetch(`${APP_HOST}/api/planradar`);
    const trData = await trRes.json().catch(() => ({}));
    const tickets = trData.tickets || [];
    const ticketsList = tickets.slice(0, 60)
      .map(tk => `- ${tk.id}: ${(tk.title || '').replace(/\[task:\w+\]/gi, '').trim().slice(0, 80)}`).join('\n');

    const cmd = await classify(text, { tasksList, ticketsList });

    let replyHtml = '';
    let applied = false;
    let action = cmd.action;

    switch (cmd.action) {
      case 'add_ticket_update': {
        if (!cmd.ticketId || !cmd.text) { replyHtml = '⚠️ Не понял к какому тикету или что писать.'; break; }
        await postData('update:add', { ticketId: cmd.ticketId, slug, text: cmd.text });
        replyHtml = `✅ Апдейт добавлен к тикету <b>${cmd.ticketId}</b>:\n<i>${cmd.text}</i>`;
        applied = true; break;
      }
      case 'set_ticket_assignees': {
        if (!cmd.ticketId || !Array.isArray(cmd.names)) { replyHtml = '⚠️ Не понял кого и на какой тикет.'; break; }
        const valid = cmd.names.filter(n => ASSIGNEES.includes(n));
        if (!valid.length) { replyHtml = `⚠️ Имена не распознаны. Доступны: ${ASSIGNEES.join(', ')}.`; break; }
        await postData('assignees:set', { ticketId: cmd.ticketId, slug, names: valid });
        replyHtml = `✅ Тикет <b>${cmd.ticketId}</b> назначен на: <b>${valid.join(', ')}</b>`;
        applied = true; break;
      }
      case 'mark_material_ordered': {
        if (!cmd.taskId) { replyHtml = '⚠️ Не понял на какой задаче.'; break; }
        // GET current materials, mark relevant as ordered, upsert
        const dataR = await fetch(`${APP_HOST}/api/data?slug=${encodeURIComponent(slug)}`);
        const dataJson = await dataR.json();
        let mats = dataJson?.data?.taskMaterials?.[String(cmd.taskId)] || [];
        if (!mats.length) {
          // populate from defaults via GET operational? Easier: take from default schedule via section
          const t = tasks.find(x => String(x.id) === String(cmd.taskId));
          if (t) {
            const opData = op?.ok ? op : null;
            // use operational risky data as hint, but we'll just mark all as ordered=true via a synthetic list
            // simplest: let user do nothing if no materials — we need defaults loaded.
            // Approach: send dummy upsert that just creates ordered=true for whatever we know
            mats = []; // no override
          }
        }
        const targetNames = Array.isArray(cmd.materialNames) && cmd.materialNames.length
          ? cmd.materialNames.map(s => s.toLowerCase())
          : null;
        const updated = mats.map(m => {
          const match = !targetNames || targetNames.some(n => (m.name || '').toLowerCase().includes(n));
          return match ? { ...m, ordered: true } : m;
        });
        if (!updated.length) {
          replyHtml = `ℹ️ У задачи <b>${cmd.taskId}</b> нет настроенных материалов. Открой задачу на сайте и заполни список.`;
          break;
        }
        await postData('task-materials:upsert', { taskId: String(cmd.taskId), slug, materials: updated });
        const cnt = updated.filter(m => m.ordered).length;
        replyHtml = `✅ По задаче <b>${cmd.taskId}</b> отмечено как заказано: <b>${cnt}</b> материалов.`;
        applied = true; break;
      }
      case 'set_task_resources': {
        if (!cmd.taskId || !Array.isArray(cmd.resources)) { replyHtml = '⚠️ Не понял состав команды.'; break; }
        const valid = cmd.resources.filter(r => RESOURCE_TYPES.includes(r.type) && Number(r.count) > 0);
        if (!valid.length) { replyHtml = `⚠️ Тип специалиста не распознан.`; break; }
        await postData('task-resources:upsert', { taskId: String(cmd.taskId), slug, resources: valid });
        const summary = valid.map(r => `${r.type}×${r.count}`).join(', ');
        replyHtml = `✅ На задачу <b>${cmd.taskId}</b> назначено: <b>${summary}</b>`;
        applied = true; break;
      }
      case 'add_task_meeting_note': {
        if (!cmd.taskId || !cmd.text) { replyHtml = '⚠️ Не понял к какой задаче или что записать.'; break; }
        await postData('task-note:add', { taskId: String(cmd.taskId), slug, text: cmd.text });
        replyHtml = `✅ Заметка добавлена к работе <b>${cmd.taskId}</b>.`;
        applied = true; break;
      }
      case 'query_status': {
        if (!op?.ok) { replyHtml = '⚠️ Не удалось получить статус.'; break; }
        if (cmd.topic === 'materials') {
          if (!op.riskyMaterials.length) replyHtml = '✅ Материалы под контролем — рисков нет.';
          else replyHtml = `<b>📦 В риске (${op.riskyMaterials.length}):</b>\n` +
            op.riskyMaterials.slice(0, 8).map(r => `• <b>${r.taskName}</b> — ${r.overdueDays > 0 ? '🔴 сегодня!' : 'до ' + r.orderBy}`).join('\n');
        } else if (cmd.topic === 'active') {
          if (!op.activeTasks.length) replyHtml = '<i>Активных задач сейчас нет.</i>';
          else replyHtml = `<b>В работе (${op.activeTasks.length}):</b>\n` +
            op.activeTasks.slice(0, 10).map(t => `• ${t.taskName} · ${t.daysLeft <= 0 ? '🔴 просрочка' : t.daysLeft + ' дн.'}`).join('\n');
        } else if (cmd.topic === 'resources') {
          replyHtml = `👥 Сегодня по плану: <b>${op.resourcePeak.todayPeople} чел.</b>\nПик: <b>${op.resourcePeak.peak} чел.</b> на ${op.resourcePeak.peakDate || '—'}`;
        } else {
          replyHtml = op.summaryHtml || '<i>Нет данных</i>';
        }
        break;
      }
      case 'rename_task': {
        if (!cmd.taskId || !cmd.newName) { replyHtml = '⚠️ Не понял какую работу и как назвать.'; break; }
        const t = tasks.find(x => String(x.id) === String(cmd.taskId));
        if (!t) { replyHtml = `⚠️ Работа <b>${cmd.taskId}</b> не найдена.`; break; }
        await postData('task:update', { slug, taskId: String(cmd.taskId), patch: { name: String(cmd.newName).slice(0, 200) } });
        replyHtml = `✅ Работа <b>${cmd.taskId}</b> переименована: «${escapeHtmlSimple(t.name)}» → <b>«${escapeHtmlSimple(cmd.newName)}»</b>`;
        applied = true; break;
      }
      case 'shift_task_dates': {
        if (!cmd.taskId || !Number.isFinite(Number(cmd.deltaDays))) { replyHtml = '⚠️ Не понял какую работу и на сколько дней.'; break; }
        const t = tasks.find(x => String(x.id) === String(cmd.taskId));
        if (!t) { replyHtml = `⚠️ Работа <b>${cmd.taskId}</b> не найдена.`; break; }
        const delta = Math.round(Number(cmd.deltaDays));
        const kind = cmd.kind === 'fact' ? 'fact' : 'plan';
        await postData('task:bulk-shift', { slug, taskIds: [String(cmd.taskId)], deltaDays: delta, kind });
        const sign = delta > 0 ? '+' : '';
        replyHtml = `✅ Работа <b>${cmd.taskId}</b> «${escapeHtmlSimple(t.name)}»: ${kind === 'fact' ? 'факт' : 'план'} сдвинут на <b>${sign}${delta} дн.</b>`;
        applied = true; break;
      }
      case 'set_task_dates': {
        if (!cmd.taskId || !cmd.dates || typeof cmd.dates !== 'object') { replyHtml = '⚠️ Не понял какую работу и какие даты.'; break; }
        const t = tasks.find(x => String(x.id) === String(cmd.taskId));
        if (!t) { replyHtml = `⚠️ Работа <b>${cmd.taskId}</b> не найдена.`; break; }
        const allowed = ['planStart','planEnd','actualStart','actualEnd'];
        const patch = {};
        for (const k of allowed) {
          if (cmd.dates[k] && /^\d{4}-\d{2}-\d{2}$/.test(cmd.dates[k])) patch[k] = cmd.dates[k];
        }
        if (!Object.keys(patch).length) { replyHtml = '⚠️ Даты в неверном формате (нужно YYYY-MM-DD).'; break; }
        await postData('task:update', { slug, taskId: String(cmd.taskId), patch });
        const summary = Object.entries(patch).map(([k,v]) => `${k}=${v}`).join(', ');
        replyHtml = `✅ Работа <b>${cmd.taskId}</b> «${escapeHtmlSimple(t.name)}»: ${summary}`;
        applied = true; break;
      }
      case 'delete_task': {
        if (!cmd.taskId) { replyHtml = '⚠️ Не понял какую работу удалить.'; break; }
        const t = tasks.find(x => String(x.id) === String(cmd.taskId));
        if (!t) { replyHtml = `⚠️ Работа <b>${cmd.taskId}</b> не найдена.`; break; }
        await postData('task:delete', { slug, taskId: String(cmd.taskId) });
        replyHtml = `✅ Работа <b>${cmd.taskId}</b> «${escapeHtmlSimple(t.name)}» удалена.`;
        applied = true; break;
      }
      case 'add_section': {
        if (!cmd.name) { replyHtml = '⚠️ Не понял название раздела.'; break; }
        const colors = ['#ef4444','#f59e0b','#84cc16','#10b981','#06b6d4','#6366f1','#8b5cf6','#ec4899'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const r = await postData('section:create', { slug, name: String(cmd.name).slice(0, 80), color, sub: !!cmd.sub });
        replyHtml = `✅ Раздел <b>«${escapeHtmlSimple(cmd.name)}»</b> создан${cmd.sub ? ' (субподрядчик)' : ''}.`;
        applied = true; break;
      }
      case 'delete_project': {
        const projName = schedule?.project?.name || '';
        if (!cmd.confirmName) {
          replyHtml = `⚠️ Опасное действие. Чтобы удалить, повтори фразой с явным именем проекта, например: «Удали проект ${projName}».`;
          break;
        }
        if (String(cmd.confirmName).trim().toLowerCase() !== projName.trim().toLowerCase()) {
          replyHtml = `⚠️ Имя не совпало. Текущий проект: <b>${escapeHtmlSimple(projName)}</b>. Скажи это имя точно — иначе не удалю.`;
          break;
        }
        const r = await postData('project:delete', { slug, confirmName: cmd.confirmName });
        replyHtml = `🗑 Проект <b>«${escapeHtmlSimple(projName)}»</b> удалён.\nschedule.json — ✓\nAirtable — ${r?.result?.airtableDeleted ?? 0} записей.`;
        applied = true; break;
      }
      case 'unknown':
      default:
        replyHtml = `🤷 Не разобрал команду: <i>${(cmd.reason || '').slice(0, 200)}</i>\n\n<b>Можно так:</b>\n• «По тикету T001 апдейт: подрядчик подтвердил»\n• «Назначь Александра на тикет T003»\n• «По задаче 18 заказали плитку»\n• «На работу 5 нужно 3 маляра»\n• «Сдвинь укладку плитки на 3 дня вперёд»\n• «Переименуй работу 18 в чистка вентиляции»\n• «Добавь раздел Декорирование»\n• «Что в риске?»`;
        break;
    }

    res.status(200).json({ ok: true, action, applied, replyHtml, parsed: cmd });
  } catch (e) {
    console.error('bot-command error', e);
    return bad(res, 500, e.message || 'Server error');
  }
};
