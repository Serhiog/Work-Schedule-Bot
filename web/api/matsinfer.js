// Автоматический подбор материалов для работ через GPT.
//
// POST /api/matsinfer
//   body: { slug, scope?: 'all' | 'taskId', taskId?, model? }
//     - scope='all'    — расставить материалы для всех работ проекта (заменит существующие)
//     - scope='taskId' — только для одной работы (не трогает остальные)
//
// Возвращает: { ok, count, byTask: { [taskId]: [{name, leadTime, rationale, isAi}] } }
//
// Пишет в Airtable TaskMaterials через action 'task-materials:upsert'.

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MATS_INFER_MODEL || 'gpt-5.4';
const APP_HOST = 'https://cyfr-schedule-app.vercel.app';

function bad(res, code, msg) { res.status(code).json({ error: msg }); }

async function fetchSchedule(slug) {
  const r = await fetch(`${APP_HOST}/schedules/${slug}.json`);
  if (!r.ok) throw new Error(`schedule ${slug} not found (${r.status})`);
  return r.json();
}

async function callOpenAI(messages) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY not set');
  const isReasoning = /(-pro|-codex|^o\d)/i.test(MODEL);
  if (isReasoning) {
    const input = messages.map(m => ({ role: m.role, content: m.content }));
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, input, reasoning: { effort: 'low' } })
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 240)}`);
    const d = await r.json();
    if (d.output_text) return d.output_text;
    const out = (d.output || []).flatMap(o => (o.content || [])).filter(c => c.type === 'output_text' || c.type === 'text');
    return out.map(c => c.text || '').join('\n').trim();
  }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.2 })
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 240)}`);
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

function buildSystemPrompt() {
  return [
    'Ты — опытный сметчик отдела снабжения fit-out проектов в Дубае.',
    'Для каждой работы укажи реальные материалы, которые надо закупить. Будь конкретным и щедрым: лучше предложить лишний пункт, чем пропустить очевидный.',
    '',
    'ОБЯЗАТЕЛЬНО:',
    '• Если работа явно требует материалов — НЕ возвращай пустой массив. Думай как сметчик.',
    '• Указывай материалы только из тех, что закупаются под проект (расходники бригады, инструменты — НЕ указываем).',
    '• Имя материала: короткое, конкретное (упомяни тип/толщину/слой если уместно), на русском.',
    '• leadTime — целое число дней, реалистичный срок поставки в Дубае.',
    '• rationale — одна фраза «зачем нужен», на русском.',
    '',
    'ПРИМЕРЫ ПРАВИЛЬНЫХ МАТЕРИАЛОВ ПО ТИПАМ РАБОТ:',
    '— ГКЛ конструкции стен/потолков: ГКЛ листы 12.5мм, металлические профили (CD/UD/CW/UW), саморезы, дюбели, серпянка, шпатлёвка для швов',
    '— Утепление: минеральная вата (плиты 50/100мм), пароизоляция, дюбель-зонты',
    '— Грунтовка: грунтовка глубокого проникновения, малярный валик/кисти (можно опустить — расходники)',
    '— Шпатлёвка: финишная шпатлёвка, стартовая шпатлёвка, малярная сетка, угловые профили',
    '— Шлифовка: шлифовальная сетка/наждак (расходник, можно опустить)',
    '— Покраска стен/потолков: водно-дисперсионная краска (количество в литрах), малярная лента, защитная плёнка',
    '— Штукатурка по маякам: гипсовая штукатурка, маяки штукатурные, грунтовка перед штукатуркой',
    '— Гидроизоляция санузлов: гидроизоляционная мастика, армирующая лента, грунтовка под гидроизоляцию',
    '— Облицовка керамогранитом: керамогранит (м²), плиточный клей C2TE, затирка для швов, крестики',
    '— Наливной пол / стяжка: самонивелирующая смесь, грунтовка для пола, демпферная лента, фиброволокно',
    '— Укладка ковролина: ковролин (м²), клей для ковролина, плинтус, подложка',
    '— Укладка плинтуса: плинтус МДФ/ПВХ, крепёж для плинтуса, заглушки/уголки',
    '— Электрика black/first-fix: кабель силовой ВВГнг (м), кабель ТВ/слаботочный, гофра, подрозетники, монтажные коробки, кабельные лотки/каналы',
    '— Электрика чистовая: розетки, выключатели, светильники, лампы, автоматы, дифавтоматы',
    '— Сантехника черновая: ПВХ трубы канализации, фитинги, металлопластиковые/PEX трубы для воды, фасонные элементы, запорные краны',
    '— Сантехника чистовая: смесители, унитазы, раковины, сифоны, гибкие подводки',
    '— Аксессуары санузлов: держатели, дозаторы, крючки, зеркала',
    '— Стеклянные перегородки: стекло триплекс/закалённое, профили, фурнитура (петли, ручки)',
    '— Двери: дверное полотно, коробка, наличники, доводчик, фурнитура',
    '— Пожарка/FAS: огнестойкий кабель FE180, термокабель, огнезащитные муфты, противопожарные манжеты',
    '— HVAC: фанкоилы, воздуховоды (м), фасонные изделия, теплоизоляция воздуховодов, подвесы, виброизоляторы',
    '— Защита поверхностей: защитная ПВХ-плёнка, ПВХ-листы под линолеум, малярная плёнка, картон',
    '— Подготовительные/демонтажные/уборочные/транспортные/управленческие/чертёжные/сопроводительные/итоговая чистка: материалы НЕ требуются (пустой массив)',
    '',
    'LEAD-TIME ОРИЕНТИРЫ для Дубая:',
    '— Расходники, грунтовка, шпатлёвка, клей: 2-5 дней',
    '— Стандартные ГКЛ, профили, минвата: 3-7 дней',
    '— Краска (большой объём): 5-7 дней',
    '— Локальная плитка: 5-10 дней; импортный керамогранит: 14-28 дней',
    '— Ковролин/ламинат/LVT: 7-14 дней',
    '— Электрика стандарт: 5-10 дней; светильники под спец-проект: 14-21 день',
    '— Стандартная сантехника: 7-14 дней; импортная: 21-35 дней',
    '— Стекло перегородок (резка под размер): 21-28 дней',
    '— Двери, мебель, декор на заказ: 28-60 дней',
    '— HVAC оборудование: 14-30 дней',
    '',
    'Указывай материалы для ВСЕХ работ — независимо от того, завершены они уже или ещё открытые. Это первичное планирование закупок: руководитель должен видеть полную картину, чтобы понять что должно было быть закуплено и на каком этапе.',
    '',
    'ФОРМАТ ОТВЕТА: ТОЛЬКО валидный JSON-массив (без markdown). Каждая работа в массиве, даже если materials пустой:',
    '[{"taskId":"1","materials":[{"name":"...","leadTime":3,"rationale":"..."}]}, {"taskId":"2","materials":[]}]'
  ].join('\n');
}

function summarizeProject(schedule) {
  const p = schedule.project || {};
  return [
    `Проект: ${p.name || schedule.project?.slug || 'unknown'}`,
    `Сроки: ${p.startDate} → ${p.endDate} (${p.durationDays} дн.)`,
    `Стоимость контракта: ${(p.totalIncVat || 0).toLocaleString('ru-RU')} AED`,
    `Локация: ${p.location || 'Дубай, ОАЭ'}`
  ].join('\n');
}

function summarizeTasks(tasks, sectionsById) {
  return tasks.map(t => {
    const sec = sectionsById[t.section] || { name: t.section || '?' };
    const cost = Number(t.costIncVat) || 0;
    return `[${t.id}] "${t.name}"` +
           ` · раздел: ${sec.name}` +
           ` · ${t.planStart}→${t.planEnd}` +
           (cost ? ` · ${cost.toLocaleString('ru-RU')} AED` : '');
  }).join('\n');
}

function buildUserPrompt(schedule, scope, focusTask) {
  const sectionsById = Object.fromEntries((schedule.sections || []).map(s => [s.id, s]));

  if (scope === 'taskId' && focusTask) {
    return [
      summarizeProject(schedule),
      '',
      `НОВАЯ РАБОТА (только для неё подбери материалы):`,
      `[${focusTask.id}] "${focusTask.name}"` +
        ` · раздел: ${(sectionsById[focusTask.section] || {}).name || focusTask.section}` +
        ` · ${focusTask.planStart}→${focusTask.planEnd}` +
        (focusTask.costIncVat ? ` · ${(Number(focusTask.costIncVat)||0).toLocaleString('ru-RU')} AED` : ''),
      '',
      'Верни массив с одним элементом для этой работы.'
    ].join('\n');
  }

  return [
    summarizeProject(schedule),
    '',
    `СПИСОК РАБОТ (${(schedule.tasks || []).length} штук):`,
    summarizeTasks(schedule.tasks || [], sectionsById),
    '',
    'Подбери материалы для каждой работы из списка.'
  ].join('\n');
}

function extractJsonArray(text) {
  const t = String(text || '').trim();
  try { const j = JSON.parse(t); if (Array.isArray(j)) return j; } catch (_) {}
  const m = t.match(/\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  const f = t.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (f) { try { return JSON.parse(f[1]); } catch (_) {} }
  return [];
}

function validateAndShape(raw, validIds) {
  const idSet = new Set(validIds.map(String));
  const byTask = {};
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const tid = String(entry.taskId || '');
    if (!tid || !idSet.has(tid)) continue;
    const list = Array.isArray(entry.materials) ? entry.materials : [];
    byTask[tid] = list.map(m => ({
      name: String(m.name || '').slice(0, 200).trim(),
      leadTime: Math.max(0, Math.min(120, Math.round(Number(m.leadTime) || 0))),
      rationale: String(m.rationale || '').slice(0, 200).trim(),
      isAi: true,
      ordered: false,
      expectedDate: '',
      note: ''
    })).filter(m => m.name);
  }
  return byTask;
}

async function writeMaterials(slug, byTask) {
  const url = `${APP_HOST}/api/data`;
  let written = 0;
  for (const [taskId, materials] of Object.entries(byTask)) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'task-materials:upsert',
        payload: { taskId, slug, materials }
      })
    });
    if (r.ok) written++;
  }
  return written;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return bad(res, 405, 'POST only');

  try {
    const body = req.body || {};
    const slug = body.slug;
    const scope = body.scope === 'taskId' ? 'taskId' : 'all';
    const focusTaskId = body.taskId;
    if (!slug) return bad(res, 400, 'slug required');

    const schedule = await fetchSchedule(slug);
    const tasks = schedule.tasks || [];
    if (!tasks.length) return res.status(200).json({ ok: true, count: 0, byTask: {} });

    let focusTask = null;
    if (scope === 'taskId') {
      focusTask = tasks.find(t => String(t.id) === String(focusTaskId));
      if (!focusTask) return bad(res, 404, `task ${focusTaskId} not found`);
    }

    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(schedule, scope, focusTask) }
    ];
    const text = await callOpenAI(messages);
    const raw = extractJsonArray(text);
    const validIds = scope === 'taskId' ? [String(focusTask.id)] : tasks.map(t => String(t.id));
    const byTask = validateAndShape(raw, validIds);

    // Count materials
    let totalMats = 0;
    for (const arr of Object.values(byTask)) totalMats += arr.length;

    const written = await writeMaterials(slug, byTask);

    return res.status(200).json({
      ok: true,
      tasksWithMaterials: Object.keys(byTask).length,
      totalMaterials: totalMats,
      written,
      byTask,
      raw_excerpt: text.slice(0, 400)
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
