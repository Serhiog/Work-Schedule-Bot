// Точечный ежедневный пинг прорабам: только события сегодня (старты, финиши, просрочки, midpoint).
// Если событий нет — никому не пишем (тихий день = тишина).
// Cron: 09:00 Дубай = 05:00 UTC, ежедневно.

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AT_PAT = process.env.AIRTABLE_PAT;
const AT_BASE = 'apph1Z1U3OU2gBvnL';
const AT_USERS = 'tblDxfO0Fue11EQmp';
const APP_HOST = 'https://cyfr-schedule-app.vercel.app';

function isoToday() { return new Date().toISOString().slice(0, 10); }
function fmtRu(iso) { const d = new Date(iso); return d.toLocaleDateString('ru-RU', { day:'numeric', month:'short', timeZone:'UTC' }); }
function diffDays(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

async function fetchSchedule(slug) {
  const r = await fetch(`${APP_HOST}/schedules/${slug}.json?t=${Date.now()}`);
  if (!r.ok) throw new Error(`schedule ${slug} not found`);
  return r.json();
}

async function listForemen() {
  if (!AT_PAT) return [];
  const r = await fetch(
    `https://api.airtable.com/v0/${AT_BASE}/${AT_USERS}?filterByFormula=` +
    encodeURIComponent(`AND({Active}=TRUE(), OR({Role}='foreman', {Role}='owner', {Role}='admin', {Role}='pm'))`),
    { headers: { 'Authorization': `Bearer ${AT_PAT}` } }
  );
  if (!r.ok) return [];
  const d = await r.json();
  return (d.records || []).map(rec => ({
    chatId: rec.fields.TelegramUserId,
    name: rec.fields.Name || rec.fields.TelegramUsername || '',
    role: rec.fields.Role,
  })).filter(u => u.chatId);
}

function buildEvents(schedule, today) {
  const sectionsById = Object.fromEntries(schedule.sections.map(s => [s.id, s.name]));
  const tasks = (schedule.tasks || []).filter(t => !t.actualEnd);

  // Фоновые «сквозные» работы (транспорт, вывоз мусора, сопровождение) — пинговать бессмысленно.
  // Эвристика: работа фоновая если её длительность ≥ 50% длительности проекта.
  const projDur = Math.max(1, diffDays(schedule.project.startDate, schedule.project.endDate) + 1);
  const isBackground = (t) => {
    const taskDur = Math.max(1, diffDays(t.planStart, t.planEnd) + 1);
    return taskDur >= projDur * 0.5;
  };

  const startingToday = [];
  const endingToday = [];
  const overdueAny = [];
  const inProgressNoPct = [];  // активные, не фоновые, без отчёта по %

  for (const t of tasks) {
    if (isBackground(t)) continue; // фоновые пропускаем целиком
    const ps = t.planStart;
    const pe = t.planEnd;
    if (ps === today && !t.actualStart) startingToday.push(t);
    if (pe === today) endingToday.push(t);
    if (pe < today && !t.actualEnd) {
      overdueAny.push({ t, days: diffDays(pe, today) });
      continue; // в просрочке — отдельная категория, в midpoint не дублируем
    }
    if (t.actualStart && pe > today) {
      const noProgressYet = typeof t.progress !== 'number' || t.progress === 0 || t.progress === 0.01;
      if (noProgressYet) inProgressNoPct.push(t);
    }
  }

  const eventsCount = startingToday.length + endingToday.length + overdueAny.length + inProgressNoPct.length;
  if (!eventsCount) return null;

  const sec = (t) => sectionsById[t.section] || t.section;
  const parts = [`📅 <b>Сегодня по графику</b> · <i>${fmtRu(today)}</i>`, ''];

  if (startingToday.length) {
    parts.push('🟢 <b>Должны стартовать:</b>');
    for (const t of startingToday) parts.push(`  • <b>${t.name}</b> <i>(${sec(t)})</i>`);
    parts.push('');
  }
  if (endingToday.length) {
    parts.push('🏁 <b>Должны закрыться:</b>');
    for (const t of endingToday) parts.push(`  • <b>${t.name}</b> <i>(${sec(t)})</i>`);
    parts.push('');
  }
  if (overdueAny.length) {
    parts.push('🔴 <b>В просрочке:</b>');
    for (const { t, days } of overdueAny.slice(0, 8)) parts.push(`  • <b>${t.name}</b> · +${days} дн. <i>(${sec(t)})</i>`);
    if (overdueAny.length > 8) parts.push(`  • …и ещё ${overdueAny.length - 8}`);
    parts.push('');
  }
  if (inProgressNoPct.length) {
    parts.push('📊 <b>В работе — сколько % сейчас?</b>');
    for (const t of inProgressNoPct.slice(0, 8)) parts.push(`  • <b>${t.name}</b> <i>(${sec(t)})</i>`);
    if (inProgressNoPct.length > 8) parts.push(`  • …и ещё ${inProgressNoPct.length - 8}`);
    parts.push('');
  }
  parts.push('🎤 <b>Запиши голосовым</b>: что стартовало, что закрылось, какие %, причины задержек. Бот разберёт и применит.');
  return parts.join('\n');
}

async function sendTG(chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  const d = await r.json();
  return { ok: r.ok && d.ok, error: d.description || null };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!TG_TOKEN) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN missing' });

  const slug = req.query?.slug || 'orange-1801';
  const dryRun = req.query?.dry === '1';

  try {
    const schedule = await fetchSchedule(slug);
    const today = isoToday();
    const text = buildEvents(schedule, today);
    if (!text) return res.status(200).json({ slug, today, sent: 0, reason: 'no events today' });

    const users = await listForemen();
    if (dryRun) return res.status(200).json({ users: users.length, today, preview: text });

    const results = [];
    for (const u of users) {
      const r = await sendTG(u.chatId, text);
      results.push({ name: u.name, role: u.role, ok: r.ok, error: r.error });
      await new Promise(r => setTimeout(r, 200));
    }
    return res.status(200).json({ slug, today, sent: results.filter(r => r.ok).length, total: users.length, results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
