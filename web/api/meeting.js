// Vercel serverless function: анализ конспекта Read.ai через GPT-5.4-pro.
// Принимает контекст проекта + список задач + тикетов с уже существующими апдейтами/заметками.
// Возвращает структурированный план изменений (preview), который фронт показывает на подтверждение.

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MEETING_MODEL || 'gpt-5.4-pro';

function bad(res, code, message, extra) {
  res.status(code).json({ error: message, ...(extra || {}) });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  if (!OPENAI_KEY) return bad(res, 500, 'OPENAI_API_KEY env missing');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { return bad(res, 400, 'Invalid JSON'); }
  }
  const { slug, project, transcript, meetingDate, tasks, tickets } = body || {};
  if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 30) {
    return bad(res, 400, 'transcript is required (min 30 chars)');
  }
  if (!Array.isArray(tasks)) return bad(res, 400, 'tasks[] required');

  const projectName = project?.name || project?.code || slug || '—';
  const projectCustomer = project?.customer || '';

  // Собираем компактный контекст для модели
  const tasksCtx = tasks.map((t) => ({
    id: String(t.id),
    name: t.name,
    section: t.section || '',
    stage: t.stage || ''
  }));

  const ticketsCtx = (tickets || []).map((tk) => ({
    id: tk.id,
    task_id: String(tk.task_id || ''),
    title: (tk.title || '').replace(/\[task:\w+\]/gi, '').trim(),
    description: (tk.description || '').replace(/\[task:\w+\]/gi, '').trim(),
    status: tk.status,
    updates: tk.updates || [],
    meeting_notes: tk.meeting_notes || []
  }));

  const systemPrompt = [
    'Ты — ассистент строительного fit-out менеджера. Анализируешь стенограммы планёрок (Read.ai),',
    'находишь упоминания КОНКРЕТНОГО проекта и распределяешь факты по существующим задачам и тикетам.',
    '',
    'ПРАВИЛА:',
    '1. Сначала найди в стенограмме секцию/абзацы про текущий проект. Если проект НЕ упоминается — верни projectFound:false.',
    '2. Извлеки только конкретные факты, решения, проблемы, изменения статуса, договорённости.',
    '3. Игнорируй приветствия, отвлечённые разговоры, повторы, общие фразы.',
    '4. Для каждого факта определи taskId — id задачи из СПИСКА ЗАДАЧ, к которой факт относится по смыслу.',
    '   Если ни одна задача не подходит — пропусти факт.',
    '5. Затем выбери ACTION:',
    '   - "append": факт явно относится к существующему тикету (есть похожая проблема в title/description/updates/meeting_notes).',
    '     Дополни ticketId и текст — но ТОЛЬКО НОВУЮ информацию, не повторяй уже сказанное.',
    '   - "create_ticket": новая проблема/задача в этой задаче, нужен новый тикет (предложи краткое title и описание).',
    '   - "task_note": общая инфа о задаче (статус, прогресс, замечания), не привязанная к конкретному тикету.',
    '6. ДЕДУПЛИКАЦИЯ — критично. Не дублируй то, что уже есть в:',
    '   - description тикета',
    '   - его updates[].text',
    '   - его meeting_notes[].text',
    '   Если факт там уже сказан — пропусти.',
    '7. Текст пиши на русском, кратко (1-3 предложения), по сути, без воды.',
    '',
    'СТРУКТУРА ОТВЕТА (строгий JSON):',
    '{',
    '  "projectFound": true/false,',
    '  "summary": "Короткое описание что обсудили по проекту (1-2 предложения), или null",',
    '  "items": [',
    '    {',
    '      "action": "append" | "create_ticket" | "task_note",',
    '      "taskId": "<id из списка задач>",',
    '      "ticketId": "<id тикета или null если action != append>",',
    '      "newTicketTitle": "<краткое название если create_ticket, иначе null>",',
    '      "text": "<текст заметки/дополнения, 1-3 предложения>",',
    '      "reason": "<краткое обоснование почему сюда (1 фраза)>"',
    '    }',
    '  ]',
    '}',
    '',
    'Если проект не упомянут — верни {"projectFound": false, "summary": null, "items": []}.'
  ].join('\n');

  const userPrompt = [
    `ТЕКУЩИЙ ПРОЕКТ:`,
    `- slug: ${slug}`,
    `- name: ${projectName}`,
    `- customer: ${projectCustomer || '—'}`,
    '',
    `ДАТА ВСТРЕЧИ: ${meetingDate || new Date().toISOString().slice(0, 10)}`,
    '',
    `СПИСОК ЗАДАЧ ПРОЕКТА (id → name [section/stage]):`,
    tasksCtx.map(t => `- ${t.id}: ${t.name} [${t.section}${t.stage ? ' / ' + t.stage : ''}]`).join('\n'),
    '',
    `СУЩЕСТВУЮЩИЕ ТИКЕТЫ:`,
    ticketsCtx.length === 0
      ? '(нет тикетов — все факты будут create_ticket или task_note)'
      : ticketsCtx.map(tk => {
          const upd = tk.updates.length ? '\n   updates: ' + tk.updates.map(u => '— ' + u.text).join(' / ') : '';
          const mn  = tk.meeting_notes.length ? '\n   meeting_notes: ' + tk.meeting_notes.map(m => '— ' + m.text).join(' / ') : '';
          return `- [${tk.id}] task_id=${tk.task_id} status=${tk.status}\n   title: ${tk.title}\n   desc: ${tk.description}${upd}${mn}`;
        }).join('\n\n'),
    '',
    `СТЕНОГРАММА ВСТРЕЧИ:`,
    `"""`,
    transcript.slice(0, 60000), // safety cap
    `"""`,
    '',
    'Извлеки факты по проекту и распредели по задачам/тикетам. Ответ — строгий JSON.'
  ].join('\n');

  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        reasoning: { effort: 'medium' },
        text: { format: { type: 'json_object' } },
        max_output_tokens: 8000
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return bad(res, r.status, 'OpenAI error', { detail: data });
    }

    // Извлекаем text из Responses API
    let outText = '';
    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item?.content && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c?.text) outText += c.text;
            else if (typeof c === 'string') outText += c;
          }
        }
      }
    }
    if (!outText && data.output_text) outText = data.output_text;

    let parsed;
    try {
      parsed = JSON.parse(outText);
    } catch (e) {
      return bad(res, 502, 'Failed to parse model JSON', { raw: outText?.slice(0, 4000) });
    }

    // Валидация структуры
    if (typeof parsed !== 'object' || parsed === null) {
      return bad(res, 502, 'Bad model output shape');
    }
    parsed.items = Array.isArray(parsed.items) ? parsed.items : [];
    parsed.projectFound = !!parsed.projectFound;

    // Возвращаем фронту
    res.status(200).json({
      ok: true,
      meta: {
        model: MODEL,
        usage: data.usage || null
      },
      result: parsed
    });
  } catch (err) {
    console.error('meeting handler error', err);
    bad(res, 500, err.message || 'Server error');
  }
};
