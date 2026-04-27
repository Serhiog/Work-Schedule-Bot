// POST /api/parse-weekly-report
// body: { slug, rawText, tasks: [{id, name, section, planStart, planEnd}] }
// returns: { ok, updates: [{ taskId, action, value, reason }], summary }
//
// updates[].action ∈ { set_progress | mark_complete | mark_started }
// для set_progress — value в долях (0..1)
//
// Использует gpt-5.4-mini.

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.WEEKLY_REPORT_MODEL || 'gpt-5.4-mini';

function bad(res, code, msg, extra = {}) {
  return res.status(code).json({ error: msg, ...extra });
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  if (!OPENAI_KEY) return bad(res, 503, 'OPENAI_API_KEY missing');

  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return bad(res, 400, 'invalid JSON'); }

  const rawText = String(body.rawText || '').trim();
  const tasks = Array.isArray(body.tasks) ? body.tasks : [];
  if (!rawText) return bad(res, 400, 'rawText required');
  if (!tasks.length) return bad(res, 400, 'tasks list required');

  const tasksTable = tasks.map(t => {
    const status = t.actualEnd ? 'завершена' : t.actualStart ? 'в работе' : 'не начата';
    return `id=${t.id} | ${t.name} (раздел: ${t.section}, план: ${t.planStart}..${t.planEnd}, ${status})`;
  }).join('\n');

  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = `Ты — парсер еженедельного отчёта прораба о ходе строительных работ. На входе — голосовой отчёт прораба и список задач из графика.

Твоя задача: извлечь из отчёта обновления по конкретным задачам. Верни СТРОГИЙ JSON:
{
  "updates": [
    { "taskId": "23", "action": "set_progress", "value": 0.20, "reason": "Прораб сказал: стены 20%" },
    { "taskId": "27", "action": "set_progress", "value": 0.30, "reason": "Прораб сказал: потолки 30%" },
    { "taskId": "5",  "action": "mark_complete", "reason": "Закрыли подготовку" },
    { "taskId": "12", "action": "mark_started",  "reason": "Стартовали в понедельник" }
  ]
}

ПРАВИЛА:
1. Если прораб говорит «X процентов» по работе — ставь action=set_progress, value=0..1.
2. Если «закрыли», «сделали», «доделали», «готово» — action=mark_complete.
3. Если «начали», «стартовали», «приступили» — action=mark_started.
4. Объёмы в натуре переводи в %: «уложили 50 квадратов плитки из 86» → set_progress 0.58. Использует qty/unit из списка задач если упомянуто.
5. Если работа НЕ упомянута в отчёте — НЕ возвращай её в updates (фраза «остальное по плану» означает не трогать).
6. Если упоминание неоднозначно (не понятно к какой задаче относится) — НЕ возвращай эту запись, лучше пропустить чем угадать.
7. taskId должен ТОЧНО совпадать с id из списка задач. Если по тексту не нашёл соответствия — не включай в updates.
8. value для set_progress всегда в долях (0..1). 30% → 0.30. «треть» → 0.33. «половина» → 0.50.

Сегодня: ${today}.

Список задач проекта:
${tasksTable}`;

  const userPrompt = `Отчёт прораба:\n«${rawText}»\n\nИзвлеки обновления по задачам.`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 1200,
      }),
    });
    const data = await r.json();
    if (!r.ok) return bad(res, 502, 'OpenAI error', { detail: data });

    const content = data.choices?.[0]?.message?.content || '';
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { return bad(res, 502, 'bad model JSON', { raw: content?.slice(0, 500) }); }

    const updates = Array.isArray(parsed.updates) ? parsed.updates : [];

    // Валидация: убираем записи без валидного taskId или action
    const taskIds = new Set(tasks.map(t => String(t.id)));
    const validActions = new Set(['set_progress', 'mark_complete', 'mark_started']);
    const filtered = updates.filter(u =>
      taskIds.has(String(u.taskId)) && validActions.has(u.action) &&
      (u.action !== 'set_progress' || (typeof u.value === 'number' && u.value >= 0 && u.value <= 1))
    ).map(u => ({
      taskId: String(u.taskId),
      action: u.action,
      value: u.action === 'set_progress' ? Number(u.value) : null,
      reason: String(u.reason || '').slice(0, 200),
    }));

    const taskById = Object.fromEntries(tasks.map(t => [String(t.id), t]));
    const summaryLines = filtered.map(u => {
      const t = taskById[u.taskId];
      const name = t ? t.name : `task ${u.taskId}`;
      if (u.action === 'set_progress') return `📊 «${name}» → ${Math.round(u.value * 100)}%`;
      if (u.action === 'mark_complete') return `✅ «${name}» — закрыта`;
      if (u.action === 'mark_started') return `🟡 «${name}» — стартовала`;
      return `· «${name}»`;
    });

    return res.status(200).json({
      ok: true,
      updates: filtered,
      skipped: updates.length - filtered.length,
      summary: summaryLines.join('\n') || '(ничего не извлечено)',
      meta: { model: MODEL, usage: data.usage || null },
    });
  } catch (e) {
    return bad(res, 500, e.message);
  }
};
