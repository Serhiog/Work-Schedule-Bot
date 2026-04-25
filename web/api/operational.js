// Operational endpoint: возвращает готовый материал для cron'ов и бота —
// риски по материалам, активные задачи, ресурсный пик. Учитывает дефолты.
//
// GET /api/operational?slug=<projectSlug>[&date=YYYY-MM-DD]
// Returns: { ok, slug, today, riskyMaterials, activeTasks, resourcePeak, summaryMarkdown }

const AT_PAT = process.env.AIRTABLE_PAT;
const BASE = 'apph1Z1U3OU2gBvnL';

const RESOURCE_LABEL_BY_ID = {
  workers: 'Рабочие', plumbers: 'Сантехники', electricians: 'Электрики',
  hvac_installers: 'ОВиК-монтажники', fire_techs: 'Пожарные техники',
  gypsum_workers: 'ГКЛ-монтажники', painters: 'Маляры', tilers: 'Плиточники',
  floor_layers: 'Полы', carpenters: 'Плотники', door_installers: 'Двери',
  glass_installers: 'Стекольщики', movers: 'Мебельщики', cleaners: 'Уборщики'
};

const DEFAULT_RESOURCES_BY_SECTION = {
  demolition: [{ type: 'workers', count: 4 }],
  sanitary:   [{ type: 'plumbers', count: 2 }],
  electric:   [{ type: 'electricians', count: 2 }],
  hvac:       [{ type: 'hvac_installers', count: 3 }],
  fire:       [{ type: 'fire_techs', count: 2 }],
  gypsum:     [{ type: 'gypsum_workers', count: 3 }],
  painting:   [{ type: 'painters', count: 3 }],
  ceramic:    [{ type: 'tilers', count: 3 }],
  flooring:   [{ type: 'floor_layers', count: 2 }],
  carpentry:  [{ type: 'carpenters', count: 2 }],
  doors:      [{ type: 'door_installers', count: 2 }],
  glass:      [{ type: 'glass_installers', count: 2 }],
  furniture:  [{ type: 'movers', count: 3 }],
  cleanup:    [{ type: 'cleaners', count: 3 }],
  default:    [{ type: 'workers', count: 2 }]
};
const DEFAULT_MATERIALS_BY_SECTION = {
  demolition: [{ name: 'Контейнер для мусора', leadTime: 3 }],
  sanitary:   [{ name: 'Трубы ХВС/ГВС', leadTime: 7 }, { name: 'Сантехника', leadTime: 14 }],
  electric:   [{ name: 'Кабель силовой', leadTime: 7 }, { name: 'Розетки', leadTime: 10 }, { name: 'Светильники', leadTime: 21 }],
  hvac:       [{ name: 'Воздуховоды', leadTime: 14 }, { name: 'Фанкоилы', leadTime: 28 }, { name: 'Решётки', leadTime: 14 }],
  fire:       [{ name: 'Пожарный шкаф', leadTime: 14 }, { name: 'Кабель FRLS', leadTime: 7 }],
  gypsum:     [{ name: 'CD/UD профиль', leadTime: 7 }, { name: 'Лист ГКЛ', leadTime: 7 }, { name: 'Крепеж', leadTime: 5 }],
  painting:   [{ name: 'Краска', leadTime: 7 }, { name: 'Шпатлёвка/грунт', leadTime: 5 }],
  ceramic:    [{ name: 'Плитка', leadTime: 21 }, { name: 'Клей/затирка', leadTime: 7 }],
  flooring:   [{ name: 'Напольное покрытие', leadTime: 14 }, { name: 'Подложка', leadTime: 7 }],
  carpentry:  [{ name: 'Пиломатериал', leadTime: 7 }],
  doors:      [{ name: 'Двери', leadTime: 28 }, { name: 'Фурнитура', leadTime: 14 }],
  glass:      [{ name: 'Стеклянные перегородки', leadTime: 35 }, { name: 'Профиль алюминиевый', leadTime: 14 }],
  furniture:  [{ name: 'Мебель', leadTime: 28 }],
  cleanup:    []
};

function bad(res, code, msg, extra) {
  res.status(code).json({ error: msg, ...(extra || {}) });
}

async function airtable(method, path) {
  const url = `https://api.airtable.com/v0/${path}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` } });
  if (!r.ok) throw new Error(`AT ${r.status}`);
  return r.json();
}
async function listAll(table, filter) {
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams();
    params.set('pageSize', '100');
    if (filter) params.set('filterByFormula', filter);
    if (offset) params.set('offset', offset);
    const data = await airtable('GET', `${BASE}/${table}?${params.toString()}`);
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return records;
}
function escapeFormula(s) { return String(s || '').replace(/'/g, "\\'"); }

function fmtDateRu(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

module.exports = async function handler(req, res) {
  if (!AT_PAT) return bad(res, 500, 'AIRTABLE_PAT env missing');
  const slug = (req.query?.slug || '').toString().trim();
  if (!slug) return bad(res, 400, 'slug required');
  const todayIso = (req.query?.date || new Date().toISOString().slice(0, 10)).toString();
  const today = new Date(todayIso + 'T00:00:00Z');

  try {
    // Fetch project schedule from public web (Vercel host serves the JSON)
    const schedHost = 'https://cyfr-schedule-app.vercel.app';
    const schedRes = await fetch(`${schedHost}/schedules/${slug}.json`);
    if (!schedRes.ok) return bad(res, 404, `schedule not found for ${slug}`);
    const schedule = await schedRes.json();

    // Fetch user-set resources/materials from Airtable
    const slugFilter = `{ProjectSlug}='${escapeFormula(slug)}'`;
    const [resourcesR, materialsR] = await Promise.all([
      listAll('TaskResources', slugFilter),
      listAll('TaskMaterials', slugFilter)
    ]);
    const userResources = {};
    for (const r of resourcesR) {
      try { userResources[String(r.fields.TaskId)] = JSON.parse(r.fields.Resources || '[]'); } catch (_) {}
    }
    const userMaterials = {};
    for (const r of materialsR) {
      try { userMaterials[String(r.fields.TaskId)] = JSON.parse(r.fields.Materials || '[]'); } catch (_) {}
    }

    const resourcesFor = (task) => {
      const u = userResources[String(task.id)];
      if (u && u.length) return u;
      return DEFAULT_RESOURCES_BY_SECTION[task.section] || DEFAULT_RESOURCES_BY_SECTION.default;
    };
    const materialsFor = (task) => {
      const u = userMaterials[String(task.id)];
      if (u && u.length) return u;
      return (DEFAULT_MATERIALS_BY_SECTION[task.section] || []).map(m => ({
        name: m.name, leadTime: m.leadTime, ordered: false, expectedDate: ''
      }));
    };

    // ---- Risky materials ----
    const riskyMaterials = [];
    for (const t of schedule.tasks || []) {
      const planStart = new Date(t.planStart + 'T00:00:00Z');
      const daysToStart = Math.round((planStart - today) / 86400000);
      if (daysToStart < 0) continue; // already started
      const mats = materialsFor(t);
      const risky = mats.filter(m => !m.ordered && (Number(m.leadTime) || 0) > daysToStart);
      if (!risky.length) continue;
      const maxLead = Math.max(...risky.map(m => Number(m.leadTime) || 0));
      const orderBy = new Date(planStart.getTime() - maxLead * 86400000);
      const overdueDays = Math.round((today - orderBy) / 86400000);
      riskyMaterials.push({
        taskId: String(t.id),
        taskName: t.name,
        section: t.section,
        planStart: t.planStart,
        daysToStart,
        maxLead,
        orderBy: orderBy.toISOString().slice(0, 10),
        overdueDays,
        risky: risky.map(m => ({ name: m.name, leadTime: m.leadTime }))
      });
    }
    riskyMaterials.sort((a, b) => a.orderBy.localeCompare(b.orderBy));

    // ---- Active tasks today ----
    const activeTasks = [];
    for (const t of schedule.tasks || []) {
      const ps = new Date(t.planStart + 'T00:00:00Z');
      const pe = new Date(t.planEnd + 'T00:00:00Z');
      if (today < ps || today > pe) continue;
      if (t.actualEnd) continue;
      const daysLeft = Math.round((pe - today) / 86400000);
      const elapsed = Math.round((today - ps) / 86400000) + 1;
      const total = Math.round((pe - ps) / 86400000) + 1;
      activeTasks.push({
        taskId: String(t.id),
        taskName: t.name,
        section: t.section,
        planStart: t.planStart,
        planEnd: t.planEnd,
        elapsed, total, daysLeft,
        plannedProgress: Math.round((elapsed / total) * 100)
      });
    }
    activeTasks.sort((a, b) => a.daysLeft - b.daysLeft);

    // ---- Resource peak ----
    const projectStart = new Date(schedule.project.startDate + 'T00:00:00Z');
    const projectEnd = new Date(schedule.project.endDate + 'T00:00:00Z');
    const days = Math.max(1, Math.round((projectEnd - projectStart) / 86400000) + 1);
    const totalPerDay = new Array(days).fill(0);
    for (const t of schedule.tasks || []) {
      const ps = new Date(t.planStart + 'T00:00:00Z').getTime();
      const pe = new Date(t.planEnd + 'T00:00:00Z').getTime();
      const startIdx = Math.max(0, Math.round((ps - projectStart) / 86400000));
      const endIdx = Math.min(days - 1, Math.round((pe - projectStart) / 86400000));
      const total = resourcesFor(t).reduce((s, r) => s + (Number(r.count) || 0), 0);
      for (let i = startIdx; i <= endIdx; i++) totalPerDay[i] += total;
    }
    let peak = 0, peakIdx = -1;
    for (let i = 0; i < days; i++) if (totalPerDay[i] > peak) { peak = totalPerDay[i]; peakIdx = i; }
    const todayIdx = Math.max(0, Math.min(days - 1, Math.round((today - projectStart) / 86400000)));
    const todayPeople = totalPerDay[todayIdx];

    // ---- Summary markdown for Telegram (HTML mode-friendly) ----
    let summary = `<b>📊 ${schedule.project.name}</b>\n`;
    summary += `<i>${schedule.project.code || schedule.project.slug}</i>\n\n`;
    if (activeTasks.length) {
      summary += `<b>В работе сегодня (${activeTasks.length}):</b>\n`;
      for (const at of activeTasks.slice(0, 8)) {
        const left = at.daysLeft <= 0 ? '🔴 просрочка' : at.daysLeft === 1 ? '⏰ завтра' : `${at.daysLeft} дн.`;
        summary += `• ${at.taskName} · до ${fmtDateRu(at.planEnd)} (${left})\n`;
      }
      if (activeTasks.length > 8) summary += `<i>...и ещё ${activeTasks.length - 8}</i>\n`;
    } else {
      summary += `<i>Активных задач сегодня нет</i>\n`;
    }
    summary += `\n👥 На объекте по плану: <b>${todayPeople} чел.</b>\n`;
    if (riskyMaterials.length) {
      summary += `\n<b>📦 Материалы в риске (${riskyMaterials.length}):</b>\n`;
      for (const r of riskyMaterials.slice(0, 6)) {
        const tag = r.overdueDays > 0 ? `🔴 заказывать сегодня` : `⚠️ заказать до ${fmtDateRu(r.orderBy)}`;
        summary += `• ${r.taskName} — ${tag}\n  <i>${r.risky.map(m => m.name).join(', ')}</i>\n`;
      }
      if (riskyMaterials.length > 6) summary += `<i>...и ещё ${riskyMaterials.length - 6}</i>\n`;
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      slug,
      today: todayIso,
      project: { name: schedule.project.name, code: schedule.project.code },
      activeTasks,
      riskyMaterials,
      resourcePeak: {
        peak,
        peakDate: peakIdx >= 0 ? new Date(projectStart.getTime() + peakIdx * 86400000).toISOString().slice(0, 10) : null,
        todayPeople
      },
      summaryHtml: summary
    });
  } catch (e) {
    console.error('operational error', e);
    return bad(res, 500, e.message || 'Server error');
  }
};
