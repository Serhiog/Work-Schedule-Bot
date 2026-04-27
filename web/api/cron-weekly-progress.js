// Воскресный пинг: бот шлёт всем foreman/admin/owner список активных работ
// и просит голосовой отчёт. Вызывается:
//   • Vercel cron (воскресенье 08:00 UTC = 12:00 Дубай)
//   • Вручную: GET /api/cron-weekly-progress?slug=orange-1801
//   • Один раз: GET /api/cron-weekly-progress?action=add-test-foreman&secret=...

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AT_PAT = process.env.AIRTABLE_PAT;
const AT_BASE = 'apph1Z1U3OU2gBvnL';
const AT_USERS = 'tblDxfO0Fue11EQmp';

const APP_HOST = 'https://cyfr-schedule-app.vercel.app';

function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function fmtRu(d) { return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }

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
  if (!r.ok) {
    const txt = await r.text();
    console.error('Airtable list err:', r.status, txt);
    return [];
  }
  const d = await r.json();
  return (d.records || []).map(rec => ({
    id: rec.id,
    chatId: rec.fields.TelegramUserId,
    name: rec.fields.Name || rec.fields.TelegramUsername || '',
    role: rec.fields.Role,
    sections: rec.fields.AllowedSections || 'all',
  })).filter(u => u.chatId);
}

async function addTestForeman() {
  if (!AT_PAT) return { ok: false, error: 'AIRTABLE_PAT missing' };
  const body = {
    fields: {
      TelegramUsername: 'test_foreman',
      TelegramUserId: '999000111',  // фейковый, реально не достигаем
      Name: 'Прораб (тест)',
      Language: 'ru',
      AllowedSections: 'all',
      Role: 'foreman',
      Active: true,
    },
  };
  const r = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${AT_USERS}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${AT_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) return { ok: false, status: r.status, error: txt.slice(0, 300) };
  return { ok: true, record: JSON.parse(txt) };
}

function buildMessage(schedule) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const weekEnd = addDays(today, 6);
  const sectionsById = Object.fromEntries(schedule.sections.map(s => [s.id, s.name]));

  const tasks = (schedule.tasks || []).filter(t => !t.actualEnd);
  const inWindow = [];
  const starting = [];
  const finishing = [];
  for (const t of tasks) {
    const ps = new Date(t.planStart);
    const pe = new Date(t.planEnd);
    if (ps <= today && today <= pe) inWindow.push(t);
    else if (today < ps && ps <= weekEnd) starting.push(t);
    if (today <= pe && pe <= weekEnd && !inWindow.includes(t) && !starting.includes(t)) finishing.push(t);
  }

  const line = (t) => {
    const pe = new Date(t.planEnd);
    const ico = t.actualStart ? '🟡' : '⚪';
    return `${ico} <b>${(t.name || '').slice(0, 60)}</b>\n   <i>${sectionsById[t.section] || t.section} · до ${fmtRu(pe)}</i>`;
  };

  const parts = [
    '👷 <b>Воскресный отчёт по проекту Orange Group Office</b>',
    `<i>Неделя ${fmtRu(today)} — ${fmtRu(weekEnd)}</i>`,
    '',
    `На неделе активны <b>${inWindow.length} работ</b>:`,
  ];
  for (const t of inWindow.slice(0, 12)) parts.push(line(t));
  if (starting.length) {
    parts.push('', '✨ <b>Должны стартовать:</b>');
    parts.push(...starting.slice(0, 5).map(line));
  }
  if (finishing.length) {
    parts.push('', '🏁 <b>Должны закрыться:</b>');
    parts.push(...finishing.slice(0, 5).map(line));
  }
  parts.push(
    '',
    '━━━━━━━━━━━━━',
    '🎤 <b>Запиши одним голосовым:</b>',
    '• Что закрыли (полностью)',
    '• Где отстаём (на сколько дней или %)',
    '• Что стартовали',
    '• Объёмы в натуре приветствуются («уложили 50 квадратов плитки»)',
    '',
    '<i>Что идёт ровно — можно не упоминать.</i>'
  );
  return parts.join('\n');
}

async function sendTG(chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  const d = await r.json();
  return { ok: r.ok && d.ok, status: r.status, error: d.description || null };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!TG_TOKEN) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN missing' });

  const action = req.query?.action || '';
  if (action === 'add-test-foreman') {
    const out = await addTestForeman();
    return res.status(out.ok ? 200 : 500).json(out);
  }

  const slug = req.query?.slug || 'orange-1801';
  const dryRun = req.query?.dry === '1';

  try {
    const schedule = await fetchSchedule(slug);
    const text = buildMessage(schedule);
    const users = await listForemen();
    if (dryRun) return res.status(200).json({ users: users.length, preview: text });

    const results = [];
    for (const u of users) {
      const r = await sendTG(u.chatId, text);
      results.push({ name: u.name, role: u.role, chatId: u.chatId, ok: r.ok, error: r.error });
      await new Promise(r => setTimeout(r, 200));
    }
    return res.status(200).json({ slug, sent: results.filter(r => r.ok).length, total: users.length, results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
