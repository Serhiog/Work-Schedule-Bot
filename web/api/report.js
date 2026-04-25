// /api/report — собирает контекст за период, расширяет тезисы через OpenAI,
// пред-загружает выбранные фото и возвращает готовые куски для клиентской сборки PDF.
//
// POST body:
// {
//   slug: 'orange-1801',
//   period: { start: '2026-04-01', end: '2026-04-25' },
//   theses: 'тезисы пользователя…',
//   model:  'gpt-5.4-pro',
//   photos: [{ ticketId, ticketTitle, url }, ...]   // уже выбранные клиентом
// }
//
// Response:
// {
//   html: '<section>...</section>',       // ready-to-render HTML отчёта от LLM
//   photos: [{ ticketTitle, dataUrl }],   // base64-картинки для PDF
//   stats: { tasksChanged, ticketsCreated, ticketsResolved, totalProgress }
// }

const PLANRADAR_BASE = (cust) => `https://www.planradar.com/api/v1/${cust}`;
const PLANRADAR_BASE_V2 = (cust) => `https://www.planradar.com/api/v2/${cust}`;

const GH_OWNER = 'Serhiog';
const GH_REPO = 'Work-Schedule-Bot';

function clampISO(d) { return String(d || '').slice(0, 10); }
function inRange(iso, start, end) { const d = clampISO(iso); return d && d >= start && d <= end; }

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => buf += c);
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')); } catch { resolve({}); } });
  });
}

async function fetchSchedule(slug) {
  const url = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/main/web/schedules/${encodeURIComponent(slug)}.json`;
  const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error(`schedule fetch failed: ${r.status}`);
  return r.json();
}

async function fetchPlanRadarTickets() {
  const apiKey = process.env.PLANRADAR_API_KEY;
  const customerId = process.env.PLANRADAR_CUSTOMER_ID || '1500855';
  const projectId = process.env.PLANRADAR_PROJECT_ID || '1533951';
  if (!apiKey) return [];
  try {
    const r = await fetch(`${PLANRADAR_BASE(customerId)}/projects/${projectId}/tickets/?per_page=200`,
      { headers: { 'X-PlanRadar-API-Key': apiKey, 'Accept': 'application/json' } });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : (d.data || d.tickets || []);
  } catch { return []; }
}

function summarizeContext(schedule, period, tickets) {
  const tasks = schedule?.tasks || [];
  const changedTasks = tasks
    .map((t) => {
      const hist = Array.isArray(t.history) ? t.history : [];
      const periodHist = hist.filter((h) => inRange(h.at, period.start, period.end));
      if (!periodHist.length) return null;
      return {
        id: t.id,
        name: t.name,
        section: t.section,
        progress: typeof t.progress === 'number' ? Math.round(t.progress * 100) : null,
        actualStart: t.actualStart,
        actualEnd: t.actualEnd,
        planStart: t.planStart || t.start,
        planEnd: t.planEnd || t.end,
        events: periodHist.map((h) => ({ at: h.at, by: h.by, type: h.type, summary: h.summary })),
        delays: (t.delays || []).filter((d) => inRange(d.date, period.start, period.end))
      };
    })
    .filter(Boolean);

  const periodTickets = tickets.filter((tk) => {
    const a = tk.attributes || tk;
    const created = clampISO(a['created-at'] || a.createdAt || a.created_at);
    const updated = clampISO(a['updated-at'] || a.updatedAt || a.updated_at);
    return inRange(created, period.start, period.end) || inRange(updated, period.start, period.end);
  }).map((tk) => {
    const a = tk.attributes || tk;
    return {
      subject: a.subject,
      status: a['status-id'] || a.status,
      created: clampISO(a['created-at'] || a.created_at),
      closed: clampISO(a['closed-at']),
      taskHint: (a.subject || '').match(/\[task:(\d+)\]/)?.[1] || null
    };
  });

  const ticketsCreated = periodTickets.length;
  const ticketsResolved = periodTickets.filter((tk) => tk.closed && inRange(tk.closed, period.start, period.end)).length;

  // Overall progress
  const totalProgress = tasks.length
    ? Math.round(tasks.reduce((s, t) => s + (Number(t.progress) || (t.actualEnd ? 1 : 0)), 0) / tasks.length * 100)
    : 0;

  return {
    project: schedule.project,
    sections: schedule.sections,
    changedTasks,
    periodTickets,
    stats: { tasksChanged: changedTasks.length, ticketsCreated, ticketsResolved, totalProgress }
  };
}

function buildPrompt(ctx, theses, period) {
  const sectionMap = {};
  (ctx.sections || []).forEach((s) => { sectionMap[s.id] = s.name; });
  const tasksLines = ctx.changedTasks.slice(0, 60).map((t) => {
    const sec = sectionMap[t.section] || t.section;
    const events = t.events.map((e) => `  ${e.at?.slice(0, 16)?.replace('T', ' ')} · ${e.by} · ${e.summary}`).join('\n');
    const delays = t.delays.length ? `\n  ЗАДЕРЖКИ: ${t.delays.map((d) => `${d.days}д «${d.reason || '—'}»`).join('; ')}` : '';
    return `• [${sec}] «${t.name}» (прогресс ${t.progress}%)\n${events}${delays}`;
  }).join('\n\n');

  const ticketsLines = ctx.periodTickets.slice(0, 30).map((tk) =>
    `• ${tk.subject} (статус: ${tk.status}, создан ${tk.created}${tk.closed ? `, закрыт ${tk.closed}` : ''})`
  ).join('\n');

  const userTheses = (theses || '').trim() || '(пользователь не дал тезисы — построй отчёт только по фактам ниже)';

  return [
    {
      role: 'system',
      content: `Ты — главный инженер CYFR FITOUT, пишешь еженедельный/периодический отчёт клиенту по проекту отделочных работ в Дубае.
Тон: деловой, конкретный, без воды и канцелярита. Пиши на русском.
Структура отчёта (используй именно эти разделы и именно в HTML, без markdown):
<section class="rep-block"><h2>📊 Общий статус</h2>...</section>
<section class="rep-block"><h2>✅ Что сделано за период</h2><ul>...</ul></section>
<section class="rep-block"><h2>🔧 В работе</h2><ul>...</ul></section>
<section class="rep-block"><h2>⚠️ Проблемы и риски</h2>...</section>
<section class="rep-block"><h2>📅 План на следующий период</h2>...</section>

Правила:
- Раздел «Общий статус» — 2-3 предложения, итоговая оценка.
- Списки в HTML <ul><li>, не markdown.
- Если задержка более 3 дней — выдели <strong>red flag</strong>.
- Не выдумывай дат и фактов — используй только то, что в контексте ниже.
- Тезисы клиента обязательно расширь — превращай 3 слова в 33, но без воды; добавляй конкретику из фактов.
- Длина итога: 250-450 слов.`
    },
    {
      role: 'user',
      content: `ПРОЕКТ: ${ctx.project?.name || '—'} (${ctx.project?.code || ''})
ПЕРИОД: ${period.start} → ${period.end}
ОБЩИЙ ПРОГРЕСС: ${ctx.stats.totalProgress}%

ИЗМЕНЕНИЯ В ГРАФИКЕ ЗА ПЕРИОД (${ctx.stats.tasksChanged} задач):
${tasksLines || '(изменений нет)'}

ТИКЕТЫ ЗА ПЕРИОД (создано ${ctx.stats.ticketsCreated}, закрыто ${ctx.stats.ticketsResolved}):
${ticketsLines || '(тикетов нет)'}

ТЕЗИСЫ ОТ ПОЛЬЗОВАТЕЛЯ (раскрой их в полноценный отчёт):
${userTheses}

Напиши отчёт по структуре выше.`
    }
  ];
}

async function callOpenAI(messages, model) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');
  const apiModel = model || 'gpt-5.5-pro';

  // Pro / reasoning models use /v1/responses (chat completions returns 404 "not a chat model")
  const isReasoning = /(-pro|-codex|^o\d)/i.test(apiModel);

  if (isReasoning) {
    // /v1/responses format: input is array of {role, content: string}
    const input = messages.map((m) => ({ role: m.role, content: m.content }));
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: apiModel, input, reasoning: { effort: 'medium' } })
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`OpenAI ${r.status}: ${txt.slice(0, 240)}`);
    }
    const d = await r.json();
    // Responses API: output_text convenience OR walk d.output[].content[].text
    if (d.output_text) return d.output_text;
    const out = (d.output || []).flatMap((o) => (o.content || [])).filter((c) => c.type === 'output_text' || c.type === 'text');
    return out.map((c) => c.text || '').join('\n').trim();
  }

  // Chat-capable models — /v1/chat/completions
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: apiModel, messages, temperature: 0.5 })
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`OpenAI ${r.status}: ${txt.slice(0, 240)}`);
  }
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

async function fetchPhotoAsDataUrl(url) {
  const apiKey = process.env.PLANRADAR_API_KEY;
  try {
    const isPrS3 = /(^|\/\/)(prd-)?planradar[^/]*\.s3[.-][^/]*\.amazonaws\.com/i.test(url) || /defectradar_issue_images/i.test(url);
    const headers = (isPrS3 || !apiKey) ? {} : { 'X-PlanRadar-API-Key': apiKey };
    const r = await fetch(url, { headers });
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    const ct = r.headers.get('content-type') || 'image/jpeg';
    const b64 = Buffer.from(ab).toString('base64');
    return `data:${ct};base64,${b64}`;
  } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await readJsonBody(req);
    const slug = body.slug || 'orange-1801';
    const period = body.period || { start: clampISO(new Date()), end: clampISO(new Date()) };
    const theses = String(body.theses || '');
    const model = body.model || 'gpt-5.4-pro';
    const photoRequests = Array.isArray(body.photos) ? body.photos.slice(0, 30) : [];

    // 1. Schedule + tickets
    const [schedule, tickets] = await Promise.all([
      fetchSchedule(slug),
      fetchPlanRadarTickets()
    ]);

    // 2. Context summary
    const ctx = summarizeContext(schedule, period, tickets);

    // 3. AI расширение тезисов
    const messages = buildPrompt(ctx, theses, period);
    let html = '';
    try {
      html = await callOpenAI(messages, model);
    } catch (e) {
      // Если OpenAI упал — отдаём fallback-HTML с фактами без раскрытия тезисов
      html = `<section class="rep-block"><h2>📊 Общий статус</h2>
        <p>Прогресс по проекту: ${ctx.stats.totalProgress}%. За период с ${period.start} по ${period.end} зафиксировано ${ctx.stats.tasksChanged} изменений в графике, создано ${ctx.stats.ticketsCreated} тикетов, закрыто ${ctx.stats.ticketsResolved}.</p>
        <p style="color:#b00020;font-style:italic">⚠️ AI-расширение временно недоступно: ${(e.message || '').slice(0, 120)}. Текст ниже — голые факты.</p>
        </section>`;
      // Минимальный fallback с фактическими событиями
      if (ctx.changedTasks.length) {
        const items = ctx.changedTasks.slice(0, 20).map((t) => {
          const evs = t.events.map((e) => `<li>${(e.at || '').slice(0, 16).replace('T', ' ')} · ${e.summary}</li>`).join('');
          return `<li><strong>${t.name}</strong><ul>${evs}</ul></li>`;
        }).join('');
        html += `<section class="rep-block"><h2>📋 Изменения за период</h2><ul>${items}</ul></section>`;
      }
    }

    // 4. Pre-fetch photos as dataURLs
    const photos = [];
    for (const pr of photoRequests) {
      const dataUrl = await fetchPhotoAsDataUrl(pr.url);
      if (dataUrl) photos.push({
        ticketTitle: pr.ticketTitle || '',
        taskName: pr.taskName || '',
        dataUrl
      });
    }

    return res.status(200).json({
      ok: true,
      html,
      photos,
      stats: ctx.stats,
      project: { name: ctx.project?.name, code: ctx.project?.code, customer: ctx.project?.customer },
      period
    });
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: (e.stack || '').slice(0, 600) });
  }
};
