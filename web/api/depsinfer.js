// Автоматический вывод зависимостей между работами через GPT.
//
// POST /api/dependencies-infer
//   body: { slug, scope?: 'all' | 'taskId', taskId?, model? }
//     - scope='all'    — пересчитать все зависимости проекта (заменяет существующие auto-записи)
//     - scope='taskId' — расставить только для одной новой работы (не трогает остальное)
//
// Возвращает: { ok, count, edges: [{taskId, dependsOnTaskId, rationale}] }
//
// Записывает в Airtable TaskDependencies через replaceAll или add.

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.DEPS_INFER_MODEL || 'gpt-5.4-mini';
const APP_HOST = 'https://cyfr-schedule-app.vercel.app';

function bad(res, code, msg) { res.status(code).json({ error: msg }); }

async function fetchSchedule(slug) {
  // Через /api/data?schedule=1 — свежий через GitHub Contents API (минуя 5-минутный кеш raw + статический snapshot Vercel).
  // Это критично для свежесозданных проектов: ParseEstimate коммитит → сразу зовёт depsinfer/matsinfer.
  const r = await fetch(`${APP_HOST}/api/data?slug=${encodeURIComponent(slug)}&schedule=1&t=${Date.now()}`);
  if (!r.ok) throw new Error(`schedule ${slug} not found (${r.status})`);
  const j = await r.json();
  return j && j.schedule ? j.schedule : j;
}

async function callOpenAI(messages) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY not set');
  const isReasoning = /(-pro|-codex|^o\d)/i.test(MODEL);

  if (isReasoning) {
    const input = messages.map((m) => ({ role: m.role, content: m.content }));
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, input, reasoning: { effort: 'medium' } })
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 240)}`);
    const d = await r.json();
    if (d.output_text) return d.output_text;
    const out = (d.output || []).flatMap((o) => (o.content || [])).filter((c) => c.type === 'output_text' || c.type === 'text');
    return out.map((c) => c.text || '').join('\n').trim();
  }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0 })
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 240)}`);
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

function buildSystemPrompt() {
  return [
    'Ты — эксперт по строительному планированию (fit-out офисов в Дубае).',
    'На вход получишь список работ проекта с их разделами и плановыми датами.',
    'Твоя задача — определить технологические зависимости: какие работы нельзя начинать, пока не закончены другие.',
    '',
    'ПРАВИЛА:',
    '1. Зависимость = "работа A не может начаться/идти, пока B физически не готова".',
    '2. Не выдумывай зависимости там, где их нет. Если работа независима — не привязывай её ни к чему.',
    '3. Канонический порядок этапов fit-out:',
    '   Демонтаж → Черновые (электрика/сантехника/вентиляция first-fix) → ГКЛ/Перегородки → Штукатурка/Полы → Чистовые (краска, плитка) → Двери/мебель → Уборка',
    '4. Внутри одного этапа работы могут идти параллельно, если не зависят физически (например, "электрика first-fix" и "сантехника first-fix" обычно параллельны).',
    '5. Зависимость должна вести от завершённой к началу следующей: dependsOnTaskId (ранняя) → taskId (поздняя).',
    '6. Не делай зависимости циклов. Не делай транзитивных дублей: если A→B→C, не пиши ещё A→C.',
    '7. Учитывай разделы (sections) и subcontractor flag (sub: true) — субподрядчик может делать свои работы параллельно с подрядчиком.',
    '',
    'ФОРМАТ ОТВЕТА:',
    'Только JSON-массив, никакого текста до/после. Каждый элемент:',
    '{ "taskId": "<id поздней работы>", "dependsOnTaskId": "<id ранней>", "rationale": "<короткая причина одной фразой>" }',
    '',
    'Пример: [{"taskId":"T15","dependsOnTaskId":"T7","rationale":"Чистовая краска идёт после штукатурки и шпаклёвки"}]'
  ].join('\n');
}

function summarizeTasksForPrompt(tasks, sectionsById) {
  return tasks.map(t => {
    const sec = sectionsById[t.section] || { name: t.section || '?', sub: false };
    return `${t.id}: "${t.name}" · раздел: ${sec.name}${sec.sub ? ' (СУБ)' : ''} · план: ${t.planStart} → ${t.planEnd}`;
  }).join('\n');
}

function buildUserPrompt(schedule, scope, focusTask) {
  const sectionsById = Object.fromEntries((schedule.sections || []).map(s => [s.id, s]));
  const allTasksList = summarizeTasksForPrompt(schedule.tasks || [], sectionsById);

  if (scope === 'taskId' && focusTask) {
    return [
      `ПРОЕКТ: ${schedule.project?.name || schedule.project?.slug || 'unknown'}`,
      ``,
      `СУЩЕСТВУЮЩИЕ РАБОТЫ:`,
      allTasksList,
      ``,
      `НОВАЯ РАБОТА (только для неё определи зависимости):`,
      `${focusTask.id}: "${focusTask.name}" · раздел: ${(sectionsById[focusTask.section] || {}).name || focusTask.section} · план: ${focusTask.planStart} → ${focusTask.planEnd}`,
      ``,
      `Верни JSON-массив зависимостей: либо новая работа зависит от существующих, либо существующие зависят от неё. Не трогай зависимости между другими работами.`
    ].join('\n');
  }
  return [
    `ПРОЕКТ: ${schedule.project?.name || schedule.project?.slug || 'unknown'}`,
    `ДАТЫ: ${schedule.project?.startDate} → ${schedule.project?.endDate}`,
    ``,
    `РАБОТЫ:`,
    allTasksList,
    ``,
    `Верни JSON-массив всех логических зависимостей.`
  ].join('\n');
}

function extractJsonArray(text) {
  const t = String(text || '').trim();
  // Try direct parse
  try { const j = JSON.parse(t); if (Array.isArray(j)) return j; } catch (_) {}
  // Try to find first [...] block
  const m = t.match(/\[[\s\S]*\]/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (_) {}
  }
  // Try ```json ... ``` block
  const f = t.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (f) {
    try { return JSON.parse(f[1]); } catch (_) {}
  }
  return [];
}

function dedupeAndValidate(edges, validIds, focusTaskId) {
  const set = new Set();
  const taskSet = new Set(validIds);
  const out = [];
  for (const e of edges) {
    if (!e || typeof e !== 'object') continue;
    const a = String(e.taskId || '').trim();
    const b = String(e.dependsOnTaskId || '').trim();
    if (!a || !b || a === b) continue;
    if (!taskSet.has(a) || !taskSet.has(b)) continue;
    const k = `${a}|${b}`;
    if (set.has(k)) continue;
    set.add(k);
    out.push({
      taskId: a,
      dependsOnTaskId: b,
      rationale: String(e.rationale || '').slice(0, 200)
    });
  }
  // Cycle removal: simple — if edge introduces cycle, drop it.
  const adj = new Map();
  const safe = [];
  function reachable(from, to) {
    const seen = new Set();
    const stack = [from];
    while (stack.length) {
      const x = stack.pop();
      if (x === to) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      const next = adj.get(x) || [];
      for (const n of next) stack.push(n);
    }
    return false;
  }
  for (const e of out) {
    // Edge: dependsOnTaskId → taskId. Cycle if path already exists from taskId to dependsOnTaskId.
    if (reachable(e.taskId, e.dependsOnTaskId)) continue;
    if (!adj.has(e.dependsOnTaskId)) adj.set(e.dependsOnTaskId, []);
    adj.get(e.dependsOnTaskId).push(e.taskId);
    safe.push(e);
  }
  return safe;
}

async function writeDeps(slug, edges, mode) {
  const url = `${APP_HOST}/api/dependencies`;
  if (mode === 'replaceAll') {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'replaceAll',
        payload: {
          slug,
          edges: edges.map(e => ({ ...e, source: 'auto' }))
        }
      })
    });
    return r.json();
  }
  // Append (one task scope) — add each edge
  const results = [];
  for (const e of edges) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add',
        payload: {
          slug,
          taskId: e.taskId,
          dependsOnTaskId: e.dependsOnTaskId,
          source: 'auto',
          rationale: e.rationale
        }
      })
    });
    results.push(await r.json());
  }
  return { ok: true, added: results.length };
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
    if (!tasks.length) return res.status(200).json({ ok: true, count: 0, edges: [] });

    let focusTask = null;
    if (scope === 'taskId') {
      focusTask = tasks.find(t => t.id === focusTaskId);
      if (!focusTask) return bad(res, 404, `task ${focusTaskId} not found`);
    }

    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(schedule, scope, focusTask) }
    ];
    const text = await callOpenAI(messages);
    const raw = extractJsonArray(text);
    const validIds = tasks.map(t => t.id);
    const edges = dedupeAndValidate(raw, validIds, focusTaskId);

    const writeResult = await writeDeps(slug, edges, scope === 'all' ? 'replaceAll' : 'append');

    return res.status(200).json({
      ok: true,
      count: edges.length,
      edges,
      write: writeResult,
      raw_excerpt: text.slice(0, 500)
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
