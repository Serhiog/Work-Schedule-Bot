// Точечный ежедневный пинг прорабам: только события сегодня (старты, финиши, просрочки, midpoint).
// Если событий нет — никому не пишем (тихий день = тишина).
// Cron: 09:00 Дубай = 05:00 UTC, ежедневно.

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AT_PAT = process.env.AIRTABLE_PAT;
const AT_BASE = 'apph1Z1U3OU2gBvnL';
const AT_USERS = 'tblDxfO0Fue11EQmp';
const APP_HOST = 'https://cyfr-schedule-app.vercel.app';

// Дефолты материалов по секциям (зеркало DEFAULT_MATERIALS_BY_SECTION в app.js).
// Используются если в Airtable нет ручных данных по материалам конкретной работы.
const DEFAULT_MATERIALS_BY_SECTION = {
  preparation: [{ name: 'ПВХ-материал для защиты', leadTime: 5 }],
  demolition:  [{ name: 'Контейнер для мусора', leadTime: 3 }],
  walls:       [{ name: 'CD/UD профиль', leadTime: 7 }, { name: 'Лист ГКЛ', leadTime: 7 }, { name: 'Утеплитель', leadTime: 7 }, { name: 'Шпатлёвка/грунт', leadTime: 5 }, { name: 'Краска водная', leadTime: 7 }],
  ceilings:    [{ name: 'CD/UD профиль', leadTime: 7 }, { name: 'Лист ГКЛ', leadTime: 7 }, { name: 'Минвата 50мм', leadTime: 7 }, { name: 'Ревизионные люки', leadTime: 14 }, { name: 'Краска водная', leadTime: 7 }],
  floors:      [{ name: 'Самонивелир', leadTime: 7 }, { name: 'Ковролин', leadTime: 14 }, { name: 'Плинтус МДФ', leadTime: 14 }],
  bathrooms:   [{ name: 'Керамогранит', leadTime: 21 }, { name: 'Клей/затирка', leadTime: 7 }, { name: 'Гидроизоляция', leadTime: 7 }, { name: 'Сантехника', leadTime: 14 }, { name: 'Смесители/аксессуары', leadTime: 14 }],
  electrical:  [{ name: 'Кабель силовой', leadTime: 7 }, { name: 'Розетки/выключатели', leadTime: 10 }, { name: 'Светильники', leadTime: 21 }, { name: 'Электрощит', leadTime: 14 }],
  fire_safety: [{ name: 'Чертежи / согласование', leadTime: 14 }],
  hvac:        [],
  logistics:   [],
  cleaning:    [],
};

function isoToday() { return new Date().toISOString().slice(0, 10); }
function fmtRu(iso) { const d = new Date(iso); return d.toLocaleDateString('ru-RU', { day:'numeric', month:'short', timeZone:'UTC' }); }
function diffDays(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

async function fetchSchedule(slug) {
  // Через /api/data?schedule=1 — свежий через GitHub Contents API, без 5-минутного кеша.
  const r = await fetch(`${APP_HOST}/api/data?slug=${slug}&schedule=1&t=${Date.now()}`);
  if (!r.ok) throw new Error(`schedule ${slug} not found`);
  const j = await r.json();
  return j && j.schedule ? j.schedule : j;
}

async function fetchProjectData(slug) {
  // Подтягиваем материалы из Airtable через /api/data (там же ресурсы, ассайны и т.д.)
  try {
    const r = await fetch(`${APP_HOST}/api/data?slug=${slug}`);
    if (!r.ok) return { taskMaterials: {} };
    return r.json();
  } catch { return { taskMaterials: {} }; }
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

function buildEvents(schedule, today, projectData) {
  const sectionsById = Object.fromEntries(schedule.sections.map(s => [s.id, s.name]));
  const tasks = (schedule.tasks || []).filter(t => !t.actualEnd);
  const matsByTask = (projectData && projectData.taskMaterials) || {};

  const projDur = Math.max(1, diffDays(schedule.project.startDate, schedule.project.endDate) + 1);
  const isBackground = (t) => {
    const taskDur = Math.max(1, diffDays(t.planStart, t.planEnd) + 1);
    return taskDur >= projDur * 0.5;
  };

  const startingToday = [];
  const endingToday = [];
  const overdueAny = [];
  const inProgressNoPct = [];
  const materialRisks = [];

  for (const t of tasks) {
    // Материальные риски — по всем работам, включая фоновые
    const planStartDate = new Date(t.planStart);
    const todayDate = new Date(today);
    const daysToStart = Math.round((planStartDate - todayDate) / 86400000);
    // Закрытые работы пропускаем; активные/будущие — проверяем материалы.
    if (!t.actualEnd) {
      let taskMats = matsByTask[String(t.id)];
      if (!Array.isArray(taskMats) || !taskMats.length) {
        taskMats = DEFAULT_MATERIALS_BY_SECTION[t.section] || [];
      }
      if (Array.isArray(taskMats) && taskMats.length) {
        // Для уже идущих работ effectiveDaysToStart = 0 (любой неоформленный материал критичен)
        const effectiveDaysToStart = Math.max(0, daysToStart);
        const risky = taskMats.filter(m => !m.ordered && (Number(m.leadTime) || 0) > effectiveDaysToStart);
        if (risky.length) {
          const maxLead = Math.max(...risky.map(m => Number(m.leadTime) || 0));
          const orderBy = new Date(planStartDate.getTime() - maxLead * 86400000);
          materialRisks.push({ t, riskyCount: risky.length, orderBy: orderBy.toISOString().slice(0,10), daysToStart, items: risky, alreadyStarted: daysToStart < 0 });
        }
      }
    }

    if (isBackground(t)) continue;
    if (t.planStart === today && !t.actualStart) startingToday.push(t);
    if (t.planEnd === today) endingToday.push(t);
    if (t.planEnd < today && !t.actualEnd) {
      overdueAny.push({ t, days: diffDays(t.planEnd, today) });
      continue;
    }
    // ВСЕ работы в активной фазе сегодня (план запущен, факт начат, не закрыта).
    // Показываем все, чтобы прораб мог обновить % (не только инициализировать).
    if (t.actualStart && t.planEnd > today) {
      inProgressNoPct.push(t);
    }
  }

  const eventsCount = startingToday.length + endingToday.length + overdueAny.length + inProgressNoPct.length + materialRisks.length;
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
    parts.push('📊 <b>В работе — какой % сейчас?</b>');
    for (const t of inProgressNoPct.slice(0, 12)) {
      const pct = typeof t.progress === 'number' && t.progress > 0.01
        ? ` · <i>сейчас ${Math.round(t.progress * 100)}%</i>`
        : ' · <i>ещё не отмечали</i>';
      parts.push(`  • <b>${t.name}</b>${pct} <i>(${sec(t)})</i>`);
    }
    if (inProgressNoPct.length > 12) parts.push(`  • …и ещё ${inProgressNoPct.length - 12}`);
    parts.push('');
  }
  if (materialRisks.length) {
    materialRisks.sort((a, b) => a.orderBy.localeCompare(b.orderBy));
    parts.push('📦 <b>Материалы — заказать срочно:</b>');
    for (const { t, items, orderBy, daysToStart } of materialRisks.slice(0, 6)) {
      const matNames = items.slice(0, 3).map(m => m.name).join(', ') + (items.length > 3 ? '…' : '');
      parts.push(`  • <b>${t.name}</b> до <b>${fmtRu(orderBy)}</b>\n     <i>${matNames}</i>`);
    }
    if (materialRisks.length > 6) parts.push(`  • …и ещё ${materialRisks.length - 6} работ`);
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
    const [schedule, projectData] = await Promise.all([fetchSchedule(slug), fetchProjectData(slug)]);
    const today = isoToday();
    const text = buildEvents(schedule, today, projectData);
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
