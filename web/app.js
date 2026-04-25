const $ = (sel) => document.querySelector(sel);
const DAY_MS = 86400000;

const MOBILE_MQ = window.matchMedia('(max-width: 720px)');
const isMobile = () => MOBILE_MQ.matches;
const CELL_BASE = 22;
const CELL_MIN = 4;
const CELL_MAX = 80;
const ZOOM_PRESETS = [6, 10, 14, 18, 22, 28, 36, 50, 70];
const clampCell = (x) => Math.max(CELL_MIN, Math.min(CELL_MAX, x));
const currentCellW = () => state.cellW;
const currentLabelW = () => (isMobile() ? 0 : 260);
const zoomPct = () => Math.round((state.cellW / CELL_BASE) * 100);

const state = {
  schedule: null,
  stageById: {},
  sectionById: {},
  holidayMap: new Map(),
  // hover/pin state
  hoverCol: null,
  hoverRow: null,
  pinCol: null,
  pinRow: null,
  // zoom — continuous cell width in px (default 22 = 100%, mobile 16)
  cellW: (window.matchMedia('(max-width: 720px)').matches ? 16 : 22),
  initialScrollDone: false,
  // filter state
  filterSection: null, // null = all, or section id
  filterSubOnly: false,
  // collapsed section ids (user toggles)
  collapsedSections: new Set(),
  // layout cache
  layout: { cellW: 22, labelColW: 260, totalDays: 0, rows: new Map() },
  // PlanRadar tickets overlay
  tickets: [],
  showTickets: false,
  // Multi-project: current project slug (set in init() from URL)
  projectSlug: null,
  // Airtable-backed shared data cache (loaded once on init via /api/data)
  dataCache: {
    assignees: {},          // { ticketId: string[] }
    updates: {},            // { ticketId: [{id,text,at}] }
    ticketMeetingNotes: {}, // { ticketId: [{id,text,meetingDate,at}] }
    taskMeetingNotes: {},   // { taskId: [{id,text,meetingDate,at}] }
    taskResources: {},      // { taskId: [{type,count}] }
    taskMaterials: {}       // { taskId: [{name,leadTime,ordered,expectedDate,note}] }
  },
  dataLoaded: false,
};

function getProjectSlug() {
  const m = window.location.pathname.match(/^\/p\/([a-z0-9][a-z0-9-]*)\/?$/i);
  return m ? m[1].toLowerCase() : 'orange-1801';
}

function scheduleJsonUrl(slug) {
  const base = 'https://raw.githubusercontent.com/Serhiog/Work-Schedule-Bot/main/web';
  return `${base}/schedules/${slug}.json?t=${Date.now()}`;
}

function renderDatelessView(s) {
  document.title = `${s.project.name} · Новый проект · CYFR`;
  const p = s.project;
  const sectionById = {};
  s.sections.forEach((se) => (sectionById[se.id] = se));
  const stageById = {};
  s.stages.forEach((st) => (stageById[st.id] = st));

  const works = s.tasks.map((t) => {
    const sec = sectionById[t.section] || { name: t.section, color: '#64748b' };
    const stg = stageById[t.stage] || { name: t.stage, color: '#64748b' };
    return `<div class="dateless-work">
      <div class="dateless-work-head">
        <span class="dateless-stage" style="background:${stg.color}22; color:${stg.color}; border-color:${stg.color}44">${stg.name.replace(/^Этап \d+ · /, '')}</span>
        <span class="dateless-section" style="background:${sec.color}22; color:${sec.color}">${sec.name}</span>
      </div>
      <div class="dateless-work-name">${t.name}</div>
      <div class="dateless-work-meta">
        ${t.durationDaysPlanned ? `⏱ ~${t.durationDaysPlanned} дн.` : ''}
        ${t.costIncVat ? `· 💰 ${new Intl.NumberFormat('ru-RU').format(t.costIncVat)} AED` : ''}
      </div>
    </div>`;
  }).join('');

  const total = s.tasks.reduce((sum, t) => sum + (Number(t.costIncVat)||0), 0);
  const totalDur = s.tasks.reduce((sum, t) => sum + (Number(t.durationDaysPlanned)||0), 0);

  document.body.innerHTML = `<div class="dateless-wrap">
    <div class="dateless-header">
      <div class="dateless-chip">⏳ НОВЫЙ ПРОЕКТ · ДАТЫ НЕ УСТАНОВЛЕНЫ</div>
      <h1 class="dateless-title">${p.name}</h1>
      <div class="dateless-stats">
        <div class="dateless-stat"><div class="dateless-stat-v">${s.tasks.length}</div><div class="dateless-stat-l">работ</div></div>
        <div class="dateless-stat"><div class="dateless-stat-v">${s.sections.length}</div><div class="dateless-stat-l">секций</div></div>
        <div class="dateless-stat"><div class="dateless-stat-v">~${totalDur} дн.</div><div class="dateless-stat-l">длительность</div></div>
        <div class="dateless-stat"><div class="dateless-stat-v">${new Intl.NumberFormat('ru-RU').format(Math.round(total))} AED</div><div class="dateless-stat-l">оценка</div></div>
      </div>
      <div class="dateless-hint">
        📅 <strong>Даты пока не проставлены.</strong> Следующим шагом бот пройдёт по работам и поможет установить план — напиши в Telegram:<br>
        <code style="background:#f1f5f9;padding:2px 8px;border-radius:4px;margin-top:8px;display:inline-block">установить даты для ${p.slug}</code>
      </div>
    </div>
    <div class="dateless-works">${works}</div>
  </div>`;

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    .dateless-wrap { max-width: 960px; margin: 0 auto; padding: 32px 24px; font-family: 'Inter', -apple-system, sans-serif; }
    .dateless-header { margin-bottom: 32px; }
    .dateless-chip { display: inline-block; font-size: 10px; font-weight: 600; letter-spacing: 1.4px; color: #d97706; background: #fef3c7; padding: 5px 10px; border-radius: 999px; margin-bottom: 12px; }
    .dateless-title { font-size: 32px; font-weight: 800; letter-spacing: -0.8px; margin: 0 0 20px; color: #1e3b60; line-height: 1.1; }
    .dateless-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
    .dateless-stat { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .dateless-stat-v { font-size: 18px; font-weight: 700; color: #1e3b60; letter-spacing: -0.3px; font-variant-numeric: tabular-nums; }
    .dateless-stat-l { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; margin-top: 2px; }
    .dateless-hint { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 12px; padding: 14px 16px; font-size: 13px; color: #075985; line-height: 1.6; }
    .dateless-works { display: flex; flex-direction: column; gap: 8px; }
    .dateless-work { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 14px; display: flex; flex-direction: column; gap: 4px; }
    .dateless-work-head { display: flex; gap: 6px; flex-wrap: wrap; }
    .dateless-stage, .dateless-section { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap; }
    .dateless-work-name { font-size: 14px; font-weight: 500; color: #0b1220; }
    .dateless-work-meta { font-size: 11px; color: #64748b; font-variant-numeric: tabular-nums; }
    @media (max-width: 720px) {
      .dateless-wrap { padding: 16px 12px; }
      .dateless-title { font-size: 22px; }
      .dateless-stats { grid-template-columns: repeat(2, 1fr); }
    }
  `;
  document.head.appendChild(style);
}

function showProjectNotFound(slug) {
  const safe = String(slug).replace(/[<>&]/g, '');
  document.body.innerHTML = `<div style="padding:56px 24px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto">
    <div style="font-size:48px;margin-bottom:16px">🗂️</div>
    <h2 style="font-weight:600;font-size:22px;margin:0 0 8px">Проект не найден</h2>
    <p style="color:#64748b;font-size:14px;margin:0 0 24px">Слаг <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${safe}</code> не существует или ещё не задеплоен.</p>
    <a href="/p/orange-1801" style="color:#2563eb;text-decoration:none;font-weight:500">→ Orange Group Office 1801</a>
  </div>`;
}

async function init() {
  // Normalize URL: bare / → /p/orange-1801 (so the URL bar reflects the project)
  if (window.location.pathname === '/') {
    window.history.replaceState(null, '', '/p/orange-1801' + window.location.search + window.location.hash);
  }
  const slug = getProjectSlug();
  state.projectSlug = slug;
  const res = await fetch(scheduleJsonUrl(slug));
  if (!res.ok) { showProjectNotFound(slug); return; }
  const s = await res.json();
  state.schedule = s;
  s.stages.forEach((st) => (state.stageById[st.id] = st));
  s.sections.forEach((se) => (state.sectionById[se.id] = se));
  s.holidays.forEach((h) => state.holidayMap.set(h.date, h.name));

  // Parse URL filter params
  const params = new URLSearchParams(window.location.search);
  const urlSection = params.get('section');
  if (urlSection && s.sections.some((se) => se.id === urlSection)) {
    state.filterSection = urlSection;
  }
  if (params.get('sub') === '1') state.filterSubOnly = true;

  // Fresh projects (just created from estimate) don't yet have dates — show setup view
  if (!s.project.startDate || !s.project.endDate) {
    renderDatelessView(s);
    return;
  }

  renderHero();
  renderStagesRibbon();
  renderLegend();
  renderToolbar();
  renderGantt();
  renderTasksSheet();
  attachDrawerHandlers();
  attachHighlightHandlers();
  attachStatHandlers();
  attachTasksSheetHandlers();
  attachToolbarHandlers();
  fetchTickets();
  loadProjectData(state.projectSlug)
    .then(() => migrateLocalToAirtable(state.projectSlug))
    .then(() => {
      // После загрузки shared-данных перерендерить чтобы badge'и/счётчики появились
      if (typeof renderGantt === 'function') {
        try { renderGantt(); } catch (_) {}
      }
    });
  attachGanttGestures();
  attachPrintHandlers();
  attachReportHandlers();

  // Deep-link: ?report=1&start=...&end=...&theses=... — открыть визард сразу на шаге 4
  if (params.get('report') === '1') {
    setTimeout(() => openReportFromDeepLink(params), 200);
  }

  // Re-layout gantt + sheet on breakpoint change (phone rotate / window resize across 720px)
  let lastMobile = isMobile();
  const onMQ = () => {
    const nowMobile = isMobile();
    if (nowMobile !== lastMobile) {
      lastMobile = nowMobile;
      renderGantt();
    }
  };
  if (MOBILE_MQ.addEventListener) MOBILE_MQ.addEventListener('change', onMQ);
  else MOBILE_MQ.addListener(onMQ);

  // On window resize: re-clamp fit-to-width cellW
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; renderGantt(); });
  });
}

/* ─── helpers ─── */
const parseISO = (iso) => new Date(iso + 'T00:00:00Z');
const toISO = (d) => d.toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((b - a) / DAY_MS);
const todayISO = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
};
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtAED = (n) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' AED';
const fmtDate = (iso) =>
  parseISO(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthLabel = (d) =>
  d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const plural = (n, forms) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
};
const daysWord = (n) => plural(n, ['день', 'дня', 'дней']);
const isLight = (hex) => {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16),
    g = parseInt(c.slice(2, 4), 16),
    b = parseInt(c.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 186;
};
const darken = (hex, k) => {
  const c = hex.replace('#', '');
  const hx = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const r = parseInt(hx.slice(0, 2), 16),
    g = parseInt(hx.slice(2, 4), 16),
    b = parseInt(hx.slice(4, 6), 16);
  const nr = Math.max(0, Math.round(r * (1 - k)));
  const ng = Math.max(0, Math.round(g * (1 - k)));
  const nb = Math.max(0, Math.round(b * (1 - k)));
  return '#' + [nr, ng, nb].map((x) => x.toString(16).padStart(2, '0')).join('');
};

/* ─── PlanRadar tickets ─── */
async function fetchTickets() {
  try {
    const r = await fetch('/api/planradar');
    if (!r.ok) return;
    const data = await r.json();
    state.tickets = data.tickets || [];
    // if tickets toggle is on, re-render overlay
    if (state.showTickets) renderGantt();
  } catch (_) {
    state.tickets = [];
  }
}

/* ─── Airtable-backed shared data: bootstrap ─── */
async function loadProjectData(slug) {
  if (!slug) return;
  try {
    const r = await fetch(`/api/data?slug=${encodeURIComponent(slug)}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const json = await r.json();
    if (json.data) {
      state.dataCache = {
        assignees: json.data.assignees || {},
        updates: json.data.updates || {},
        ticketMeetingNotes: json.data.ticketMeetingNotes || {},
        taskMeetingNotes: json.data.taskMeetingNotes || {},
        taskResources: json.data.taskResources || {},
        taskMaterials: json.data.taskMaterials || {}
      };
    }
    state.dataLoaded = true;
  } catch (e) {
    console.warn('loadProjectData failed', e);
    state.dataLoaded = false;
  }
}

/* ─── Resource & Materials catalog (defaults by section) ─── */
const RESOURCE_TYPES = [
  { id: 'workers',          label: 'Рабочие' },
  { id: 'plumbers',         label: 'Сантехники' },
  { id: 'electricians',     label: 'Электрики' },
  { id: 'hvac_installers',  label: 'ОВиК-монтажники' },
  { id: 'fire_techs',       label: 'Пожарные техники' },
  { id: 'gypsum_workers',   label: 'ГКЛ-монтажники' },
  { id: 'painters',         label: 'Маляры' },
  { id: 'tilers',           label: 'Плиточники' },
  { id: 'floor_layers',     label: 'Полы' },
  { id: 'carpenters',       label: 'Плотники' },
  { id: 'door_installers',  label: 'Монтажники дверей' },
  { id: 'glass_installers', label: 'Стекольщики' },
  { id: 'movers',           label: 'Мебельщики' },
  { id: 'cleaners',         label: 'Уборщики' }
];
const RESOURCE_LABEL_BY_ID = Object.fromEntries(RESOURCE_TYPES.map(r => [r.id, r.label]));

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
  sanitary:   [{ name: 'Трубы ХВС/ГВС', leadTime: 7 }, { name: 'Сантехника (унитазы, раковины)', leadTime: 14 }],
  electric:   [{ name: 'Кабель силовой', leadTime: 7 }, { name: 'Розетки/выключатели', leadTime: 10 }, { name: 'Светильники', leadTime: 21 }],
  hvac:       [{ name: 'Воздуховоды', leadTime: 14 }, { name: 'Фанкоилы', leadTime: 28 }, { name: 'Решётки/диффузоры', leadTime: 14 }],
  fire:       [{ name: 'Пожарный шкаф', leadTime: 14 }, { name: 'Кабель FRLS', leadTime: 7 }],
  gypsum:     [{ name: 'CD/UD профиль', leadTime: 7 }, { name: 'Лист ГКЛ', leadTime: 7 }, { name: 'Крепеж/саморезы', leadTime: 5 }],
  painting:   [{ name: 'Краска', leadTime: 7 }, { name: 'Шпатлёвка/грунт', leadTime: 5 }],
  ceramic:    [{ name: 'Плитка керамическая', leadTime: 21 }, { name: 'Клей/затирка', leadTime: 7 }],
  flooring:   [{ name: 'Покрытие пола (LVT/ламинат)', leadTime: 14 }, { name: 'Подложка', leadTime: 7 }],
  carpentry:  [{ name: 'Пиломатериал', leadTime: 7 }],
  doors:      [{ name: 'Двери в сборе', leadTime: 28 }, { name: 'Фурнитура', leadTime: 14 }],
  glass:      [{ name: 'Стеклянные перегородки', leadTime: 35 }, { name: 'Профиль алюминиевый', leadTime: 14 }],
  furniture:  [{ name: 'Мебель', leadTime: 28 }],
  cleanup:    []
};

function defaultResourcesForTask(task) {
  if (!task) return [];
  const sectionKey = task.section || 'default';
  return JSON.parse(JSON.stringify(DEFAULT_RESOURCES_BY_SECTION[sectionKey] || DEFAULT_RESOURCES_BY_SECTION.default));
}
function defaultMaterialsForTask(task) {
  if (!task) return [];
  const list = DEFAULT_MATERIALS_BY_SECTION[task.section] || [];
  return list.map(m => ({ name: m.name, leadTime: m.leadTime, ordered: false, expectedDate: '', note: '' }));
}

function getTaskResources(taskId) {
  const stored = state.dataCache.taskResources[String(taskId)];
  if (stored && stored.length) return stored;
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(taskId));
  return defaultResourcesForTask(t);
}
function setTaskResources(taskId, resources) {
  const list = (resources || []).filter(r => r && r.type && Number(r.count) > 0)
    .map(r => ({ type: String(r.type), count: Math.max(1, Math.min(99, Number(r.count) || 1)) }));
  state.dataCache.taskResources[String(taskId)] = list;
  postDataAction('task-resources:upsert', { taskId: String(taskId), slug: state.projectSlug, resources: list })
    .catch(e => console.warn('task-resources:upsert failed', e));
}

function getTaskMaterials(taskId) {
  const stored = state.dataCache.taskMaterials[String(taskId)];
  if (stored && stored.length) return stored;
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(taskId));
  return defaultMaterialsForTask(t);
}
function setTaskMaterials(taskId, materials) {
  const list = (materials || []).filter(m => m && m.name && String(m.name).trim())
    .map(m => ({
      name: String(m.name).trim(),
      leadTime: Math.max(0, Math.min(120, Number(m.leadTime) || 0)),
      ordered: !!m.ordered,
      expectedDate: m.expectedDate || '',
      note: (m.note || '').slice(0, 200)
    }));
  state.dataCache.taskMaterials[String(taskId)] = list;
  postDataAction('task-materials:upsert', { taskId: String(taskId), slug: state.projectSlug, materials: list })
    .catch(e => console.warn('task-materials:upsert failed', e));
}

// Алерт по материалам: «через сколько дней нужно успеть заказать?»
// daysUntilStart = (planStart - today). Risk if any unordered material with leadTime > daysUntilStart.
function computeMaterialRisk(task) {
  const today = effectiveToday();
  const start = parseISO(task.planStart);
  const daysToStart = Math.round((start - today) / DAY_MS);
  if (daysToStart < 0) return null; // already started
  const mats = getTaskMaterials(task.id);
  const risky = mats.filter(m => !m.ordered && (Number(m.leadTime) || 0) > daysToStart);
  if (!risky.length) return null;
  const maxLead = Math.max(...risky.map(m => Number(m.leadTime) || 0));
  const orderBy = new Date(start.getTime() - maxLead * DAY_MS);
  return { daysToStart, maxLead, orderBy, riskyCount: risky.length, totalCount: mats.length };
}

async function postDataAction(action, payload) {
  const r = await fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload })
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || ('HTTP ' + r.status));
  return json.result || {};
}

// One-time per-browser миграция данных из localStorage в Airtable.
// Запускается после loadProjectData. Использует флаг migrated:<slug> чтобы не повторяться.
async function migrateLocalToAirtable(slug) {
  if (!slug) return;
  const flagKey = 'wsb-migrated-to-airtable:' + slug;
  if (localStorage.getItem(flagKey) === '1') return;
  const promises = [];
  let pushed = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;

      // Assignees
      if (k.startsWith('ticket-assignee-') && !k.startsWith('ticket-assignee-create-')) {
        const ticketId = k.slice('ticket-assignee-'.length);
        const raw = localStorage.getItem(k);
        let names = [];
        try { names = raw && raw.startsWith('[') ? JSON.parse(raw) : (raw ? [raw] : []); } catch (_) {}
        names = (names || []).filter(n => ['Александр', 'Андрей', 'Антон П.', 'Антон М.'].includes(n));
        if (names.length && !state.dataCache.assignees[ticketId]) {
          promises.push(postDataAction('assignees:set', { ticketId, slug, names }).then(() => pushed++));
        }
        continue;
      }

      // Ticket updates
      if (k.startsWith('ticket-updates-')) {
        const ticketId = k.slice('ticket-updates-'.length);
        let arr = [];
        try { arr = JSON.parse(localStorage.getItem(k) || '[]'); } catch (_) {}
        if (Array.isArray(arr) && arr.length && !state.dataCache.updates[ticketId]?.length) {
          for (const u of arr) {
            if (u && u.text) {
              promises.push(postDataAction('update:add', { ticketId, slug, text: u.text }).then(() => pushed++));
            }
          }
        }
        continue;
      }

      // Ticket meeting notes
      if (k.startsWith('ticket-meeting-notes-')) {
        const ticketId = k.slice('ticket-meeting-notes-'.length);
        let arr = [];
        try { arr = JSON.parse(localStorage.getItem(k) || '[]'); } catch (_) {}
        if (Array.isArray(arr) && arr.length && !state.dataCache.ticketMeetingNotes[ticketId]?.length) {
          for (const n of arr) {
            if (n && n.text) {
              promises.push(postDataAction('ticket-note:add', { ticketId, slug, meetingDate: n.meetingDate, text: n.text }).then(() => pushed++));
            }
          }
        }
        continue;
      }

      // Task meeting notes
      if (k.startsWith('task-meeting-notes-')) {
        const taskId = k.slice('task-meeting-notes-'.length);
        let arr = [];
        try { arr = JSON.parse(localStorage.getItem(k) || '[]'); } catch (_) {}
        if (Array.isArray(arr) && arr.length && !state.dataCache.taskMeetingNotes[taskId]?.length) {
          for (const n of arr) {
            if (n && n.text) {
              promises.push(postDataAction('task-note:add', { taskId, slug, meetingDate: n.meetingDate, text: n.text }).then(() => pushed++));
            }
          }
        }
        continue;
      }
    }

    if (promises.length) {
      await Promise.allSettled(promises);
      console.info(`[migration] Pushed ${pushed} items from localStorage to Airtable for slug=${slug}`);
      // Перезагружаем кеш, т.к. свежие записи добавлены на сервер
      await loadProjectData(slug);
    }
    localStorage.setItem(flagKey, '1');
  } catch (e) {
    console.warn('migration error', e);
  }
}

/* Hide/show task rows and toggle section collapsed class without full re-render */
function applyCollapsedState() {
  for (const el of document.querySelectorAll('.section-label[data-section-id]')) {
    const sid = el.getAttribute('data-section-id');
    const isCollapsed = state.collapsedSections.has(sid);
    el.classList.toggle('section-label--collapsed', isCollapsed);
    el.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    el.setAttribute('title', isCollapsed ? 'Развернуть группу' : 'Свернуть группу');
  }
  for (const el of document.querySelectorAll('.task-label[data-section-id], .task-grid[data-section-id]')) {
    const sid = el.getAttribute('data-section-id');
    el.classList.toggle('row-hidden', state.collapsedSections.has(sid));
  }
}

/* Aggregated ticket badge per task — predictable position on the bar, color by worst status, size by count */
function buildTaskTicketBadge(taskId, barLeft, barWidth) {
  if (!state.showTickets) return '';
  const tt = state.tickets.filter((tk) => tk.task_id === String(taskId));
  if (!tt.length) return '';

  // Worst-status priority (higher number = more critical)
  const PRI = { resolved: 0, rejected: 0, deferred: 1, in_review: 2, in_progress: 3, open: 4 };
  const worst = tt.reduce((w, tk) => (PRI[tk.status] ?? 0) > PRI[w] ? tk.status : w, 'resolved');
  const openCount = tt.filter(tk => tk.status !== 'resolved' && tk.status !== 'rejected').length;
  const total = tt.length;
  // Intensity tier by OPEN count (outstanding tickets). Resolved tickets don't raise alert level.
  let tier = 'low';
  if (openCount >= 5) tier = 'high';
  else if (openCount >= 2) tier = 'mid';
  else if (openCount >= 1) tier = 'low';
  else tier = 'done'; // all resolved

  const titleParts = [];
  for (const s of ['open','in_progress','in_review','deferred','resolved','rejected']) {
    const c = tt.filter(t => t.status === s).length;
    if (c) titleParts.push(`${TICKET_STATUS_LABEL[s] || s}: ${c}`);
  }
  const title = `Полевые тикеты (${total}) · ${titleParts.join(', ')}`;
  // Position: stick to the RIGHT edge of the plan bar, overlay corner
  const left = Math.round(barLeft + barWidth - 2);
  return `<div class="tk-badge tk-badge--${worst} tk-badge--${tier}" style="left:${left}px" data-task-id="${escapeHtml(String(taskId))}" title="${escapeHtml(title)}">
    <svg viewBox="0 0 10 12" class="tk-badge-flag" aria-hidden="true"><path d="M1 1 L1 11 M1 1 L8 1 L6.5 3.5 L8 6 L1 6" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span class="tk-badge-count">${total}</span>
  </div>`;
}

/* "As of" date — clamp real today to project range so bars/progress render sensibly */
function effectiveToday() {
  const p = state.schedule.project;
  const start = parseISO(p.startDate);
  const end = parseISO(p.endDate);
  const today = parseISO(todayISO());
  if (today < start) return start;
  if (today > end) return end;
  return today;
}

/* ─── hero stats ─── */
function fmtRelative(date) {
  const now = new Date();
  const diffMin = Math.round((now - date) / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return diffMin + ' ' + plural(diffMin, ['минуту', 'минуты', 'минут']) + ' назад';
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return diffH + ' ' + plural(diffH, ['час', 'часа', 'часов']) + ' назад';
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return diffD + ' ' + plural(diffD, ['день', 'дня', 'дней']) + ' назад';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/* ──────────────────────────────────────────────────────────── */
/*  Project analytics: Critical Path Method + Earned Value      */
/* ──────────────────────────────────────────────────────────── */

const CANONICAL_STAGE_ORDER = ['ST1', 'ST2', 'ST3', 'ST4'];

// CPM: forward+backward pass по stages (упрощённая модель — используем
// canonical fit-out order вместо явных dependencies, которых в данных нет).
// Возвращает Set id-ов задач на критическом пути.
function computeCriticalPath(schedule) {
  const tasks = schedule.tasks || [];
  if (!tasks.length) return { critical: new Set(), slack: new Map() };
  const projectStart = parseISO(schedule.project.startDate);
  const projectEnd = parseISO(schedule.project.endDate);

  // Сортируем stages по канону, добавляем непредусмотренные в конец
  const stagesPresent = [...new Set(tasks.map(t => t.stage).filter(Boolean))];
  const ordered = [
    ...CANONICAL_STAGE_ORDER.filter(s => stagesPresent.includes(s)),
    ...stagesPresent.filter(s => !CANONICAL_STAGE_ORDER.includes(s))
  ];
  const byStage = Object.fromEntries(ordered.map(s => [s, []]));
  for (const t of tasks) if (byStage[t.stage]) byStage[t.stage].push(t);

  const efMap = new Map(); // taskId → {es, ef, dur}
  let prevStageMaxEF = projectStart.getTime();
  for (const stage of ordered) {
    let stageMaxEF = prevStageMaxEF;
    for (const t of byStage[stage]) {
      const ps = parseISO(t.planStart).getTime();
      const pe = parseISO(t.planEnd).getTime();
      const dur = Math.max(1, (pe - ps) / 86400000 + 1);
      const es = Math.max(ps, prevStageMaxEF);
      const ef = es + (dur - 1) * 86400000;
      efMap.set(t.id, { es, ef, dur });
      if (ef > stageMaxEF) stageMaxEF = ef;
    }
    prevStageMaxEF = stageMaxEF;
  }

  const lfMap = new Map();
  let nextStageMinLS = projectEnd.getTime();
  for (let i = ordered.length - 1; i >= 0; i--) {
    let stageMinLS = nextStageMinLS;
    for (const t of byStage[ordered[i]]) {
      const e = efMap.get(t.id);
      if (!e) continue;
      const lf = nextStageMinLS;
      const ls = lf - (e.dur - 1) * 86400000;
      lfMap.set(t.id, { lf, ls });
      if (ls < stageMinLS) stageMinLS = ls;
    }
    nextStageMinLS = stageMinLS;
  }

  const critical = new Set();
  const slackMap = new Map();
  for (const t of tasks) {
    const e = efMap.get(t.id), l = lfMap.get(t.id);
    if (!e || !l) continue;
    const slackDays = Math.round((l.lf - e.ef) / 86400000);
    slackMap.set(t.id, slackDays);
    if (slackDays <= 1) critical.add(t.id);
  }
  return { critical, slack: slackMap };
}

// EVM: Schedule Performance Index (SPI), Earned Value (EV), Planned Value (PV),
// прогноз сдачи (EAC). CPI/AC опускаем — actual cost у нас нет.
function computeEVM(schedule, asOfDate) {
  const tasks = schedule.tasks || [];
  const projectStart = parseISO(schedule.project.startDate);
  const projectEnd = parseISO(schedule.project.endDate);
  const totalCost = tasks.reduce((s, t) => s + (Number(t.costIncVat) || 0), 0);
  const today = asOfDate.getTime();

  let PV = 0, EV = 0;
  for (const t of tasks) {
    const cost = Number(t.costIncVat) || 0;
    if (!cost) continue;
    const ps = parseISO(t.planStart).getTime();
    const pe = parseISO(t.planEnd).getTime();
    const pDur = Math.max(1, (pe - ps) / 86400000 + 1);

    let pProgress = 0;
    if (today >= pe) pProgress = 1;
    else if (today > ps) pProgress = ((today - ps) / 86400000) / pDur;

    let aProgress = 0;
    if (t.actualEnd) aProgress = 1;
    else if (t.actualStart) {
      const as = parseISO(t.actualStart).getTime();
      if (today >= as) aProgress = Math.min(1, ((today - as) / 86400000) / pDur);
    }

    PV += cost * pProgress;
    EV += cost * aProgress;
  }

  const SPI = PV > 0 ? EV / PV : 1;
  const totalDays = Math.max(1, (projectEnd - projectStart) / 86400000 + 1);
  const eacDays = SPI > 0 ? totalDays / SPI : totalDays;
  const eacDate = new Date(projectStart.getTime() + Math.round(eacDays - 1) * 86400000);
  const slipDays = Math.round((eacDate - projectEnd) / 86400000);
  return {
    PV, EV, SPI,
    totalCost,
    completionRatio: totalCost > 0 ? EV / totalCost : 0,
    plannedRatio: totalCost > 0 ? PV / totalCost : 0,
    eacDate, slipDays
  };
}

// Полное распределение по дням и типам специалистов. Возвращает: { days[], types[], counts[type][dayIdx], peak, peakDate, peakIdx }
function computeResourceTimeline(schedule) {
  const tasks = schedule.tasks || [];
  const projectStart = parseISO(schedule.project.startDate);
  const projectEnd = parseISO(schedule.project.endDate);
  const days = Math.max(1, Math.round((projectEnd - projectStart) / DAY_MS) + 1);

  const counts = {}; // type → array(days)
  const totalPerDay = new Array(days).fill(0);

  for (const t of tasks) {
    const ps = parseISO(t.planStart).getTime();
    const pe = parseISO(t.planEnd).getTime();
    const startIdx = Math.max(0, Math.round((ps - projectStart) / DAY_MS));
    const endIdx = Math.min(days - 1, Math.round((pe - projectStart) / DAY_MS));
    const resources = getTaskResources(t.id);
    for (const r of resources) {
      const cnt = Number(r.count) || 0;
      if (!cnt) continue;
      if (!counts[r.type]) counts[r.type] = new Array(days).fill(0);
      for (let i = startIdx; i <= endIdx; i++) {
        counts[r.type][i] += cnt;
        totalPerDay[i] += cnt;
      }
    }
  }
  const types = Object.keys(counts);
  let peak = 0, peakIdx = -1;
  for (let i = 0; i < days; i++) if (totalPerDay[i] > peak) { peak = totalPerDay[i]; peakIdx = i; }
  const peakDate = peakIdx >= 0 ? new Date(projectStart.getTime() + peakIdx * DAY_MS) : null;
  const dayDates = [];
  for (let i = 0; i < days; i++) dayDates.push(new Date(projectStart.getTime() + i * DAY_MS));
  return { days: dayDates, types, counts, totalPerDay, peak, peakDate, peakIdx };
}

function renderResourceHeatmap() {
  const cont = document.getElementById('resource-heatmap');
  if (!cont) return;
  if (!state.showHeatmap) { cont.hidden = true; cont.innerHTML = ''; return; }
  const sched = state.schedule;
  if (!sched) return;
  const tl = computeResourceTimeline(sched);
  if (!tl.types.length) {
    cont.hidden = false;
    cont.innerHTML = '<div class="rh-empty">Нет данных по ресурсам — открой задачу и заполни блок «Ресурсы / люди».</div>';
    return;
  }
  // Sort types by total descending
  tl.types.sort((a, b) => {
    const sumA = tl.counts[a].reduce((s, x) => s + x, 0);
    const sumB = tl.counts[b].reduce((s, x) => s + x, 0);
    return sumB - sumA;
  });

  const cellW = state.cellW || 22;
  const labelW = isMobile() ? 0 : 180;
  const max = Math.max(1, ...Object.values(tl.counts).flat());

  const monthsHtml = (() => {
    const groups = [];
    let cur = null;
    for (const d of tl.days) {
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      if (!cur || cur.key !== key) {
        cur = { key, label: monthLabel(d), count: 0 };
        groups.push(cur);
      }
      cur.count++;
    }
    return groups.map(g => `<div class="rh-month-cell" style="grid-column: span ${g.count}">${escapeHtml(g.label)}</div>`).join('');
  })();

  const headerDaysHtml = tl.days.map(d => `<div class="rh-day-header">${d.getUTCDate()}</div>`).join('');

  const cellsTpl = `repeat(${tl.days.length}, ${cellW}px)`;

  const rowHtml = (label, arr, isTotal) => {
    const palette = isTotal ? '34, 197, 94' : '70, 111, 166';
    const baseAlpha = isTotal ? 0.18 : 0.15;
    const peakAlpha = isTotal ? 0.55 : 0.65;
    const peakRef = isTotal ? Math.max(tl.peak, 1) : max;
    const cells = arr.map((n, i) => {
      const intensity = Math.min(1, n / peakRef);
      const bg = n > 0 ? `rgba(${palette}, ${baseAlpha + intensity * peakAlpha})` : 'transparent';
      return `<div class="rh-cell${isTotal ? ' rh-cell--total' : ''}" style="background:${bg}" title="${escapeHtml(fmtDate(toISO(tl.days[i])))} · ${escapeHtml(label)}: ${n}">${n > 0 ? n : ''}</div>`;
    }).join('');
    return `
      <div class="rh-row${isTotal ? ' rh-row--total' : ''}">
        <div class="rh-row-label">${escapeHtml(label)}</div>
        <div class="rh-row-cells" style="grid-template-columns:${cellsTpl}">${cells}</div>
      </div>`;
  };

  const rowsHtml = tl.types.map(type => rowHtml(RESOURCE_LABEL_BY_ID[type] || type, tl.counts[type], false)).join('');
  const totalRowHtml = rowHtml('Итого', tl.totalPerDay, true);

  cont.hidden = false;
  cont.innerHTML = `
    <div class="rh-head">
      <div class="rh-title">Загрузка людей по дням</div>
      <div class="rh-meta">пик · ${tl.peak} чел. · ${tl.peakDate ? escapeHtml(fmtDate(toISO(tl.peakDate))) : ''}</div>
    </div>
    <div class="rh-scroll">
      <div class="rh-table" style="--rh-label-w:${labelW}px;">
        <div class="rh-row rh-row--header">
          <div class="rh-row-label"></div>
          <div class="rh-row-cells" style="grid-template-columns:${cellsTpl}">${tl.days.map(d => `<div class="rh-day-header">${d.getUTCDate()}</div>`).join('')}</div>
        </div>
        ${rowsHtml}
        ${totalRowHtml}
      </div>
    </div>`;
}

// Resource peak: считаем суммарное число людей на каждый день в plan-диапазоне.
// Возвращаем максимум и его дату.
function computeResourcePeak(schedule) {
  const tasks = schedule.tasks || [];
  if (!tasks.length) return { peak: 0, peakDate: null };
  const projectStart = parseISO(schedule.project.startDate);
  const projectEnd = parseISO(schedule.project.endDate);
  const days = Math.round((projectEnd - projectStart) / DAY_MS) + 1;
  const counts = new Array(days).fill(0);

  for (const t of tasks) {
    const ps = parseISO(t.planStart).getTime();
    const pe = parseISO(t.planEnd).getTime();
    const startIdx = Math.max(0, Math.round((ps - projectStart) / DAY_MS));
    const endIdx = Math.min(days - 1, Math.round((pe - projectStart) / DAY_MS));
    const total = getTaskResources(t.id).reduce((s, r) => s + (Number(r.count) || 0), 0);
    if (!total) continue;
    for (let i = startIdx; i <= endIdx; i++) counts[i] += total;
  }
  let peak = 0, peakIdx = -1;
  for (let i = 0; i < days; i++) {
    if (counts[i] > peak) { peak = counts[i]; peakIdx = i; }
  }
  const peakDate = peakIdx >= 0 ? new Date(projectStart.getTime() + peakIdx * DAY_MS) : null;
  return { peak, peakDate };
}

function spiClass(spi) {
  if (spi >= 0.97) return 'spi-good';
  if (spi >= 0.88) return 'spi-warn';
  return 'spi-bad';
}

function renderProjectAnalytics() {
  const cont = document.getElementById('project-analytics');
  if (!cont) return;
  const sched = state.schedule;
  if (!sched || !sched.tasks?.length) { cont.innerHTML = ''; return; }

  const today = effectiveToday();
  const cpm = computeCriticalPath(sched);
  const evm = computeEVM(sched, today);
  state.cpmCritical = cpm.critical;

  const spiPct = (evm.SPI * 100).toFixed(0);
  const earnedPct = Math.round(evm.completionRatio * 100);
  const planPct = Math.round(evm.plannedRatio * 100);
  const slip = evm.slipDays;
  const slipLbl = slip > 1
    ? `<span class="analytics-slip analytics-slip--late">+${slip} дн. к плану</span>`
    : slip < -1
    ? `<span class="analytics-slip analytics-slip--early">${slip} дн. к плану</span>`
    : `<span class="analytics-slip analytics-slip--ok">в графике</span>`;
  const spiCls = spiClass(evm.SPI);
  const spiLbl = evm.SPI >= 0.97 ? 'идём по плану'
              : evm.SPI >= 0.88 ? 'небольшое отставание'
              : 'серьёзное отставание';

  const onCritical = cpm.critical.size;
  const totalTasks = sched.tasks.length;

  // Materials risk summary
  let matRiskTasks = 0;
  let nearestOrderBy = null;
  for (const t of sched.tasks) {
    const r = computeMaterialRisk(t);
    if (r) {
      matRiskTasks++;
      if (!nearestOrderBy || r.orderBy < nearestOrderBy) nearestOrderBy = r.orderBy;
    }
  }

  // Resources peak
  const resPeak = computeResourcePeak(sched);

  cont.innerHTML = `
    <button type="button" class="analytics-card analytics-card--spi ${spiCls}" data-analytics="spi" title="Schedule Performance Index — насколько идём по графику">
      <div class="analytics-card-label">SPI · ${spiLbl}</div>
      <div class="analytics-card-value">${spiPct}<span class="analytics-card-unit">%</span></div>
      <div class="analytics-card-meta">освоено ${earnedPct}% · план ${planPct}%</div>
    </button>
    <button type="button" class="analytics-card analytics-card--eac" data-analytics="eac" title="Прогноз даты завершения по текущему темпу">
      <div class="analytics-card-label">Прогноз сдачи</div>
      <div class="analytics-card-value">${escapeHtml(fmtDate(toISO(evm.eacDate)))}</div>
      <div class="analytics-card-meta">${slipLbl}</div>
    </button>
    <button type="button" class="analytics-card analytics-card--cpm" data-analytics="cpm" title="Задачи на критическом пути — задержка любой сдвигает срок проекта">
      <div class="analytics-card-label">Критический путь</div>
      <div class="analytics-card-value">${onCritical}<span class="analytics-card-unit"> / ${totalTasks}</span></div>
      <div class="analytics-card-meta">${onCritical === 0 ? 'нет критичных' : 'задержки сдвигают срок'}</div>
    </button>
    <button type="button" class="analytics-card analytics-card--mat${matRiskTasks > 0 ? ' analytics-card--alert' : ''}" data-analytics="materials" title="Материалы с риском по lead-time">
      <div class="analytics-card-label">Материалы в риске</div>
      <div class="analytics-card-value">${matRiskTasks}<span class="analytics-card-unit"> работ</span></div>
      <div class="analytics-card-meta">${nearestOrderBy ? 'ближайший заказ до ' + escapeHtml(fmtDate(toISO(nearestOrderBy))) : 'всё под контролем'}</div>
    </button>
    <button type="button" class="analytics-card analytics-card--res" data-analytics="resources" title="Пиковая загрузка людей по дням">
      <div class="analytics-card-label">Пик людей</div>
      <div class="analytics-card-value">${resPeak.peak}<span class="analytics-card-unit"> чел.</span></div>
      <div class="analytics-card-meta">${resPeak.peakDate ? 'на ' + escapeHtml(fmtDate(toISO(resPeak.peakDate))) : 'нет данных'}</div>
    </button>`;

  // Click → toggle filter «только критический путь»
  cont.querySelector('[data-analytics="cpm"]')?.addEventListener('click', () => {
    state.filterCriticalOnly = !state.filterCriticalOnly;
    cont.querySelector('[data-analytics="cpm"]').classList.toggle('is-active', state.filterCriticalOnly);
    applyCriticalFilterStyles();
  });
}

function applyCriticalFilterStyles() {
  const root = document.getElementById('gantt');
  if (!root) return;
  root.classList.toggle('show-critical-only', !!state.filterCriticalOnly);
}

function renderHero() {
  const p = state.schedule.project;
  document.title = `${p.name} · График работ · CYFR`;

  // Populate header meta dynamically (was hardcoded to Orange in index.html)
  const titleEl = $('#hero-title');
  if (titleEl) titleEl.textContent = p.name || 'Проект';
  const chipEl = $('#hero-chip');
  if (chipEl) chipEl.textContent = p.code ? `Контракт № ${p.code}` : 'Проект';
  const subEl = $('#hero-sub');
  if (subEl) {
    const customer = (p.customer || '').trim();
    subEl.innerHTML = customer
      ? `Отделочные работы · <strong>${escapeHtml(customer)}</strong>`
      : `Отделочные работы · <span style="color:var(--muted);font-style:italic">клиент не указан</span>`;
  }

  const start = parseISO(p.startDate),
    end = parseISO(p.endDate);
  const durDays = dayDiff(start, end) + 1;
  const asOf = effectiveToday();
  let pct = 0;
  if (asOf < start) pct = 0;
  else if (asOf > end) pct = 100;
  else pct = Math.round(((asOf - start) / (end - start)) * 100);

  $('#stat-total').textContent = fmtAED(p.totalIncVat);
  $('#stat-duration').textContent = durDays + ' ' + daysWord(durDays);
  $('#stat-dates').textContent = fmtDate(p.startDate) + ' → ' + fmtDate(p.endDate);
  $('#stat-progress').textContent = pct;
  $('#stat-today').textContent = 'на ' + fmtDate(toISO(asOf));
  $('#stat-tasks').textContent = state.schedule.tasks.length;
  const sectionCount = new Set(state.schedule.tasks.map((t) => t.section)).size;
  $('#stat-tasks-meta').textContent = `видов работ · ${sectionCount} секций`;

  // Last updated label — показываем черновой вариант из JSON, потом уточняем из git
  const upd = $('#hero-updated');
  if (upd && p.lastUpdated) {
    const d0 = new Date(p.lastUpdated);
    const t0 = d0.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const by0 = p.lastUpdatedBy ? ` · ${escapeHtml(p.lastUpdatedBy)}` : '';
    upd.innerHTML = `<span class="hero-updated-dot" aria-hidden="true"></span><span class="hero-updated-text">Обновлено ${escapeHtml(fmtRelative(d0))} · ${escapeHtml(t0)}${by0}</span>`;
    upd.title = d0.toLocaleString('ru-RU');
    // Async: уточняем реальный последний коммит файла через GitHub API
    fetchLastCommit(state.projectSlug).then((info) => {
      if (!info) return;
      const timeStr = info.date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const rel = fmtRelative(info.date);
      const by = info.author ? ` · ${escapeHtml(info.author)}` : '';
      upd.innerHTML = `<span class="hero-updated-dot" aria-hidden="true"></span><span class="hero-updated-text">Обновлено ${escapeHtml(rel)} · ${escapeHtml(timeStr)}${by}</span>`;
      const msg = info.message ? `\n${info.message}` : '';
      upd.title = info.date.toLocaleString('ru-RU') + msg;
    }).catch(() => {});
  } else if (upd) {
    upd.innerHTML = '';
  }

  renderProjectAnalytics();
}

/* Fetch last meaningful commit for this schedule from GitHub API.
 * GitHub /commits?path=... не следует за переименованиями, поэтому для
 * orange-1801 (переехал из web/schedule.json) опрашиваем оба пути и мержим. */
async function fetchLastCommit(slug) {
  if (!slug) return null;
  const paths = [`web/schedules/${slug}.json`];
  if (slug === 'orange-1801') paths.push('web/schedule.json');
  try {
    const results = await Promise.all(paths.map(async (p) => {
      const u = `https://api.github.com/repos/Serhiog/Work-Schedule-Bot/commits?path=${encodeURIComponent(p)}&per_page=10`;
      const r = await fetch(u, { headers: { 'Accept': 'application/vnd.github+json' } });
      if (!r.ok) return [];
      const arr = await r.json();
      return Array.isArray(arr) ? arr : [];
    }));
    const all = results.flat();
    if (all.length === 0) return null;
    // Сортируем по дате автора desc
    all.sort((a, b) => new Date(b.commit?.author?.date || 0) - new Date(a.commit?.author?.date || 0));
    const pick = all.find((c) => /^bot:/i.test(String(c?.commit?.message || ''))) ||
                 all.find((c) => !/^(chore|Merge)/i.test(String(c?.commit?.message || ''))) ||
                 all[0];
    const commit = pick?.commit;
    if (!commit) return null;
    const msgLine = String(commit.message || '').split('\n')[0].replace(/^bot:\s*/i, '');
    return {
      date: new Date(commit.author?.date || commit.committer?.date),
      author: commit.author?.name || commit.committer?.name || 'Bot',
      message: msgLine,
    };
  } catch (e) {
    return null;
  }
}

/* ─── task progress (0..1) ─── */
function taskProgress(t) {
  if (typeof t.progress === 'number') return Math.max(0, Math.min(1, t.progress));
  if (t.actualEnd) return 1;
  if (!t.actualStart) return 0;
  // running: estimate by elapsed time vs planned duration
  const asOf = effectiveToday();
  const pStart = parseISO(t.planStart || t.start);
  const pEnd = parseISO(t.planEnd || t.end);
  if (asOf <= pStart) return 0.01;
  if (asOf >= pEnd) return 0.95;
  return Math.max(0.01, Math.min(0.99, (asOf - pStart) / (pEnd - pStart)));
}

/* ─── stages ribbon ─── */
function stageProgress(stageId) {
  const stageTasks = state.schedule.tasks.filter((t) => t.stage === stageId);
  if (!stageTasks.length) return { pct: 0, done: 0, total: 0 };
  const done = stageTasks.filter((t) => !!t.actualEnd).length;
  return { pct: Math.round((done / stageTasks.length) * 100), done, total: stageTasks.length };
}

function renderStagesRibbon() {
  const ribbon = $('#stages-ribbon');
  const { stages } = state.schedule;

  ribbon.style.setProperty('--stages', stages.length);
  ribbon.innerHTML = stages
    .map((st) => {
      const { pct, done, total } = stageProgress(st.id);
      const fillW = Math.max(0, Math.min(100, pct));
      return `<div class="stage-bar${isLight(st.color) ? ' light' : ''}" style="--bar-color:${st.color}" title="${escapeHtml(st.name)}: ${done} из ${total} наименований">
        <div class="stage-fill" style="width:${fillW}%"></div>
        <span class="stage-name">${escapeHtml(st.name)}</span>
        <span class="stage-share">${pct}%</span>
      </div>`;
    })
    .join('');
}

/* ─── legend ─── */
function renderLegend() {
  const el = $('#legend-stages');
  el.innerHTML = state.schedule.stages
    .map(
      (st) =>
        `<div class="legend-item"><span class="chip" style="background:${st.color}"></span>${escapeHtml(st.name)}</div>`
    )
    .join('');
}

/* ─── toolbar (filter + PDF) ─── */
function renderToolbar() {
  const sel = $('#section-filter');
  if (!sel) return;
  const opts = ['<option value="">Все секции</option>'];
  for (const sec of state.schedule.sections) {
    const count = state.schedule.tasks.filter((t) => t.section === sec.id).length;
    if (!count) continue;
    opts.push(`<option value="${escapeHtml(sec.id)}">${escapeHtml(sec.name)} · ${count}</option>`);
  }
  sel.innerHTML = opts.join('');
  sel.value = state.filterSection || '';

  const subBtn = $('#filter-only-sub');
  if (subBtn) subBtn.setAttribute('data-active', state.filterSubOnly ? 'true' : 'false');
}

function applyFilterToTasks(tasks) {
  return tasks.filter((t) => {
    if (state.filterSection && t.section !== state.filterSection) return false;
    if (state.filterSubOnly) {
      const sec = state.sectionById[t.section];
      if (!sec || !sec.sub) return false;
    }
    return true;
  });
}

function updateFilterUrl() {
  const params = new URLSearchParams(window.location.search);
  if (state.filterSection) params.set('section', state.filterSection);
  else params.delete('section');
  if (state.filterSubOnly) params.set('sub', '1');
  else params.delete('sub');
  const qs = params.toString();
  const newUrl = window.location.pathname + (qs ? '?' + qs : '');
  window.history.replaceState(null, '', newUrl);
}

function scrollGanttToFilterResult() {
  const gantt = $('#gantt');
  if (!gantt) return;
  const filterActive = !!state.filterSection || state.filterSubOnly;
  if (!filterActive) {
    const p = state.schedule.project;
    const start = parseISO(p.startDate);
    const todayD = effectiveToday();
    const end = parseISO(p.endDate);
    if (todayD >= start && todayD <= end) {
      const off = dayDiff(start, todayD) * currentCellW();
      gantt.scrollLeft = Math.max(0, off - 120);
    }
    return;
  }
  const bars = gantt.querySelectorAll('.bar-plan');
  if (!bars.length) return;
  let minLeft = Infinity, maxRight = -Infinity;
  bars.forEach((b) => {
    const l = parseFloat(b.style.left) || 0;
    const w = parseFloat(b.style.width) || 0;
    if (l < minLeft) minLeft = l;
    if (l + w > maxRight) maxRight = l + w;
  });
  if (!isFinite(minLeft)) return;
  const labelW = currentLabelW();
  const viewportW = Math.max(0, gantt.clientWidth - labelW);
  const barsW = maxRight - minLeft;
  const target = barsW <= viewportW
    ? minLeft - (viewportW - barsW) / 2
    : minLeft - 24;
  gantt.scrollLeft = Math.max(0, target);
}

function attachToolbarHandlers() {
  const sel = $('#section-filter');
  if (sel) {
    sel.addEventListener('change', () => {
      state.filterSection = sel.value || null;
      updateFilterUrl();
      renderGantt();
      scrollGanttToFilterResult();
      renderTasksSheet();
    });
  }
  const subBtn = $('#filter-only-sub');
  if (subBtn) {
    subBtn.addEventListener('click', () => {
      state.filterSubOnly = !state.filterSubOnly;
      subBtn.setAttribute('data-active', state.filterSubOnly ? 'true' : 'false');
      updateFilterUrl();
      renderGantt();
      scrollGanttToFilterResult();
      renderTasksSheet();
    });
  }
  const ticketsBtn = $('#btn-tickets');
  if (ticketsBtn) {
    ticketsBtn.addEventListener('click', () => {
      state.showTickets = !state.showTickets;
      ticketsBtn.setAttribute('data-active', String(state.showTickets));
      renderGantt();
    });
  }

  const heatmapBtn = $('#btn-heatmap');
  if (heatmapBtn) {
    heatmapBtn.addEventListener('click', () => {
      state.showHeatmap = !state.showHeatmap;
      heatmapBtn.setAttribute('data-active', String(state.showHeatmap));
      renderResourceHeatmap();
    });
  }

  const printBtn = $('#btn-print');
  if (printBtn) printBtn.addEventListener('click', () => window.print());
}

/* ─── Gantt ─── */
// Minimum cellW so that labelCol + days*cellW fills the viewport width.
// Prevents an empty white gap on the right at max zoom-out.
function fitCellW(totalDays) {
  const gantt = $('#gantt');
  if (!gantt || !totalDays) return CELL_MIN;
  const w = gantt.getBoundingClientRect().width;
  if (w <= 0) return CELL_MIN;
  return Math.max(CELL_MIN, (w - currentLabelW()) / totalDays);
}

function renderGantt() {
  const gantt = $('#gantt');
  const p = state.schedule.project;
  const start = parseISO(p.startDate);
  const end = parseISO(p.endDate);
  const todayD = effectiveToday();
  const todayStripeISO = toISO(todayD);
  const totalDays = dayDiff(start, end) + 1;
  // Clamp up to fit-to-width so Gantt always fills the horizontal space
  const fit = fitCellW(totalDays);
  if (state.cellW < fit) state.cellW = fit;
  const cellW = currentCellW();
  const labelColW = currentLabelW();

  state.layout.cellW = cellW;
  state.layout.labelColW = labelColW;
  state.layout.totalDays = totalDays;
  state.layout.startISO = p.startDate;

  gantt.style.setProperty('--cell-w', cellW + 'px');
  gantt.style.setProperty('--label-col-w', labelColW + 'px');
  gantt.style.gridTemplateColumns = `${labelColW}px ${totalDays * cellW}px`;

  // ── build dates (month groups + day cells)
  const days = [];
  for (let i = 0; i < totalDays; i++) {
    days.push(new Date(start.getTime() + i * DAY_MS));
  }

  const months = [];
  let curKey = null,
    curStart = 0;
  days.forEach((d, i) => {
    const k = d.getUTCFullYear() + '-' + d.getUTCMonth();
    if (k !== curKey) {
      if (curKey !== null)
        months.push({ start: curStart, count: i - curStart, label: monthLabel(days[curStart]) });
      curKey = k;
      curStart = i;
    }
  });
  months.push({ start: curStart, count: totalDays - curStart, label: monthLabel(days[curStart]) });

  const isWeekend = (d) => {
    const dow = d.getUTCDay(); // 0=Sun … 5=Fri, 6=Sat
    return dow === 5 || dow === 6;
  };

  // ── column stripes (weekend/holiday/today) — цвета через CSS-переменные,
  // чтобы dark theme подставляла свои тона без перерендера сетки.
  const stripes = [];
  const today = todayStripeISO;
  days.forEach((d, i) => {
    const iso = toISO(d);
    let color = null;
    if (iso === today) color = 'var(--stripe-today)';
    else if (state.holidayMap.has(iso)) color = 'var(--stripe-holiday)';
    else if (isWeekend(d)) color = 'var(--stripe-weekend)';
    if (color) {
      const x = i * cellW;
      stripes.push(`${color} ${x}px ${x + cellW}px`);
    }
  });
  const stripeBg = stripes.length
    ? 'linear-gradient(90deg, ' + stripes.map((s) => `transparent 0, ${s}, transparent 0`).join(', ') + ')'
    : '';

  // Build header HTML
  const monthsHtml = months
    .map((m) => `<div class="month-cell" style="grid-column: span ${m.count}">${m.label}</div>`)
    .join('');
  const daysHtml = days
    .map((d, i) => {
      const iso = toISO(d);
      const dow = d.getUTCDay();
      const cls = ['day-cell'];
      if (isWeekend(d)) cls.push('weekend');
      if (state.holidayMap.has(iso)) cls.push('holiday');
      if (iso === today) cls.push('today');
      const dowL = ['В', 'П', 'В', 'С', 'Ч', 'П', 'С'][dow];
      const hol = state.holidayMap.get(iso);
      const titleAttr = hol ? ` title="${escapeHtml(hol)}"` : ` title="${iso}"`;
      return `<div class="${cls.join(' ')}" data-col="${i}" data-iso="${iso}"${titleAttr}>
        <span class="dow">${dowL}</span>
        <span class="dnum">${d.getUTCDate()}</span>
      </div>`;
    })
    .join('');

  const gridCols = `grid-template-columns: repeat(${totalDays}, ${cellW}px);`;

  const zoomLabel = zoomPct() + '%';
  const canOut = state.cellW > fit + 0.5;
  const canIn = state.cellW < CELL_MAX - 0.5;
  const gridW = totalDays * cellW;
  const header = `<div class="corner">
      <div class="corner-title">Виды работ · <strong style="color:var(--navy);margin-left:4px;">${state.schedule.tasks.length}</strong></div>
      <div class="zoom-btns">
        <button class="zoom-btn" id="zoom-out" title="Уменьшить масштаб" ${canOut ? '' : 'disabled'}>−</button>
        <span class="zoom-label" title="Жест щипка на трекпаде или двумя пальцами">${zoomLabel}</span>
        <button class="zoom-btn" id="zoom-in" title="Увеличить масштаб" ${canIn ? '' : 'disabled'}>+</button>
      </div>
    </div>
    <div class="dates-header" style="width:${gridW}px">
      <div class="months-row" style="${gridCols}">${monthsHtml}</div>
      <div class="days-row" style="${gridCols}">${daysHtml}</div>
    </div>`;

  // ── sections + task rows (apply filter)
  const filteredTasks = applyFilterToTasks(state.schedule.tasks);
  const tasksBySection = {};
  for (const t of filteredTasks) {
    (tasksBySection[t.section] ||= []).push(t);
  }

  let body = '';
  for (const sec of state.schedule.sections) {
    const secTasks = tasksBySection[sec.id] || [];
    if (!secTasks.length) continue;

    const isSub = !!sec.sub;
    const collapsed = state.collapsedSections.has(sec.id);
    const secId = escapeHtml(sec.id);
    body += `<div class="section-label${isSub ? ' is-sub' : ''}${collapsed ? ' section-label--collapsed' : ''}" data-section-id="${secId}" role="button" tabindex="0" aria-expanded="${collapsed ? 'false' : 'true'}" title="${collapsed ? 'Развернуть' : 'Свернуть'} группу">
      <span class="section-chevron" aria-hidden="true">▾</span>
      <span class="section-dot" style="background:${sec.color}"></span>
      ${escapeHtml(sec.name)}
      <span class="section-count">${secTasks.length}</span>
      ${isSub ? '<span class="sub-badge-sec">СУБ</span>' : ''}
    </div>`;
    body += `<div class="section-grid" data-section-id="${secId}" style="width:${gridW}px"></div>`;

    for (const t of secTasks) {
      const catColor = sec.color;
      const bTop = catColor;
      const bBot = darken(catColor, 0.22);
      const light = isLight(catColor);

      // Plan bar
      const pStart = t.planStart || t.start;
      const pEnd = t.planEnd || t.end;
      const pOffset = dayDiff(start, parseISO(pStart));
      const pDur = dayDiff(parseISO(pStart), parseISO(pEnd)) + 1;
      const pLeft = pOffset * cellW + 2;
      const pWidth = Math.max(cellW - 4, pDur * cellW - 4);

      // Fact bar (optional)
      let factHtml = '';
      if (t.actualStart) {
        const aStart = t.actualStart;
        const aEndRaw = t.actualEnd || toISO(todayD < parseISO(pEnd) ? todayD : parseISO(pEnd));
        // clamp: if no end and aStart still in future vs todayD, use aStart+1
        // handled by Math.max below
        const aOffset = dayDiff(start, parseISO(aStart));
        const aDur = Math.max(1, dayDiff(parseISO(aStart), parseISO(aEndRaw)) + 1);
        const aLeft = aOffset * cellW + 2;
        const aWidth = Math.max(cellW - 4, aDur * cellW - 4);
        const running = !t.actualEnd;
        factHtml = `<div class="bar-fact${light ? ' light' : ''}${running ? ' running' : ''}" style="left:${aLeft}px; --bar-left:${aLeft}px; width:${aWidth}px; --b-top:${bTop}; --b-bot:${bBot};" data-tid="${t.id}" title="Факт: ${escapeHtml(fmtDate(aStart))} — ${t.actualEnd ? escapeHtml(fmtDate(t.actualEnd)) : 'в работе'}">
          ${escapeHtml(t.name)}
        </div>`;
      }

      const subBadge = sec.sub ? '<span class="sub-badge">СУБ</span>' : '';
      const prog = taskProgress(t);
      const progPct = Math.round(prog * 100);
      let progBadge = '';
      if (prog >= 1) progBadge = '<span class="pbadge pbadge-done" title="Завершено">100%</span>';
      else if (prog > 0) progBadge = `<span class="pbadge" title="Выполнено ${progPct}%">${progPct}%</span>`;

      const hidden = collapsed ? ' row-hidden' : '';
      const isCritical = state.cpmCritical && state.cpmCritical.has(t.id);
      const critCls = isCritical ? ' task-critical' : '';
      const critBadge = isCritical ? '<span class="task-crit-badge" title="На критическом пути — задержка сдвигает срок проекта">⚠ КП</span>' : '';
      const matRisk = computeMaterialRisk(t);
      const matBadge = matRisk
        ? `<span class="task-mat-badge" title="Заказать до ${escapeHtml(fmtDate(toISO(matRisk.orderBy)))} · ${matRisk.riskyCount} материалов в риске">📦 ${matRisk.daysToStart > 0 ? '−' + (matRisk.maxLead - matRisk.daysToStart) + 'д' : 'срочно'}</span>`
        : '';
      body += `<div class="task-label${hidden}${critCls}" data-tid="${t.id}" data-section-id="${secId}" tabindex="0">
        <span class="tbullet" style="background:${catColor}"></span>
        <span class="tid">${escapeHtml(t.id)}</span>
        <span class="tname" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
        ${critBadge}
        ${matBadge}
        ${progBadge}
        ${subBadge}
        <button class="task-open-btn" data-tid="${t.id}" tabindex="-1" title="Подробнее" aria-label="Открыть детали: ${escapeHtml(t.name)}">→</button>
      </div>`;
      const progFill = prog > 0 ? `<div class="bar-plan-progress" style="width:${progPct}%; background:${bTop}" aria-hidden="true"></div>` : '';
      const ticketBadge = buildTaskTicketBadge(t.id, pLeft, pWidth);
      body += `<div class="task-grid${hidden}${critCls}" data-tid="${t.id}" data-section-id="${secId}" style="width:${gridW}px; background-image: ${stripeBg ? stripeBg + ', ' : ''}linear-gradient(to right, var(--line-2) 1px, transparent 1px); background-size: auto, ${cellW}px 100%;">
        <div class="bar-plan${light ? ' light' : ''}" style="left:${pLeft}px; --bar-left:${pLeft}px; width:${pWidth}px; --b-top:${bTop}; --b-bot:${bBot};" data-tid="${t.id}" title="План: ${escapeHtml(fmtDate(pStart))} — ${escapeHtml(fmtDate(pEnd))} · ${progPct}%">
          ${progFill}
          <span class="bar-plan-text">${escapeHtml(t.name)}</span>
        </div>
        ${factHtml}
        ${ticketBadge}
      </div>`;
    }
  }

  // Preserve scroll position across re-renders (e.g. iOS resize from toolbar show/hide)
  const prevScrollLeft = gantt.scrollLeft;
  const prevScrollTop = gantt.scrollTop;

  // preserve overlays container (it's already in the DOM)
  const overlays = $('#gantt-overlays');
  gantt.innerHTML = header + body;
  if (overlays) gantt.appendChild(overlays);

  if (state.initialScrollDone) {
    gantt.scrollLeft = prevScrollLeft;
    gantt.scrollTop = prevScrollTop;
  }

  // Auto-pin today's column (background stripe is handled via column-stripes gradient)
  const todayIdx = days.findIndex((d) => toISO(d) === today);
  if (todayIdx >= 0) state.pinCol = todayIdx;

  // ── click handlers: bars → drawer; label → pin row; open-btn → drawer
  gantt.querySelectorAll('.bar-plan, .bar-fact').forEach((el) => {
    el.addEventListener('click', (e) => {
      const tid = el.getAttribute('data-tid');
      if (tid) openDrawer(tid);
      e.stopPropagation();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const tid = el.getAttribute('data-tid');
        if (tid) openDrawer(tid);
      }
    });
  });
  // open-btn inside each task-label
  gantt.querySelectorAll('.task-open-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const tid = btn.getAttribute('data-tid');
      if (tid) openDrawer(tid);
      e.stopPropagation();
    });
  });
  // Ticket badge → open drawer
  gantt.querySelectorAll('.tk-badge').forEach((el) => {
    el.addEventListener('click', (e) => {
      const tid = el.getAttribute('data-task-id');
      if (tid) openDrawer(tid);
      e.stopPropagation();
    });
  });
  // Section-label click → toggle collapse
  gantt.querySelectorAll('.section-label').forEach((el) => {
    const toggle = () => {
      const sid = el.getAttribute('data-section-id');
      if (!sid) return;
      if (state.collapsedSections.has(sid)) state.collapsedSections.delete(sid);
      else state.collapsedSections.add(sid);
      applyCollapsedState();
    };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  // ── zoom buttons (snap to nearest preset, anchored at viewport center)
  const zoomOut = $('#zoom-out'), zoomIn = $('#zoom-in');
  const snapZoom = (dir) => {
    const cur = state.cellW;
    const next = dir < 0
      ? [...ZOOM_PRESETS].reverse().find((x) => x < cur - 0.5)
      : ZOOM_PRESETS.find((x) => x > cur + 0.5);
    const target = clampCell(next ?? (dir < 0 ? CELL_MIN : CELL_MAX));
    const rect = gantt.getBoundingClientRect();
    zoomTo(target, rect.left + rect.width / 2);
  };
  if (zoomOut) zoomOut.addEventListener('click', (e) => { e.stopPropagation(); snapZoom(-1); });
  if (zoomIn) zoomIn.addEventListener('click', (e) => { e.stopPropagation(); snapZoom(+1); });

  // ── scroll to today (or to filtered bars) — only on first render
  if (!state.initialScrollDone) {
    state.initialScrollDone = true;
    requestAnimationFrame(() => {
      if (state.filterSection || state.filterSubOnly) {
        scrollGanttToFilterResult();
        return;
      }
      const todayDate = parseISO(today);
      if (todayDate >= start && todayDate <= end) {
        const off = dayDiff(start, todayDate) * cellW;
        gantt.scrollLeft = Math.max(0, off - 120);
      }
    });
  }
}

/* ─── Zoom gestures: trackpad pinch (wheel+ctrl) + touch pinch ─── */
function zoomTo(newCellW, anchorClientX) {
  const gantt = $('#gantt');
  if (!gantt) return;
  const rect = gantt.getBoundingClientRect();
  const cursorX = Math.max(0, Math.min(rect.width, anchorClientX - rect.left));
  const labelW = currentLabelW();
  const oldCellW = state.cellW;
  const contentX = gantt.scrollLeft + cursorX;
  const dayAtCursor = Math.max(0, (contentX - labelW) / oldCellW);
  const target = clampCell(newCellW);
  if (Math.abs(target - oldCellW) < 0.01) return;
  state.cellW = target;
  renderGantt();
  const newContentX = labelW + dayAtCursor * state.cellW;
  gantt.scrollLeft = Math.max(0, newContentX - cursorX);
}

/* ─── Print / PDF export ─── */
// When beforeprint fires, @media print is already active:
//   - .gantt-wrap is position:static, height:auto, margin:0
//   - .page is max-width:none, padding:0
// So getBoundingClientRect on the wrap returns the ACTUAL print page usable width —
// regardless of whether it's A4, A3 or any other paper the OS/printer chooses.
// We use that width to compute the exact cellW that fills the page with no dead zone.
function attachPrintHandlers() {
  const PRINT_LABEL_W = 260;
  const PRINT_CELL_MIN = 6;
  const PRINT_FALLBACK_PX = 1047; // A4 landscape @ 96dpi minus 10mm margins — safe fallback

  let savedCellW = null;
  let active = false;

  const enterPrint = () => {
    if (active) return;
    active = true;
    savedCellW = state.cellW;
    document.body.classList.add('is-printing');
    const totalDays = state.layout.totalDays || 120;

    // A4 landscape usable width: (297 - 20mm margins) × 96dpi/25.4 ≈ 1047px.
    // BCR returns screen width (not paper width) and must NOT be used here.
    const fit = Math.max(PRINT_CELL_MIN, (PRINT_FALLBACK_PX - PRINT_LABEL_W) / totalDays);
    state.cellW = fit;
    renderGantt();
  };
  const exitPrint = () => {
    if (!active) return;
    active = false;
    document.body.classList.remove('is-printing');
    if (savedCellW != null) {
      state.cellW = savedCellW;
      savedCellW = null;
      renderGantt();
    }
  };

  window.addEventListener('beforeprint', enterPrint);
  window.addEventListener('afterprint', exitPrint);
  // Safari / iOS fallback: print media-query change fires when browser transitions.
  const mql = window.matchMedia('print');
  const onMQ = (e) => { if (e.matches) enterPrint(); else exitPrint(); };
  if (mql.addEventListener) mql.addEventListener('change', onMQ);
  else if (mql.addListener) mql.addListener(onMQ);
}

function attachGanttGestures() {
  const gantt = $('#gantt');
  if (!gantt) return;

  // rAF batch: accumulate multiplicative factor across events, or hold latest absolute target.
  // Wheel events compound (factor *= ...); touch sets absolute each frame (overwrite).
  let rafPending = false;
  let pendingFactor = 1;
  let pendingAbs = null;
  let pendingX = null;
  const kick = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const target = pendingAbs != null ? pendingAbs : state.cellW * pendingFactor;
      if (Math.abs(target - state.cellW) > 0.01) zoomTo(target, pendingX);
      pendingFactor = 1; pendingAbs = null; pendingX = null;
    });
  };
  const queueFactor = (f, x) => { pendingFactor *= f; pendingAbs = null; pendingX = x; kick(); };
  const queueAbs = (w, x) => { pendingAbs = w; pendingFactor = 1; pendingX = x; kick(); };

  // Trackpad pinch on macOS / Windows precision touchpads fires wheel + ctrlKey
  gantt.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    queueFactor(Math.exp(-e.deltaY * 0.01), e.clientX);
  }, { passive: false });

  // Safari desktop: gesture events as fallback (e.scale is cumulative vs gesturestart)
  let gestureStartCellW = null;
  gantt.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    gestureStartCellW = state.cellW;
  });
  gantt.addEventListener('gesturechange', (e) => {
    if (gestureStartCellW == null) return;
    e.preventDefault();
    queueAbs(gestureStartCellW * e.scale, e.clientX);
  });
  gantt.addEventListener('gestureend', () => { gestureStartCellW = null; });

  // Touch pinch: two-finger zoom on mobile / touchscreens
  let pinch = null;
  const dist = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
  const mid = (ts) => (ts[0].clientX + ts[1].clientX) / 2;
  gantt.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    pinch = { d0: dist(e.touches), w0: state.cellW };
  }, { passive: false });
  gantt.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const d = dist(e.touches);
    if (pinch.d0 < 1) return;
    queueAbs(pinch.w0 * (d / pinch.d0), mid(e.touches));
  }, { passive: false });
  const endPinch = (e) => { if (!e.touches || e.touches.length < 2) pinch = null; };
  gantt.addEventListener('touchend', endPinch);
  gantt.addEventListener('touchcancel', endPinch);

  // Mobile: reveal hero on downward swipe when gantt is at top.
  // Register the non-passive touchmove listener ONLY while routing is armed —
  // a static passive:false touchmove on a scroll container causes iOS scroll jank
  // for every swipe, even when no routing is needed.
  const pageEl = document.querySelector('.page');
  let sOneY = 0;
  let sOnePageScroll = 0;
  let activeRouteHandler = null;
  const disarmRouteHandler = () => {
    if (activeRouteHandler) {
      gantt.removeEventListener('touchmove', activeRouteHandler, { passive: false });
      activeRouteHandler = null;
    }
  };
  gantt.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || !isMobile() || !pageEl) return;
    // Arm routing only when hero is hidden (page scrolled) AND gantt is at top
    if (!(pageEl.scrollTop > 0 && gantt.scrollTop <= 0)) { disarmRouteHandler(); return; }
    sOneY = e.touches[0].clientY;
    sOnePageScroll = pageEl.scrollTop;
    disarmRouteHandler();
    activeRouteHandler = (ev) => {
      if (ev.touches.length !== 1) return;
      const dy = ev.touches[0].clientY - sOneY;
      if (dy > 0) {
        ev.preventDefault();
        pageEl.scrollTop = Math.max(0, sOnePageScroll - dy);
      } else if (dy < -4) {
        // User switched to upward swipe → disarm, let gantt scroll naturally
        disarmRouteHandler();
      }
    };
    gantt.addEventListener('touchmove', activeRouteHandler, { passive: false });
  }, { passive: true });
  gantt.addEventListener('touchend', disarmRouteHandler);
  gantt.addEventListener('touchcancel', disarmRouteHandler);
}

/* ─── highlight: row/col hover + pin + intersection ─── */
function attachHighlightHandlers() {
  const gantt = $('#gantt');
  if (!gantt) return;

  // Column hover/pin — listen on day-cell
  gantt.addEventListener('mouseover', (e) => {
    const day = e.target.closest('.day-cell');
    if (day) {
      const col = parseInt(day.getAttribute('data-col'), 10);
      state.hoverCol = col;
      updateOverlays();
      return;
    }
    const row = e.target.closest('.task-label, .task-grid');
    if (row) {
      state.hoverRow = row.getAttribute('data-tid');
      updateOverlays();
    }
  });
  gantt.addEventListener('mouseout', (e) => {
    // only clear if actually leaving the element (not moving to child)
    const to = e.relatedTarget;
    if (e.target.closest('.day-cell')) {
      if (!to || !to.closest('.day-cell')) {
        state.hoverCol = null;
        updateOverlays();
      }
      return;
    }
    if (e.target.closest('.task-label, .task-grid')) {
      if (!to || !to.closest('.task-label, .task-grid')) {
        state.hoverRow = null;
        updateOverlays();
      }
    }
  });

  // Click on day-cell → toggle col pin; click on task-label → toggle row pin
  gantt.addEventListener('click', (e) => {
    if (e.target.closest('.task-open-btn')) return; // handled separately
    const day = e.target.closest('.day-cell');
    if (day) {
      const col = parseInt(day.getAttribute('data-col'), 10);
      state.pinCol = state.pinCol === col ? null : col;
      refreshPinnedClasses();
      updateOverlays();
      e.stopPropagation();
      return;
    }
    const label = e.target.closest('.task-label');
    if (label) {
      const tid = label.getAttribute('data-tid');
      state.pinRow = state.pinRow === tid ? null : tid;
      refreshPinnedClasses();
      updateOverlays();
      e.stopPropagation();
    }
  });

  // Reflow on scroll / resize (overlay is inside gantt so scrolling handles it;
  // but pinned overlays need re-positioning if window resizes)
  window.addEventListener('resize', updateOverlays);
}

function refreshPinnedClasses() {
  $('#gantt').querySelectorAll('.day-cell.pinned').forEach((el) => el.classList.remove('pinned'));
  $('#gantt').querySelectorAll('.task-label.pinned').forEach((el) => el.classList.remove('pinned'));
  if (state.pinCol != null) {
    const c = $('#gantt').querySelector(`.day-cell[data-col="${state.pinCol}"]`);
    if (c) c.classList.add('pinned');
  }
  if (state.pinRow != null) {
    const r = $('#gantt').querySelector(`.task-label[data-tid="${state.pinRow}"]`);
    if (r) r.classList.add('pinned');
  }
}

function updateOverlays() {
  const gantt = $('#gantt');
  if (!gantt) return;
  const cellW = state.layout.cellW;
  const labelColW = state.layout.labelColW;
  const contentH = gantt.scrollHeight;
  const contentW = gantt.scrollWidth;

  const set = (el, vis, pos) => {
    if (!el) return;
    el.classList.toggle('visible', vis);
    if (vis && pos) {
      el.style.left = (pos.left != null ? pos.left : 0) + 'px';
      el.style.top = (pos.top != null ? pos.top : 0) + 'px';
      el.style.width = pos.width != null ? pos.width + 'px' : '';
      el.style.height = pos.height != null ? pos.height + 'px' : '';
    }
  };

  // Columns: full content height, single column wide
  const colRect = (col) => ({
    left: labelColW + col * cellW,
    width: cellW,
    top: 0,
    height: contentH,
  });

  // Rows: spans the right pane only (label column handled via class)
  const rowRect = (tid) => {
    const row = gantt.querySelector(`.task-grid[data-tid="${tid}"]`);
    if (!row) return null;
    const r = row.getBoundingClientRect();
    const g = gantt.getBoundingClientRect();
    return {
      top: r.top - g.top + gantt.scrollTop,
      height: r.height,
      left: labelColW,
      width: contentW - labelColW,
    };
  };

  // Keep label + day-cell classes in sync for visual feedback on sticky cols
  gantt.querySelectorAll('.task-label.hovered, .day-cell.hovered').forEach((el) => el.classList.remove('hovered'));
  if (state.hoverRow && state.hoverRow !== state.pinRow) {
    const l = gantt.querySelector(`.task-label[data-tid="${state.hoverRow}"]`);
    if (l) l.classList.add('hovered');
  }
  if (state.hoverCol != null && state.hoverCol !== state.pinCol) {
    const d = gantt.querySelector(`.day-cell[data-col="${state.hoverCol}"]`);
    if (d) d.classList.add('hovered');
  }

  const showHoverCol = state.hoverCol != null && state.hoverCol !== state.pinCol;
  set($('#col-hover'), showHoverCol, showHoverCol ? colRect(state.hoverCol) : null);

  const showPinCol = state.pinCol != null;
  set($('#col-pinned'), showPinCol, showPinCol ? colRect(state.pinCol) : null);

  const showHoverRow = state.hoverRow && state.hoverRow !== state.pinRow;
  const hRow = showHoverRow ? rowRect(state.hoverRow) : null;
  set($('#row-hover'), !!hRow, hRow);

  const showPinRow = !!state.pinRow;
  const pRow = showPinRow ? rowRect(state.pinRow) : null;
  set($('#row-pinned'), !!pRow, pRow);

  const showIntersect = state.pinCol != null && state.pinRow != null && pRow;
  if (showIntersect) {
    set($('#intersection'), true, {
      left: labelColW + state.pinCol * cellW - 2,
      top: pRow.top - 2,
      width: cellW + 4,
      height: pRow.height + 4,
    });
  } else {
    set($('#intersection'), false);
  }
}

/* ─── drawer ─── */
const kv = (k, v, opts = {}) =>
  `<div${opts.span ? ' class="drawer-span"' : ''}><div class="drawer-k">${escapeHtml(k)}</div><div class="drawer-v${opts.big ? ' big' : ''}">${v}</div></div>`;

function openDrawer(tid) {
  const t = state.schedule.tasks.find((x) => x.id === tid);
  if (!t) return;
  const st = state.stageById[t.stage];
  const sec = state.sectionById[t.section];
  const pStart = t.planStart || t.start;
  const pEnd = t.planEnd || t.end;
  const pStartD = parseISO(pStart);
  const pEndD = parseISO(pEnd);
  const plannedDur = dayDiff(pStartD, pEndD) + 1;
  const asOf = effectiveToday();

  let status = 'not-started', statusLabel = 'Не начата';
  if (t.actualEnd) { status = 'done'; statusLabel = 'Завершена'; }
  else if (t.actualStart) { status = 'running'; statusLabel = 'В работе'; }
  const isOverdue = !t.actualEnd && asOf > pEndD;
  if (isOverdue && status !== 'done') { status = 'overdue'; statusLabel = 'Просрочена'; }

  const prog = taskProgress(t);
  const progPct = Math.round(prog * 100);

  // Metrics
  const daysOverdue = isOverdue ? dayDiff(pEndD, asOf) : 0;
  const startDelay = t.actualStart ? Math.max(0, dayDiff(pStartD, parseISO(t.actualStart))) : 0;
  let actualDur = null;
  if (t.actualStart && t.actualEnd) actualDur = dayDiff(parseISO(t.actualStart), parseISO(t.actualEnd)) + 1;
  const daysInWork = (t.actualStart && !t.actualEnd)
    ? Math.max(1, dayDiff(parseISO(t.actualStart), asOf) + 1) : 0;
  const daysRemaining = (status === 'running' && !isOverdue) ? Math.max(0, dayDiff(asOf, pEndD)) : 0;

  $('#drawer-tag').innerHTML = `<span class="drawer-tag-dot" style="background:${sec.color}"></span>${escapeHtml(sec.name)} · ${escapeHtml(st.name)}`;
  $('#drawer-title').textContent = t.name;

  const factRange = t.actualStart
    ? `${fmtDate(t.actualStart)} → ${t.actualEnd ? fmtDate(t.actualEnd) : 'в работе'}`
    : '—';

  const contractorLabel = sec.sub ? 'Субподрядчик' : 'CYFR FITOUT';

  // Progress color by status
  const progColor = status === 'done' ? '#15803d'
    : status === 'overdue' ? '#b42318'
    : status === 'running' ? sec.color
    : 'var(--muted-2)';

  // Build metric chips — only show relevant ones
  const metrics = [];
  if (status === 'done') {
    metrics.push({ val: '✓', lbl: 'завершена', mod: 'ok' });
    if (actualDur != null) {
      const delta = actualDur - plannedDur;
      const deltaStr = delta === 0 ? 'в срок' : (delta > 0 ? `+${delta} ${daysWord(delta)} к плану` : `${delta} ${daysWord(Math.abs(delta))} раньше`);
      metrics.push({ val: actualDur, lbl: 'дней факт · ' + deltaStr });
    }
  } else {
    if (isOverdue) metrics.push({ val: daysOverdue, lbl: 'дней просрочки · ' + daysWord(daysOverdue), mod: 'warn' });
    if (startDelay > 0) metrics.push({ val: '+' + startDelay, lbl: 'задержка старта · ' + daysWord(startDelay) });
    if (daysInWork > 0) metrics.push({ val: daysInWork, lbl: 'дней в работе' });
    if (status === 'running' && daysRemaining > 0) metrics.push({ val: daysRemaining, lbl: 'до дедлайна · ' + daysWord(daysRemaining) });
    if (status === 'not-started') {
      const daysUntilStart = Math.max(0, dayDiff(asOf, pStartD));
      metrics.push({ val: daysUntilStart, lbl: daysUntilStart === 0 ? 'старт сегодня' : 'дней до старта' });
    }
  }

  const metricsHtml = metrics.map((m) =>
    `<div class="drawer-metric${m.mod ? ' drawer-metric--' + m.mod : ''}">
      <div class="drawer-metric-val">${escapeHtml(String(m.val))}</div>
      <div class="drawer-metric-lbl">${escapeHtml(m.lbl)}</div>
    </div>`).join('');

  $('#drawer-body').innerHTML = `
    <div class="drawer-status drawer-status--${status}">${escapeHtml(statusLabel)}</div>

    <div class="drawer-progress-block">
      <div class="drawer-progress-head">
        <span class="drawer-progress-pct">${progPct}%</span>
        <span class="drawer-progress-lbl">${status === 'done' ? 'выполнено' : status === 'not-started' ? 'прогресс' : 'выполнено'}</span>
      </div>
      <div class="drawer-progress"><div class="drawer-progress-fill" style="width:${progPct}%; background:${progColor}"></div></div>
    </div>

    ${metricsHtml ? `<div class="drawer-metrics">${metricsHtml}</div>` : ''}

    <div class="drawer-grid">
      ${kv('Исполнитель', escapeHtml(contractorLabel))}
      ${kv('Этап', escapeHtml(st.name))}
      ${kv('План', fmtDate(pStart) + ' → ' + fmtDate(pEnd), { span: true })}
      ${kv('Факт', escapeHtml(factRange), { span: true })}
      ${kv('Длительность (план)', plannedDur + ' ' + daysWord(plannedDur))}
      ${kv('Длительность (факт)', actualDur != null ? (actualDur + ' ' + daysWord(actualDur)) : (daysInWork > 0 ? (daysInWork + ' ' + daysWord(daysInWork) + ' · в работе') : '—'))}
    </div>${buildDrawerDelaysHtml(t)}${buildDrawerResourcesHtml(t.id)}${buildDrawerMaterialsHtml(t.id)}${buildDrawerTaskMeetingNotesHtml(t.id)}${buildDrawerTicketsHtml(t.id)}${buildDrawerHistoryHtml(t)}`;

  attachTicketHandlers();
  attachResourceMaterialHandlers(t.id);
  $('#drawer').setAttribute('aria-hidden', 'false');
}

// Per-task photo store: taskId → File[]
const ticketPhotoStore = {};
const ticketViewState = {}; // { [taskId]: { filter: 'all', sort: 'deadline' } }

const TICKET_STATUS_LABEL = {
  open:        'Открыт',
  in_review:   'На проверке',
  in_progress: 'В работе',
  deferred:    'Отложен',
  resolved:    'Закрыт',
  rejected:    'Отклонён'
};
const TICKET_STATUSES = ['open', 'in_review', 'in_progress', 'deferred', 'resolved', 'rejected'];

const TICKET_SORT_LABEL = {
  deadline: 'По дедлайну',
  status: 'По статусу',
  created: 'По дате',
  updated_recent: 'Свежие апдейты',
  updated_old: 'Давние апдейты'
};
const STATUS_URGENCY = { in_progress: 0, open: 1, in_review: 2, deferred: 3, resolved: 4, rejected: 5 };

function buildTicketCards(taskId) {
  const vs = ticketViewState[String(taskId)] || { filter: 'all', sort: 'deadline' };
  const today = new Date().toISOString().slice(0, 10);
  let list = state.tickets.filter((tk) => tk.task_id === String(taskId));
  if (vs.filter !== 'all') list = list.filter((tk) => tk.status === vs.filter);

  // Фильтр по ответственным — если выбран хотя бы один
  const aFilter = vs.assigneeFilter instanceof Set
    ? vs.assigneeFilter
    : new Set(Array.isArray(vs.assigneeFilter) ? vs.assigneeFilter : []);
  if (aFilter.size) {
    list = list.filter((tk) => {
      const owned = getTicketAssignees(tk.id);
      if (!owned.length) return aFilter.has('__none__');
      return owned.some((n) => aFilter.has(n));
    });
  }

  list = [...list].sort((a, b) => {
    if (vs.sort === 'deadline') {
      // overdue first, then by date asc, null last
      const aOver = a.due_date && a.due_date < today && a.status !== 'resolved';
      const bOver = b.due_date && b.due_date < today && b.status !== 'resolved';
      if (aOver !== bOver) return aOver ? -1 : 1;
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
    }
    if (vs.sort === 'status') {
      return (STATUS_URGENCY[a.status] ?? 9) - (STATUS_URGENCY[b.status] ?? 9);
    }
    if (vs.sort === 'updated_recent') {
      // Свежие апдейты сверху; тикеты без апдейтов — в конец (сортированы по created_at DESC)
      const au = getTicketLastUpdateAt(a.id);
      const bu = getTicketLastUpdateAt(b.id);
      if (au && !bu) return -1;
      if (!au && bu) return 1;
      if (au && bu) return au < bu ? 1 : au > bu ? -1 : 0;
      // оба без апдейтов — по created_at DESC
      return (b.created_at || '') > (a.created_at || '') ? 1 : -1;
    }
    if (vs.sort === 'updated_old') {
      // Давно не обновляли сверху. Тикеты без апдейтов используют created_at как "последнюю активность".
      const au = getTicketLastUpdateAt(a.id) || a.created_at || '';
      const bu = getTicketLastUpdateAt(b.id) || b.created_at || '';
      if (!au && !bu) return 0;
      if (!au) return 1;
      if (!bu) return -1;
      return au < bu ? -1 : au > bu ? 1 : 0;
    }
    // created — newest first
    return (b.created_at || '') > (a.created_at || '') ? 1 : -1;
  });

  if (!list.length) {
    return `<div class="ticket-empty">${vs.filter === 'all' ? 'Тикетов нет' : 'Нет тикетов с таким статусом'}</div>`;
  }

  return list.map((tk) => {
    const tid = escapeHtml(String(taskId));
    const photosHtml = tk.photos.map((p) =>
      `<button class="ticket-photo-btn" data-url="${escapeHtml(p.url)}" type="button">
         <img src="${escapeHtml(p.thumb || p.url)}" class="ticket-photo" alt="" loading="lazy" />
       </button>`
    ).join('');
    const descClean = tk.description.replace(/\[task:\w+\]/gi, '').trim();
    const statusOpts = TICKET_STATUSES.map((s) =>
      `<option value="${s}"${tk.status === s ? ' selected' : ''}>${escapeHtml(TICKET_STATUS_LABEL[s] || s)}</option>`
    ).join('');
    const isOverdue = tk.due_date && tk.due_date < today && tk.status !== 'resolved';
    const dueLabel = tk.due_date
      ? `<span class="ticket-due${isOverdue ? ' ticket-due--overdue' : ''}">
           ${tk.status === 'resolved' ? '✓' : isOverdue ? '🔴' : '⏱'} срок: ${escapeHtml(fmtDate(tk.due_date))}
         </span>`
      : '';
    const isSelected = vs.selectionMode && (vs.selectedIds || new Set()).has(tk.id);
    const tkAssignees = getTicketAssignees(tk.id);
    const assigneeBadge = tkAssignees.length
      ? `<div class="ticket-assignees">👤 ${tkAssignees.map(escapeHtml).join(', ')}</div>`
      : '';
    const lastUpdAt = getTicketLastUpdateAt(tk.id);
    const updatesCount = getTicketUpdates(tk.id).length;
    const updateBadge = lastUpdAt
      ? `<div class="ticket-last-update" title="Всего апдейтов: ${updatesCount}">🕑 Апдейт: ${escapeHtml(fmtUpdateDateShort(lastUpdAt))}${updatesCount > 1 ? ` · ${updatesCount}` : ''}</div>`
      : '';
    const meetingNotesArr = getTicketMeetingNotes(tk.id);
    const meetingBadge = meetingNotesArr.length
      ? `<div class="meeting-badge" title="Из планёрок: ${meetingNotesArr.length}">📋 Планёрки · ${meetingNotesArr.length}</div>`
      : '';
    return `<div class="ticket-card ticket-card--${escapeHtml(tk.status)}${isSelected ? ' ticket-card--selected' : ''}" data-ticket-id="${escapeHtml(tk.id)}" data-task-id="${tid}">
      ${vs.selectionMode ? `<span class="ticket-select-mark${isSelected ? ' ticket-select-mark--on' : ''}" aria-hidden="true">${isSelected ? '✓' : ''}</span>` : ''}
      <div class="ticket-card-head">
        <span class="ticket-status-dot"></span>
        <span class="ticket-card-title">${escapeHtml((tk.title || '').replace(/\[task:\w+\]/gi, '').trim() || tk.title || '')}</span>
        <span class="ticket-card-meta">${tk.created_at ? escapeHtml(fmtDate(tk.created_at)) : ''}</span>
      </div>
      ${descClean ? `<div class="ticket-card-desc">${escapeHtml(descClean)}</div>` : ''}
      ${dueLabel}
      ${assigneeBadge}
      ${updateBadge}
      ${meetingBadge}
      ${tk.creator ? `<div class="ticket-card-creator">${escapeHtml(tk.creator)}</div>` : ''}
      ${photosHtml ? `<div class="ticket-photos">${photosHtml}</div>` : ''}
      <div class="ticket-card-actions">
        <select class="ticket-status-select" data-ticket-id="${escapeHtml(tk.id)}" data-task-id="${tid}" aria-label="Статус тикета">
          ${statusOpts}
        </select>
        <button class="ticket-edit-btn" data-ticket-id="${escapeHtml(tk.id)}" title="Редактировать тикет">✎</button>
      </div>
    </div>`;
  }).join('');
}

// ── История изменений задачи (audit log) ──
const HISTORY_TYPE_LABEL = {
  mark_complete: 'завершена',
  mark_started: 'начата',
  mark_cancelled: 'отменена',
  set_progress: 'прогресс',
  shift_dates: 'сдвиг дат',
  set_dates: 'даты',
  set_duration: 'длительность',
  bulk_shift_section: 'сдвиг раздела',
  add_delay: 'задержка',
  add_note: 'заметка',
  add_task: 'создана',
  remove_task: 'удалена',
  rename_task: 'переименована',
  move_task_section: 'перенос',
  set_contractor: 'подрядчик',
  set_section_contractor: 'подрядчик раздела',
  add_section: 'раздел добавлен',
  rename_section: 'раздел переименован',
  remove_section: 'раздел удалён',
  add_milestone: 'майлстоун'
};
function fmtHistoryAt(iso) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = d.toLocaleString('ru-RU', { month: 'short' }).replace('.', '');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd} ${mm}, ${hh}:${mi}`;
  } catch (e) { return String(iso); }
}
function buildDrawerHistoryHtml(t) {
  const hist = Array.isArray(t.history) ? t.history : [];
  if (!hist.length) return '';
  const rows = hist.slice().reverse().map((h) => {
    const typeLbl = HISTORY_TYPE_LABEL[h.type] || h.type || '';
    return `<div class="drawer-hist-row">
      <div class="drawer-hist-meta">
        <span class="drawer-hist-at">${escapeHtml(fmtHistoryAt(h.at))}</span>
        <span class="drawer-hist-by">${escapeHtml(h.by || '—')}</span>
        <span class="drawer-hist-type">${escapeHtml(typeLbl)}</span>
      </div>
      <div class="drawer-hist-sum">${escapeHtml(h.summary || '')}</div>
    </div>`;
  }).join('');
  return `
    <details class="drawer-history">
      <summary class="drawer-history-toggle"><span class="drawer-history-ico">🕐</span>История изменений <span class="drawer-history-count">${hist.length}</span></summary>
      <div class="drawer-history-list">${rows}</div>
    </details>`;
}

function buildDrawerDelaysHtml(t) {
  const delays = Array.isArray(t.delays) ? t.delays : [];
  if (!delays.length) return '';
  const totalDays = delays.reduce((s, d) => s + (Number(d.days) || 0), 0);
  const rows = delays.slice().reverse().map((d) => {
    const daysNum = Number(d.days) || 0;
    const sign = daysNum > 0 ? '+' : '';
    const dtLbl = d.dateType === 'actual' ? 'факт' : d.dateType === 'both' ? 'план+факт' : 'план';
    const reason = (d.reason || '').trim() || '— без указания причины';
    return `<div class="drawer-delay-row">
      <div class="drawer-delay-head">
        <span class="drawer-delay-days">${sign}${daysNum} дн.</span>
        <span class="drawer-delay-date">${fmtDate(d.date)}</span>
        <span class="drawer-delay-type">${dtLbl}</span>
      </div>
      <div class="drawer-delay-reason">${escapeHtml(reason)}</div>
    </div>`;
  }).join('');
  return `
    <div class="drawer-section-title">История задержек · всего +${totalDays} дн.</div>
    <div class="drawer-delays">${rows}</div>`;
}

function buildDrawerResourcesHtml(taskId) {
  const tid = String(taskId);
  const resources = getTaskResources(tid);
  const rows = resources.map((r, idx) => `
    <div class="resource-row" data-row-idx="${idx}">
      <select class="resource-type-select" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}">
        ${RESOURCE_TYPES.map(rt => `<option value="${rt.id}"${r.type === rt.id ? ' selected' : ''}>${escapeHtml(rt.label)}</option>`).join('')}
      </select>
      <input type="number" min="1" max="99" class="resource-count-input" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}" value="${r.count || 1}" />
      <button type="button" class="resource-row-del" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}" title="Убрать">✕</button>
    </div>`).join('');
  return `
    <div class="drawer-section-title">Ресурсы / люди</div>
    <div class="resources-block" data-task-id="${escapeHtml(tid)}">
      <div class="resources-rows" id="resources-rows-${escapeHtml(tid)}">${rows || '<div class="resources-empty">Нет назначений (используется дефолт по типу работы)</div>'}</div>
      <button type="button" class="resource-add-btn" data-task-id="${escapeHtml(tid)}">+ Добавить специалиста</button>
    </div>`;
}

function buildDrawerMaterialsHtml(taskId) {
  const tid = String(taskId);
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === tid);
  const materials = getTaskMaterials(tid);
  const risk = t ? computeMaterialRisk(t) : null;

  const riskBanner = risk
    ? `<div class="materials-risk-banner">⚠️ Заказать до <strong>${escapeHtml(fmtDate(toISO(risk.orderBy)))}</strong> — ${risk.riskyCount} из ${risk.totalCount} ещё не оформлены, lead-time ${risk.maxLead} дн.</div>`
    : '';

  const rows = materials.map((m, idx) => `
    <div class="material-row${m.ordered ? ' material-row--ordered' : ''}" data-row-idx="${idx}">
      <input type="text" class="material-name-input" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}" value="${escapeHtml(m.name || '')}" placeholder="Название материала" />
      <input type="number" min="0" max="120" class="material-leadtime-input" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}" value="${m.leadTime || 0}" title="Lead-time, дней" />
      <span class="material-leadtime-suffix">дн.</span>
      <label class="material-ordered-toggle" title="Отмечено как заказано">
        <input type="checkbox" class="material-ordered-input" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}"${m.ordered ? ' checked' : ''} />
        <span>заказано</span>
      </label>
      <button type="button" class="material-row-del" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}" title="Убрать">✕</button>
    </div>`).join('');
  return `
    <div class="drawer-section-title">Материалы</div>
    <div class="materials-block" data-task-id="${escapeHtml(tid)}">
      ${riskBanner}
      <div class="materials-rows" id="materials-rows-${escapeHtml(tid)}">${rows || '<div class="materials-empty">Нет материалов (используются дефолты по типу работы)</div>'}</div>
      <button type="button" class="material-add-btn" data-task-id="${escapeHtml(tid)}">+ Добавить материал</button>
    </div>`;
}

function attachResourceMaterialHandlers(taskId) {
  const tid = String(taskId);

  // Resource handlers
  document.querySelectorAll(`.resource-type-select[data-task-id="${tid}"]`).forEach((sel) => {
    sel.addEventListener('change', () => mutateResource(tid, Number(sel.dataset.rowIdx), { type: sel.value }));
  });
  document.querySelectorAll(`.resource-count-input[data-task-id="${tid}"]`).forEach((inp) => {
    inp.addEventListener('change', () => mutateResource(tid, Number(inp.dataset.rowIdx), { count: Number(inp.value) || 1 }));
  });
  document.querySelectorAll(`.resource-row-del[data-task-id="${tid}"]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      const arr = [...getTaskResources(tid)];
      arr.splice(Number(btn.dataset.rowIdx), 1);
      setTaskResources(tid, arr);
      reRenderResources(tid);
    });
  });
  document.querySelector(`.resource-add-btn[data-task-id="${tid}"]`)?.addEventListener('click', () => {
    const arr = [...getTaskResources(tid), { type: 'workers', count: 1 }];
    setTaskResources(tid, arr);
    reRenderResources(tid);
  });

  // Material handlers
  document.querySelectorAll(`.material-name-input[data-task-id="${tid}"]`).forEach((inp) => {
    inp.addEventListener('change', () => mutateMaterial(tid, Number(inp.dataset.rowIdx), { name: inp.value }));
  });
  document.querySelectorAll(`.material-leadtime-input[data-task-id="${tid}"]`).forEach((inp) => {
    inp.addEventListener('change', () => {
      mutateMaterial(tid, Number(inp.dataset.rowIdx), { leadTime: Number(inp.value) || 0 });
      reRenderMaterials(tid);
    });
  });
  document.querySelectorAll(`.material-ordered-input[data-task-id="${tid}"]`).forEach((inp) => {
    inp.addEventListener('change', () => {
      mutateMaterial(tid, Number(inp.dataset.rowIdx), { ordered: inp.checked });
      reRenderMaterials(tid);
    });
  });
  document.querySelectorAll(`.material-row-del[data-task-id="${tid}"]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      const arr = [...getTaskMaterials(tid)];
      arr.splice(Number(btn.dataset.rowIdx), 1);
      setTaskMaterials(tid, arr);
      reRenderMaterials(tid);
    });
  });
  document.querySelector(`.material-add-btn[data-task-id="${tid}"]`)?.addEventListener('click', () => {
    const arr = [...getTaskMaterials(tid), { name: '', leadTime: 7, ordered: false, expectedDate: '', note: '' }];
    setTaskMaterials(tid, arr);
    reRenderMaterials(tid);
  });
}

function mutateResource(taskId, idx, patch) {
  const arr = [...getTaskResources(taskId)];
  if (!arr[idx]) return;
  arr[idx] = { ...arr[idx], ...patch };
  setTaskResources(taskId, arr);
}
function mutateMaterial(taskId, idx, patch) {
  const arr = [...getTaskMaterials(taskId)];
  if (!arr[idx]) return;
  arr[idx] = { ...arr[idx], ...patch };
  setTaskMaterials(taskId, arr);
}
function reRenderResources(taskId) {
  const cont = document.querySelector(`.resources-block[data-task-id="${taskId}"]`);
  if (!cont) return;
  const wrapper = cont.parentElement;
  if (!wrapper) return;
  cont.outerHTML = buildDrawerResourcesHtml(taskId).replace(/^\s*<div class="drawer-section-title">[^<]+<\/div>\s*/, '');
  attachResourceMaterialHandlers(taskId);
}
function reRenderMaterials(taskId) {
  const cont = document.querySelector(`.materials-block[data-task-id="${taskId}"]`);
  if (!cont) return;
  cont.outerHTML = buildDrawerMaterialsHtml(taskId).replace(/^\s*<div class="drawer-section-title">[^<]+<\/div>\s*/, '');
  attachResourceMaterialHandlers(taskId);
}

function buildDrawerTaskMeetingNotesHtml(taskId) {
  const notes = getTaskMeetingNotes(taskId);
  if (!notes.length) return '';
  const rows = notes.slice().reverse().map((n) =>
    `<div class="meeting-note-row"><span class="meeting-note-date">${escapeHtml(fmtMeetingDate(n.meetingDate || n.at))}</span>${escapeHtml(n.text || '')}</div>`
  ).join('');
  return `
    <div class="drawer-section-title">Из планёрок · ${notes.length}</div>
    <div class="meeting-notes-block">
      <div class="meeting-notes-block-title">📋 Заметки по этой работе из конспектов встреч</div>
      ${rows}
    </div>`;
}

function buildDrawerTicketsHtml(taskId) {
  const tid = escapeHtml(String(taskId));
  const taskTickets = state.tickets.filter((tk) => tk.task_id === String(taskId));
  const vs = ticketViewState[String(taskId)] || { filter: 'all', sort: 'deadline' };

  // Count per status for chips
  const countByStatus = {};
  for (const tk of taskTickets) countByStatus[tk.status] = (countByStatus[tk.status] || 0) + 1;
  const usedStatuses = TICKET_STATUSES.filter((s) => countByStatus[s]);

  // Счётчики ответственных (по всем тикетам задачи, без учёта status-фильтра — чтобы цифры не прыгали)
  const assigneeCounts = Object.fromEntries(ASSIGNEES.map((n) => [n, 0]));
  let noneAssignedCount = 0;
  for (const tk of taskTickets) {
    const owned = getTicketAssignees(tk.id);
    if (!owned.length) noneAssignedCount++;
    else for (const n of owned) if (assigneeCounts[n] !== undefined) assigneeCounts[n]++;
  }
  const aFilter = vs.assigneeFilter instanceof Set
    ? vs.assigneeFilter
    : new Set(Array.isArray(vs.assigneeFilter) ? vs.assigneeFilter : []);
  const assigneeHasAny = ASSIGNEES.some((n) => assigneeCounts[n] > 0) || noneAssignedCount > 0;

  const chips = taskTickets.length
    ? `<div class="ticket-filter-chips">
        <button class="ticket-chip${vs.filter === 'all' ? ' ticket-chip--active' : ''}" data-filter="all" data-task-id="${tid}">
          Все${taskTickets.length ? ` · ${taskTickets.length}` : ''}
        </button>
        ${usedStatuses.map((s) => `<button class="ticket-chip ticket-chip--${escapeHtml(s)}${vs.filter === s ? ' ticket-chip--active' : ''}" data-filter="${escapeHtml(s)}" data-task-id="${tid}">
          ${escapeHtml(TICKET_STATUS_LABEL[s])} · ${countByStatus[s]}
        </button>`).join('')}
      </div>
      ${assigneeHasAny ? `<div class="ticket-assignee-filter" data-task-id="${tid}">
        <span class="ticket-assignee-filter-label">Ответственный:</span>
        ${ASSIGNEES.filter((n) => assigneeCounts[n] > 0).map((n) => `<button class="ticket-assignee-chip${aFilter.has(n) ? ' ticket-assignee-chip--active' : ''}" data-assignee="${escapeHtml(n)}" data-task-id="${tid}">
          ${escapeHtml(n)} · ${assigneeCounts[n]}
        </button>`).join('')}
        ${noneAssignedCount > 0 ? `<button class="ticket-assignee-chip ticket-assignee-chip--none${aFilter.has('__none__') ? ' ticket-assignee-chip--active' : ''}" data-assignee="__none__" data-task-id="${tid}">
          Без отв. · ${noneAssignedCount}
        </button>` : ''}
        ${aFilter.size ? `<button class="ticket-assignee-chip-clear" data-task-id="${tid}" title="Сбросить фильтр по именам">✕</button>` : ''}
      </div>` : ''}
      <select class="ticket-sort-select" data-task-id="${tid}" aria-label="Сортировка">
        ${Object.keys(TICKET_SORT_LABEL).map((k) =>
          `<option value="${k}"${vs.sort === k ? ' selected' : ''}>${TICKET_SORT_LABEL[k]}</option>`
        ).join('')}
      </select>`
    : '';

  const todayIso = new Date().toISOString().slice(0, 10);
  const createAssigneeKey = `create-${String(taskId)}`;
  const createForm = `
    <div class="ticket-create-form" id="ticket-create-form-${tid}" style="display:none">
      <input class="ticket-form-input" type="text" placeholder="Краткое описание проблемы *" id="ticket-subject-${tid}" maxlength="200" />
      <textarea class="ticket-form-textarea" placeholder="Подробности (необязательно)" id="ticket-desc-${tid}" rows="2"></textarea>
      <label class="ticket-form-label">Срок устранения *
        <input class="ticket-form-input" type="date" id="ticket-due-${tid}" min="${todayIso}" required />
      </label>
      <div class="ticket-form-label">Ответственный
        ${buildAssigneePickerHtml(createAssigneeKey)}
      </div>
      <div class="ticket-photo-picker">
        <div class="ticket-photo-previews" id="ticket-photo-previews-${tid}"></div>
        <label class="ticket-photo-add-label">
          <input type="file" accept="image/*,video/*" class="ticket-photo-input" id="ticket-photo-input-${tid}" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden" />
          <span class="ticket-photo-add-btn">📷 Добавить фото</span>
        </label>
      </div>
      <div class="ticket-form-actions">
        <button class="ticket-form-submit" data-task-id="${tid}">Создать</button>
        <button class="ticket-form-cancel" data-task-id="${tid}">Отмена</button>
      </div>
      <div class="ticket-form-error" id="ticket-form-err-${tid}"></div>
    </div>`;

  const selecting = !!vs.selectionMode;
  const selectedCount = (vs.selectedIds || new Set()).size;
  const canSelect = taskTickets.length > 0;
  const selectBtn = canSelect
    ? `<button class="ticket-select-toggle${selecting ? ' ticket-select-toggle--on' : ''}" data-task-id="${tid}" title="${selecting ? 'Выйти из режима выбора' : 'Выбрать тикеты для отправки'}">
         <span class="ticket-select-toggle-ico" aria-hidden="true">${selecting ? '✓' : '☐'}</span>
         <span class="ticket-select-toggle-lbl">${selecting ? 'Выбор' : 'Выбрать'}</span>
       </button>`
    : '';
  return `<div class="tickets-section${selecting ? ' tickets-section--selecting' : ''}" data-task-id="${tid}">
    <div class="drawer-section-title">Тикеты${taskTickets.length ? ` (${taskTickets.length})` : ''}
      <button class="ticket-add-btn" data-task-id="${tid}" title="Создать тикет">➕</button>
    </div>
    ${createForm}
    ${taskTickets.length ? `<div class="ticket-toolbar">${selectBtn}<div class="ticket-toolbar-filters">${chips}</div></div>` : ''}
    <div class="drawer-tickets" id="drawer-tickets-${tid}">${buildTicketCards(taskId)}</div>
    ${selecting ? `
      <div class="tickets-action-bar">
        <button class="tickets-action-cancel" data-task-id="${tid}">Отмена</button>
        <button class="tickets-action-share" data-task-id="${tid}" ${selectedCount === 0 ? 'disabled' : ''}>
          <span class="tickets-action-share-ico">↗</span>
          <span class="tickets-action-share-lbl">Поделиться${selectedCount ? ` (${selectedCount})` : ''}</span>
        </button>
      </div>
    ` : ''}
  </div>`;
}

async function createTicket(taskId) {
  const subjectEl = document.getElementById(`ticket-subject-${taskId}`);
  const descEl    = document.getElementById(`ticket-desc-${taskId}`);
  const dueEl     = document.getElementById(`ticket-due-${taskId}`);
  const errEl     = document.getElementById(`ticket-form-err-${taskId}`);
  const subject   = subjectEl?.value.trim();
  if (!subject)          { if (errEl) errEl.textContent = 'Введите описание'; return; }
  const dueDate = dueEl?.value;
  if (!dueDate)          { if (errEl) errEl.textContent = 'Укажите срок устранения'; return; }

  const submitBtn = document.querySelector(`.ticket-form-submit[data-task-id="${taskId}"]`);
  const setBtnLoading = (loading, label) => {
    if (!submitBtn) return;
    if (loading) {
      submitBtn.disabled = true;
      submitBtn.classList.add('edit-save--loading');
      submitBtn.dataset.label = label || 'Создаём…';
    } else {
      submitBtn.disabled = false;
      submitBtn.classList.remove('edit-save--loading');
      delete submitBtn.dataset.label;
    }
  };
  setBtnLoading(true, 'Подготовка фото…');
  if (errEl) errEl.textContent = '';

  // Read from photo store → re-encode to JPEG (iOS HEIC-safe, auto-resize)
  const files = ticketPhotoStore[taskId] || [];
  const photos = [];
  for (let i = 0; i < files.length; i++) {
    setBtnLoading(true, `Фото ${i + 1}/${files.length}…`);
    try {
      photos.push(await photoToBase64Jpeg(files[i]));
    } catch (e) {
      if (errEl) errEl.textContent = `Фото «${files[i].name}»: ${e.message}`;
      setBtnLoading(false);
      return;
    }
  }
  setBtnLoading(true, 'Отправка…');

  try {
    const r = await fetch('/api/planradar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, description: descEl?.value.trim() || '', taskId: String(taskId), dueDate, photos })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(extractApiError(data, r.status));
    if (data.ticket) state.tickets.push(data.ticket);
    // Перенести выбранных ответственных из temp-ключа на реальный id тикета
    if (data.ticket?.id) {
      const chosen = getTicketAssignees(`create-${taskId}`);
      if (chosen.length) setTicketAssignees(data.ticket.id, chosen);
      setTicketAssignees(`create-${taskId}`, []);
    }
    delete ticketPhotoStore[taskId];

    // Refresh: replace the entire .tickets-section wrapper (reliable via data-task-id)
    const section = document.querySelector(`.tickets-section[data-task-id="${taskId}"]`);
    if (section) {
      const tmp = document.createElement('div');
      tmp.innerHTML = buildDrawerTicketsHtml(taskId);
      section.replaceWith(tmp.firstElementChild);
      attachTicketHandlers();
    }
    // Warn about photos that failed to upload (tickets was still created)
    const photoFails = (data.uploadDebug || []).filter((d) => d && d.ok === false);
    if (photoFails.length) {
      const list = photoFails.map(d => `«${d.name || '?'}»: ${d.error || 'ошибка'}`).join('; ');
      alert('Тикет создан, но часть фото не загрузилась:\n' + list + '\n\nМожешь открыть тикет и добавить их заново.');
    }
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
    setBtnLoading(false);
  }
}

function extractApiError(data, status) {
  if (!data) return `HTTP ${status}`;
  if (typeof data === 'string') return data.slice(0, 200);
  if (data.error) return data.error;
  if (data.message) return data.message;
  if (Array.isArray(data.errors) && data.errors[0]) {
    const e = data.errors[0];
    return e.detail || e.title || e.message || `HTTP ${status}`;
  }
  return `HTTP ${status}`;
}

async function updateTicketStatus(ticketId, newStatus, taskId) {
  const select = document.querySelector(`.ticket-status-select[data-ticket-id="${ticketId}"]`);
  if (select) select.disabled = true;
  try {
    const r = await fetch('/api/planradar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId, status: newStatus })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || `HTTP ${r.status}`); }
    const tk = state.tickets.find((t) => t.id === ticketId);
    if (tk) tk.status = newStatus;
    // update card class
    const card = select?.closest('.ticket-card');
    if (card) {
      card.className = `ticket-card ticket-card--${newStatus}`;
    }
  } catch (e) {
    console.error('Status update failed:', e.message);
  } finally {
    if (select) select.disabled = false;
  }
}

function openPhotoLightbox(url) {
  let lb = document.getElementById('photo-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'photo-lightbox';
    lb.innerHTML = `<div class="lightbox-overlay"></div><img class="lightbox-img" /><button class="lightbox-close" title="Закрыть">✕</button>`;
    document.body.appendChild(lb);
    lb.querySelector('.lightbox-overlay').addEventListener('click', closePhotoLightbox);
    lb.querySelector('.lightbox-close').addEventListener('click', closePhotoLightbox);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePhotoLightbox(); });
  }
  lb.querySelector('.lightbox-img').src = url;
  lb.classList.add('lightbox--open');
}

function closePhotoLightbox() {
  const lb = document.getElementById('photo-lightbox');
  if (lb) lb.classList.remove('lightbox--open');
}

function attachTicketCardHandlers() {
  document.querySelectorAll('.ticket-status-select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      updateTicketStatus(sel.dataset.ticketId, sel.value, sel.dataset.taskId);
    });
    sel.addEventListener('click', (e) => e.stopPropagation());
  });
  document.querySelectorAll('.ticket-photo-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openPhotoLightbox(btn.dataset.url); });
  });
  // Edit button + whole-card click (except on actionable inner controls)
  document.querySelectorAll('.ticket-edit-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openTicketEditModal(btn.dataset.ticketId); });
  });
  document.querySelectorAll('.ticket-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.ticket-status-select, .ticket-photo-btn, .ticket-edit-btn, select, button')) return;
      const tid = card.dataset.ticketId;
      const taskId = card.dataset.taskId;
      const vs = ticketViewState[taskId];
      if (vs?.selectionMode) {
        // Toggle selection instead of opening edit modal
        vs.selectedIds = vs.selectedIds || new Set();
        if (vs.selectedIds.has(tid)) vs.selectedIds.delete(tid);
        else vs.selectedIds.add(tid);
        refreshTicketsSection(taskId);
      } else if (tid) {
        openTicketEditModal(tid);
      }
    });
  });
}

function refreshTicketsSection(taskId) {
  const section = document.querySelector(`.tickets-section[data-task-id="${taskId}"]`);
  if (!section) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = buildDrawerTicketsHtml(taskId);
  section.replaceWith(tmp.firstElementChild);
  attachTicketHandlers();
}

/* ─── photo → JPEG base64 (iOS HEIC-safe, auto-resize) ─── */
async function photoToBase64Jpeg(file, maxDim = 2400, quality = 0.85) {
  // If HEIC/HEIF and browser can't decode it → throw so caller can show nice error
  const isHeic = /heic|heif/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || '');
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload  = (e) => res(e.target.result);
    fr.onerror = () => rej(new Error('Не удалось прочитать файл'));
    fr.readAsDataURL(file);
  });
  // Try to load into <img> for canvas re-encoding
  const img = await new Promise((res, rej) => {
    const el = new Image();
    el.onload  = () => res(el);
    el.onerror = () => rej(new Error(isHeic
      ? 'HEIC-фото не поддерживается. В настройках iPhone: Камера → Форматы → «Наиболее совместимый» (JPEG)'
      : 'Не удалось открыть изображение'));
    el.src = dataUrl;
  });
  // Resize if needed
  const { width, height } = img;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // fallback background for transparent PNGs
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const jpegDataUri = canvas.toDataURL('image/jpeg', quality);
  return {
    data: jpegDataUri.split(',')[1],
    mimeType: 'image/jpeg',
    name: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg'
  };
}

/* ─── share tickets as PDF ─── */
let pdfLibsPromise = null;
function loadPdfLibs() {
  if (pdfLibsPromise) return pdfLibsPromise;
  const load = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Не удалось загрузить ' + src));
    document.head.appendChild(s);
  });
  pdfLibsPromise = Promise.all([
    load('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'),
    load('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js')
  ]);
  return pdfLibsPromise;
}

async function imageUrlToDataUrl(url) {
  if (!url) return null;
  // Route through our backend proxy to bypass PlanRadar CDN CORS + stream bytes
  const proxied = `/api/planradar?image=${encodeURIComponent(url)}`;
  const candidates = [proxied, url]; // try proxy first, fall back to direct
  for (const u of candidates) {
    try {
      const r = await fetch(u, { mode: 'cors' });
      if (!r.ok) continue;
      const blob = await r.blob();
      if (!blob || blob.size === 0) continue;
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      if (dataUrl && dataUrl.length > 40) return dataUrl;
    } catch (_) { /* try next */ }
  }
  return null;
}

function buildTicketPageHtml(tk, task, project) {
  const STATUS_ICO = { open:'🟠', in_review:'🔵', in_progress:'🟣', deferred:'⚪️', resolved:'🟢', rejected:'⚫️' };
  const descClean = (tk.description || '').replace(/\[task:\w+\]/gi, '').trim();
  const titleClean = (tk.title || '').replace(/\[task:\w+\]/gi, '').trim() || tk.title || '';
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = tk.due_date && tk.due_date < today && tk.status !== 'resolved';
  const photosHtml = (tk.photoDataUrls || []).map((du) =>
    `<div class="pdf-photo-wrap"><img src="${du}" /></div>`
  ).join('');
  return `<div class="pdf-page">
    <div class="pdf-hdr">
      <div class="pdf-hdr-brand">${escapeHtml(project?.contractor || 'CYFR')}</div>
      <div class="pdf-hdr-project">${escapeHtml(project?.name || '')}</div>
    </div>
    <div class="pdf-ticket-title">${escapeHtml(titleClean)}</div>
    <div class="pdf-task-ref">Наименование работ: <b>${escapeHtml(task?.name || '—')}</b></div>
    <div class="pdf-meta">
      <div><span class="pdf-meta-k">Статус</span><span class="pdf-meta-v">${STATUS_ICO[tk.status] || '·'} ${escapeHtml(TICKET_STATUS_LABEL[tk.status] || tk.status || '')}</span></div>
      <div><span class="pdf-meta-k">Создан</span><span class="pdf-meta-v">${tk.created_at ? escapeHtml(fmtDate(tk.created_at)) : '—'}</span></div>
      <div><span class="pdf-meta-k">Срок</span><span class="pdf-meta-v${isOverdue ? ' pdf-meta-v--overdue' : ''}">${tk.due_date ? escapeHtml(fmtDate(tk.due_date)) + (isOverdue ? ' · просрочен' : '') : '—'}</span></div>
      <div><span class="pdf-meta-k">Автор</span><span class="pdf-meta-v">${escapeHtml(tk.creator || '—')}</span></div>
    </div>
    ${descClean ? `<div class="pdf-section-lbl">Описание</div><div class="pdf-desc">${escapeHtml(descClean)}</div>` : ''}
    ${photosHtml ? `<div class="pdf-section-lbl">Фотографии (${tk.photoDataUrls.length})</div><div class="pdf-photos">${photosHtml}</div>` : ''}
    <div class="pdf-footer">
      <span>${escapeHtml(project?.contractor || 'CYFR')} · ${escapeHtml(project?.code || '')}</span>
      <span>${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
    </div>
  </div>`;
}

async function generateTicketsPdf(tickets, task, project) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;

  // Pre-fetch all photos as dataURLs (skip failures silently)
  for (const tk of tickets) {
    tk.photoDataUrls = [];
    for (const p of (tk.photos || [])) {
      const du = await imageUrlToDataUrl(p.url);
      if (du) tk.photoDataUrls.push(du);
    }
  }

  // Build offscreen container
  const container = document.createElement('div');
  container.id = 'pdf-report-root';
  container.style.cssText = 'position:fixed; left:-99999px; top:0; background:#fff;';
  container.innerHTML = tickets.map((tk) => buildTicketPageHtml(tk, task, project)).join('');
  document.body.appendChild(container);

  try {
    const pages = [...container.querySelectorAll('.pdf-page')];
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    for (let i = 0; i < pages.length; i++) {
      const canvas = await window.html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const imgW = doc.internal.pageSize.getWidth();
      const imgH = (canvas.height * imgW) / canvas.width;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      if (i > 0) doc.addPage();
      doc.addImage(dataUrl, 'JPEG', 0, 0, imgW, imgH, undefined, 'FAST');
    }
    return doc.output('blob');
  } finally {
    container.remove();
  }
}

async function shareSelectedTickets(taskId, triggerBtn) {
  const vs = ticketViewState[taskId];
  const ids = vs?.selectedIds ? [...vs.selectedIds] : [];
  if (!ids.length) return;
  const task = state.schedule.tasks.find((t) => t.id === String(taskId));
  const project = state.schedule.project;
  const tickets = state.tickets.filter((t) => ids.includes(t.id));
  if (!tickets.length) return;

  const setLoading = (loading, label) => {
    if (!triggerBtn) return;
    if (loading) {
      triggerBtn.disabled = true;
      triggerBtn.classList.add('edit-save--loading');
      triggerBtn.dataset.label = label || 'Готовим PDF…';
    } else {
      triggerBtn.disabled = false;
      triggerBtn.classList.remove('edit-save--loading');
      delete triggerBtn.dataset.label;
    }
  };

  try {
    setLoading(true, 'Загрузка библиотек…');
    await loadPdfLibs();
    setLoading(true, `PDF: 0/${tickets.length}`);
    // Build incrementally and update label
    for (let i = 0; i < tickets.length; i++) {
      setLoading(true, `Фото ${i + 1}/${tickets.length}…`);
      const t = tickets[i];
      t.photoDataUrls = [];
      for (const p of (t.photos || [])) {
        const du = await imageUrlToDataUrl(p.url);
        if (du) t.photoDataUrls.push(du);
      }
    }
    setLoading(true, 'Рендер PDF…');
    const { jsPDF } = window.jspdf;
    const container = document.createElement('div');
    container.id = 'pdf-report-root';
    container.style.cssText = 'position:fixed; left:-99999px; top:0; background:#fff;';
    container.innerHTML = tickets.map((tk) => buildTicketPageHtml(tk, task, project)).join('');
    document.body.appendChild(container);
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    try {
      const pages = [...container.querySelectorAll('.pdf-page')];
      for (let i = 0; i < pages.length; i++) {
        setLoading(true, `Страница ${i + 1}/${pages.length}…`);
        const canvas = await window.html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true });
        const imgW = doc.internal.pageSize.getWidth();
        const imgH = (canvas.height * imgW) / canvas.width;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        if (i > 0) doc.addPage();
        doc.addImage(dataUrl, 'JPEG', 0, 0, imgW, imgH, undefined, 'FAST');
      }
    } finally { container.remove(); }
    const blob = doc.output('blob');
    const fname = `Тикеты_${(task?.name || 'task').slice(0,30).replace(/[^\p{L}\p{N}_-]+/gu, '_')}_${new Date().toISOString().slice(0,10)}.pdf`;
    const file = new File([blob], fname, { type: 'application/pdf' });

    // Share ONLY the file — no accompanying title/text so chat apps treat it as file attachment only
    setLoading(true, 'Открываю выбор приложения…');
    const fileOnly = { files: [file] };
    let shareAttempted = false, shareCanceled = false;
    if (navigator.canShare && navigator.canShare(fileOnly)) {
      shareAttempted = true;
      try {
        await navigator.share(fileOnly);
      } catch (e) {
        if (e.name === 'AbortError') shareCanceled = true;
        else console.warn('share failed:', e.message);
      }
    }
    if (!shareAttempted) {
      // No Web Share API (desktop browsers usually) — download directly
      downloadBlob(blob, fname);
    }
    // Reset selection on success
    vs.selectionMode = false;
    vs.selectedIds = new Set();
    refreshTicketsSection(taskId);
  } catch (e) {
    alert('Ошибка подготовки PDF: ' + (e.message || e));
    setLoading(false);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ─── ticket edit modal ─── */
const editModalPhotoStore = {}; // ticketId → File[] staged for upload

/* ─── Ticket assignee picker (multi-select, 1–4 одновременно) ─── */
const ASSIGNEES = ['Александр', 'Андрей', 'Антон П.', 'Антон М.'];

// In-memory holder for assignees выбранных в форме создания тикета (temp до save)
const tempAssigneesByCreateKey = new Map();

function getTicketAssignees(ticketId) {
  if (typeof ticketId === 'string' && ticketId.startsWith('create-')) {
    return (tempAssigneesByCreateKey.get(ticketId) || []).filter(n => ASSIGNEES.includes(n));
  }
  const arr = state.dataCache.assignees[ticketId];
  if (!Array.isArray(arr)) return [];
  return arr.filter(n => ASSIGNEES.includes(n));
}
function setTicketAssignees(ticketId, names) {
  const list = (names || []).filter(n => ASSIGNEES.includes(n));
  if (typeof ticketId === 'string' && ticketId.startsWith('create-')) {
    if (list.length) tempAssigneesByCreateKey.set(ticketId, list);
    else tempAssigneesByCreateKey.delete(ticketId);
    return;
  }
  // optimistic cache update
  if (list.length) state.dataCache.assignees[ticketId] = list;
  else delete state.dataCache.assignees[ticketId];
  postDataAction('assignees:set', {
    ticketId, slug: state.projectSlug, names: list
  }).catch((e) => console.warn('assignees:set failed', e));
}

function buildAssigneePickerHtml(ticketId) {
  const selected = new Set(getTicketAssignees(ticketId));
  const pills = ASSIGNEES.map((name) => {
    const isSel = selected.has(name);
    return `<button type="button" class="assignee-pill${isSel ? ' assignee-pill--selected' : ''}" data-name="${escapeHtml(name)}" data-ticket-id="${escapeHtml(ticketId)}" aria-pressed="${isSel ? 'true' : 'false'}">
      <span class="assignee-pill-dot" aria-hidden="true"></span>
      <span class="assignee-pill-name">${escapeHtml(name)}</span>
    </button>`;
  }).join('');
  const hintText = selected.size
    ? `Выбрано: ${selected.size} из ${ASSIGNEES.length}`
    : 'Нажми на имя — можно выбрать несколько';
  return `<div class="assignee-block assignee-block--multi" data-ticket-id="${escapeHtml(ticketId)}">
    <div class="assignee-zone assignee-zone--all" aria-label="Ответственные">${pills}</div>
    <div class="assignee-hint">${escapeHtml(hintText)}</div>
  </div>`;
}

function attachAssigneeHandlers(modal) {
  modal.querySelectorAll('.assignee-pill').forEach((pill) => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAssigneePill(pill);
    });
  });
}

function toggleAssigneePill(pill) {
  const block = pill.closest('.assignee-block');
  if (!block) return;
  const ticketId = block.getAttribute('data-ticket-id');
  const name = pill.getAttribute('data-name');
  const current = new Set(getTicketAssignees(ticketId));
  if (current.has(name)) {
    current.delete(name);
    pill.classList.remove('assignee-pill--selected');
    pill.setAttribute('aria-pressed', 'false');
  } else {
    current.add(name);
    pill.classList.add('assignee-pill--selected');
    pill.setAttribute('aria-pressed', 'true');
  }
  setTicketAssignees(ticketId, Array.from(current));
  const hint = block.querySelector('.assignee-hint');
  if (hint) {
    hint.textContent = current.size
      ? `Выбрано: ${current.size} из ${ASSIGNEES.length}`
      : 'Нажми на имя — можно выбрать несколько';
  }
  // Если в ящике активна сортировка «По ответственному» — перерендерить карточки
  refreshTicketsIfSortedByAssignee(ticketId);
}

function refreshTicketsIfSortedByAssignee(ticketId) {
  // После смены ответственных: обновить счётчики + (если фильтр активен) пересобрать список
  const tk = state.tickets.find((t) => t.id === ticketId);
  if (!tk) return;
  if (typeof refreshTicketsSection === 'function') refreshTicketsSection(tk.task_id);
}

/* ─── Ticket updates (тред апдейтов под описанием) ─── */
function getTicketUpdates(ticketId) {
  const arr = state.dataCache.updates[ticketId];
  return Array.isArray(arr) ? arr : [];
}
function addTicketUpdate(ticketId, text) {
  const t = (text || '').trim();
  if (!t) return null;
  // optimistic temp update — заменим на серверный id когда придёт ответ
  const tempId = 'u_tmp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const tempAt = new Date().toISOString();
  const upd = { id: tempId, text: t, at: tempAt, _pending: true };
  if (!state.dataCache.updates[ticketId]) state.dataCache.updates[ticketId] = [];
  state.dataCache.updates[ticketId].push(upd);
  postDataAction('update:add', { ticketId, slug: state.projectSlug, text: t })
    .then((res) => {
      if (res && res.update) {
        const idx = (state.dataCache.updates[ticketId] || []).findIndex(u => u.id === tempId);
        if (idx >= 0) state.dataCache.updates[ticketId][idx] = { ...res.update };
      }
    })
    .catch((e) => {
      console.warn('update:add failed', e);
      // откатываем
      state.dataCache.updates[ticketId] = (state.dataCache.updates[ticketId] || []).filter(u => u.id !== tempId);
    });
  return upd;
}
function deleteTicketUpdate(ticketId, updateId) {
  state.dataCache.updates[ticketId] = (state.dataCache.updates[ticketId] || []).filter(u => u.id !== updateId);
  postDataAction('update:delete', { ticketId, updateId })
    .catch((e) => console.warn('update:delete failed', e));
}
function getTicketLastUpdateAt(ticketId) {
  const updates = getTicketUpdates(ticketId);
  if (!updates.length) return null;
  return updates.reduce((max, u) => (u.at > max ? u.at : max), updates[0].at);
}
function fmtUpdateAt(iso) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = d.toLocaleString('ru-RU', { month: 'short' }).replace('.', '');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd} ${mm}, ${hh}:${mi}`;
  } catch (_) { return String(iso); }
}
function fmtUpdateDateShort(iso) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = d.toLocaleString('ru-RU', { month: 'short' }).replace('.', '');
    return `${dd} ${mm}`;
  } catch (_) { return ''; }
}
function buildTicketUpdatesThreadHtml(ticketId) {
  const updates = getTicketUpdates(ticketId);
  if (!updates.length) {
    return `<div class="ticket-updates-empty">Апдейтов пока нет. Добавь первый ниже — зафиксируется время и текст.</div>`;
  }
  // Сортировка: свежие сверху (новый → старый)
  const sorted = [...updates].sort((a, b) => (a.at < b.at ? 1 : -1));
  return sorted.map((u, idx) => `
    <div class="ticket-update-item${idx === 0 ? ' ticket-update-item--latest' : ''}" data-update-id="${escapeHtml(u.id)}" data-ticket-id="${escapeHtml(ticketId)}">
      <div class="ticket-update-connector" aria-hidden="true"></div>
      <div class="ticket-update-dot" aria-hidden="true"></div>
      <div class="ticket-update-body">
        <div class="ticket-update-meta">
          <span class="ticket-update-at">${escapeHtml(fmtUpdateAt(u.at))}</span>
          ${idx === 0 ? '<span class="ticket-update-latest-badge">последний</span>' : ''}
          <button type="button" class="ticket-update-del" title="Удалить апдейт" data-update-id="${escapeHtml(u.id)}" data-ticket-id="${escapeHtml(ticketId)}">✕</button>
        </div>
        <div class="ticket-update-text">${escapeHtml(u.text)}</div>
      </div>
    </div>`).join('');
}
function refreshTicketUpdatesThread(ticketId) {
  const thread = document.getElementById('ticket-updates-thread-' + ticketId);
  if (thread) thread.innerHTML = buildTicketUpdatesThreadHtml(ticketId);
  // Обновить счётчик в label
  const countEl = document.querySelector(`.edit-updates-count[data-ticket-id="${ticketId}"]`);
  if (countEl) {
    const c = getTicketUpdates(ticketId).length;
    countEl.textContent = c;
    countEl.style.display = c ? '' : 'none';
  }
  attachTicketUpdateDeleteHandlers(ticketId);
}
function attachTicketUpdateDeleteHandlers(ticketId) {
  const thread = document.getElementById('ticket-updates-thread-' + ticketId);
  if (!thread) return;
  thread.querySelectorAll('.ticket-update-del').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const uid = btn.dataset.updateId;
      if (!uid) return;
      if (!confirm('Удалить этот апдейт?')) return;
      deleteTicketUpdate(ticketId, uid);
      refreshTicketUpdatesThread(ticketId);
      // Обновить карточки в drawer (чтоб "Апдейт: дата" пересчитался)
      const tk = state.tickets.find((t) => t.id === ticketId);
      if (tk && typeof refreshTicketsSection === 'function') refreshTicketsSection(tk.task_id);
    });
  });
}

function clearAssigneeFilter(tid) {
  if (!tid || !ticketViewState[tid]) return;
  ticketViewState[tid].assigneeFilter = new Set();
  if (typeof refreshTicketsSection === 'function') refreshTicketsSection(tid);
}

function openTicketEditModal(ticketId) {
  const tk = state.tickets.find((t) => t.id === ticketId);
  if (!tk) return;
  closeTicketEditModal();
  const descClean    = (tk.description || '').replace(/\[task:\w+\]/gi, '').trim();
  const subjectClean = (tk.title || '').replace(/\[task:\w+\]/gi, '').trim();
  const statusOpts = TICKET_STATUSES.map((s) =>
    `<option value="${s}"${tk.status === s ? ' selected' : ''}>${escapeHtml(TICKET_STATUS_LABEL[s] || s)}</option>`
  ).join('');
  const photosHtml = (tk.photos || []).map((p) => `
    <div class="edit-photo" data-photo-id="${escapeHtml(p.photoId || '')}" data-url="${escapeHtml(p.url || '')}">
      <img src="${escapeHtml(p.thumb || p.url)}" loading="lazy" alt="" />
      <button type="button" class="edit-photo-del" title="Удалить">✕</button>
    </div>`).join('');
  const modal = document.createElement('div');
  modal.id = 'ticket-edit-modal';
  modal.className = 'ticket-modal';
  modal.innerHTML = `
    <div class="ticket-modal-overlay"></div>
    <div class="ticket-modal-dialog" role="dialog" aria-modal="true">
      <button class="ticket-modal-close" title="Закрыть">✕</button>
      <div class="ticket-modal-head">
        <span class="ticket-modal-label">Тикет · задача №${escapeHtml(String(tk.task_id || ''))}</span>
      </div>
      <div class="ticket-modal-body">
        <label class="edit-label">Название
          <input class="edit-input" id="edit-subject" type="text" value="${escapeHtml(subjectClean)}" maxlength="200" />
        </label>
        <label class="edit-label">Описание
          <textarea class="edit-textarea" id="edit-desc" rows="4">${escapeHtml(descClean)}</textarea>
        </label>
        <div class="edit-label">Апдейты <span class="edit-updates-count" data-ticket-id="${escapeHtml(ticketId)}"${!getTicketUpdates(ticketId).length ? ' style="display:none"' : ''}>${getTicketUpdates(ticketId).length}</span>
          <div class="ticket-updates-thread" id="ticket-updates-thread-${escapeHtml(ticketId)}">
            ${buildTicketUpdatesThreadHtml(ticketId)}
          </div>
          <div class="ticket-update-form">
            <textarea class="edit-textarea ticket-update-input" id="ticket-update-input-${escapeHtml(ticketId)}" rows="2" placeholder="Что изменилось? (например: подрядчик подтвердил, перенесли на завтра…)"></textarea>
            <button type="button" class="ticket-update-add-btn" id="ticket-update-add-btn-${escapeHtml(ticketId)}">➕ Добавить апдейт</button>
          </div>
        </div>
        ${(() => {
          const notes = getTicketMeetingNotes(ticketId);
          if (!notes.length) return '';
          const rows = notes.slice().reverse().map((n) =>
            `<div class="meeting-note-row"><span class="meeting-note-date">${escapeHtml(fmtMeetingDate(n.meetingDate || n.at))}</span>${escapeHtml(n.text || '')}</div>`
          ).join('');
          return `<div class="edit-label">Из планёрок · ${notes.length}
            <div class="meeting-notes-block">
              <div class="meeting-notes-block-title">📋 Дополнено по конспектам встреч</div>
              ${rows}
            </div>
          </div>`;
        })()}
        <div class="edit-row">
          <label class="edit-label">Срок
            <input class="edit-input" id="edit-due" type="date" value="${tk.due_date || ''}" />
          </label>
          <label class="edit-label">Статус
            <select class="edit-input" id="edit-status">${statusOpts}</select>
          </label>
        </div>
        <div class="edit-label">Ответственный
          ${buildAssigneePickerHtml(ticketId)}
        </div>
        <div class="edit-label">Фото
          <div class="edit-photos" id="edit-photos">${photosHtml}</div>
          <div class="edit-photos-new" id="edit-photos-new"></div>
          <label class="edit-photo-add">
            <input type="file" accept="image/*,video/*" id="edit-photo-input" multiple style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden" />
            <span>📷 Добавить фото</span>
          </label>
        </div>
        <div class="edit-err" id="edit-err"></div>
      </div>
      <div class="ticket-modal-foot">
        <button class="edit-delete-ticket" title="Удалить тикет">🗑 Удалить</button>
        <div class="edit-foot-spacer"></div>
        <button class="edit-cancel">Отмена</button>
        <button class="edit-save">Сохранить</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  // Handlers
  attachAssigneeHandlers(modal);
  // Updates thread handlers
  attachTicketUpdateDeleteHandlers(ticketId);
  const addUpdBtn = modal.querySelector(`#ticket-update-add-btn-${CSS.escape(ticketId)}`);
  const updInput = modal.querySelector(`#ticket-update-input-${CSS.escape(ticketId)}`);
  if (addUpdBtn && updInput) {
    const submitUpdate = () => {
      const text = (updInput.value || '').trim();
      if (!text) { updInput.focus(); return; }
      const upd = addTicketUpdate(ticketId, text);
      if (!upd) return;
      updInput.value = '';
      refreshTicketUpdatesThread(ticketId);
      // Анимация: новый item сверху — fade+slide-in
      const thread = document.getElementById('ticket-updates-thread-' + ticketId);
      const firstItem = thread?.querySelector('.ticket-update-item--latest');
      if (firstItem) {
        firstItem.classList.add('ticket-update-item--enter');
        requestAnimationFrame(() => {
          firstItem.classList.add('ticket-update-item--enter-active');
        });
        setTimeout(() => {
          firstItem.classList.remove('ticket-update-item--enter', 'ticket-update-item--enter-active');
        }, 400);
      }
      // Обновить карточки в drawer (чтоб "Апдейт: дата" пересчитался)
      const tk2 = state.tickets.find((t) => t.id === ticketId);
      if (tk2 && typeof refreshTicketsSection === 'function') refreshTicketsSection(tk2.task_id);
    };
    addUpdBtn.addEventListener('click', submitUpdate);
    updInput.addEventListener('keydown', (e) => {
      // Cmd/Ctrl+Enter = submit
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submitUpdate();
      }
    });
  }
  modal.querySelector('.ticket-modal-close').addEventListener('click', closeTicketEditModal);
  modal.querySelector('.ticket-modal-overlay').addEventListener('click', closeTicketEditModal);
  modal.querySelector('.edit-cancel').addEventListener('click', closeTicketEditModal);
  modal.querySelector('.edit-save').addEventListener('click', () => saveTicketEdit(ticketId));
  modal.querySelector('.edit-delete-ticket').addEventListener('click', () => deleteTicketFromModal(ticketId));
  // Photo delete
  modal.querySelectorAll('.edit-photo-del').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrap = btn.closest('.edit-photo');
      const pid = wrap?.dataset.photoId;
      if (!pid) { wrap?.remove(); return; }
      if (!confirm('Удалить фото?')) return;
      deleteTicketPhoto(ticketId, pid, wrap);
    });
  });
  // Photo thumbnail click → lightbox
  modal.querySelectorAll('.edit-photo img').forEach((img) => {
    img.addEventListener('click', () => {
      const url = img.closest('.edit-photo')?.dataset.url;
      if (url) openPhotoLightbox(url);
    });
  });
  // Add photo input
  modal.querySelector('#edit-photo-input').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    editModalPhotoStore[ticketId] = [...(editModalPhotoStore[ticketId] || []), ...files];
    renderNewPhotoPreviews(ticketId);
    e.target.value = '';
  });
  document.addEventListener('keydown', modalEscHandler);
  // Focus
  setTimeout(() => modal.querySelector('#edit-subject')?.focus(), 50);
}

function modalEscHandler(e) {
  if (e.key === 'Escape') closeTicketEditModal();
}

function closeTicketEditModal() {
  const m = document.getElementById('ticket-edit-modal');
  if (m) m.remove();
  document.removeEventListener('keydown', modalEscHandler);
}

function renderNewPhotoPreviews(ticketId) {
  const container = document.getElementById('edit-photos-new');
  if (!container) return;
  const files = editModalPhotoStore[ticketId] || [];
  container.innerHTML = files.map((f, i) => `
    <div class="edit-photo edit-photo--new" data-idx="${i}">
      <img src="${URL.createObjectURL(f)}" alt="" />
      <button type="button" class="edit-photo-del" data-idx="${i}" title="Убрать">✕</button>
    </div>`).join('');
  container.querySelectorAll('.edit-photo-del').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.idx);
      editModalPhotoStore[ticketId].splice(idx, 1);
      renderNewPhotoPreviews(ticketId);
    });
  });
}

async function deleteTicketPhoto(ticketId, photoId, wrapEl) {
  try {
    const r = await fetch('/api/planradar', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoId })
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); }
    // Remove from state.tickets
    const tk = state.tickets.find((t) => t.id === ticketId);
    if (tk) tk.photos = (tk.photos || []).filter((p) => p.photoId !== photoId);
    wrapEl?.remove();
  } catch (e) {
    alert('Не удалось удалить фото: ' + e.message);
  }
}

async function deleteTicketFromModal(ticketId) {
  if (!confirm('Удалить тикет целиком? Отменить будет нельзя.')) return;
  try {
    const r = await fetch('/api/planradar', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId })
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); }
    // Remove from state + UI
    const removed = state.tickets.find((t) => t.id === ticketId);
    state.tickets = state.tickets.filter((t) => t.id !== ticketId);
    closeTicketEditModal();
    if (removed?.task_id) {
      const section = document.querySelector(`.tickets-section[data-task-id="${removed.task_id}"]`);
      if (section) {
        const tmp = document.createElement('div');
        tmp.innerHTML = buildDrawerTicketsHtml(removed.task_id);
        section.replaceWith(tmp.firstElementChild);
        attachTicketHandlers();
      }
    }
  } catch (e) {
    alert('Не удалось удалить тикет: ' + e.message);
  }
}

async function saveTicketEdit(ticketId) {
  const tk = state.tickets.find((t) => t.id === ticketId);
  if (!tk) return;
  const errEl = document.getElementById('edit-err');
  const saveBtn = document.querySelector('#ticket-edit-modal .edit-save');
  const setLoading = (loading, label) => {
    if (!saveBtn) return;
    if (loading) {
      saveBtn.disabled = true;
      saveBtn.classList.add('edit-save--loading');
      saveBtn.setAttribute('aria-busy', 'true');
      if (label) saveBtn.dataset.label = label;
    } else {
      saveBtn.disabled = false;
      saveBtn.classList.remove('edit-save--loading');
      saveBtn.removeAttribute('aria-busy');
      delete saveBtn.dataset.label;
    }
  };
  setLoading(true, 'Сохраняем…');
  if (errEl) errEl.textContent = '';
  try {
    const subject = document.getElementById('edit-subject')?.value.trim();
    const description = document.getElementById('edit-desc')?.value.trim();
    const dueDate = document.getElementById('edit-due')?.value || null;
    const status = document.getElementById('edit-status')?.value;
    if (!subject) throw new Error('Название обязательно');

    // 1) Update ticket fields
    const payload = { ticketId, subject, description, dueDate, status, taskId: tk.task_id };
    const r = await fetch('/api/planradar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(extractApiError(d, r.status)); }

    // 2) Upload any new photos (with progress + HEIC-safe conversion)
    const files = editModalPhotoStore[ticketId] || [];
    const newPhotos = [];
    const failed = [];
    for (let i = 0; i < files.length; i++) {
      setLoading(true, `Фото ${i + 1}/${files.length}…`);
      const f = files[i];
      let photo;
      try {
        photo = await photoToBase64Jpeg(f);
      } catch (ee) {
        failed.push(`«${f.name}»: ${ee.message}`);
        continue;
      }
      const up = await fetch('/api/planradar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addPhoto', ticketId, photo })
      });
      if (up.ok) {
        const upData = await up.json();
        if (upData.photo?.url) newPhotos.push(upData.photo);
      } else {
        const upErr = await up.json().catch(() => ({}));
        failed.push(`«${f.name}»: ${extractApiError(upErr, up.status)}`);
      }
    }
    delete editModalPhotoStore[ticketId];
    if (failed.length) {
      // Don't throw — ticket fields already saved. Just warn after modal re-renders.
      console.warn('Photo upload failures:', failed);
      if (errEl) errEl.textContent = 'Фото с ошибкой: ' + failed.join('; ');
    }

    // 3) Update local state
    tk.title = subject;
    tk.description = tk.task_id ? `${description} [task:${tk.task_id}]`.trim() : description;
    tk.due_date = dueDate;
    tk.status = status;
    tk.photos = [...(tk.photos || []), ...newPhotos];

    // 4) Refresh card in drawer
    const section = document.querySelector(`.tickets-section[data-task-id="${tk.task_id}"]`);
    if (section) {
      const tmp = document.createElement('div');
      tmp.innerHTML = buildDrawerTicketsHtml(tk.task_id);
      section.replaceWith(tmp.firstElementChild);
      attachTicketHandlers();
    }
    // Close modal only if all photos uploaded OK; if some failed — keep open so user sees error
    if (!failed.length) {
      closeTicketEditModal();
    } else {
      setLoading(false);
    }
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
    setLoading(false);
  }
}

function attachTicketHandlers() {
  // Select-mode toggle
  document.querySelectorAll('.ticket-select-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.taskId;
      if (!ticketViewState[tid]) ticketViewState[tid] = { filter: 'all', sort: 'deadline' };
      const vs = ticketViewState[tid];
      vs.selectionMode = !vs.selectionMode;
      if (!vs.selectionMode) vs.selectedIds = new Set();
      else vs.selectedIds = vs.selectedIds || new Set();
      refreshTicketsSection(tid);
    });
  });
  // Cancel selection
  document.querySelectorAll('.tickets-action-cancel').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.taskId;
      if (!ticketViewState[tid]) return;
      ticketViewState[tid].selectionMode = false;
      ticketViewState[tid].selectedIds = new Set();
      refreshTicketsSection(tid);
    });
  });
  // Share selected
  document.querySelectorAll('.tickets-action-share').forEach((btn) => {
    btn.addEventListener('click', () => shareSelectedTickets(btn.dataset.taskId, btn));
  });
  // Add ticket button
  document.querySelectorAll('.ticket-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.taskId;
      const form = document.getElementById(`ticket-create-form-${tid}`);
      if (!form) return;
      const show = form.style.display === 'none';
      form.style.display = show ? 'flex' : 'none';
      if (show) {
        // Сбросить возможный «висячий» выбор от прошлого раза и повесить хэндлеры
        setTicketAssignees(`create-${tid}`, []);
        const block = form.querySelector('.assignee-block');
        if (block) {
          block.querySelectorAll('.assignee-pill--selected').forEach((p) => {
            p.classList.remove('assignee-pill--selected');
            p.setAttribute('aria-pressed', 'false');
          });
          const hint = block.querySelector('.assignee-hint');
          if (hint) hint.textContent = 'Нажми на имя — можно выбрать несколько';
        }
        attachAssigneeHandlers(form);
      }
    });
  });
  // Submit
  document.querySelectorAll('.ticket-form-submit').forEach((btn) => {
    btn.addEventListener('click', () => createTicket(btn.dataset.taskId));
  });
  // Cancel
  document.querySelectorAll('.ticket-form-cancel').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.taskId;
      const form = document.getElementById(`ticket-create-form-${tid}`);
      if (form) form.style.display = 'none';
      // Очистить временные ответственные
      setTicketAssignees(`create-${tid}`, []);
    });
  });
  attachTicketCardHandlers();
  // Filter chips
  document.querySelectorAll('.ticket-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.taskId;
      if (!ticketViewState[tid]) ticketViewState[tid] = { filter: 'all', sort: 'deadline' };
      ticketViewState[tid].filter = btn.dataset.filter;
      // Update active chip
      btn.closest('.ticket-filter-chips')?.querySelectorAll('.ticket-chip').forEach((b) => b.classList.remove('ticket-chip--active'));
      btn.classList.add('ticket-chip--active');
      // Re-render cards only
      const cardsEl = document.getElementById(`drawer-tickets-${tid}`);
      if (cardsEl) { cardsEl.innerHTML = buildTicketCards(tid); attachTicketCardHandlers(); }
    });
  });
  // Sort select
  document.querySelectorAll('.ticket-sort-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const tid = sel.dataset.taskId;
      if (!ticketViewState[tid]) ticketViewState[tid] = { filter: 'all', sort: 'deadline' };
      ticketViewState[tid].sort = sel.value;
      const cardsEl = document.getElementById(`drawer-tickets-${tid}`);
      if (cardsEl) { cardsEl.innerHTML = buildTicketCards(tid); attachTicketCardHandlers(); }
    });
  });
  // Assignee filter chips (multi-select)
  document.querySelectorAll('.ticket-assignee-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.taskId;
      const name = btn.dataset.assignee;
      if (!ticketViewState[tid]) ticketViewState[tid] = { filter: 'all', sort: 'deadline' };
      const vs = ticketViewState[tid];
      if (!(vs.assigneeFilter instanceof Set)) {
        vs.assigneeFilter = new Set(Array.isArray(vs.assigneeFilter) ? vs.assigneeFilter : []);
      }
      if (vs.assigneeFilter.has(name)) vs.assigneeFilter.delete(name);
      else vs.assigneeFilter.add(name);
      refreshTicketsSection(tid);
    });
  });
  document.querySelectorAll('.ticket-assignee-chip-clear').forEach((btn) => {
    btn.addEventListener('click', () => clearAssigneeFilter(btn.dataset.taskId));
  });
  // Photo picker — add one at a time, show previews
  document.querySelectorAll('.ticket-photo-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const tid = input.id.replace('ticket-photo-input-', '');
      const file = e.target.files[0];
      if (!file) return;
      if (!ticketPhotoStore[tid]) ticketPhotoStore[tid] = [];
      const idx = ticketPhotoStore[tid].push(file) - 1;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const previews = document.getElementById(`ticket-photo-previews-${tid}`);
        if (!previews) return;
        const item = document.createElement('div');
        item.className = 'ticket-preview-item';
        item.dataset.idx = idx;
        item.innerHTML = `<img src="${ev.target.result}" class="ticket-preview-thumb" />
          <button type="button" class="ticket-preview-remove" title="Удалить">✕</button>`;
        item.querySelector('.ticket-preview-remove').addEventListener('click', () => {
          ticketPhotoStore[tid]?.splice(idx, 1);
          item.remove();
        });
        previews.appendChild(item);
      };
      reader.readAsDataURL(file);
      input.value = ''; // reset so same file can be picked again if needed
    });
  });
}

function openStatsDrawer(type) {
  const s = state.schedule;
  const p = s.project;
  const asOf = effectiveToday();

  let tag = 'Сводка', title = '—', html = '';

  if (type === 'total') {
    tag = 'Финансы';
    title = 'Стоимость контракта';
    const vat = p.totalIncVat - p.totalExVat;
    const stages = (p.paymentStages || [])
      .map((ps) => `<div class="drawer-row">
        <div class="drawer-row-head">
          <span class="drawer-row-label">${escapeHtml(ps.label)}</span>
          <span class="drawer-row-val">${fmtAED(p.totalIncVat * ps.share)}</span>
        </div>
        <div class="drawer-row-meta">${Math.round(ps.share * 100)}% · ${escapeHtml(ps.note || '')}</div>
      </div>`).join('');
    html = `<div class="drawer-grid">
      ${kv('Без НДС', fmtAED(p.totalExVat))}
      ${kv('НДС ' + Math.round(p.vatRate * 100) + '%', fmtAED(vat))}
      ${kv('С НДС', fmtAED(p.totalIncVat), { span: true, big: true })}
    </div>
    <div class="drawer-section-title">Этапы оплаты</div>
    <div class="drawer-list">${stages || '—'}</div>`;
  }

  else if (type === 'duration') {
    tag = 'Календарь';
    title = 'Срок проекта';
    const start = parseISO(p.startDate);
    const end = parseISO(p.endDate);
    const durDays = dayDiff(start, end) + 1;
    const workDays = countWorkDays(start, end);
    const holDays = (s.holidays || []).length;
    const rows = s.stages.map((st) => {
      const ts = s.tasks.filter((t) => t.stage === st.id);
      if (!ts.length) return '';
      const sd = ts.map((t) => parseISO(t.planStart || t.start)).reduce((a, b) => (a < b ? a : b));
      const ed = ts.map((t) => parseISO(t.planEnd || t.end)).reduce((a, b) => (a > b ? a : b));
      return `<div class="drawer-row">
        <div class="drawer-row-head">
          <span class="drawer-row-label" style="--dot:${st.color}"><span class="drawer-row-dot"></span>${escapeHtml(st.name)}</span>
          <span class="drawer-row-val">${dayDiff(sd, ed) + 1} ${daysWord(dayDiff(sd, ed) + 1)}</span>
        </div>
        <div class="drawer-row-meta">${fmtDate(toISO(sd))} → ${fmtDate(toISO(ed))}</div>
      </div>`;
    }).join('');
    html = `<div class="drawer-grid">
      ${kv('Начало', escapeHtml(fmtDate(p.startDate)))}
      ${kv('Окончание', escapeHtml(fmtDate(p.endDate)))}
      ${kv('Всего дней', durDays + ' ' + daysWord(durDays))}
      ${kv('Рабочих дней', workDays + ' ' + daysWord(workDays))}
      ${p.contractEndDate ? kv('Сдача по контракту', escapeHtml(fmtDate(p.contractEndDate)), { span: true }) : ''}
      ${kv('Праздничных дат', holDays + ' ' + plural(holDays, ['день', 'дня', 'дней']), { span: true })}
    </div>
    <div class="drawer-section-title">По этапам</div>
    <div class="drawer-list">${rows}</div>`;
  }

  else if (type === 'progress') {
    tag = 'Выполнение';
    title = 'Прогресс';
    const tasks = s.tasks;
    const start = parseISO(p.startDate);
    const end = parseISO(p.endDate);
    let pctTime = 0;
    if (asOf < start) pctTime = 0;
    else if (asOf > end) pctTime = 100;
    else pctTime = Math.round(((asOf - start) / (end - start)) * 100);
    const done = tasks.filter((t) => !!t.actualEnd).length;
    const running = tasks.filter((t) => t.actualStart && !t.actualEnd).length;
    const notStarted = tasks.filter((t) => !t.actualStart).length;
    const overdue = tasks.filter((t) => !t.actualEnd && asOf > parseISO(t.planEnd || t.end)).length;
    const pctTasks = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
    const stageRows = s.stages.map((st) => {
      const { pct, done, total } = stageProgress(st.id);
      if (!total) return '';
      return `<div class="drawer-row">
        <div class="drawer-row-head">
          <span class="drawer-row-label" style="--dot:${st.color}"><span class="drawer-row-dot"></span>${escapeHtml(st.name)}</span>
          <span class="drawer-row-val">${done}/${total} · ${pct}%</span>
        </div>
        <div class="drawer-progress"><div class="drawer-progress-fill" style="width:${pct}%; background:${st.color}"></div></div>
      </div>`;
    }).join('');
    html = `<div class="drawer-grid">
      ${kv('По времени', pctTime + '%')}
      ${kv('По наименованиям', pctTasks + '%')}
      ${kv('Завершено', done + ' из ' + tasks.length)}
      ${kv('В работе', String(running))}
      ${kv('Не начаты', String(notStarted))}
      ${kv('Просрочено', String(overdue))}
      ${kv('На дату', escapeHtml(fmtDate(toISO(asOf))), { span: true })}
    </div>
    <div class="drawer-section-title">По этапам</div>
    <div class="drawer-list">${stageRows}</div>`;
  }

  else if (type === 'tasks') {
    tag = 'Состав';
    title = 'Объём работ';
    const tasks = s.tasks;
    const rows = s.sections.map((sec) => {
      const ts = tasks.filter((t) => t.section === sec.id);
      if (!ts.length) return '';
      const done = ts.filter((t) => !!t.actualEnd).length;
      return `<div class="drawer-row">
        <div class="drawer-row-head">
          <span class="drawer-row-label" style="--dot:${sec.color}"><span class="drawer-row-dot"></span>${escapeHtml(sec.name)}</span>
          <span class="drawer-row-val">${ts.length} ${plural(ts.length, ['наименование', 'наименования', 'наименований'])}</span>
        </div>
        <div class="drawer-row-meta">${done > 0 ? `завершено ${done}` : 'не начато'}</div>
      </div>`;
    }).join('');
    const sectionCount = new Set(tasks.map((t) => t.section)).size;
    html = `<div class="drawer-grid">
      ${kv('Всего наименований', String(tasks.length))}
      ${kv('Секций', String(sectionCount))}
    </div>
    <div class="drawer-section-title">По секциям</div>
    <div class="drawer-list">${rows}</div>`;
  }

  $('#drawer-tag').textContent = tag;
  $('#drawer-title').textContent = title;
  $('#drawer-body').innerHTML = html;
  $('#drawer').setAttribute('aria-hidden', 'false');
}

function countWorkDays(start, end) {
  const hol = new Set((state.schedule.holidays || []).map((h) => h.date));
  let count = 0;
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + DAY_MS)) {
    const dow = d.getUTCDay();
    const iso = toISO(d);
    if (dow !== 5 && dow !== 6 && !hol.has(iso)) count++;
  }
  return count;
}

function closeDrawer() {
  $('#drawer').setAttribute('aria-hidden', 'true');
}
function attachDrawerHandlers() {
  document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeDrawer));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDrawer();
      closeTasksSheet();
    }
  });
}
function attachStatHandlers() {
  document.querySelectorAll('.stat[data-stat]').forEach((el) => {
    el.addEventListener('click', () => openStatsDrawer(el.getAttribute('data-stat')));
  });
}

/* ─── mobile tasks sheet ─── */
function renderTasksSheet() {
  const body = $('#tasks-sheet-body');
  if (!body) return;
  const asOf = effectiveToday();
  const filtered = applyFilterToTasks(state.schedule.tasks);
  const bySec = {};
  for (const t of filtered) (bySec[t.section] ||= []).push(t);

  let html = '';
  for (const sec of state.schedule.sections) {
    const ts = bySec[sec.id] || [];
    if (!ts.length) continue;
    html += `<div class="tasks-sheet-section"><span class="dot" style="background:${sec.color}"></span>${escapeHtml(sec.name)}</div>`;
    for (const t of ts) {
      let status = '', statusLabel = '';
      const pEndD = parseISO(t.planEnd || t.end);
      if (t.actualEnd) { status = 'done'; statusLabel = 'Готово'; }
      else if (t.actualStart) { status = 'running'; statusLabel = 'В работе'; }
      if (!t.actualEnd && asOf > pEndD) { status = 'overdue'; statusLabel = 'Просрочено'; }
      const prog = taskProgress(t);
      const progPct = Math.round(prog * 100);
      const pctBadge = progPct > 0 && progPct < 100 ? `<span class="tpct">${progPct}%</span>` : '';
      const overdueN = !t.actualEnd && asOf > pEndD ? dayDiff(pEndD, asOf) : 0;
      const overdueBadge = overdueN > 0 ? `<span class="tdelay">+${overdueN}д</span>` : '';
      const statusHtml = statusLabel ? `<span class="tstatus ${status}">${escapeHtml(statusLabel)}</span>` : '';
      html += `<button type="button" class="tasks-sheet-item${t.actualEnd ? ' done' : ''}" data-tid="${escapeHtml(t.id)}">
        <span class="tdot" style="background:${sec.color}"></span>
        <span class="tid">${escapeHtml(t.id)}</span>
        <span class="tname">${escapeHtml(t.name)}</span>
        ${pctBadge}
        ${overdueBadge}
        ${statusHtml}
      </button>`;
    }
  }
  body.innerHTML = html;

  body.querySelectorAll('.tasks-sheet-item').forEach((el) => {
    el.addEventListener('click', () => {
      const tid = el.getAttribute('data-tid');
      if (!tid) return;
      closeTasksSheet();
      openDrawer(tid);
    });
  });
}

function openTasksSheet() {
  $('#tasks-sheet').setAttribute('aria-hidden', 'false');
}
function closeTasksSheet() {
  const el = $('#tasks-sheet');
  if (el) el.setAttribute('aria-hidden', 'true');
}
function attachTasksSheetHandlers() {
  const fab = $('#tasks-fab');
  if (fab) fab.addEventListener('click', openTasksSheet);
  document.querySelectorAll('[data-tasks-close]').forEach((el) =>
    el.addEventListener('click', closeTasksSheet)
  );
}

function setupThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-toggle-icon');
  if (!btn || !icon) return;
  const syncIcon = () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    icon.textContent = isDark ? '☀️' : '🌙';
    btn.title = isDark ? 'Переключить на светлую тему' : 'Переключить на тёмную тему';
  };
  syncIcon();
  btn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('theme', next); } catch (_) {}
    syncIcon();
  });
}
setupThemeToggle();
setupAdminMenu();

/* ──────────────────────────────────────────────────────────── */
/*  Admin menu (⚙️) — сервисные функции                        */
/* ──────────────────────────────────────────────────────────── */
function setupAdminMenu() {
  const btn = document.getElementById('admin-toggle');
  const dropdown = document.getElementById('admin-dropdown');
  if (!btn || !dropdown) return;
  const close = () => { dropdown.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const open  = () => { dropdown.hidden = false; btn.setAttribute('aria-expanded', 'true'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dropdown.hidden) open(); else close();
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dropdown.hidden) close(); });
  dropdown.querySelectorAll('.admin-dropdown-item').forEach((item) => {
    item.addEventListener('click', () => {
      const action = item.dataset.adminAction;
      close();
      if (action === 'meeting') openMeetingModal();
    });
  });
}

/* ──────────────────────────────────────────────────────────── */
/*  Meeting notes — хранилище (localStorage)                    */
/* ──────────────────────────────────────────────────────────── */
function getTicketMeetingNotes(ticketId) {
  const arr = state.dataCache.ticketMeetingNotes[ticketId];
  return Array.isArray(arr) ? arr : [];
}
function appendTicketMeetingNote(ticketId, note) {
  const text = (note?.text || '').trim();
  if (!text) return;
  const meetingDate = note?.meetingDate || new Date().toISOString().slice(0, 10);
  const tempId = 'tn_tmp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const optimistic = { id: tempId, text, meetingDate, at: new Date().toISOString(), _pending: true };
  if (!state.dataCache.ticketMeetingNotes[ticketId]) state.dataCache.ticketMeetingNotes[ticketId] = [];
  state.dataCache.ticketMeetingNotes[ticketId].push(optimistic);
  postDataAction('ticket-note:add', { ticketId, slug: state.projectSlug, meetingDate, text })
    .then((res) => {
      if (res && res.note) {
        const idx = (state.dataCache.ticketMeetingNotes[ticketId] || []).findIndex(n => n.id === tempId);
        if (idx >= 0) state.dataCache.ticketMeetingNotes[ticketId][idx] = { ...res.note };
      }
    })
    .catch((e) => {
      console.warn('ticket-note:add failed', e);
      state.dataCache.ticketMeetingNotes[ticketId] = (state.dataCache.ticketMeetingNotes[ticketId] || []).filter(n => n.id !== tempId);
    });
}
function getTaskMeetingNotes(taskId) {
  const arr = state.dataCache.taskMeetingNotes[String(taskId)];
  return Array.isArray(arr) ? arr : [];
}
function appendTaskMeetingNote(taskId, note) {
  const text = (note?.text || '').trim();
  if (!text) return;
  const meetingDate = note?.meetingDate || new Date().toISOString().slice(0, 10);
  const key = String(taskId);
  const tempId = 'mn_tmp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const optimistic = { id: tempId, text, meetingDate, at: new Date().toISOString(), _pending: true };
  if (!state.dataCache.taskMeetingNotes[key]) state.dataCache.taskMeetingNotes[key] = [];
  state.dataCache.taskMeetingNotes[key].push(optimistic);
  postDataAction('task-note:add', { taskId: key, slug: state.projectSlug, meetingDate, text })
    .then((res) => {
      if (res && res.note) {
        const idx = (state.dataCache.taskMeetingNotes[key] || []).findIndex(n => n.id === tempId);
        if (idx >= 0) state.dataCache.taskMeetingNotes[key][idx] = { ...res.note };
      }
    })
    .catch((e) => {
      console.warn('task-note:add failed', e);
      state.dataCache.taskMeetingNotes[key] = (state.dataCache.taskMeetingNotes[key] || []).filter(n => n.id !== tempId);
    });
}
function fmtMeetingDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = d.toLocaleString('ru-RU', { month: 'short' }).replace('.', '');
    return `${dd} ${mm}`;
  } catch (_) { return String(iso); }
}

/* ──────────────────────────────────────────────────────────── */
/*  Meeting modal (UI)                                          */
/* ──────────────────────────────────────────────────────────── */
let meetingModalEl = null;

function openMeetingModal() {
  closeMeetingModal();
  const today = new Date().toISOString().slice(0, 10);
  const modal = document.createElement('div');
  modal.className = 'meeting-modal is-open';
  modal.id = 'meeting-modal';
  modal.innerHTML = `
    <div class="meeting-modal-backdrop"></div>
    <div class="meeting-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="meeting-modal-title">
      <div class="meeting-modal-head">
        <span class="meeting-modal-head-ico" aria-hidden="true">📋</span>
        <div class="meeting-modal-head-text">
          <h3 class="meeting-modal-head-title" id="meeting-modal-title">Применить конспект встречи</h3>
          <div class="meeting-modal-head-sub">GPT найдёт упоминания этого проекта и распределит факты по задачам/тикетам</div>
        </div>
        <button type="button" class="meeting-modal-close" aria-label="Закрыть">✕</button>
      </div>
      <div class="meeting-modal-body" id="meeting-modal-body">
        <div class="meeting-form-row">
          <label class="meeting-form-label" for="meeting-date">Дата встречи</label>
          <input type="date" id="meeting-date" class="meeting-form-input" value="${today}" max="${today}" />
        </div>
        <div class="meeting-form-row">
          <label class="meeting-form-label" for="meeting-transcript">Стенограмма (Read.ai → txt/копипаст)</label>
          <textarea id="meeting-transcript" class="meeting-form-textarea" placeholder="Вставь сюда конспект встречи или перетащи .txt файл ниже…"></textarea>
          <label class="meeting-dropzone" id="meeting-dropzone">
            <input type="file" accept=".txt,.md,text/plain" id="meeting-file" style="display:none" />
            <span id="meeting-dropzone-text">📄 Перетащи сюда .txt / .md или кликни чтобы выбрать</span>
          </label>
        </div>
      </div>
      <div class="meeting-modal-foot">
        <span class="meeting-status" id="meeting-status"></span>
        <div class="meeting-foot-spacer"></div>
        <button type="button" class="meeting-btn" id="meeting-cancel">Отмена</button>
        <button type="button" class="meeting-btn meeting-btn-primary" id="meeting-analyze">Анализировать</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  meetingModalEl = modal;

  modal.querySelector('.meeting-modal-backdrop').addEventListener('click', closeMeetingModal);
  modal.querySelector('.meeting-modal-close').addEventListener('click', closeMeetingModal);
  modal.querySelector('#meeting-cancel').addEventListener('click', closeMeetingModal);
  modal.querySelector('#meeting-analyze').addEventListener('click', () => analyzeMeeting());

  const dropzone = modal.querySelector('#meeting-dropzone');
  const fileInput = modal.querySelector('#meeting-file');
  const txtArea = modal.querySelector('#meeting-transcript');
  fileInput.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (f) await readFileToTextarea(f, txtArea);
  });
  ['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.add('is-drag');
  }));
  ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.remove('is-drag');
  }));
  dropzone.addEventListener('drop', async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) await readFileToTextarea(f, txtArea);
  });

  document.addEventListener('keydown', meetingModalEsc);
  setTimeout(() => txtArea.focus(), 50);
}

function closeMeetingModal() {
  if (meetingModalEl) {
    meetingModalEl.remove();
    meetingModalEl = null;
  }
  document.removeEventListener('keydown', meetingModalEsc);
}
function meetingModalEsc(e) { if (e.key === 'Escape') closeMeetingModal(); }

async function readFileToTextarea(file, textarea) {
  const dropzoneText = document.getElementById('meeting-dropzone-text');
  if (dropzoneText) dropzoneText.textContent = `📎 ${file.name}`;
  try {
    const text = await file.text();
    textarea.value = text;
  } catch (e) {
    setMeetingStatus('Не удалось прочитать файл: ' + e.message, true);
  }
}

function setMeetingStatus(text, isErr) {
  const el = document.getElementById('meeting-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('meeting-status--err', !!isErr);
}

async function analyzeMeeting() {
  const transcript = (document.getElementById('meeting-transcript')?.value || '').trim();
  const meetingDate = document.getElementById('meeting-date')?.value || new Date().toISOString().slice(0, 10);
  if (transcript.length < 30) {
    setMeetingStatus('Слишком коротко — вставь полный текст конспекта', true);
    return;
  }
  const analyzeBtn = document.getElementById('meeting-analyze');
  if (analyzeBtn) { analyzeBtn.disabled = true; analyzeBtn.textContent = 'GPT думает…'; }
  setMeetingStatus('Отправка в GPT-5.4-pro…');

  try {
    const tasks = collectAllTasks();
    const tickets = (state.tickets || []).map((tk) => ({
      ...tk,
      updates: getTicketUpdates(tk.id),
      meeting_notes: getTicketMeetingNotes(tk.id)
    }));
    const project = state.schedule?.project || {};
    const slug = state.projectSlug;
    const r = await fetch('/api/meeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, project, transcript, meetingDate, tasks, tickets })
    });
    const data = await r.json();
    if (!r.ok || data.error) {
      throw new Error(data.error || 'Сервер вернул ошибку ' + r.status);
    }
    showMeetingPreview(data.result || {}, meetingDate);
  } catch (e) {
    setMeetingStatus('Ошибка: ' + e.message, true);
    if (analyzeBtn) { analyzeBtn.disabled = false; analyzeBtn.textContent = 'Анализировать'; }
  }
}

function collectAllTasks() {
  const out = [];
  const sched = state.schedule;
  if (!sched) return out;
  for (const sec of sched.sections || []) {
    const stage = state.stageById[sec.stage_id]?.name || '';
    for (const t of sec.tasks || []) {
      out.push({ id: String(t.id), name: t.name, section: sec.name, stage });
    }
  }
  return out;
}

function showMeetingPreview(result, meetingDate) {
  const body = document.getElementById('meeting-modal-body');
  const foot = document.querySelector('#meeting-modal .meeting-modal-foot');
  if (!body || !foot) return;

  if (!result.projectFound || !result.items?.length) {
    body.innerHTML = `<div class="meeting-preview-empty">
      ${result.projectFound
        ? 'Проект упомянут, но извлечь конкретные факты не удалось. Возможно, обсуждение было слишком общим.'
        : 'В стенограмме не нашлось упоминаний этого проекта. Проверь, правильный ли это конспект.'}
    </div>`;
    foot.innerHTML = `
      <div class="meeting-foot-spacer"></div>
      <button type="button" class="meeting-btn" id="meeting-close-empty">Закрыть</button>`;
    foot.querySelector('#meeting-close-empty').addEventListener('click', closeMeetingModal);
    return;
  }

  const byTask = new Map();
  result.items.forEach((it, idx) => {
    const k = String(it.taskId || 'unknown');
    if (!byTask.has(k)) byTask.set(k, []);
    byTask.get(k).push({ ...it, _idx: idx });
  });
  const taskNameById = new Map();
  for (const t of collectAllTasks()) taskNameById.set(String(t.id), t);

  const summaryHtml = result.summary
    ? `<div class="meeting-preview-summary">📌 ${escapeHtml(result.summary)}</div>`
    : '';
  let sectionsHtml = '';
  for (const [taskId, items] of byTask.entries()) {
    const task = taskNameById.get(taskId);
    const taskTitle = task
      ? `${escapeHtml(task.name)} <span style="color:var(--muted);font-weight:400">· ${escapeHtml(task.section || '')}</span>`
      : `Задача #${escapeHtml(taskId)}`;
    sectionsHtml += `
      <div class="meeting-preview-section">
        <div class="meeting-preview-section-title">${taskTitle}</div>
        ${items.map((it) => {
          const actionLbl =
            it.action === 'append' ? '<span class="meeting-preview-item-action meeting-action-append">➕ Дополнить тикет</span>'
            : it.action === 'create_ticket' ? '<span class="meeting-preview-item-action meeting-action-create">🆕 Создать тикет</span>'
            : '<span class="meeting-preview-item-action meeting-action-task-note">📝 Заметка к работе</span>';
          let refHtml = '';
          if (it.action === 'append' && it.ticketId) {
            const tk = state.tickets.find(t => t.id === it.ticketId);
            const tkTitle = tk ? (tk.title || '').replace(/\[task:\w+\]/gi, '').trim() : '';
            refHtml = `<div class="meeting-preview-item-ref">→ тикет <strong>${escapeHtml(it.ticketId)}</strong>${tkTitle ? ` · ${escapeHtml(tkTitle)}` : ''}</div>`;
          } else if (it.action === 'create_ticket' && it.newTicketTitle) {
            refHtml = `<div class="meeting-preview-item-ref">название: <strong>${escapeHtml(it.newTicketTitle)}</strong></div>`;
          }
          const reasonHtml = it.reason ? `<div class="meeting-preview-item-ref" style="font-style:italic">${escapeHtml(it.reason)}</div>` : '';
          return `
            <label class="meeting-preview-item">
              <input type="checkbox" data-meeting-idx="${it._idx}" checked />
              <div class="meeting-preview-item-body">
                ${actionLbl}
                ${refHtml}
                <div class="meeting-preview-item-text">${escapeHtml(it.text || '')}</div>
                ${reasonHtml}
              </div>
            </label>`;
        }).join('')}
      </div>`;
  }

  body.innerHTML = summaryHtml + sectionsHtml;

  foot.innerHTML = `
    <span class="meeting-status" id="meeting-status">Найдено пунктов: ${result.items.length}. Сними галочки с лишних.</span>
    <div class="meeting-foot-spacer"></div>
    <button type="button" class="meeting-btn" id="meeting-back">← Назад</button>
    <button type="button" class="meeting-btn meeting-btn-primary" id="meeting-apply">Применить выбранные</button>`;
  foot.querySelector('#meeting-back').addEventListener('click', () => {
    closeMeetingModal();
    openMeetingModal();
  });
  foot.querySelector('#meeting-apply').addEventListener('click', () => applyMeetingItems(result.items, meetingDate));
}

async function applyMeetingItems(items, meetingDate) {
  const body = document.getElementById('meeting-modal-body');
  const checkboxes = body?.querySelectorAll('input[type="checkbox"][data-meeting-idx]') || [];
  const selectedIdx = new Set();
  checkboxes.forEach((cb) => { if (cb.checked) selectedIdx.add(Number(cb.dataset.meetingIdx)); });
  const selected = items.filter((_, i) => selectedIdx.has(i));
  if (!selected.length) {
    setMeetingStatus('Ничего не выбрано', true);
    return;
  }

  const applyBtn = document.getElementById('meeting-apply');
  if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Применяю…'; }
  setMeetingStatus('Применение…');

  let appended = 0, created = 0, taskNotes = 0, errors = 0;
  for (const it of selected) {
    try {
      if (it.action === 'append' && it.ticketId) {
        appendTicketMeetingNote(it.ticketId, { at: new Date().toISOString(), meetingDate, text: it.text || '' });
        appended++;
      } else if (it.action === 'task_note' && it.taskId) {
        appendTaskMeetingNote(it.taskId, { at: new Date().toISOString(), meetingDate, text: it.text || '' });
        taskNotes++;
      } else if (it.action === 'create_ticket' && it.taskId) {
        const r = await fetch('/api/planradar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: it.newTicketTitle || ('Из планёрки ' + meetingDate),
            description: it.text || '',
            taskId: String(it.taskId),
            dueDate: '',
            photos: []
          })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || 'PR error');
        if (data.ticket) {
          state.tickets.push(data.ticket);
          appendTicketMeetingNote(data.ticket.id, { at: new Date().toISOString(), meetingDate, text: '🆕 Создан по конспекту: ' + (it.text || '') });
        }
        created++;
      }
    } catch (e) {
      console.error('apply meeting item failed', it, e);
      errors++;
    }
  }

  document.querySelectorAll('.tickets-section[data-task-id]').forEach((sec) => {
    if (typeof refreshTicketsSection === 'function') refreshTicketsSection(sec.dataset.taskId);
  });

  setMeetingStatus(`Готово: дополнено ${appended}, создано ${created}, заметок к работам ${taskNotes}${errors ? `, ошибок ${errors}` : ''}.`);
  if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'Закрыть'; applyBtn.onclick = closeMeetingModal; }
}

init().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<div style="padding:40px;color:#b00020;font-family:Inter,sans-serif;">
    <h2>Ошибка загрузки графика</h2><pre>${escapeHtml(err.stack || err.message)}</pre></div>`;
});

/* ═══════════════════════════════════════════════════════════════════
   Отчёт клиенту — визард с 4 шагами:
   1. Период (presets + custom range)
   2. Тезисы (textarea + voice — будет в следующем чанке)
   3. Фото из тикетов (галерея с multi-select)
   4. Готово (preview + Скачать PDF + Отправить в Telegram)
   ═══════════════════════════════════════════════════════════════════ */
const reportState = {
  step: 1,
  period: { preset: 'week', start: null, end: null },
  theses: '',
  selectedPhotos: new Map(), // ticketId → Set<photoIndex>
  model: 'gpt-5.5-pro',
  drilledTaskId: null,       // step 3: null = list of tasks, set = task detail view
  generating: false,
  result: null,              // { html, photos, stats, project, period }
  error: null,
};

function reportPeriodDates(preset, custom) {
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  if (preset === 'week') {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    return { start: d.toISOString().slice(0, 10), end: todayISO };
  }
  if (preset === 'month') {
    const d = new Date(today);
    d.setDate(d.getDate() - 29);
    return { start: d.toISOString().slice(0, 10), end: todayISO };
  }
  if (preset === 'all') {
    const proj = state.schedule?.project;
    return { start: proj?.startDate || todayISO, end: todayISO };
  }
  if (preset === 'custom') {
    return { start: custom?.start || todayISO, end: custom?.end || todayISO };
  }
  return { start: todayISO, end: todayISO };
}

function fmtDateRu(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) { return iso; }
}

function openReportModal() {
  reportState.step = 1;
  reportState.period = { preset: 'week', start: null, end: null };
  reportState.theses = '';
  reportState.selectedPhotos = new Map();
  reportState.drilledTaskId = null;
  reportState.generating = false;
  reportState.result = null;
  reportState.error = null;
  const dates = reportPeriodDates('week');
  reportState.period.start = dates.start;
  reportState.period.end = dates.end;

  const m = document.getElementById('report-modal');
  if (!m) return;
  m.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  renderReportStep();
}

function closeReportModal() {
  const m = document.getElementById('report-modal');
  if (!m) return;
  m.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function renderReportStep() {
  const body = document.getElementById('report-body');
  const stepLabel = document.getElementById('report-step-label');
  const back = document.getElementById('report-back');
  const next = document.getElementById('report-next');
  if (!body || !stepLabel || !back || !next) return;

  // Stepper dots
  document.querySelectorAll('.report-stepper-dot').forEach((d) => {
    const n = Number(d.getAttribute('data-step'));
    d.classList.toggle('report-stepper-dot--active', n === reportState.step);
    d.classList.toggle('report-stepper-dot--done', n < reportState.step);
  });

  back.disabled = reportState.step === 1;
  const labels = ['Период', 'Тезисы', 'Фото', 'Готово'];
  stepLabel.textContent = `Шаг ${reportState.step} из 4 · ${labels[reportState.step - 1]}`;
  next.textContent = reportState.step === 4 ? '✓ Сформировать' : 'Далее →';

  if (reportState.step === 1) body.innerHTML = renderStep1Period();
  else if (reportState.step === 2) body.innerHTML = renderStep2Theses();
  else if (reportState.step === 3) body.innerHTML = renderStep3Photos();
  else if (reportState.step === 4) body.innerHTML = renderStep4Preview();

  attachStepHandlers();
}

function renderStep1Period() {
  const p = reportState.period;
  const proj = state.schedule?.project || {};
  return `
    <div class="report-step">
      <div class="report-step-hint">За какой период формируем отчёт?</div>
      <div class="report-presets">
        <button type="button" class="report-preset ${p.preset === 'week' ? 'report-preset--active' : ''}" data-preset="week">
          <div class="report-preset-l">Эта неделя</div>
          <div class="report-preset-s">последние 7 дней</div>
        </button>
        <button type="button" class="report-preset ${p.preset === 'month' ? 'report-preset--active' : ''}" data-preset="month">
          <div class="report-preset-l">Этот месяц</div>
          <div class="report-preset-s">последние 30 дней</div>
        </button>
        <button type="button" class="report-preset ${p.preset === 'all' ? 'report-preset--active' : ''}" data-preset="all">
          <div class="report-preset-l">С начала проекта</div>
          <div class="report-preset-s">${fmtDateRu(proj.startDate)} → сегодня</div>
        </button>
        <button type="button" class="report-preset ${p.preset === 'custom' ? 'report-preset--active' : ''}" data-preset="custom">
          <div class="report-preset-l">Свой период</div>
          <div class="report-preset-s">указать вручную</div>
        </button>
      </div>
      <div class="report-period-range ${p.preset === 'custom' ? '' : 'report-period-range--readonly'}">
        <label>
          <span>С</span>
          <input type="date" id="report-period-start" value="${p.start || ''}" ${p.preset === 'custom' ? '' : 'disabled'} />
        </label>
        <label>
          <span>По</span>
          <input type="date" id="report-period-end" value="${p.end || ''}" ${p.preset === 'custom' ? '' : 'disabled'} />
        </label>
      </div>
    </div>`;
}

function renderStep2Theses() {
  return `
    <div class="report-step">
      <div class="report-step-hint">
        Надиктуй или впиши, о чём важно сказать в отчёте.
        <br/><span class="report-step-hint-sub">Достаточно тезисов — AI развернёт их в полноценный отчёт. Можно оставить пустым: тогда отчёт построится только по фактам из графика.</span>
      </div>
      <div class="report-theses-wrap">
        <textarea id="report-theses" class="report-theses" rows="9" placeholder="Например: завершили чистовую отделку open-space, на следующей неделе монтаж стекла в переговорках, есть задержка по сантехнике из-за поставщика..."></textarea>
        <button type="button" class="report-voice-btn" id="report-voice-btn" title="Зажми и говори, отпусти — текст добавится в тезисы">
          🎤 <span id="report-voice-label">надиктовать</span>
        </button>
      </div>
      <div class="report-model-row">
        <span class="report-model-label">AI-модель:</span>
        <select id="report-model" class="report-model-select">
          <option value="gpt-5.5-pro" ${reportState.model === 'gpt-5.5-pro' ? 'selected' : ''}>gpt-5.5-pro · максимум качества</option>
          <option value="gpt-5.4-pro" ${reportState.model === 'gpt-5.4-pro' ? 'selected' : ''}>gpt-5.4-pro · стабильно</option>
          <option value="gpt-5.4" ${reportState.model === 'gpt-5.4' ? 'selected' : ''}>gpt-5.4 · быстро</option>
          <option value="gpt-5.4-mini" ${reportState.model === 'gpt-5.4-mini' ? 'selected' : ''}>gpt-5.4-mini · экономно</option>
        </select>
      </div>
    </div>`;
}

function renderStep3Photos() {
  const tickets = state.tickets || [];
  const inRange = (iso) => iso && iso >= reportState.period.start && iso <= reportState.period.end;
  const filtered = tickets.filter((tk) => inRange(tk.created_at) || inRange((tk.updated_at || '').slice(0, 10)));
  const totalSelected = Array.from(reportState.selectedPhotos.values()).reduce((s, set) => s + set.size, 0);

  if (!filtered.length) {
    return `<div class="report-step">
      <div class="report-empty">
        <div class="report-empty-ico">📭</div>
        <div class="report-empty-t">За этот период тикетов нет</div>
        <div class="report-empty-s">Можно сформировать отчёт без фотографий — он будет построен только по фактам из графика.</div>
      </div>
    </div>`;
  }

  const counterHtml = `<div class="report-counter ${totalSelected > 0 ? 'report-counter--filled' : ''}" id="report-photo-counter">
    ${totalSelected > 0 ? `Выбрано фото: <strong>${totalSelected}</strong>` : 'Фото не выбрано'}
  </div>`;

  // ─── Detail view: drill-down into one task ───
  if (reportState.drilledTaskId != null) {
    const taskId = String(reportState.drilledTaskId);
    const task = (state.schedule?.tasks || []).find((t) => String(t.id) === taskId);
    const taskName = task?.name || `Задача #${taskId}`;
    const sec = task ? state.sectionById[task.section] : null;
    const taskTickets = filtered.filter((tk) => String(tk.task_id) === taskId);
    const taskPhotoCount = taskTickets.reduce((s, tk) => s + (Array.isArray(tk.photos) ? tk.photos.length : 0), 0);
    const taskSelected = taskTickets.reduce((s, tk) => s + ((reportState.selectedPhotos.get(String(tk.id)) || new Set()).size), 0);

    const cards = taskTickets.map((tk) => {
      const tid = String(tk.id);
      const sel = reportState.selectedPhotos.get(tid) || new Set();
      const photos = Array.isArray(tk.photos) ? tk.photos : [];
      const photosHtml = photos.length ? photos.map((p, idx) => {
        const isSel = sel.has(idx);
        return `<button type="button" class="report-photo ${isSel ? 'report-photo--selected' : ''}" data-tid="${escapeHtml(tid)}" data-pidx="${idx}" aria-pressed="${isSel}">
          <img src="${escapeHtml(p.thumb || p.url)}" class="report-photo-img" alt="" loading="lazy" />
          <span class="report-photo-check" aria-hidden="true">${isSel ? '✓' : ''}</span>
        </button>`;
      }).join('') : `<div class="report-photo-empty">— у тикета нет фото —</div>`;

      const statusLbl = TICKET_STATUS_LABEL[tk.status] || tk.status || '';
      return `<div class="report-ticket">
        <div class="report-ticket-head">
          <span class="report-ticket-status report-ticket-status--${escapeHtml(tk.status || 'open')}">${escapeHtml(statusLbl)}</span>
          <span class="report-ticket-title">${escapeHtml(tk.title || tk.subject || '—')}</span>
          <span class="report-ticket-meta">${tk.created_at ? escapeHtml(fmtDate(tk.created_at)) : ''}</span>
          ${photos.length ? `<button type="button" class="report-ticket-all" data-tid="${escapeHtml(tid)}">Все ${photos.length}</button>` : ''}
        </div>
        <div class="report-ticket-photos">${photosHtml}</div>
      </div>`;
    }).join('');

    return `<div class="report-step">
      <button type="button" class="report-back-link" id="report-back-to-tasks">← Все виды работ</button>
      <div class="report-task-detail-head">
        <div class="report-task-detail-title">
          ${sec ? `<span class="report-task-detail-sec" style="background:${sec.color}22; color:${sec.color}">${escapeHtml(sec.name)}</span>` : ''}
          <span>${escapeHtml(taskName)}</span>
        </div>
        <div class="report-task-detail-stats">
          <span><strong>${taskTickets.length}</strong> ${taskTickets.length === 1 ? 'тикет' : 'тикетов'}</span>
          <span><strong>${taskPhotoCount}</strong> фото всего</span>
          <span class="${taskSelected ? 'report-task-detail-selected' : ''}"><strong>${taskSelected}</strong> выбрано</span>
        </div>
      </div>
      ${counterHtml}
      <div class="report-tickets">${cards || '<div class="report-empty-s">У этой работы нет тикетов в периоде.</div>'}</div>
    </div>`;
  }

  // ─── List view: tasks with tickets in period ───
  const ticketsByTask = new Map();
  filtered.forEach((tk) => {
    const tid = String(tk.task_id || 'orphan');
    if (!ticketsByTask.has(tid)) ticketsByTask.set(tid, []);
    ticketsByTask.get(tid).push(tk);
  });

  const taskCards = Array.from(ticketsByTask.entries()).map(([taskId, tks]) => {
    const task = (state.schedule?.tasks || []).find((t) => String(t.id) === taskId);
    const taskName = task?.name || `Без привязки к работе`;
    const sec = task ? state.sectionById[task.section] : null;
    const photoCount = tks.reduce((s, tk) => s + (Array.isArray(tk.photos) ? tk.photos.length : 0), 0);
    const selectedCount = tks.reduce((s, tk) => s + ((reportState.selectedPhotos.get(String(tk.id)) || new Set()).size), 0);
    const previewPhotos = [];
    for (const tk of tks) {
      for (const p of (tk.photos || [])) {
        previewPhotos.push(p);
        if (previewPhotos.length >= 4) break;
      }
      if (previewPhotos.length >= 4) break;
    }
    const previewHtml = previewPhotos.length
      ? previewPhotos.map((p) => `<img class="report-task-prev-img" src="${escapeHtml(p.thumb || p.url)}" alt="" loading="lazy"/>`).join('')
      : `<div class="report-task-prev-empty">без фото</div>`;

    return `<button type="button" class="report-task-card ${selectedCount ? 'report-task-card--has-selected' : ''}" data-task-id="${escapeHtml(taskId)}">
      <div class="report-task-card-head">
        ${sec ? `<span class="report-task-sec" style="background:${sec.color}22; color:${sec.color}">${escapeHtml(sec.name)}</span>` : ''}
        <div class="report-task-name">${escapeHtml(taskName)}</div>
        <span class="report-task-arrow" aria-hidden="true">›</span>
      </div>
      <div class="report-task-stats">
        <span>${tks.length} ${tks.length === 1 ? 'тикет' : 'тикетов'}</span>
        <span>·</span>
        <span>${photoCount} фото</span>
        ${selectedCount ? `<span class="report-task-selected-badge">✓ ${selectedCount}</span>` : ''}
      </div>
      <div class="report-task-prev">${previewHtml}</div>
    </button>`;
  }).join('');

  return `<div class="report-step">
    <div class="report-step-hint">
      Выбери вид работ — внутри увидишь тикеты с фотографиями.
      <br/><span class="report-step-hint-sub">Можно зайти в несколько работ, в каждой выбрать нужные фото. Если не выбрать ничего — отчёт без фотографий.</span>
    </div>
    ${counterHtml}
    <div class="report-task-list">${taskCards}</div>
  </div>`;
}

function renderStep4Preview() {
  // Three sub-states: generating → result → preview
  if (reportState.generating) {
    return `<div class="report-step report-step--generating">
      <div class="report-spinner" aria-hidden="true"></div>
      <div class="report-gen-title">Готовлю отчёт…</div>
      <div class="report-gen-sub">Собираю изменения графика, расширяю тезисы через AI, прикладываю фото. 10–30 секунд.</div>
    </div>`;
  }
  if (reportState.result) {
    const r = reportState.result;
    const photosStrip = (r.photos && r.photos.length)
      ? `<div class="report-result-photos">
          <div class="report-result-lbl">Фото в отчёте · ${r.photos.length}</div>
          <div class="report-result-photos-grid">
            ${r.photos.map((p) => `<div class="report-result-photo"><img src="${p.dataUrl}" alt=""/><div class="report-result-photo-cap">${escapeHtml(p.ticketTitle || '')}</div></div>`).join('')}
          </div>
        </div>`
      : '';
    return `<div class="report-step report-step--result">
      <div class="report-result-success">
        <span class="report-result-success-ico">✓</span>
        <div>
          <div class="report-result-success-t">Отчёт готов</div>
          <div class="report-result-success-s">${escapeHtml(r.project?.name || '')} · ${escapeHtml(fmtDateRu(r.period?.start))} — ${escapeHtml(fmtDateRu(r.period?.end))}</div>
        </div>
      </div>
      <div class="report-result-html">${r.html}</div>
      ${photosStrip}
      <div class="report-result-actions">
        <button type="button" class="report-result-btn report-result-btn--primary" id="report-download-btn">
          <span aria-hidden="true">⬇</span> Скачать PDF
        </button>
        <button type="button" class="report-result-btn" id="report-share-btn">
          <span aria-hidden="true">🔗</span> Поделиться
        </button>
        <button type="button" class="report-result-btn report-result-btn--ghost" id="report-restart-btn">
          ↺ Новый отчёт
        </button>
      </div>
    </div>`;
  }
  if (reportState.error) {
    return `<div class="report-step">
      <div class="report-error">
        <div class="report-error-ico">⚠️</div>
        <div class="report-error-t">Не удалось сформировать отчёт</div>
        <div class="report-error-s">${escapeHtml(reportState.error)}</div>
        <button type="button" class="report-result-btn" id="report-retry-btn">Попробовать снова</button>
      </div>
    </div>`;
  }

  // Default: preview before generation
  const totalSelected = Array.from(reportState.selectedPhotos.values()).reduce((s, set) => s + set.size, 0);
  const proj = state.schedule?.project || {};
  const tasksInPeriod = (state.schedule?.tasks || []).filter((t) => {
    const hist = Array.isArray(t.history) ? t.history : [];
    return hist.some((h) => {
      const d = (h.at || '').slice(0, 10);
      return d >= reportState.period.start && d <= reportState.period.end;
    });
  });
  const ticketsInPeriod = (state.tickets || []).filter((tk) => {
    const c = tk.created_at;
    return c >= reportState.period.start && c <= reportState.period.end;
  });

  return `<div class="report-step report-step--preview">
    <div class="report-step-hint">
      Проверь параметры — и жми <strong>«Сформировать»</strong>. AI напишет отчёт, добавит выбранные фото, на следующем экране — кнопки <strong>Скачать</strong> и <strong>Поделиться</strong>.
    </div>
    <div class="report-summary">
      <div class="report-summary-row">
        <div class="report-summary-k">Проект</div>
        <div class="report-summary-v">${escapeHtml(proj.name || '—')}</div>
      </div>
      <div class="report-summary-row">
        <div class="report-summary-k">Период</div>
        <div class="report-summary-v">${escapeHtml(fmtDateRu(reportState.period.start))} — ${escapeHtml(fmtDateRu(reportState.period.end))}</div>
      </div>
      <div class="report-summary-row">
        <div class="report-summary-k">AI модель</div>
        <div class="report-summary-v">${escapeHtml(reportState.model)}</div>
      </div>
      <div class="report-summary-row">
        <div class="report-summary-k">Тезисы</div>
        <div class="report-summary-v report-summary-v--text">${reportState.theses ? escapeHtml(reportState.theses).replace(/\n/g, '<br/>') : '<em style="color:var(--muted)">не указаны — AI построит отчёт по фактам</em>'}</div>
      </div>
      <div class="report-summary-row">
        <div class="report-summary-k">Изменений в графике</div>
        <div class="report-summary-v"><strong>${tasksInPeriod.length}</strong> ${tasksInPeriod.length === 1 ? 'задача' : 'задач'} с активностью</div>
      </div>
      <div class="report-summary-row">
        <div class="report-summary-k">Тикетов за период</div>
        <div class="report-summary-v"><strong>${ticketsInPeriod.length}</strong></div>
      </div>
      <div class="report-summary-row">
        <div class="report-summary-k">Фото в отчёте</div>
        <div class="report-summary-v"><strong>${totalSelected}</strong></div>
      </div>
    </div>
  </div>`;
}

/* Build photo request payload — flatten selectedPhotos Map to URL list */
function buildPhotoRequests() {
  const out = [];
  for (const [ticketId, idxSet] of reportState.selectedPhotos.entries()) {
    const tk = (state.tickets || []).find((x) => String(x.id) === String(ticketId));
    if (!tk) continue;
    const task = (state.schedule?.tasks || []).find((t) => String(t.id) === String(tk.task_id));
    const photos = Array.isArray(tk.photos) ? tk.photos : [];
    for (const idx of idxSet) {
      const p = photos[idx];
      if (!p?.url) continue;
      out.push({
        ticketId: String(ticketId),
        ticketTitle: (tk.title || tk.subject || '').replace(/\[task:\w+\]/gi, '').trim(),
        taskName: task?.name || '',
        url: p.url
      });
    }
  }
  return out;
}

async function runReportGeneration() {
  reportState.generating = true;
  reportState.error = null;
  reportState.result = null;
  renderReportStep();
  updateFooterButtons();

  try {
    const payload = {
      slug: state.projectSlug,
      period: { start: reportState.period.start, end: reportState.period.end },
      theses: reportState.theses,
      model: reportState.model,
      photos: buildPhotoRequests()
    };
    const r = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Сервер вернул ${r.status}: ${txt.slice(0, 200)}`);
    }
    const data = await r.json();
    reportState.result = data;
  } catch (e) {
    reportState.error = e.message || String(e);
  } finally {
    reportState.generating = false;
    renderReportStep();
    updateFooterButtons();
  }
}

function updateFooterButtons() {
  const back = document.getElementById('report-back');
  const next = document.getElementById('report-next');
  const foot = document.querySelector('.report-foot');
  if (!back || !next) return;
  if (reportState.step === 4 && (reportState.generating || reportState.result || reportState.error)) {
    // Hide footer when result is visible — own buttons are inside step
    if (foot) foot.style.display = 'none';
    return;
  }
  if (foot) foot.style.display = '';
}

/* Build full report HTML for PDF rendering */
function buildReportPdfHtml(r) {
  const photosHtml = (r.photos && r.photos.length)
    ? `<div class="rep-pdf-photos-title">Фотогалерея</div>
       <div class="rep-pdf-photos">
         ${r.photos.map((p) => `<div class="rep-pdf-photo"><img src="${p.dataUrl}"/><div class="rep-pdf-photo-cap">${escapeHtml(p.ticketTitle || '')}${p.taskName ? ` · ${escapeHtml(p.taskName)}` : ''}</div></div>`).join('')}
       </div>`
    : '';
  return `<div class="rep-pdf-page">
    <header class="rep-pdf-head">
      <div class="rep-pdf-brand">CYFR FITOUT L.L.C</div>
      <div class="rep-pdf-meta">
        <div class="rep-pdf-project">${escapeHtml(r.project?.name || '')}</div>
        <div class="rep-pdf-period">Отчёт: ${escapeHtml(fmtDateRu(r.period?.start))} — ${escapeHtml(fmtDateRu(r.period?.end))}</div>
        <div class="rep-pdf-stats">Прогресс: <strong>${r.stats?.totalProgress || 0}%</strong> · Изменений: <strong>${r.stats?.tasksChanged || 0}</strong> · Тикетов: <strong>${r.stats?.ticketsCreated || 0}</strong></div>
      </div>
    </header>
    <div class="rep-pdf-body">${r.html || ''}</div>
    ${photosHtml}
    <footer class="rep-pdf-foot">
      <span>${escapeHtml(r.project?.customer || '')}</span>
      <span>${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
    </footer>
  </div>`;
}

async function generateReportPdfBlob(r) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;font-family:Inter,-apple-system,sans-serif;';
  container.innerHTML = buildReportPdfHtml(r);
  document.body.appendChild(container);
  try {
    const node = container.querySelector('.rep-pdf-page');
    // Wait a tick for images to layout
    await new Promise((res) => setTimeout(res, 60));
    const canvas = await window.html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const pageW = 210, pageH = 297;
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    if (imgH <= pageH) {
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, imgW, imgH);
    } else {
      // multi-page: slice canvas by pageH
      const pxPerMm = canvas.width / pageW;
      const sliceH = pageH * pxPerMm;
      let sy = 0;
      let pageIdx = 0;
      while (sy < canvas.height) {
        const h = Math.min(sliceH, canvas.height - sy);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = h;
        const ctx = sliceCanvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(canvas, 0, sy, canvas.width, h, 0, 0, canvas.width, h);
        if (pageIdx > 0) doc.addPage();
        const sliceImgH = (h / pxPerMm);
        doc.addImage(sliceCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, imgW, sliceImgH);
        sy += h;
        pageIdx++;
      }
    }
    return doc.output('blob');
  } finally {
    document.body.removeChild(container);
  }
}

function buildReportFileName(r) {
  const slug = (r.project?.name || 'report').toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').slice(0, 40);
  const start = (r.period?.start || '').replace(/-/g, '');
  const end = (r.period?.end || '').replace(/-/g, '');
  return `cyfr-${slug}-${start}-${end}.pdf`;
}

async function downloadReportPdf() {
  if (!reportState.result) return;
  const btn = document.getElementById('report-download-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Готовлю…'; }
  try {
    const blob = await generateReportPdfBlob(reportState.result);
    const fname = buildReportFileName(reportState.result);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    alert('Не удалось сохранить PDF: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span aria-hidden="true">⬇</span> Скачать PDF'; }
  }
}

/* Voice recording for theses textarea — toggle press to start, press to stop */
const voiceState = { recording: false, mediaRecorder: null, chunks: [], stream: null };

async function startVoiceRecording(btn) {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Голосовой ввод не поддерживается в этом браузере');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceState.stream = stream;
    voiceState.chunks = [];
    // Pick supported mime
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
      .find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    voiceState.mediaRecorder = mr;
    mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) voiceState.chunks.push(e.data); };
    mr.onstop = () => onVoiceRecordingDone(btn);
    mr.start();
    voiceState.recording = true;
    btn.classList.add('report-voice-btn--recording');
    const lbl = btn.querySelector('#report-voice-label');
    if (lbl) lbl.textContent = 'остановить';
  } catch (e) {
    alert('Доступ к микрофону отклонён: ' + (e.message || e));
  }
}

function stopVoiceRecording(btn) {
  try {
    if (voiceState.mediaRecorder && voiceState.recording) {
      voiceState.mediaRecorder.stop();
    }
    if (voiceState.stream) voiceState.stream.getTracks().forEach((t) => t.stop());
  } catch (_) {}
  voiceState.recording = false;
  btn.classList.remove('report-voice-btn--recording');
}

async function onVoiceRecordingDone(btn) {
  const lbl = btn.querySelector('#report-voice-label');
  if (lbl) lbl.textContent = 'распознаю…';
  btn.disabled = true;
  try {
    if (!voiceState.chunks.length) {
      if (lbl) lbl.textContent = 'надиктовать';
      btn.disabled = false;
      return;
    }
    const blob = new Blob(voiceState.chunks, { type: voiceState.chunks[0]?.type || 'audio/webm' });
    const fd = new FormData();
    fd.append('file', blob, 'voice.webm');
    fd.append('language', 'ru');
    const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`сервер вернул ${r.status}: ${txt.slice(0, 120)}`);
    }
    const d = await r.json();
    const text = (d.text || '').trim();
    if (text) {
      const ta = document.getElementById('report-theses');
      if (ta) {
        const prev = (reportState.theses || '').trim();
        const joined = prev ? prev + ' ' + text : text;
        reportState.theses = joined;
        ta.value = joined;
        ta.focus();
      }
    }
  } catch (e) {
    alert('Не удалось распознать: ' + (e.message || e));
  } finally {
    if (lbl) lbl.textContent = 'надиктовать';
    btn.disabled = false;
    voiceState.chunks = [];
    voiceState.mediaRecorder = null;
    voiceState.stream = null;
  }
}

function attachVoiceRecording(btn) {
  btn.addEventListener('click', () => {
    if (voiceState.recording) stopVoiceRecording(btn);
    else startVoiceRecording(btn);
  });
}

async function shareReportPdf() {
  if (!reportState.result) return;
  const btn = document.getElementById('report-share-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Готовлю…'; }
  try {
    const blob = await generateReportPdfBlob(reportState.result);
    const fname = buildReportFileName(reportState.result);
    const file = new File([blob], fname, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      // Fallback — download
      await downloadReportPdf();
    }
  } catch (e) {
    if (e?.name !== 'AbortError') alert('Не удалось поделиться: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span aria-hidden="true">🔗</span> Поделиться'; }
  }
}

function attachStepHandlers() {
  // Step 1
  document.querySelectorAll('.report-preset').forEach((b) => {
    b.addEventListener('click', () => {
      const preset = b.getAttribute('data-preset');
      reportState.period.preset = preset;
      if (preset !== 'custom') {
        const r = reportPeriodDates(preset);
        reportState.period.start = r.start;
        reportState.period.end = r.end;
      }
      renderReportStep();
    });
  });
  const ps = document.getElementById('report-period-start');
  const pe = document.getElementById('report-period-end');
  if (ps) ps.addEventListener('change', () => { reportState.period.start = ps.value; });
  if (pe) pe.addEventListener('change', () => { reportState.period.end = pe.value; });

  // Step 2
  const ta = document.getElementById('report-theses');
  if (ta) {
    ta.value = reportState.theses;
    ta.addEventListener('input', () => { reportState.theses = ta.value; });
  }
  const ms = document.getElementById('report-model');
  if (ms) ms.addEventListener('change', () => { reportState.model = ms.value; });
  // Step 2 — voice input
  const voiceBtn = document.getElementById('report-voice-btn');
  if (voiceBtn) attachVoiceRecording(voiceBtn);

  // Step 3 — task list cards
  document.querySelectorAll('.report-task-card').forEach((card) => {
    card.addEventListener('click', () => {
      reportState.drilledTaskId = card.getAttribute('data-task-id');
      renderReportStep();
      const body = document.getElementById('report-body');
      if (body) body.scrollTop = 0;
    });
  });
  // Step 3 — back to task list
  const backToTasks = document.getElementById('report-back-to-tasks');
  if (backToTasks) backToTasks.addEventListener('click', () => {
    reportState.drilledTaskId = null;
    renderReportStep();
  });

  // Step 3 — photo toggle
  document.querySelectorAll('.report-photo').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tid = btn.getAttribute('data-tid');
      const pidx = Number(btn.getAttribute('data-pidx'));
      const set = reportState.selectedPhotos.get(tid) || new Set();
      if (set.has(pidx)) set.delete(pidx); else set.add(pidx);
      if (set.size) reportState.selectedPhotos.set(tid, set);
      else reportState.selectedPhotos.delete(tid);
      btn.classList.toggle('report-photo--selected');
      btn.setAttribute('aria-pressed', btn.classList.contains('report-photo--selected'));
      const check = btn.querySelector('.report-photo-check');
      if (check) check.textContent = btn.classList.contains('report-photo--selected') ? '✓' : '';
      const counter = document.getElementById('report-photo-counter');
      if (counter) {
        const total = Array.from(reportState.selectedPhotos.values()).reduce((s, set) => s + set.size, 0);
        counter.classList.toggle('report-counter--filled', total > 0);
        counter.innerHTML = total > 0 ? `Выбрано фото: <strong>${total}</strong>` : 'Фото не выбрано';
      }
    });
  });
  document.querySelectorAll('.report-ticket-all').forEach((b) => {
    b.addEventListener('click', () => {
      const tid = b.getAttribute('data-tid');
      const tk = (state.tickets || []).find((x) => String(x.id) === tid);
      if (!tk) return;
      const photos = Array.isArray(tk.photos) ? tk.photos : [];
      const set = new Set(photos.map((_, i) => i));
      reportState.selectedPhotos.set(tid, set);
      renderReportStep();
    });
  });

  // Step 4 — result actions
  const dlBtn = document.getElementById('report-download-btn');
  if (dlBtn) dlBtn.addEventListener('click', downloadReportPdf);
  const shBtn = document.getElementById('report-share-btn');
  if (shBtn) shBtn.addEventListener('click', shareReportPdf);
  const reBtn = document.getElementById('report-restart-btn');
  if (reBtn) reBtn.addEventListener('click', () => {
    reportState.step = 1;
    reportState.result = null;
    reportState.error = null;
    renderReportStep();
    updateFooterButtons();
  });
  const retryBtn = document.getElementById('report-retry-btn');
  if (retryBtn) retryBtn.addEventListener('click', runReportGeneration);
}

/* Open the wizard from a Telegram deep-link — pre-fill period + theses + jump to step 4 */
function openReportFromDeepLink(params) {
  const start = params.get('start');
  const end = params.get('end');
  const theses = params.get('theses') || '';
  const model = params.get('model');
  const autoSubmit = params.get('go') === '1';

  // Reset and populate
  reportState.step = 4;
  reportState.period = {
    preset: 'custom',
    start: start || reportState.period.start,
    end: end || reportState.period.end,
  };
  reportState.theses = theses;
  reportState.selectedPhotos = new Map();
  reportState.drilledTaskId = null;
  reportState.generating = false;
  reportState.result = null;
  reportState.error = null;
  if (model) reportState.model = model;

  const m = document.getElementById('report-modal');
  if (!m) return;
  m.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  renderReportStep();

  // If `go=1` — start generation right away (zero-click flow from Telegram)
  if (autoSubmit) setTimeout(() => runReportGeneration(), 100);
}

function attachReportHandlers() {
  const btn = document.getElementById('btn-report');
  if (btn) btn.addEventListener('click', openReportModal);
  document.querySelectorAll('[data-report-close]').forEach((el) => el.addEventListener('click', closeReportModal));

  const back = document.getElementById('report-back');
  const next = document.getElementById('report-next');
  if (back) back.addEventListener('click', () => {
    // If drilled into a task on step 3, "back" first exits drill
    if (reportState.step === 3 && reportState.drilledTaskId != null) {
      reportState.drilledTaskId = null;
      renderReportStep();
      return;
    }
    if (reportState.step > 1) { reportState.step--; reportState.drilledTaskId = null; renderReportStep(); }
  });
  if (next) next.addEventListener('click', () => {
    if (reportState.step < 4) {
      reportState.step++;
      reportState.drilledTaskId = null;
      renderReportStep();
    } else if (!reportState.result && !reportState.generating) {
      runReportGeneration();
    }
  });

  // Esc closes
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('report-modal')?.getAttribute('aria-hidden') === 'false') {
      closeReportModal();
    }
  });
}
