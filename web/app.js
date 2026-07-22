// __SERVER_API_REPOINT__ 2026-05-21 — весь backend на своём сервере (Hetzner, Postgres).
// ВСЕ /api/* идут на сервер. Тикеты тоже на сервере (PlanRadar убран). Сайт = тонкий фронт.
(function () {
  const API_BASE = 'https://178-105-194-185.sslip.io';
  const _f = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    if (typeof url === 'string' && url.startsWith('/api/')) {
      return _f(API_BASE + url, opts);
    }
    return _f(url, opts);
  };
})();

const $ = (sel) => document.querySelector(sel);
const DAY_MS = 86400000;

// «Мобильная» раскладка = узкий экран ИЛИ низкий (телефон в ландшафте: ширина >720, но высота мала).
// Иначе телефон в горизонтали попадал в desktop-раскладку с вложенным скроллом → залипание шапки
// не снималось на iOS. Единый одно-скролльный layout для обеих ориентаций. __MOBILE_LANDSCAPE_FIX__
const MOBILE_MQ = window.matchMedia('(max-width: 720px), (max-height: 500px)');
const isMobile = () => MOBILE_MQ.matches;
const CELL_BASE = 22;
const CELL_MIN = 4;
const CELL_MAX = 80;
const ZOOM_PRESETS = [6, 10, 14, 18, 22, 28, 36, 50, 70];
const clampCell = (x) => Math.max(CELL_MIN, Math.min(CELL_MAX, x));
const currentCellW = () => state.cellW;
const MOBILE_LABEL_W = 110;

// Госпраздники ОАЭ — отмечаются на календаре всегда. Фиксированные (григорианские) — точные;
// исламские (по луне) помечены «≈», т.к. зависят от наблюдения месяца и уточняются после
// официального объявления. Покрывают окно текущих проектов; продлевать по мере надобности.
// __UAE_HOLIDAYS__
const UAE_HOLIDAYS = [
  { date: '2026-05-26', name: '≈ День Арафа (ОАЭ)' },
  { date: '2026-05-27', name: '≈ Ид аль-Адха (Курбан-байрам), день 1' },
  { date: '2026-05-28', name: '≈ Ид аль-Адха, день 2' },
  { date: '2026-05-29', name: '≈ Ид аль-Адха, день 3' },
  { date: '2026-06-16', name: '≈ Исламский Новый год' },
  { date: '2026-08-25', name: '≈ День рождения Пророка Мухаммеда' },
  { date: '2026-12-01', name: 'День памяти (ОАЭ)' },
  { date: '2026-12-02', name: 'Национальный день ОАЭ, день 1' },
  { date: '2026-12-03', name: 'Национальный день ОАЭ, день 2' },
  { date: '2027-01-01', name: 'Новый год' },
  { date: '2027-03-10', name: '≈ Ид аль-Фитр (Ураза-байрам), день 1' },
  { date: '2027-03-11', name: '≈ Ид аль-Фитр, день 2' },
  { date: '2027-03-12', name: '≈ Ид аль-Фитр, день 3' },
];
const currentLabelW = () => (isMobile() ? MOBILE_LABEL_W : 260);
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
    taskMaterials: {},      // { taskId: [{name,leadTime,ordered,expectedDate,note}] }
    taskDependencies: [],   // [{id, taskId, dependsOnTaskId, source: 'auto'|'manual', rationale, at}]
    progressLog: []         // [{id, taskId, taskName, action, prevProgress, newProgress, rawText, reason, reporterName, at}] — sorted desc by 'at'
  },
  dataLoaded: false,
  // Cached graph derived from taskDependencies
  depsGraph: { byTask: new Map(), byDependency: new Map() },
  // Persisted positions for the dependencies modal (per project, in localStorage)
  depPositions: {},
  // Edit mode — включает inline-edit имени работы, кнопки + Раздел / + Работа,
  // удаление, drag дат на Гантте.
  editMode: false,
  selectedBarTid: null,
};

function getProjectSlug() {
  const m = window.location.pathname.match(/^\/p\/([a-z0-9][a-z0-9-]*)\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

function isRootPath() {
  const p = window.location.pathname;
  return p === '' || p === '/' || p === '/p' || p === '/p/';
}

function scheduleJsonUrl(slug) {
  // Грузим через наш Vercel-эндпоинт, который читает GitHub Contents API
  // (минуя 5-минутный кеш raw.githubusercontent.com).
  return `/api/data?slug=${encodeURIComponent(slug)}&schedule=1&t=${Date.now()}`;
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

function hideAdminMenu() {
  const m = document.getElementById('admin-menu');
  if (m) m.style.display = 'none';
}

function hideMobileTasksFab() {
  const fab = document.getElementById('tasks-fab');
  if (fab) fab.style.display = 'none';
  const sheet = document.getElementById('tasks-sheet');
  if (sheet) sheet.style.display = 'none';
}

function clearPageBelowTopbar() {
  const page = document.querySelector('.page');
  if (!page) return null;
  document.body.classList.remove('booting'); // маршрут выбран (лист/главная) — статичный Gantt-каркас больше не нужен
  const topBar = page.querySelector('.top-bar');
  Array.from(page.children).forEach((c) => { if (c !== topBar) c.remove(); });
  return page;
}

function injectLandingStyles() {
  if (document.getElementById('landing-styles')) return;
  const s = document.createElement('style');
  s.id = 'landing-styles';
  s.textContent = `
    .landing-wrap { max-width: 960px; margin: 0 auto; padding: 56px 24px 80px; font-family: 'Inter', -apple-system, sans-serif; }
    .landing-head { margin-bottom: 28px; }
    .landing-title { font-size: 32px; font-weight: 800; letter-spacing: -0.8px; color: var(--ink); margin: 0 0 8px; line-height: 1.15; }
    .landing-sub { font-size: 14px; color: var(--muted); line-height: 1.55; max-width: 600px; }
    .landing-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
    .landing-card { display: block; text-decoration: none; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
    .landing-card:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); border-color: var(--navy); }
    .landing-card-name { font-size: 15px; font-weight: 600; color: var(--ink); margin-bottom: 4px; letter-spacing: -0.2px; line-height: 1.3; }
    .landing-card-meta { font-size: 11px; color: var(--muted); letter-spacing: 0; }
    .landing-card--maint { border-left: 3px solid #BD773E; }
    .landing-card--maint:hover { border-color: #BD773E; }
    /* __LANDING_SPLIT_v2__ две колонки-области */
    .landing-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
    .landing-group { margin-bottom: 0; border: 1px solid var(--line); border-radius: 16px; padding: 18px 18px 20px; background: var(--card); }
    .landing-group--fitout { border-top: 4px solid #2563eb; }
    .landing-group--maint { border-top: 4px solid #BD773E; }
    .landing-group-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 2px; flex-wrap: wrap; }
    .landing-group-titles { display: flex; align-items: center; gap: 9px; }
    .landing-group-title { font-size: 18px; font-weight: 800; color: var(--ink); margin: 0; letter-spacing: -0.3px; }
    .landing-group-count { font-size: 12px; font-weight: 700; color: var(--muted); background: var(--surface-2, #f1f5f9); border-radius: 999px; padding: 1px 9px; }
    .landing-group-hint { font-size: 12.5px; color: var(--muted); margin-bottom: 14px; }
    .landing-group-empty { color: var(--muted); font-size: 13px; padding: 14px 0; opacity: .75; }
    .landing-grid { grid-template-columns: 1fr; }
    .landing-add-btn { font: inherit; font-size: 13.5px; font-weight: 700; padding: 9px 14px; border-radius: 10px; border: none; color: #fff; cursor: pointer; white-space: nowrap; }
    .landing-group--fitout .landing-add-btn { background: #2563eb; }
    .landing-group--maint .landing-add-btn { background: #BD773E; }
    .landing-group--supply { border-top: 4px solid #2a78d6; margin-bottom: 18px; padding-bottom: 16px; }
    .landing-group--supply .landing-add-btn { background: #2a78d6; }
    .landing-group--supply .landing-group-hint { margin-bottom: 0; }
    .landing-create-btn { margin-top: 14px; font: inherit; font-size: 15px; font-weight: 700; padding: 12px 18px; border-radius: 11px; border: none; background: #BD773E; color: #fff; cursor: pointer; }
    .fc-note { font-size: 12.5px; color: var(--muted, #64748b); line-height: 1.45; background: var(--surface-2, #f1f5f9); border-radius: 10px; padding: 10px 12px; }
    .landing-empty { background: var(--card); border: 1px dashed var(--line); border-radius: 14px; padding: 56px 24px; text-align: center; }
    .landing-empty-ico { font-size: 44px; margin-bottom: 10px; }
    .landing-empty-title { font-size: 17px; font-weight: 600; color: var(--ink); margin-bottom: 6px; }
    .landing-empty-sub { font-size: 13px; color: var(--muted); max-width: 380px; margin: 0 auto; line-height: 1.55; }
    .landing-empty-sub code { background: var(--surface-2); color: var(--ink); padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    .landing-loading { color: var(--muted); font-size: 14px; padding: 40px 0; }
    .landing-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 12px 16px; border-radius: 10px; margin-bottom: 16px; font-size: 13px; }
    [data-theme="dark"] .landing-error { background: rgba(248, 113, 113, 0.12); border-color: rgba(248, 113, 113, 0.35); color: #fca5a5; }
    @media (max-width: 760px) {
      .landing-wrap { padding: 32px 16px 60px; }
      .landing-title { font-size: 24px; }
      .landing-grid { grid-template-columns: 1fr; }
      .landing-columns { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(s);
}

async function renderLandingView() {
  document.title = 'CYFR · Графики работ';
  hideAdminMenu();
  hideMobileTasksFab();
  injectLandingStyles();

  const page = clearPageBelowTopbar();
  if (!page) return;
  const wrap = document.createElement('section');
  wrap.className = 'landing-wrap';
  wrap.innerHTML = `<div class="landing-loading">Загружаю проекты…</div>`;
  page.appendChild(wrap);

  let projects = [];
  let error = null;
  try {
    const r = await fetch('/api/data?action=projects:list-all', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    projects = Array.isArray(j.projects) ? j.projects : [];
  } catch (e) {
    error = e.message || 'Не удалось загрузить список проектов';
  }

  projects.sort((a, b) => {
    if (a.createdAt && b.createdAt) return String(b.createdAt).localeCompare(String(a.createdAt));
    return String(a.slug || '').localeCompare(String(b.slug || ''));
  });

  const cardHtml = (p, isMaint) => {
    const subtitle = p.clientName ? `${p.clientName}` : `/p/${p.slug}`;
    return `<a class="landing-card${isMaint ? ' landing-card--maint' : ''}" href="/p/${escapeHtml(p.slug)}">
      <div class="landing-card-name">${isMaint ? '🔧 ' : '🏗 '}${escapeHtml(p.name || p.slug)}</div>
      <div class="landing-card-meta">${escapeHtml(subtitle)}</div>
    </a>`;
  };
  // __LANDING_SPLIT_v2__ Две раздельные области: ФитАут (графики) и Обслуживание (чек-листы).
  // В каждой — своя кнопка «добавить новый».
  const fitout = projects.filter((p) => p.kind !== 'maintenance');
  const maint = projects.filter((p) => p.kind === 'maintenance');
  const group = (title, hint, list, isMaint, addId, addLabel) => `
    <div class="landing-group ${isMaint ? 'landing-group--maint' : 'landing-group--fitout'}">
      <div class="landing-group-head">
        <div class="landing-group-titles"><h2 class="landing-group-title">${title}</h2><span class="landing-group-count">${list.length}</span></div>
        <button type="button" class="landing-add-btn" id="${addId}">＋ ${addLabel}</button>
      </div>
      <div class="landing-group-hint">${hint}</div>
      ${list.length ? `<div class="landing-grid">${list.map((p) => cardHtml(p, isMaint)).join('')}</div>`
        : `<div class="landing-group-empty">Пока пусто — нажми «＋ ${addLabel}»</div>`}
    </div>`;

  wrap.innerHTML = `
    <div class="landing-head">
      <h1 class="landing-title">Проекты CYFR</h1>
      <div class="landing-sub">Отделочные работы — графики ремонтов. Плановое обслуживание — чек-листы. В каждой области можно добавить новый проект.</div>
    </div>
    ${error ? `<div class="landing-error">⚠ ${escapeHtml(error)}</div>` : ''}
    <div class="landing-group landing-group--supply">
      <div class="landing-group-head">
        <div class="landing-group-titles"><h2 class="landing-group-title">📦 Снабжение</h2></div>
        <button type="button" class="landing-add-btn" id="btn-open-supply">Открыть план закупок</button>
      </div>
      <div class="landing-group-hint">Календарь закупок по всем объектам — какие материалы и к какой дате заказать</div>
    </div>
    <div class="landing-columns">
      ${group('🏗 ФитАут', 'Графики ремонтных проектов', fitout, false, 'btn-create-fitout', 'Новый проект')}
      ${group('🔧 Обслуживание', 'Листы планового обслуживания (PPM)', maint, true, 'btn-create-maintenance', 'Новый лист')}
    </div>
  `;
  const cm = wrap.querySelector('#btn-create-maintenance');
  if (cm) cm.addEventListener('click', openCreateMaintenanceModal);
  const cf = wrap.querySelector('#btn-create-fitout');
  if (cf) cf.addEventListener('click', openCreateFitoutModal);
  const sb = wrap.querySelector('#btn-open-supply');
  if (sb) sb.addEventListener('click', openSupplyView);
}

/* ────────────────────────────────────────────────────────────────────────────
   __SUPPLY_VIEW_v1__ Снабжение — план закупок по всем проектам.
   Данные: action procurement:forecast (бэкенд сводит работы×материалы: ручные
   Антона или авто-дефолты; «заказать до» = старт работы − срок поставки).
   Форма: колонки по неделям (число позиций к заказу), «Просрочено» — отдельный
   красный столбик; тап по столбику → список недели, сгруппированный по материалу
   (одинаковое на несколько объектов складывается). Фильтр-чипы по проектам.
   ──────────────────────────────────────────────────────────────────────────── */
function injectSupplyStyles() {
  if (document.getElementById('supply-styles')) return;
  const s = document.createElement('style');
  s.id = 'supply-styles';
  s.textContent = `
  .supply-overlay { position:fixed; inset:0; z-index:3000; background:var(--bg, #f6f7f9); overflow-y:auto; -webkit-overflow-scrolling:touch; }
  .supply-wrap { max-width:1100px; margin:0 auto; padding:18px 16px 80px; font-family:'Inter',-apple-system,sans-serif; }
  .supply-head { display:flex; align-items:center; gap:12px; margin-bottom:4px; }
  .supply-title { font-size:22px; font-weight:800; letter-spacing:-0.4px; color:var(--ink); margin:0; flex:1; }
  .supply-close { font:inherit; font-size:15px; font-weight:700; border:1px solid var(--line); background:var(--card); color:var(--ink); border-radius:10px; padding:8px 14px; cursor:pointer; }
  .supply-sub { font-size:12.5px; color:var(--muted); margin-bottom:14px; line-height:1.5; }
  .supply-chips { display:flex; flex-wrap:wrap; gap:7px; margin-bottom:14px; }
  .supply-chip { font:inherit; font-size:12.5px; font-weight:600; padding:7px 12px; border-radius:999px; border:1px solid var(--line); background:var(--card); color:var(--ink); cursor:pointer; }
  .supply-chip.is-on { background:#2a78d6; border-color:#2a78d6; color:#fff; }
  /* ── Календарь закупок: на колонке дня стоят ТОНКИЕ столбы, каждый = закупка материала.
        Высота = объём (общий масштаб → видно перспективу: когда и сколько брать).
        Тап по столбу подсвечивает этот материал во всех днях. ── */
  .supply-cal-card { background:var(--card); border:1px solid var(--line); border-radius:14px; margin:0 0 16px; padding:12px 0 6px; position:relative; }
  .supply-cal-head { display:flex; align-items:center; gap:10px; padding:0 14px 8px; }
  .supply-cal-title { font-size:13px; font-weight:700; color:var(--ink); flex:1; }
  .supply-cal-nav { font:inherit; font-size:16px; font-weight:800; width:34px; height:34px; border-radius:9px; border:1px solid var(--line); background:var(--card); color:var(--ink); cursor:pointer; }
  .supply-cal-scroll { overflow-x:auto; overflow-y:hidden; scroll-behavior:smooth; -webkit-overflow-scrolling:touch; overscroll-behavior-x:contain; padding:0 12px; }
  .supply-bchart { display:flex; align-items:flex-end; gap:18px; min-height:352px; padding-top:8px; }
  .supply-bday { display:flex; flex-direction:column; align-items:center; flex:0 0 auto; }
  .supply-bday-total { font-size:11.5px; font-weight:800; color:var(--muted); margin-bottom:4px; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .supply-bday-bars { display:flex; align-items:flex-end; gap:5px; }
  /* Крупные удобные столбы: легко навести и попасть пальцем */
  .supply-bbar { border:none; cursor:pointer; padding:0; width:26px; min-width:26px; border-radius:6px 6px 2px 2px; transition:opacity .15s ease, filter .15s ease; }
  .supply-bbar:hover { filter:brightness(1.12); }
  .supply-bchart.has-sel .supply-bbar { opacity:.2; }
  .supply-bchart.has-sel .supply-bbar.is-same { opacity:1; outline:2px solid var(--ink); outline-offset:1px; }
  /* Ретроспектива: прошлое видно, но приглушено и не кричит */
  .supply-bday--retro .supply-bbar { opacity:.3; }
  .supply-bday--retro .supply-bday-total, .supply-bday--retro .supply-bday-d, .supply-bday--retro .supply-bday-m { opacity:.5; }
  .supply-bchart.has-sel .supply-bday--retro .supply-bbar.is-same { opacity:.65; }
  .supply-bday-axis { border-top:2px solid var(--line); margin-top:6px; padding:6px 2px 8px; text-align:center; width:100%; }
  .supply-bday-d { font-size:12.5px; font-weight:800; color:var(--ink); font-variant-numeric:tabular-nums; white-space:nowrap; }
  .supply-bday-d small { font-weight:600; color:var(--muted); margin-left:3px; font-size:9.5px; }
  .supply-bday--today .supply-bday-d { color:#2a78d6; }
  .supply-bday-m { font-size:9px; font-weight:800; letter-spacing:.5px; text-transform:uppercase; color:var(--muted); min-height:12px; }
  /* Ховер-подсказка */
  .supply-tip { position:fixed; z-index:4000; background:var(--ink,#0f172a); color:#fff; font-size:12px; font-weight:600; line-height:1.45; padding:8px 11px; border-radius:9px; box-shadow:0 6px 20px rgba(0,0,0,.25); pointer-events:none; }
  .supply-legend { display:flex; gap:12px; font-size:11.5px; color:var(--muted); padding:8px 14px 6px; flex-wrap:wrap; }
  .supply-legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px; vertical-align:-1px; }
  /* 🔮 авто-прогноз системы */
  .supply-forecast { background:var(--card); border:1px solid var(--line); border-left:4px solid #2a78d6; border-radius:12px; padding:12px 14px; margin-bottom:14px; }
  .supply-forecast-t { font-size:13.5px; font-weight:800; color:var(--ink); margin-bottom:6px; }
  .supply-forecast ul { margin:0; padding-left:18px; }
  .supply-forecast li { font-size:12.5px; color:var(--ink); line-height:1.55; margin-bottom:3px; }
  .supply-forecast li b { color:#2a78d6; }
  .supply-forecast li.warn b { color:#d03b3b; }
  /* Сводка «заказать разом» */
  .supply-consol { background:#eef4fc; border:1.5px solid #2a78d6; border-radius:12px; padding:12px 14px; margin-bottom:10px; }
  .supply-consol-t { font-size:14px; font-weight:800; color:var(--ink); margin-bottom:4px; }
  .supply-consol-s { font-size:12.5px; color:var(--ink); line-height:1.5; }
  .supply-consol-s b { color:#2a78d6; }
  .supply-detail-title { font-size:14px; font-weight:800; color:var(--ink); margin:0 0 10px; }
  .supply-mat { background:var(--card); border:1px solid var(--line); border-radius:12px; margin-bottom:8px; overflow:hidden; }
  .supply-mat-head { display:flex; align-items:center; gap:10px; padding:11px 13px; cursor:pointer; }
  .supply-mat-name { flex:1; font-size:13.5px; font-weight:700; color:var(--ink); }
  .supply-mat-meta { font-size:11.5px; color:var(--muted); white-space:nowrap; }
  .supply-mat-qty { font-size:12px; font-weight:700; color:#2a78d6; white-space:nowrap; }
  .supply-mat-rows { border-top:1px solid var(--line); display:none; }
  .supply-mat.is-open .supply-mat-rows { display:block; }
  .supply-row { display:flex; align-items:center; gap:8px; padding:9px 13px; border-bottom:1px solid var(--line-2,#f1f5f9); font-size:12.5px; }
  .supply-row:last-child { border-bottom:none; }
  .supply-row-proj { font-weight:700; color:var(--ink); }
  .supply-row-task { color:var(--muted); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .supply-row-date { font-variant-numeric:tabular-nums; color:var(--ink); font-weight:600; white-space:nowrap; }
  .supply-row-date.is-late { color:#d03b3b; }
  .supply-badge { font-size:9.5px; font-weight:800; letter-spacing:.4px; padding:2px 7px; border-radius:999px; background:var(--surface-2,#eef2f6); color:var(--muted); text-transform:uppercase; }
  .supply-badge--manual { background:rgba(12,163,12,.13); color:#0a7a0a; }
  .supply-empty { color:var(--muted); font-size:13px; padding:18px 4px; }
  @media (max-width:760px){ .supply-kpis{grid-template-columns:repeat(3,1fr);} .supply-kpi-v{font-size:21px;} }
  `;
  document.head.appendChild(s);
}

let _supplyData = null;      // кэш ответа procurement:forecast на время открытого окна
let _supplySel = null;       // выбранный материал (matKey)
let _supplyProj = new Set(); // выбранные slug'и (пусто = все)
let _supplyScrolled = false; // авто-прокрутка к «сегодня» сделана (ретро остаётся слева)

function supplyFmtDM(iso) { const d = new Date(iso + 'T00:00:00Z'); return d.getUTCDate() + '.' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
const SUPPLY_MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const SUPPLY_DOW = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

async function openSupplyView() {
  injectSupplyStyles();
  document.querySelectorAll('.supply-overlay').forEach((e) => e.remove());
  const ov = document.createElement('div');
  ov.className = 'supply-overlay';
  ov.innerHTML = `<div class="supply-wrap">
    <div class="supply-head"><h1 class="supply-title">📦 План закупок</h1><button type="button" class="supply-close">✕ Закрыть</button></div>
    <div class="supply-sub">Считается из графиков всех проектов: <b>заказать до = старт работы − срок поставки</b>. Материалы — те, что руководитель поставил в работах; где не ставил — автоподбор по типу работ.</div>
    <div class="supply-body"><div class="supply-empty">Загружаю прогноз…</div></div>
  </div>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const close = () => { ov.remove(); document.body.style.overflow = ''; _supplyData = null; };
  ov.querySelector('.supply-close').addEventListener('click', close);

  try {
    const r = await postDataAction('procurement:forecast', {});
    _supplyData = r;
    _supplySel = null;
    _supplyProj = new Set();
    _supplyScrolled = false;
    renderSupplyBody(ov);
  } catch (e) {
    ov.querySelector('.supply-body').innerHTML = `<div class="supply-empty">⚠ Не удалось загрузить: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

function renderSupplyBody(ov) {
  const d = _supplyData || {};
  const body = ov.querySelector('.supply-body');
  const all = Array.isArray(d.items) ? d.items : [];
  const items = _supplyProj.size ? all.filter((x) => _supplyProj.has(x.slug)) : all;
  const today = d.today || new Date().toISOString().slice(0, 10);
  const addDays = (iso, n) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const soonEdge = addDays(today, 7);

  // ПРОГНОЗ ЗАКУПОК ПАРТИЯМИ. Система сама группирует: по каждому материалу берём
  // предстоящие работы (и уже идущие), близкие по датам потребности (окно 14 дней)
  // сливаем в ОДНУ закупку и ставим её столбик за 7 дней до старта первой работы.
  // Далёкие потребности — отдельная партия (не «всё на все проекты разом»).
  // Прошлое (работы, что уже закончились по плану) — приглушённо, в ретроспективе.
  const moneyMode = items.some((x) => Number(x.volAED) > 0);
  const volOf = (rows) => moneyMode ? rows.reduce((s, r) => s + (Number(r.volAED) || 0), 0) : rows.length;
  const fmtVol = (v) => moneyMode
    ? (v >= 1e6 ? (Math.round(v / 1e5) / 10) + ' млн' : Math.max(1, Math.round(v / 1000)) + ' тыс')
    : v + ' поз.';

  const GROUP_WINDOW = 14; // дней: потребности ближе этого окна сливаются в одну партию
  const ORDER_AHEAD = 7;   // заказ за неделю до старта первой работы партии

  // Классификация позиции: retro (работа уже прошла по плану) | эффективная дата потребности.
  const classify = (x) => {
    const end = x.needEnd || x.needBy;
    if (end < today) return { kind: 'retro' };
    // Работа уже идёт (или должна была начаться, но продолжается) → материал нужен сейчас.
    const eff = x.needBy < today ? today : x.needBy;
    return { kind: 'future', eff };
  };

  // Партии по материалам.
  const byMat = {}; // matKey -> { name, batches:[{orderDate,firstNeed,lastNeed,rows[]}], retroRows[] }
  for (const x of items) {
    const k = x.material.toLowerCase();
    const m = (byMat[k] = byMat[k] || { name: x.material, list: [], retroRows: [] });
    const c = classify(x);
    if (c.kind === 'retro') m.retroRows.push(x);
    else m.list.push({ ...x, _eff: c.eff });
  }
  for (const k of Object.keys(byMat)) {
    const m = byMat[k];
    m.list.sort((a, b) => a._eff.localeCompare(b._eff));
    m.batches = [];
    for (const x of m.list) {
      const b = m.batches[m.batches.length - 1];
      if (b && x._eff <= addDays(b.firstNeed, GROUP_WINDOW)) {
        b.rows.push(x);
        if (x._eff > b.lastNeed) b.lastNeed = x._eff;
      } else {
        m.batches.push({ firstNeed: x._eff, lastNeed: x._eff, rows: [x] });
      }
    }
    for (const b of m.batches) {
      const raw = addDays(b.firstNeed, -ORDER_AHEAD);
      b.orderDate = raw < today ? today : raw;
      b.v = volOf(b.rows);
      b.projCount = new Set(b.rows.map((r) => r.slug)).size;
    }
    m.totalV = m.batches.reduce((s, b) => s + b.v, 0);
    m.batchCount = m.batches.length;
  }

  // Колонки: даты закупок (партии) + приглушённая ретроспектива по её датам заказа.
  const futureCols = {}; // date -> [{matKey, batch}]
  const retroCols = {};  // date -> { matKey -> rows[] }
  for (const k of Object.keys(byMat)) {
    const m = byMat[k];
    for (const b of m.batches) (futureCols[b.orderDate] = futureCols[b.orderDate] || []).push({ matKey: k, name: m.name, batch: b });
    for (const r of m.retroRows) {
      const dcol = (retroCols[r.orderBy] = retroCols[r.orderBy] || {});
      (dcol[k] = dcol[k] || { name: m.name, rows: [] }).rows.push(r);
    }
  }
  const retroDays = Object.keys(retroCols).sort();
  const futureDays = Object.keys(futureCols).sort();
  // Общий масштаб высот по будущим партиям (ретро не должно задирать шкалу).
  let maxV = 1;
  for (const dk of futureDays) for (const e of futureCols[dk]) maxV = Math.max(maxV, e.batch.v);
  const H = 250;

  const projChips = (d.projects || []).map((p) =>
    `<button type="button" class="supply-chip ${_supplyProj.has(p.slug) ? 'is-on' : ''}" data-proj="${escapeHtml(p.slug)}">${escapeHtml(p.name)}</button>`).join('');

  // 🔮 Прогноз системы (только будущее, без просрочки).
  const twoWeeks = addDays(today, 14);
  const soonBatches = [];
  for (const dk of futureDays) if (dk <= twoWeeks) for (const e of futureCols[dk]) soonBatches.push(e);
  const soonV = soonBatches.reduce((s, e) => s + e.batch.v, 0);
  let peakDay = null, peakV = 0;
  for (const dk of futureDays) { const v = futureCols[dk].reduce((s, e) => s + e.batch.v, 0); if (v > peakV) { peakV = v; peakDay = dk; } }
  const nextDay = futureDays[0] || null;
  const nextList = nextDay ? futureCols[nextDay].sort((a, b) => b.batch.v - a.batch.v).slice(0, 4) : [];
  const forecastHtml = `<div class="supply-forecast">
    <div class="supply-forecast-t">🔮 Прогноз закупок</div>
    <ul>
      ${nextDay ? `<li>📦 Ближайшая закупка — <b>${supplyFmtDM(nextDay)}</b>: ${nextList.map((e) => `<b>${escapeHtml(e.name)}</b> (${fmtVol(e.batch.v)}${e.batch.projCount > 1 ? `, ${e.batch.projCount} об.` : ''})`).join('; ')}${futureCols[nextDay].length > 4 ? ` и ещё ${futureCols[nextDay].length - 4}` : ''}.</li>` : ''}
      <li>📅 Ближайшие 2 недели: <b>${fmtVol(soonV)}</b> (${soonBatches.length} закупок).</li>
      ${peakDay && peakDay !== nextDay ? `<li>📈 Самый крупный закупочный день: <b>${supplyFmtDM(peakDay)}</b> — ${fmtVol(peakV)}.</li>` : ''}
      <li>💡 Система уже сгруппировала партии: близкие по датам потребности разных объектов слиты в одну закупку, столбик стоит за ${ORDER_AHEAD} дней до старта первой работы.</li>
    </ul>
  </div>`;

  // Колонки будущих закупок + ретроспектива (приглушённо).
  const colHtml = (dk, entries, isRetro) => {
    const list = entries.sort((a, b) => b.v - a.v);
    const total = list.reduce((s, e) => s + e.v, 0);
    const bars = list.map((e) => {
      const [color] = supplyMatColor(e.name);
      const h = Math.max(12, Math.round(e.v / maxV * H));
      const tip = isRetro
        ? `${e.name} · ${fmtVol(e.v)} · было в плане (ретроспектива)`
        : `${e.name} · ${fmtVol(e.v)}${e.projCount > 1 ? ` · ${e.projCount} объекта` : ''} · заказ к ${supplyFmtDM(dk)} (работы с ${supplyFmtDM(e.firstNeed)}${e.lastNeed !== e.firstNeed ? ` по ${supplyFmtDM(e.lastNeed)}` : ''})`;
      return `<button type="button" class="supply-bbar ${isRetro ? 'supply-bbar--retro' : ''} ${_supplySel === e.matKey ? 'is-same' : ''}"
        data-mkey="${escapeHtml(e.matKey)}" data-tip="${escapeHtml(tip)}"
        style="height:${h}px;background:${color}"></button>`;
    }).join('');
    const dt = new Date(dk + 'T00:00:00Z');
    const dow = (dt.getUTCDay() + 6) % 7;
    return `<div class="supply-bday ${isRetro ? 'supply-bday--retro' : ''} ${dk === today ? 'supply-bday--today' : ''}">
      <div class="supply-bday-total">${fmtVol(total)}</div>
      <div class="supply-bday-bars">${bars}</div>
      <div class="supply-bday-axis"><div class="supply-bday-d">${dk === today ? 'сегодня' : dt.getUTCDate()}<small>${SUPPLY_DOW[dow]}</small></div><div class="supply-bday-m">${SUPPLY_MONTHS[dt.getUTCMonth()]}</div></div>
    </div>`;
  };
  const colsHtml =
    retroDays.map((dk) => colHtml(dk, Object.values(retroCols[dk]).map((g) => ({ matKey: g.name.toLowerCase(), name: g.name, v: volOf(g.rows), rows: g.rows })), true)).join('') +
    futureDays.map((dk) => colHtml(dk, futureCols[dk].map((e) => ({ matKey: e.matKey, name: e.name, v: e.batch.v, projCount: e.batch.projCount, firstNeed: e.batch.firstNeed, lastNeed: e.batch.lastNeed })), false)).join('');

  // Легенда типов.
  const legendCats = [];
  const seenCat = new Set();
  for (const k of Object.keys(byMat)) {
    const [color, cat] = supplyMatColor(byMat[k].name);
    if (!seenCat.has(cat)) { seenCat.add(cat); legendCats.push({ color, cat }); }
  }

  // Детализация выбранного материала: его партии (что в какую закупку вошло).
  let detailHtml = '';
  if (_supplySel && byMat[_supplySel]) {
    const m = byMat[_supplySel];
    const consol = m.batchCount > 0
      ? `<div class="supply-consol"><div class="supply-consol-t">💡 ${escapeHtml(m.name)} — ${m.batchCount === 1 ? 'одна закупка' : m.batchCount + ' закупки'}, всего ${fmtVol(m.totalV)}</div>
         <div class="supply-consol-s">${m.batches.map((b) => `<b>${supplyFmtDM(b.orderDate)}</b> — ${fmtVol(b.v)} (работы с ${supplyFmtDM(b.firstNeed)}${b.lastNeed !== b.firstNeed ? ` по ${supplyFmtDM(b.lastNeed)}` : ''}${b.projCount > 1 ? `, ${b.projCount} об.` : ''})`).join(' · ')}. Близкие даты уже слиты в одну партию.</div></div>`
      : '';
    const secHtml = m.batches.map((b) => {
      const rows = b.rows.sort((a, b2) => a._eff.localeCompare(b2._eff)).map((r) => `
        <div class="supply-row">
          <span class="supply-row-proj">${escapeHtml(r.project)}</span>
          <span class="supply-row-task">${escapeHtml(r.taskName)}</span>
          ${r.qty != null ? `<span class="supply-mat-qty">${r.qty} ${escapeHtml(r.unit || '')}</span>` : ''}
          <span class="supply-row-date">работа ${r.started ? 'уже идёт' : 'с ' + supplyFmtDM(r.needBy)}</span>
          <span class="supply-badge ${r.source === 'manual' ? 'supply-badge--manual' : ''}">${r.source === 'manual' ? 'ручное' : 'авто'}</span>
        </div>`).join('');
      return `<div class="supply-mat is-open">
        <div class="supply-mat-head" style="cursor:default"><span class="supply-mat-name">📦 Закупка ${supplyFmtDM(b.orderDate)}</span>
        <span class="supply-mat-meta">${fmtVol(b.v)}</span></div>
        <div class="supply-mat-rows">${rows}</div></div>`;
    }).join('');
    detailHtml = `<h3 class="supply-detail-title">${escapeHtml(m.name)}</h3>${consol}${secHtml}`;
  }

  body.innerHTML = `
    <div class="supply-chips">
      <button type="button" class="supply-chip ${_supplyProj.size ? '' : 'is-on'}" data-proj="__all__">Все проекты</button>
      ${projChips}
    </div>
    ${forecastHtml}
    <div class="supply-cal-card">
      <div class="supply-cal-head">
        <div class="supply-cal-title">Каждый столб = закупка материала (партия). Наведи — подробности, тапни — раскладка</div>
        <button type="button" class="supply-cal-nav" data-nav="-1">‹</button>
        <button type="button" class="supply-cal-nav" data-nav="1">›</button>
      </div>
      <div class="supply-cal-scroll" id="supply-cal-scroll">
        <div class="supply-bchart ${_supplySel ? 'has-sel' : ''}">${colsHtml}</div>
      </div>
      <div class="supply-legend">
        ${legendCats.map((c) => `<span><i style="background:${c.color}"></i>${escapeHtml(c.cat)}</span>`).join('')}
        <span style="opacity:.7">блеклые слева = прошлое (ретроспектива)</span>
      </div>
    </div>
    <div class="supply-tip" id="supply-tip" hidden></div>
    ${detailHtml || '<div class="supply-empty">Наведи на столб — подсказка. Тапни — подсвечу материал во всех закупках и покажу раскладку партий.</div>'}
  `;

  const sc = body.querySelector('#supply-cal-scroll');
  // Первый показ: пролистываем ретроспективу, начинаем с сегодняшних/будущих закупок.
  if (!_supplyScrolled && retroDays.length) {
    _supplyScrolled = true;
    requestAnimationFrame(() => {
      const firstFuture = body.querySelector('.supply-bday:not(.supply-bday--retro)');
      if (firstFuture && sc) { sc.style.scrollBehavior = 'auto'; sc.scrollLeft = Math.max(0, firstFuture.offsetLeft - 12); sc.style.scrollBehavior = ''; }
    });
  }
  const keepScroll = (fn) => {
    const keep = sc ? sc.scrollLeft : 0;
    fn();
    requestAnimationFrame(() => {
      const sc2 = body.querySelector('#supply-cal-scroll');
      if (!sc2) return;
      const prev = sc2.style.scrollBehavior;
      sc2.style.scrollBehavior = 'auto';
      sc2.scrollLeft = keep;
      sc2.style.scrollBehavior = prev;
    });
  };
  // Ховер-подсказка (без кликов). На тач-устройствах остаётся тап.
  const tip = body.querySelector('#supply-tip');
  const showTip = (el) => {
    if (!tip) return;
    tip.textContent = el.getAttribute('data-tip') || '';
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 24);
    tip.style.maxWidth = w + 'px';
    const tr = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2;
    x = Math.max(12, Math.min(x, window.innerWidth - tr.width - 12));
    let y = r.top - tr.height - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  body.querySelectorAll('[data-mkey]').forEach((el) => {
    el.addEventListener('mouseenter', () => showTip(el));
    el.addEventListener('mouseleave', () => { if (tip) tip.hidden = true; });
    el.addEventListener('click', () => {
      if (tip) tip.hidden = true;
      const key = el.getAttribute('data-mkey');
      keepScroll(() => { _supplySel = (_supplySel === key) ? null : key; renderSupplyBody(ov); });
    });
  });
  body.querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', () => {
    if (sc) sc.scrollBy({ left: Number(el.getAttribute('data-nav')) * 300, behavior: 'smooth' });
  }));
  body.querySelectorAll('[data-proj]').forEach((el) => el.addEventListener('click', () => {
    const p = el.getAttribute('data-proj');
    if (p === '__all__') _supplyProj.clear();
    else { if (_supplyProj.has(p)) _supplyProj.delete(p); else _supplyProj.add(p); }
    _supplySel = null;
    renderSupplyBody(ov);
  }));
}

// Цвет по ТИПУ материала (валидированная категориальная палитра, фикс. порядок).
// [цвет, название категории, тёмный текст на светлом цвете?]
function supplyMatColor(name) {
  const n = String(name || '').toLowerCase();
  if (/(гкл|профил|утепл|минват|перегород|люк|каркас)/.test(n)) return ['#2a78d6', 'ГКЛ и каркас', false];
  if (/(шпатл|штукатур|грунт|краск|лент|сетк|малярн)/.test(n)) return ['#4a3aa7', 'Отделка и покраска', false];
  if (/(пол|плинтус|нивелир|ковролин|плитк|керамогран|стяжк|покрыти)/.test(n)) return ['#eb6834', 'Полы и плитка', false];
  if (/(сантех|труб|фитинг|смесител|гидроизол|унитаз|раковин)/.test(n)) return ['#1baf7a', 'Сантехника', true];
  if (/(кабел|розетк|выключател|светильник|электрощ|электр)/.test(n)) return ['#eda100', 'Электрика', true];
  if (/(двер|мебел|аксессуар|стекл|интерьер)/.test(n)) return ['#e87ba4', 'Двери, мебель, стекло', true];
  if (/(воздухов|кондицион|вентил|решётк|овик)/.test(n)) return ['#008300', 'ОВиК', false];
  return ['#898781', 'Прочее', false];
}

// __FITOUT_CREATE_v2__ Создание ФитАут-проекта: пустой (вручную) ИЛИ из файла сметы
// (Excel/PDF/Word/фото → ИИ читает работы и строит график, порт логики бота).
function openCreateFitoutModal() {
  injectMaintenanceStyles(); // переиспользуем стили окна (.m-create-*, .mc-tabs, .mc-photo, .fc-note)
  document.querySelectorAll('.m-create-overlay').forEach((e) => e.remove()); // не плодим окна
  const ov = document.createElement('div');
  ov.className = 'm-create-overlay';
  ov.innerHTML = `
    <div class="m-create-card">
      <div class="m-create-title">Новый проект ФитАут</div>
      <div class="mc-tabs">
        <button type="button" class="mc-tab is-on" data-tab="blank">✍️ Пустой</button>
        <button type="button" class="mc-tab" data-tab="file">📄 Из файла сметы</button>
      </div>
      <div id="fc-blank">
        <label class="m-field"><span>Название проекта</span><input type="text" id="fc-name" placeholder="напр. Office C1801, Ontario Tower"></label>
        <div class="fc-note">Пустой проект — работы добавишь вручную в графике (＋ задача / раздел).</div>
      </div>
      <div id="fc-file" hidden>
        <div class="mc-photo-hint">Загрузи файл сметы — Excel, PDF, Word или фото. ИИ прочитает список работ, разнесёт по этапам и построит график со сроками. Потом всё можно поправить.</div>
        <label class="mc-file"><span id="fc-fname">📄 Выбрать файл сметы</span><input type="file" id="fc-f" accept=".xlsx,.xls,.pdf,.doc,.docx,.csv,.txt,image/*"></label>
      </div>
      <div class="m-create-actions">
        <button type="button" class="m-create-cancel" id="fc-cancel">Отмена</button>
        <button type="button" class="m-create-go" id="fc-go">Создать пустой проект</button>
      </div>
      <div class="m-create-err" id="fc-err"></div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  const $ = (s) => ov.querySelector(s);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  $('#fc-cancel').addEventListener('click', close);
  let mode = 'blank';
  ov.querySelectorAll('.mc-tab').forEach((t) => t.addEventListener('click', () => {
    mode = t.getAttribute('data-tab');
    ov.querySelectorAll('.mc-tab').forEach((x) => x.classList.toggle('is-on', x === t));
    $('#fc-blank').hidden = mode !== 'blank';
    $('#fc-file').hidden = mode !== 'file';
    $('#fc-go').textContent = mode === 'file' ? 'Построить график из сметы' : 'Создать пустой проект';
  }));
  $('#fc-f').addEventListener('change', () => { const f = $('#fc-f').files[0]; if (f) $('#fc-fname').textContent = '✓ ' + f.name.slice(0, 36); });

  $('#fc-go').addEventListener('click', async () => {
    const err = $('#fc-err'); err.textContent = '';
    const btn = $('#fc-go'); const orig = btn.textContent;
    if (mode === 'blank') {
      const name = $('#fc-name').value.trim();
      if (!name) { err.textContent = 'Впиши название проекта.'; return; }
      btn.disabled = true; btn.textContent = 'Создаю…';
      try {
        const r = await postDataAction('project:create-blank', { name });
        if (r && r.slug) window.location.href = '/p/' + r.slug; else throw new Error('сервер не вернул slug');
      } catch (e) { err.textContent = 'Ошибка: ' + (e.message || e); btn.disabled = false; btn.textContent = orig; }
    } else {
      const file = $('#fc-f').files[0];
      if (!file) { err.textContent = 'Выбери файл сметы.'; return; }
      btn.disabled = true; btn.textContent = 'Читаю файл…';
      try {
        const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error('не удалось прочитать файл')); fr.readAsDataURL(file); });
        btn.textContent = '🤖 ИИ читает смету и строит график со связями… (до минуты)';
        const r = await postDataAction('fitout:from-estimate', { fileBase64: dataUrl, fileName: file.name, fileType: file.type }, 180000);
        if (r && r.slug) window.location.href = '/p/' + r.slug; else throw new Error('сервер не вернул slug');
      } catch (e) { err.textContent = 'Ошибка: ' + (e.message || e); btn.disabled = false; btn.textContent = orig; }
    }
  });
}

function showProjectNotFound(slug) {
  const safe = String(slug).replace(/[<>&]/g, '');
  hideAdminMenu();
  hideMobileTasksFab();
  injectLandingStyles();
  const page = clearPageBelowTopbar();
  if (page) {
    const wrap = document.createElement('section');
    wrap.className = 'landing-wrap';
    wrap.innerHTML = `
      <div class="landing-empty">
        <div class="landing-empty-ico">🗂️</div>
        <div class="landing-empty-title">Проект не найден</div>
        <div class="landing-empty-sub">Слаг <code>${safe}</code> не существует или удалён. Возвращаю на главную…</div>
      </div>`;
    page.appendChild(wrap);
  }
  setTimeout(() => { window.location.replace('/'); }, 1500);
}

async function init() {
  // Root path → landing (список проектов или empty state)
  if (isRootPath()) {
    return renderLandingView();
  }
  const slug = getProjectSlug();
  if (!slug) { return renderLandingView(); }
  state.projectSlug = slug;
  const res = await fetch(scheduleJsonUrl(slug), { cache: 'no-store' });
  if (!res.ok) { showProjectNotFound(slug); return; }
  const j = await res.json();
  // Поддержка двух форматов: либо чистый schedule (старый GitHub raw), либо обёртка { ok, slug, schedule }
  const s = j && j.schedule && j.ok ? j.schedule : j;
  state.schedule = s;
  // __MAINTENANCE_v1__ Лист планового обслуживания — отдельный экран вместо графика.
  if (s.project && s.project.kind === 'maintenance') {
    renderMaintenanceView(s);
    return;
  }
  document.body.classList.remove('booting'); // это график — показываем статичный Gantt-каркас (он заполнится ниже)
  s.stages.forEach((st) => (state.stageById[st.id] = st));
  s.sections.forEach((se) => (state.sectionById[se.id] = se));
  UAE_HOLIDAYS.forEach((h) => state.holidayMap.set(h.date, h.name)); // госпраздники ОАЭ — всегда
  (s.holidays || []).forEach((h) => state.holidayMap.set(h.date, h.name)); // + специфичные для проекта

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
  bindKpPopover();
  bindTaskTooltip();
  bindTopFab();
  bindEditMode();
  bindBarDrag();
  bindBarStepCtrl();
  bindModalScrollLock();
  fetchTickets();
  loadAssignees();
  loadProjectData(state.projectSlug)
    .then(() => migrateLocalToAirtable(state.projectSlug))
    .then(() => {
      // После загрузки shared-данных и зависимостей пересчитать CPM
      // (изначально CPM считался по stage-chain без deps → давал ложные критические).
      try { renderProjectAnalytics(); } catch (_) {}
      try { renderGantt(); } catch (_) {}
      // Мобильный «Список работ» тоже перерисовываем — иначе он держит дефолтные
      // материалы/ресурсы, отрендеренные ДО прихода shared-данных. __SHEET_REHYDRATE_v1__
      try { renderTasksSheet(); } catch (_) {}
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

// Effective sub-flag: t.sub явный (true/false) перебивает sec.sub.
// Если t.sub не выставлен — наследуем от раздела. Это позволяет иметь
// CYFR-работу внутри суб-раздела и наоборот, суб-работу внутри своего раздела.
const effectiveSub = (t, sec) => (typeof t?.sub === 'boolean' ? t.sub : !!sec?.sub);

/* ─── PlanRadar tickets ─── */
async function fetchTickets() {
  try {
    // Передаём slug чтобы backend отфильтровал тикеты только этого проекта.
    // Один PlanRadar project обслуживает несколько schedule-проектов; без slug-фильтра
    // тикеты от orange-group-fit-out появлялись в новых проектах (McDonald's и др.).
    const slug = state.projectSlug || '';
    const url = slug ? `/api/planradar?slug=${encodeURIComponent(slug)}` : '/api/planradar';
    const r = await fetch(url);
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
        taskMaterials: json.data.taskMaterials || {},
        taskDependencies: Array.isArray(json.data.taskDependencies) ? json.data.taskDependencies : [],
        progressLog: Array.isArray(json.data.progressLog) ? json.data.progressLog : []
      };
      rebuildDepsGraph();
    }
    state.dataLoaded = true;
  } catch (e) {
    console.warn('loadProjectData failed', e);
    state.dataLoaded = false;
  }
}

/* ─── Resource & Materials catalog (defaults by section) ─── */
const RESOURCE_TYPES = [
  // Общестрой / разнорабочие
  { id: 'workers',          label: 'Рабочие (разнорабочие)' },
  { id: 'demolition',       label: 'Демонтажники' },
  { id: 'masons',           label: 'Каменщики / бетонщики' },
  // MEP
  { id: 'plumbers',         label: 'Сантехники' },
  { id: 'electricians',     label: 'Электрики' },
  { id: 'low_voltage',      label: 'Слаботочники / СКС' },
  { id: 'hvac_installers',  label: 'ОВиК-монтажники' },
  { id: 'fire_techs',       label: 'Пожарные техники / ОПС' },
  // Стены / потолки / пол
  { id: 'gypsum_workers',   label: 'Монтажники ГКЛ' },
  { id: 'plasterers',       label: 'Штукатуры' },
  { id: 'painters',         label: 'Маляры' },
  { id: 'tilers',           label: 'Плиточники' },
  { id: 'marble_workers',   label: 'Мрамор / гранит' },
  { id: 'floor_layers',     label: 'Полы (наливные, стяжка)' },
  { id: 'parquet_layers',   label: 'Паркетчики / ламинат' },
  { id: 'roofers',          label: 'Кровельщики' },
  { id: 'insulators',       label: 'Изолировщики / утепление' },
  // Двери / окна / стекло / фасад
  { id: 'carpenters',       label: 'Плотники / столяры' },
  { id: 'door_installers',  label: 'Монтажники дверей' },
  { id: 'window_installers',label: 'Монтажники окон' },
  { id: 'glass_installers', label: 'Стекольщики / алюминий' },
  { id: 'facade',           label: 'Фасадчики' },
  { id: 'welders',          label: 'Сварщики / металлоконструкции' },
  // Мебель / уборка
  { id: 'movers',           label: 'Сборщики мебели' },
  { id: 'kitchen_fitters',  label: 'Монтажники кухонь' },
  { id: 'cleaners',         label: 'Уборщики (клининг)' },
  // ИТР / документы / снабжение
  { id: 'foremen',          label: 'Прорабы / мастера' },
  { id: 'engineers',        label: 'Инженеры ПТО / стройконтроль' },
  { id: 'estimators',       label: 'Сметчики / эстиматоры' },
  { id: 'bim',              label: 'BIM / технологи' },
  { id: 'surveyors',        label: 'Геодезисты' },
  { id: 'permits',          label: 'Координаторы разрешений' },
  { id: 'paperwork',        label: 'Документы / бумажная работа' },
  { id: 'supply',           label: 'Снабженцы' },
  { id: 'logistics',        label: 'Логисты / диспетчеры' },
  { id: 'hse',              label: 'HSE / охрана труда' },
  // Тяжёлая техника
  { id: 'crane_operators',  label: 'Крановщики / погрузчики' },
  // Прочее
  { id: 'subcontractors',   label: 'Субподрядчики' },
  { id: 'other',            label: 'Другое (в комментарии)' }
];
const RESOURCE_LABEL_BY_ID = Object.fromEntries(RESOURCE_TYPES.map(r => [r.id, r.label]));

const DEFAULT_RESOURCES_BY_SECTION = {
  preparation: [{ type: 'permits', count: 1 }, { type: 'paperwork', count: 1 }],
  documents:  [{ type: 'paperwork', count: 1 }, { type: 'engineers', count: 1 }],
  permits:    [{ type: 'permits', count: 1 }],
  demolition: [{ type: 'demolition', count: 3 }, { type: 'workers', count: 1 }],
  sanitary:   [{ type: 'plumbers', count: 2 }],
  plumbing:   [{ type: 'plumbers', count: 2 }],
  electric:   [{ type: 'electricians', count: 2 }],
  electrical: [{ type: 'electricians', count: 2 }],
  weak_current:[{ type: 'low_voltage', count: 2 }],
  hvac:       [{ type: 'hvac_installers', count: 3 }],
  fire:       [{ type: 'fire_techs', count: 2 }],
  fire_safety:[{ type: 'fire_techs', count: 1 }, { type: 'engineers', count: 1 }],
  gypsum:     [{ type: 'gypsum_workers', count: 3 }],
  drywall:    [{ type: 'gypsum_workers', count: 2 }],
  walls:      [{ type: 'gypsum_workers', count: 2 }, { type: 'plasterers', count: 1 }],
  ceilings:   [{ type: 'gypsum_workers', count: 2 }],
  painting:   [{ type: 'painters', count: 3 }],
  paint:      [{ type: 'painters', count: 2 }],
  finishing:  [{ type: 'painters', count: 2 }, { type: 'plasterers', count: 1 }],
  plaster:    [{ type: 'plasterers', count: 2 }],
  ceramic:    [{ type: 'tilers', count: 3 }],
  bathrooms:  [{ type: 'tilers', count: 2 }, { type: 'plumbers', count: 1 }],
  flooring:   [{ type: 'tilers', count: 2 }, { type: 'workers', count: 1 }],
  floors:     [{ type: 'floor_layers', count: 2 }],
  screed:     [{ type: 'floor_layers', count: 2 }],
  carpentry:  [{ type: 'carpenters', count: 2 }],
  doors:      [{ type: 'door_installers', count: 2 }],
  windows:    [{ type: 'window_installers', count: 2 }],
  glass:      [{ type: 'glass_installers', count: 2 }],
  facade:     [{ type: 'facade', count: 2 }],
  furniture:  [{ type: 'movers', count: 3 }],
  kitchen:    [{ type: 'kitchen_fitters', count: 2 }],
  cleanup:    [{ type: 'cleaners', count: 3 }],
  cleaning:   [{ type: 'cleaners', count: 2 }],
  acceptance: [{ type: 'engineers', count: 1 }, { type: 'foremen', count: 1 }],
  materials:  [{ type: 'supply', count: 1 }, { type: 'logistics', count: 1 }],
  hse:        [{ type: 'hse', count: 1 }],
  management: [{ type: 'foremen', count: 1 }, { type: 'engineers', count: 1 }],
  default:    [{ type: 'workers', count: 2 }]
};

// Хеуристика по названию работы (англ./рус. ключевые слова → специальность).
function defaultResourcesByTaskName(taskName) {
  const s = String(taskName || '').toLowerCase();
  if (!s) return null;
  const rules = [
    [/сантехник|трубы|водопровод|канализаци/, [{ type: 'plumbers', count: 2 }]],
    [/электр|кабел|розетк|выключател|освещен/, [{ type: 'electricians', count: 2 }]],
    [/слаботочк|скс|видеонаблюден/, [{ type: 'low_voltage', count: 2 }]],
    [/пожарн|сигнализаци|опс/, [{ type: 'fire_techs', count: 1 }, { type: 'engineers', count: 1 }]],
    [/вентиляц|кондиционер|овик|чиллер|фанкоил/, [{ type: 'hvac_installers', count: 2 }]],
    [/демонт|разбор/, [{ type: 'demolition', count: 3 }]],
    [/плитк|керамогранит/, [{ type: 'tilers', count: 2 }]],
    [/мрамор|гранит/, [{ type: 'marble_workers', count: 2 }]],
    [/паркет|ламинат/, [{ type: 'parquet_layers', count: 2 }]],
    [/наливн.*пол|стяжк/, [{ type: 'floor_layers', count: 2 }]],
    [/гипсокартон|гкл|перегородк/, [{ type: 'gypsum_workers', count: 2 }]],
    [/штукатурк|шпатлёвк|шпатлевк/, [{ type: 'plasterers', count: 2 }]],
    [/маляр|покрас|окраск/, [{ type: 'painters', count: 2 }]],
    [/потолк/, [{ type: 'gypsum_workers', count: 2 }]],
    [/двер.*установ|монтаж двер/, [{ type: 'door_installers', count: 2 }]],
    [/окон.*установ|монтаж окон/, [{ type: 'window_installers', count: 2 }]],
    [/стекл|витра|алюмини/, [{ type: 'glass_installers', count: 2 }]],
    [/мебел|сборк|шкаф/, [{ type: 'movers', count: 2 }]],
    [/кухн/, [{ type: 'kitchen_fitters', count: 2 }]],
    [/убор|клининг/, [{ type: 'cleaners', count: 2 }]],
    [/разрешен|согласован/, [{ type: 'permits', count: 1 }]],
    [/документ|бумаж/, [{ type: 'paperwork', count: 1 }]],
    [/смет/, [{ type: 'estimators', count: 1 }]],
    [/закупк|поставк|снабжен/, [{ type: 'supply', count: 1 }]],
    [/приём|приемка|сдач/, [{ type: 'engineers', count: 1 }]],
    [/сварк/, [{ type: 'welders', count: 1 }]],
    [/каркас|стропил|кровл/, [{ type: 'roofers', count: 2 }]],
    [/изоляц|утеплен/, [{ type: 'insulators', count: 1 }]],
    [/фасад/, [{ type: 'facade', count: 2 }]],
  ];
  for (const [re, res] of rules) {
    if (re.test(s)) return res;
  }
  return null;
}

const DEFAULT_MATERIALS_BY_SECTION = {
  // Новые ID секций (orange-1801 после пересборки по контракту)
  preparation: [{ name: 'ПВХ-материал для защиты поверхностей', leadTime: 5 }],
  demolition:  [{ name: 'Контейнер для мусора', leadTime: 3 }],
  walls:       [
    { name: 'CD/UD профиль', leadTime: 7 }, { name: 'Лист ГКЛ', leadTime: 7 }, { name: 'Утеплитель', leadTime: 7 },
    { name: 'Шпатлёвка/грунт', leadTime: 5 }, { name: 'Краска водная', leadTime: 7 }
  ],
  ceilings:    [
    { name: 'CD/UD профиль', leadTime: 7 }, { name: 'Лист ГКЛ', leadTime: 7 },
    { name: 'Минвата 50мм (шумоизоляция)', leadTime: 7 }, { name: 'Ревизионные люки', leadTime: 14 },
    { name: 'Краска водная', leadTime: 7 }
  ],
  floors:      [
    { name: 'Самонивелирующаяся смесь', leadTime: 7 }, { name: 'Ковролин', leadTime: 14 },
    { name: 'Плинтус МДФ', leadTime: 14 }
  ],
  bathrooms:   [
    { name: 'Керамогранит', leadTime: 21 }, { name: 'Клей/затирка', leadTime: 7 },
    { name: 'Гидроизоляция (мембрана + лента)', leadTime: 7 },
    { name: 'Сантехника (унитазы, раковины, душ)', leadTime: 14 },
    { name: 'Смесители и аксессуары', leadTime: 14 }
  ],
  electrical:  [
    { name: 'Кабель силовой', leadTime: 7 }, { name: 'Розетки/выключатели', leadTime: 10 },
    { name: 'Светильники', leadTime: 21 }, { name: 'Распределительный щит', leadTime: 14 }
  ],
  fire_safety: [{ name: 'Чертежи / согласование', leadTime: 14 }],
  hvac:        [],  // только сопровождение подрядчика, материалы не наши
  logistics:   [],  // транспорт — нет материалов
  cleaning:    [],  // вывоз мусора — нет материалов
};

function defaultResourcesForTask(task) {
  if (!task) return [];
  // 1. По названию работы — точнее, чем секция
  const byName = defaultResourcesByTaskName(task.name);
  if (byName) return JSON.parse(JSON.stringify(byName));
  // 2. По типу секции
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
  // Array (even empty) = user-managed; defaults only when never touched (undefined)
  if (Array.isArray(stored)) return stored;
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(taskId));
  return defaultResourcesForTask(t);
}

// STRICT: only user-entered resources. Used by heatmap so оно не врёт фейковыми дефолтами.
// Если в Airtable записи нет — возвращает null (отличается от []), чтобы heatmap мог посчитать
// "заполнено N из M работ" и предупредить юзера.
function getTaskResourcesStrict(taskId) {
  const stored = state.dataCache.taskResources[String(taskId)];
  return Array.isArray(stored) ? stored : null;
}
function setTaskResources(taskId, resources) {
  const list = (resources || []).filter(r => r && r.type && Number(r.count) > 0)
    .map(r => ({ type: String(r.type), count: Math.max(1, Math.min(99, Number(r.count) || 1)) }));
  state.dataCache.taskResources[String(taskId)] = list;
  postDataAction('task-resources:upsert', { taskId: String(taskId), slug: state.projectSlug, resources: list })
    .catch(e => console.warn('task-resources:upsert failed', e));
  // Live re-render heatmap + analytics if shown
  if (state.showHeatmap && typeof renderResourceHeatmap === 'function') renderResourceHeatmap();
  if (typeof renderProjectAnalytics === 'function') renderProjectAnalytics();
}

function getTaskMaterials(taskId) {
  const stored = state.dataCache.taskMaterials[String(taskId)];
  // Array (even empty) = user-managed; defaults only when never touched (undefined)
  if (Array.isArray(stored)) return stored;
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(taskId));
  return defaultMaterialsForTask(t);
}
function setTaskMaterials(taskId, materials) {
  // В кэше держим все строки (включая черновик с пустым именем — пользователь его дозаполнит).
  // На сервер отправляем только заполненные.
  const all = (materials || []).map(m => ({
    name: String(m?.name || '').trim(),
    leadTime: Math.max(0, Math.min(120, Number(m?.leadTime) || 0)),
    ordered: !!m?.ordered,
    expectedDate: m?.expectedDate || '',
    note: (m?.note || '').slice(0, 200),
    quantity: m?.quantity != null ? (Number(m.quantity) || 0) : null,
    unit: m?.unit ? String(m.unit).trim().slice(0, 16) : ''
  }));
  state.dataCache.taskMaterials[String(taskId)] = all;
  const filled = all.filter(m => m.name);
  postDataAction('task-materials:upsert', { taskId: String(taskId), slug: state.projectSlug, materials: filled })
    .catch(e => console.warn('task-materials:upsert failed', e));
  // Live update: analytics card + alert banner + bar outline
  if (typeof renderProjectAnalytics === 'function') renderProjectAnalytics();
}

// Допустимые единицы измерения материалов
const MATERIAL_UNITS = [
  { id: '',     label: '— ед. —' },
  { id: 'шт',   label: 'шт' },
  { id: 'компл',label: 'компл' },
  { id: 'м',    label: 'м' },
  { id: 'м²',   label: 'м²' },
  { id: 'м³',   label: 'м³' },
  { id: 'кг',   label: 'кг' },
  { id: 'т',    label: 'т' },
  { id: 'л',    label: 'л' },
  { id: 'уп',   label: 'уп' },
  { id: 'мешок',label: 'мешок' },
  { id: 'рул',  label: 'рулон' },
  { id: 'лист', label: 'лист' },
  { id: 'пог.м',label: 'пог.м' },
];

// Алерт по материалам: срабатывает для ЛЮБОЙ незакрытой работы. __MAT_DEADLINE_v2__
// Дедлайн закупки = (актуальная дата старта) − срок поставки. «Актуальная дата старта» =
// фактический старт, если работа уже началась, иначе плановый (он двигается при переносах —
// значит и дедлайн закупки едет вместе с работой вперёд/назад).
// Уровни (level):
//   • 'overdue' (🔴) — работа УЖЕ идёт или по плану должна была начаться, а материал не заказан.
//                      Это настоящая просрочка: работа стоит/рискует встать без материала.
//   • 'rush'    (🟠) — работа ещё в будущем, но по сроку поставки заказывать уже впритык/поздно.
//                      Это «поторопись» (срочно заказать или сдвинуть старт), НЕ «просрочено».
//   • 'soon'    (🟡) — заказывать в ближайшие дни.
//   • Работа закрыта (actualEnd) — пропускаем.
function computeMaterialRisk(task) {
  if (task.actualEnd) return null;
  const today = effectiveToday();
  const startISO = task.actualStart || task.planStart;
  const start = parseISO(startISO);
  if (!isFinite(start.getTime())) return null;
  const daysToStart = Math.round((start - today) / DAY_MS);
  const effectiveDaysToStart = Math.max(0, daysToStart);
  const mats = getTaskMaterials(task.id);
  const risky = mats.filter(m => !m.ordered && (Number(m.leadTime) || 0) > effectiveDaysToStart);
  if (!risky.length) return null;
  const maxLead = Math.max(...risky.map(m => Number(m.leadTime) || 0));
  const orderBy = new Date(start.getTime() - maxLead * DAY_MS);
  const started = !!task.actualStart && !task.actualEnd;
  const startInPast = daysToStart < 0;
  const level = (started || startInPast) ? 'overdue'
              : (orderBy < today) ? 'rush'
              : 'soon';
  return { daysToStart, maxLead, orderBy, riskyCount: risky.length, totalCount: mats.length,
           alreadyStarted: startInPast, started, level };
}

async function postDataAction(action, payload, timeoutMs) {
  // __FETCH_TIMEOUT_v1__ Без AbortController зависший backend = бесконечный спиннер.
  // 35s покрывает Vercel maxDuration=30s + sane buffer.
  const ctrl = new AbortController();
  const tmo = setTimeout(() => ctrl.abort(), Number(timeoutMs) || 35000);
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
      signal: ctrl.signal
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || ('HTTP ' + r.status));
    return json.result || {};
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('timeout');
    throw e;
  } finally {
    clearTimeout(tmo);
  }
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
function buildTaskTicketBadge(taskId, barLeft, barWidth, anchorOpts) {
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
  // Position: anchor badge so it's actually visible in current chart range.
  // 1) If today is within plan range → place at today (always in view since today line is centered)
  // 2) Else → place at LEFT edge of plan bar (project start area, easier to find than far-right)
  let left = Math.round(barLeft + barWidth - 2); // legacy fallback
  if (anchorOpts && anchorOpts.cellW && anchorOpts.todayD && anchorOpts.start) {
    const { todayD, start, cellW, pStart, pEnd } = anchorOpts;
    const todayInRange = pStart && pEnd && todayD >= parseISO(pStart) && todayD <= parseISO(pEnd);
    if (todayInRange) {
      const dayOffset = dayDiff(start, todayD);
      left = Math.round(dayOffset * cellW + cellW / 2);
    } else {
      left = Math.round(barLeft + 8); // left edge with small inset
    }
  }
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

// Восстанавливает state.depsGraph из state.dataCache.taskDependencies
function rebuildDepsGraph() {
  const byTask = new Map();        // taskId → Set<dependsOnTaskId> (предшественники)
  const byDependency = new Map();  // dependsOnTaskId → Set<taskId> (последователи)
  const list = (state.dataCache && state.dataCache.taskDependencies) || [];
  for (const d of list) {
    if (!d.taskId || !d.dependsOnTaskId) continue;
    if (!byTask.has(d.taskId)) byTask.set(d.taskId, new Map());
    byTask.get(d.taskId).set(d.dependsOnTaskId, d);
    if (!byDependency.has(d.dependsOnTaskId)) byDependency.set(d.dependsOnTaskId, new Set());
    byDependency.get(d.dependsOnTaskId).add(d.taskId);
  }
  state.depsGraph = { byTask, byDependency };
}

function depsForTask(taskId) {
  const m = state.depsGraph?.byTask?.get(taskId);
  return m ? Array.from(m.values()) : [];
}
function dependentsOfTask(taskId) {
  const s = state.depsGraph?.byDependency?.get(taskId);
  return s ? Array.from(s) : [];
}
function hasAnyDeps() {
  return (state.dataCache?.taskDependencies?.length || 0) > 0;
}

// CPM: forward+backward pass.
// Если в проекте есть явные зависимости (taskDependencies) — используем их.
// Иначе fallback к stage-chain (упрощённая модель).
// Возвращает { critical: Set<taskId>, slack: Map, predecessors: Map<taskId, Set<taskId>> }
function computeCriticalPath(schedule) {
  const tasks = schedule.tasks || [];
  if (!tasks.length) return { critical: new Set(), slack: new Map(), predecessors: new Map(), successors: new Map() };
  const projectStart = parseISO(schedule.project?.startDate);
  const projectEnd   = parseISO(schedule.project?.endDate);
  if (!isFinite(projectStart.getTime()) || !isFinite(projectEnd.getTime())) {
    return { critical: new Set(), slack: new Map(), predecessors: new Map(), successors: new Map() };
  }

  const taskById = new Map(tasks.map(t => [t.id, t]));
  const useExplicit = hasAnyDeps();

  // Build predecessors map
  const preds = new Map();
  for (const t of tasks) preds.set(t.id, new Set());

  if (useExplicit) {
    for (const d of state.dataCache.taskDependencies) {
      if (taskById.has(d.taskId) && taskById.has(d.dependsOnTaskId) && d.taskId !== d.dependsOnTaskId) {
        preds.get(d.taskId).add(d.dependsOnTaskId);
      }
    }
  } else {
    // Fallback: section-chain. Внутри каждой секции работы выстраиваются по этапу и planStart;
    // каждая работа зависит от предыдущей в этой же секции. Между секциями зависимостей НЕТ
    // (секции могут идти параллельно), поэтому не получаем ложно «всё критическое».
    const bySection = new Map();
    for (const t of tasks) {
      const arr = bySection.get(t.section) || [];
      arr.push(t);
      bySection.set(t.section, arr);
    }
    const stageRank = (st) => {
      const i = CANONICAL_STAGE_ORDER.indexOf(st);
      return i >= 0 ? i : 99;
    };
    for (const arr of bySection.values()) {
      arr.sort((a, b) => {
        const sa = stageRank(a.stage), sb = stageRank(b.stage);
        if (sa !== sb) return sa - sb;
        return (a.planStart || '').localeCompare(b.planStart || '');
      });
      for (let i = 1; i < arr.length; i++) {
        preds.get(arr[i].id).add(arr[i - 1].id);
      }
    }
  }

  // Topological order via Kahn
  const indeg = new Map();
  for (const t of tasks) indeg.set(t.id, preds.get(t.id).size);
  const queue = [];
  for (const [k, v] of indeg) if (v === 0) queue.push(k);
  const order = [];
  // successors lookup
  const succ = new Map();
  for (const t of tasks) succ.set(t.id, new Set());
  for (const [tid, ps] of preds) for (const p of ps) succ.get(p)?.add(tid);
  const indegCopy = new Map(indeg);
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const s of succ.get(id) || []) {
      indegCopy.set(s, indegCopy.get(s) - 1);
      if (indegCopy.get(s) === 0) queue.push(s);
    }
  }
  // If cycle (shouldn't happen — server validates), include rest in original order
  if (order.length < tasks.length) {
    const seen = new Set(order);
    for (const t of tasks) if (!seen.has(t.id)) order.push(t.id);
  }

  // Forward pass: ES = max(planStart, max(EF of preds) + 1 day)
  const efMap = new Map();
  for (const id of order) {
    const t = taskById.get(id);
    if (!t || !t.planStart || !t.planEnd) continue;
    const ps = parseISO(t.planStart).getTime();
    const pe = parseISO(t.planEnd).getTime();
    if (!isFinite(ps) || !isFinite(pe)) continue;
    const dur = Math.max(1, (pe - ps) / DAY_MS + 1);
    let predMaxEF = projectStart.getTime() - DAY_MS;
    for (const pid of preds.get(id)) {
      const pe2 = efMap.get(pid);
      if (pe2 && pe2.ef > predMaxEF) predMaxEF = pe2.ef;
    }
    const es = Math.max(ps, predMaxEF + DAY_MS);
    const ef = es + (dur - 1) * DAY_MS;
    efMap.set(id, { es, ef, dur });
  }

  // Backward pass (стандартный CPM):
  //   LF = min(LS успешников) - 1 день, для leaf-задач LF = projectEnd
  // Если у задачи нет успешников и она заканчивается задолго до конца проекта,
  // её запас будет большим — это математически корректно: её действительно
  // можно сдвинуть, и проект не пострадает.
  const lfMap = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const e = efMap.get(id);
    if (!e) continue;
    const successors = succ.get(id) || new Set();
    let lf;
    if (successors.size === 0) {
      lf = projectEnd.getTime();
    } else {
      lf = Number.POSITIVE_INFINITY;
      for (const sid of successors) {
        const sl = lfMap.get(sid);
        if (sl && sl.ls - DAY_MS < lf) lf = sl.ls - DAY_MS;
      }
      // если у leaf-успешников был projectEnd, lf может остаться projectEnd
      if (!isFinite(lf)) lf = projectEnd.getTime();
    }
    const ls = lf - (e.dur - 1) * DAY_MS;
    lfMap.set(id, { lf, ls });
  }

  const critical = new Set();
  const slackMap = new Map();
  for (const t of tasks) {
    const e = efMap.get(t.id), l = lfMap.get(t.id);
    if (!e || !l) continue;
    const slackDays = Math.round((l.lf - e.ef) / DAY_MS);
    slackMap.set(t.id, slackDays);
    if (slackDays <= 1) critical.add(t.id);
  }
  return { critical, slack: slackMap, predecessors: preds, successors: succ };
}

// Возвращает цепочку задач от данной до конца проекта по критическому пути.
// Используется в попапе бейджа КП.
function getCriticalChain(taskId) {
  if (!state.cpmCritical || !state.cpmCritical.has(taskId)) return [];
  const succ = state.cpmSuccessors;
  if (!succ) return [taskId];
  const chain = [taskId];
  const seen = new Set([taskId]);
  let cur = taskId;
  while (true) {
    const next = succ.get(cur);
    if (!next || next.size === 0) break;
    // pick the critical successor (any)
    let picked = null;
    for (const s of next) {
      if (state.cpmCritical.has(s)) { picked = s; break; }
    }
    if (!picked || seen.has(picked)) break;
    chain.push(picked);
    seen.add(picked);
    cur = picked;
  }
  return chain;
}

// EVM: Schedule Performance Index (SPI), Earned Value (EV), Planned Value (PV),
// прогноз сдачи (EAC). CPI/AC опускаем — actual cost у нас нет.
// Per-task EVM contribution: cost-weighted PV, EV, SPI for one task. Same формула как в computeEVM.
function computeTaskMetrics(t, asOfDate, weightMode = 'cost') {
  // weightMode: 'cost' — взвешиваем по стоимости (классический EVM, если стоимости заполнены);
  //             'dur'  — по длительности работ (когда стоимости неполные/нулевые, иначе EVM врёт).
  // Задача без дат не участвует в EVM (не портит общую картину).
  if (!t.planStart || !t.planEnd) return { cost: 0, pP: 0, aP: 0, PV: 0, EV: 0, spi: null };
  // __SPI_FIX_v2__ Permits + аномалии (actualEnd<planStart, actualStart в будущем с прогрессом)
  // не участвуют в SPI — ломают расчёт до ∞.
  if (t.isPermit || t.permitType) return { cost: 0, pP: 0, aP: 0, PV: 0, EV: 0, spi: null };
  const today = asOfDate.getTime();
  const cost = Number(t.costIncVat) || 0;
  const ps = parseISO(t.planStart).getTime();
  const pe = parseISO(t.planEnd).getTime();
  if (!isFinite(ps) || !isFinite(pe)) return { cost: 0, pP: 0, aP: 0, PV: 0, EV: 0, spi: null };
  // Аномалия: actualEnd до planStart («закрыта» до плана) — пропускаем
  if (t.actualEnd) {
    const ae = parseISO(t.actualEnd).getTime();
    if (isFinite(ae) && ae < ps - 86400000) return { cost: 0, pP: 0, aP: 0, PV: 0, EV: 0, spi: null };
  }
  // Аномалия: actualStart в будущем + есть progress — мусор, пропускаем
  if (t.actualStart) {
    const aS = parseISO(t.actualStart).getTime();
    if (isFinite(aS) && aS > today + 86400000 && (typeof t.progress === 'number' ? t.progress : 0) > 0) {
      return { cost: 0, pP: 0, aP: 0, PV: 0, EV: 0, spi: null };
    }
  }
  const dur = Math.max(1, (pe - ps) / 86400000 + 1);
  // actualEnd в будущем = битые данные (или поставлено заранее) — трактуем работу как ещё открытую.
  const actualEndValid = t.actualEnd && parseISO(t.actualEnd).getTime() <= today;
  // Если работа стартовала раньше плана — pP считаем от факт-старта,
  // чтобы EV и PV были в одной системе координат и SPI не взрывался.
  const actualStartTs = t.actualStart ? parseISO(t.actualStart).getTime() : null;
  const refPlanStart = (actualStartTs !== null && actualStartTs < ps) ? actualStartTs : ps;
  const refDur = Math.max(1, (pe - refPlanStart) / 86400000 + 1);
  let pP = 0;
  if (today >= pe) pP = 1;
  else if (today > refPlanStart) pP = ((today - refPlanStart) / 86400000) / refDur;
  // Если работа закрыта (валидный actualEnd) — она целиком освоена, плановое = 1
  // (иначе у работы, закрытой раньше планового старта, PV=0 и SPI = ∞).
  if (actualEndValid) pP = 1;
  // Гибрид: ручной % из weekly_report + календарный штраф за просрочку.
  // Если работа не закрыта (нет actualEnd), но planEnd прошёл — каждый день
  // без отметки готовности гнобит EV: эффективный_прогресс = manual_% × (pDur / max(pDur, elapsed)).
  let aP = 0;
  if (actualEndValid) {
    aP = 1;
  } else {
    const baseProgress = (typeof t.progress === 'number' && t.progress >= 0)
      ? Math.min(1, Math.max(0, t.progress))
      : (t.actualStart
          ? (() => {
              const as = parseISO(t.actualStart).getTime();
              if (today < as) return 0;
              const elapsed = (today - as) / 86400000;
              return Math.min(1, elapsed / dur);
            })()
          : 0);
    // Если работа уже должна была закрыться — применяем PMI-decay.
    // Базовая длительность с фактического старта (или планового, если факт-старт не отмечен).
    // Decay НЕ применяется когда руководитель вручную отметил 100% (baseProgress >= 1):
    // они говорят «сделано», просто actualEnd ещё не проставлен.
    const refStart = t.actualStart ? parseISO(t.actualStart).getTime() : ps;
    // Вычитаем дни паузы из elapsed — иначе SPI несправедливо падает в простоях.
    const pauseDaysSinceRef = Array.isArray(t.pauses) ? t.pauses.reduce((sum, p) => {
      if (!p || !p.from) return sum;
      const pStart = Math.max(refStart, parseISO(p.from).getTime());
      const pEnd = Math.min(today, p.to ? parseISO(p.to).getTime() : today);
      if (isFinite(pStart) && isFinite(pEnd) && pEnd > pStart) sum += (pEnd - pStart) / 86400000;
      return sum;
    }, 0) : 0;
    const elapsedSinceRef = Math.max(0, (today - refStart) / 86400000 - pauseDaysSinceRef);
    const overdueDecay = (today >= pe && elapsedSinceRef > dur && baseProgress < 1)
      ? dur / elapsedSinceRef
      : 1;
    aP = baseProgress * overdueDecay;
  }
  // Вес работы: стоимость (если режим cost) или длительность (режим dur).
  const weight = (weightMode === 'cost') ? cost : dur;
  const PV = weight * pP;
  const EV = weight * aP;
  return { cost, weight, pP, aP, PV, EV, spi: PV > 0 ? EV / PV : null };
}

function computeEVM(schedule, asOfDate) {
  const tasks = schedule.tasks || [];
  const projectStart = parseISO(schedule.project?.startDate);
  const projectEnd   = parseISO(schedule.project?.endDate);
  const totalCost = tasks.reduce((s, t) => s + (Number(t.costIncVat) || 0), 0);
  // Если проект на паузе — замораживаем расчёт на момент pausedAt. SPI и прогноз
  // не двигаются дальше, чтобы не накапливать «фантомное» опоздание во время паузы.
  if (schedule.project?.isPaused === true && schedule.project?.pausedAt) {
    const pausedAtDate = new Date(schedule.project.pausedAt);
    if (isFinite(pausedAtDate.getTime()) && pausedAtDate < asOfDate) {
      asOfDate = pausedAtDate;
    }
  }
  if (!isFinite(projectStart.getTime()) || !isFinite(projectEnd.getTime())) {
    return { PV: 0, EV: 0, SPI: null, totalCost, hasCostData: totalCost > 0,
      completionRatio: 0, plannedRatio: 0, eacDate: null, slipDays: 0,
      paused: schedule.project?.isPaused === true };
  }
  const today = asOfDate.getTime();

  // __EVM_WEIGHT_FALLBACK_v1__ Режим взвешивания. Классический EVM — по деньгам, НО это работает
  // только если стоимости заполнены у большинства работ. Если стоимости неполные (как часто бывает —
  // у Shoreline заполнены 3 из 22) → SPI/прогноз опираются на 2-3 работы и дают абсурд. Тогда считаем
  // по ДЛИТЕЛЬНОСТИ работ — это всегда есть и согласуется с прогрессом в шапке.
  const workTasks = tasks.filter((t) => !t.isPermit && !t.permitType && t.planStart && t.planEnd);
  const costedCount = workTasks.filter((t) => (Number(t.costIncVat) || 0) > 0).length;
  const costComplete = workTasks.length > 0 && (costedCount / workTasks.length) >= 0.7;
  const weightMode = costComplete ? 'cost' : 'dur';

  let PV = 0, EV = 0, eligibleWeight = 0, eligibleCost = 0;
  for (const t of tasks) {
    const m = computeTaskMetrics(t, asOfDate, weightMode);
    if (!m.weight) continue;
    PV += m.PV;
    EV += m.EV;
    eligibleWeight += m.weight;
    eligibleCost += m.cost;
  }

  // __SPI_NULL_WHEN_NOT_STARTED_v1__ Если PV=0 (ни одна работа ещё не должна была
  // начаться по плану) — SPI неопределён, не выдаём фантомные 100%.
  const SPI = PV > 0 ? EV / PV : null;
  const totalDays = Math.max(1, (projectEnd - projectStart) / 86400000 + 1);
  const plannedRatio = eligibleWeight > 0 ? PV / eligibleWeight : 0;
  const completionRatio = eligibleWeight > 0 ? EV / eligibleWeight : 0;
  // __EAC_SANITY_v1__ Прогноз ненадёжен, пока по плану прошло меньше ~8% — рано судить.
  const eacReliable = SPI != null && plannedRatio >= 0.08;
  // EAC = срок / SPI, НО с пределом: не раньше плана и не позже 2.5× плана
  // (иначе при низком SPI дата улетает в абсурд — 2035).
  let eacDays = (SPI && SPI > 0) ? totalDays / SPI : totalDays;
  eacDays = Math.max(totalDays, Math.min(eacDays, totalDays * 2.5));
  const eacDate = new Date(projectStart.getTime() + Math.round(eacDays - 1) * 86400000);
  const slipDays = (SPI != null && eacReliable) ? Math.round((eacDate - projectEnd) / 86400000) : 0;
  return {
    PV, EV, SPI,
    totalCost,
    eligibleCost,
    weightMode, costComplete, costedCount, workCount: workTasks.length,
    eacReliable,
    hasCostData: eligibleWeight > 0,
    completionRatio,
    plannedRatio,
    eacDate, slipDays,
    paused: schedule.project?.isPaused === true,
    frozenAt: schedule.project?.isPaused === true ? schedule.project?.pausedAt : null,
  };
}

// Лимит людей на смену в день — хранится в localStorage по slug проекта.
// 0 / null = не задан (подсветки нет).
function dailyCapKey() { return `dailyWorkersCap:${state.projectSlug || 'default'}`; }
function getDailyWorkersCap() {
  try {
    const v = Number(localStorage.getItem(dailyCapKey()));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  } catch (_) { return 0; }
}
function setDailyWorkersCap(v) {
  try {
    if (v > 0) localStorage.setItem(dailyCapKey(), String(Math.floor(v)));
    else localStorage.removeItem(dailyCapKey());
  } catch (_) {}
}

// Полное распределение по дням и типам специалистов. Возвращает:
//   { days[], types[], counts[type][dayIdx], peak, peakDate, peakIdx,
//     filledCount, totalActive } // сколько работ имеют реальные ресурсы из общего числа активных
//
// Считает ТОЛЬКО реально работавшие/работающие задачи. Чисто plan-задачи (без actualStart)
// в подсчёт НЕ идут — они "потенциальные", никто там не работает по факту.
//
// Условия включения работы на день D:
//   - НЕ cancelled
//   - actualStart должен быть установлен (иначе skip — это план, не реальная работа)
//   - Если actualEnd тоже установлен: интервал [actualStart .. actualEnd-1] (день закрытия исключён)
//   - Если actualEnd нет: интервал [actualStart .. today] (in progress, не учитываем будущее)
//   - День D не попадает в pause-интервал
function computeResourceTimeline(schedule) {
  const tasks = schedule.tasks || [];
  // Используем те же start/totalDays что и Gantt (state.layout) — иначе оси не совпадают.
  // Gantt раздвигает диапазон чтобы покрыть actualStart раньше plan + 7д padding слева.
  let projectStart, days;
  if (state?.layout?.startISO && state.layout.totalDays > 0) {
    projectStart = parseISO(state.layout.startISO);
    days = state.layout.totalDays;
  } else {
    projectStart = parseISO(schedule.project.startDate);
    const projectEnd = parseISO(schedule.project.endDate);
    days = Math.max(1, Math.round((projectEnd - projectStart) / DAY_MS) + 1);
  }
  const todayMs = effectiveToday().getTime();

  const counts = {}; // type → array(days)
  const totalPerDay = new Array(days).fill(0);
  let filledCount = 0;
  let totalActive = 0;

  for (const t of tasks) {
    if (t.cancelled) continue;
    // Resources: если в Airtable есть запись (даже пустая) — используем её. Если нет — дефолт по типу.
    // Это даёт каждой задаче на гант-баре соответствующих людей в heatmap, даже если юзер не заполнил вручную.
    const stored = getTaskResourcesStrict(t.id);
    let resources;
    if (Array.isArray(stored)) {
      if (!stored.length) continue; // юзер явно сказал «никого»
      resources = stored;
      filledCount++;
    } else {
      resources = defaultResourcesForTask(t); // fallback на дефолт
      if (!resources || !resources.length) continue;
    }
    totalActive++;

    // === Считаем активные дни как UNION плана и факта ===
    const planFromIdx = t.planStart ? Math.round((parseISO(t.planStart).getTime() - projectStart) / DAY_MS) : -1;
    const planToIdx   = t.planEnd   ? Math.round((parseISO(t.planEnd).getTime()   - projectStart) / DAY_MS) : -1;
    const factFromIdx = t.actualStart ? Math.round((parseISO(t.actualStart).getTime() - projectStart) / DAY_MS) : -1;
    let factToIdx = -1;
    if (t.actualStart) {
      if (t.actualEnd) {
        factToIdx = Math.round((parseISO(t.actualEnd).getTime() - projectStart) / DAY_MS) - 1; // день закрытия не считается
      } else {
        factToIdx = Math.round((todayMs - projectStart) / DAY_MS); // in progress до сегодня
      }
    }
    // День "закрытия и после" — задача больше не активна
    const closedFromIdx = t.actualEnd
      ? Math.round((parseISO(t.actualEnd).getTime() - projectStart) / DAY_MS)
      : Infinity;

    const pausedIdx = new Set();
    if (Array.isArray(t.pauses)) {
      for (const p of t.pauses) {
        if (!p || !p.from) continue;
        const pf = parseISO(p.from).getTime();
        const pt = p.to ? parseISO(p.to).getTime() : todayMs;
        if (!pf || pt < pf) continue;
        const pStart = Math.max(0, Math.round((pf - projectStart) / DAY_MS));
        const pEnd   = Math.min(days - 1, Math.round((pt - projectStart) / DAY_MS));
        for (let i = pStart; i <= pEnd; i++) pausedIdx.add(i);
      }
    }

    for (let i = 0; i < days; i++) {
      if (pausedIdx.has(i)) continue;
      if (i >= closedFromIdx) continue;
      const inPlan = planFromIdx >= 0 && planFromIdx <= i && i <= planToIdx;
      const inFact = factFromIdx >= 0 && factFromIdx <= i && i <= factToIdx;
      if (!inPlan && !inFact) continue;
      for (const r of resources) {
        const cnt = Number(r.count) || 0;
        if (!cnt) continue;
        if (!counts[r.type]) counts[r.type] = new Array(days).fill(0);
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
  return { days: dayDates, types, counts, totalPerDay, peak, peakDate, peakIdx, filledCount, totalActive };
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

  // Используем точно тот же cellW и labelW что и Gantt (через state.layout).
  // На мобилке Гантт держит sticky-section-label в 110px → день N на гантте лежит
  // на x = 110 + N*cellW. Если heatmap запустить с labelW=0, его день N окажется
  // на x = N*cellW, и подсветка пин-колонки будет сдвинута на 110px от Гантта.
  // Поэтому labelW heatmap всегда совпадает с currentLabelW() (110 на мобилке /
  // 260 на десктопе) — структура колонок идентична Гантту.
  const cellW = state?.layout?.cellW || state.cellW || 22;
  const labelW = state?.layout?.labelColW
    || parseInt(getComputedStyle(document.getElementById('gantt') || document.body).getPropertyValue('--label-col-w'))
    || 260;
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

  const headerDaysHtml = tl.days.map((d, i) => `<div class="rh-day-header" data-col="${i}">${d.getUTCDate()}</div>`).join('');

  const cellsTpl = `repeat(${tl.days.length}, ${cellW}px)`;

  const cap = getDailyWorkersCap();
  const overloadedDays = tl.totalPerDay.map(n => cap > 0 && n > cap);
  const overloadCount = overloadedDays.filter(Boolean).length;

  const rowHtml = (label, arr, isTotal) => {
    const palette = isTotal ? '34, 197, 94' : '70, 111, 166';
    const baseAlpha = isTotal ? 0.18 : 0.15;
    const peakAlpha = isTotal ? 0.55 : 0.65;
    const peakRef = isTotal ? Math.max(tl.peak, 1) : max;
    const cells = arr.map((n, i) => {
      const intensity = Math.min(1, n / peakRef);
      const bg = n > 0 ? `rgba(${palette}, ${baseAlpha + intensity * peakAlpha})` : 'transparent';
      const over = isTotal && overloadedDays[i];
      const isMonthStart = tl.days[i].getUTCDate() === 1 || i === 0;
      const cls = `rh-cell${isTotal ? ' rh-cell--total' : ''}${over ? ' rh-cell--overload' : ''}${isMonthStart ? ' rh-cell--month-start' : ''}`;
      const tip = isTotal && cap > 0
        ? `${escapeHtml(fmtDate(toISO(tl.days[i])))} · ${escapeHtml(label)}: ${n} (лимит ${cap}${over ? ' — превышение!' : ''})`
        : `${escapeHtml(fmtDate(toISO(tl.days[i])))} · ${escapeHtml(label)}: ${n}`;
      return `<div class="${cls}" data-col="${i}" style="background:${bg}" title="${tip}">${n > 0 ? n : ''}</div>`;
    }).join('');
    return `
      <div class="rh-row${isTotal ? ' rh-row--total' : ''}">
        <div class="rh-row-label">${escapeHtml(label)}</div>
        <div class="rh-row-cells" style="grid-template-columns:${cellsTpl}">${cells}</div>
      </div>`;
  };

  const headerCellsHtml = tl.days.map((d, i) => {
    const isMonthStart = d.getUTCDate() === 1 || i === 0;
    const cls = `rh-day-header${overloadedDays[i] ? ' rh-day-header--overload' : ''}${isMonthStart ? ' rh-day-header--month-start' : ''}`;
    return `<div class="${cls}" data-col="${i}">${d.getUTCDate()}</div>`;
  }).join('');

  const rowsHtml = tl.types.map(type => rowHtml(RESOURCE_LABEL_BY_ID[type] || type, tl.counts[type], false)).join('');
  const totalRowHtml = rowHtml('Итого', tl.totalPerDay, true);

  const overloadBadge = cap > 0 && overloadCount > 0
    ? `<span class="rh-overload-badge">⚠ перегруз: ${overloadCount} ${plural(overloadCount, ['день','дня','дней'])}</span>`
    : '';

  cont.hidden = false;
  cont.innerHTML = `
    <div class="rh-head">
      <div class="rh-title">Загрузка людей по дням</div>
      <div class="rh-meta">пик · ${tl.peak} чел.${tl.peakDate ? ' · ' + escapeHtml(fmtDate(toISO(tl.peakDate))) : ''}</div>
      <div class="rh-cap">
        <label class="rh-cap-label" for="rh-cap-input" title="Максимум людей на смене в день. Дни с превышением будут подсвечены красным.">Лимит на смену:</label>
        <input type="number" min="0" max="999" step="1" class="rh-cap-input" id="rh-cap-input" value="${cap || ''}" placeholder="—" />
        <span class="rh-cap-unit">чел.</span>
        ${overloadBadge}
      </div>
    </div>
    <div class="rh-scroll">
      <div class="rh-table" style="--rh-label-w:${labelW}px;">
        <div class="rh-row rh-row--header">
          <div class="rh-row-label"></div>
          <div class="rh-row-cells" style="grid-template-columns:${cellsTpl}">${headerCellsHtml}</div>
        </div>
        ${rowsHtml}
        ${totalRowHtml}
      </div>
    </div>`;

  const capInput = cont.querySelector('#rh-cap-input');
  if (capInput) {
    capInput.addEventListener('change', () => {
      const v = Math.max(0, Math.min(999, Number(capInput.value) || 0));
      setDailyWorkersCap(v);
      renderResourceHeatmap();
    });
  }

  // ── Sync horizontal scroll with the Gantt ──
  const gantt = document.getElementById('gantt');
  const rhScroll = cont.querySelector('.rh-scroll');
  if (gantt && rhScroll) {
    let syncing = false;
    const sync = (src, dst) => {
      if (syncing) return;
      syncing = true;
      dst.scrollLeft = src.scrollLeft;
      requestAnimationFrame(() => { syncing = false; });
    };
    if (!gantt._rhScrollSync) {
      gantt._rhScrollSync = () => sync(gantt, rhScroll);
      gantt.addEventListener('scroll', gantt._rhScrollSync, { passive: true });
    } else {
      // re-bind to fresh rhScroll element
      gantt.removeEventListener('scroll', gantt._rhScrollSync);
      gantt._rhScrollSync = () => sync(gantt, rhScroll);
      gantt.addEventListener('scroll', gantt._rhScrollSync, { passive: true });
    }
    rhScroll.addEventListener('scroll', () => sync(rhScroll, gantt), { passive: true });
    // Initial align
    rhScroll.scrollLeft = gantt.scrollLeft;
  }
}

// Resource peak: считаем суммарное число людей на каждый день в plan-диапазоне.
// Возвращаем максимум и его дату.
// Использует те же правила что и computeResourceTimeline:
// только actualStart-задачи (с факт-стартом) + strict resources + день закрытия исключён + паузы.
// Возвращает peak за весь проект и дату пика.
function computeResourcePeak(schedule) {
  const tasks = schedule.tasks || [];
  if (!tasks.length) return { peak: 0, peakDate: null };
  // Используем тот же диапазон что Gantt (state.layout) — иначе peakDate показывается на «другой» день
  let projectStart, days;
  if (state?.layout?.startISO && state.layout.totalDays > 0) {
    projectStart = parseISO(state.layout.startISO);
    days = state.layout.totalDays;
  } else {
    projectStart = parseISO(schedule.project.startDate);
    const projectEnd = parseISO(schedule.project.endDate);
    days = Math.round((projectEnd - projectStart) / DAY_MS) + 1;
  }
  const todayMs = effectiveToday().getTime();
  const counts = new Array(days).fill(0);

  for (const t of tasks) {
    if (t.cancelled) continue;
    const stored = getTaskResourcesStrict(t.id);
    let resources;
    if (Array.isArray(stored)) {
      if (!stored.length) continue;
      resources = stored;
    } else {
      resources = defaultResourcesForTask(t);
      if (!resources || !resources.length) continue;
    }
    const total = resources.reduce((s, r) => s + (Number(r.count) || 0), 0);
    if (!total) continue;

    const planFromIdx = t.planStart ? Math.round((parseISO(t.planStart).getTime() - projectStart) / DAY_MS) : -1;
    const planToIdx   = t.planEnd   ? Math.round((parseISO(t.planEnd).getTime()   - projectStart) / DAY_MS) : -1;
    const factFromIdx = t.actualStart ? Math.round((parseISO(t.actualStart).getTime() - projectStart) / DAY_MS) : -1;
    let factToIdx = -1;
    if (t.actualStart) {
      if (t.actualEnd) factToIdx = Math.round((parseISO(t.actualEnd).getTime() - projectStart) / DAY_MS) - 1;
      else factToIdx = Math.round((todayMs - projectStart) / DAY_MS);
    }
    const closedFromIdx = t.actualEnd
      ? Math.round((parseISO(t.actualEnd).getTime() - projectStart) / DAY_MS)
      : Infinity;

    const pausedIdx = new Set();
    if (Array.isArray(t.pauses)) {
      for (const p of t.pauses) {
        if (!p || !p.from) continue;
        const pf = parseISO(p.from).getTime();
        const pt = p.to ? parseISO(p.to).getTime() : todayMs;
        if (!pf || pt < pf) continue;
        const ps2 = Math.max(0, Math.round((pf - projectStart) / DAY_MS));
        const pe2 = Math.min(days - 1, Math.round((pt - projectStart) / DAY_MS));
        for (let i = ps2; i <= pe2; i++) pausedIdx.add(i);
      }
    }
    for (let i = 0; i < days; i++) {
      if (pausedIdx.has(i)) continue;
      if (i >= closedFromIdx) continue;
      const inPlan = planFromIdx >= 0 && planFromIdx <= i && i <= planToIdx;
      const inFact = factFromIdx >= 0 && factFromIdx <= i && i <= factToIdx;
      if (!inPlan && !inFact) continue;
      counts[i] += total;
    }
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

function renderMaterialAlert() {
  const cont = document.getElementById('materials-alert-banner');
  if (!cont) return;
  const sched = state.schedule;
  if (!sched || !sched.tasks?.length) { cont.hidden = true; cont.innerHTML = ''; return; }
  const risky = [];
  for (const t of sched.tasks) {
    const r = computeMaterialRisk(t);
    if (r) risky.push({ t, r });
  }
  if (!risky.length) { cont.hidden = true; cont.innerHTML = ''; return; }
  risky.sort((a, b) => a.r.orderBy - b.r.orderBy);
  const nearest = risky[0].r.orderBy;
  const urgentCount = risky.filter(({ r }) => r.daysToStart < r.maxLead).length;
  const top = risky.slice(0, 3).map(({ t, r }) => {
    const days = Math.max(0, Math.round((r.orderBy - effectiveToday()) / DAY_MS));
    return `<button type="button" class="mat-alert-task" data-task-id="${escapeHtml(t.id)}" title="Открыть карточку работы">
      <span class="mat-alert-task-name">${escapeHtml(t.name)}</span>
      <span class="mat-alert-task-deadline">до ${escapeHtml(fmtDate(toISO(r.orderBy)))} (${days > 0 ? days + ' дн.' : 'срочно'})</span>
    </button>`;
  }).join('');
  cont.hidden = false;
  cont.innerHTML = `
    <div class="mat-alert-head">
      <span class="mat-alert-icon">📦</span>
      <span class="mat-alert-title"><strong>${urgentCount} работ</strong> требуют срочного заказа материалов</span>
      <span class="mat-alert-deadline">ближайший до <strong>${escapeHtml(fmtDate(toISO(nearest)))}</strong></span>
      <button type="button" class="mat-alert-more" data-action="open-materials-drawer">Все →</button>
    </div>
    <div class="mat-alert-tasks">${top}${risky.length > 3 ? `<span class="mat-alert-more-count">+${risky.length - 3}</span>` : ''}</div>`;
  // Wire up clicks
  cont.querySelectorAll('.mat-alert-task').forEach(btn => {
    btn.addEventListener('click', () => {
      const tid = btn.getAttribute('data-task-id');
      if (tid) openDrawer(tid);
    });
  });
  const moreBtn = cont.querySelector('[data-action="open-materials-drawer"]');
  if (moreBtn) moreBtn.addEventListener('click', () => openAnalyticsDrawer('materials'));
}

function renderProjectAnalytics() {
  const cont = document.getElementById('project-analytics');
  if (!cont) return;
  const sched = state.schedule;
  if (!sched || !sched.tasks?.length) { cont.innerHTML = ''; return; }

  const today = effectiveToday();
  const cpm = computeCriticalPath(sched);
  const evm = computeEVM(sched, today);
  // Активный КП — только незавершённые работы. Готовые не подсвечиваем
  // и не считаем в счётчике: задержать их уже нельзя, в проекте они закрыты.
  const taskById = new Map(sched.tasks.map((t) => [t.id, t]));
  const activeCritical = new Set();
  for (const id of cpm.critical) {
    const t = taskById.get(id);
    if (t && !t.actualEnd) activeCritical.add(id);
  }
  state.cpmCritical = activeCritical;
  state.cpmSuccessors = cpm.successors;
  state.cpmPredecessors = cpm.predecessors;
  state.cpmSlack = cpm.slack;

  // __SPI_NULL_WHEN_NOT_STARTED_v1__ SPI=null = проект ещё не начался (PV=0)
  const spiPct = evm.SPI != null ? (evm.SPI * 100).toFixed(0) : '—';
  const earnedPct = Math.round(evm.completionRatio * 100);
  const planPct = Math.round(evm.plannedRatio * 100);
  const slip = evm.slipDays;
  const slipLbl = evm.SPI == null
    ? `<span class="analytics-slip analytics-slip--ok">проект ещё не начался</span>`
    : slip > 1
    ? `<span class="analytics-slip analytics-slip--late">+${slip} дн. к плану</span>`
    : slip < -1
    ? `<span class="analytics-slip analytics-slip--early">${slip} дн. к плану</span>`
    : `<span class="analytics-slip analytics-slip--ok">в графике</span>`;
  const spiCls = !evm.hasCostData || evm.SPI == null ? 'spi-na' : spiClass(evm.SPI);
  const spiLbl = !evm.hasCostData ? 'нет данных по стоимости'
              : evm.SPI == null ? 'проект ещё не начался'
              : evm.SPI >= 0.97 ? 'идём по плану'
              : evm.SPI >= 0.88 ? 'небольшое отставание'
              : 'серьёзное отставание';

  const onCritical = activeCritical.size;
  const remainingTasks = sched.tasks.filter((t) => !t.actualEnd).length;

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

  const cpmActiveCls = state.filterCriticalOnly ? ' is-active' : '';
  cont.innerHTML = `
    <div class="analytics-head">
      <span class="analytics-head-line"></span>
      <span class="analytics-head-text">Аналитика на сегодня</span>
      <span class="analytics-head-line"></span>
    </div>
    <div class="analytics-grid">
      <button type="button" class="analytics-card analytics-card--spi ${spiCls}" data-analytics="spi" title="Schedule Performance Index — насколько идём по графику">
        <span class="analytics-card-ico" aria-hidden="true">📊</span>
        <span class="analytics-card-body">
          <span class="analytics-card-label">SPI · ${spiLbl}</span>
          <span class="analytics-card-value">${evm.hasCostData && evm.SPI != null ? spiPct : '—'}${evm.hasCostData && evm.SPI != null ? '<span class="analytics-card-unit">%</span>' : ''}</span>
          <span class="analytics-card-meta">${!evm.hasCostData ? 'нет работ с датами' : evm.SPI == null ? 'ни одна работа ещё не должна была начаться' : `освоено ${earnedPct}% · план ${planPct}%${!evm.costComplete ? ' · по объёму работ' : ''}`}</span>
        </span>
      </button>
      <button type="button" class="analytics-card analytics-card--eac" data-analytics="eac" title="Прогноз даты завершения по текущему темпу">
        <span class="analytics-card-ico" aria-hidden="true">📅</span>
        <span class="analytics-card-body">
          <span class="analytics-card-label">Прогноз сдачи</span>
          <span class="analytics-card-value">${evm.eacReliable ? escapeHtml(fmtDate(toISO(evm.eacDate))) : '—'}</span>
          <span class="analytics-card-meta">${evm.eacReliable ? slipLbl : '<span class="analytics-slip analytics-slip--ok">рано судить · мало данных</span>'}</span>
        </span>
      </button>
      <button type="button" class="analytics-card analytics-card--cpm${cpmActiveCls}" data-analytics="cpm" title="Задачи на критическом пути — задержка любой сдвигает срок проекта">
        <span class="analytics-card-ico" aria-hidden="true">⚠️</span>
        <span class="analytics-card-body">
          <span class="analytics-card-label">Критический путь</span>
          <span class="analytics-card-value">${onCritical}<span class="analytics-card-unit"> / ${remainingTasks}</span></span>
          <span class="analytics-card-meta">${onCritical === 0 ? 'нет критичных' : 'задержки сдвигают срок'}</span>
        </span>
      </button>
      <button type="button" class="analytics-card analytics-card--mat${matRiskTasks > 0 ? ' analytics-card--alert' : ''}" data-analytics="materials" title="Материалы с риском по lead-time">
        <span class="analytics-card-ico" aria-hidden="true">📦</span>
        <span class="analytics-card-body">
          <span class="analytics-card-label">Материалы в риске</span>
          <span class="analytics-card-value">${matRiskTasks}<span class="analytics-card-unit"> работ</span></span>
          <span class="analytics-card-meta">${nearestOrderBy ? 'ближайший заказ до ' + escapeHtml(fmtDate(toISO(nearestOrderBy))) : 'всё под контролем'}</span>
        </span>
      </button>
      <button type="button" class="analytics-card analytics-card--res" data-analytics="resources" title="Пиковая загрузка людей по дням">
        <span class="analytics-card-ico" aria-hidden="true">👥</span>
        <span class="analytics-card-body">
          <span class="analytics-card-label">Пик людей</span>
          <span class="analytics-card-value">${resPeak.peak}<span class="analytics-card-unit"> чел.</span></span>
          <span class="analytics-card-meta">${resPeak.peakDate ? 'на ' + escapeHtml(fmtDate(toISO(resPeak.peakDate))) : 'нет данных'}</span>
        </span>
      </button>
      ${(() => {
        const last = getProgressLogLatest();
        const total = (state.dataCache?.progressLog || []).length;
        const reporter = last?.reporterName ? escapeHtml(last.reporterName) : '—';
        const ago = last ? escapeHtml(fmtAgo(last.at)) : 'отчётов ещё нет';
        const isStale = !last || (Date.now() - new Date(last.at).getTime()) > 36 * 3600 * 1000;
        const cls = !last ? 'analytics-card--mute' : (isStale ? 'analytics-card--alert' : '');
        return `<button type="button" class="analytics-card analytics-card--report ${cls}" data-analytics="progress-log" title="Ежедневные отчёты — календарь утренних диспатчей и вечерних голосовых ответов руководителей по этому проекту">
          <span class="analytics-card-ico" aria-hidden="true">📅</span>
          <span class="analytics-card-body">
            <span class="analytics-card-label">Ежедневные отчёты</span>
            <span class="analytics-card-value">${ago}</span>
            <span class="analytics-card-meta">${last ? `от ${reporter} · всего ${total}` : 'жду первый голосовой'}</span>
          </span>
        </button>`;
      })()}
    </div>`;

  // Все плашки → drawer с детализацией. Исключение: «Ежедневные отчёты»
  // открывают полноценный календарь (утренние диспатчи + вечерние пинги
  // с голосовыми ответами руководителей по этому проекту), а не плоский лог.
  cont.querySelectorAll('[data-analytics]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.getAttribute('data-analytics');
      if (k === 'progress-log') openReportsCalendarModal();
      else openAnalyticsDrawer(k);
    });
  });
}

function applyCriticalFilterStyles() {
  const root = document.getElementById('gantt');
  if (!root) return;
  // state.cpmFilterMode: null | 'critical' | 'flexible'
  root.classList.toggle('show-critical-only', state.cpmFilterMode === 'critical');
  root.classList.toggle('show-flexible-only', state.cpmFilterMode === 'flexible');
}

function renderHero() {
  const p = state.schedule.project;
  document.title = `${p.name} · График работ · CYFR`;

  // Populate header meta dynamically (was hardcoded to Orange in index.html)
  const titleEl = $('#hero-title');
  if (titleEl) {
    titleEl.textContent = p.name || 'Проект';
    titleEl.setAttribute('data-edit-project-name', '');
    titleEl.title = 'В режиме «Правка» — клик, чтобы переименовать проект';
  }
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
  // Два прогресса:
  // ─ pct (факт) — реальный прогресс по работам: ручной % из голосовых отчётов
  //   руководителя или fallback на elapsed/planDur. Средневзвешенный по длительности.
  // ─ planPct (план) — где мы должны быть по календарю плана к asOf без учёта
  //   реального исполнения. Юзер сравнивает: «по плану 75% — мы 68% — отстаём 7%».
  let pct = 0, planPct = 0, hasValidDateData = false;
  const tasks = state.schedule.tasks || [];
  if (tasks.length > 0) {
    let totalWeight = 0, doneWeight = 0, planWeight = 0;
    for (const t of tasks) {
      // Разрешения (NOC / Gate Pass / Work Permit) — не работы, а админ-документы на
      // весь срок проекта (~310 дн каждый). Они раздували знаменатель в 3 раза и
      // держали прогресс на 0%, даже когда реальная работа (Демонтаж) завершена.
      if (t.isPermit || t.permitType) continue;
      const ts = parseISO(t.planStart || t.start);
      const te = parseISO(t.planEnd || t.end);
      // Битые/отсутствующие даты пропускаем — иначе NaN-веса каскадно отравляют
      // средневзвешенное и Hero показывает «NaN%».
      if (!isFinite(ts.getTime()) || !isFinite(te.getTime()) || te < ts) continue;
      const w = Math.max(1, dayDiff(ts, te) + 1);
      totalWeight += w;
      doneWeight += w * taskProgress(t);
      // Calendar plan progress: 0 if not started yet, 1 if planned end past, fraction otherwise
      let cp = 0;
      if (asOf >= te) cp = 1;
      else if (asOf > ts) cp = (asOf - ts) / Math.max(1, te - ts);
      planWeight += w * cp;
    }
    if (totalWeight > 0) {
      hasValidDateData = true;
      pct = Math.round((doneWeight / totalWeight) * 100);
      planPct = Math.round((planWeight / totalWeight) * 100);
    }
  }
  const delta = pct - planPct;
  let progressMeta;
  if (!hasValidDateData) {
    // Нет ни одной работы с валидными датами → сравнивать факт с планом
    // нечего. Показываем дату как раньше — без ложного «в графике».
    progressMeta = 'на ' + fmtDate(toISO(asOf));
  } else if (Math.abs(delta) <= 1) {
    progressMeta = `по плану ${planPct}% · в графике`;
  } else if (delta > 0) {
    progressMeta = `по плану ${planPct}% · опережаем ${delta}%`;
  } else {
    progressMeta = `по плану ${planPct}% · отстаём ${Math.abs(delta)}%`;
  }

  $('#stat-total').textContent = fmtAED(p.totalIncVat);
  $('#stat-duration').textContent = durDays + ' ' + daysWord(durDays);
  $('#stat-dates').textContent = fmtDate(p.startDate) + ' → ' + fmtDate(p.endDate);
  $('#stat-progress').textContent = pct;
  // stat-today перепрофилирован в индикатор «факт vs план» — дата редко интересна
  // юзеру в этой плашке (она и так есть в Analytics-блоке «На сегодня»).
  const statTodayEl = $('#stat-today');
  statTodayEl.textContent = progressMeta;
  statTodayEl.classList.remove('stat-meta--ahead', 'stat-meta--behind', 'stat-meta--ok');
  if (hasValidDateData) {
    statTodayEl.classList.add(
      Math.abs(delta) <= 1 ? 'stat-meta--ok' :
      delta > 0 ? 'stat-meta--ahead' :
      'stat-meta--behind'
    );
  }
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
  renderProjectStateZone();
}

/* ═══ Project lifecycle UI: Start / Pause / Resume ═══ */
function fmtDateShort(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); }
  catch { return String(iso).slice(0, 10); }
}

function renderProjectStateZone() {
  const zone = document.getElementById('project-state-zone');
  if (!zone) return;
  const p = state.schedule?.project || {};
  const isPlanning = p.isPlanning !== false;
  const isPaused = p.isPaused === true;
  const histCount = Array.isArray(state.schedule?.history) ? state.schedule.history.length : 0;
  const histBtn = `<button type="button" class="btn-project-history" id="btn-project-history" title="Журнал событий проекта">📜 История${histCount ? ` <span class="bph-count">${histCount}</span>` : ''}</button>`;

  if (isPaused) {
    zone.innerHTML = `
      <div class="project-paused-banner" role="status">
        <div class="ppb-icon">⏸</div>
        <div class="ppb-main">
          <div class="ppb-title">Проект на паузе</div>
          <div class="ppb-meta">с ${escapeHtml(fmtDateShort(p.pausedAt))}${p.pauseReason ? '' : ''}</div>
          ${p.pauseReason ? `<span class="ppb-reason">${escapeHtml(p.pauseReason)}</span>` : ''}
        </div>
        <button type="button" class="btn-project-resume" id="btn-project-resume">▶️ Возобновить</button>
      </div>
      ${histBtn}`;
    document.getElementById('btn-project-resume')?.addEventListener('click', onProjectResumeClick);
    document.body.classList.add('project-paused');
  } else if (isPlanning) {
    zone.innerHTML = `
      <button type="button" class="btn-project-start" id="btn-project-start" title="Зафиксировать старт проекта — после этого изменения сроков потребуют причину">
        <span class="ps-icon">🚀</span>Старт проекта
      </button>
      <span style="color:var(--muted);font-size:12px;font-style:italic">Режим настройки — правки без причин</span>
      ${histBtn}`;
    document.getElementById('btn-project-start')?.addEventListener('click', onProjectStartClick);
    document.body.classList.remove('project-paused');
  } else {
    zone.innerHTML = `
      <span class="project-active-badge"><span class="pa-dot"></span>Активен с ${escapeHtml(fmtDateShort(p.startedAt))}</span>
      <button type="button" class="btn-project-pause" id="btn-project-pause">⏸ Поставить на паузу</button>
      ${histBtn}`;
    document.getElementById('btn-project-pause')?.addEventListener('click', onProjectPauseClick);
    document.body.classList.remove('project-paused');
  }
  document.getElementById('btn-project-history')?.addEventListener('click', openProjectHistoryModal);
}

const PROJECT_EVENT_LABEL = {
  project_started: { icon: '🚀', title: 'Проект стартанул', cls: 'pe-start' },
  project_paused: { icon: '⏸', title: 'Проект поставлен на паузу', cls: 'pe-pause' },
  project_resumed: { icon: '▶️', title: 'Проект возобновлён из паузы', cls: 'pe-resume' },
  project_back_to_planning: { icon: '↩️', title: 'Возврат в режим настройки', cls: 'pe-back' },
  report_not_provided: { icon: '❌', title: 'Вечерний отчёт не предоставлен', cls: 'pe-noreport' },
};

function openProjectHistoryModal() {
  const overlay = document.createElement('div');
  overlay.className = 'reason-modal-overlay';
  overlay.innerHTML = `
    <div class="reason-modal-card" style="max-width:640px" role="dialog" aria-modal="true">
      <div class="reason-modal-title">📜 Журнал проекта</div>
      <div class="reason-modal-sub">Все события на уровне проекта — старт, паузы, возобновления. Любая запись с причиной видна заказчику.</div>
      <div id="proj-hist-list" style="max-height:60vh;overflow-y:auto;padding-right:4px">
        <div style="color:#9ca3af;font-style:italic;padding:8px">Загрузка…</div>
      </div>
      <div class="reason-modal-actions">
        <button type="button" class="reason-modal-cancel">Закрыть</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('.reason-modal-cancel').addEventListener('click', close);

  // Свежий fetch чтобы видеть события только что произошедшие.
  fetch(`/api/data?slug=${encodeURIComponent(state.projectSlug)}&schedule=1&t=${Date.now()}`)
    .then(r => r.json())
    .then(d => {
      const sched = d?.schedule || d || {};
      const list = overlay.querySelector('#proj-hist-list');
      const events = Array.isArray(sched.history) ? sched.history : [];
      if (!events.length) {
        list.innerHTML = '<div style="color:#9ca3af;font-style:italic;padding:8px">Событий пока нет</div>';
        return;
      }
      const now = Date.now();
      // Pair pause/resume чтобы рассчитать длительность паузы.
      const sorted = [...events].sort((a, b) => new Date(a.at) - new Date(b.at));
      const rendered = sorted.slice().reverse().map((e) => {
        const meta = PROJECT_EVENT_LABEL[e.type] || { icon: '•', title: e.type || 'Событие', cls: 'pe-other' };
        const at = escapeHtml(fmtAtFull(e.at));
        const by = escapeHtml(e.by || '—');
        let extra = '';
        // Для resume — найти связанную pause и показать длительность
        if (e.type === 'project_resumed' && e.pausedAt) {
          const startedPause = new Date(e.pausedAt);
          const endedPause = new Date(e.at);
          const days = Math.max(0, Math.round((endedPause - startedPause) / 86400000));
          const reasonStr = e.pauseReason ? ` · причина: «${escapeHtml(e.pauseReason)}»` : '';
          extra = `<div class="pe-extra">Пауза длилась ${days} ${daysWord(days)} (с ${escapeHtml(fmtAtFull(e.pausedAt))})${reasonStr}</div>`;
        }
        const reasonHtml = e.reason ? `<div class="pe-reason">📝 ${escapeHtml(e.reason)}</div>` : '';
        return `<div class="proj-hist-row ${meta.cls}">
          <div class="ph-head">
            <span class="ph-icon">${meta.icon}</span>
            <span class="ph-title">${escapeHtml(meta.title)}</span>
            <span class="ph-meta">${by} · ${at}</span>
          </div>
          ${extra}
          ${reasonHtml}
        </div>`;
      }).join('');
      list.innerHTML = rendered;
    })
    .catch((e) => {
      const list = overlay.querySelector('#proj-hist-list');
      list.innerHTML = `<div style="color:#b91c1c;padding:8px">Ошибка загрузки: ${escapeHtml(e.message || String(e))}</div>`;
    });
}

function spawnConfetti(originEl) {
  const rect = originEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = ['#f97316', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6'];
  for (let i = 0; i < 36; i++) {
    const piece = document.createElement('div');
    piece.className = 'ps-confetti';
    const angle = (Math.PI * 2 * i) / 36 + (Math.random() - 0.5) * 0.4;
    const dist = 140 + Math.random() * 220;
    piece.style.setProperty('--x', Math.cos(angle) * dist + 'px');
    piece.style.setProperty('--y', Math.sin(angle) * dist + 60 + 'px');
    piece.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
    piece.style.left = cx + 'px';
    piece.style.top = cy + 'px';
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = (Math.random() * 0.15) + 's';
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 1700);
  }
}

// __PRELAUNCH_MODAL_v1__ Pre-launch модалка: проверяет что руководитель + бригадир привязаны к проекту.
// Без них кнопка «Запустить» disabled. Если хоть одна категория пустая — кнопка ведёт в «Команду».
async function onProjectStartClick() {
  const slug = state.projectSlug;
  let team;
  try {
    // __PER_PROJECT_TEAM_v1__ передаём slug чтобы получить activeInProject
    const r = await postDataAction('team:list', { slug });
    team = r.users || [];
  } catch (e) {
    alert('Не удалось загрузить команду: ' + (e.message || e));
    return;
  }
  const slugLc = String(slug || '').toLowerCase();
  // attached теперь учитывает per-project семантику (foreman/worker без slug в AllowedProjects = NOT attached)
  const attached = (u) => {
    if (typeof u.activeInProject === 'boolean') return u.activeInProject;
    const a = Array.isArray(u.allowedProjects) ? u.allowedProjects : [];
    if (!a.length) return true;
    return a.map(s => String(s).toLowerCase()).includes(slugLc);
  };
  const active = (u) => u.active !== false;
  const leadersAll = team.filter(u => active(u) && attached(u) && ['admin','owner','creator','pm'].includes(u.role));
  const foremenAll = team.filter(u => active(u) && attached(u) && u.role === 'foreman');

  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay';
  overlay.style.zIndex = 2000;
  const renderRow = (u) => `<label class="prelaunch-row">
    <input type="checkbox" name="prelaunch-${u.role === 'foreman' ? 'foreman' : 'leader'}" value="${escapeHtml(u.id)}" data-name="${escapeHtml(u.name)}" checked />
    <span class="prelaunch-row-name">${escapeHtml(u.name)}</span>
    <span class="prelaunch-row-role">${escapeHtml(u.role || '—')}</span>
    ${u.telegramUserId ? '<span class="prelaunch-row-tg">TG ✓</span>' : '<span class="prelaunch-row-tg prelaunch-row-tg--missing">TG ✗</span>'}
  </label>`;
  const leadersHtml = leadersAll.length
    ? leadersAll.map(renderRow).join('')
    : `<div class="prelaunch-empty">⚠️ Нет ни одного руководителя, привязанного к проекту. Открой «Команда» → «Менеджмент» и добавь.</div>`;
  const foremenHtml = foremenAll.length
    ? foremenAll.map(renderRow).join('')
    : `<div class="prelaunch-empty">⚠️ Нет ни одного бригадира на проекте. Бригадир обязателен — он будет получать переадресованные задачи.</div>`;
  const canLaunch = leadersAll.length > 0 && foremenAll.length > 0;
  overlay.innerHTML = `
    <div class="edit-form-card prelaunch-card">
      <div class="edit-form-head">
        <div>🚀 Запуск проекта</div>
        <button type="button" class="edit-form-close">×</button>
      </div>
      <div class="prelaunch-warn">
        После запуска любое изменение сроков потребует причину (она попадёт в логи).
        Перед стартом убедись, что команда привязана к проекту.
      </div>

      <div class="prelaunch-section">
        <div class="prelaunch-section-title">🧑‍💼 Руководители <span class="prelaunch-section-meta">минимум 1</span></div>
        ${leadersHtml}
      </div>

      <div class="prelaunch-section">
        <div class="prelaunch-section-title">👷 Бригадиры <span class="prelaunch-section-meta">минимум 1 — будет получать тикеты и переадресованные задачи</span></div>
        ${foremenHtml}
      </div>

      <div class="prelaunch-actions">
        <button type="button" class="btn" id="prelaunch-cancel">Отмена</button>
        <button type="button" class="btn" id="prelaunch-team">👥 Открыть Команду</button>
        <button type="button" class="btn btn-primary" id="prelaunch-go" ${canLaunch ? '' : 'disabled'}>${canLaunch ? '🚀 Запустить проект' : 'Не хватает команды'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.querySelector('#prelaunch-cancel').addEventListener('click', close);
  overlay.querySelector('#prelaunch-team').addEventListener('click', () => { close(); openTeamModal(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#prelaunch-go')?.addEventListener('click', async () => {
    const goBtn = overlay.querySelector('#prelaunch-go');
    goBtn.disabled = true;
    goBtn.textContent = 'Запускаю…';
    try {
      await postDataAction('project:start', { slug, by: 'web' });
      if (!state.schedule.project) state.schedule.project = {};
      state.schedule.project.isPlanning = false;
      state.schedule.project.startedAt = new Date().toISOString();
      const animBtn = document.getElementById('btn-project-start');
      if (animBtn) { animBtn.classList.add('is-launching'); spawnConfetti(animBtn); }
      close();
      await new Promise(r => setTimeout(r, 800));
      renderProjectStateZone();
      showToast('🚀 Проект стартанул!');
    } catch (e) {
      const det = e.message || String(e);
      goBtn.disabled = false;
      goBtn.textContent = '🚀 Запустить проект';
      showToast('Не удалось: ' + det, 'error');
    }
  });
}

async function onProjectPauseClick() {
  const reason = await askReason({
    title: '⏸ Пауза проекта',
    sub: 'Почему ставим проект на паузу? Причина обязательна — попадёт в логи и видна заказчику.',
    presets: ['Ожидаем согласование', 'Задержка финансирования', 'Просьба клиента', 'Форс-мажор', 'Задержка материалов'],
  });
  if (!reason) return;
  try {
    await postDataAction('project:pause', { slug: state.projectSlug, reason, by: 'web' });
    if (!state.schedule.project) state.schedule.project = {};
    state.schedule.project.isPaused = true;
    state.schedule.project.pausedAt = new Date().toISOString();
    state.schedule.project.pauseReason = reason;
    renderProjectStateZone();
    showToast('⏸ Проект на паузе');
  } catch (e) {
    showToast('Не удалось: ' + (e.message || e), 'error');
  }
}

async function onProjectResumeClick() {
  if (!confirm('▶️ Возобновить проект?')) return;
  try {
    await postDataAction('project:resume', { slug: state.projectSlug, by: 'web' });
    if (state.schedule.project) {
      state.schedule.project.isPaused = false;
      delete state.schedule.project.pausedAt;
      delete state.schedule.project.pauseReason;
    }
    renderProjectStateZone();
    showToast('▶️ Проект возобновлён');
  } catch (e) {
    showToast('Не удалось: ' + (e.message || e), 'error');
  }
}

/* Обёртка над task:update — если затронуты ПЛАНОВЫЕ даты И проект уже стартанул
   И не undo, спрашиваем причину через askReason() и вкладываем её в payload.
   options.skipReason — для автоматических откатов (toast undo, cascade rollback).
   actualStart/actualEnd — это фиксация факта (старт/завершение работы по факту),
   а не изменение плана. План остаётся тем же → причина не нужна. Причина гейтит
   только пересмотр обязательств перед заказчиком, т.е. правку planStart/planEnd. */
const TASK_PLAN_DATE_KEYS = ['planStart', 'planEnd'];
async function taskUpdateMaybeReason(args, options = {}) {
  const patch = args.patch || {};
  const touchesDates = Object.keys(patch).some(k => TASK_PLAN_DATE_KEYS.includes(k));
  const proj = state.schedule?.project || {};
  const isPlanning = proj.isPlanning !== false;
  const isPaused = proj.isPaused === true;
  if (isPaused) {
    showToast('⏸ Проект на паузе — изменения запрещены', 'error');
    throw new Error('project paused');
  }
  if (touchesDates && !isPlanning && !options.skipReason) {
    const reason = await askReason({
      title: '🗓 Причина изменения сроков',
      sub: options.subjectName ? `Работа: «${options.subjectName}»` : 'Без причины правка не сохранится — это видно заказчику в логах.',
      presets: ['Просьба клиента', 'Задержка материалов', 'Задержка подрядчика', 'Скоуп изменён', 'Перенос по доступу на объект', 'Форс-мажор'],
    });
    if (!reason) {
      const e = new Error('reason_cancelled');
      e.cancelled = true;
      throw e;
    }
    args = { ...args, reason, by: args.by || 'web' };
  }
  return postDataAction('task:update', args);
}

/* Универсальная модалка ввода причины с пресетами. Promise<string|null>. */
function askReason({ title = 'Укажи причину', sub = '', presets = [] }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'reason-modal-overlay';
    overlay.innerHTML = `
      <div class="reason-modal-card" role="dialog" aria-modal="true">
        <div class="reason-modal-title">${escapeHtml(title)}</div>
        ${sub ? `<div class="reason-modal-sub">${escapeHtml(sub)}</div>` : ''}
        ${presets.length ? `<div class="reason-modal-presets">${presets.map(p => `<button type="button" class="reason-preset">${escapeHtml(p)}</button>`).join('')}</div>` : ''}
        <textarea class="reason-modal-input" id="reason-modal-input" placeholder="Опиши причину…" maxlength="500" autofocus></textarea>
        <div class="reason-modal-actions">
          <button type="button" class="reason-modal-cancel">Отмена</button>
          <button type="button" class="reason-modal-submit" disabled>Сохранить</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#reason-modal-input');
    const submit = overlay.querySelector('.reason-modal-submit');
    const cancel = overlay.querySelector('.reason-modal-cancel');
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    cancel.addEventListener('click', () => close(null));
    input.addEventListener('input', () => { submit.disabled = !input.value.trim(); });
    overlay.querySelectorAll('.reason-preset').forEach(b => {
      b.addEventListener('click', () => {
        input.value = b.textContent;
        submit.disabled = false;
        input.focus();
      });
    });
    submit.addEventListener('click', () => {
      const v = input.value.trim();
      if (v) close(v);
    });
    input.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit.click(); }
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
    });
    setTimeout(() => input.focus(), 50);
  });
}

/* Последний осмысленный коммит schedule — берём ЧЕРЕЗ наш сервер (/api/last-commit),
 * чтобы браузер не ходил в api.github.com напрямую. С GitHub теперь говорит только сервер. */
async function fetchLastCommit(slug) {
  if (!slug) return null;
  try {
    const r = await fetch(`/api/last-commit?slug=${encodeURIComponent(slug)}`);
    if (!r.ok) return null;
    const j = await r.json();
    const c = j && j.commit;
    if (!c || !c.date) return null;
    return {
      date: new Date(c.date),
      author: c.author || 'Bot',
      message: c.message || '',
    };
  } catch (e) {
    return null;
  }
}

/* ─── task progress (0..1) ───
   Источник истины — t.progress (ручной % из вечернего голосового). Иначе:
   - закрыта (actualEnd) → 100%
   - идёт (есть actualStart) → пропорция elapsed / planDur. Если actualStart
     раньше planStart, отсчитываем от actualStart, чтобы не получить
     заниженные 1% когда работа уже несколько дней идёт фактически
   - не начата → 0%. */
function taskProgress(t) {
  if (typeof t.progress === 'number') return Math.max(0, Math.min(1, t.progress));
  if (t.actualEnd) return 1;
  if (!t.actualStart) return 0;
  const asOf = effectiveToday();
  const pStart = parseISO(t.planStart || t.start);
  const pEnd = parseISO(t.planEnd || t.end);
  const aStart = parseISO(t.actualStart);
  // Если плановые даты битые — нельзя посчитать пропорцию. Возвращаем символический
  // 1% («работа идёт») вместо NaN — иначе дальше всё каскадно ломается.
  if (!isFinite(pStart.getTime()) || !isFinite(pEnd.getTime()) || pEnd <= pStart) {
    return 0.01;
  }
  const refStart = (isFinite(aStart.getTime()) && aStart < pStart) ? aStart : pStart;
  const dur = Math.max(1, pEnd - refStart);
  if (asOf <= refStart) return 0.01;
  if (asOf >= pEnd) return 0.95;
  return Math.max(0.01, Math.min(0.99, (asOf - refStart) / dur));
}

/* ─── stages ribbon ───
   Cost-weighted прогресс этапа: ∑(EV для работ этапа) / ∑(eligibleCost этапа).
   Fallback на count-based если у этапа нет ни одной работы со стоимостью —
   иначе у этапов без сметы прогресс был бы вечно 0%. */
function stageProgress(stageId) {
  const stageTasks = state.schedule.tasks.filter((t) => t.stage === stageId);
  if (!stageTasks.length) return { pct: 0, done: 0, total: 0 };
  const asOf = effectiveToday();
  let totalCost = 0, earned = 0;
  for (const t of stageTasks) {
    const m = computeTaskMetrics(t, asOf);
    if (!m.cost) continue;
    totalCost += m.cost;
    earned += m.EV;
  }
  const done = stageTasks.filter((t) => !!t.actualEnd).length;
  if (totalCost > 0) {
    return { pct: Math.round((earned / totalCost) * 100), done, total: stageTasks.length };
  }
  // Нет стоимостей — фолбэк на простой счётчик закрытых
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
      if (!effectiveSub(t, sec)) return false;
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
      // Блокируем переключение пока активна Правка
      if (state.editMode) { showToast('Выключи «✎ Правка», чтобы включить Тикеты'); return; }
      state.showTickets = !state.showTickets;
      ticketsBtn.setAttribute('data-active', String(state.showTickets));
      renderGantt();
    });
  }

  const heatmapBtn = $('#btn-heatmap');
  if (heatmapBtn) {
    heatmapBtn.addEventListener('click', () => {
      if (state.editMode) { showToast('Выключи «✎ Правка», чтобы включить Загрузку'); return; }
      state.showHeatmap = !state.showHeatmap;
      heatmapBtn.setAttribute('data-active', String(state.showHeatmap));
      renderResourceHeatmap();
    });
  }

  const printBtn = $('#btn-print');
  if (printBtn) printBtn.addEventListener('click', printGanttAsImage);

  const editBtn = $('#btn-edit');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      state.editMode = !state.editMode;
      if (!state.editMode) deselectGanttBar();
      editBtn.setAttribute('data-active', String(state.editMode));
      document.body.classList.toggle('is-edit-mode', state.editMode);
      // При входе в Правку — гасим оверлеи Тикетов и Загрузки, чтобы фокус был только на редактировании.
      if (state.editMode) {
        if (state.showTickets) {
          state.showTickets = false;
          const tb = $('#btn-tickets');
          if (tb) tb.setAttribute('data-active', 'false');
        }
        if (state.showHeatmap) {
          state.showHeatmap = false;
          const hb = $('#btn-heatmap');
          if (hb) hb.setAttribute('data-active', 'false');
          if (typeof renderResourceHeatmap === 'function') renderResourceHeatmap();
        }
      }
      renderGantt();
      renderTasksSheet();
    });
    document.body.classList.toggle('is-edit-mode', state.editMode);
  }
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
  const pStart = parseISO(p.startDate);
  const pEnd = parseISO(p.endDate);
  // FIX 2026-04-28: viewport покрывает все task-даты + сегодня, с паддингом 7д слева и 14д справа.
  // Иначе при today вне [pStart..pEnd] today-stripe клампится, и при scroll вправо начинается белое пятно.
  const _todayMs = parseISO(todayISO()).getTime();
  let _minTs = Math.min(pStart.getTime(), pEnd.getTime(), _todayMs);
  let _maxTs = Math.max(pStart.getTime(), pEnd.getTime(), _todayMs);
  for (const _t of state.schedule.tasks) {
    for (const _f of [_t.planStart, _t.planEnd, _t.actualStart, _t.actualEnd, _t.start, _t.end]) {
      if (_f) {
        const _ts = parseISO(_f).getTime();
        if (_ts < _minTs) _minTs = _ts;
        if (_ts > _maxTs) _maxTs = _ts;
      }
    }
  }
  const start = new Date(_minTs - 7 * DAY_MS);
  const end = new Date(_maxTs + 14 * DAY_MS);
  const todayD = parseISO(todayISO()); // реальный сегодняшний день, без clamp к проекту
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
  state.layout.startISO = toISO(start);

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
    const dow = d.getUTCDay(); // 0=Вс, 6=Сб
    return dow === 6 || dow === 0; // выходные ОАЭ — суббота и воскресенье (НЕ пятница) __WEEKEND_SAT_SUN__
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

  // Stages-bar рендерится отдельно (в #stages-bar-host над Ганттом), не внутри grid'а.
  try { renderStagesBar(); } catch (_) {}

  // Empty-state CTA: проект пустой (0 разделов) — показываем заметную плашку с кнопкой,
  // независимо от edit-mode (юзер ещё не разбирался с управлением, дадим явный путь).
  if (!state.schedule.sections || state.schedule.sections.length === 0) {
    body += `
      <div class="empty-project-cta">
        <div class="epc-icon" aria-hidden="true">🏗️</div>
        <div class="epc-title">Проект пока пустой</div>
        <div class="epc-text">Начни с первого раздела (например: «Демонтаж», «Чистовые», «Электрика»). Потом в него добавишь работы.</div>
        <button type="button" class="epc-btn" data-add-section data-empty-cta>＋ Создать первый раздел</button>
        <div class="epc-hint">…или скажи голосом боту: <i>«добавь раздел Демонтаж»</i>, <i>«добавь работу Снос стены в Демонтаж»</i></div>
      </div>`;
  }

  for (const sec of state.schedule.sections) {
    const secTasks = tasksBySection[sec.id] || [];
    // При активном фильтре секции, не подпадающие под него, скрываем целиком —
    // иначе они выглядят как "пустые" из-за фильтра и врут "Работ ещё нет".
    if (state.filterSection && sec.id !== state.filterSection) continue;
    if (state.filterSubOnly && secTasks.length === 0) continue;
    // Пустые секции тоже показываем (пользователь только что создал, работ ещё нет —
    // важно видеть что секция существует, чтобы добавить в неё задачу).

    // Раздел показываем как СУБ только если хотя бы одна его работа реально на субе
    // (effectiveSub). Если все работы переключены на ЦИФР — бейдж раздела убираем,
    // даже когда sec.sub === true (это лишь дефолт для новых работ раздела).
    const secHasSub = secTasks.some((t) => effectiveSub(t, sec));
    const isSub = secTasks.length > 0 ? secHasSub : !!sec.sub;
    const collapsed = state.collapsedSections.has(sec.id);
    const secId = escapeHtml(sec.id);
    body += `<div class="section-label${isSub ? ' is-sub' : ''}${collapsed ? ' section-label--collapsed' : ''}" data-section-id="${secId}" style="--sec-color:${sec.color}" role="button" tabindex="0" aria-expanded="${collapsed ? 'false' : 'true'}" title="${collapsed ? 'Развернуть' : 'Свернуть'} группу">
      <span class="section-chevron" aria-hidden="true">▾</span>
      <span class="section-dot section-dot-edit" style="background:${sec.color}" data-section-id="${secId}" title="Сменить цвет"></span>
      <span class="section-name" data-section-id="${secId}" data-edit-name title="Кликни в режиме правки, чтобы переименовать">${escapeHtml(sec.name)}</span>
      <span class="section-count">${secTasks.length}</span>
      ${isSub ? '<span class="sub-badge-sec">СУБ</span>' : ''}
      <span class="edit-only-actions" aria-hidden="true">
        <button type="button" class="row-edit-btn" data-edit-section="${secId}" title="Переименовать раздел">✎</button>
        <button type="button" class="row-del-btn" data-del-section="${secId}" title="Удалить раздел (только если в нём 0 работ)">🗑</button>
      </span>
    </div>`;
    body += `<div class="section-grid" data-section-id="${secId}" style="width:${gridW}px"></div>`;

    // Empty-section hint: раздел есть, работ нет — показываем заметную inline-кнопку всегда.
    if (secTasks.length === 0 && !collapsed) {
      body += `<button type="button" class="empty-section-row" data-add-task="${secId}" title="Добавить первую работу в раздел «${escapeHtml(sec.name)}»">
        <span class="empty-section-plus">＋</span>
        <span class="empty-section-text">Работ ещё нет — <b>добавь первую</b></span>
      </button>`;
      body += `<div class="empty-section-grid" style="width:${gridW}px"></div>`;
    }

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
        const hasPause = Array.isArray(t.pauses) && t.pauses.length > 0;
        const hasOpenPause = hasPause && t.pauses.some(p => p && !p.to);
        factHtml = `<div class="bar-fact${light ? ' light' : ''}${running ? ' running' : ''}${hasOpenPause ? ' paused' : ''}" style="left:${aLeft}px; --bar-left:${aLeft}px; width:${aWidth}px; --b-top:${bTop}; --b-bot:${bBot};" data-tid="${t.id}" title="Факт: ${escapeHtml(fmtDate(aStart))} — ${t.actualEnd ? escapeHtml(fmtDate(t.actualEnd)) : (hasOpenPause ? 'на паузе' : 'в работе')} · ${aDur} ${daysWord(aDur)}">
          <span class="bar-fact-text">${escapeHtml(t.name)}</span>
          <span class="bar-days" aria-hidden="true">${aDur}d</span>
        </div>`;
      }

      // Pause overlay bars — render on plan bar, fact bar, or both based on pause.dateType
      let pauseHtml = '';
      if (Array.isArray(t.pauses) && t.pauses.length) {
        const todayIsoStr = toISO(todayD);
        for (const p of t.pauses) {
          if (!p || !p.from) continue;
          const pf = p.from;
          const pt = p.to || todayIsoStr;
          if (pt < pf) continue;
          const pfDate = parseISO(pf);
          const ptDate = parseISO(pt);
          // Clip to chart window
          const winEnd = parseISO(end);
          if (ptDate < start || pfDate > winEnd) continue;
          const cf = pfDate < start ? start : pfDate;
          const ct = ptDate > winEnd ? winEnd : ptDate;
          const pOff = dayDiff(start, cf);
          const pDurDays = dayDiff(cf, ct) + 1;
          const pL = pOff * cellW + 2;
          const pW = Math.max(cellW - 4, pDurDays * cellW - 4);
          const open = !p.to;
          const reason = (p.reason || 'без указания').replace(/"/g, '&quot;');
          const tipDates = p.to ? `${fmtDate(pf)} — ${fmtDate(p.to)}` : `с ${fmtDate(pf)} (открыта)`;
          // dateType: 'plan' / 'actual' / 'both'. Legacy pauses без dateType → fallback на 'plan' (plan-first система).
          const pDt = p.dateType || 'plan';
          // data-bar-kind = к какой части (plan/actual) относится этот bar — нужно для legacy 'both'
          // чтобы drag/edit знал какую сторону splitt'ить и редактировать.
          const renderOne = (mod, dtLabelTip) => `<div class="bar-pause bar-pause--${mod}${open ? ' open' : ''}" style="left:${pL}px; width:${pW}px;" data-tid="${t.id}" data-pause-id="${p.id || ''}" data-pause-from="${pf}" data-pause-to="${p.to || ''}" data-pause-dt="${pDt}" data-bar-kind="${mod}" title="⏸ Пауза ${dtLabelTip} ${tipDates} · ${escapeHtml(reason)}">
            <span class="bar-pause-icon" aria-hidden="true">⏸</span>
            <button type="button" class="bar-pause-del" data-pause-bar-del="${t.id}" data-pause-bar-id="${p.id || ''}" data-bar-kind="${mod}" title="Удалить паузу" aria-label="Удалить паузу">×</button>
          </div>`;
          if (pDt === 'plan') pauseHtml += renderOne('plan', '(план)');
          else if (pDt === 'both') { pauseHtml += renderOne('plan', '(план)'); pauseHtml += renderOne('actual', '(факт)'); }
          else pauseHtml += renderOne('actual', '(факт)');
        }
      }

      const isTaskSub = effectiveSub(t, sec);
      // Если задача явно помечена как ЦИФР внутри суб-раздела — это исключение, подсветим в тултипе.
      const isExplicitCyfrInSub = t.sub === false && sec.sub;
      const isExplicitSubInCyfr = t.sub === true && !sec.sub;
      const subTitle = t.subcontractorName
        ? `Субподрядчик: ${t.subcontractorName}`
        : (isExplicitSubInCyfr ? 'Субподрядчик (только эта работа)' : (sec.sub ? 'Субподрядчик (раздел)' : 'Субподрядчик'));
      const subBadge = isTaskSub
        ? `<span class="sub-badge" title="${escapeHtml(subTitle)}">СУБ${t.subcontractorName ? '·' + escapeHtml(t.subcontractorName.split(' ')[0]) : ''}</span>`
        : (isExplicitCyfrInSub ? `<span class="cyfr-badge" title="Эту работу делает ЦИФР (раздел на субе)">ЦИФР</span>` : '');
      const prog = taskProgress(t);
      const progPct = Math.round(prog * 100);
      let progBadge = '';
      if (prog >= 1) progBadge = '<span class="pbadge pbadge-done" title="Завершено">100%</span>';
      else if (prog > 0) progBadge = `<span class="pbadge" title="Выполнено ${progPct}%">${progPct}%</span>`;

      const hidden = collapsed ? ' row-hidden' : '';
      const isCritical = state.cpmCritical && state.cpmCritical.has(t.id);
      const isDone = !!t.actualEnd;
      const critCls = (isCritical ? ' task-critical' : '') + (isDone ? ' task-completed' : '');
      const critBadge = (isCritical && prog < 1) ? '<span class="task-crit-badge" title="На критическом пути — задержка сдвигает срок проекта">⚠ КП</span>' : '';
      const matRisk = computeMaterialRisk(t);
      const matBadge = matRisk
        ? `<span class="task-mat-badge" title="Заказать до ${escapeHtml(fmtDate(toISO(matRisk.orderBy)))} · ${matRisk.riskyCount} материалов в риске">📦 ${matRisk.daysToStart > 0 ? '−' + (matRisk.maxLead - matRisk.daysToStart) + 'д' : 'срочно'}</span>`
        : '';
      const matRiskCls = matRisk ? ' task-mat-risk' : '';
      // __PERMITS_AUTO_v1__ Permit countdown badge: 🟢 >7 дн / 🟡 ≤7 дн / 🔴 истёк.
      let permitBadge = '';
      if (t.isPermit || t.permitType) {
        const expIso = t.planEnd;
        const daysLeft = expIso ? Math.round((parseISO(expIso).getTime() - Date.now()) / 86400000) : null;
        if (typeof daysLeft === 'number') {
          if (daysLeft < 0)        permitBadge = `<span class="task-permit-badge task-permit-badge--expired" title="Истёк ${Math.abs(daysLeft)} дн. назад — продли срочно!">🔴 −${Math.abs(daysLeft)}д</span>`;
          else if (daysLeft <= 7)  permitBadge = `<span class="task-permit-badge task-permit-badge--soon" title="Истекает через ${daysLeft} дн. — продлевай заранее">🟡 ${daysLeft}д</span>`;
          else                     permitBadge = `<span class="task-permit-badge task-permit-badge--ok" title="Срок действия до ${fmtDate(toISO(parseISO(expIso)))}">🟢 ${daysLeft}д</span>`;
        }
      }
      // Двухстрочный layout: сверху имя на полную ширину + →,
      // снизу компактная полоса маркеров (id · КП · 📦 · % · СУБ · edit actions).
      const hasMeta = !!(critBadge || matBadge || progBadge || subBadge || permitBadge);
      const permitRowCls = (t.isPermit || t.permitType) ? ' task-label--permit' : '';
      body += `<div class="task-label${hidden}${critCls}${permitRowCls}" data-tid="${t.id}" data-section-id="${secId}" tabindex="0">
        <span class="tbullet" style="background:${catColor}"></span>
        <div class="task-label-body">
          <div class="task-label-top">
            <span class="tname" data-tid="${t.id}" data-edit-name title="${escapeHtml(t.name)} — кликни в режиме Правка чтобы переименовать">${(t.isPermit || t.permitType) ? '🪪 ' : ''}${escapeHtml(t.name)}</span>
            <button class="task-open-btn" data-tid="${t.id}" tabindex="-1" title="Подробнее" aria-label="Открыть детали: ${escapeHtml(t.name)}">→</button>
          </div>
          <div class="task-label-meta${hasMeta ? '' : ' is-empty'}">
            <span class="tid">№${escapeHtml(t.id)}</span>
            ${permitBadge}
            ${critBadge}
            ${matBadge}
            ${progBadge}
            ${subBadge}
            <span class="edit-only-actions" aria-hidden="true">
              <button type="button" class="row-edit-btn" data-edit-task="${t.id}" title="Переименовать">✎</button>
              <button type="button" class="row-dates-btn" data-dates-task="${t.id}" title="Изменить даты плана и факта">📅</button>
              ${(Array.isArray(t.pauses) && t.pauses.some(p => p && !p.to))
                ? `<button type="button" class="row-resume-btn" data-resume-task="${t.id}" title="Возобновить работу с паузы">▶️</button>`
                : `<button type="button" class="row-pause-btn" data-pause-task="${t.id}" title="Поставить на паузу">⏸</button>`}
              <button type="button" class="row-del-btn" data-del-task="${t.id}" title="Удалить работу">🗑</button>
            </span>
          </div>
        </div>
      </div>`;
      const progFill = prog > 0 ? `<div class="bar-plan-progress" style="width:${progPct}%; background:${bTop}" aria-hidden="true"></div>` : '';
      const ticketBadge = buildTaskTicketBadge(t.id, pLeft, pWidth, { todayD, start, cellW, pStart, pEnd });
      body += `<div class="task-grid${hidden}${critCls}${matRiskCls}" data-tid="${t.id}" data-section-id="${secId}" style="width:${gridW}px; background-image: ${stripeBg ? stripeBg + ', ' : ''}linear-gradient(to right, var(--line-2) 1px, transparent 1px); background-size: auto, ${cellW}px 100%;">
        <div class="bar-plan${light ? ' light' : ''}" style="left:${pLeft}px; --bar-left:${pLeft}px; width:${pWidth}px; --b-top:${bTop}; --b-bot:${bBot};" data-tid="${t.id}" title="План: ${escapeHtml(fmtDate(pStart))} — ${escapeHtml(fmtDate(pEnd))} · ${pDur} ${daysWord(pDur)} · ${progPct}%">
          ${progFill}
          <span class="bar-plan-text">${escapeHtml(t.name)}</span>
          <span class="bar-days" aria-hidden="true">${pDur}d</span>
        </div>
        ${factHtml}
        ${pauseHtml}
        ${ticketBadge}
      </div>`;
    }
    // «+ Работа» в конце раздела (видна только в edit-mode через CSS)
    body += `<button type="button" class="add-row add-task-row${collapsed ? ' row-hidden' : ''}" data-add-task="${secId}" title="Добавить работу в раздел «${escapeHtml(sec.name)}»">
      <span class="add-row-plus" aria-hidden="true">+</span> Добавить работу<span class="add-row-section"> в «${escapeHtml(sec.name)}»</span>
    </button>`;
    body += `<div class="add-row-grid${collapsed ? ' row-hidden' : ''}" style="width:${gridW}px"></div>`;
  }
  // «+ Раздел» в самом конце списка
  body += `<button type="button" class="add-row add-section-row" data-add-section title="Создать новый раздел">
    <span class="add-row-plus" aria-hidden="true">+</span> Добавить раздел
  </button>`;
  body += `<div class="add-row-grid" style="width:${gridW}px"></div>`;

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
  // Re-apply touch bar selection after re-render
  if (state.selectedBarTid) {
    const selEl = gantt.querySelector(`.bar-plan[data-tid="${state.selectedBarTid}"], .bar-fact[data-tid="${state.selectedBarTid}"]`);
    if (selEl) { _selectedBarEl = selEl; selEl.classList.add('bar-selected'); }
    else { _selectedBarEl = null; state.selectedBarTid = null; }
  }

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
  // Section-label click → toggle collapse (skip if click был по edit-элементам)
  gantt.querySelectorAll('.section-label').forEach((el) => {
    const toggle = () => {
      const sid = el.getAttribute('data-section-id');
      if (!sid) return;
      if (state.collapsedSections.has(sid)) state.collapsedSections.delete(sid);
      else state.collapsedSections.add(sid);
      applyCollapsedState();
    };
    el.addEventListener('click', (e) => {
      if (state.editMode && (e.target.closest('.edit-only-actions') || e.target.closest('[data-edit-name]') || e.target.closest('.section-dot-edit') || e.target.closest('input,textarea'))) {
        return; // не схлопывать в режиме правки если кликнули по edit-кнопке/инпуту
      }
      toggle();
    });
    el.addEventListener('keydown', (e) => {
      // Печатаем в инлайн-инпуте (переименование раздела) — не перехватывать пробел/Enter,
      // иначе пробел блокируется и раздел сворачивается. __SECTION_RENAME_SPACE_FIX__
      if (e.target.closest('input, textarea') || e.target.isContentEditable) return;
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

  // Re-render heatmap so its axes match the Gantt's freshly-computed start/cellW.
  if (state.showHeatmap && typeof renderResourceHeatmap === 'function') {
    renderResourceHeatmap();
  }

  // Mobile floating dates header — fixed at viewport top when scrolled past gantt.
  setupFloatingMobileDates();
}

/* ─── Mobile floating dates header ───
 * Когда юзер скроллит страницу вниз и .gantt уезжает наверх, шапка дат
 * (sticky внутри .gantt из-за overflow-y:clip) уезжает вместе с ней. На мобиле
 * это означает — внизу графика юзер не видит ни числа, ни месяца.
 *
 * Решение: клонируем .dates-header в position:fixed контейнер outside .gantt-wrap.
 * Показываем когда gantt.top < 0. Sync horizontal scroll через translateX.
 * Click на день → toggle pinCol (та же логика что и в основной шапке).
 */
function setupFloatingMobileDates() {
  // Cleanup previous
  document.getElementById('floating-dates-mobile')?.remove();
  if (window._floatingDatesCleanup) {
    window._floatingDatesCleanup();
    window._floatingDatesCleanup = null;
  }
  if (!isMobile()) return; // и портрет (≤720), и ландшафт телефона (низкая высота) __MOBILE_LANDSCAPE_FIX__

  const gantt = $('#gantt');
  if (!gantt) return;
  const datesHeader = gantt.querySelector('.dates-header');
  if (!datesHeader) return;
  const monthsRowOrig = datesHeader.querySelector('.months-row');
  const daysRowOrig = datesHeader.querySelector('.days-row');
  if (!daysRowOrig) return;

  const labelColW = state.layout?.labelColW || 110;

  const floating = document.createElement('div');
  floating.id = 'floating-dates-mobile';
  floating.setAttribute('aria-hidden', 'false');

  const viewport = document.createElement('div');
  viewport.className = 'fdm-viewport';
  floating.appendChild(viewport);

  const inner = document.createElement('div');
  inner.className = 'fdm-inner';
  viewport.appendChild(inner);

  // Clone months + days for context. Months row compact (smaller height via CSS).
  if (monthsRowOrig) {
    const monthsRow = monthsRowOrig.cloneNode(true);
    monthsRow.classList.add('fdm-months-row');
    inner.appendChild(monthsRow);
  }
  const daysRow = daysRowOrig.cloneNode(true);
  daysRow.classList.add('fdm-days-row');
  inner.appendChild(daysRow);

  document.body.appendChild(floating);

  function update() {
    const ganttRect = gantt.getBoundingClientRect();
    const visible = ganttRect.top < 0 && ganttRect.bottom > 60;
    if (!visible) {
      floating.style.display = 'none';
      return;
    }
    floating.style.display = 'block';
    floating.style.left = (ganttRect.left + labelColW) + 'px';
    floating.style.width = Math.max(0, ganttRect.width - labelColW) + 'px';
    inner.style.transform = `translateX(${-gantt.scrollLeft}px)`;
    // Reflect pin/today state
    daysRow.querySelectorAll('.day-cell.pinned').forEach(el => el.classList.remove('pinned'));
    if (state.pinCol != null) {
      const pinned = daysRow.querySelector(`.day-cell[data-col="${state.pinCol}"]`);
      if (pinned) pinned.classList.add('pinned');
    }
  }

  const onScroll = () => update();
  window.addEventListener('scroll', onScroll, { passive: true });
  gantt.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  window._floatingDatesCleanup = () => {
    window.removeEventListener('scroll', onScroll);
    gantt.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };

  // Click on a day in floating header → toggle pinCol (same as main click handler)
  daysRow.addEventListener('click', (e) => {
    const cell = e.target.closest('.day-cell');
    if (!cell) return;
    const col = parseInt(cell.getAttribute('data-col'), 10);
    if (!Number.isFinite(col)) return;
    state.pinCol = state.pinCol === col ? null : col;
    refreshPinnedClasses();
    updateOverlays();
    update();
  });

  update();
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

  // Touch pinch: two-finger zoom on mobile / touchscreens.
  // __SCROLL_JANK_FIX__ Раньше touchmove-слушатель висел постоянно как passive:false —
  // это заставляло браузер ждать main-thread на КАЖДЫЙ кадр прокрутки одним пальцем
  // (compositor scroll блокировался) → график «подвисал». Теперь:
  //  • touchstart — passive (не блокирует скролл; нативный pinch-zoom и так отключён
  //    через touch-action: pan-x, поэтому preventDefault на старте не нужен);
  //  • non-passive touchmove навешивается ТОЛЬКО на время 2-пальцевого жеста и снимается
  //    по его окончании. Прокрутка одним пальцем никогда не встречает non-passive touchmove.
  let pinch = null;
  const dist = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
  const mid = (ts) => (ts[0].clientX + ts[1].clientX) / 2;
  const pinchMove = (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault(); // блокируем нативный скролл, пока двигаем масштаб
    const d = dist(e.touches);
    if (pinch.d0 < 1) return;
    queueAbs(pinch.w0 * (d / pinch.d0), mid(e.touches));
  };
  let pinchMoveOn = false;
  const armPinchMove = () => { if (!pinchMoveOn) { gantt.addEventListener('touchmove', pinchMove, { passive: false }); pinchMoveOn = true; } };
  const disarmPinchMove = () => { if (pinchMoveOn) { gantt.removeEventListener('touchmove', pinchMove, { passive: false }); pinchMoveOn = false; } };
  gantt.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    pinch = { d0: dist(e.touches), w0: state.cellW };
    armPinchMove();
  }, { passive: true });
  const endPinch = (e) => { if (!e.touches || e.touches.length < 2) { pinch = null; disarmPinchMove(); } };
  gantt.addEventListener('touchend', endPinch);
  gantt.addEventListener('touchcancel', endPinch);

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

  // Columns: full content height, single column wide.
  // Reading actual day-cell rect — на мобиле .dates-header имеет grid-column: 1 / -1,
  // поэтому day cells могут стартовать с x=0 (а не x=labelColW), и math
  // `labelColW + col*cellW` даёт оверлей сдвинутый вправо на labelColW.
  const colRect = (col) => {
    const dayEl = gantt.querySelector(`.day-cell[data-col="${col}"]`);
    if (dayEl) {
      const r = dayEl.getBoundingClientRect();
      const g = gantt.getBoundingClientRect();
      return {
        left: r.left - g.left + gantt.scrollLeft,
        width: r.width,
        top: 0,
        height: contentH,
      };
    }
    return { left: labelColW + col * cellW, width: cellW, top: 0, height: contentH };
  };

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

  // Зеркалим hover/pin на heatmap (если открыт). rh-col-* — отдельные классы,
  // чтобы не пересечься с глобальными .col-hover/.col-pinned (там opacity:0 + position:absolute).
  const heatmap = document.getElementById('resource-heatmap');
  if (heatmap && !heatmap.hasAttribute('hidden')) {
    heatmap.querySelectorAll('.rh-col-hover, .rh-col-pinned').forEach(el => {
      el.classList.remove('rh-col-hover', 'rh-col-pinned');
    });
    if (state.hoverCol != null && state.hoverCol !== state.pinCol) {
      heatmap.querySelectorAll(`[data-col="${state.hoverCol}"]`).forEach(el => el.classList.add('rh-col-hover'));
    }
    if (state.pinCol != null) {
      heatmap.querySelectorAll(`[data-col="${state.pinCol}"]`).forEach(el => el.classList.add('rh-col-pinned'));
    }
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
  // Освежаем список ответственных в фоне — если админ только что добавил нового foreman'a,
  // он появится в чипах при следующем рендере секции тикетов.
  refreshAssigneesAndMaybeRerender(tid);
  const sec = state.sectionById[t.section] || { name: t.section || '—', color: '#94a3b8' };
  const st = state.stageById[t.stage] || { name: 'Этап не указан', color: '#94a3b8' };
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
  // Источник прогресса: manual = руководитель проговорил % в вечернем голосовом
  // (t.progress установлен как число), иначе считаем по календарю.
  const isManualProg = typeof t.progress === 'number';
  // Calendar plan progress (где должны быть по плану на сегодня) — только для
  // активных работ. Для done/not-started бессмысленно (уже 100% / ещё 0%).
  // Guard: если planStart=planEnd (нулевая длительность, mile-стоун или битые
  // данные) — деление 0/0 = NaN. Возвращаем null чтобы UI просто не рисовал.
  let calendarPlanPct = null;
  if ((status === 'running' || status === 'overdue') && isFinite(pStartD) && isFinite(pEndD) && pEndD > pStartD) {
    if (asOf >= pEndD) calendarPlanPct = 100;
    else if (asOf <= pStartD) calendarPlanPct = 0;
    else calendarPlanPct = Math.round(((asOf - pStartD) / (pEndD - pStartD)) * 100);
  }
  // Маркер «по плану» рисуем только в осмысленном диапазоне 2..98%. На краях
  // он либо лезет за границу прогресс-бара, либо сливается с заливкой/фоном —
  // визуальный шум без полезной информации.
  const showPlanMarker = calendarPlanPct != null && calendarPlanPct >= 2 && calendarPlanPct <= 98;

  // Metrics
  const daysOverdue = isOverdue ? dayDiff(pEndD, asOf) : 0;
  const startDelay = t.actualStart ? Math.max(0, dayDiff(pStartD, parseISO(t.actualStart))) : 0;
  let actualDur = null;
  if (t.actualStart && t.actualEnd) actualDur = dayDiff(parseISO(t.actualStart), parseISO(t.actualEnd)) + 1;
  const daysInWork = (t.actualStart && !t.actualEnd)
    ? Math.max(1, dayDiff(parseISO(t.actualStart), asOf) + 1) : 0;
  const daysRemaining = (status === 'running' && !isOverdue) ? Math.max(0, dayDiff(asOf, pEndD)) : 0;

  $('#drawer-tag').innerHTML = `<span class="drawer-tag-dot" style="background:${sec.color}"></span>${escapeHtml(sec.name)}${st.name ? ' · ' + escapeHtml(st.name) : ''}`;
  $('#drawer-title').textContent = t.name;

  const factRange = t.actualStart
    ? `${fmtDate(t.actualStart)} → ${t.actualEnd ? fmtDate(t.actualEnd) : 'в работе'}`
    : '—';

  const isTaskSub = effectiveSub(t, sec);
  const isExplicitCyfrInSub = t.sub === false && sec.sub;
  const isExplicitSubInCyfr = t.sub === true && !sec.sub;
  const contractorLabel = isTaskSub
    ? (t.subcontractorName
        ? `Субподрядчик · ${t.subcontractorName}`
        : (isExplicitSubInCyfr ? 'Субподрядчик (только эта работа)' : (sec.sub ? 'Субподрядчик (раздел)' : 'Субподрядчик')))
    : (isExplicitCyfrInSub ? 'CYFR FITOUT (раздел на субе, эту работу делаем сами)' : 'CYFR FITOUT');

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
        ${isManualProg ? '<span class="drawer-progress-source" title="Этот % проговорил руководитель в вечернем голосовом отчёте — не календарная оценка">🎤 из голосового</span>' : ''}
      </div>
      <div class="drawer-progress">
        <div class="drawer-progress-fill" style="width:${progPct}%; background:${progColor}"></div>
        ${showPlanMarker ? `<div class="drawer-progress-plan-marker" style="left:${calendarPlanPct}%" title="По календарю плана работа должна быть на ${calendarPlanPct}%"></div>` : ''}
      </div>
      ${calendarPlanPct != null ? `<div class="drawer-progress-meta">по плану ${calendarPlanPct}% · ${
        progPct - calendarPlanPct >= -1 && progPct - calendarPlanPct <= 1
          ? '<span class="drawer-progress-meta--ok">в графике</span>'
          : progPct > calendarPlanPct
          ? `<span class="drawer-progress-meta--ahead">опережаем ${progPct - calendarPlanPct}%</span>`
          : `<span class="drawer-progress-meta--behind">отстаём ${calendarPlanPct - progPct}%</span>`
      }</div>` : ''}
    </div>

    ${metricsHtml ? `<div class="drawer-metrics">${metricsHtml}</div>` : ''}

    <div class="drawer-grid">
      ${kv('Исполнитель', escapeHtml(contractorLabel))}
      ${kv('Этап', escapeHtml(st.name))}
      ${kv('План', fmtDate(pStart) + ' → ' + fmtDate(pEnd), { span: true })}
      ${kv('Факт', escapeHtml(factRange), { span: true })}
      ${kv('Длительность (план)', plannedDur + ' ' + daysWord(plannedDur))}
      ${kv('Длительность (факт)', actualDur != null ? (actualDur + ' ' + daysWord(actualDur)) : (daysInWork > 0 ? (daysInWork + ' ' + daysWord(daysInWork) + ' · в работе') : '—'))}
    </div>${buildDrawerPausesHtml(t)}${buildDrawerDelaysHtml(t)}${buildDrawerResourcesHtml(t.id)}${buildDrawerMaterialsHtml(t.id)}${buildDrawerProgressLogHtml(t.id)}${buildDrawerTaskMeetingNotesHtml(t.id)}${buildDrawerTicketsHtml(t.id)}${buildDrawerDependenciesHtml(t)}${buildDrawerHistoryHtml(t)}`;

  attachTicketHandlers();
  attachResourceMaterialHandlers(t.id);
  bindDrawerDependenciesHandlers(t.id);
  // Если у работы нет явных зависимостей — предложим auto-зависимости из section-chain
  // (предыдущая работа в той же секции по этапу + planStart). Они появятся в списке как ✓ ИИ.
  ensureAutoDepsForTask(t.id);
  setDrawerOpen(true);
}

async function ensureAutoDepsForTask(taskId) {
  if (depsForTask(taskId).length) return;
  const t = state.schedule.tasks.find(x => x.id === taskId);
  if (!t) return;
  const sectionTasks = state.schedule.tasks
    .filter(x => x.section === t.section)
    .sort((a, b) => {
      const ra = CANONICAL_STAGE_ORDER.indexOf(a.stage);
      const rb = CANONICAL_STAGE_ORDER.indexOf(b.stage);
      const sa = ra >= 0 ? ra : 99;
      const sb = rb >= 0 ? rb : 99;
      if (sa !== sb) return sa - sb;
      return (a.planStart || '').localeCompare(b.planStart || '');
    });
  const myIdx = sectionTasks.findIndex(x => x.id === taskId);
  if (myIdx <= 0) return; // первая в секции — нет предшественника
  const pred = sectionTasks[myIdx - 1];
  try {
    const r = await fetch('/api/dependencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', payload: { slug: state.projectSlug, taskId, dependsOnTaskId: pred.id, source: 'auto' } })
    });
    const j = await r.json();
    if (r.ok && j.dep) {
      const list = state.dataCache.taskDependencies || [];
      const filtered = list.filter(d => !(d.taskId === taskId && d.dependsOnTaskId === pred.id));
      filtered.push(j.dep);
      state.dataCache.taskDependencies = filtered;
      rebuildDepsGraph();
      // Re-render dep section if drawer is still showing this task
      const sec = document.getElementById('drawer-deps-section');
      if (sec && sec.dataset.taskId === taskId) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildDrawerDependenciesHtml(t);
        sec.replaceWith(wrapper.firstElementChild);
        bindDrawerDependenciesHandlers(taskId);
      }
    }
  } catch (e) { console.warn('ensureAutoDepsForTask failed:', e?.message || e); }
}

// Per-task photo store: taskId → File[]
const ticketPhotoStore = {};
const ticketViewState = {}; // { [taskId]: { filter: 'all', sort: 'deadline' } }

// Внутренние названия статусов — отличаются от PlanRadar.
// ID в БД остаются английскими (open/in_progress/...), мы только меняем
// то, как они показываются пользователю, чтобы попасть в наш реальный
// строй-процесс: бригадир видит «Новый» вместо «Открыт» и т.д.
const TICKET_STATUS_LABEL = {
  open:        'Новый',         // зарегистрирован, никто ещё не взял
  in_progress: 'В работе',      // бригада устраняет
  in_review:   'На проверке',   // устранён, ждём PM/заказчика
  deferred:    'На паузе',      // ждём материал/решение/смежников
  resolved:    'Устранён',      // подтверждён и закрыт
  rejected:    'Снят'           // не дефект / отменён
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
    const descClean = (tk.description || '').replace(/\[task:\w+\]/gi, '').replace(/\[slug:[\w-]+\]/gi, '').replace(/\s+$/g, '').trim();
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
  add_milestone: 'майлстоун',
  update_task: 'правка',
  pause_task: 'пауза',
  resume_task: 'возобновлена',
  pause_edit: 'пауза изменена',
  pause_delete: 'пауза удалена',
  weekly_report: 'отчёт прораба'
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
function getProgressLogForTask(taskId) {
  const all = (state.dataCache && state.dataCache.progressLog) || [];
  const tid = String(taskId);
  return all.filter(e => String(e.taskId) === tid);
}

function getProgressLogLatest() {
  const all = (state.dataCache && state.dataCache.progressLog) || [];
  if (!all.length) return null;
  // already sorted desc by 'at' from server, but defensive sort
  return all.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
}

function fmtAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return 'только что';
  if (sec < 3600) return `${Math.floor(sec / 60)} мин. назад`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ч. назад`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return `${days} д. назад`;
  const months = Math.floor(days / 30);
  return `${months} мес. назад`;
}

function fmtAtFull(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function buildDrawerProgressLogHtml(taskId) {
  const entries = getProgressLogForTask(taskId);
  if (!entries.length) return '';
  // Group by batchId so one voice = one card
  const groups = new Map();
  for (const e of entries) {
    const key = e.batchId || `single:${e.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const rows = Array.from(groups.values())
    .sort((a, b) => String(b[0].at).localeCompare(String(a[0].at)))
    .map(group => {
      const head = group[0];
      const me = group.find(e => String(e.taskId) === String(taskId)) || head;
      const actLbl = me.action === 'mark_complete' ? '✅ закрыта'
        : me.action === 'mark_started' ? '🟡 стартовала'
        : me.action === 'set_progress' ? `📊 ${Math.round((me.newProgress || 0) * 100)}%`
        : me.action;
      const prevLbl = (typeof me.prevProgress === 'number' && me.action === 'set_progress')
        ? ` <span class="progress-log-prev">было ${Math.round(me.prevProgress * 100)}%</span>`
        : '';
      const reporter = me.reporterName ? escapeHtml(me.reporterName) : '—';
      const reason = me.reason ? `<div class="progress-log-reason">«${escapeHtml(me.reason)}»</div>` : '';
      const raw = me.rawText ? `<details class="progress-log-raw"><summary>Полная расшифровка</summary><div>${escapeHtml(me.rawText)}</div></details>` : '';
      return `<div class="progress-log-row">
        <div class="progress-log-head">
          <span class="progress-log-act">${actLbl}</span>${prevLbl}
          <span class="progress-log-by">${reporter}</span>
          <span class="progress-log-at" title="${escapeHtml(fmtAtFull(me.at))}">${escapeHtml(fmtAgo(me.at))}</span>
        </div>
        ${reason}
        ${raw}
      </div>`;
    }).join('');
  return `
    <div class="drawer-section-title">📜 Голосовые отчёты · ${entries.length}</div>
    <div class="progress-log-block">${rows}</div>`;
}

// Категория записи истории — определяет визуал (цвет, размер, формат).
function classifyHistoryEntry(h) {
  const t = h?.type || '';
  if (['set_dates', 'shift_dates', 'set_duration', 'bulk_shift_section'].includes(t)) return 'dates';
  if (['pause_task', 'resume_task', 'pause_edit', 'pause_delete', 'add_delay'].includes(t)) return 'pause';
  if (['mark_complete', 'mark_started', 'mark_cancelled'].includes(t)) return 'status';
  if (['set_progress', 'weekly_report'].includes(t)) return 'progress';
  return 'minor';
}

function fmtPeriod(start, end) {
  if (!start && !end) return '<span class="dh-period">—</span>';
  if (start && end) {
    const days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
    return `<span class="dh-period">${escapeHtml(fmtDateShort(start))} → ${escapeHtml(fmtDateShort(end))}</span> <span style="color:#9ca3af;font-size:11px">(${days} ${daysWord(days)})</span>`;
  }
  return `<span class="dh-period">${escapeHtml(fmtDateShort(start || end))}</span>`;
}

// Возвращает {label, parts} — какой тип дат изменён и что именно (только начало / только конец / оба).
function _classifyDateChange(before, after) {
  const planStartChanged = (before.planStart || null) !== (after.planStart || null);
  const planEndChanged   = (before.planEnd   || null) !== (after.planEnd   || null);
  const actStartChanged  = (before.actualStart || null) !== (after.actualStart || null);
  const actEndChanged    = (before.actualEnd   || null) !== (after.actualEnd   || null);
  const planChanged = planStartChanged || planEndChanged;
  const factChanged = actStartChanged || actEndChanged;
  let label = '';
  if (planChanged && factChanged) label = 'План и факт';
  else if (planChanged) label = 'План';
  else if (factChanged) label = 'Факт';
  let what = '';
  if (planChanged) {
    if (planStartChanged && planEndChanged) what = 'начало и конец';
    else if (planStartChanged) what = 'только начало';
    else if (planEndChanged) what = 'только конец';
  } else if (factChanged) {
    if (actStartChanged && actEndChanged) what = 'начало и конец';
    else if (actStartChanged) what = 'только начало';
    else if (actEndChanged) what = 'только конец';
  }
  return { label, what, planChanged, factChanged, planStartChanged, planEndChanged, actStartChanged, actEndChanged };
}

function buildHistoryDatesCard(h) {
  const before = h.before || {};
  const after = h.after || {};
  const cls = _classifyDateChange(before, after);
  const subTitle = cls.label
    ? `<div class="dh-subtitle">Изменены: <b>${escapeHtml(cls.label)}</b>${cls.what ? ` <span class="muted">(${escapeHtml(cls.what)})</span>` : ''}</div>`
    : '';
  let blocks = '';
  // Plan changes
  if (cls.planChanged) {
    const oldDur = (before.planStart && before.planEnd) ? (Math.round((new Date(before.planEnd) - new Date(before.planStart)) / 86400000) + 1) : null;
    const newDur = (after.planStart && after.planEnd) ? (Math.round((new Date(after.planEnd) - new Date(after.planStart)) / 86400000) + 1) : null;
    let delta = '';
    if (oldDur != null && newDur != null) {
      const diff = newDur - oldDur;
      if (diff !== 0) {
        const dcls = diff > 0 ? '' : ' dh-delta-neg';
        delta = `<span class="dh-delta${dcls}">${diff > 0 ? '+' : ''}${diff} ${daysWord(Math.abs(diff))}</span>`;
      }
    }
    blocks += `
      <div class="dh-dates-block">
        ${cls.factChanged ? '<div class="dh-section-lbl">План:</div>' : ''}
        <div class="dh-row-was"><span class="dh-label">Было:</span>${fmtPeriod(before.planStart, before.planEnd)}</div>
        <div class="dh-row-now"><span class="dh-label">Стало:</span>${fmtPeriod(after.planStart, after.planEnd)}${delta}</div>
      </div>`;
  }
  if (cls.factChanged) {
    const oldDur = (before.actualStart && before.actualEnd) ? (Math.round((new Date(before.actualEnd) - new Date(before.actualStart)) / 86400000) + 1) : null;
    const newDur = (after.actualStart && after.actualEnd) ? (Math.round((new Date(after.actualEnd) - new Date(after.actualStart)) / 86400000) + 1) : null;
    let delta = '';
    if (oldDur != null && newDur != null) {
      const diff = newDur - oldDur;
      if (diff !== 0) {
        const dcls = diff > 0 ? '' : ' dh-delta-neg';
        delta = `<span class="dh-delta${dcls}">${diff > 0 ? '+' : ''}${diff} ${daysWord(Math.abs(diff))}</span>`;
      }
    }
    blocks += `
      <div class="dh-dates-block" style="${cls.planChanged ? 'margin-top:6px' : ''}">
        ${cls.planChanged ? '<div class="dh-section-lbl">Факт:</div>' : ''}
        <div class="dh-row-was"><span class="dh-label">Было:</span>${fmtPeriod(before.actualStart, before.actualEnd)}</div>
        <div class="dh-row-now"><span class="dh-label">Стало:</span>${fmtPeriod(after.actualStart, after.actualEnd)}${delta}</div>
      </div>`;
  }
  return subTitle + blocks;
}

// Локализация типа паузы: 'plan'/'actual'/'both' → читаемый label.
function _pauseTypeLabel(dt) {
  if (dt === 'actual') return 'Факт';
  if (dt === 'both') return 'План и факт';
  return 'План';
}

function buildDrawerHistoryHtml(t) {
  const hist = Array.isArray(t.history) ? t.history : [];
  if (!hist.length) return '';
  const rows = hist.slice().reverse().map((h) => {
    const cls = classifyHistoryEntry(h);
    const typeLbl = HISTORY_TYPE_LABEL[h.type] || h.type || '';
    const at = escapeHtml(fmtHistoryAt(h.at));
    const by = escapeHtml(h.by || '—');
    const planning = h.planning === true ? ' · <span style="color:#9ca3af">был режим настройки</span>' : '';

    if (cls === 'dates') {
      const hasStructured = h.before && h.after && (h.before.planStart || h.before.planEnd || h.after.planStart || h.after.planEnd);
      const datesHtml = hasStructured
        ? buildHistoryDatesCard(h)
        : (h.summary ? `<div style="font-size:12.5px;color:#4b5563;margin-top:2px">${escapeHtml(h.summary)}</div>` : '');
      const reasonHtml = h.reason
        ? `<span class="dh-reason">${escapeHtml(h.reason)}</span>`
        : (h.planning ? '' : '<span class="dh-no-reason">причина не указана</span>');
      return `<div class="drawer-hist-row dh-dates">
        <div class="dh-head">
          <span class="dh-icon">🗓</span>
          <span class="dh-title">Сроки изменены</span>
          <span class="dh-meta"><span class="dh-by">${by}</span> · ${at}${planning}</span>
        </div>
        ${datesHtml}
        ${reasonHtml}
      </div>`;
    }

    if (cls === 'pause') {
      const icon = h.type === 'pause_task' ? '⏸' : h.type === 'resume_task' ? '▶️' : h.type === 'pause_edit' ? '✎' : h.type === 'pause_delete' ? '🗑' : '🟡';
      const titleByType = {
        pause_task:   'Поставлена на паузу',
        resume_task:  'Пауза снята · работа возобновлена',
        pause_edit:   'Пауза изменена',
        pause_delete: 'Пауза удалена'
      };
      const niceTitle = titleByType[h.type] || typeLbl || 'Пауза';
      // Тип паузы (план/факт/оба)
      const dt = h.dateType || h.before?.dateType || h.after?.dateType || h.removed?.dateType || null;
      const dtBadge = dt ? `<div class="dh-subtitle">Тип: <b>${escapeHtml(_pauseTypeLabel(dt))}</b></div>` : '';
      // Период / длительность
      let periodBlock = '';
      if (h.type === 'pause_task' && h.from) {
        const periodStr = h.to
          ? `${escapeHtml(fmtDateShort(h.from))} → ${escapeHtml(fmtDateShort(h.to))}`
          : `с ${escapeHtml(fmtDateShort(h.from))} <span class="muted">(без даты возобновления)</span>`;
        periodBlock = `<div class="dh-dates-block"><div class="dh-row-now"><span class="dh-label">Период:</span><span class="dh-period">${periodStr}</span></div></div>`;
      } else if (h.type === 'resume_task' && h.from && h.to) {
        const days = Math.max(0, Math.round((new Date(h.to) - new Date(h.from)) / 86400000));
        periodBlock = `<div class="dh-dates-block"><div class="dh-row-now"><span class="dh-label">Длилась:</span><span class="dh-period">${days} ${daysWord(days)}</span> <span class="muted">(${escapeHtml(fmtDateShort(h.from))} → ${escapeHtml(fmtDateShort(h.to))})</span></div></div>`;
      } else if (h.type === 'pause_edit' && h.before && h.after) {
        const wasStr = h.before.from ? (h.before.to ? `${fmtDateShort(h.before.from)} → ${fmtDateShort(h.before.to)}` : `с ${fmtDateShort(h.before.from)} (открыта)`) : '—';
        const nowStr = h.after.from ? (h.after.to ? `${fmtDateShort(h.after.from)} → ${fmtDateShort(h.after.to)}` : `с ${fmtDateShort(h.after.from)} (открыта)`) : '—';
        periodBlock = `<div class="dh-dates-block">
          <div class="dh-row-was"><span class="dh-label">Было:</span><span class="dh-period">${escapeHtml(wasStr)}</span></div>
          <div class="dh-row-now"><span class="dh-label">Стало:</span><span class="dh-period">${escapeHtml(nowStr)}</span></div>
        </div>`;
      } else if (h.type === 'pause_delete' && h.removed) {
        const r = h.removed;
        const periodStr = r.from ? (r.to ? `${fmtDateShort(r.from)} → ${fmtDateShort(r.to)}` : `с ${fmtDateShort(r.from)} (открыта)`) : '—';
        periodBlock = `<div class="dh-dates-block"><div class="dh-row-was"><span class="dh-label">Удалена:</span><span class="dh-period">${escapeHtml(periodStr)}</span></div></div>`;
      } else if (h.summary) {
        // Legacy запись без structured data
        periodBlock = `<div style="font-size:12.5px;color:#4b5563;margin-top:4px">${escapeHtml(h.summary)}</div>`;
      }
      const reasonHtml = h.reason ? `<span class="dh-reason">${escapeHtml(h.reason)}</span>` : '';
      return `<div class="drawer-hist-row dh-pause">
        <div class="dh-head">
          <span class="dh-icon">${icon}</span>
          <span class="dh-title">${escapeHtml(niceTitle)}</span>
          <span class="dh-meta"><span class="dh-by">${by}</span> · ${at}</span>
        </div>
        ${dtBadge}
        ${periodBlock}
        ${reasonHtml}
      </div>`;
    }

    if (cls === 'status') {
      const icon = h.type === 'mark_complete' ? '✅' : h.type === 'mark_started' ? '🟢' : '⛔';
      return `<div class="drawer-hist-row dh-status">
        <div class="dh-head">
          <span class="dh-icon">${icon}</span>
          <span class="dh-title">${escapeHtml(typeLbl)}</span>
          <span class="dh-meta"><span class="dh-by">${by}</span> · ${at}</span>
        </div>
        ${h.summary ? `<div style="font-size:12.5px;color:#4b5563">${escapeHtml(h.summary)}</div>` : ''}
      </div>`;
    }

    if (cls === 'progress') {
      return `<div class="drawer-hist-row dh-progress">
        <div class="dh-head">
          <span class="dh-icon">📊</span>
          <span class="dh-title">Прогресс</span>
          <span class="dh-meta"><span class="dh-by">${by}</span> · ${at}</span>
        </div>
        ${h.summary ? `<div style="font-size:12.5px;color:#4b5563">${escapeHtml(h.summary)}</div>` : ''}
      </div>`;
    }

    // minor
    return `<div class="drawer-hist-row dh-minor">
      <span style="font-weight:500">${escapeHtml(typeLbl)}</span>
      ${h.summary ? `· ${escapeHtml(h.summary)}` : ''}
      <span style="float:right">${by} · ${at}</span>
    </div>`;
  }).join('');
  return `
    <details class="drawer-history">
      <summary class="drawer-history-toggle"><span class="drawer-history-ico">🕐</span>История изменений <span class="drawer-history-count">${hist.length}</span></summary>
      <div class="drawer-history-list">${rows}</div>
    </details>`;
}

function buildDrawerPausesHtml(t) {
  const pauses = Array.isArray(t.pauses) ? t.pauses : [];
  if (!pauses.length) return '';
  const todayIso = new Date().toISOString().slice(0, 10);
  const totalDays = pauses.reduce((s, p) => {
    if (!p || !p.from) return s;
    const to = p.to || todayIso;
    const d = Math.max(0, Math.round((new Date(to) - new Date(p.from)) / 86400000));
    return s + d;
  }, 0);
  const openCount = pauses.filter(p => p && !p.to).length;
  const headSuffix = openCount ? ` · <span class="muted">${openCount} активна</span>` : '';
  const rows = pauses.slice().reverse().map(p => {
    if (!p) return '';
    const open = !p.to;
    const to = p.to || todayIso;
    const days = Math.max(0, Math.round((new Date(to) - new Date(p.from)) / 86400000));
    const reason = (p.reason || '').trim() || '— без указания причины';
    const dateRange = open
      ? `с ${fmtDate(p.from)} <span class="muted">(идёт)</span>`
      : `${fmtDate(p.from)} — ${fmtDate(p.to)}`;
    const delBtn = state.editMode
      ? `<button type="button" class="drawer-pause-del" data-pause-del-task="${escapeHtml(t.id)}" data-pause-del-id="${escapeHtml(p.id || '')}" title="Удалить эту запись паузы">✕</button>`
      : '';
    return `<div class="drawer-pause-row${open ? ' open' : ''}">
      <div class="drawer-pause-head">
        <span class="drawer-pause-icon">⏸</span>
        <span class="drawer-pause-dates">${dateRange}</span>
        <span class="drawer-pause-days">${days} дн.</span>
        ${delBtn}
      </div>
      <div class="drawer-pause-reason">${escapeHtml(reason)}</div>
    </div>`;
  }).join('');
  return `
    <div class="drawer-section-title">⏸ История пауз · всего ${totalDays} дн.${headSuffix}</div>
    <div class="drawer-pauses">${rows}</div>`;
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
  const today = effectiveToday();
  // __MAT_DEADLINE_v2__ Дедлайн закупки идёт за актуальной датой старта (факт → план).
  const startISO = t ? (t.actualStart || t.planStart) : null;
  const startDate = startISO ? parseISO(startISO) : null;
  const startValid = startDate && isFinite(startDate.getTime());
  const startedFlag = !!(t && t.actualStart && !t.actualEnd);
  const startInPastFlag = startValid ? (Math.round((startDate - today) / DAY_MS) < 0) : false;

  const riskBanner = !risk ? '' :
    risk.level === 'overdue'
      ? `<div class="materials-risk-banner materials-risk-banner--overdue">🔴 Материал нужен сейчас — работа ${risk.started ? 'уже идёт' : 'по плану должна была начаться'}. Не оформлено: ${risk.riskyCount} из ${risk.totalCount}.</div>`
      : risk.level === 'rush'
      ? `<div class="materials-risk-banner materials-risk-banner--rush">🟠 Заказать срочно — по сроку поставки уже впритык${startValid ? ` (старт ${escapeHtml(fmtDate(toISO(startDate)))})` : ''}. Не оформлено: ${risk.riskyCount} из ${risk.totalCount}.</div>`
      : `<div class="materials-risk-banner">🟡 Заказать до <strong>${escapeHtml(fmtDate(toISO(risk.orderBy)))}</strong> · не оформлено ${risk.riskyCount} из ${risk.totalCount}.</div>`;

  const cards = materials.map((m, idx) => {
    const lead = Math.max(0, Math.min(120, Number(m.leadTime) || 0));
    let orderBy = null;
    let urgency = 'normal'; // 'normal' | 'soon' | 'rush' | 'overdue' | 'ok'
    let footText = '';
    if (startValid) {
      orderBy = new Date(startDate.getTime() - lead * DAY_MS);
      const daysToOrder = Math.round((orderBy - today) / DAY_MS);
      if (m.ordered) { urgency = 'ok'; footText = '✓ заказано'; }
      else if (startedFlag || startInPastFlag) { urgency = 'overdue'; footText = `🔴 нужен сейчас — работа ${startedFlag ? 'уже идёт' : 'должна была начаться'}`; }
      else if (daysToOrder < 0) { urgency = 'rush'; footText = `🟠 заказать срочно · поставка ${lead} дн, старт ${escapeHtml(fmtDate(toISO(startDate)))}`; }
      else if (daysToOrder <= 3) { urgency = 'soon'; footText = `🟡 заказать до ${escapeHtml(fmtDate(toISO(orderBy)))} (через ${daysToOrder} дн)`; }
      else { footText = `заказать до ${escapeHtml(fmtDate(toISO(orderBy)))}`; }
    }
    if (m.ordered) { urgency = 'ok'; footText = '✓ заказано'; }
    const aiBadge = m.isAi ? '<span class="mat-card-ai" title="Подсказано ИИ">AI</span>' : '';
    const orderByStr = footText
      ? `<span class="mat-card-orderby">${footText}</span>`
      : '';
    const rationale = m.rationale ? `<div class="mat-card-rationale">${escapeHtml(m.rationale)}</div>` : '';
    const presets = [3, 7, 14, 21, 30];
    const presetBtns = presets.map(d =>
      `<button type="button" class="mat-card-preset${lead === d ? ' is-active' : ''}" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}" data-preset="${d}">${d}</button>`
    ).join('');
    const qtyVal = (m.quantity != null && m.quantity !== '') ? m.quantity : '';
    const unitOpts = MATERIAL_UNITS.map(u => `<option value="${escapeHtml(u.id)}"${(m.unit || '') === u.id ? ' selected' : ''}>${escapeHtml(u.label)}</option>`).join('');
    return `
      <div class="mat-card mat-card--${urgency}${m.ordered ? ' is-ordered' : ''}" data-row-idx="${idx}">
        <div class="mat-card-head">
          <input type="text" class="mat-card-name material-name-input" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}" value="${escapeHtml(m.name || '')}" placeholder="Название материала" />
          ${aiBadge}
          <button type="button" class="mat-card-del material-row-del" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}" aria-label="Удалить">×</button>
        </div>
        ${rationale}
        <div class="mat-card-qty">
          <span class="mat-card-qty-label">Объём:</span>
          <input type="number" min="0" step="0.01" class="mat-card-qty-input material-qty-input" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}" value="${qtyVal}" placeholder="0" />
          <select class="mat-card-unit-select material-unit-select" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}">${unitOpts}</select>
        </div>
        <div class="mat-card-controls">
          <label class="mat-card-status">
            <input type="checkbox" class="material-ordered-input" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}"${m.ordered ? ' checked' : ''} />
            <span class="mat-card-status-text">${m.ordered ? '✓ Заказано' : 'Не заказано'}</span>
          </label>
          <div class="mat-card-lead">
            <span class="mat-card-lead-label">Срок поставки:</span>
            <div class="mat-card-presets">${presetBtns}</div>
            <input type="number" min="0" max="120" class="mat-card-lead-input material-leadtime-input" data-task-id="${escapeHtml(tid)}" data-row-idx="${idx}" value="${lead}" />
            <span class="mat-card-lead-suffix">дн.</span>
          </div>
        </div>
        ${orderByStr ? `<div class="mat-card-foot">${orderByStr}</div>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="drawer-section-title">Материалы</div>
    <div class="materials-block" data-task-id="${escapeHtml(tid)}">
      ${riskBanner}
      <div class="materials-rows" id="materials-rows-${escapeHtml(tid)}">${cards || '<div class="materials-empty">Материалы не указаны. Нажмите «Подсказать ИИ» или добавьте вручную.</div>'}</div>
      <div class="materials-actions">
        <button type="button" class="material-add-btn" data-task-id="${escapeHtml(tid)}">+ Добавить материал</button>
        <button type="button" class="material-ai-btn" data-task-id="${escapeHtml(tid)}" title="Подсказать материалы для этой работы через ИИ">
          <span aria-hidden="true">✨</span> Подсказать ИИ
        </button>
      </div>
    </div>`;
}

function attachResourceMaterialHandlers(taskId) {
  attachResourceHandlers(taskId);
  attachMaterialHandlers(taskId);
}

function attachResourceHandlers(taskId) {
  const tid = String(taskId);
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
}

function attachMaterialHandlers(taskId) {
  const tid = String(taskId);
  document.querySelectorAll(`.material-name-input[data-task-id="${tid}"]`).forEach((inp) => {
    inp.addEventListener('change', () => mutateMaterial(tid, Number(inp.dataset.rowIdx), { name: inp.value }));
  });
  document.querySelectorAll(`.material-qty-input[data-task-id="${tid}"]`).forEach((inp) => {
    inp.addEventListener('change', () => {
      const v = inp.value === '' ? null : Number(inp.value);
      mutateMaterial(tid, Number(inp.dataset.rowIdx), { quantity: v });
    });
  });
  document.querySelectorAll(`.material-unit-select[data-task-id="${tid}"]`).forEach((sel) => {
    sel.addEventListener('change', () => mutateMaterial(tid, Number(sel.dataset.rowIdx), { unit: sel.value }));
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
    const arr = [...getTaskMaterials(tid), { name: '', leadTime: 7, ordered: false, expectedDate: '', note: '', quantity: null, unit: '' }];
    setTaskMaterials(tid, arr);
    reRenderMaterials(tid);
  });
  // Lead-time presets
  document.querySelectorAll(`.mat-card-preset[data-task-id="${tid}"]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.rowIdx);
      const preset = Number(btn.dataset.preset);
      mutateMaterial(tid, idx, { leadTime: preset });
      reRenderMaterials(tid);
    });
  });
  // AI suggest button — calls /api/matsinfer for this task
  const aiBtn = document.querySelector(`.material-ai-btn[data-task-id="${tid}"]`);
  if (aiBtn) {
    aiBtn.addEventListener('click', async () => {
      if (aiBtn.disabled) return;
      aiBtn.disabled = true;
      const orig = aiBtn.innerHTML;
      aiBtn.innerHTML = '<span aria-hidden="true">⏳</span> ИИ думает…';
      try {
        const r = await fetch('/api/matsinfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: state.projectSlug, scope: 'taskId', taskId: tid })
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        const suggested = (j.byTask && j.byTask[tid]) || [];
        if (!suggested.length) {
          alert('ИИ не предложил материалов для этой работы (возможно, материалы не нужны).');
          aiBtn.disabled = false;
          aiBtn.innerHTML = orig;
          return;
        }
        // Merge with existing manual entries (don't overwrite manual ones)
        const existing = getTaskMaterials(tid);
        const existingNames = new Set(existing.map(m => (m.name || '').trim().toLowerCase()));
        const merged = [...existing];
        for (const s of suggested) {
          if (!existingNames.has((s.name || '').trim().toLowerCase())) merged.push(s);
        }
        setTaskMaterials(tid, merged);
        reRenderMaterials(tid);
      } catch (e) {
        alert('Не удалось получить подсказки: ' + (e.message || e));
        aiBtn.disabled = false;
        aiBtn.innerHTML = orig;
      }
    });
  }
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
  // Перевешиваем handler'ы только на ресурсы — иначе на material-add-btn (он
  // не пересоздаётся) каждый рендер навешивается ещё один listener, и клик
  // «+ Добавить материал» начинает добавлять по 2+ материала за раз.
  attachResourceHandlers(taskId);
}
function reRenderMaterials(taskId) {
  const cont = document.querySelector(`.materials-block[data-task-id="${taskId}"]`);
  if (!cont) return;
  cont.outerHTML = buildDrawerMaterialsHtml(taskId).replace(/^\s*<div class="drawer-section-title">[^<]+<\/div>\s*/, '');
  attachMaterialHandlers(taskId);
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
      <button class="ticket-add-btn" data-task-id="${tid}" title="Создать новый тикет по этой работе">
        <span class="ticket-add-btn-ico" aria-hidden="true">+</span>
        <span class="ticket-add-btn-lbl">Новый тикет</span>
        <span class="ticket-add-btn-arrow" aria-hidden="true">→</span>
      </button>
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
      body: JSON.stringify({ subject, description: descEl?.value.trim() || '', taskId: String(taskId), dueDate, photos, projectSlug: state.projectSlug })
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
  const isHeic = /heic|heif/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || '');
  const heicMsg = 'HEIC-фото не поддерживается. В настройках iPhone: Камера → Форматы → «Наиболее совместимый» (JPEG)';

  // Hard cap: iOS Safari can silently hang decoding huge images. Fail loudly instead of freezing UI.
  const withTimeout = (promise, ms, msg) => Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms)),
  ]);

  // 1) Native path: createImageBitmap directly from File — no data-url, no FileReader, off-main-thread on iOS 15+.
  let bitmap = null;
  if (typeof createImageBitmap === 'function') {
    try {
      bitmap = await withTimeout(
        createImageBitmap(file),
        30000,
        isHeic ? heicMsg : 'Декодирование фото заняло слишком долго'
      );
    } catch (e) {
      // Fall through to <img> path; rethrow only if it's our timeout.
      if (/слишком долго/.test(e.message) || /HEIC/.test(e.message)) throw e;
      bitmap = null;
    }
  }

  // 2) Fallback: blob URL → <img>. Uses object URL (cheap) instead of data URL (heavy).
  let img = null;
  let objectUrl = null;
  if (!bitmap) {
    objectUrl = URL.createObjectURL(file);
    try {
      img = await withTimeout(new Promise((res, rej) => {
        const el = new Image();
        el.onload  = () => res(el);
        el.onerror = () => rej(new Error(isHeic ? heicMsg : 'Не удалось открыть изображение'));
        el.src = objectUrl;
      }), 30000, isHeic ? heicMsg : 'Декодирование фото заняло слишком долго');
    } catch (e) {
      URL.revokeObjectURL(objectUrl);
      throw e;
    }
  }

  try {
    const width  = bitmap ? bitmap.width  : img.naturalWidth  || img.width;
    const height = bitmap ? bitmap.height : img.naturalHeight || img.height;
    if (!width || !height) throw new Error('Изображение пустое или повреждено');

    const scale = Math.min(1, maxDim / Math.max(width, height));
    const w = Math.max(1, Math.round(width  * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap || img, 0, 0, w, h);

    const jpegDataUri = canvas.toDataURL('image/jpeg', quality);
    if (!jpegDataUri || jpegDataUri.length < 100) {
      throw new Error('Не удалось закодировать в JPEG (фото слишком большое для этого устройства)');
    }
    return {
      data: jpegDataUri.split(',')[1],
      mimeType: 'image/jpeg',
      name: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg'
    };
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
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
    // html2canvas-pro поддерживает color-mix(), oklch и другие современные CSS color functions.
    // Оригинальный html2canvas 1.4.1 на них падает.
    load('https://cdn.jsdelivr.net/npm/html2canvas-pro@1.5.8/dist/html2canvas-pro.min.js')
  ]).then(() => {
    // html2canvas-pro экспортирует window.html2canvas — совместимо со старым кодом
    if (!window.html2canvas) throw new Error('html2canvas not available after load');
  });
  return pdfLibsPromise;
}

/* ─── Печать графика ───
   Рендерим Gantt + Hero в одну большую картинку через html2canvas, временно прячем
   живой DOM, подставляем картинку — и вызываем window.print(). Юзер получает родной
   диалог браузера с опциями «Сохранить PDF» / «Печатать», а вывод выглядит точно как
   на экране (без поехавшего layout). После закрытия диалога возвращаем DOM как был. */
async function printGanttAsImage() {
  const btn = document.getElementById('btn-print');
  const orig = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span aria-hidden="true">⏳</span> Готовлю…'; }
  if (!state.schedule) { if (btn) { btn.disabled = false; btn.innerHTML = orig; } return; }

  document.body.classList.add('is-pdf-export');
  const cleanup = [];
  try {
    await loadPdfLibs();
    if (!window.html2canvas) throw new Error('html2canvas не загрузился');

    // Render at print-friendly cellW. A4 landscape usable ≈ 1047×718px (10mm margins).
    // Reserve label column 220px → days fill 827px. Pick cellW so gantt fits in width budget.
    const totalDays = state.layout.totalDays || 120;
    const PRINT_LABEL_W = 220;
    const PAGE_W_PX = 1047;
    // Width budget: label + days. Compute cellW so totalGanttWidth ≤ PAGE_W_PX (single column).
    const cellWFitOne = Math.floor((PAGE_W_PX - PRINT_LABEL_W) / totalDays);
    const printCellW = Math.max(4, Math.min(22, cellWFitOne));
    const savedCellW = state.cellW;
    state.cellW = printCellW;

    const style = document.createElement('style');
    style.textContent = `
      body.is-pdf-export .gantt-wrap { max-height: none !important; height: auto !important; overflow: visible !important; }
      body.is-pdf-export .gantt { max-height: none !important; overflow: visible !important; }
      body.is-pdf-export .gantt-overlays { display: none !important; }
      body.is-pdf-export .task-open-btn { display: none !important; }
      body.is-pdf-export .task-label, body.is-pdf-export .corner, body.is-pdf-export .dates-header, body.is-pdf-export .section-label { position: static !important; }
      body.is-pdf-export .hero-title {
        background: none !important;
        -webkit-background-clip: initial !important;
        background-clip: initial !important;
        -webkit-text-fill-color: initial !important;
        color: var(--ink) !important;
      }
    `;
    document.head.appendChild(style); cleanup.push(() => style.remove());
    renderGantt();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const heroEl = document.querySelector('.hero');
    const analyticsEl = document.querySelector('.project-analytics');
    const ganttEl = document.getElementById('gantt');
    if (!ganttEl) throw new Error('gantt not found');

    // Hero+analytics off-screen container
    const topWrap = document.createElement('div');
    topWrap.style.cssText = `position:fixed; left:-9999px; top:0; width:${PAGE_W_PX}px; background:#fff; padding:14px 16px; box-sizing:border-box;`;
    if (heroEl) topWrap.appendChild(heroEl.cloneNode(true));
    if (analyticsEl) topWrap.appendChild(analyticsEl.cloneNode(true));
    document.body.appendChild(topWrap);
    const topCanvas = await window.html2canvas(topWrap, { scale: 1.5, backgroundColor: '#ffffff', useCORS: true, logging: false });
    topWrap.remove();

    const ganttCanvas = await window.html2canvas(ganttEl, {
      scale: 1.5,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: ganttEl.scrollWidth,
      windowHeight: ganttEl.scrollHeight,
      width: ganttEl.scrollWidth,
      height: ganttEl.scrollHeight
    });

    // Convert to blob URL — браузер хорошо переваривает blob:URL для печати,
    // в отличие от мегабайтных data:URL'ов.
    const toBlobUrl = (canvas) => new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (!b) return reject(new Error('toBlob returned null'));
        resolve(URL.createObjectURL(b));
      }, 'image/jpeg', 0.85);
    });
    const topUrl = await toBlobUrl(topCanvas);
    const ganttUrl = await toBlobUrl(ganttCanvas);
    cleanup.push(() => { try { URL.revokeObjectURL(topUrl); URL.revokeObjectURL(ganttUrl); } catch(_) {} });

    // Inline images sized to A4 landscape printable width.
    // Use mm units so browser scales correctly and won't paint blank.
    const printRoot = document.createElement('div');
    printRoot.id = 'print-root';
    const topImg = new Image();
    topImg.src = topUrl;
    topImg.className = 'print-top';
    const ganttImg = new Image();
    ganttImg.src = ganttUrl;
    ganttImg.className = 'print-gantt';
    printRoot.appendChild(topImg);
    printRoot.appendChild(ganttImg);
    document.body.appendChild(printRoot);
    cleanup.push(() => printRoot.remove());

    // Wait for both images to decode before printing
    await Promise.all([
      topImg.decode().catch(() => {}),
      ganttImg.decode().catch(() => {})
    ]);

    const printStyle = document.createElement('style');
    printStyle.id = 'print-image-style';
    printStyle.textContent = `
      @media screen {
        #print-root { display: none; }
      }
      @media print {
        @page { size: A4 landscape; margin: 8mm; }
        html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
        body > *:not(#print-root) { display: none !important; }
        #print-root { display: block !important; }
        #print-root img {
          display: block;
          width: 100%;
          height: auto;
          max-width: 100%;
        }
        #print-root img.print-top { margin-bottom: 6mm; }
        /* Allow gantt image to break across pages naturally */
        #print-root img.print-gantt { page-break-inside: auto; break-inside: auto; }
      }
    `;
    document.head.appendChild(printStyle); cleanup.push(() => printStyle.remove());

    // Restore live UI now that snapshot is done
    state.cellW = savedCellW;
    renderGantt();

    // Small delay before print() so images settle in DOM
    await new Promise(r => setTimeout(r, 200));
    window.print();
  } catch (e) {
    console.error('Print prep failed', e);
    alert('Не удалось подготовить печать: ' + (e.message || e));
  } finally {
    setTimeout(() => {
      cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      document.body.classList.remove('is-pdf-export');
      if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }, 2500);
  }
}

/* ─── Gantt → PDF export (точное совпадение с экраном) ───
   Альтернатива браузерной печати. Захватывает hero+аналитику и сам Gantt в canvas,
   нарезает по A4 landscape. Label-колонка повторяется на каждой странице, чтобы было
   видно к какой работе относится каждая полоса. */
async function exportGanttToPdf() {
  const btn = document.getElementById('btn-print');
  const orig = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span aria-hidden="true">⏳</span> PDF…'; }
  const sched = state.schedule;
  if (!sched) { if (btn) { btn.disabled = false; btn.innerHTML = orig; } return; }

  // Save UI state
  const savedCellW = state.cellW;
  const savedScroll = { x: 0, y: 0 };
  const wrap = document.querySelector('.gantt-wrap');
  if (wrap) { savedScroll.x = wrap.scrollLeft; savedScroll.y = wrap.scrollTop; }

  document.body.classList.add('is-pdf-export');

  try {
    await loadPdfLibs();
    const { jsPDF } = window.jspdf;
    if (!jsPDF || !window.html2canvas) throw new Error('PDF-библиотеки не загрузились');

    // Render Gantt at print-optimised cellW so width-per-day fits comfortably on one page.
    // A4 landscape: 297mm × 210mm. Margins 10mm → usable 277×190 mm = 1047×718 px @ 96dpi.
    // Reserve label column 260px → 787px for days. Pick cellW so totalDays × cellW ≤ N×787 (N pages horizontally).
    const totalDays = state.layout.totalDays || 120;
    const PRINT_LABEL_W = 220;
    const PAGE_W_PX = 1047; // A4 landscape
    const PAGE_H_PX = 718;
    const GRID_W_PX = PAGE_W_PX - PRINT_LABEL_W;
    // Try to fit width on 1 page. If grid would be too narrow per day (<10), allow horizontal split.
    const fitOnePageCell = GRID_W_PX / totalDays;
    let printCellW;
    let pagesH;
    if (fitOnePageCell >= 10) {
      printCellW = Math.min(28, fitOnePageCell);
      pagesH = 1;
    } else {
      printCellW = 14; // readable
      pagesH = Math.ceil((totalDays * printCellW) / GRID_W_PX);
    }

    // Save current label width and override for export.
    state.cellW = printCellW;
    // Inject a CSS override to widen label column for the export
    const styleEl = document.createElement('style');
    styleEl.id = 'pdf-export-style';
    styleEl.textContent = `
      body.is-pdf-export .gantt-wrap { max-height: none !important; height: auto !important; overflow: visible !important; }
      body.is-pdf-export .gantt { max-height: none !important; overflow: visible !important; }
      body.is-pdf-export .gantt-overlays { display: none !important; }
      body.is-pdf-export .task-open-btn { display: none !important; }
      body.is-pdf-export .task-label, body.is-pdf-export .corner, body.is-pdf-export .dates-header, body.is-pdf-export .section-label { position: static !important; }
      /* Fix gradient text-fill rendering issues in html2canvas */
      body.is-pdf-export .hero-title {
        background: none !important;
        -webkit-background-clip: initial !important;
        background-clip: initial !important;
        -webkit-text-fill-color: initial !important;
        color: var(--ink) !important;
      }
    `;
    document.head.appendChild(styleEl);
    renderGantt();
    // Wait for layout to settle
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const ganttEl = document.getElementById('gantt');
    if (!ganttEl) throw new Error('gantt element not found');

    // Capture the entire gantt at native (rendered) size, with high DPI
    const canvas = await window.html2canvas(ganttEl, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: ganttEl.scrollWidth,
      windowHeight: ganttEl.scrollHeight,
      width: ganttEl.scrollWidth,
      height: ganttEl.scrollHeight
    });

    // Also capture hero + analytics for cover page
    const heroEl = document.querySelector('.hero');
    const analyticsEl = document.querySelector('.project-analytics');
    const coverWrap = document.createElement('div');
    coverWrap.style.cssText = `position:fixed; left:-9999px; top:0; width:${PAGE_W_PX}px; background:#fff; padding:20px; box-sizing:border-box;`;
    if (heroEl) coverWrap.appendChild(heroEl.cloneNode(true));
    if (analyticsEl) coverWrap.appendChild(analyticsEl.cloneNode(true));
    document.body.appendChild(coverWrap);
    const coverCanvas = await window.html2canvas(coverWrap, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false
    });
    coverWrap.remove();

    // Build PDF (A4 landscape, mm units)
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });
    const PAGE_W_MM = 297, PAGE_H_MM = 210, MARGIN = 10;
    const USABLE_W_MM = PAGE_W_MM - MARGIN * 2;
    const USABLE_H_MM = PAGE_H_MM - MARGIN * 2;

    // ─── Cover page: hero + analytics
    {
      const ratio = coverCanvas.width / coverCanvas.height;
      const w = USABLE_W_MM;
      const h = w / ratio;
      const finalH = Math.min(h, USABLE_H_MM);
      const finalW = finalH < h ? finalH * ratio : w;
      const url = coverCanvas.toDataURL('image/jpeg', 0.92);
      doc.addImage(url, 'JPEG', MARGIN + (USABLE_W_MM - finalW) / 2, MARGIN, finalW, finalH);
    }

    // ─── Gantt pages
    // The captured canvas has full width. We need to slice it horizontally if needed.
    // canvas.width is in CSS-px × scale (= 2). Convert mm ↔ canvas-px:
    //   mmPerPx = USABLE_W_MM / canvas.width  (for full-width fit)
    // We want labelColW (220 CSS-px = 440 canvas-px @ scale=2) shown on each page.
    const SCALE = 2;
    const labelColPx = PRINT_LABEL_W * SCALE;
    const cwTotal = canvas.width;
    const chTotal = canvas.height;

    // Compute mm per canvas-px: we want each page to show label + slice such that
    // label width in mm + slice width in mm = USABLE_W_MM.
    // We choose mm-per-px such that one full slice fits a page.
    const slicePxAvail = cwTotal - labelColPx;
    const sliceWidthPxPerPage = Math.ceil(slicePxAvail / pagesH);
    const totalPxPerPage = labelColPx + sliceWidthPxPerPage;
    const mmPerPx = USABLE_W_MM / totalPxPerPage; // both label and slice scale to fit page width
    const pageRowsHeightMm = USABLE_H_MM;
    const pageRowsHeightPx = Math.ceil(pageRowsHeightMm / mmPerPx);
    const verticalPages = Math.ceil(chTotal / pageRowsHeightPx);

    // Pre-extract label strip canvas (entire height, only labelColPx wide)
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = labelColPx;
    labelCanvas.height = chTotal;
    labelCanvas.getContext('2d').drawImage(canvas, 0, 0, labelColPx, chTotal, 0, 0, labelColPx, chTotal);

    for (let v = 0; v < verticalPages; v++) {
      const sy = v * pageRowsHeightPx;
      const sliceH = Math.min(pageRowsHeightPx, chTotal - sy);
      for (let h = 0; h < pagesH; h++) {
        doc.addPage();
        // Composite: label column + grid slice
        const composite = document.createElement('canvas');
        composite.width = totalPxPerPage;
        composite.height = sliceH;
        const ctx = composite.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, composite.width, composite.height);
        // label
        ctx.drawImage(labelCanvas, 0, sy, labelColPx, sliceH, 0, 0, labelColPx, sliceH);
        // grid slice
        const gridSx = labelColPx + h * sliceWidthPxPerPage;
        const gridSw = Math.min(sliceWidthPxPerPage, cwTotal - gridSx);
        ctx.drawImage(canvas, gridSx, sy, gridSw, sliceH, labelColPx, 0, gridSw, sliceH);
        const url = composite.toDataURL('image/jpeg', 0.92);
        const finalH = sliceH * mmPerPx;
        doc.addImage(url, 'JPEG', MARGIN, MARGIN, USABLE_W_MM, finalH);
        // Footer: project + page indicator. ASCII-only to avoid jsPDF default font cyrillic issues.
        const totalPages = 1 + verticalPages * pagesH;
        const curPage = 1 + v * pagesH + h + 1;
        const projName = (sched.project?.name || '').replace(/[^\x20-\x7E]/g, '').trim();
        doc.setFontSize(8); doc.setTextColor(120);
        doc.text(`${projName ? projName + ' · ' : ''}page ${curPage} / ${totalPages}`,
          MARGIN, PAGE_H_MM - 4);
      }
    }

    // Filename
    const slug = (sched.project?.slug || 'project');
    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`gantt-${slug}-${dateStr}.pdf`);
  } catch (e) {
    console.error('PDF export failed', e);
    alert('Не удалось сохранить PDF: ' + (e.message || e));
  } finally {
    document.body.classList.remove('is-pdf-export');
    document.getElementById('pdf-export-style')?.remove();
    state.cellW = savedCellW;
    renderGantt();
    if (wrap) { wrap.scrollLeft = savedScroll.x; wrap.scrollTop = savedScroll.y; }
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
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

// Cache fetched photo dataURLs across the session — keeps user gesture alive on share()
const ticketPhotoCache = new Map(); // url → dataUrl | null | Promise<dataUrl|null>
function getCachedPhoto(url) {
  if (!url) return Promise.resolve(null);
  const hit = ticketPhotoCache.get(url);
  if (hit !== undefined) return hit instanceof Promise ? hit : Promise.resolve(hit);
  const p = imageUrlToDataUrl(url).then((du) => {
    ticketPhotoCache.set(url, du);
    return du;
  }).catch(() => {
    ticketPhotoCache.set(url, null);
    return null;
  });
  ticketPhotoCache.set(url, p);
  return p;
}
// Fire-and-forget prefetch for a set of tickets
function prefetchTicketPhotos(tickets) {
  for (const tk of (tickets || [])) {
    for (const p of (tk.photos || [])) {
      if (p?.url && !ticketPhotoCache.has(p.url)) getCachedPhoto(p.url);
    }
  }
}

function buildTicketPageHtml(tk, task, project) {
  const STATUS_ICO = { open:'🟠', in_review:'🔵', in_progress:'🟣', deferred:'⚪️', resolved:'🟢', rejected:'⚫️' };
  const descClean = (tk.description || '').replace(/\[task:\w+\]/gi, '').replace(/\[slug:[\w-]+\]/gi, '').replace(/\s+$/g, '').trim();
  const titleClean = (tk.title || '').replace(/\[task:\w+\]/gi, '').replace(/\[slug:[\w-]+\]/gi, '').trim() || tk.title || '';
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
    // Photos: read from cache (prefetch started when user entered selection mode).
    // Any miss is fetched here, but cache hits are instant — keeps the user-gesture window short.
    setLoading(true, `Фото 0/${tickets.length}…`);
    for (let i = 0; i < tickets.length; i++) {
      setLoading(true, `Фото ${i + 1}/${tickets.length}…`);
      const t = tickets[i];
      t.photoDataUrls = [];
      const photos = Array.isArray(t.photos) ? t.photos : [];
      // Fetch all photos for this ticket in parallel
      const results = await Promise.all(photos.map((p) => getCachedPhoto(p?.url)));
      for (const du of results) if (du) t.photoDataUrls.push(du);
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

    setLoading(true, 'Открываю выбор приложения…');
    const fileOnly = { files: [file] };
    let shared = false, canceled = false, shareError = null;
    if (navigator.canShare && navigator.canShare(fileOnly)) {
      try {
        await navigator.share(fileOnly);
        shared = true;
      } catch (e) {
        if (e?.name === 'AbortError') canceled = true;
        else shareError = e;
      }
    } else {
      // No Web Share API (desktop browsers usually) — download directly
      downloadBlob(blob, fname);
      shared = true;
    }

    if (shared) {
      vs.selectionMode = false;
      vs.selectedIds = new Set();
      refreshTicketsSection(taskId);
      return;
    }

    // Не сбрасываем выбор: пользователь либо отменил, либо iOS подавила share
    // (потерянный user-gesture после долгой подготовки). Кнопка превращается в
    // «Отправить PDF» с готовым blob — следующий клик вызывает share() синхронно.
    setLoading(false);
    if (triggerBtn) {
      triggerBtn.classList.add('tickets-action-share--ready');
      const lbl = triggerBtn.querySelector('.tickets-action-share-lbl');
      if (lbl) lbl.textContent = canceled ? 'Отправить ещё раз' : 'Отправить PDF';
      const handler = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).then(() => {
            vs.selectionMode = false;
            vs.selectedIds = new Set();
            refreshTicketsSection(taskId);
          }).catch((e) => {
            if (e?.name !== 'AbortError') {
              downloadBlob(blob, fname);
            }
          });
        } else {
          downloadBlob(blob, fname);
        }
      };
      // Replace previous click handler with synchronous share-only handler
      const fresh = triggerBtn.cloneNode(true);
      triggerBtn.replaceWith(fresh);
      fresh.addEventListener('click', handler);
    }
    if (shareError) console.warn('share failed:', shareError.message || shareError);
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

/* ─── Ticket assignee picker (multi-select) ─── */
// Динамический список из Airtable Users. Делится на две группы:
//   • management — admin/foreman/owner/creator/pm (получают пинги, видны и доступны для назначения).
//   • workers    — role='worker' (НЕ получают уведомления; нужны только для фиксации ответственного).
// До первой загрузки используется fallback. После loadAssignees() — реальный список.
const _MGMT_ASSIGNEE_ROLES = new Set(['creator', 'owner', 'admin', 'foreman', 'pm']);
const _WORKER_ASSIGNEE_ROLES = new Set(['worker']);
// __PER_PROJECT_TEAM_v1__ роли которые управляются per-проект (а не глобально):
const _PER_PROJECT_ROLES_FRONTEND = new Set(['foreman', 'worker']);
let ASSIGNEES_BY_GROUP = { management: ['Александр', 'Андрей', 'Антон П.', 'Антон М.'], workers: [] };
let ASSIGNEES = [...ASSIGNEES_BY_GROUP.management, ...ASSIGNEES_BY_GROUP.workers];

async function loadAssignees() {
  try {
    const slug = state.projectSlug || '';
    // __PER_PROJECT_TEAM_v1__ team:list со slug возвращает activeInProject (per-slug флаг).
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'team:list', payload: { slug } })
    });
    const d = await r.json();
    const all = (d?.result?.users || d?.users || []).filter(Boolean);
    // Используем activeInProject (есть в новом API). Если undefined (старый ответ) — fallback на active+allowedProjects.
    const isAvailableForProject = (u) => {
      if (typeof u.activeInProject === 'boolean') return u.activeInProject;
      // legacy fallback
      const allowed = Array.isArray(u.allowedProjects) ? u.allowedProjects : [];
      const baseActive = u.active !== false;
      if (!baseActive) return false;
      // foreman/worker без allowedProjects = «не привязан ни к одному проекту»
      if (_PER_PROJECT_ROLES_FRONTEND.has(u.role) && !allowed.length) return false;
      if (!allowed.length) return true;
      return allowed.map(s => String(s).toLowerCase()).includes(String(slug).toLowerCase());
    };
    const pickNames = (predicate) => all
      .filter(u => predicate(u) && isAvailableForProject(u))
      .map(u => String(u.name || '').trim())
      .filter(Boolean);
    const mgmt = pickNames(u => _MGMT_ASSIGNEE_ROLES.has(u.role));
    // Рабочие — теперь ТОЖЕ фильтруются per-project, а не глобально.
    const workers = pickNames(u => _WORKER_ASSIGNEE_ROLES.has(u.role));
    const flat = [...mgmt, ...workers];
    if (flat.length) {
      const prev = ASSIGNEES.join('|');
      ASSIGNEES_BY_GROUP = { management: mgmt, workers };
      ASSIGNEES = flat;
      return prev !== flat.join('|');
    }
  } catch (e) {
    console.warn('loadAssignees failed', e);
  }
  return false;
}

// Перечитывает список ответственных в фоне, и если он изменился — перерисовывает
// секцию тикетов в открытом drawer'е (чтобы свежедобавленный foreman сразу появился в чипах).
async function refreshAssigneesAndMaybeRerender(taskId) {
  const changed = await loadAssignees();
  if (!changed) return;
  const drawer = document.getElementById('drawer');
  if (!drawer || drawer.getAttribute('aria-hidden') === 'true') return;
  const ticketsContainer = drawer.querySelector('[data-drawer-tickets]') || drawer.querySelector('.drawer-tickets');
  if (ticketsContainer) {
    const tmp = document.createElement('div');
    tmp.innerHTML = buildDrawerTicketsHtml(taskId);
    ticketsContainer.replaceWith(tmp.firstElementChild || tmp);
  }
}

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
  // __FOREMAN_BILINGUAL_v1__ Передаём subject/desc/due/taskName в API чтобы оно могло отправить
  // двуязычное (RU + UZ) уведомление бригадиру с полным контекстом, а не сухое «тебе назначили».
  const t = state.tickets?.find(x => x.id === ticketId);
  const taskName = t ? (state.schedule?.tasks?.find(tk => String(tk.id) === String(t.task_id))?.name || '') : '';
  postDataAction('assignees:set', {
    ticketId, slug: state.projectSlug, names: list,
    ticketSubject: t?.title || t?.subject || '',
    ticketDueDate: String(t?.due_date || t?.dueDate || '').slice(0, 10),
    ticketDescription: t?.description || '',
    taskName
  }).then(r => {
    // __NO_TG_WARNING_v1__ Если кому-то не дошло из-за отсутствия TG ID — предупредим
    if (r?.skippedNoTG?.length) {
      try { showToast('⚠️ TG ID не задан у: ' + r.skippedNoTG.join(', ') + ' — уведомление не отправлено', 'warn'); } catch(_) {}
    }
  }).catch((e) => console.warn('assignees:set failed', e));
}

function buildAssigneePickerHtml(ticketId) {
  const selected = new Set(getTicketAssignees(ticketId));
  const renderPill = (name) => {
    const isSel = selected.has(name);
    return `<button type="button" class="assignee-pill${isSel ? ' assignee-pill--selected' : ''}" data-name="${escapeHtml(name)}" data-ticket-id="${escapeHtml(ticketId)}" aria-pressed="${isSel ? 'true' : 'false'}">
      <span class="assignee-pill-dot" aria-hidden="true"></span>
      <span class="assignee-pill-name">${escapeHtml(name)}</span>
    </button>`;
  };
  const mgmt = ASSIGNEES_BY_GROUP.management || [];
  const workers = ASSIGNEES_BY_GROUP.workers || [];
  const mgmtSection = mgmt.length
    ? `<div class="assignee-section">
         <div class="assignee-section-title">🧑‍💼 Менеджмент <span class="assignee-section-meta">получают уведомления</span></div>
         <div class="assignee-zone">${mgmt.map(renderPill).join('')}</div>
       </div>`
    : '';
  const workersSection = workers.length
    ? `<div class="assignee-section">
         <div class="assignee-section-title">👷 Рабочие <span class="assignee-section-meta">только для фиксации, без пингов</span></div>
         <div class="assignee-zone">${workers.map(renderPill).join('')}</div>
       </div>`
    : `<div class="assignee-section assignee-section--empty">
         <div class="assignee-section-title">👷 Рабочие</div>
         <div class="assignee-empty-hint">Список пуст. Открой <b>«Команда» → вкладка «Рабочие»</b> и добавь людей.</div>
       </div>`;
  const total = mgmt.length + workers.length;
  const hintText = selected.size
    ? `Выбрано: ${selected.size} из ${total}`
    : 'Можно выбрать несколько — рабочим уведомления не приходят, бригадирам приходят.';
  return `<div class="assignee-block assignee-block--multi assignee-block--grouped" data-ticket-id="${escapeHtml(ticketId)}">
    ${mgmtSection}
    ${workersSection}
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
    const total = (ASSIGNEES_BY_GROUP.management || []).length + (ASSIGNEES_BY_GROUP.workers || []).length;
    hint.textContent = current.size
      ? `Выбрано: ${current.size} из ${total}`
      : 'Можно выбрать несколько — рабочим уведомления не приходят, бригадирам приходят.';
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
  // __SLUG_TAG_HIDE_v1__ Чистим внутренние теги [slug:...] и [task:...] чтобы юзер не видел и случайно не стёр.
  const descClean    = (tk.description || '').replace(/\[task:\w+\]/gi, '').replace(/\[slug:[\w-]+\]/gi, '').replace(/\s+$/g, '').trim();
  const subjectClean = (tk.title || '').replace(/\[task:\w+\]/gi, '').replace(/\[slug:[\w-]+\]/gi, '').trim();
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
    const tk = state.tickets.find((t) => t.id === ticketId);
    const existing = (tk?.photos || []).length;
    const staged = (editModalPhotoStore[ticketId] || []).length;
    const room = 5 - existing - staged;
    if (room <= 0) { alert('У тикета уже 5 фото — это максимум.'); e.target.value = ''; return; }
    const accepted = files.slice(0, room);
    if (files.length > room) alert(`Можно добавить ещё только ${room} фото (максимум 5 на тикет).`);
    editModalPhotoStore[ticketId] = [...(editModalPhotoStore[ticketId] || []), ...accepted];
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

    // 1) Update ticket fields. __SLUG_TAG_HIDE_v1__ передаём projectSlug чтобы API
    // мог восстановить теги [task:..] [slug:..], которые мы спрятали из UI.
    const payload = { ticketId, subject, description, dueDate, status, taskId: tk.task_id, projectSlug: state.projectSlug };
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

    // 3) Update local state — добавляем теги обратно как делает API при сохранении.
    tk.title = subject;
    const _tagParts = [];
    if (tk.task_id) _tagParts.push(`[task:${tk.task_id}]`);
    if (state.projectSlug) _tagParts.push(`[slug:${state.projectSlug}]`);
    tk.description = _tagParts.length ? `${description} ${_tagParts.join(' ')}`.trim() : description;
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
      // Pre-warm PDF libs and photo cache so first share() preserves user-gesture window
      if (vs.selectionMode) {
        loadPdfLibs();
        const taskTickets = (state.tickets || []).filter((t) => String(t.task_id) === String(tid));
        prefetchTicketPhotos(taskTickets);
      }
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
      if (ticketPhotoStore[tid].length >= 5) { alert('Можно прикрепить максимум 5 фото к тикету.'); input.value = ''; return; }
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
    // __COST_COMPLETENESS_v1__ Сумма заполненных стоимостей работ vs контракт.
    const _wt = (state.schedule?.tasks || []).filter((t) => !t.isPermit && !t.permitType);
    const _costed = _wt.filter((t) => (Number(t.costIncVat) || 0) > 0);
    const _sumTasks = _wt.reduce((s, t) => s + (Number(t.costIncVat) || 0), 0);
    const costNote = (_wt.length && _costed.length < _wt.length)
      ? `<div class="drawer-section-title">⚠️ Стоимости работ заполнены не полностью</div>
         <div class="drawer-grid">
           ${kv('Сумма по работам', fmtAED(_sumTasks))}
           ${kv('Заполнено', `${_costed.length} из ${_wt.length} работ`)}
         </div>
         <div class="drawer-note">Контракт — ${fmtAED(p.totalIncVat)}, но у ${_wt.length - _costed.length} из ${_wt.length} работ стоимость не задана. Поэтому SPI и прогноз сдачи считаются <b>по объёму работ</b> (по длительности), а не по деньгам. Впиши стоимости работ — и финансовые показатели станут точными.</div>`
      : '';
    html = `<div class="drawer-grid">
      ${kv('Без НДС', fmtAED(p.totalExVat))}
      ${kv('НДС ' + Math.round(p.vatRate * 100) + '%', fmtAED(vat))}
      ${kv('С НДС', fmtAED(p.totalIncVat), { span: true, big: true })}
    </div>
    <div class="drawer-section-title">Этапы оплаты</div>
    <div class="drawer-list">${stages || '—'}</div>
    ${costNote}`;
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
      const inProgress = ts.filter((t) => t.actualStart && !t.actualEnd).length;
      const notStarted = ts.length - done - inProgress;
      const meta = [
        done > 0 ? `✅ ${done}` : null,
        inProgress > 0 ? `🔧 ${inProgress}` : null,
        notStarted > 0 ? `◯ ${notStarted}` : null
      ].filter(Boolean).join(' · ');
      const tasksHtml = ts.map((t) => {
        const prog = taskProgress(t);
        const pct = Math.round(prog * 100);
        const status = prog >= 1 ? 'done' : (t.actualStart ? 'progress' : 'idle');
        const statusIco = status === 'done' ? '✅' : status === 'progress' ? '🔧' : '◯';
        return `<button type="button" class="scope-task" data-task-id="${escapeHtml(t.id)}" title="Открыть карточку работы">
          <span class="scope-task-ico">${statusIco}</span>
          <span class="scope-task-name">${escapeHtml(t.name)}</span>
          <span class="scope-task-pct${status === 'done' ? ' is-done' : ''}">${pct}%</span>
        </button>`;
      }).join('');
      return `<div class="drawer-row scope-row" data-section-id="${escapeHtml(sec.id)}">
        <button type="button" class="scope-row-head" aria-expanded="false">
          <span class="scope-row-chev" aria-hidden="true">▸</span>
          <span class="drawer-row-label" style="--dot:${sec.color}"><span class="drawer-row-dot"></span>${escapeHtml(sec.name)}</span>
          <span class="drawer-row-val">${ts.length} ${plural(ts.length, ['наименование', 'наименования', 'наименований'])}</span>
        </button>
        <div class="drawer-row-meta">${meta || 'не начато'}</div>
        <div class="scope-tasks">${tasksHtml}</div>
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
  if (type === 'tasks') bindScopeRowHandlers();
  setDrawerOpen(true);
}

function bindScopeRowHandlers() {
  const body = $('#drawer-body');
  if (!body) return;
  body.querySelectorAll('.scope-row-head').forEach((head) => {
    head.addEventListener('click', () => {
      const row = head.closest('.scope-row');
      if (!row) return;
      const open = row.classList.toggle('is-open');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
  body.querySelectorAll('.scope-task').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const tid = btn.getAttribute('data-task-id');
      if (tid) openDrawer(tid);
    });
  });
}

function openAnalyticsDrawer(type) {
  const s = state.schedule;
  const asOf = effectiveToday();
  const tasks = s.tasks || [];
  let tag = 'Аналитика', title = '—', html = '';

  if (type === 'spi') {
    const evm = computeEVM(s, asOf);
    // __SPI_NULL_WHEN_NOT_STARTED_v1__
    const spiPct = evm.SPI != null ? (evm.SPI * 100).toFixed(0) : '—';
    const verdict = evm.SPI == null ? 'проект ещё не начался'
                  : evm.SPI >= 0.97 ? 'идём по плану'
                  : evm.SPI >= 0.88 ? 'небольшое отставание'
                  : 'серьёзное отставание';

    const taskStateBadge = (t, m) => {
      const today = asOf.getTime();
      const pe = parseISO(t.planEnd).getTime();
      if (t.actualEnd) return '<span class="drawer-task-badge drawer-task-badge--done">✓ готово</span>';
      if (t.actualStart && today >= pe) return '<span class="drawer-task-badge drawer-task-badge--late">⚠ просрочка</span>';
      if (t.actualStart) return '<span class="drawer-task-badge drawer-task-badge--running">в работе</span>';
      if (today > pe) return '<span class="drawer-task-badge drawer-task-badge--late">⚠ не начали</span>';
      if (today > parseISO(t.planStart).getTime()) return '<span class="drawer-task-badge drawer-task-badge--late">⚠ не стартовали</span>';
      return '<span class="drawer-task-badge drawer-task-badge--pending">ждёт старта</span>';
    };

    // Этапы с раскрытием
    const stageRows = s.stages.map((st) => {
      const ts = tasks.filter((t) => t.stage === st.id);
      if (!ts.length) return '';
      let PV = 0, EV = 0, totalCost = 0;
      const taskMetrics = ts.map(t => ({ t, m: computeTaskMetrics(t, asOf) }));
      for (const { m } of taskMetrics) {
        if (!m.cost) continue;
        PV += m.PV; EV += m.EV; totalCost += m.cost;
      }
      const noCost = totalCost === 0;
      // __SPI_NULL_WHEN_NOT_STARTED_v1__ PV=0 = этап ещё не начался по плану
      const stageSpi = PV > 0 ? EV / PV : null;
      const cls = (noCost || stageSpi == null) ? 'spi-na' : spiClass(stageSpi);
      const fillPct = totalCost > 0 ? Math.round((EV / totalCost) * 100) : 0;
      const valHtml = noCost
        ? `<span class="drawer-row-val ${cls}" title="Стоимость работ этапа не задана — SPI рассчитать нельзя">SPI —</span>`
        : stageSpi == null
        ? `<span class="drawer-row-val ${cls}" title="Ни одна работа этапа ещё не должна была начаться">SPI —</span>`
        : `<span class="drawer-row-val ${cls}">SPI ${(stageSpi * 100).toFixed(0)}%</span>`;
      const metaHtml = noCost
        ? `<div class="drawer-row-meta drawer-row-meta--muted">работы вне сметы CYFR — стоимость не задана</div>`
        : `<div class="drawer-row-meta">освоено ${fmtAED(EV)} из ${fmtAED(totalCost)} · ${taskMetrics.length} ${plural(taskMetrics.length, ['работа','работы','работ'])}</div>`;

      // Inner task list (sorted by SPI ascending — самые проблемные сверху, потом готовые)
      const sortedTasks = [...taskMetrics].sort((a, b) => {
        const sa = a.m.spi == null ? 99 : a.m.spi;
        const sb = b.m.spi == null ? 99 : b.m.spi;
        return sa - sb;
      });
      const taskListHtml = sortedTasks.map(({ t, m }) => {
        const taskSpi = m.spi;
        const taskSpiText = taskSpi == null
          ? '<span class="drawer-row-val spi-na" title="Работа ещё не должна была начаться по плану">—</span>'
          : `<span class="drawer-row-val ${spiClass(taskSpi)}">${(taskSpi * 100).toFixed(0)}%</span>`;
        const costText = m.cost > 0
          ? `${fmtAED(m.cost)}`
          : '<span class="drawer-row-meta--muted">без сметы</span>';
        const factPct = Math.round(m.aP * 100);
        const planPct = Math.round(m.pP * 100);
        return `<button type="button" class="drawer-row drawer-row-link drawer-task-row" data-task-id="${escapeHtml(t.id)}">
          <div class="drawer-row-head">
            <span class="drawer-row-label drawer-task-name">${escapeHtml(t.name)}</span>
            ${taskSpiText}
          </div>
          <div class="drawer-row-meta">
            ${taskStateBadge(t, m)} · план ${planPct}% / факт ${factPct}% · ${costText}
          </div>
        </button>`;
      }).join('');

      return `<div class="drawer-stage-block${noCost ? ' drawer-row--na' : ''}">
        <button type="button" class="drawer-row drawer-row-stage" data-stage-toggle="${escapeHtml(st.id)}" aria-expanded="false">
          <div class="drawer-row-head">
            <span class="drawer-row-label" style="--dot:${st.color}"><span class="drawer-row-dot"></span>${escapeHtml(st.name)} <span class="drawer-stage-caret">▸</span></span>
            ${valHtml}
          </div>
          ${noCost ? '' : `<div class="drawer-progress"><div class="drawer-progress-fill" style="width:${fillPct}%; background:${st.color}"></div></div>`}
          ${metaHtml}
        </button>
        <div class="drawer-stage-tasks" data-stage-id="${escapeHtml(st.id)}" hidden>
          ${taskListHtml}
        </div>
      </div>`;
    }).join('');
    // Что отстаёт — задачи без actualEnd, у которых planEnd < today
    const overdue = tasks
      .filter((t) => !t.actualEnd && parseISO(t.planEnd || t.end) < asOf)
      .map((t) => ({ t, slip: dayDiff(parseISO(t.planEnd || t.end), asOf) }))
      .sort((a, b) => b.slip - a.slip)
      .slice(0, 6);
    const overdueHtml = overdue.map(({ t, slip }) => `
      <button type="button" class="drawer-row drawer-row-link" data-task-id="${escapeHtml(t.id)}">
        <div class="drawer-row-head">
          <span class="drawer-row-label">${escapeHtml(t.name)}</span>
          <span class="drawer-row-val analytics-slip--late">+${slip} дн.</span>
        </div>
        <div class="drawer-row-meta">план до ${escapeHtml(fmtDate(t.planEnd || t.end))} · ${escapeHtml(state.sectionById[t.section]?.name || '')}</div>
      </button>`).join('');

    tag = 'Темп проекта';
    title = `SPI · ${verdict}`;
    html = `<div class="drawer-grid">
      ${kv('SPI', spiPct + '%', { big: true })}
      ${kv('Освоено (EV)', fmtAED(evm.EV))}
      ${kv('План (PV)', fmtAED(evm.PV))}
      ${kv('На дату', escapeHtml(fmtDate(toISO(asOf))), { span: true })}
    </div>
    <div class="drawer-hint"><b>SPI (Schedule Performance Index)</b> — индикатор соответствия проекта плановому графику по международной методологии управления стоимостью проекта <i>Earned Value Management</i> (PMI). <b>100%</b> — проект идёт точно по плану; меньше — отставание; больше — опережение. Каждая работа взвешивается по её финансовому объёму в общем бюджете проекта, поэтому показатель отражает реальный темп освоения, а не просто число закрытых пунктов.</div>
    <div class="drawer-section-title">По этапам</div>
    <div class="drawer-list">${stageRows || '<div class="drawer-empty">Нет данных по этапам.</div>'}</div>
    ${overdueHtml ? `<div class="drawer-section-title">Что отстаёт</div><div class="drawer-list">${overdueHtml}</div>` : ''}`;
  }

  else if (type === 'eac') {
    const evm = computeEVM(s, asOf);
    const slip = evm.slipDays;
    const slipText = slip > 1 ? `<span class="analytics-slip--late">+${slip} дн. к плану</span>`
                  : slip < -1 ? `<span class="analytics-slip--early">${slip} дн. к плану</span>`
                  : '<span class="analytics-slip--ok">в графике</span>';
    // Топ задач по slip — те, что просрочены или замедляют темп
    const candidates = tasks.map((t) => {
      const pe = parseISO(t.planEnd || t.end);
      let slipDays = 0;
      if (t.actualEnd) {
        slipDays = dayDiff(pe, parseISO(t.actualEnd));
      } else if (asOf > pe) {
        slipDays = dayDiff(pe, asOf);
      }
      return { t, slip: slipDays };
    }).filter((x) => x.slip > 0).sort((a, b) => b.slip - a.slip).slice(0, 8);
    const rows = candidates.map(({ t, slip }) => `
      <button type="button" class="drawer-row drawer-row-link" data-task-id="${escapeHtml(t.id)}">
        <div class="drawer-row-head">
          <span class="drawer-row-label">${escapeHtml(t.name)}</span>
          <span class="drawer-row-val analytics-slip--late">+${slip} дн.</span>
        </div>
        <div class="drawer-row-meta">план до ${escapeHtml(fmtDate(t.planEnd || t.end))}${t.actualEnd ? ' · факт ' + escapeHtml(fmtDate(t.actualEnd)) : ''}</div>
      </button>`).join('');
    tag = 'Прогноз';
    title = 'Прогноз сдачи проекта';
    html = `<div class="drawer-grid">
      ${kv('По контракту', escapeHtml(fmtDate(s.project.endDate)))}
      ${kv('Прогноз (EAC)', escapeHtml(fmtDate(toISO(evm.eacDate))))}
      ${kv('Отклонение', slipText, { span: true })}
    </div>
    <div class="drawer-hint">Прогноз = срок проекта ÷ темп. Темп = «сколько уже сделано» ÷ «сколько должно было быть сделано». Если темп сохранится, сдача будет ${slip > 0 ? 'позже' : slip < 0 ? 'раньше' : 'в срок'}.</div>
    ${rows ? `<div class="drawer-section-title">Что тянет срок</div><div class="drawer-list">${rows}</div>` : `<div class="drawer-empty">Просроченных работ нет — прогноз держится.</div>`}`;
  }

  else if (type === 'cpm') {
    const crit = state.cpmCritical || new Set();
    const slack = state.cpmSlack || new Map();
    const openTasks = tasks.filter((t) => !t.actualEnd);
    const critTasks = openTasks
      .filter((t) => crit.has(t.id))
      .sort((a, b) => parseISO(a.planStart) - parseISO(b.planStart));
    const flexTasks = openTasks
      .filter((t) => !crit.has(t.id))
      .sort((a, b) => parseISO(a.planStart) - parseISO(b.planStart));

    const mode = state.cpmFilterMode || null;
    const renderRow = (t, kind) => {
      const sec = state.sectionById[t.section];
      const sl = slack.get(t.id) || 0;
      // Дни показываем только когда активен фильтр того же типа.
      let right;
      if (kind === 'flex' && mode === 'flexible' && sl > 0) {
        right = `<span class="drawer-row-val drawer-row-val--ok">+${sl} ${plural(sl, ['день','дня','дней'])} запаса</span>`;
      } else if (kind === 'crit' && mode === 'critical') {
        right = `<span class="drawer-row-val drawer-row-val--bad">до ${escapeHtml(fmtDate(t.planEnd))}</span>`;
      } else {
        right = `<span class="drawer-row-val drawer-row-val--muted">${escapeHtml(fmtDate(t.planEnd))}</span>`;
      }
      return `
      <button type="button" class="drawer-row drawer-row-link" data-task-id="${escapeHtml(t.id)}">
        <div class="drawer-row-head">
          <span class="drawer-row-label" style="--dot:${sec?.color || '#94a3b8'}"><span class="drawer-row-dot"></span>${escapeHtml(t.name)}</span>
          ${right}
        </div>
        <div class="drawer-row-meta">${escapeHtml(fmtDate(t.planStart))} → ${escapeHtml(fmtDate(t.planEnd))}${sec ? ' · ' + escapeHtml(sec.name) : ''}</div>
      </button>`;
    };

    const critRows = critTasks.map((t) => renderRow(t, 'crit')).join('');
    const flexRows = flexTasks.map((t) => renderRow(t, 'flex')).join('');

    tag = 'Сроки';
    title = 'Критический путь';

    html = `<div class="drawer-grid">
      ${kv('Без запаса', String(critTasks.length))}
      ${kv('С запасом', String(flexTasks.length))}
    </div>
    <div class="drawer-hint">
      Работы делятся на две категории по влиянию на срок сдачи проекта.
      <br><br>
      <strong>Без запаса по графику</strong> — задержка любой из этих работ непосредственно сдвигает дату сдачи проекта.
      <br><br>
      <strong>С запасом</strong> — работа может быть выполнена позже плановой даты на N дней без последствий для итогового срока.
    </div>
    <div class="drawer-hint drawer-hint--secondary">
      Расчёт основан на графе зависимостей и плановых датах работ. Для каждой работы определяется самая ранняя возможная дата окончания (исходя из готовности предшествующих работ) и самая поздняя допустимая (чтобы не сорвать срок зависимых работ или сдачи проекта). Разница между этими датами — запас по графику.
    </div>
    <div class="drawer-actions drawer-actions--two">
      <button type="button" class="drawer-btn${mode === 'critical' ? ' drawer-btn--on' : ''}" data-cpm-filter="critical">
        ${mode === 'critical' ? '✓ ' : ''}Без запаса
      </button>
      <button type="button" class="drawer-btn${mode === 'flexible' ? ' drawer-btn--on' : ''}" data-cpm-filter="flexible">
        ${mode === 'flexible' ? '✓ ' : ''}С запасом
      </button>
    </div>
    ${critTasks.length ? `<div class="drawer-section-title">Работы без запаса по графику</div><div class="drawer-list">${critRows}</div>` : ''}
    ${flexTasks.length ? `<div class="drawer-section-title">Работы с запасом по графику</div><div class="drawer-list">${flexRows}</div>` : ''}
    ${!critTasks.length && !flexTasks.length ? `<div class="drawer-empty">Все работы завершены.</div>` : ''}`;
  }

  else if (type === 'materials') {
    const risky = [];
    for (const t of tasks) {
      const r = computeMaterialRisk(t);
      if (r) risky.push({ t, r, mats: getTaskMaterials(t.id) });
    }
    risky.sort((a, b) => a.r.orderBy - b.r.orderBy);
    const cards = risky.map(({ t, r, mats }) => {
      const list = mats.filter(m => !m.ordered && (Number(m.leadTime) || 0) > r.daysToStart);
      const matChips = list.map(m =>
        `<span class="mat-chip"><span class="mat-chip-name">${escapeHtml(m.name || '—')}</span><span class="mat-chip-lead">${m.leadTime || 0} дн.</span></span>`
      ).join('');
      const deadlineLabel = r.daysToStart > 0
        ? `до ${escapeHtml(fmtDate(toISO(r.orderBy)))}`
        : 'срочно';
      const sec = state.sectionById[t.section]?.name || '';
      return `
      <button type="button" class="mat-task-card" data-task-id="${escapeHtml(t.id)}">
        <div class="mat-task-card-head">
          <div class="mat-task-card-name">${escapeHtml(t.name)}</div>
          <div class="mat-task-card-deadline">📦 ${deadlineLabel}</div>
        </div>
        <div class="mat-task-card-meta">
          <span>${escapeHtml(sec)}</span>
          <span>·</span>
          <span>старт ${escapeHtml(fmtDate(t.planStart))}</span>
          <span>·</span>
          <span>через ${r.daysToStart} ${plural(r.daysToStart, ['день','дня','дней'])}</span>
        </div>
        ${matChips ? `<div class="mat-task-card-chips">${matChips}</div>` : ''}
      </button>`;
    }).join('');
    tag = 'Снабжение';
    title = `Материалы в риске · ${risky.length} ${plural(risky.length, ['работа', 'работы', 'работ'])}`;
    html = `<div class="drawer-grid">
      ${kv('Работ под риском', String(risky.length))}
      ${kv('Ближайший заказ', risky.length ? escapeHtml(fmtDate(toISO(risky[0].r.orderBy))) : '—')}
    </div>
    <div class="drawer-hint">Материал «в риске», если до старта работы меньше дней, чем lead-time поставщика, и закупка не отмечена.</div>
    ${cards ? `<div class="mat-task-cards">${cards}</div>` : `<div class="drawer-empty">Все материалы под контролем.</div>`}`;
  }

  else if (type === 'resources') {
    const tl = computeResourceTimeline(s);
    // Топ-7 дней по нагрузке
    const topDays = tl.totalPerDay
      .map((n, i) => ({ n, i }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 7);
    const peakIdx = tl.peakIdx;
    // Разбивка по специализациям на пиковом дне
    const peakBreakdown = peakIdx >= 0 ? tl.types
      .map((tp) => ({ tp, n: tl.counts[tp][peakIdx] }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n) : [];
    const breakdownHtml = peakBreakdown.map(({ tp, n }) => `
      <div class="drawer-row">
        <div class="drawer-row-head">
          <span class="drawer-row-label">${escapeHtml(RESOURCE_LABEL_BY_ID[tp] || tp)}</span>
          <span class="drawer-row-val">${n} чел.</span>
        </div>
      </div>`).join('');
    const dayRows = topDays.map(({ n, i }) => `
      <div class="drawer-row">
        <div class="drawer-row-head">
          <span class="drawer-row-label">${escapeHtml(fmtDate(toISO(tl.days[i])))}</span>
          <span class="drawer-row-val${i === peakIdx ? ' analytics-slip--late' : ''}">${n} чел.${i === peakIdx ? ' · пик' : ''}</span>
        </div>
      </div>`).join('');
    const heatmapOn = !!state.showHeatmap;
    tag = 'Ресурсы';
    title = `Пик ${tl.peak} чел.${tl.peakDate ? ' · ' + fmtDate(toISO(tl.peakDate)) : ''}`;
    html = `<div class="drawer-grid">
      ${kv('Пик одновременно', String(tl.peak))}
      ${kv('День пика', tl.peakDate ? escapeHtml(fmtDate(toISO(tl.peakDate))) : '—')}
    </div>
    <div class="drawer-hint">Пик — максимальное число людей в один день, исходя из «Ресурсов» в карточках работ.</div>
    <div class="drawer-actions">
      <button type="button" class="drawer-btn${heatmapOn ? ' drawer-btn--on' : ''}" id="res-toggle-heatmap">
        ${heatmapOn ? '✓ Heatmap включён' : 'Показать heatmap по дням'}
      </button>
    </div>
    ${breakdownHtml ? `<div class="drawer-section-title">В день пика</div><div class="drawer-list">${breakdownHtml}</div>` : ''}
    ${dayRows ? `<div class="drawer-section-title">Топ дней по нагрузке</div><div class="drawer-list">${dayRows}</div>` : `<div class="drawer-empty">Нет данных по ресурсам.</div>`}`;
  }

  $('#drawer-tag').textContent = tag;
  $('#drawer-title').textContent = title;
  $('#drawer-body').innerHTML = html;
  setDrawerOpen(true);

  // Wire up drawer-internal handlers
  document.querySelectorAll('#drawer-body .drawer-row-link[data-task-id], #drawer-body .mat-task-card[data-task-id], #drawer-body .progress-log-update[data-task-id]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const tid = el.getAttribute('data-task-id');
      if (tid) openDrawer(tid);
    });
  });
  // Раскрытие/сворачивание блока этапа в SPI drawer
  document.querySelectorAll('#drawer-body [data-stage-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sid = btn.getAttribute('data-stage-toggle');
      const list = document.querySelector(`#drawer-body .drawer-stage-tasks[data-stage-id="${CSS.escape(sid)}"]`);
      if (!list) return;
      const open = list.hasAttribute('hidden');
      if (open) list.removeAttribute('hidden'); else list.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', String(open));
      const caret = btn.querySelector('.drawer-stage-caret');
      if (caret) caret.textContent = open ? '▾' : '▸';
    });
  });
  // Two-mode CPM filter: 'critical' | 'flexible' | null. Re-clicking the active mode turns it off.
  document.querySelectorAll('#drawer-body [data-cpm-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const want = btn.getAttribute('data-cpm-filter');
      state.cpmFilterMode = (state.cpmFilterMode === want) ? null : want;
      // back-compat for any other code that reads filterCriticalOnly
      state.filterCriticalOnly = state.cpmFilterMode === 'critical';
      // Recompute CPM (uses freshest deps), then re-render gantt rows so .task-critical
      // / .task-completed classes match current state, then apply filter classes.
      renderProjectAnalytics();
      renderGantt();
      applyCriticalFilterStyles();
      // Re-render the drawer to update active button state
      openAnalyticsDrawer('cpm');
    });
  });
  const resBtn = document.getElementById('res-toggle-heatmap');
  if (resBtn) resBtn.addEventListener('click', () => {
    state.showHeatmap = !state.showHeatmap;
    renderResourceHeatmap();
    resBtn.classList.toggle('drawer-btn--on', state.showHeatmap);
    resBtn.textContent = state.showHeatmap ? '✓ Heatmap включён' : 'Показать heatmap по дням';
    // Sync toolbar btn state if exists
    const tb = document.getElementById('btn-heatmap');
    if (tb) tb.dataset.active = String(!!state.showHeatmap);
  });
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

// iOS scroll-lock: при открытой плашке (drawer/tasks-sheet) `overscroll-behavior:
// contain` на самой панели не страхует от сценария «панель короче экрана» —
// iOS прокидывает скролл в body, и юзер видит, как мотается график за окном.
// Замораживаем body позиционно, восстанавливаем scroll при закрытии.
let _bodyLockScrollY = 0;
let _bodyLockCount = 0;
function setBodyScrollLock(locked) {
  if (locked) {
    if (_bodyLockCount === 0) {
      _bodyLockScrollY = window.scrollY || window.pageYOffset || 0;
      const body = document.body;
      body.style.position = 'fixed';
      body.style.top = `-${_bodyLockScrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
    }
    _bodyLockCount++;
  } else {
    if (_bodyLockCount > 0) _bodyLockCount--;
    if (_bodyLockCount === 0) {
      const body = document.body;
      body.style.position = '';
      body.style.top = '';
      body.style.left = '';
      body.style.right = '';
      body.style.width = '';
      window.scrollTo(0, _bodyLockScrollY);
    }
  }
}
function setDrawerOpen(open) {
  const el = $('#drawer');
  if (!el) return;
  const wasOpen = el.getAttribute('aria-hidden') === 'false';
  if (open && !wasOpen) {
    el.setAttribute('aria-hidden', 'false');
    setBodyScrollLock(true);
  } else if (!open && wasOpen) {
    el.setAttribute('aria-hidden', 'true');
    setBodyScrollLock(false);
  }
}
function closeDrawer() {
  setDrawerOpen(false);
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
  const editMode = !!state.editMode;

  let html = '';
  if (editMode) {
    html += `<div class="tsh-banner">✎ Режим правки — переименуй, удали или добавь работы и разделы прямо отсюда.</div>`;
    html += `<button type="button" class="tsh-add tsh-add-section" data-tsh-add-section>＋ Добавить раздел</button>`;
  }
  for (const sec of state.schedule.sections) {
    const ts = bySec[sec.id] || [];
    if (!ts.length && !editMode) continue;
    html += `<div class="tasks-sheet-section">
      <span class="dot" style="background:${sec.color}"></span>
      <span class="tsh-section-name">${escapeHtml(sec.name)}</span>
      ${editMode ? `
        <button type="button" class="tsh-row-btn" data-tsh-edit-section="${escapeHtml(sec.id)}" title="Переименовать раздел">✎</button>
        <button type="button" class="tsh-row-btn tsh-row-del" data-tsh-del-section="${escapeHtml(sec.id)}" title="Удалить раздел (только пустой)">🗑</button>
      ` : ''}
    </div>`;
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

      // Паритет с десктопным task-label: КП, материалы, СУБ/ЦИФР, имя субподрядчика, план-даты.
      const isCritical = state.cpmCritical && state.cpmCritical.has(t.id);
      const critBadge = (isCritical && prog < 1) ? '<span class="tsh-crit" title="Критический путь">⚠ КП</span>' : '';
      const matRisk = computeMaterialRisk(t);
      const matBadge = matRisk
        ? `<span class="tsh-mat" title="Заказать до ${escapeHtml(fmtDate(toISO(matRisk.orderBy)))} · ${matRisk.riskyCount} материалов в риске">📦 ${matRisk.daysToStart > 0 ? '−' + (matRisk.maxLead - matRisk.daysToStart) + 'д' : 'срочно'}</span>`
        : '';
      const isTaskSub = effectiveSub(t, sec);
      const isExplicitCyfrInSub = t.sub === false && sec.sub;
      const isExplicitSubInCyfr = t.sub === true && !sec.sub;
      const subTitle = t.subcontractorName
        ? `Субподрядчик: ${t.subcontractorName}`
        : (isExplicitSubInCyfr ? 'Субподрядчик (только эта работа)' : (sec.sub ? 'Субподрядчик (раздел)' : 'Субподрядчик'));
      const subBadge = isTaskSub
        ? `<span class="tsh-sub" title="${escapeHtml(subTitle)}">СУБ${t.subcontractorName ? '·' + escapeHtml(t.subcontractorName.split(' ')[0]) : ''}</span>`
        : (isExplicitCyfrInSub ? `<span class="tsh-cyfr" title="ЦИФР делает сам (раздел на субе)">ЦИФР</span>` : '');

      // План-даты компактно: «28 апр → 8 май»
      const planRange = (t.planStart && t.planEnd)
        ? `<span class="tsh-dates" title="План">📅 ${fmtDate(t.planStart).replace(/ \d{4} г\.$/, '')} → ${fmtDate(t.planEnd).replace(/ \d{4} г\.$/, '')}</span>`
        : '';

      const _hasOpenPause = Array.isArray(t.pauses) && t.pauses.some(p => p && !p.to);
      const editActions = editMode ? `
        <button type="button" class="tsh-row-btn" data-tsh-edit-task="${escapeHtml(t.id)}" title="Переименовать">✎</button>
        <button type="button" class="tsh-row-btn" data-tsh-dates-task="${escapeHtml(t.id)}" title="Изменить даты / подрядчика">📅</button>
        ${_hasOpenPause
          ? `<button type="button" class="tsh-row-btn" data-tsh-resume-task="${escapeHtml(t.id)}" title="Возобновить работу">▶️</button>`
          : `<button type="button" class="tsh-row-btn" data-tsh-pause-task="${escapeHtml(t.id)}" title="Поставить на паузу">⏸</button>`}
        <button type="button" class="tsh-row-btn tsh-row-del" data-tsh-del-task="${escapeHtml(t.id)}" title="Удалить работу">🗑</button>
      ` : '';
      html += `<div class="tasks-sheet-row">
        <button type="button" class="tasks-sheet-item${t.actualEnd ? ' done' : ''}${isCritical ? ' is-critical' : ''}" data-tid="${escapeHtml(t.id)}">
          <span class="tsh-line1">
            <span class="tdot" style="background:${sec.color}"></span>
            <span class="tid">№${escapeHtml(t.id)}</span>
            <span class="tname">${escapeHtml(t.name)}</span>
          </span>
          ${[planRange, pctBadge, overdueBadge, critBadge, matBadge, subBadge, statusHtml].filter(Boolean).length
            ? `<span class="tsh-line2">${[planRange, pctBadge, overdueBadge, critBadge, matBadge, subBadge, statusHtml].filter(Boolean).join('')}</span>`
            : ''}
        </button>
        ${editActions}
      </div>`;
    }
    if (editMode) {
      html += `<button type="button" class="tsh-add" data-tsh-add-task="${escapeHtml(sec.id)}">＋ Добавить работу в раздел</button>`;
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

  if (editMode) attachTasksSheetEditHandlers(body);
}

function attachTasksSheetEditHandlers(body) {
  body.querySelectorAll('[data-tsh-edit-task]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const tid = b.getAttribute('data-tsh-edit-task');
    const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(tid));
    if (!t) return;
    const newName = (prompt('Новое название работы:', t.name) || '').trim();
    if (!newName || newName === t.name) return;
    try {
      const r = await postDataAction('task:update', { slug: state.projectSlug, taskId: tid, patch: { name: newName } });
      if (r.schedule) state.schedule = r.schedule;
      else { t.name = newName; }
      renderTasksSheet(); renderGantt();
      showToast('✓ Переименовано');
    } catch (err) { showToast('Ошибка: ' + (err.message || err), 'error'); }
  }));

  // 📅 — открыть полный редактор дат + подрядчика. Закрываем sheet, иначе модалка под ним.
  body.querySelectorAll('[data-tsh-dates-task]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const tid = b.getAttribute('data-tsh-dates-task');
    if (!tid) return;
    closeTasksSheet();
    if (typeof openTaskDatesEditor === 'function') openTaskDatesEditor(tid);
  }));

  body.querySelectorAll('[data-tsh-pause-task]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const tid = b.getAttribute('data-tsh-pause-task');
    if (!tid) return;
    closeTasksSheet();
    if (typeof openTaskPauseForm === 'function') openTaskPauseForm(tid);
  }));

  body.querySelectorAll('[data-tsh-resume-task]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const tid = b.getAttribute('data-tsh-resume-task');
    if (!tid) return;
    closeTasksSheet();
    if (typeof openTaskResumeForm === 'function') openTaskResumeForm(tid);
  }));

  body.querySelectorAll('[data-tsh-del-task]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const tid = b.getAttribute('data-tsh-del-task');
    const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(tid));
    if (!t) return;
    if (!confirm(`Удалить работу «${t.name}»?`)) return;
    try {
      const r = await postDataAction('task:delete', { slug: state.projectSlug, taskId: tid });
      if (r.schedule) state.schedule = r.schedule;
      renderTasksSheet(); renderGantt();
      showToast('✓ Удалено');
    } catch (err) { showToast('Ошибка: ' + (err.message || err), 'error'); }
  }));

  body.querySelectorAll('[data-tsh-edit-section]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const sid = b.getAttribute('data-tsh-edit-section');
    if (typeof openEditSectionForm === 'function') openEditSectionForm(sid);
  }));

  body.querySelectorAll('[data-tsh-del-section]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const sid = b.getAttribute('data-tsh-del-section');
    const sec = (state.schedule?.sections || []).find(s => s.id === sid);
    if (!sec) return;
    if (!confirm(`Удалить раздел «${sec.name}»? Работы должны быть удалены или перенесены сначала.`)) return;
    try {
      const r = await postDataAction('section:delete', { slug: state.projectSlug, sectionId: sid });
      if (r.schedule) state.schedule = r.schedule;
      renderTasksSheet(); renderGantt();
      showToast('✓ Раздел удалён');
    } catch (err) { showToast('Ошибка: ' + (err.message || err), 'error'); }
  }));

  body.querySelectorAll('[data-tsh-add-task]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const sid = b.getAttribute('data-tsh-add-task');
    closeTasksSheet();
    if (typeof openAddTaskForm === 'function') openAddTaskForm(sid, b);
  }));

  body.querySelectorAll('[data-tsh-add-section]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTasksSheet();
    if (typeof openAddSectionForm === 'function') openAddSectionForm(b);
  }));
}

function openTasksSheet() {
  const el = $('#tasks-sheet');
  if (!el) return;
  if (el.getAttribute('aria-hidden') === 'false') return;
  el.setAttribute('aria-hidden', 'false');
  setBodyScrollLock(true);
}
function closeTasksSheet() {
  const el = $('#tasks-sheet');
  if (!el) return;
  if (el.getAttribute('aria-hidden') !== 'false') return;
  el.setAttribute('aria-hidden', 'true');
  setBodyScrollLock(false);
}
function attachTasksSheetHandlers() {
  const fab = $('#tasks-fab');
  if (fab) fab.addEventListener('click', openTasksSheet);
  document.querySelectorAll('[data-tasks-close]').forEach((el) =>
    el.addEventListener('click', closeTasksSheet)
  );
  const doneBtn = $('#tasks-sheet-done');
  if (doneBtn) {
    doneBtn.addEventListener('click', () => {
      // Выйти из режима Правки и закрыть drawer.
      if (state.editMode) {
        deselectGanttBar();
        state.editMode = false;
        document.body.classList.remove('is-edit-mode');
        const editBtn = document.getElementById('btn-edit');
        if (editBtn) editBtn.setAttribute('data-active', 'false');
        renderGantt();
      }
      closeTasksSheet();
      showToast('✓ Готово');
    });
  }
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
      else if (action === 'team') openTeamModal();
      else if (action === 'worker-blackbox') openWorkerBlackboxModal();
      else if (action === 'delete-project') confirmDeleteProject();
      else if (action === 'reset-project') confirmResetProject();
    });
  });
}

async function openWorkersPicker(onSaved) {
  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay';
  overlay.style.zIndex = 1500;
  overlay.innerHTML = `
    <div class="edit-form-card workers-picker-card">
      <div class="edit-form-head">
        <div>🇺🇿 Рабочие — выбери кто на объекте</div>
        <button type="button" class="edit-form-close">×</button>
      </div>
      <div class="team-modal-hint">
        ✅ Галочка слева — рабочий на объекте (попадёт в систему как worker).<br>
        🧑‍💼 Галочка «бригадир» — этот человек будет foreman'ом (потом сможешь назначить ему проекты).
      </div>
      <div class="workers-picker-controls">
        <button type="button" class="workers-picker-toggle" data-toggle="all">Выделить всех</button>
        <button type="button" class="workers-picker-toggle" data-toggle="none">Снять все</button>
        <input type="text" class="workers-picker-search" id="wp-search" placeholder="🔍 Поиск по имени" />
      </div>
      <div class="workers-picker-list" id="wp-list"><div class="team-loading">Загружаю список…</div></div>
      <div class="edit-form-actions">
        <button type="button" class="edit-form-cancel" id="wp-cancel">Отмена</button>
        <button type="button" class="edit-form-submit" id="wp-save">Сохранить</button>
      </div>
      <div class="edit-form-err" id="wp-err"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.querySelector('#wp-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  let names = [];
  let existing = {};
  let pickerState = []; // [{name, selected, foreman}]
  try {
    // __PER_PROJECT_TEAM_v1__ Picker per-slug — selected=true только если worker уже в этом проекте.
    const r = await postDataAction('team:workers-picker', { slug: state.projectSlug });
    names = r.names || [];
    existing = r.existing || {};
  } catch (e) {
    overlay.querySelector('#wp-list').innerHTML = `<div class="team-loading" style="color:#b91c1c">Ошибка: ${escapeHtml(e.message || String(e))}</div>`;
    return;
  }
  pickerState = names.map(name => {
    const ex = existing[name];
    if (!ex) return { name, selected: false, foreman: false };
    // Selected = в БД И привязан к этому проекту (или admin/owner — те всегда «включены»)
    const isInProject = ex.inProject !== false;
    if (ex.role === 'worker')  return { name, selected: isInProject, foreman: false };
    if (ex.role === 'foreman') return { name, selected: isInProject, foreman: true };
    return { name, selected: false, foreman: false }; // creator/admin не трогаем
  });

  function render(filter = '') {
    const f = filter.trim().toLowerCase();
    const list = overlay.querySelector('#wp-list');
    const visible = pickerState.filter(s => !f || s.name.toLowerCase().includes(f));
    if (!visible.length) { list.innerHTML = '<div class="team-loading">Никого не найдено по запросу.</div>'; return; }
    list.innerHTML = visible.map((s, idx) => {
      const realIdx = pickerState.findIndex(x => x.name === s.name);
      const e = existing[s.name];
      const inOtherProjectsCount = e ? Math.max(0, (e.allowedCount || 0) - (e.inProject ? 1 : 0)) : 0;
      const badge = e?.role === 'foreman'
        ? `<span class="wp-badge wp-badge--foreman">🧑‍💼 бригадир${inOtherProjectsCount ? ` · в ${inOtherProjectsCount} др. проект.` : ''}</span>`
        : e?.role === 'worker'
          ? `<span class="wp-badge">👷 в системе${inOtherProjectsCount ? ` · в ${inOtherProjectsCount} др. проект.` : ''}</span>`
          : '';
      return `<div class="wp-row" data-idx="${realIdx}">
        <label class="wp-cb-main">
          <input type="checkbox" class="wp-sel" data-idx="${realIdx}" ${s.selected ? 'checked' : ''} />
          <span class="wp-name">${escapeHtml(s.name)}</span>
        </label>
        <label class="wp-cb-foreman${s.selected ? '' : ' wp-cb-foreman--disabled'}">
          <input type="checkbox" class="wp-foreman" data-idx="${realIdx}" ${s.foreman ? 'checked' : ''} ${s.selected ? '' : 'disabled'} />
          <span>бригадир</span>
        </label>
        ${badge}
      </div>`;
    }).join('');
    list.querySelectorAll('.wp-sel').forEach(cb => cb.addEventListener('change', () => {
      const i = Number(cb.dataset.idx);
      pickerState[i].selected = cb.checked;
      if (!cb.checked) pickerState[i].foreman = false;
      render(overlay.querySelector('#wp-search').value);
    }));
    list.querySelectorAll('.wp-foreman').forEach(cb => cb.addEventListener('change', () => {
      const i = Number(cb.dataset.idx);
      pickerState[i].foreman = cb.checked;
    }));
  }

  render();
  overlay.querySelector('#wp-search').addEventListener('input', e => render(e.target.value));
  overlay.querySelectorAll('.workers-picker-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const all = btn.dataset.toggle === 'all';
      pickerState.forEach(s => { s.selected = all; if (!all) s.foreman = false; });
      render(overlay.querySelector('#wp-search').value);
    });
  });
  overlay.querySelector('#wp-save').addEventListener('click', async () => {
    const btn = overlay.querySelector('#wp-save');
    btn.disabled = true; btn.textContent = 'Сохраняю…';
    try {
      // __PER_PROJECT_TEAM_v1__ Передаём slug — sync применит изменения только к этому проекту.
      const r = await postDataAction('team:workers-sync', { items: pickerState, slug: state.projectSlug });
      const parts = [];
      if (r.created) parts.push('+' + r.created + ' создано');
      if (r.updated) parts.push(r.updated + ' обновлено');
      if (r.removed) parts.push('-' + r.removed + ' удалено');
      showToast('✓ ' + (parts.length ? parts.join(', ') : 'без изменений'));
      close();
      if (typeof onSaved === 'function') onSaved();
      if (typeof loadAssignees === 'function') loadAssignees();
    } catch (e) {
      overlay.querySelector('#wp-err').textContent = 'Не удалось: ' + (e.message || e);
      btn.disabled = false; btn.textContent = 'Сохранить';
    }
  });
}

async function openTeamModal() {
  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay team-modal-overlay';
  overlay.innerHTML = `
    <div class="edit-form-card team-modal-card">
      <div class="edit-form-head">
        <div>👥 Команда</div>
        <button type="button" class="edit-form-close">×</button>
      </div>
      <div class="team-tabs" role="tablist">
        <button type="button" class="team-tab team-tab--active" data-tab="management" role="tab">🧑‍💼 Менеджмент</button>
        <button type="button" class="team-tab" data-tab="workers" role="tab">👷 Рабочие</button>
      </div>
      <div class="team-modal-hint" id="team-tab-hint" hidden></div>
      <ul class="team-list" id="team-list"><li class="team-loading">Загрузка…</li></ul>
      <div class="team-modal-bottom">
        <button type="button" class="team-add-btn" id="team-add-btn">＋ Добавить</button>
        <button type="button" class="team-seed-btn" id="team-seed-btn" style="display:none">🇺🇿 Выбрать из списка имён</button>
      </div>
      <div class="edit-form-actions">
        <button type="button" class="edit-form-cancel team-close-btn">Закрыть</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.querySelector('.team-close-btn').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const MGMT_ROLES = new Set(['creator','owner','admin','foreman','pm']);
  const WORKER_ROLES = new Set(['worker']);
  let users = [];
  let activeTab = 'management';

  async function reload() {
    try {
      // __PER_PROJECT_TEAM_v1__ Передаём slug → бэкенд считает activeInProject (для foreman/worker).
      const r = await postDataAction('team:list', { slug: state.projectSlug });
      users = r.users || [];
      renderList();
    } catch (e) {
      const ul = overlay.querySelector('#team-list');
      ul.innerHTML = `<li class="team-loading" style="color:#b91c1c">Ошибка: ${escapeHtml(e.message || String(e))}</li>`;
    }
  }
  function renderList() {
    const ul = overlay.querySelector('#team-list');
    const seedBtn = overlay.querySelector('#team-seed-btn');
    const hint = overlay.querySelector('#team-tab-hint');
    const filtered = users.filter(u => activeTab === 'management' ? MGMT_ROLES.has(u.role) : WORKER_ROLES.has(u.role));
    if (activeTab === 'workers') {
      hint.innerHTML = 'Список рабочих на объекте. Открой <b>«Выбрать из списка имён»</b> чтобы отметить кого добавить (галочка) и кто бригадир. Можно ещё бригадира выбрать кнопкой 👷→🧑‍💼.';
      hint.hidden = false;
      seedBtn.style.display = 'inline-flex';
    } else {
      hint.innerHTML = '';
      hint.hidden = true;
      seedBtn.style.display = 'none';
    }
    if (!filtered.length) {
      ul.innerHTML = activeTab === 'workers'
        ? '<li class="team-loading">Пока никого. Нажми «Заполнить узбекскими именами» или добавь рабочего вручную.</li>'
        : '<li class="team-loading">Пока никого. Добавь первого участника.</li>';
      return;
    }
    ul.innerHTML = filtered.map(u => {
      const projects = (u.allowedProjects && u.allowedProjects.length) ? u.allowedProjects.join(', ') : '— не назначен ни на один проект —';
      const tg = u.telegramUserId ? `TG: ${escapeHtml(u.telegramUserId)}` : '<span style="color:#b91c1c">TG не задан</span>';
      const displayRole = u.role === 'owner' ? 'creator' : (u.role || '—');
      const isWorker = u.role === 'worker';
      // __PER_PROJECT_TEAM_v1__ Для foreman/worker используем activeInProject (per-slug).
      // Для admin/owner/creator используем глобальный active (они работают со всеми проектами).
      const isPerProject = u.isPerProject === true;
      const isActiveHere = u.activeInProject !== false;
      const promoteBtn = isWorker
        ? `<button type="button" class="team-promote" data-team-promote="${escapeHtml(u.id)}" title="Сделать бригадиром (foreman)">👷→🧑‍💼</button>`
        : '';
      const meta = isWorker
        ? `${tg}`
        : `${tg} · Проекты: ${escapeHtml(projects)}`;
      const toggleTitle = isPerProject
        ? (isActiveHere ? 'Убрать из этого проекта' : 'Добавить в этот проект')
        : (isActiveHere ? 'Выключить глобально (не получает пинги ни по одному проекту)' : 'Включить глобально');
      const toggleIcon = isActiveHere ? '🟢' : '⚫';
      const inactiveCls = isActiveHere ? '' : ' team-item--inactive';
      const badge = !isActiveHere
        ? (isPerProject ? '<span class="team-inactive-badge">не в этом проекте</span>' : '<span class="team-inactive-badge">выключен глобально</span>')
        : (isPerProject ? '<span class="team-active-badge">в этом проекте</span>' : '');
      return `<li class="team-item${inactiveCls}" data-id="${escapeHtml(u.id)}">
        <div class="team-item-info">
          <div class="team-item-name">${escapeHtml(u.name)} <span class="team-item-role">${escapeHtml(displayRole)}</span> ${badge}</div>
          <div class="team-item-meta">${meta}</div>
        </div>
        <div class="team-item-actions">
          <button type="button" class="team-toggle" data-team-toggle="${escapeHtml(u.id)}" data-team-active="${isActiveHere ? '1' : '0'}" data-per-project="${isPerProject ? '1' : '0'}" title="${toggleTitle}">${toggleIcon}</button>
          ${promoteBtn}
          <button type="button" class="team-edit" data-team-edit="${escapeHtml(u.id)}" title="Редактировать">✎</button>
          <button type="button" class="team-del" data-team-del="${escapeHtml(u.id)}" title="Удалить">×</button>
        </div>
      </li>`;
    }).join('');
  }
  overlay.querySelectorAll('.team-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      overlay.querySelectorAll('.team-tab').forEach(b => b.classList.toggle('team-tab--active', b === btn));
      renderList();
    });
  });
  overlay.querySelector('#team-add-btn').addEventListener('click', () => openTeamUpsertForm(null, activeTab === 'workers' ? 'worker' : null));
  overlay.querySelector('#team-seed-btn').addEventListener('click', () => openWorkersPicker(reload));
  // __TOGGLE_INFLIGHT_v1__ Защита от out-of-order race: пока один POST per user в воздухе,
  // повторные клики игнорируем. Иначе двойной/тройной быстрый клик мог поставить UI в чужое
  // финальное состояние (last-write-wins по сети, не по таймстемпу клика).
  const inflightToggle = new Set();
  overlay.addEventListener('click', e => {
    const ed = e.target.closest('[data-team-edit]');
    if (ed) {
      const id = ed.getAttribute('data-team-edit');
      const u = users.find(x => x.id === id);
      if (u) openTeamUpsertForm(u);
      return;
    }
    const toggle = e.target.closest('[data-team-toggle]');
    if (toggle) {
      const id = toggle.getAttribute('data-team-toggle');
      if (inflightToggle.has(id)) return;
      const wasActive = toggle.getAttribute('data-team-active') === '1';
      const isPerProject = toggle.getAttribute('data-per-project') === '1';
      const u = users.find(x => x.id === id);
      if (!u) return;
      const newActive = !wasActive;
      inflightToggle.add(id);
      // __PER_PROJECT_TEAM_v1__ Optimistic update учитывает per-project семантику.
      if (isPerProject) {
        u.activeInProject = newActive;
        // Также в локальном кеше allowedProjects обновим, чтобы не путаться при следующих рендерах.
        const slugLc = String(state.projectSlug || '').toLowerCase();
        if (newActive) u.allowedProjects = Array.from(new Set([...(u.allowedProjects || []), slugLc]));
        else u.allowedProjects = (u.allowedProjects || []).filter(s => String(s).toLowerCase() !== slugLc);
      } else {
        u.active = newActive;
        u.activeInProject = newActive;
      }
      renderList();
      const projLabel = state.schedule?.project?.name || state.projectSlug || 'проекте';
      const msg = isPerProject
        ? (newActive ? `🟢 ${u.name} в проекте «${projLabel}»` : `⚫ ${u.name} убран из проекта «${projLabel}»`)
        : (newActive ? `🟢 ${u.name} включён глобально` : `⚫ ${u.name} выключен глобально`);
      showToast(msg);
      const action = isPerProject ? 'team:set-project-membership' : 'team:set-active';
      const payload = isPerProject
        ? { id, slug: state.projectSlug, included: newActive }
        : { id, active: newActive };
      postDataAction(action, payload)
        .catch(e => {
          if (isPerProject) {
            u.activeInProject = wasActive;
            const slugLc = String(state.projectSlug || '').toLowerCase();
            if (wasActive) u.allowedProjects = Array.from(new Set([...(u.allowedProjects || []), slugLc]));
            else u.allowedProjects = (u.allowedProjects || []).filter(s => String(s).toLowerCase() !== slugLc);
          } else {
            u.active = wasActive;
            u.activeInProject = wasActive;
          }
          renderList();
          showToast('Не удалось: ' + (e.message || e), 'error');
        })
        .finally(() => { inflightToggle.delete(id); });
      return;
    }
    const promote = e.target.closest('[data-team-promote]');
    if (promote) {
      const id = promote.getAttribute('data-team-promote');
      const u = users.find(x => x.id === id);
      if (!u) return;
      if (!confirm(`Сделать «${u.name}» бригадиром?\n\nОн переедет в Менеджмент. После этого нужно будет назначить ему проекты, чтобы он начал получать пинги от бота.`)) return;
      postDataAction('team:set-role', { id, role: 'foreman' }).then(() => {
        showToast(`✓ ${u.name} теперь бригадир. Назначь ему проекты в «Менеджмент».`);
        activeTab = 'management';
        overlay.querySelectorAll('.team-tab').forEach(b => b.classList.toggle('team-tab--active', b.dataset.tab === 'management'));
        reload();
      }).catch(e => showToast('Не удалось: ' + (e.message || e), 'error'));
      return;
    }
    const del = e.target.closest('[data-team-del]');
    if (del) {
      const id = del.getAttribute('data-team-del');
      const u = users.find(x => x.id === id);
      if (!u) return;
      if (!confirm(`Удалить «${u.name}» из команды?\n\nЭто не удалит его сообщения / тикеты — только запись в Airtable.`)) return;
      postDataAction('team:delete', { id }).then(() => { showToast(`✓ Удалён: ${u.name}`); reload(); })
        .catch(e => showToast('Не удалось: ' + (e.message || e), 'error'));
    }
  });

  async function openTeamUpsertForm(existing, forcedRole) {
    const isEdit = !!existing;
    const isCreator = existing?.role === 'creator' || existing?.role === 'owner';
    const isWorkerForm = (forcedRole === 'worker') || (existing?.role === 'worker');
    // Загружаем список всех активных проектов для multi-select dropdown.
    let allProjects = [];
    try {
      const r = await fetch(`/api/data?action=projects:list-all&t=${Date.now()}`);
      const d = await r.json();
      allProjects = Array.isArray(d?.projects) ? d.projects : [];
    } catch { allProjects = []; }
    const existingSlugs = new Set((existing?.allowedProjects || []).map(s => String(s).toLowerCase()));
    const allAccess = !existing || existingSlugs.size === 0;

    // Селектор роли:
    // - creator/owner → readonly (защита).
    // - worker form → readonly worker (юзер на табе «Рабочие»).
    // - иначе foreman/admin/worker — выбор.
    let roleSelectHtml;
    if (isCreator) {
      roleSelectHtml = `<input type="text" id="team-f-role" value="creator" readonly style="background:#f3f4f6;color:#6b7280" />`;
    } else if (isWorkerForm) {
      roleSelectHtml = `<input type="text" id="team-f-role" value="worker" readonly style="background:#f3f4f6;color:#6b7280" />`;
    } else {
      roleSelectHtml = `<select id="team-f-role">
           <option value="foreman"${existing?.role === 'foreman' ? ' selected' : ''}>Бригадир (foreman)</option>
           <option value="admin"${existing?.role === 'admin' ? ' selected' : ''}>Администратор (admin)</option>
           <option value="worker"${existing?.role === 'worker' ? ' selected' : ''}>Рабочий (worker)</option>
         </select>`;
    }

    const projectsListHtml = allProjects.length
      ? allProjects.map(p => {
          const checked = existingSlugs.has(String(p.slug).toLowerCase()) ? ' checked' : '';
          return `<label class="team-proj-row" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px;cursor:pointer">
            <input type="checkbox" class="team-proj-cb" value="${escapeHtml(p.slug)}"${checked} />
            <span style="font-weight:500">${escapeHtml(p.name || p.slug)}</span>
            <span style="color:#9ca3af;font-size:12px">${escapeHtml(p.slug)}</span>
          </label>`;
        }).join('')
      : '<div style="color:#9ca3af;font-size:13px">Активных проектов нет</div>';

    const sub = document.createElement('div');
    sub.className = 'edit-form-overlay';
    sub.style.zIndex = 1500;
    sub.innerHTML = `
      <div class="edit-form-card">
        <div class="edit-form-head">
          <div>${isEdit ? '✎ Редактировать' : '＋ Новый участник'}</div>
          <button type="button" class="edit-form-close">×</button>
        </div>
        <label class="edit-form-row"><span>Имя</span>
          <input type="text" id="team-f-name" value="${escapeHtml(existing?.name || '')}" placeholder="Например: Иван Петров" maxlength="120" autofocus />
        </label>
        <label class="edit-form-row"><span>Роль</span>
          ${roleSelectHtml}
        </label>
        <label class="edit-form-row"><span>Telegram ID (chat_id)</span>
          <input type="text" id="team-f-tgid" value="${escapeHtml(existing?.telegramUserId || '')}" placeholder="например 123456789" />
        </label>
        <div class="edit-form-row" id="team-f-projects-row">
          <span>Доступные проекты</span>
          <div style="flex:1">
            <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-weight:500;cursor:pointer">
              <input type="checkbox" id="team-f-all-projects"${allAccess ? ' checked' : ''} />
              Все проекты <span style="color:#9ca3af;font-weight:400;font-size:12px">(включая будущие)</span>
            </label>
            <div id="team-f-projects-list" style="max-height:200px;overflow-y:auto;${allAccess ? 'opacity:0.4;pointer-events:none' : ''}">
              ${projectsListHtml}
            </div>
          </div>
        </div>
        <div class="edit-form-actions">
          <button type="button" class="edit-form-cancel" id="team-f-cancel">Отмена</button>
          <button type="button" class="edit-form-submit" id="team-f-save">${isEdit ? 'Сохранить' : 'Создать'}</button>
        </div>
        <div class="edit-form-err" id="team-f-err"></div>
      </div>
    `;
    document.body.appendChild(sub);
    const closeSub = () => sub.remove();
    sub.querySelector('.edit-form-close').addEventListener('click', closeSub);
    sub.querySelector('#team-f-cancel').addEventListener('click', closeSub);

    // Toggle multi-select когда «все проекты» переключается.
    const allCb = sub.querySelector('#team-f-all-projects');
    const projsList = sub.querySelector('#team-f-projects-list');
    allCb.addEventListener('change', () => {
      if (allCb.checked) {
        projsList.style.opacity = '0.4';
        projsList.style.pointerEvents = 'none';
      } else {
        projsList.style.opacity = '';
        projsList.style.pointerEvents = '';
      }
    });
    // Скрываем выбор проектов:
    // - creator: всегда видит всё.
    // - worker: проектов не имеет (станет foreman'ом отдельным шагом).
    if (isCreator || isWorkerForm) {
      sub.querySelector('#team-f-projects-row').style.display = 'none';
    }

    sub.querySelector('#team-f-save').addEventListener('click', async () => {
      const name = sub.querySelector('#team-f-name').value.trim();
      // Если creator/worker form — читаем из input (readonly), иначе из select.
      const roleEl = sub.querySelector('#team-f-role');
      let role = roleEl.value;
      if (isCreator) role = 'creator';
      else if (isWorkerForm) role = 'worker';
      const tg   = sub.querySelector('#team-f-tgid').value.trim();
      const allChecked = sub.querySelector('#team-f-all-projects')?.checked;
      const allowedProjects = (allChecked || isCreator || isWorkerForm || role === 'worker')
        ? []
        : Array.from(sub.querySelectorAll('.team-proj-cb:checked')).map(cb => cb.value);
      const errEl = sub.querySelector('#team-f-err');
      errEl.textContent = '';
      if (!name) { errEl.textContent = 'Введи имя'; return; }
      if (tg && !/^[\-\d]+$/.test(tg)) { errEl.textContent = 'Telegram ID — только цифры'; return; }
      if (!isCreator && !isWorkerForm && role === 'foreman' && !allChecked && !allowedProjects.length) {
        errEl.textContent = 'Выбери хотя бы один проект или включи «Все проекты»'; return;
      }
      const btn = sub.querySelector('#team-f-save');
      btn.disabled = true; btn.textContent = '…';
      try {
        await postDataAction('team:upsert', { id: existing?.id || null, name, role, telegramUserId: tg, allowedProjects });
        showToast(`✓ ${isEdit ? 'Обновлён' : 'Добавлен'}: ${name}`);
        closeSub();
        reload();
        // Обновим глобальный список ответственных — чтобы свежедобавленный foreman сразу был доступен в формах тикетов.
        if (typeof loadAssignees === 'function') loadAssignees();
      } catch (e) {
        errEl.textContent = e.message || String(e);
        btn.disabled = false; btn.textContent = isEdit ? 'Сохранить' : 'Создать';
      }
    });
  }

  reload();
}

/* ─── Reports calendar: утренние/вечерние отчёты по дням + кастомизация бригадиру ─── */
async function openReportsCalendarModal() {
  // Защита от случайного показа кросс-проектных данных: если страница открыта вне
  // конкретного проекта (state.projectSlug пуст), бэкенд при пустом slug снимает
  // фильтр и возвращает ВСЕ диспатчи — нельзя так показывать.
  if (!state.projectSlug) {
    showToast('Открой конкретный проект, чтобы увидеть его отчёты');
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay';
  overlay.style.zIndex = 1500;
  const today = new Date();
  let viewYear = today.getFullYear(), viewMonth = today.getMonth(); // 0-based
  let dispatches = []; // morning dispatches
  let eveningPings = []; // evening pings

  overlay.innerHTML = `
    <div class="edit-form-card reports-calendar-card">
      <div class="edit-form-head">
        <div>📅 Календарь отчётов</div>
        <button type="button" class="edit-form-close">×</button>
      </div>
      <div class="rc-controls">
        <button type="button" class="btn rc-prev" id="rc-prev">‹</button>
        <div class="rc-month" id="rc-month">…</div>
        <button type="button" class="btn rc-next" id="rc-next">›</button>
        <span class="rc-legend">
          <span class="rc-legend-dot rc-dot-morning"></span>утро
          <span class="rc-legend-dot rc-dot-evening"></span>вечер
          <span class="rc-legend-dot rc-dot-accepted"></span>принят
        </span>
      </div>
      <div class="rc-grid" id="rc-grid"></div>
      <div class="rc-detail" id="rc-detail">
        <div class="rc-detail-empty">Кликни на день, чтобы посмотреть отчёты.</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  async function loadMonth() {
    const first = new Date(viewYear, viewMonth, 1);
    const last = new Date(viewYear, viewMonth + 1, 0);
    const fromIso = first.toISOString().slice(0, 10);
    const toIso = new Date(last.getTime() + 86400000).toISOString().slice(0, 10);
    overlay.querySelector('#rc-month').textContent =
      first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    try {
      const [m, e] = await Promise.all([
        postDataAction('morning:list-dispatches', { slug: state.projectSlug, from: fromIso, to: toIso }),
        postDataAction('evening:list-pings', { slug: state.projectSlug, from: fromIso, to: toIso })
      ]);
      dispatches = m.dispatches || [];
      eveningPings = e.pings || [];
    } catch (err) {
      dispatches = [];
      eveningPings = [];
    }
    render();
  }

  function render() {
    const grid = overlay.querySelector('#rc-grid');
    const first = new Date(viewYear, viewMonth, 1);
    const last = new Date(viewYear, viewMonth + 1, 0);
    const startWeekday = (first.getDay() + 6) % 7; // Mon=0
    const days = last.getDate();
    const cells = [];
    // Empty cells for offset
    for (let i = 0; i < startWeekday; i++) cells.push('<div class="rc-cell rc-cell--empty"></div>');
    const todayIso = new Date().toISOString().slice(0, 10);
    for (let d = 1; d <= days; d++) {
      const dayDate = new Date(viewYear, viewMonth, d);
      const iso = dayDate.toISOString().slice(0, 10);
      const ds = dispatches.filter(x => (x.date || '').slice(0, 10) === iso);
      const ep = eveningPings.filter(x => (x.date || '').slice(0, 10) === iso);
      const hasMorning = ds.length > 0;
      const hasEvening = ep.length > 0;
      const hasAcceptedMorning = ds.some(x => x.status === 'all_accepted');
      const hasResponded = ep.some(x => x.status === 'responded');
      const isToday = iso === todayIso;
      const cls = ['rc-cell'];
      if (isToday) cls.push('rc-cell--today');
      if (hasMorning || hasEvening) cls.push('rc-cell--has');
      if (hasAcceptedMorning && hasResponded) cls.push('rc-cell--accepted');
      const dots = [];
      if (hasMorning) dots.push('<span class="rc-dot rc-dot-morning" title="Утренний отчёт"></span>');
      if (hasEvening) dots.push('<span class="rc-dot rc-dot-evening" title="Вечерний пинг"></span>');
      if (hasAcceptedMorning || hasResponded) dots.push('<span class="rc-dot rc-dot-accepted" title="Подтверждено"></span>');
      cells.push(`<div class="${cls.join(' ')}" data-iso="${iso}">
        <span class="rc-num">${d}</span>
        <span class="rc-dots">${dots.join('')}</span>
      </div>`);
    }
    grid.innerHTML = `
      <div class="rc-weekdays">
        <span>пн</span><span>вт</span><span>ср</span><span>чт</span><span>пт</span><span>сб</span><span>вс</span>
      </div>
      <div class="rc-cells">${cells.join('')}</div>
    `;
    grid.querySelectorAll('.rc-cell:not(.rc-cell--empty)').forEach(c => {
      c.addEventListener('click', () => showDayDetail(c.dataset.iso));
    });
  }

  function showDayDetail(iso) {
    const detail = overlay.querySelector('#rc-detail');
    const ds = dispatches.filter(x => (x.date || '').slice(0, 10) === iso);
    const ep = eveningPings.filter(x => (x.date || '').slice(0, 10) === iso);
    if (!ds.length && !ep.length) {
      detail.innerHTML = `<div class="rc-detail-empty">${escapeHtml(iso)} — отчётов нет.</div>`;
      return;
    }
    const fmtTime = (iso) => {
      if (!iso) return '—';
      const d = new Date(iso);
      return d.toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Dubai' });
    };
    const morningHtml = ds.map(d => {
      const status = d.status === 'all_accepted' ? '<span class="rc-status rc-status--ok">✅ Все приняли</span>'
        : d.status === 'sent' ? '<span class="rc-status rc-status--warn">📤 Отправлено бригадирам</span>'
        : d.status === 'failed' ? '<span class="rc-status rc-status--err">❌ Не отправилось</span>'
        : `<span class="rc-status">${escapeHtml(d.status)}</span>`;
      const foremenRows = (d.foremen || []).map(f =>
        `<li>${escapeHtml(f.name || f.chatId)} — ${f.acceptedAt
          ? `<b style="color:#16a34a">✅ принял ${escapeHtml(fmtTime(f.acceptedAt))}</b>`
          : (f.at ? `<i style="color:#dc2626">⏳ не подтверждено (отправлено ${escapeHtml(fmtTime(f.at))})</i>` : '<i style="color:#dc2626">не подтверждено</i>')}</li>`
      ).join('');
      return `<div class="rc-dispatch">
        <div class="rc-dispatch-head">
          <b>🌅 Утренний отчёт</b> · ${escapeHtml(d.slug)} ${status}
        </div>
        <div class="rc-meta-line">📤 Передано в ${escapeHtml(fmtTime(d.dispatchedAt))} · руководитель: ${escapeHtml(d.leaderName || d.leaderChatId)}</div>
        <details>
          <summary>📋 Что бот сгенерил для руководителя</summary>
          <pre class="rc-pre">${escapeHtml(d.originalBrief || '—')}</pre>
        </details>
        <details>
          <summary>🎤 Кастомизация руководителя (голос → текст)</summary>
          <pre class="rc-pre">${escapeHtml(d.leaderVoiceText || '(без правок)')}</pre>
        </details>
        <details>
          <summary>📨 Что увидели бригадиры (RU + UZ)</summary>
          <div class="rc-bilang">
            <div class="rc-lang"><b>🇷🇺 Русский:</b><pre class="rc-pre">${escapeHtml(d.finalRu || '')}</pre></div>
            <div class="rc-lang"><b>🇺🇿 O‘zbekcha:</b><pre class="rc-pre">${escapeHtml(d.finalUz || '')}</pre></div>
          </div>
        </details>
        <div class="rc-foremen">
          <b>👷 Бригадиры:</b>
          <ul>${foremenRows || '<li><i>нет получателей</i></li>'}</ul>
        </div>
      </div>`;
    }).join('');

    const eveningHtml = ep.map(e => {
      const status = e.status === 'responded' ? '<span class="rc-status rc-status--ok">✅ Отчёт получен</span>'
        : e.status === 'pending' ? '<span class="rc-status rc-status--warn">⏳ Ждём ответ</span>'
        : e.status === 'timed_out' ? '<span class="rc-status rc-status--err">⏰ Не ответил</span>'
        : `<span class="rc-status">${escapeHtml(e.status)}</span>`;
      const responseBlock = e.responseText
        ? `<details open>
            <summary>🎤 Голосовой ответ руководителя (${escapeHtml(fmtTime(e.responseAt))}) · применено обновлений: <b>${e.tasksUpdatedCount || 0}</b></summary>
            <pre class="rc-pre">${escapeHtml(e.responseText)}</pre>
          </details>`
        : '<div class="rc-meta-line"><i style="color:#dc2626">⏳ Голосовой ответ ещё не получен</i></div>';
      return `<div class="rc-dispatch rc-dispatch--evening">
        <div class="rc-dispatch-head">
          <b>🌙 Вечерний пинг</b> · ${escapeHtml(e.slug)} ${status}
        </div>
        <div class="rc-meta-line">📤 Отправлено в ${escapeHtml(fmtTime(e.sentAt))} · руководитель: ${escapeHtml(e.leaderName || e.leaderChatId)}</div>
        <details>
          <summary>📋 Что бот спросил у руководителя</summary>
          <pre class="rc-pre">${escapeHtml(e.pingText || '—')}</pre>
        </details>
        ${responseBlock}
      </div>`;
    }).join('');

    detail.innerHTML = `<div class="rc-day-title">📅 ${escapeHtml(iso)}</div>${morningHtml}${eveningHtml}`;
  }

  overlay.querySelector('#rc-prev').addEventListener('click', () => {
    if (viewMonth === 0) { viewMonth = 11; viewYear--; } else viewMonth--;
    loadMonth();
  });
  overlay.querySelector('#rc-next').addEventListener('click', () => {
    if (viewMonth === 11) { viewMonth = 0; viewYear++; } else viewMonth++;
    loadMonth();
  });
  loadMonth();
}

/* ─── Чёрный ящик рабочих: модалка с таблицей по дням + AI-аналитика ─── */
async function openWorkerBlackboxModal() {
  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay';
  overlay.style.zIndex = 1500;
  overlay.innerHTML = `
    <div class="edit-form-card workers-blackbox-card">
      <div class="edit-form-head">
        <div>🔇 Чат рабочих · чёрный ящик</div>
        <button type="button" class="edit-form-close">×</button>
      </div>
      <div class="team-modal-hint">
        Любое сообщение от Telegram-аккаунта, которого нет в «Менеджменте», попадает сюда. Голосовое транскрибируется,
        узбекский переводится на русский, GPT классифицирует тему и тон.
      </div>
      <div class="wbb-controls">
        <label class="wbb-range-label">Период:
          <select class="wbb-range" id="wbb-range">
            <option value="today">Сегодня</option>
            <option value="7" selected>Последние 7 дней</option>
            <option value="30">Последние 30 дней</option>
            <option value="all">Всё время</option>
          </select>
        </label>
        <button type="button" class="btn btn-primary" id="wbb-analyze">🧠 Анализ темами</button>
        <button type="button" class="btn" id="wbb-refresh">↻ Обновить</button>
      </div>
      <div class="wbb-summary" id="wbb-summary" style="display:none"></div>
      <div class="wbb-list" id="wbb-list">
        <div class="team-loading">Загружаю…</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function escClose(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); } });

  const list = overlay.querySelector('#wbb-list');
  const summary = overlay.querySelector('#wbb-summary');

  function pickRange() {
    const v = overlay.querySelector('#wbb-range').value;
    const now = new Date();
    if (v === 'today') {
      const f = new Date(now); f.setHours(0,0,0,0);
      return { from: f.toISOString() };
    }
    if (v === '7' || v === '30') {
      const f = new Date(now); f.setDate(f.getDate() - Number(v));
      return { from: f.toISOString() };
    }
    return {};
  }

  async function reload() {
    list.innerHTML = '<div class="team-loading">Загружаю…</div>';
    summary.style.display = 'none';
    try {
      const r = await postDataAction('worker:list-messages', { ...pickRange(), limit: 500 });
      const msgs = r.messages || [];
      if (!msgs.length) { list.innerHTML = '<div class="team-loading">За период сообщений нет.</div>'; return; }
      // Группируем по дню
      const byDay = {};
      for (const m of msgs) {
        const d = (m.at || '').slice(0, 10) || '—';
        (byDay[d] ||= []).push(m);
      }
      const days = Object.keys(byDay).sort().reverse();
      list.innerHTML = days.map(d => {
        const dayMsgs = byDay[d];
        const dateLabel = d === '—' ? 'Без даты' : new Date(d + 'T12:00:00Z').toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric', weekday:'short' });
        const rows = dayMsgs.map(m => {
          const name = m.firstName || m.telegramUsername || ('@id ' + m.telegramUserId);
          const time = (m.at || '').slice(11, 16);
          const langBadge = m.language === 'uz' ? '<span class="wbb-lang-badge wbb-lang-uz">UZ</span>' : (m.language === 'ru' ? '<span class="wbb-lang-badge wbb-lang-ru">RU</span>' : `<span class="wbb-lang-badge">${escapeHtml(m.language)}</span>`);
          const catLabel = ({complaint:'⚠️ жалоба', question:'❓ вопрос', status_update:'🟢 статус', suggestion:'💡 идея', safety:'🚨 безопасность', materials:'📦 материалы', other:'·'})[m.category] || m.category || '·';
          const sentBadge = m.sentiment === 'negative' ? '🔴' : (m.sentiment === 'positive' ? '🟢' : '⚪');
          const orig = (m.language === 'uz' && m.messageOriginal && m.messageOriginal !== m.messageRu)
            ? `<div class="wbb-orig">UZ: <i>${escapeHtml(m.messageOriginal)}</i></div>`
            : '';
          const audioBtn = m.source === 'voice' ? '<span class="wbb-voice" title="Это было голосовое">🎤</span>' : '';
          return `<details class="wbb-msg" ${dayMsgs.length <= 5 ? 'open' : ''}>
            <summary class="wbb-msg-head">
              <span class="wbb-time">${time}</span>
              <span class="wbb-name">${escapeHtml(name)} ${audioBtn}</span>
              ${langBadge}
              <span class="wbb-cat">${catLabel}</span>
              <span class="wbb-sent">${sentBadge}</span>
            </summary>
            <div class="wbb-body">
              <div class="wbb-ru">${escapeHtml(m.messageRu || m.messageOriginal || '')}</div>
              ${orig}
            </div>
          </details>`;
        }).join('');
        return `<div class="wbb-day">
          <div class="wbb-day-head">${escapeHtml(dateLabel)} <span class="wbb-day-count">${dayMsgs.length} сообщ.</span></div>
          <div class="wbb-day-body">${rows}</div>
        </div>`;
      }).join('');
    } catch (e) {
      list.innerHTML = `<div class="team-loading" style="color:#b91c1c">Ошибка: ${escapeHtml(e.message || String(e))}</div>`;
    }
  }

  overlay.querySelector('#wbb-refresh').addEventListener('click', reload);
  overlay.querySelector('#wbb-range').addEventListener('change', reload);
  // __ANALYZE_DEBOUNCE_v1__ GPT-вызов стоит денег. Защищаем от множественных кликов:
  // блокируем кнопку на время запроса + cooldown 5s после успеха/ошибки.
  let _wbbAnalyzeBusy = false;
  let _wbbAnalyzeCooldownUntil = 0;
  const analyzeBtn = overlay.querySelector('#wbb-analyze');
  analyzeBtn.addEventListener('click', async () => {
    if (_wbbAnalyzeBusy) return;
    if (Date.now() < _wbbAnalyzeCooldownUntil) {
      const sec = Math.ceil((_wbbAnalyzeCooldownUntil - Date.now()) / 1000);
      summary.style.display = 'block';
      summary.innerHTML = `<i>Подожди ${sec} сек перед повторным анализом</i>`;
      return;
    }
    _wbbAnalyzeBusy = true;
    analyzeBtn.disabled = true;
    summary.style.display = 'block';
    summary.innerHTML = '<div class="team-loading">GPT анализирует…</div>';
    try {
      const r = await postDataAction('worker:analyze', { ...pickRange() });
      if (!r.summary) { summary.innerHTML = '<i>Анализ недоступен (' + escapeHtml(r.reason || 'нет данных') + ')</i>'; return; }
      summary.innerHTML = `<div class="wbb-summary-head">🧠 Анализ (${r.count} сообщ.)</div><div class="wbb-summary-body">${escapeHtml(r.summary).replace(/\n/g, '<br>')}</div>`;
    } catch (e) {
      summary.innerHTML = '<i style="color:#b91c1c">Ошибка анализа: ' + escapeHtml(e.message || String(e)) + '</i>';
    } finally {
      _wbbAnalyzeBusy = false;
      _wbbAnalyzeCooldownUntil = Date.now() + 5000;
      analyzeBtn.disabled = false;
    }
  });

  reload();
}

// __PROJECT_RESET_v1__ 2026-05-19 — сброс проекта к первичному состоянию.
// Возвращает schedule.json к первому commit'у (момент авто-создания), включая planning-режим.
async function confirmResetProject() {
  const p = state.schedule?.project;
  if (!p) { alert('Проект не загружен'); return; }
  const expected = (p.name || '').trim();
  const typed = prompt(
    `↺ Сбросить проект «${expected}» к первичному состоянию?\n\n` +
    `Будет удалено / отменено ВСЁ что появилось после авто-создания:\n` +
    `  • факт-даты, прогресс, паузы, история работ\n` +
    `  • добавленные/удалённые работы и разделы (вернутся к исходным)\n` +
    `  • сдвинутые плановые даты\n` +
    `  • ВСЕ тикеты этого проекта в PlanRadar\n` +
    `  • все Airtable-записи: ответственные, обновления, заметки, материалы, ресурсы, утренние/вечерние сводки, чат рабочих\n` +
    `  • статус «проект запущен» — вернётся в режим настройки\n\n` +
    `Это нельзя отменить через UI — но из истории GitHub при необходимости можно вытащить вручную.\n\n` +
    `Введи название проекта точно как «${expected}» для подтверждения:`
  );
  if (typed === null) return;
  if ((typed || '').trim().toLowerCase() !== expected.toLowerCase()) {
    alert('Название не совпало. Сброс отменён.');
    return;
  }
  showToast('Сбрасываю проект (чищу тикеты + Airtable + восстанавливаю schedule)…');
  try {
    const r = await postDataAction('project:reset', { slug: p.slug, confirmName: typed });
    showToast(`✓ «${r.name || expected}» сброшен · тикетов удалено: ${r.ticketsDeleted || 0} · Airtable: ${r.airtableDeleted || 0}. Перезагружаю…`);
    setTimeout(() => { window.location.reload(); }, 1800);
  } catch (e) {
    showToast('Не удалось сбросить: ' + (e.message || e), 'error');
  }
}

async function confirmDeleteProject() {
  const p = state.schedule?.project;
  if (!p) { alert('Проект не загружен'); return; }
  const expected = (p.name || '').trim();
  const typed = prompt(
    `⚠️ Удалить ВЕСЬ проект «${expected}»?\n\n` +
    `Будут удалены график, материалы, ресурсы, зависимости и заметки.\n` +
    `Проект исчезнет с главной страницы. Это НЕЛЬЗЯ отменить.\n\n` +
    `Введи название проекта точно как «${expected}» для подтверждения:`
  );
  if (typed === null) return; // Cancel
  if ((typed || '').trim().toLowerCase() !== expected.toLowerCase()) {
    alert('Название не совпало. Удаление отменено.');
    return;
  }
  showToast('Удаляю проект…');
  try {
    const r = await postDataAction('project:delete', { slug: p.slug, confirmName: typed });
    showToast(`✓ «${r.name || expected}» удалён`);
    setTimeout(() => { window.location.href = '/'; }, 1500);
  } catch (e) {
    showToast('Не удалось: ' + (e.message || e), 'error');
  }
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


/* ──────────────────────────────────────────────────────────── */
/*  КП badge popover                                            */
/* ──────────────────────────────────────────────────────────── */

/* ─── Task label hover tooltip ─── */
let _taskTipBound = false;
let _taskTipTimer = null;
function bindTaskTooltip() {
  if (_taskTipBound) return;
  _taskTipBound = true;
  const tip = document.getElementById('task-tip');
  if (!tip) return;
  let currentTid = null;

  const showTip = (label) => {
    const tid = label.getAttribute('data-tid');
    if (!tid || tid === currentTid) return;
    const t = state.schedule?.tasks?.find(x => x.id === tid);
    if (!t) return;
    currentTid = tid;
    const sec = state.sectionById?.[t.section] || { name: '—', color: '#94a3b8' };
    const pStart = t.planStart || t.start;
    const pEnd = t.planEnd || t.end;
    const dates = (pStart && pEnd) ? `${fmtDate(pStart)} → ${fmtDate(pEnd)}` : '';
    const _openP = Array.isArray(t.pauses) ? t.pauses.find(p => p && !p.to) : null;
    const _pauseLine = _openP
      ? `<div class="task-tip-pause">⏸ На паузе с ${escapeHtml(fmtDate(_openP.from))} · ${escapeHtml((_openP.reason || '').slice(0, 80))}</div>`
      : '';
    tip.innerHTML = `
      <div class="task-tip-name">${escapeHtml(t.name)}</div>
      <div class="task-tip-meta">
        <span class="task-tip-dot" style="background:${sec.color}"></span>${escapeHtml(sec.name)}${dates ? ' · ' + escapeHtml(dates) : ''}
      </div>
      ${_pauseLine}
    `;
    // Position: anchor to label, prefer right of column with a small offset
    const rect = label.getBoundingClientRect();
    tip.hidden = false;
    // Wait one frame so width is correct
    requestAnimationFrame(() => {
      const tipRect = tip.getBoundingClientRect();
      let left = rect.right + 8;
      let top = rect.top + rect.height / 2 - tipRect.height / 2;
      // Flip below if not enough room on right
      if (left + tipRect.width > window.innerWidth - 8) {
        left = Math.max(8, rect.left - tipRect.width - 8);
      }
      // Clamp vertically
      top = Math.max(8, Math.min(window.innerHeight - tipRect.height - 8, top));
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    });
  };
  const hideTip = () => {
    currentTid = null;
    tip.hidden = true;
  };

  document.addEventListener('mouseover', (e) => {
    const label = e.target.closest('.task-label');
    if (!label) {
      // Hide unless moving into the tip itself
      if (!e.target.closest('#task-tip') && !tip.hidden) {
        clearTimeout(_taskTipTimer);
        _taskTipTimer = setTimeout(hideTip, 80);
      }
      return;
    }
    clearTimeout(_taskTipTimer);
    _taskTipTimer = setTimeout(() => showTip(label), 120);
  });
  document.addEventListener('mouseout', (e) => {
    const label = e.target.closest('.task-label');
    if (!label) return;
    const to = e.relatedTarget;
    if (to && (to.closest?.('.task-label') || to.closest?.('#task-tip'))) return;
    clearTimeout(_taskTipTimer);
    _taskTipTimer = setTimeout(hideTip, 80);
  });
  // Hide on scroll/click anywhere
  window.addEventListener('scroll', hideTip, true);
  document.addEventListener('click', hideTip);
}

/* ─── Floating «К шапке» FAB ─── */
let _topFabBound = false;
function bindTopFab() {
  if (_topFabBound) return;
  _topFabBound = true;
  const fab = document.getElementById('top-fab');
  if (!fab) return;
  // Порог: показываем когда юзер «залип» в Гантте — сразу как только сам график
  // прокрутил под верх viewport'а (это совпадает с тем, что .gantt-wrap стал sticky).
  const THRESHOLD = 280;
  let shown = false;
  const update = () => {
    const want = window.scrollY > THRESHOLD;
    if (want === shown) return;
    shown = want;
    if (want) {
      fab.hidden = false;
      // запускаем анимацию входа — на следующий кадр
      requestAnimationFrame(() => fab.classList.add('is-visible'));
    } else {
      fab.classList.remove('is-visible');
      // спрятать после анимации
      setTimeout(() => { if (!shown) fab.hidden = true; }, 200);
    }
  };
  fab.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
}

/* ════════════════════════════════════════════════════════════════════ */
/*  Edit mode — переименование/добавление/удаление работ и разделов     */
/* ════════════════════════════════════════════════════════════════════ */

let _editModeBound = false;
function bindEditMode() {
  if (_editModeBound) return;
  _editModeBound = true;

  // Делегированный click — поверх обычных handler'ов; capture-phase, чтобы
  // перехватить клик до .section-label collapse.
  document.addEventListener('click', (e) => {
    // Empty-state CTA: работает ВНЕ edit-mode (включает edit-mode сам и открывает форму).
    const emptyCta = e.target.closest('[data-empty-cta][data-add-section]');
    if (emptyCta) {
      e.stopPropagation(); e.preventDefault();
      if (!state.editMode) {
        state.editMode = true;
        document.body.classList.add('is-edit-mode');
        const editBtn = document.getElementById('btn-edit');
        if (editBtn) editBtn.setAttribute('data-active', 'true');
      }
      openAddSectionForm(emptyCta);
      return;
    }
    // Empty-section row (раздел без работ): тоже работает вне edit-mode.
    const emptyTaskRow = e.target.closest('.empty-section-row[data-add-task]');
    if (emptyTaskRow) {
      e.stopPropagation(); e.preventDefault();
      if (!state.editMode) {
        state.editMode = true;
        document.body.classList.add('is-edit-mode');
        const editBtn = document.getElementById('btn-edit');
        if (editBtn) editBtn.setAttribute('data-active', 'true');
      }
      const sid = emptyTaskRow.getAttribute('data-add-task');
      openAddTaskForm(sid, emptyTaskRow);
      return;
    }

    // ── Stage manager: работает в любом режиме (просмотр + правка) ──
    const manageStageAlways = e.target.closest('[data-stage-manage]');
    // Сначала проверим под-кнопки внутри chip'а (rename / del / add) — они приоритетнее manage
    const editStageAny = e.target.closest('[data-edit-stage]');
    const delStageAny = e.target.closest('[data-del-stage]');
    const addStageAny = e.target.closest('[data-add-stage]');
    if (delStageAny) {
      e.stopPropagation(); e.preventDefault();
      const stid = delStageAny.getAttribute('data-del-stage');
      confirmDeleteStage(stid);
      return;
    }
    if (addStageAny) {
      e.stopPropagation(); e.preventDefault();
      openAddStageForm();
      return;
    }
    // Rename — только в edit-mode (иначе trickle-down к manage)
    if (editStageAny && state.editMode) {
      e.stopPropagation(); e.preventDefault();
      const stid = editStageAny.getAttribute('data-edit-stage');
      startInlineEditStageName(stid);
      return;
    }
    // Manage — всегда (включая просмотр)
    if (manageStageAlways) {
      e.stopPropagation(); e.preventDefault();
      const stid = manageStageAlways.getAttribute('data-stage-manage');
      openStageManager(stid);
      return;
    }

    if (!state.editMode) return;

    const editProject = e.target.closest('[data-edit-project-name]');
    if (editProject) {
      e.stopPropagation(); e.preventDefault();
      startInlineEditProjectName();
      return;
    }
    // (старый блок stage-rename теперь обработан выше)
    const _NOOP_StageManage = e.target.closest('[data-stage-manage-LEGACY-DEAD]');
    if (_NOOP_StageManage) {
      e.stopPropagation(); e.preventDefault();
      const stid = _NOOP_StageManage.getAttribute('data-stage-manage-LEGACY-DEAD');
      openStageManager(stid);
      return;
    }

    const editTask = e.target.closest('[data-edit-task]');
    if (editTask) {
      e.stopPropagation(); e.preventDefault();
      const tid = editTask.getAttribute('data-edit-task');
      startInlineEditTaskName(tid);
      return;
    }
    const editSection = e.target.closest('[data-edit-section]');
    if (editSection) {
      e.stopPropagation(); e.preventDefault();
      const sid = editSection.getAttribute('data-edit-section');
      startInlineEditSectionName(sid);
      return;
    }
    const editColor = e.target.closest('.section-dot-edit');
    if (editColor) {
      e.stopPropagation(); e.preventDefault();
      const sid = editColor.getAttribute('data-section-id');
      openSectionColorPicker(sid, editColor);
      return;
    }
    const delTask = e.target.closest('[data-del-task]');
    if (delTask) {
      e.stopPropagation(); e.preventDefault();
      const tid = delTask.getAttribute('data-del-task');
      confirmDeleteTask(tid);
      return;
    }
    const datesTask = e.target.closest('[data-dates-task]');
    if (datesTask) {
      e.stopPropagation(); e.preventDefault();
      const tid = datesTask.getAttribute('data-dates-task');
      openTaskDatesEditor(tid);
      return;
    }
    const pauseTask = e.target.closest('[data-pause-task]');
    if (pauseTask) {
      e.stopPropagation(); e.preventDefault();
      const tid = pauseTask.getAttribute('data-pause-task');
      openTaskPauseForm(tid);
      return;
    }
    const resumeTask = e.target.closest('[data-resume-task]');
    if (resumeTask) {
      e.stopPropagation(); e.preventDefault();
      const tid = resumeTask.getAttribute('data-resume-task');
      openTaskResumeForm(tid);
      return;
    }
    const pauseDel = e.target.closest('[data-pause-del-task]');
    if (pauseDel) {
      e.stopPropagation(); e.preventDefault();
      const tid = pauseDel.getAttribute('data-pause-del-task');
      const pid = pauseDel.getAttribute('data-pause-del-id');
      if (!tid || !pid) return;
      if (!confirm('Удалить эту запись паузы из истории?')) return;
      (async () => {
        try {
          const r = await postDataAction('task:pause-delete', { slug: state.projectSlug, taskId: tid, pauseId: pid });
          if (r.schedule) state.schedule = r.schedule;
          renderGantt(); renderTasksSheet();
          try { renderProjectAnalytics(); } catch (_) {}
          if (typeof openDrawer === 'function') openDrawer(tid);
          showToast('✓ Запись паузы удалена');
        } catch (err) { showToast('Ошибка: ' + (err.message || err), 'error'); }
      })();
      return;
    }
    const pauseBarDel = e.target.closest('[data-pause-bar-del]');
    if (pauseBarDel) {
      e.stopPropagation(); e.preventDefault();
      const tid = pauseBarDel.getAttribute('data-pause-bar-del');
      const pid = pauseBarDel.getAttribute('data-pause-bar-id');
      if (!tid || !pid) return;
      (async () => {
        try {
          const r = await postDataAction('task:pause-delete', { slug: state.projectSlug, taskId: tid, pauseId: pid });
          if (r.schedule) state.schedule = r.schedule;
          renderGantt(); renderTasksSheet();
          try { renderProjectAnalytics(); } catch (_) {}
          showToast('✓ Пауза удалена');
        } catch (err) { showToast('Ошибка: ' + (err.message || err), 'error'); }
      })();
      return;
    }
    const delSection = e.target.closest('[data-del-section]');
    if (delSection) {
      e.stopPropagation(); e.preventDefault();
      const sid = delSection.getAttribute('data-del-section');
      confirmDeleteSection(sid);
      return;
    }
    const addTask = e.target.closest('[data-add-task]');
    if (addTask) {
      e.stopPropagation(); e.preventDefault();
      const sid = addTask.getAttribute('data-add-task');
      openAddTaskForm(sid, addTask);
      return;
    }
    const addSection = e.target.closest('[data-add-section]');
    if (addSection) {
      e.stopPropagation(); e.preventDefault();
      // Если клик из empty-state CTA — автоматически включить edit-mode,
      // чтобы после создания первого раздела юзер видел все кнопки управления.
      if (addSection.hasAttribute('data-empty-cta') && !state.editMode) {
        state.editMode = true;
        document.body.classList.add('is-edit-mode');
        const editBtn = document.getElementById('btn-edit');
        if (editBtn) editBtn.setAttribute('data-active', 'true');
      }
      openAddSectionForm(addSection);
      return;
    }
    // Inline-edit при клике по самому имени (если в edit mode)
    const editName = e.target.closest('[data-edit-name]');
    if (editName) {
      const tid = editName.getAttribute('data-tid');
      const sid = editName.getAttribute('data-section-id');
      if (tid) { e.stopPropagation(); e.preventDefault(); startInlineEditTaskName(tid); return; }
      if (sid) { e.stopPropagation(); e.preventDefault(); startInlineEditSectionName(sid); return; }
    }
  }, true);
}

function startInlineEditTaskName(taskId) {
  // __INLINE_EDIT_DRAG_GUARD_v1__ Если в момент клика идёт drag bar — не запускать inline edit.
  // Иначе pointer race: drag захватил pointer, input.blur не отрабатывает корректно.
  if (_dragState && _dragState.active) return;
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(taskId));
  if (!t) return;
  const labelEl = document.querySelector(`.task-label[data-tid="${cssEscape(taskId)}"] .tname`);
  if (!labelEl) return;
  inlineEdit(labelEl, t.name, async (newName) => {
    if (!newName || newName === t.name) return;
    const prevName = t.name;
    showToast('Сохраняю…');
    try {
      const r = await postDataAction('task:update', { slug: state.projectSlug, taskId, patch: { name: newName } });
      t.name = newName;
      if (r.schedule) state.schedule = r.schedule;
      renderGantt();
      renderTasksSheet();
      showToast(`✓ Сохранено: «${newName}»`, { action: { label: 'Отменить', onClick: async () => {
        const r2 = await postDataAction('task:update', { slug: state.projectSlug, taskId, patch: { name: prevName } });
        t.name = prevName;
        if (r2.schedule) state.schedule = r2.schedule;
        renderGantt();
        renderTasksSheet();
        showToast(`↶ Возвращено: «${prevName}»`);
      } } });
    } catch (e) {
      showToast('Не удалось сохранить: ' + (e.message || e), 'error');
    }
  });
}

function renderStagesBar() {
  const host = document.getElementById('stages-bar-host');
  if (!host) return;
  const stages = state.schedule?.stages || [];
  const tasks = state.schedule?.tasks || [];
  const chips = stages.map(st => {
    const taskCount = tasks.filter(t => String(t.stage) === String(st.id)).length;
    return `
    <div class="stage-chip" data-stage-id="${escapeHtml(st.id)}" data-stage-manage="${escapeHtml(st.id)}" style="--st-color:${st.color || '#94a3b8'}" title="Клик — управление работами этапа">
      <span class="stage-chip-dot" aria-hidden="true"></span>
      <span class="stage-chip-name" data-edit-stage="${escapeHtml(st.id)}" title="В режиме Правка клик переименует этап">${escapeHtml(st.name)}</span>
      <span class="stage-chip-count" title="Работ в этапе">${taskCount}</span>
      <button type="button" class="stage-chip-del" data-del-stage="${escapeHtml(st.id)}" title="Удалить этап">×</button>
    </div>`;
  }).join('');
  // Orphan-задачи (stage не в списке этапов) — отдельным чипом-предупреждением
  const stageIds = new Set(stages.map(s => String(s.id)));
  const orphanCount = tasks.filter(t => t.stage && !stageIds.has(String(t.stage))).length;
  const orphanChip = orphanCount ? `
    <div class="stage-chip stage-chip-orphan" data-stage-manage="__orphan__" title="Работы без этапа — клик чтобы распределить" style="--st-color:#ef4444">
      <span class="stage-chip-dot" aria-hidden="true"></span>
      <span class="stage-chip-name">⚠ Без этапа</span>
      <span class="stage-chip-count">${orphanCount}</span>
    </div>` : '';
  host.innerHTML = `
    <div class="stages-bar">
      <div class="stages-bar-label">Этапы:</div>
      <div class="stages-bar-list">${chips}${orphanChip}<button type="button" class="stage-add-btn" data-add-stage title="Создать новый этап">+ Этап</button></div>
    </div>
  `;
}

function startInlineEditStageName(stageId) {
  const stage = (state.schedule?.stages || []).find(s => String(s.id) === String(stageId));
  if (!stage) return;
  const labelEl = document.querySelector(`.stage-chip[data-stage-id="${cssEscape(stageId)}"] .stage-chip-name`);
  if (!labelEl) return;
  inlineEdit(labelEl, stage.name, async (newName) => {
    if (!newName || newName === stage.name) return;
    const prev = stage.name;
    showToast('Сохраняю…');
    try {
      const r = await postDataAction('stage:update', { slug: state.projectSlug, stageId, patch: { name: newName } });
      stage.name = newName;
      if (r.schedule) state.schedule = r.schedule;
      renderGantt();
      showToast(`✓ Этап переименован: «${newName}»`, { action: { label: 'Отменить', onClick: async () => {
        const r2 = await postDataAction('stage:update', { slug: state.projectSlug, stageId, patch: { name: prev } });
        stage.name = prev;
        if (r2.schedule) state.schedule = r2.schedule;
        renderGantt();
        showToast(`↶ Возвращено: «${prev}»`);
      } } });
    } catch (e) {
      showToast('Не удалось сохранить: ' + (e.message || e), 'error');
    }
  });
}

async function confirmDeleteStage(stageId) {
  const stage = (state.schedule?.stages || []).find(s => String(s.id) === String(stageId));
  if (!stage) return;
  const orphans = (state.schedule?.tasks || []).filter(t => String(t.stage) === String(stageId));
  // Если на этапе висят задачи — спрашиваем куда их перенести.
  let reassignTo = null;
  if (orphans.length) {
    const others = (state.schedule?.stages || []).filter(s => String(s.id) !== String(stageId));
    if (!others.length) {
      showToast('⚠ Это единственный этап. Создай ещё один — тогда смогу перенести работы.', 'error');
      return;
    }
    const labels = others.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    const choice = prompt(
      `В этапе «${stage.name}» ${orphans.length} ${plural(orphans.length, ['работа','работы','работ'])}.\nКуда их перенести перед удалением?\n\n${labels}\n\nВведи номер этапа (1-${others.length}) или Cancel.`
    );
    if (!choice) return;
    const idx = parseInt(choice, 10) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= others.length) {
      showToast('Неверный номер. Удаление отменено.', 'error');
      return;
    }
    reassignTo = others[idx].id;
  }
  if (!confirm(`Удалить этап «${stage.name}»${reassignTo ? ` (${orphans.length} работ переедут в «${(state.schedule?.stages||[]).find(s=>s.id===reassignTo)?.name}»)` : ''}?`)) return;
  showToast('Удаляю…');
  try {
    const r = await postDataAction('stage:delete', { slug: state.projectSlug, stageId, reassignTo });
    if (r.schedule) state.schedule = r.schedule;
    renderGantt();
    showToast(`✓ Этап «${stage.name}» удалён${orphans.length ? ` (${orphans.length} работ перенесены)` : ''}`);
  } catch (e) {
    showToast('Не удалось удалить: ' + (e.message || e), 'error');
  }
}

/* ─── Stage Manager: модал со списком работ этапа + перенос между этапами ─── */
function openStageManager(stageId) {
  const isOrphan = stageId === '__orphan__';
  const stages = state.schedule?.stages || [];
  const tasks = state.schedule?.tasks || [];
  const stage = isOrphan ? { id: '__orphan__', name: '⚠ Без этапа', color: '#ef4444' } : stages.find(s => String(s.id) === String(stageId));
  if (!stage) return;
  const stageIds = new Set(stages.map(s => String(s.id)));
  const tasksInStage = isOrphan
    ? tasks.filter(t => !t.stage || !stageIds.has(String(t.stage)))
    : tasks.filter(t => String(t.stage) === String(stageId));
  const tasksOutside = isOrphan
    ? tasks.filter(t => t.stage && stageIds.has(String(t.stage)))
    : tasks.filter(t => String(t.stage) !== String(stageId));

  const sectionMap = {};
  for (const sec of (state.schedule?.sections || [])) sectionMap[sec.id] = sec.name;

  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay stage-manager-overlay';

  const otherStages = stages.filter(s => !isOrphan ? String(s.id) !== String(stageId) : true);

  const renderTaskRow = (t, inStage) => {
    const sectionName = sectionMap[t.section] || '—';
    const stageName = (stages.find(s => s.id === t.stage)?.name) || (isOrphan && !t.stage ? 'без этапа' : 'неизв.');
    const dateStr = t.planStart && t.planEnd ? `${fmtDate(t.planStart)} → ${fmtDate(t.planEnd)}` : '';
    if (inStage) {
      return `<li class="sm-task" data-task-id="${escapeHtml(t.id)}">
        <button type="button" class="sm-task-remove" data-sm-remove="${escapeHtml(t.id)}" title="Убрать из этапа">←</button>
        <div class="sm-task-info">
          <div class="sm-task-name">${escapeHtml(t.name)}</div>
          <div class="sm-task-meta">${escapeHtml(sectionName)}${dateStr ? ` · ${escapeHtml(dateStr)}` : ''}</div>
        </div>
      </li>`;
    }
    return `<li class="sm-task sm-task-other" data-task-id="${escapeHtml(t.id)}">
      <input type="checkbox" class="sm-task-pick" data-sm-pick="${escapeHtml(t.id)}" id="sm-pick-${escapeHtml(t.id)}" />
      <label for="sm-pick-${escapeHtml(t.id)}" class="sm-task-info">
        <div class="sm-task-name">${escapeHtml(t.name)}</div>
        <div class="sm-task-meta">${escapeHtml(sectionName)} · ${escapeHtml(stageName)}${dateStr ? ` · ${escapeHtml(dateStr)}` : ''}</div>
      </label>
    </li>`;
  };

  overlay.innerHTML = `
    <div class="edit-form-card stage-manager-card">
      <div class="edit-form-head">
        <div><span class="sm-color-dot" style="background:${stage.color || '#94a3b8'}"></span>${escapeHtml(stage.name)} <span class="sm-counter">· ${tasksInStage.length} ${plural(tasksInStage.length,['работа','работы','работ'])}</span></div>
        <button type="button" class="edit-form-close">×</button>
      </div>
      <div class="sm-cols">
        <div class="sm-col">
          <div class="sm-col-title">В этапе</div>
          <ul class="sm-task-list" id="sm-list-in">
            ${tasksInStage.length ? tasksInStage.map(t => renderTaskRow(t, true)).join('') : '<li class="sm-empty">— пусто —</li>'}
          </ul>
        </div>
        <div class="sm-col">
          <div class="sm-col-title">Добавить из других этапов</div>
          <input type="search" class="sm-search" placeholder="Поиск по названию…" id="sm-search" />
          <ul class="sm-task-list sm-task-list-outside" id="sm-list-out">
            ${tasksOutside.length ? tasksOutside.map(t => renderTaskRow(t, false)).join('') : '<li class="sm-empty">— нет других работ —</li>'}
          </ul>
          <button type="button" class="sm-add-btn" id="sm-add-btn" disabled>＋ Добавить выбранные в этап</button>
        </div>
      </div>
      <div class="sm-foot">
        ${isOrphan ? '' : `<button type="button" class="sm-stage-delete" data-sm-stage-delete>🗑 Удалить этап</button>`}
        <div class="sm-foot-spacer"></div>
        <button type="button" class="edit-form-cancel sm-close">Закрыть</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.querySelector('.sm-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Поиск
  const search = overlay.querySelector('#sm-search');
  const listOut = overlay.querySelector('#sm-list-out');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase().trim();
      listOut.querySelectorAll('.sm-task').forEach(li => {
        const name = (li.querySelector('.sm-task-name')?.textContent || '').toLowerCase();
        const sec = (li.querySelector('.sm-task-meta')?.textContent || '').toLowerCase();
        li.style.display = (!q || name.includes(q) || sec.includes(q)) ? '' : 'none';
      });
    });
  }

  // Pick checkbox → enable add button
  const addBtn = overlay.querySelector('#sm-add-btn');
  function refreshAddBtn() {
    const picked = overlay.querySelectorAll('.sm-task-pick:checked').length;
    addBtn.disabled = !picked;
    addBtn.textContent = picked ? `＋ Добавить ${picked} в этап` : '＋ Добавить выбранные в этап';
  }
  overlay.addEventListener('change', e => { if (e.target.matches('.sm-task-pick')) refreshAddBtn(); });

  // Add picked tasks to stage
  addBtn?.addEventListener('click', async () => {
    if (isOrphan) { showToast('Назначай этап задачам через клик по этапу', 'error'); return; }
    const ids = Array.from(overlay.querySelectorAll('.sm-task-pick:checked')).map(el => el.getAttribute('data-sm-pick'));
    if (!ids.length) return;
    addBtn.disabled = true; addBtn.textContent = 'Сохраняю…';
    try {
      const r = await postDataAction('stage:assign-tasks', { slug: state.projectSlug, stageId, taskIds: ids });
      if (r.schedule) state.schedule = r.schedule;
      renderGantt();
      showToast(`✓ ${r.assigned} ${plural(r.assigned, ['работа','работы','работ'])} в этап «${stage.name}»`);
      close();
      // Re-open with fresh data so user can continue
      setTimeout(() => openStageManager(stageId), 50);
    } catch (e) {
      showToast('Не удалось: ' + (e.message || e), 'error');
      addBtn.disabled = false; refreshAddBtn();
    }
  });

  // Remove task from stage (puts back to first OTHER stage)
  overlay.addEventListener('click', async e => {
    const rm = e.target.closest('[data-sm-remove]');
    if (!rm) return;
    const tid = rm.getAttribute('data-sm-remove');
    // Move to first available "other" stage. If isOrphan — assign to first stage.
    const targetStage = isOrphan ? stages[0]?.id : (otherStages[0]?.id);
    if (!targetStage) { showToast('Нет другого этапа — сначала создай ещё один', 'error'); return; }
    const targetName = stages.find(s => s.id === targetStage)?.name || targetStage;
    rm.disabled = true;
    try {
      const r = await postDataAction('task:update', { slug: state.projectSlug, taskId: tid, patch: { stage: targetStage } });
      if (r.schedule) state.schedule = r.schedule;
      renderGantt();
      showToast(`→ Работа в этап «${targetName}»`);
      close();
      setTimeout(() => openStageManager(stageId), 50);
    } catch (e) {
      showToast('Не удалось: ' + (e.message || e), 'error');
      rm.disabled = false;
    }
  });

  // Delete stage button
  overlay.querySelector('[data-sm-stage-delete]')?.addEventListener('click', async () => {
    close();
    confirmDeleteStage(stageId);
  });
}

function openAddStageForm() {
  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay';
  const colors = ['#1e3b60','#2d6a8f','#c9a96e','#8a5a44','#ef4444','#f59e0b','#22c55e','#3b82f6','#8b5cf6','#a855f7','#ec4899','#94a3b8'];
  const colorChips = colors.map(c => `<button type="button" class="ef-color" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
  overlay.innerHTML = `
    <div class="edit-form-card">
      <div class="edit-form-head">
        <div>+ Новый этап</div>
        <button type="button" class="edit-form-close">×</button>
      </div>
      <label class="edit-form-row"><span>Название</span>
        <input type="text" id="ef-name" maxlength="80" placeholder="Например: Этап 5 · Гарантия" autofocus />
      </label>
      <div class="edit-form-row"><span>Цвет</span>
        <div class="ef-colors">${colorChips}</div>
      </div>
      <div class="edit-form-actions">
        <button type="button" class="edit-form-cancel">Отмена</button>
        <button type="button" class="edit-form-submit">Создать</button>
      </div>
      <div class="edit-form-err" id="ef-err"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  let chosenColor = colors[0];
  const colorEls = overlay.querySelectorAll('.ef-color');
  const markChosen = () => { colorEls.forEach(el => el.classList.toggle('is-chosen', el.getAttribute('data-color') === chosenColor)); };
  markChosen();
  colorEls.forEach(el => el.addEventListener('click', () => { chosenColor = el.getAttribute('data-color'); markChosen(); }));
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.querySelector('.edit-form-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#ef-name').focus();
  overlay.querySelector('.edit-form-submit').addEventListener('click', async () => {
    const name = overlay.querySelector('#ef-name').value.trim();
    const err = overlay.querySelector('#ef-err');
    if (!name) { err.textContent = 'Введи название этапа'; return; }
    err.textContent = '';
    const submitBtn = overlay.querySelector('.edit-form-submit');
    submitBtn.disabled = true; submitBtn.textContent = 'Создаю…';
    try {
      const r = await postDataAction('stage:create', { slug: state.projectSlug, name, color: chosenColor });
      // r.stage = новый этап. Обновим в state.schedule.stages.
      if (r.stage) {
        state.schedule.stages = state.schedule.stages || [];
        state.schedule.stages.push(r.stage);
      }
      renderGantt();
      close();
      showToast(`✓ Этап «${name}» создан`);
    } catch (e) {
      err.textContent = 'Не удалось создать: ' + (e.message || e);
      submitBtn.disabled = false; submitBtn.textContent = 'Создать';
    }
  });
}

function startInlineEditProjectName() {
  const titleEl = document.querySelector('#hero-title');
  if (!titleEl) return;
  const cur = state.schedule?.project?.name || '';
  inlineEdit(titleEl, cur, async (newName) => {
    if (!newName || newName === cur) return;
    showToast('Сохраняю…');
    try {
      const r = await postDataAction('project:rename', { slug: state.projectSlug, newName });
      if (state.schedule?.project) state.schedule.project.name = newName;
      // Re-render header
      try { renderHero(); } catch (_) {}
      document.title = `${newName} · График работ · CYFR`;
      showToast(`✓ Проект переименован: «${newName}»`, { action: { label: 'Отменить', onClick: async () => {
        const r2 = await postDataAction('project:rename', { slug: state.projectSlug, newName: cur });
        if (state.schedule?.project) state.schedule.project.name = cur;
        try { renderHero(); } catch (_) {}
        document.title = `${cur} · График работ · CYFR`;
        showToast(`↶ Возвращено: «${cur}»`);
      } } });
    } catch (e) {
      showToast('Не удалось сохранить: ' + (e.message || e), 'error');
    }
  });
}

function startInlineEditSectionName(sectionId) {
  const sec = (state.schedule?.sections || []).find(x => x.id === sectionId);
  if (!sec) return;
  const labelEl = document.querySelector(`.section-label[data-section-id="${cssEscape(sectionId)}"] .section-name`);
  if (!labelEl) return;
  inlineEdit(labelEl, sec.name, async (newName) => {
    if (!newName || newName === sec.name) return;
    const prevName = sec.name;
    showToast('Сохраняю…');
    try {
      const r = await postDataAction('section:update', { slug: state.projectSlug, sectionId, patch: { name: newName } });
      sec.name = newName;
      if (r.schedule) state.schedule = r.schedule;
      renderGantt();
      renderLegend();
      renderTasksSheet();
      showToast(`✓ Раздел переименован: «${newName}»`, { action: { label: 'Отменить', onClick: async () => {
        const r2 = await postDataAction('section:update', { slug: state.projectSlug, sectionId, patch: { name: prevName } });
        sec.name = prevName;
        if (r2.schedule) state.schedule = r2.schedule;
        renderGantt(); renderLegend(); renderTasksSheet();
        showToast(`↶ Возвращено: «${prevName}»`);
      } } });
    } catch (e) {
      showToast('Не удалось сохранить: ' + (e.message || e), 'error');
    }
  });
}

function inlineEdit(targetEl, currentValue, onSave) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit-input';
  input.value = currentValue || '';
  input.maxLength = 200;
  const prevDisplay = targetEl.style.display;
  targetEl.style.display = 'none';
  targetEl.parentNode.insertBefore(input, targetEl.nextSibling);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    input.remove();
    targetEl.style.display = prevDisplay || '';
    if (save && v) onSave(v);
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  // не давать клику пробулиться обратно в section-label (collapse)
  input.addEventListener('click', (e) => e.stopPropagation());
}

function confirmDeleteTask(taskId) {
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(taskId));
  if (!t) return;
  if (!confirm(`Удалить работу «${t.name}»? Будет возможность отменить в течение 8 секунд.`)) return;
  const snapshot = JSON.parse(JSON.stringify(t)); // полный snapshot для восстановления
  (async () => {
    showToast('Удаляю…');
    try {
      const r = await postDataAction('task:delete', { slug: state.projectSlug, taskId });
      if (r.schedule) state.schedule = r.schedule;
      else state.schedule.tasks = state.schedule.tasks.filter(x => String(x.id) !== String(taskId));
      try { renderProjectAnalytics(); } catch (_) {}
      renderGantt();
      renderTasksSheet();
      showToast(`✓ Удалена «${snapshot.name}»`, { action: { label: 'Отменить', onClick: async () => {
        // Восстанавливаем через task:create — id будет новым, но имя/даты/раздел те же
        const r2 = await postDataAction('task:create', {
          slug: state.projectSlug,
          sectionId: snapshot.section,
          name: snapshot.name,
          planStart: snapshot.planStart,
          planEnd: snapshot.planEnd,
          stage: snapshot.stage
        });
        if (r2.schedule) state.schedule = r2.schedule;
        try { renderProjectAnalytics(); } catch (_) {}
        renderGantt();
        renderTasksSheet();
        showToast(`↶ Восстановлена: «${snapshot.name}»`);
      } } });
    } catch (e) {
      showToast('Не удалось удалить: ' + (e.message || e), 'error');
    }
  })();
}

function confirmDeleteSection(sectionId) {
  const sec = (state.schedule?.sections || []).find(x => x.id === sectionId);
  if (!sec) return;
  const orphans = (state.schedule.tasks || []).filter(t => t.section === sectionId).length;
  if (orphans) {
    showToast(`Раздел не пустой: ${orphans} работ. Удали их сначала или перенеси.`, 'error');
    return;
  }
  if (!confirm(`Удалить раздел «${sec.name}»?`)) return;
  (async () => {
    showToast('Удаляю…');
    try {
      const r = await postDataAction('section:delete', { slug: state.projectSlug, sectionId });
      if (r.schedule) state.schedule = r.schedule;
      else state.schedule.sections = state.schedule.sections.filter(x => x.id !== sectionId);
      delete state.sectionById[sectionId];
      renderGantt();
      renderLegend();
      renderTasksSheet();
      showToast(`✓ Раздел «${sec.name}» удалён`);
    } catch (e) {
      showToast('Не удалось удалить: ' + (e.message || e), 'error');
    }
  })();
}

function openAddTaskForm(sectionId, anchorEl) {
  const sec = (state.schedule?.sections || []).find(x => x.id === sectionId);
  if (!sec) return;
  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay';
  const today = new Date().toISOString().slice(0, 10);
  const inAWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const stagesOpts = (state.schedule?.stages || []).map(st =>
    `<option value="${escapeHtml(st.id)}">${escapeHtml(st.name)}</option>`
  ).join('');
  overlay.innerHTML = `
    <div class="edit-form-card">
      <div class="edit-form-head">
        <div>+ Добавить работу в «${escapeHtml(sec.name)}»</div>
        <button type="button" class="edit-form-close">×</button>
      </div>
      <label class="edit-form-row"><span>Название работы</span>
        <input type="text" id="ef-name" maxlength="200" placeholder="Например: Укладка плитки в холле" autofocus />
      </label>
      <label class="edit-form-row"><span>Этап</span>
        <select id="ef-stage">${stagesOpts}</select>
      </label>
      <div class="edit-form-section-h">📅 План</div>
      <div class="edit-form-row-2col">
        <label><span>Старт</span><input type="date" id="ef-start" value="${today}" /></label>
        <label><span>Финиш</span><input type="date" id="ef-end" value="${inAWeek}" /></label>
      </div>
      <label class="edit-form-toggle">
        <input type="checkbox" id="ef-has-fact" />
        <span>🔵 Уже идёт / завершена — добавить фактические даты</span>
      </label>
      <div class="edit-form-fact-block" id="ef-fact-block" hidden>
        <div class="edit-form-row-2col">
          <label><span>Факт: старт</span><input type="date" id="ef-actual-start" value="${today}" max="${today}" /></label>
          <label><span>Факт: финиш <em class="muted">(пусто = в работе)</em></span><input type="date" id="ef-actual-end" max="${today}" /></label>
        </div>
      </div>
      <div class="edit-form-section-h" style="margin-top:18px">👷 Подрядчик</div>
      <label class="edit-form-toggle">
        <input type="checkbox" id="ef-is-sub"${sec.sub ? ' checked' : ''} />
        <span>🟡 Эту работу делает субподрядчик${sec.sub ? ' <em class="muted">(раздел на субе по умолчанию — но можно снять для конкретной работы)</em>' : ''}</span>
      </label>
      <div class="edit-form-sub-block" id="ef-sub-block"${sec.sub ? '' : ' hidden'}>
        <label class="edit-form-row"><span>Имя/название субподрядчика <em class="muted">(необязательно)</em></span>
          <input type="text" id="ef-sub-name" maxlength="120" placeholder="Например: Альтаир Электро" />
        </label>
      </div>
      <div class="edit-form-actions">
        <button type="button" class="edit-form-cancel">Отмена</button>
        <button type="button" class="edit-form-submit">Создать</button>
      </div>
      <div class="edit-form-err" id="ef-err"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.querySelector('.edit-form-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#ef-name').focus();
  const hasFactCb = overlay.querySelector('#ef-has-fact');
  const factBlock = overlay.querySelector('#ef-fact-block');
  hasFactCb.addEventListener('change', () => { factBlock.hidden = !hasFactCb.checked; });
  // Sub-блок: чекбокс всегда активен, инициализирован по дефолту раздела, но юзер может перебить.
  const isSubCb = overlay.querySelector('#ef-is-sub');
  const subBlock = overlay.querySelector('#ef-sub-block');
  isSubCb.addEventListener('change', () => { subBlock.hidden = !isSubCb.checked; });
  overlay.querySelector('.edit-form-submit').addEventListener('click', async () => {
    const name = overlay.querySelector('#ef-name').value.trim();
    const stage = overlay.querySelector('#ef-stage').value;
    const planStart = overlay.querySelector('#ef-start').value;
    const planEnd = overlay.querySelector('#ef-end').value;
    const err = overlay.querySelector('#ef-err');
    if (!name) { err.textContent = 'Введи название'; return; }
    if (planEnd < planStart) { err.textContent = 'Финиш плана не может быть раньше старта'; return; }
    let actualStart, actualEnd;
    if (hasFactCb.checked) {
      actualStart = overlay.querySelector('#ef-actual-start').value || undefined;
      actualEnd   = overlay.querySelector('#ef-actual-end').value || undefined;
      if (actualStart && actualEnd && actualEnd < actualStart) {
        err.textContent = 'Финиш факта не может быть раньше старта факта'; return;
      }
    }
    // Sub-флаг: если выбор юзера совпадает с дефолтом раздела — не сохраняем явно (наследуем).
    // Если отличается — сохраняем явный true/false (override).
    const wantSub = isSubCb.checked;
    const sub = wantSub === !!sec.sub ? undefined : wantSub;
    const subcontractorName = (!wantSub ? '' : (overlay.querySelector('#ef-sub-name').value || '').trim()) || undefined;
    err.textContent = '';
    const submitBtn = overlay.querySelector('.edit-form-submit');
    submitBtn.disabled = true; submitBtn.textContent = 'Создаю…';
    try {
      const r = await postDataAction('task:create', { slug: state.projectSlug, sectionId, name, planStart, planEnd, actualStart, actualEnd, stage, sub, subcontractorName });
      if (r.schedule) state.schedule = r.schedule;
      try { renderProjectAnalytics(); } catch (_) {}
      renderGantt();
      renderTasksSheet();
      close();
      showToast(`✓ Создана: «${name}»`);
    } catch (e) {
      err.textContent = 'Не удалось создать: ' + (e.message || e);
      submitBtn.disabled = false; submitBtn.textContent = 'Создать';
    }
  });
}

function openTaskDatesEditor(taskId) {
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(taskId));
  if (!t) return;
  const sec = state.sectionById[t.section] || {};
  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay';
  // __FACT_FUTURE_GUARD_v1__ today для max-атрибута date-инпутов факта.
  // Без объявления ${today} в шаблоне падает ReferenceError и меню не открывается.
  const today = new Date().toISOString().slice(0, 10);
  const ps = t.planStart || t.start || '';
  const pe = t.planEnd || t.end || '';
  const aS = t.actualStart || '';
  const aE = t.actualEnd || '';
  const hasFact = !!(aS || aE);
  const taskSubExplicit = (typeof t.sub === 'boolean'); // явно выставлен ли task-level override
  const taskSubEffective = effectiveSub(t, sec);
  const taskSubName = t.subcontractorName || '';
  const sectionDefault = !!sec.sub;
  overlay.innerHTML = `
    <div class="edit-form-card">
      <div class="edit-form-head">
        <div>📅 Даты «${escapeHtml(t.name)}»</div>
        <button type="button" class="edit-form-close">×</button>
      </div>
      <div class="edit-form-section-h">📅 План</div>
      <div class="edit-form-row-2col">
        <label><span>Старт</span><input type="date" id="td-plan-start" value="${ps}" /></label>
        <label><span>Финиш</span><input type="date" id="td-plan-end" value="${pe}" /></label>
      </div>
      <div class="edit-form-section-h" style="margin-top:18px">🔵 Факт</div>
      <label class="edit-form-toggle">
        <input type="checkbox" id="td-has-fact" ${hasFact ? 'checked' : ''} />
        <span>Работа уже идёт или завершена</span>
      </label>
      <div class="edit-form-fact-block" id="td-fact-block" ${hasFact ? '' : 'hidden'}>
        <div class="edit-form-row-2col">
          <label><span>Старт</span><input type="date" id="td-actual-start" value="${aS}" max="${today}" /></label>
          <label><span>Финиш <em class="muted">(пусто = в работе)</em></span><input type="date" id="td-actual-end" value="${aE}" max="${today}" /></label>
        </div>
        <button type="button" class="edit-form-fact-clear" id="td-fact-clear" title="Полностью убрать фактические даты">Убрать факт целиком</button>
      </div>
      <div class="edit-form-section-h" style="margin-top:18px">👷 Подрядчик</div>
      <label class="edit-form-toggle">
        <input type="checkbox" id="td-is-sub" ${taskSubEffective ? 'checked' : ''} />
        <span>🟡 Эту работу делает субподрядчик${sectionDefault ? ' <em class="muted">(раздел на субе по умолчанию — можно снять для этой работы)</em>' : ''}</span>
      </label>
      <div class="edit-form-sub-block" id="td-sub-block" ${(taskSubEffective || taskSubName) ? '' : 'hidden'}>
        <label class="edit-form-row"><span>Имя/название субподрядчика <em class="muted">(необязательно)</em></span>
          <input type="text" id="td-sub-name" maxlength="120" value="${escapeHtml(taskSubName)}" placeholder="Например: Альтаир Электро" />
        </label>
      </div>
      <div class="edit-form-actions">
        <button type="button" class="edit-form-cancel">Отмена</button>
        <button type="button" class="edit-form-submit">Сохранить</button>
      </div>
      <div class="edit-form-err" id="td-err"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.querySelector('.edit-form-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const cb = overlay.querySelector('#td-has-fact');
  const block = overlay.querySelector('#td-fact-block');
  cb.addEventListener('change', () => { block.hidden = !cb.checked; });
  overlay.querySelector('#td-fact-clear').addEventListener('click', () => {
    overlay.querySelector('#td-actual-start').value = '';
    overlay.querySelector('#td-actual-end').value = '';
    cb.checked = false;
    block.hidden = true;
  });
  // Sub-блок toggle: чекбокс всегда активен. На submit вычислим — override или inherit.
  const subCb = overlay.querySelector('#td-is-sub');
  const subBlock = overlay.querySelector('#td-sub-block');
  subCb.addEventListener('change', () => {
    subBlock.hidden = !subCb.checked;
    if (!subCb.checked) overlay.querySelector('#td-sub-name').value = '';
  });
  overlay.querySelector('.edit-form-submit').addEventListener('click', async () => {
    const planStart = overlay.querySelector('#td-plan-start').value;
    const planEnd = overlay.querySelector('#td-plan-end').value;
    const factOn = cb.checked;
    const aStart = factOn ? overlay.querySelector('#td-actual-start').value : '';
    const aEnd   = factOn ? overlay.querySelector('#td-actual-end').value   : '';
    const err = overlay.querySelector('#td-err');
    if (!planStart || !planEnd) { err.textContent = 'План: старт и финиш обязательны'; return; }
    if (planEnd < planStart) { err.textContent = 'Финиш плана не может быть раньше старта'; return; }
    if (factOn && aStart && aEnd && aEnd < aStart) { err.textContent = 'Финиш факта не может быть раньше старта факта'; return; }
    // __FACT_FUTURE_GUARD_v1__ Не даём сохранить факт в будущем — даже если юзер ввёл руками.
    const _todayIso = new Date().toISOString().slice(0, 10);
    if (factOn && aStart && aStart > _todayIso) { err.textContent = 'Факт-старт не может быть в будущем'; return; }
    if (factOn && aEnd && aEnd > _todayIso) { err.textContent = 'Факт-финиш не может быть в будущем'; return; }
    err.textContent = '';

    // Собираем patch с минимальными изменениями
    const patch = {};
    if (planStart !== ps) patch.planStart = planStart;
    if (planEnd !== pe) patch.planEnd = planEnd;
    if (factOn) {
      if (aStart && aStart !== aS) patch.actualStart = aStart;
      if (!aStart && aS) patch.actualStart = null;
      if (aEnd && aEnd !== aE) patch.actualEnd = aEnd;
      if (!aEnd && aE) patch.actualEnd = null;
    } else {
      if (aS) patch.actualStart = null;
      if (aE) patch.actualEnd = null;
    }
    // Sub-флаг — tri-state: совпало с дефолтом раздела → clear (null = inherit), иначе → явный true/false.
    const wantSub = subCb.checked;
    const wantExplicit = wantSub !== sectionDefault; // нужен ли override
    let nextSubVal; // true | false | null (null = inherit)
    if (wantExplicit) nextSubVal = wantSub;
    else nextSubVal = null;
    // Сравниваем с текущим состоянием поля t.sub
    const curSubVal = taskSubExplicit ? t.sub : null;
    if (nextSubVal !== curSubVal) patch.sub = nextSubVal;
    const newSubName = (!subCb.checked ? '' : (overlay.querySelector('#td-sub-name').value || '').trim());
    if (newSubName !== taskSubName) patch.subcontractorName = newSubName ? newSubName : null;

    if (!Object.keys(patch).length) { close(); return; }

    // Сохраняем inverse для undo
    const inverse = {};
    for (const k of Object.keys(patch)) inverse[k] = t[k] || null;

    const submitBtn = overlay.querySelector('.edit-form-submit');
    submitBtn.disabled = true; submitBtn.textContent = 'Сохраняю…';
    try {
      const r = await taskUpdateMaybeReason({ slug: state.projectSlug, taskId, patch }, { subjectName: t.name });
      if (r.schedule) state.schedule = r.schedule;
      else Object.assign(t, patch);
      try { renderProjectAnalytics(); } catch (_) {}
      renderGantt();
      renderTasksSheet();
      close();
      const summary = Object.entries(patch).map(([k,v]) => v === null ? `${k}=пусто` : `${k}=${v}`).join(', ');
      showToast(`✓ Даты обновлены: ${summary}`, { action: { label: 'Отменить', onClick: async () => {
        const r2 = await taskUpdateMaybeReason({ slug: state.projectSlug, taskId, patch: inverse }, { skipReason: true });
        if (r2.schedule) state.schedule = r2.schedule;
        try { renderProjectAnalytics(); } catch (_) {}
        renderGantt();
        renderTasksSheet();
        showToast('↶ Возвращено');
      } } });
    } catch (e) {
      if (e.cancelled) {
        submitBtn.disabled = false; submitBtn.textContent = 'Сохранить';
        return;
      }
      err.textContent = 'Не удалось: ' + (e.message || e);
      submitBtn.disabled = false; submitBtn.textContent = 'Сохранить';
    }
  });
}

function openTaskPauseForm(taskId) {
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(taskId));
  if (!t) return;
  const today = new Date().toISOString().slice(0, 10);
  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay';
  overlay.innerHTML = `
    <div class="edit-form-card">
      <div class="edit-form-head">
        <div>⏸ Поставить на паузу «${escapeHtml(t.name)}»</div>
        <button type="button" class="edit-form-close">×</button>
      </div>
      <div class="edit-form-section-h">⚙️ Что приостанавливаем</div>
      <div class="pause-dt-group" role="radiogroup" aria-label="Тип паузы">
        <label class="pause-dt-opt"><input type="radio" name="tp-dt" value="plan" checked /><span><b>План</b><em class="muted"> — пауза на плановых датах (обычно)</em></span></label>
        <label class="pause-dt-opt"><input type="radio" name="tp-dt" value="actual" /><span><b>Факт</b><em class="muted"> — работа уже идёт, временно остановили</em></span></label>
        <label class="pause-dt-opt"><input type="radio" name="tp-dt" value="both" /><span><b>Оба</b><em class="muted"> — и план и факт стоят</em></span></label>
      </div>
      <div class="edit-form-section-h" style="margin-top:14px">📅 Период</div>
      <div class="edit-form-row-2col">
        <label><span>С какого числа</span><input type="date" id="tp-from" value="${today}" /></label>
        <label><span>До какого числа <em class="muted">(пусто = открыта)</em></span><input type="date" id="tp-to" value="" /></label>
      </div>
      <label class="edit-form-row" style="margin-top:14px"><span>📅 Новая плановая дата окончания работы <em class="muted">(если меняется, иначе пусто)</em></span>
        <input type="date" id="tp-newend" value="" />
      </label>
      <div class="edit-form-section-h" style="margin-top:18px">📝 Причина <span class="muted">(обязательно)</span></div>
      <label class="edit-form-row">
        <input type="text" id="tp-reason" maxlength="200" placeholder="Например: ждём поставку плитки, нет рабочих, переделка" />
      </label>
      <div class="edit-form-actions">
        <button type="button" class="edit-form-cancel">Отмена</button>
        <button type="button" class="edit-form-submit">⏸ Приостановить</button>
      </div>
      <div class="edit-form-err" id="tp-err"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.querySelector('.edit-form-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  setTimeout(() => overlay.querySelector('#tp-reason').focus(), 50);

  overlay.querySelector('.edit-form-submit').addEventListener('click', async () => {
    const from = overlay.querySelector('#tp-from').value;
    const to = overlay.querySelector('#tp-to').value;
    const newEnd = overlay.querySelector('#tp-newend').value;
    const reason = overlay.querySelector('#tp-reason').value.trim();
    const dtEl = overlay.querySelector('input[name="tp-dt"]:checked');
    const dateType = dtEl ? dtEl.value : 'plan';
    const err = overlay.querySelector('#tp-err');
    if (!from) { err.textContent = 'Укажи дату начала паузы'; return; }
    if (to && to < from) { err.textContent = 'Дата окончания паузы не может быть раньше начала'; return; }
    if (!reason) { err.textContent = 'Причина паузы обязательна'; return; }
    err.textContent = '';
    const submitBtn = overlay.querySelector('.edit-form-submit');
    submitBtn.disabled = true; submitBtn.textContent = 'Сохраняю…';
    try {
      const r = await postDataAction('task:pause', {
        slug: state.projectSlug, taskId,
        pauseFrom: from, resumeAt: to || null, reason,
        newPlanEnd: newEnd || null,
        dateType
      });
      if (r.schedule) state.schedule = r.schedule;
      renderGantt(); renderTasksSheet();
      try { renderProjectAnalytics(); } catch (_) {}
      close();
      showToast('⏸ «' + t.name + '» на паузе');
    } catch (e) {
      err.textContent = 'Не удалось: ' + (e.message || e);
      submitBtn.disabled = false; submitBtn.textContent = '⏸ Приостановить';
    }
  });
}

function openTaskPauseEditForm(taskId, pauseId) {
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(taskId));
  if (!t) return;
  const p = (Array.isArray(t.pauses) ? t.pauses : []).find(x => x && x.id === pauseId);
  if (!p) return;
  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay';
  const wasOpen = !p.to;
  overlay.innerHTML = `
    <div class="edit-form-card">
      <div class="edit-form-head">
        <div>⏸ Пауза «${escapeHtml(t.name)}»</div>
        <button type="button" class="edit-form-close">×</button>
      </div>
      <div class="edit-form-section-h">⚙️ Что приостанавливаем</div>
      <div class="pause-dt-group" role="radiogroup" aria-label="Тип паузы">
        <label class="pause-dt-opt"><input type="radio" name="tpe-dt" value="plan"${(p.dateType||'plan')==='plan'?' checked':''} /><span><b>План</b><em class="muted"> — пауза на плановых датах</em></span></label>
        <label class="pause-dt-opt"><input type="radio" name="tpe-dt" value="actual"${(p.dateType||'plan')==='actual'?' checked':''} /><span><b>Факт</b><em class="muted"> — фактическая работа стоит</em></span></label>
        <label class="pause-dt-opt"><input type="radio" name="tpe-dt" value="both"${(p.dateType||'plan')==='both'?' checked':''} /><span><b>Оба</b><em class="muted"> — и план и факт стоят</em></span></label>
      </div>
      <div class="edit-form-section-h" style="margin-top:14px">📅 Период</div>
      <div class="edit-form-row-2col">
        <label><span>Начало</span><input type="date" id="tpe-from" value="${p.from || ''}" /></label>
        <label><span>Конец <em class="muted">(пусто = открыта)</em></span><input type="date" id="tpe-to" value="${p.to || ''}" /></label>
      </div>
      <div class="edit-form-section-h" style="margin-top:18px">📝 Причина</div>
      <label class="edit-form-row">
        <input type="text" id="tpe-reason" maxlength="200" value="${escapeHtml(p.reason || '')}" />
      </label>
      <div class="edit-form-actions">
        <button type="button" class="edit-form-cancel">Отмена</button>
        <button type="button" class="edit-form-del" style="background:#fee2e2;color:#b91c1c;border-color:#fecaca">🗑 Удалить паузу</button>
        <button type="button" class="edit-form-submit">Сохранить</button>
      </div>
      <div class="edit-form-err" id="tpe-err"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.querySelector('.edit-form-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('.edit-form-del').addEventListener('click', async () => {
    if (!confirm('Удалить эту паузу?')) return;
    try {
      const r = await postDataAction('task:pause-delete', { slug: state.projectSlug, taskId, pauseId });
      if (r.schedule) state.schedule = r.schedule;
      renderGantt(); renderTasksSheet();
      try { renderProjectAnalytics(); } catch (_) {}
      close();
      showToast('✓ Пауза удалена');
    } catch (e) { overlay.querySelector('#tpe-err').textContent = 'Не удалось: ' + (e.message || e); }
  });

  overlay.querySelector('.edit-form-submit').addEventListener('click', async () => {
    const from = overlay.querySelector('#tpe-from').value;
    const to = overlay.querySelector('#tpe-to').value;
    const reason = overlay.querySelector('#tpe-reason').value.trim();
    const err = overlay.querySelector('#tpe-err');
    if (!from) { err.textContent = 'Дата начала обязательна'; return; }
    if (to && to < from) { err.textContent = 'Конец паузы не может быть раньше начала'; return; }
    if (!reason) { err.textContent = 'Причина обязательна'; return; }
    err.textContent = '';
    const submitBtn = overlay.querySelector('.edit-form-submit');
    submitBtn.disabled = true; submitBtn.textContent = 'Сохраняю…';
    const dtEl = overlay.querySelector('input[name="tpe-dt"]:checked');
    const dateType = dtEl ? dtEl.value : null;
    try {
      const r = await postDataAction('task:pause-edit', {
        slug: state.projectSlug, taskId, pauseId,
        from, to: to || null, reason, dateType
      });
      if (r.schedule) state.schedule = r.schedule;
      renderGantt(); renderTasksSheet();
      try { renderProjectAnalytics(); } catch (_) {}
      close();
      showToast('✓ Пауза обновлена');
    } catch (e) {
      err.textContent = 'Не удалось: ' + (e.message || e);
      submitBtn.disabled = false; submitBtn.textContent = 'Сохранить';
    }
  });
}

function openTaskResumeForm(taskId) {
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(taskId));
  if (!t) return;
  const openPause = Array.isArray(t.pauses) ? [...t.pauses].reverse().find(p => p && !p.to) : null;
  if (!openPause) {
    showToast('У «' + t.name + '» нет активной паузы');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const minResume = openPause.from > today ? openPause.from : today;
  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay';
  overlay.innerHTML = `
    <div class="edit-form-card">
      <div class="edit-form-head">
        <div>▶️ Возобновить «${escapeHtml(t.name)}»</div>
        <button type="button" class="edit-form-close">×</button>
      </div>
      <p class="muted" style="margin:6px 0 14px">Пауза с <strong>${escapeHtml(fmtDate(openPause.from))}</strong> · причина: «${escapeHtml(openPause.reason || '—')}»</p>
      <label class="edit-form-row"><span>С какого числа возобновляем</span>
        <input type="date" id="tr-at" value="${minResume}" min="${openPause.from}" />
      </label>
      <div class="edit-form-actions">
        <button type="button" class="edit-form-cancel">Отмена</button>
        <button type="button" class="edit-form-submit">▶️ Возобновить</button>
      </div>
      <div class="edit-form-err" id="tr-err"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.querySelector('.edit-form-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('.edit-form-submit').addEventListener('click', async () => {
    const at = overlay.querySelector('#tr-at').value;
    const err = overlay.querySelector('#tr-err');
    if (!at) { err.textContent = 'Укажи дату возобновления'; return; }
    if (at < openPause.from) { err.textContent = 'Дата возобновления не может быть раньше начала паузы'; return; }
    err.textContent = '';
    const submitBtn = overlay.querySelector('.edit-form-submit');
    submitBtn.disabled = true; submitBtn.textContent = 'Сохраняю…';
    try {
      const r = await postDataAction('task:resume', { slug: state.projectSlug, taskId, resumeAt: at });
      if (r.schedule) state.schedule = r.schedule;
      renderGantt(); renderTasksSheet();
      try { renderProjectAnalytics(); } catch (_) {}
      close();
      showToast('▶️ «' + t.name + '» возобновлена');
    } catch (e) {
      err.textContent = 'Не удалось: ' + (e.message || e);
      submitBtn.disabled = false; submitBtn.textContent = '▶️ Возобновить';
    }
  });
}

function openAddSectionForm() {
  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay';
  const colors = ['#ef4444','#f59e0b','#eab308','#84cc16','#22c55e','#10b981','#14b8a6','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e','#94a3b8'];
  const colorChips = colors.map(c => `<button type="button" class="ef-color" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
  overlay.innerHTML = `
    <div class="edit-form-card">
      <div class="edit-form-head">
        <div>+ Новый раздел</div>
        <button type="button" class="edit-form-close">×</button>
      </div>
      <label class="edit-form-row"><span>Название</span>
        <input type="text" id="ef-name" maxlength="80" placeholder="Например: Декорирование" autofocus />
      </label>
      <div class="edit-form-row"><span>Цвет</span>
        <div class="ef-colors">${colorChips}</div>
      </div>
      <label class="edit-form-row edit-form-checkbox"><input type="checkbox" id="ef-sub" /> <span>Это работы субподрядчика</span></label>
      <div class="edit-form-actions">
        <button type="button" class="edit-form-cancel">Отмена</button>
        <button type="button" class="edit-form-submit">Создать</button>
      </div>
      <div class="edit-form-err" id="ef-err"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  let chosenColor = colors[Math.floor(Math.random() * colors.length)];
  const colorEls = overlay.querySelectorAll('.ef-color');
  const markChosen = () => {
    colorEls.forEach(el => el.classList.toggle('is-chosen', el.getAttribute('data-color') === chosenColor));
  };
  markChosen();
  colorEls.forEach(el => el.addEventListener('click', () => { chosenColor = el.getAttribute('data-color'); markChosen(); }));
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.querySelector('.edit-form-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#ef-name').focus();
  overlay.querySelector('.edit-form-submit').addEventListener('click', async () => {
    const name = overlay.querySelector('#ef-name').value.trim();
    const sub = overlay.querySelector('#ef-sub').checked;
    const err = overlay.querySelector('#ef-err');
    if (!name) { err.textContent = 'Введи название раздела'; return; }
    err.textContent = '';
    const submitBtn = overlay.querySelector('.edit-form-submit');
    submitBtn.disabled = true; submitBtn.textContent = 'Создаю…';
    try {
      const r = await postDataAction('section:create', { slug: state.projectSlug, name, color: chosenColor, sub });
      if (r.schedule) state.schedule = r.schedule;
      // Обновим sectionById
      state.schedule.sections.forEach(s => state.sectionById[s.id] = s);
      renderGantt();
      renderLegend();
      renderTasksSheet();
      close();
      showToast(`✓ Раздел «${name}» создан`);
    } catch (e) {
      err.textContent = 'Не удалось создать: ' + (e.message || e);
      submitBtn.disabled = false; submitBtn.textContent = 'Создать';
    }
  });
}

function openEditSectionForm(sectionId) {
  const sec = (state.schedule?.sections || []).find(x => x.id === sectionId);
  if (!sec) return;
  const overlay = document.createElement('div');
  overlay.className = 'edit-form-overlay';
  const colors = ['#ef4444','#f59e0b','#eab308','#84cc16','#22c55e','#10b981','#14b8a6','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e','#94a3b8'];
  const colorChips = colors.map(c => `<button type="button" class="ef-color${c === sec.color ? ' is-chosen' : ''}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
  overlay.innerHTML = `
    <div class="edit-form-card">
      <div class="edit-form-head">
        <div>✎ Раздел «${escapeHtml(sec.name)}»</div>
        <button type="button" class="edit-form-close" aria-label="Закрыть">×</button>
      </div>
      <label class="edit-form-row"><span>Название</span>
        <input type="text" id="ef-name" maxlength="80" value="${escapeHtml(sec.name)}" />
      </label>
      <div class="edit-form-row"><span>Цвет</span>
        <div class="ef-colors">${colorChips}</div>
      </div>
      <label class="edit-form-row edit-form-checkbox"><input type="checkbox" id="ef-sub" ${sec.sub ? 'checked' : ''} /> <span>Это работы субподрядчика</span></label>
      <div class="edit-form-actions">
        <button type="button" class="edit-form-cancel">Отмена</button>
        <button type="button" class="edit-form-submit">Сохранить</button>
      </div>
      <div class="edit-form-err" id="ef-err"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  let chosenColor = sec.color;
  const colorEls = overlay.querySelectorAll('.ef-color');
  const markChosen = () => colorEls.forEach(el => el.classList.toggle('is-chosen', el.getAttribute('data-color') === chosenColor));
  colorEls.forEach(el => el.addEventListener('click', () => { chosenColor = el.getAttribute('data-color'); markChosen(); }));
  const close = () => overlay.remove();
  overlay.querySelector('.edit-form-close').addEventListener('click', close);
  overlay.querySelector('.edit-form-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  setTimeout(() => overlay.querySelector('#ef-name')?.focus(), 30);
  overlay.querySelector('.edit-form-submit').addEventListener('click', async () => {
    const name = overlay.querySelector('#ef-name').value.trim();
    const sub = overlay.querySelector('#ef-sub').checked;
    const err = overlay.querySelector('#ef-err');
    if (!name) { err.textContent = 'Введи название раздела'; return; }
    err.textContent = '';
    const submitBtn = overlay.querySelector('.edit-form-submit');
    submitBtn.disabled = true; submitBtn.textContent = 'Сохраняю…';
    const patch = {};
    if (name !== sec.name) patch.name = name;
    if (chosenColor !== sec.color) patch.color = chosenColor;
    if (!!sub !== !!sec.sub) patch.sub = sub;
    if (!Object.keys(patch).length) { close(); return; }
    try {
      const r = await postDataAction('section:update', { slug: state.projectSlug, sectionId, patch });
      if (r.schedule) state.schedule = r.schedule;
      else Object.assign(sec, patch);
      state.schedule.sections.forEach(s => state.sectionById[s.id] = s);
      renderGantt(); renderLegend(); renderTasksSheet();
      close();
      showToast('✓ Раздел сохранён');
    } catch (e) {
      err.textContent = 'Не удалось сохранить: ' + (e.message || e);
      submitBtn.disabled = false; submitBtn.textContent = 'Сохранить';
    }
  });
}

function openSectionColorPicker(sectionId, anchorEl) {
  const sec = (state.schedule?.sections || []).find(x => x.id === sectionId);
  if (!sec) return;
  const colors = ['#ef4444','#f59e0b','#eab308','#84cc16','#22c55e','#10b981','#14b8a6','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e','#94a3b8'];
  const popover = document.createElement('div');
  popover.className = 'section-color-pop';
  popover.innerHTML = colors.map(c =>
    `<button type="button" class="ef-color${c === sec.color ? ' is-chosen' : ''}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`
  ).join('');
  document.body.appendChild(popover);
  const rect = anchorEl.getBoundingClientRect();
  popover.style.left = Math.max(8, Math.min(window.innerWidth - 220, rect.left)) + 'px';
  popover.style.top = (rect.bottom + 4) + 'px';
  const close = () => popover.remove();
  popover.querySelectorAll('.ef-color').forEach(el => {
    el.addEventListener('click', async () => {
      const c = el.getAttribute('data-color');
      close();
      try {
        showToast('Меняю цвет…');
        const r = await postDataAction('section:update', { slug: state.projectSlug, sectionId, patch: { color: c } });
        sec.color = c;
        if (r.schedule) state.schedule = r.schedule;
        renderGantt();
        renderLegend();
        renderTasksSheet();
        showToast(`✓ Цвет обновлён`);
      } catch (e) {
        showToast('Не удалось: ' + (e.message || e), 'error');
      }
    });
  });
  setTimeout(() => {
    document.addEventListener('click', (e) => {
      if (!popover.contains(e.target)) close();
    }, { once: true });
  }, 0);
}

/* ─── Toast (с опциональной кнопкой действия) ─── */
let _toastTimer = null;
function showToast(text, opts) {
  // Обратная совместимость: showToast('text', 'error') → opts.level
  if (typeof opts === 'string') opts = { level: opts };
  opts = opts || {};
  const level = opts.level || 'info';
  const action = opts.action; // { label, onClick }
  const ttl = action ? 8000 : 3500;

  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = '';
  const txt = document.createElement('span');
  txt.className = 'app-toast-text';
  txt.textContent = text;
  toast.appendChild(txt);
  // __TOAST_EXPIRY_GUARD_v1__ После ttl надо «закрыть» action: даже если CSS-кнопка ещё в DOM
  // на короткой transition-фазе, click не должен запускать stale onClick → ошибки 404 на удалённых
  // pause-id, неправильный rollback на drag.
  let expired = false;
  if (action && action.label && action.onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      if (expired || btn.disabled) return;
      btn.disabled = true;
      btn.textContent = '…';
      Promise.resolve(action.onClick())
        .catch(e => console.warn('Undo failed:', e))
        .finally(() => { toast.classList.remove('is-visible'); });
    });
    toast.appendChild(btn);
  }
  toast.className = `app-toast app-toast--${level}${action ? ' app-toast--with-action' : ''} is-visible`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    expired = true;
    toast.classList.remove('is-visible');
    // Полная очистка контента после CSS-fade (300ms): больше нельзя нажать undo на stale state.
    setTimeout(() => { try { if (!toast.classList.contains('is-visible')) toast.innerHTML = ''; } catch (_) {} }, 350);
  }, ttl);
}

/* ─── Undo helpers ─── */
// Каждая операция возвращает inverse-функцию. Toast покажет «Отменить».
function withUndo(successText, doFwd, doInv) {
  return doFwd().then((res) => {
    showToast(successText, { action: { label: 'Отменить', onClick: doInv } });
    return res;
  });
}

// Helper для CSS-escape data-attribute (id может содержать '.', ':' и пр.)
function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(String(s));
  return String(s).replace(/(["\\.#:])/g, '\\$1');
}

/* ════════════════════════════════════════════════════════════════════ */
/*  Phase 1 · Drag plan/fact баров на Гантте                            */
/* ════════════════════════════════════════════════════════════════════ */

let _barDragBound = false;
const _dragState = { active: false, suppressClick: false };

// ── Modal scroll lock: при появлении любого .edit-form-overlay
// ставим body.has-modal-open (overflow:hidden + touch-action:none),
// убираем при закрытии. Лечит iOS-баг где скролл внутри модалки
// уезжает в фон (Гантт).
let _modalScrollLockBound = false;
function bindModalScrollLock() {
  if (_modalScrollLockBound) return;
  _modalScrollLockBound = true;
  const refresh = () => {
    const has = !!document.querySelector('.edit-form-overlay');
    document.body.classList.toggle('has-modal-open', has);
  };
  const obs = new MutationObserver(refresh);
  obs.observe(document.body, { childList: true, subtree: true });
  refresh();
}

// Touch bar selection state (mobile: tap-to-select → drag)
let _selectedBarEl = null;

function selectGanttBar(bar) {
  if (_selectedBarEl && _selectedBarEl !== bar) deselectGanttBar();
  _selectedBarEl = bar;
  state.selectedBarTid = bar.getAttribute('data-tid');
  bar.classList.add('bar-selected');
  try { window.navigator.vibrate?.(12); } catch (_) {}
}
function deselectGanttBar() {
  if (_selectedBarEl) _selectedBarEl.classList.remove('bar-selected');
  _selectedBarEl = null;
  state.selectedBarTid = null;
  hideBarStepCtrl(false);
}

function bindBarDrag() {
  if (_barDragBound) return;
  _barDragBound = true;
  const gantt = document.getElementById('gantt');
  if (!gantt) return;

  // Capture-phase pointerdown — должен сработать ДО любых click'ов на бар.
  gantt.addEventListener('pointerdown', (e) => {
    if (!state.editMode) {
      if (_selectedBarEl && e.pointerType === 'touch') deselectGanttBar();
      return;
    }
    if (e.button !== undefined && e.button !== 0) return;
    // ✕ delete button on pause bar — let click propagate (don't intercept here)
    if (e.target.closest('.bar-pause-del')) return;
    const bar = e.target.closest('.bar-plan, .bar-fact, .bar-pause');
    if (!bar) {
      if (_selectedBarEl && e.pointerType === 'touch') { deselectGanttBar(); }
      return;
    }
    e.stopPropagation();
    e.preventDefault();

    if (e.pointerType === 'touch') {
      // Mobile: tap on pause → open edit modal. Tap on plan/fact → select + step controller.
      if (bar.classList.contains('bar-pause')) {
        const _tid = bar.getAttribute('data-tid');
        const _pid = bar.getAttribute('data-pause-id');
        if (_tid && _pid && typeof openTaskPauseEditForm === 'function') openTaskPauseEditForm(_tid, _pid);
        return;
      }
      if (_selectedBarEl === bar) return;
      if (_bscTid !== null) return;
      selectGanttBar(bar);
      showBarStepCtrl(bar);
      return;
    }
    // Desktop/mouse: drag directly
    if (_selectedBarEl) deselectGanttBar();
    startBarDrag(e, bar);
  }, true);

  // Когда edit-mode активен — суппрессим click на баре после drag.
  gantt.addEventListener('click', (e) => {
    if (_dragState.suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      _dragState.suppressClick = false;
    }
  }, true);

  // __SCROLL_JANK_FIX__ Эти два слушателя нужны ТОЛЬКО в режиме правки (drag баров).
  // Раньше они висели постоянно как passive:false — non-passive touchmove заставлял
  // браузер ждать main-thread на каждом кадре обычной прокрутки → график «подвисал».
  // Теперь навешиваем их при входе в edit-mode и снимаем при выходе. В режиме просмотра
  // (как у руководителя) non-passive touch-слушателей на графике нет → плавная прокрутка.

  // iOS Safari fix: non-passive touchstart prevents browser from committing to a pan-scroll
  // gesture when finger lands on a bar in edit mode.
  const editTouchStart = (e) => {
    if (e.target.closest('.bar-pause-del')) return;
    const bar = e.target.closest('.bar-plan, .bar-fact, .bar-pause');
    if (bar) e.preventDefault();
  };
  // iOS Safari fix: prevent gantt scroll while pointer drag is in progress.
  const editTouchMove = (e) => { if (_dragState.active) e.preventDefault(); };
  let editTouchOn = false;
  const armEditTouch = () => {
    if (editTouchOn) return;
    gantt.addEventListener('touchstart', editTouchStart, { passive: false });
    gantt.addEventListener('touchmove', editTouchMove, { passive: false });
    editTouchOn = true;
  };
  const disarmEditTouch = () => {
    if (!editTouchOn) return;
    gantt.removeEventListener('touchstart', editTouchStart, { passive: false });
    gantt.removeEventListener('touchmove', editTouchMove, { passive: false });
    editTouchOn = false;
  };
  const syncEditTouch = () => { document.body.classList.contains('is-edit-mode') ? armEditTouch() : disarmEditTouch(); };
  new MutationObserver(syncEditTouch).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncEditTouch();
}

function startBarDrag(downEv, bar) {
  const tid = bar.getAttribute('data-tid');
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(tid));
  if (!t) return;
  const isFact = bar.classList.contains('bar-fact');
  const isPause = bar.classList.contains('bar-pause');
  const cellW = state.cellW || 22;
  const rect = bar.getBoundingClientRect();
  const offsetX = downEv.clientX - rect.left;
  const isTouch = downEv.pointerType === 'touch';
  const edge = isTouch
    ? Math.min(22, Math.max(14, rect.width * 0.28))
    : Math.min(12, Math.max(6, rect.width * 0.18));
  try { bar.setPointerCapture(downEv.pointerId); } catch (_) {}
  let mode = 'move';
  if (offsetX < edge) mode = 'resize-left';
  else if (offsetX > rect.width - edge) mode = 'resize-right';

  // For pause bars: state lives in t.pauses[i], not in t fields directly.
  let pauseRec = null;
  let pauseId = null;
  let pauseBarKind = null; // 'plan' | 'actual' — какая половина у legacy 'both'
  if (isPause) {
    pauseId = bar.getAttribute('data-pause-id');
    pauseBarKind = bar.getAttribute('data-bar-kind') || null;
    pauseRec = (Array.isArray(t.pauses) ? t.pauses : []).find(p => p && p.id === pauseId);
    if (!pauseRec || !pauseRec.from) return;
  }

  // Original values
  const todayIso = new Date().toISOString().slice(0, 10);
  const origStartIso = isPause
    ? pauseRec.from
    : (isFact ? (t.actualStart || null) : (t.planStart || t.start));
  const origEndIso = isPause
    ? (pauseRec.to || todayIso) // open-ended pause renders to today; drag treats today as end
    : (isFact ? (t.actualEnd || null) : (t.planEnd || t.end));
  if (isFact && (!origStartIso)) return;
  if (isFact && !origEndIso && mode === 'resize-right') {
    // running fact — резайз правого края = выставляем actualEnd на сегодня + delta
  }

  const origLeft = parseFloat(bar.style.left) || 0;
  const origWidth = parseFloat(bar.style.width) || 0;

  bar.classList.add('is-dragging');
  bar.classList.add(`is-dragging-${mode}`);
  document.body.classList.add('is-bar-dragging');
  // Keep gantt scroll locked for the duration of drag (deselectGanttBar may have cleared it)
  document.getElementById('gantt')?.style.setProperty('touch-action', 'none');

  // Dragging hint badge (floating)
  const hint = document.createElement('div');
  hint.className = 'bar-drag-hint';
  document.body.appendChild(hint);

  _dragState.active = true;
  _dragState.suppressClick = false;
  let movedPx = 0;
  let lastDelta = 0;

  const fmtRu = (iso) => {
    try {
      const d = new Date(iso + 'T00:00:00Z');
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    } catch (_) { return iso; }
  };
  const shift = (iso, days) => {
    if (!iso) return iso;
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const updateHint = (e, deltaDays, newStart, newEnd) => {
    const arrow = deltaDays === 0 ? '' : (deltaDays > 0 ? '→ +' : '← ');
    const days = Math.abs(deltaDays);
    const lbl = isPause ? '⏸ Пауза' : (isFact ? 'Факт' : 'План');
    let txt;
    if (mode === 'move') {
      txt = `${lbl}: ${fmtRu(newStart)} → ${fmtRu(newEnd)}`;
      if (deltaDays !== 0) txt += `  (${arrow}${days} ${plural(days, ['день','дня','дней'])})`;
    } else if (mode === 'resize-left') {
      txt = `${lbl} старт: ${fmtRu(newStart)}`;
    } else {
      txt = `${lbl} финиш: ${fmtRu(newEnd)}`;
    }
    hint.textContent = txt;
    hint.style.left = (e.clientX + 14) + 'px';
    hint.style.top = (e.clientY - 30) + 'px';
  };

  const onMove = (ev) => {
    const dx = ev.clientX - downEv.clientX;
    movedPx = Math.max(movedPx, Math.abs(dx));
    if (movedPx > 4) _dragState.suppressClick = true;

    const deltaDays = Math.round(dx / cellW);
    lastDelta = deltaDays;
    let newStart = origStartIso;
    let newEnd   = origEndIso || origStartIso;

    if (mode === 'move') {
      newStart = origStartIso ? shift(origStartIso, deltaDays) : null;
      newEnd   = origEndIso   ? shift(origEndIso,   deltaDays) : newStart;
      bar.style.left  = (origLeft + deltaDays * cellW) + 'px';
      bar.style.width = origWidth + 'px';
    } else if (mode === 'resize-left') {
      newStart = origStartIso ? shift(origStartIso, deltaDays) : null;
      // не даём перейти за конец (минимум 1 день)
      if (newStart && origEndIso && newStart > origEndIso) newStart = origEndIso;
      const clampDelta = Math.max(deltaDays, -(Math.round(origWidth / cellW) - 1));
      bar.style.left  = (origLeft + clampDelta * cellW) + 'px';
      bar.style.width = (origWidth - clampDelta * cellW) + 'px';
    } else { // resize-right
      newEnd = origEndIso ? shift(origEndIso, deltaDays) : shift(origStartIso, deltaDays);
      if (origStartIso && newEnd < origStartIso) newEnd = origStartIso;
      const clampDelta = Math.max(deltaDays, -(Math.round(origWidth / cellW) - 1));
      bar.style.width = (origWidth + clampDelta * cellW) + 'px';
    }

    updateHint(ev, deltaDays, newStart, newEnd);

    // autoscroll near edges of #gantt
    const gantt = document.getElementById('gantt');
    if (gantt) {
      const grect = gantt.getBoundingClientRect();
      const edgeZone = 60;
      if (ev.clientX > grect.right - edgeZone) gantt.scrollLeft += 12;
      else if (ev.clientX < grect.left + edgeZone + 200 /* skip label col */) gantt.scrollLeft -= 12;
    }
  };

  const onUp = async (ev) => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('is-bar-dragging');
    bar.classList.remove('is-dragging');
    bar.classList.remove(`is-dragging-${mode}`);
    hint.remove();
    _dragState.active = false;
    document.getElementById('gantt')?.style.removeProperty('touch-action');

    const deltaDays = lastDelta;
    if (deltaDays === 0) {
      // вернуть исходные стили
      bar.style.left = origLeft + 'px';
      bar.style.width = origWidth + 'px';
      // Click без движения по pause → открыть модалку правки
      if (isPause && downEv.pointerType !== 'touch') {
        if (typeof openTaskPauseEditForm === 'function') openTaskPauseEditForm(tid, pauseId);
      }
      // Тач без движения = деселект (второй тап для сброса выделения)
      if (downEv.pointerType === 'touch') deselectGanttBar();
      return;
    }

    // PAUSE drag: persist via task:pause-edit
    if (isPause) {
      const wasOpen = !pauseRec.to;
      let newFrom = pauseRec.from;
      let newTo = pauseRec.to || null; // keep open if was open
      if (mode === 'move') {
        newFrom = shift(pauseRec.from, deltaDays);
        if (!wasOpen) newTo = shift(pauseRec.to, deltaDays);
      } else if (mode === 'resize-left') {
        newFrom = shift(pauseRec.from, deltaDays);
        if (!wasOpen && newFrom > pauseRec.to) newFrom = pauseRec.to;
      } else { // resize-right
        if (wasOpen) {
          // Closing the pause: set 'to' = today + delta (clip to ≥ from)
          let v = shift(todayIso, deltaDays);
          if (v < pauseRec.from) v = pauseRec.from;
          newTo = v;
        } else {
          let v = shift(pauseRec.to, deltaDays);
          if (v < pauseRec.from) v = pauseRec.from;
          newTo = v;
        }
      }
      const inversePauseRec = { from: pauseRec.from, to: pauseRec.to || null };
      // Если это legacy 'both' pause и юзер тащит конкретный bar (план/факт) — передаём splitKind
      // backend split'нёт запись на 2 независимые перед apply edit.
      const _splitKind = (pauseRec.dateType === 'both' && (pauseBarKind === 'plan' || pauseBarKind === 'actual')) ? pauseBarKind : null;
      showToast('Сохраняю…');
      try {
        const r = await postDataAction('task:pause-edit', { slug: state.projectSlug, taskId: tid, pauseId, from: newFrom, to: newTo, splitKind: _splitKind });
        if (r.schedule) state.schedule = r.schedule;
        try { renderProjectAnalytics(); } catch (_) {}
        deselectGanttBar();
        renderGantt();
        renderTasksSheet();
        const days = Math.abs(deltaDays);
        const arrow = deltaDays > 0 ? '+' : '−';
        showToast(`✓ Пауза: ${arrow}${days} ${plural(days, ['день','дня','дней'])}`, { action: { label: 'Отменить', onClick: async () => {
          const r2 = await postDataAction('task:pause-edit', { slug: state.projectSlug, taskId: tid, pauseId, from: inversePauseRec.from, to: inversePauseRec.to });
          if (r2.schedule) state.schedule = r2.schedule;
          renderGantt(); renderTasksSheet();
          showToast('↶ Пауза возвращена');
        } } });
      } catch (err) {
        bar.style.left = origLeft + 'px';
        bar.style.width = origWidth + 'px';
        showToast('Не удалось сохранить: ' + (err.message || err), 'error');
      }
      return;
    }

    // Применяем изменения через API
    const patch = {};
    let descParts = [];
    if (isFact) {
      // __FACT_FUTURE_GUARD_v1__ Факт НИКОГДА не должен быть в будущем — clamp обе даты к today.
      const _todayIso = new Date().toISOString().slice(0, 10);
      if (mode === 'move') {
        let aS = origStartIso ? shift(origStartIso, deltaDays) : null;
        let aE = origEndIso ? shift(origEndIso, deltaDays) : null;
        if (aS && aS > _todayIso) {
          // Снять deltaDays чтобы actualStart = today; пересчитать actualEnd соответственно
          const cap = (new Date(_todayIso) - new Date(origStartIso)) / 86400000;
          aS = _todayIso;
          aE = origEndIso ? shift(origEndIso, cap) : null;
        }
        if (aE && aE > _todayIso) aE = _todayIso;
        if (aS) { patch.actualStart = aS; descParts.push('факт-старт'); }
        if (aE) { patch.actualEnd = aE; descParts.push('факт-финиш'); }
      } else if (mode === 'resize-left') {
        let v = shift(origStartIso, deltaDays);
        if (origEndIso && v > origEndIso) v = origEndIso;
        if (v > _todayIso) v = _todayIso;
        patch.actualStart = v; descParts.push('факт-старт');
      } else {
        const base = origEndIso || origStartIso;
        let v = shift(base, deltaDays);
        if (origStartIso && v < origStartIso) v = origStartIso;
        if (v > _todayIso) v = _todayIso;
        patch.actualEnd = v; descParts.push('факт-финиш');
      }
    } else {
      if (mode === 'move') {
        patch.planStart = shift(origStartIso, deltaDays);
        patch.planEnd   = shift(origEndIso,   deltaDays);
        descParts.push(`план ${deltaDays>0?'+':''}${deltaDays}д`);
      } else if (mode === 'resize-left') {
        let v = shift(origStartIso, deltaDays);
        if (v > origEndIso) v = origEndIso;
        patch.planStart = v; descParts.push('план-старт');
      } else {
        let v = shift(origEndIso, deltaDays);
        if (v < origStartIso) v = origStartIso;
        patch.planEnd = v; descParts.push('план-финиш');
      }
    }

    // Запомним обратный patch для undo
    const inversePatch = {};
    for (const k of Object.keys(patch)) inversePatch[k] = t[k] || null;

    showToast('Сохраняю…');
    try {
      const r = await taskUpdateMaybeReason({ slug: state.projectSlug, taskId: tid, patch }, { subjectName: t.name });
      if (r.schedule) state.schedule = r.schedule;
      else Object.assign(t, patch);
      try { renderProjectAnalytics(); } catch (_) {}
      deselectGanttBar();
      renderGantt();
      renderTasksSheet();
      const days = Math.abs(deltaDays);
      const arrow = deltaDays > 0 ? '+' : '−';
      const cascadeNote = (r.cascade && r.cascade.shifted && r.cascade.shifted.length)
        ? ` · ↓ зависимых: ${r.cascade.shifted.length}`
        : '';
      showToast(`✓ ${descParts.join(', ')}: ${arrow}${days} ${plural(days, ['день','дня','дней'])}${cascadeNote}`, { action: { label: 'Отменить', onClick: async () => {
        const r2 = await taskUpdateMaybeReason({ slug: state.projectSlug, taskId: tid, patch: inversePatch }, { skipReason: true });
        if (r2.schedule) state.schedule = r2.schedule;
        else Object.assign(t, inversePatch);
        try { renderProjectAnalytics(); } catch (_) {}
        renderGantt();
        renderTasksSheet();
        showToast(`↶ Даты возвращены`);
      } } });
    } catch (e) {
      bar.style.left = origLeft + 'px';
      bar.style.width = origWidth + 'px';
      if (e.cancelled) {
        showToast('↶ Откат — причина не указана');
      } else {
        showToast('Не удалось сохранить: ' + (e.message || e), 'error');
      }
    }
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

// ─── Mobile bar step controller ───────────────────────────────────────────────
let _bscTid = null, _bscIsFact = false;
let _bscOrigStart = null, _bscOrigEnd = null;
let _bscDeltaStart = 0, _bscDeltaEnd = 0;
let _bscBarOrigLeft = 0, _bscBarOrigWidth = 0;

const _bscShift = (iso, d) => {
  if (!iso) return iso;
  const dt = new Date(iso + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + d);
  return dt.toISOString().slice(0, 10);
};
const _bscFmt = (iso) => iso
  ? new Date(iso + 'T00:00:00Z').toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', timeZone: 'UTC' })
  : '—';

function showBarStepCtrl(bar) {
  const tid = bar.getAttribute('data-tid');
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(tid));
  if (!t) return;
  _bscTid = tid;
  _bscIsFact = bar.classList.contains('bar-fact');
  _bscOrigStart = _bscIsFact ? (t.actualStart || null) : (t.planStart || t.start || null);
  _bscOrigEnd   = _bscIsFact ? (t.actualEnd   || null) : (t.planEnd   || t.end   || null);
  _bscDeltaStart = 0;
  _bscDeltaEnd   = 0;
  _bscBarOrigLeft  = parseFloat(bar.style.left)  || 0;
  _bscBarOrigWidth = parseFloat(bar.style.width) || 0;
  _bscUpdateDisplay();
  const ctrl = document.getElementById('bar-step-ctrl');
  if (ctrl) ctrl.hidden = false;
}

function hideBarStepCtrl(restoreVisual) {
  const ctrl = document.getElementById('bar-step-ctrl');
  if (ctrl) ctrl.hidden = true;
  if (restoreVisual && _selectedBarEl) {
    _selectedBarEl.style.left  = _bscBarOrigLeft  + 'px';
    _selectedBarEl.style.width = _bscBarOrigWidth + 'px';
  }
  _bscTid = null;
}

function _bscUpdateDisplay() {
  const curStart = _bscOrigStart ? _bscShift(_bscOrigStart, _bscDeltaStart) : null;
  const curEnd   = _bscOrigEnd   ? _bscShift(_bscOrigEnd,   _bscDeltaEnd)   : null;
  const startEl = document.getElementById('bsc-start');
  const endEl   = document.getElementById('bsc-end');
  if (startEl) startEl.textContent = _bscFmt(curStart);
  if (endEl)   endEl.textContent   = _bscFmt(curEnd);
  if (_selectedBarEl) {
    const cw = state.cellW || 22;
    _selectedBarEl.style.left  = (_bscBarOrigLeft + _bscDeltaStart * cw) + 'px';
    _selectedBarEl.style.width = (_bscBarOrigWidth + (_bscDeltaEnd - _bscDeltaStart) * cw) + 'px';
  }
}

function _bscStep(action) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const curStart = _bscOrigStart ? _bscShift(_bscOrigStart, _bscDeltaStart) : null;
  const curEnd   = _bscOrigEnd   ? _bscShift(_bscOrigEnd,   _bscDeltaEnd)   : null;
  if (action === 'start-dec') {
    _bscDeltaStart -= 1;
  } else if (action === 'start-inc') {
    const newStart = _bscOrigStart ? _bscShift(_bscOrigStart, _bscDeltaStart + 1) : null;
    if (newStart && curEnd && newStart > curEnd) return; // разрешаем start == end (однодневная задача)
    _bscDeltaStart += 1;
  } else if (action === 'end-dec') {
    const newEnd = _bscOrigEnd ? _bscShift(_bscOrigEnd, _bscDeltaEnd - 1) : null;
    if (newEnd && curStart && newEnd < curStart) return; // разрешаем end == start
    _bscDeltaEnd -= 1;
  } else if (action === 'end-inc') {
    if (_bscIsFact) {
      const newEnd = _bscOrigEnd
        ? _bscShift(_bscOrigEnd, _bscDeltaEnd + 1)
        : _bscShift(todayIso, _bscDeltaEnd + 1);
      if (newEnd > todayIso) { showToast('Нельзя ставить дату окончания в будущем', 'error'); return; }
    }
    _bscDeltaEnd += 1;
  }
  _bscUpdateDisplay();
  try { window.navigator.vibrate?.(6); } catch (_) {}
}

async function _bscSave() {
  if (!_bscTid) { deselectGanttBar(); return; }
  if (_bscDeltaStart === 0 && _bscDeltaEnd === 0) { hideBarStepCtrl(false); deselectGanttBar(); return; }
  const t = (state.schedule?.tasks || []).find(x => String(x.id) === String(_bscTid));
  if (!t) { deselectGanttBar(); return; }
  const patch = {};
  if (_bscIsFact) {
    if (_bscDeltaStart !== 0 && _bscOrigStart) patch.actualStart = _bscShift(_bscOrigStart, _bscDeltaStart);
    if (_bscDeltaEnd !== 0) {
      const base = _bscOrigEnd || new Date().toISOString().slice(0, 10);
      patch.actualEnd = _bscShift(base, _bscDeltaEnd);
    }
  } else {
    if (_bscDeltaStart !== 0 && _bscOrigStart) patch.planStart = _bscShift(_bscOrigStart, _bscDeltaStart);
    if (_bscDeltaEnd !== 0   && _bscOrigEnd)   patch.planEnd   = _bscShift(_bscOrigEnd,   _bscDeltaEnd);
  }
  if (!Object.keys(patch).length) { hideBarStepCtrl(false); deselectGanttBar(); return; }
  const inversePatch = {};
  for (const k of Object.keys(patch)) inversePatch[k] = t[k] || null;
  const savedTid = _bscTid;
  hideBarStepCtrl(false);
  deselectGanttBar();
  showToast('Сохраняю…');
  try {
    const r = await taskUpdateMaybeReason({ slug: state.projectSlug, taskId: savedTid, patch }, { subjectName: t.name });
    if (r.schedule) state.schedule = r.schedule;
    else Object.assign(t, patch);
    try { renderProjectAnalytics(); } catch (_) {}
    renderGantt();
    renderTasksSheet();
    showToast('✓ Даты обновлены', { action: { label: 'Отменить', onClick: async () => {
      const r2 = await taskUpdateMaybeReason({ slug: state.projectSlug, taskId: savedTid, patch: inversePatch }, { skipReason: true });
      if (r2.schedule) state.schedule = r2.schedule;
      else Object.assign(t, inversePatch);
      try { renderProjectAnalytics(); } catch (_) {}
      renderGantt(); renderTasksSheet();
      showToast('↶ Даты возвращены');
    }} });
  } catch (e) {
    try { renderGantt(); } catch (_) {}
    try { renderTasksSheet(); } catch (_) {}
    if (e.cancelled) {
      showToast('↶ Откат — причина не указана');
    } else {
      try { window.navigator.vibrate?.([40, 60, 40]); } catch (_) {}
      showToast('⚠ НЕ сохранилось: ' + (e.message || e) + ' · попробуй ещё раз', { level: 'error', action: { label: 'Понял', onClick: () => {} } });
    }
  }
}

let _bscBound = false;
function bindBarStepCtrl() {
  if (_bscBound) return;
  _bscBound = true;
  if (!document.getElementById('bar-step-ctrl')) {
    const el = document.createElement('div');
    el.id = 'bar-step-ctrl';
    el.className = 'bar-step-ctrl';
    el.hidden = true;
    el.innerHTML = `
      <div class="bsc-col">
        <div class="bsc-label">Старт</div>
        <div class="bsc-row">
          <button class="bsc-btn" data-bsc="start-dec">◀</button>
          <span class="bsc-val" id="bsc-start">—</span>
          <button class="bsc-btn" data-bsc="start-inc">▶</button>
        </div>
      </div>
      <div class="bsc-sep"></div>
      <div class="bsc-col">
        <div class="bsc-label">Финиш</div>
        <div class="bsc-row">
          <button class="bsc-btn" data-bsc="end-dec">◀</button>
          <span class="bsc-val" id="bsc-end">—</span>
          <button class="bsc-btn" data-bsc="end-inc">▶</button>
        </div>
      </div>
      <button class="bsc-save" id="bsc-save">✓</button>
      <button class="bsc-close" id="bsc-cancel">✕</button>`;
    document.body.appendChild(el);
  }
  document.getElementById('bar-step-ctrl').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-bsc]');
    if (btn) { _bscStep(btn.dataset.bsc); return; }
    if (e.target.id === 'bsc-save')   { _bscSave(); return; }
    if (e.target.id === 'bsc-cancel') { hideBarStepCtrl(true); deselectGanttBar(); }
  });
}
// ──────────────────────────────────────────────────────────────────────────────

let _kpBoundOnce = false;
function bindKpPopover() {
  if (_kpBoundOnce) return;
  _kpBoundOnce = true;
  // Capture phase — fires BEFORE gantt's own click handler (which calls stopPropagation).
  document.addEventListener('click', (e) => {
    const badge = e.target.closest('.task-crit-badge');
    if (!badge) {
      const pop = document.getElementById('kp-popover');
      if (pop && !pop.hidden && !e.target.closest('#kp-popover')) {
        pop.hidden = true;
      }
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    const labelEl = badge.closest('.task-label');
    const tid = labelEl?.getAttribute('data-tid');
    if (!tid) return;
    showKpPopover(badge, tid);
  }, true);
}

function showKpPopover(anchor, taskId) {
  const pop = document.getElementById('kp-popover');
  if (!pop) return;
  const sched = state.schedule;
  if (!sched) return;
  const tasks = sched.tasks || [];
  const taskById = new Map(tasks.map(t => [t.id, t]));
  const chain = getCriticalChain(taskId);
  const slack = state.cpmSlack?.get(taskId) ?? 0;
  const nameOf = (id) => escapeHtml((taskById.get(id) || {}).name || id);

  const chainHtml = chain.length > 1
    ? `<div class="kp-pop-chain">
         <div class="kp-pop-chain-title">Цепочка работ до завершения проекта</div>
         <ol class="kp-pop-chain-list">
           ${chain.map((id, i) => `<li class="${i === 0 ? 'is-self' : ''}">${nameOf(id)}</li>`).join('')}
         </ol>
       </div>`
    : '<div class="kp-pop-chain-title">Завершающая работа в цепочке.</div>';

  pop.innerHTML = `
    <div class="kp-pop-head">
      <span class="kp-pop-ico" aria-hidden="true">⚠</span>
      <div>
        <div class="kp-pop-title">Критический путь</div>
        <div class="kp-pop-sub">${slack <= 0 ? 'Запас по графику отсутствует' : 'Запас по графику: ' + slack + ' ' + plural(slack, ['день','дня','дней'])}. Задержка непосредственно влияет на срок сдачи проекта.</div>
      </div>
      <button class="kp-pop-close" type="button" aria-label="Закрыть">×</button>
    </div>
    <div class="kp-pop-body">
      ${chainHtml}
    </div>
  `;
  // Position near anchor
  const rect = anchor.getBoundingClientRect();
  const popW = 320;
  const left = Math.min(window.innerWidth - popW - 12, Math.max(12, rect.left + rect.width / 2 - popW / 2));
  const top = Math.min(window.innerHeight - 220, rect.bottom + 6);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  pop.style.width = popW + 'px';
  pop.hidden = false;

  pop.querySelector('.kp-pop-close')?.addEventListener('click', () => { pop.hidden = true; });
}

/* ──────────────────────────────────────────────────────────── */
/*  Drawer: Dependencies section                                */
/* ──────────────────────────────────────────────────────────── */

function buildDrawerDependenciesHtml(t) {
  const sched = state.schedule;
  if (!sched) return '';
  const tasks = sched.tasks || [];
  const taskById = new Map(tasks.map(x => [x.id, x]));
  const preds = depsForTask(t.id);
  const succs = dependentsOfTask(t.id);
  const predsByDep = new Map(preds.map(p => [p.dependsOnTaskId, p]));

  const succsHtml = succs.length
    ? succs.map(sid => {
        const ts = taskById.get(sid);
        if (!ts) return '';
        const sec = state.sectionById[ts.section] || { color: '#94a3b8' };
        return `<div class="dep-succ-row"><span class="dep-succ-dot" style="background:${sec.color}"></span><span class="dep-succ-name">${escapeHtml(ts.name)}</span></div>`;
      }).join('')
    : '<div class="drawer-dep-empty">— нет —</div>';

  const others = tasks.filter(x => x.id !== t.id);
  const rowsHtml = others.map(o => {
    const sec = state.sectionById[o.section] || { name: '', color: '#94a3b8' };
    const dep = predsByDep.get(o.id);
    const checked = !!dep;
    const auto = dep && dep.source === 'auto';
    return `<button type="button" class="dep-row${checked ? ' is-checked' : ''}" data-dep-id="${escapeHtml(o.id)}" data-name="${escapeHtml(o.name)}">
      <span class="dep-row-check" aria-hidden="true">${checked ? '✓' : ''}</span>
      <span class="dep-row-dot" style="background:${sec.color}"></span>
      <span class="dep-row-name">${escapeHtml(o.name)}</span>
      ${auto ? '<span class="dep-row-tag" title="Расставлено ИИ">ИИ</span>' : ''}
    </button>`;
  }).join('') || '<div class="drawer-dep-empty">Нет других работ</div>';

  return `
    <div class="drawer-section-title">🔗 Зависимости</div>
    <div id="drawer-deps-section" data-task-id="${escapeHtml(t.id)}">
      <div class="drawer-dep-block">
        <div class="drawer-dep-label">От неё зависят:</div>
        <div class="dep-succ-list">${succsHtml}</div>
      </div>
      <div class="drawer-dep-block">
        <div class="drawer-dep-label">Зависит от каких работ — отметьте галочкой:</div>
        <input type="search" class="dep-search" id="drawer-dep-search" placeholder="Поиск по названию…" />
        <div class="dep-rows" id="drawer-dep-rows">${rowsHtml}</div>
      </div>
    </div>
  `;
}

function bindDrawerDependenciesHandlers(taskId) {
  const section = document.getElementById('drawer-deps-section');
  if (!section) return;
  const search = section.querySelector('#drawer-dep-search');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase().trim();
      section.querySelectorAll('.dep-row').forEach(r => {
        const name = (r.getAttribute('data-name') || '').toLowerCase();
        r.style.display = !q || name.includes(q) ? '' : 'none';
      });
    });
  }
  section.querySelectorAll('.dep-row').forEach(row => {
    row.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (row.classList.contains('is-busy')) return;
      const depId = row.getAttribute('data-dep-id');
      if (!depId) return;
      const wasChecked = row.classList.contains('is-checked');
      row.classList.add('is-busy');
      try {
        if (wasChecked) {
          const r = await fetch('/api/dependencies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'remove', payload: { slug: state.projectSlug, taskId, dependsOnTaskId: depId } })
          });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          state.dataCache.taskDependencies = (state.dataCache.taskDependencies || []).filter(d => !(d.taskId === taskId && d.dependsOnTaskId === depId));
          row.classList.remove('is-checked');
          const tagEl = row.querySelector('.dep-row-tag'); if (tagEl) tagEl.remove();
          const checkEl = row.querySelector('.dep-row-check'); if (checkEl) checkEl.textContent = '';
        } else {
          const r = await fetch('/api/dependencies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add', payload: { slug: state.projectSlug, taskId, dependsOnTaskId: depId, source: 'manual' } })
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
          const filtered = (state.dataCache.taskDependencies || []).filter(d => !(d.taskId === taskId && d.dependsOnTaskId === depId));
          filtered.push(j.dep);
          state.dataCache.taskDependencies = filtered;
          row.classList.add('is-checked');
          const checkEl = row.querySelector('.dep-row-check'); if (checkEl) checkEl.textContent = '✓';
        }
        rebuildDepsGraph();
        renderProjectAnalytics();
        renderGantt();
      } catch (e) {
        alert('Не удалось обновить связь: ' + (e.message || e));
      } finally {
        row.classList.remove('is-busy');
      }
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   __MAINTENANCE_v1__ Лист планового обслуживания (PPM)
   Второй тип проекта: инженер заполняет фиксированный чек-лист с телефона,
   подписывает пальцем, выгружает PDF (официальный / неофициальный).
   ═══════════════════════════════════════════════════════════════════ */
const MAINTENANCE_TEMPLATE = {
  sections: [
    { id: 1, en: 'AIR CONDITIONING', ru: 'Кондиционирование воздуха', items: [
      { id: '1.1', en: 'Check units for abnormal noise and vibration', ru: 'Проверка блоков на наличие аномального шума и вибрации', status: 'pass' },
      { id: '1.2', en: 'Check wall thermostats and control panels operation', ru: 'Проверка работы настенных термостатов и ПУ', status: 'pass' },
      { id: '1.3', en: 'Measure and record supply air temperature', ru: 'Измерение и фиксация температуры приточного воздуха', status: 'pass', extra: [{ key: 'airTemp', label: 'Air Temp', unit: '°C' }] },
      { id: '1.4', en: 'Dismantle, wash and clean air filters', ru: 'Снятие, промывка и очистка воздушных фильтров', status: 'done' },
      { id: '1.5', en: 'Check, clean and align condensate drain tray', ru: 'Проверка, очистка и выравнивание поддона для конденсата', status: 'done' },
      { id: '1.6', en: 'Clean supply and return air grilles from dust', ru: 'Очистка приточных и вытяжных вентиляционных решёток', status: 'done' },
    ] },
    { id: 2, en: 'ELECTRICAL', ru: 'Электроснабжение', items: [
      { id: '2.1', en: 'Inspect DB for overheating cables/breakers', ru: 'Осмотр распред. щитов на перегрев кабелей/автоматов', status: 'pass' },
      { id: '2.2', en: 'Measure Amps and Volts in the main panel', ru: 'Измерение напряжения и силы тока в главном щите', status: 'pass', extra: [{ key: 'volts', label: 'V', unit: '' }, { key: 'amps', label: 'A', unit: '' }] },
      { id: '2.3', en: 'Check all switches, sockets and light fittings', ru: 'Проверка выключателей, розеток и осветительных приборов', status: 'pass' },
      { id: '2.4', en: 'Check exhaust fans correct operation', ru: 'Проверка исправности вытяжных вентиляторов', status: 'pass' },
    ] },
    { id: 3, en: 'PLUMBING', ru: 'Водопровод и канализация', items: [
      { id: '3.1', en: 'Visual inspection of exposed pipelines for leaks', ru: 'Осмотр открытых участков трубопроводов на наличие утечек', status: 'pass' },
      { id: '3.2', en: 'Check water heaters and thermostat settings', ru: 'Проверка водонагревателей и настроек термостата', status: 'pass' },
      { id: '3.3', en: 'Dismantle and clean bottle traps under sinks', ru: 'Снятие и очистка сифонов под раковинами', status: 'done' },
      { id: '3.4', en: 'Remove and clean aerators/filters on all taps', ru: 'Снятие и очистка аэраторов/фильтров на всех кранах', status: 'done' },
    ] },
    { id: 4, en: 'WATER SOFTENING SYSTEM', ru: 'Система умягчения воды', items: [
      { id: '4.1', en: 'General inspection and maintenance of the system', ru: 'Общий осмотр и техническое обслуживание системы', status: 'pass' },
      { id: '4.2', en: 'Replace filter cartridges', ru: 'Замена картриджей фильтров', status: 'done' },
      { id: '4.3', en: 'Top up the brine tank with new tablet salt', ru: 'Пополнение бака новой таблетированной солью', status: 'done', extra: [{ key: 'addedKg', label: 'Added', unit: 'kg' }, { key: 'addedPcs', label: '', unit: 'pcs' }] },
    ] },
  ],
  company: {
    name: 'CYFR FITOUT L.L.C',
    address: 'Office C1801-43, Ontario Tower, Business Bay, Dubai, UAE',
    tel: '+971 52 150 7953', email: 'info@cyfr.ae',
    licenseNo: '1499696', trn: '105018319100003',
    logo: '/maintenance-logo.png', stamp: '/maintenance-stamp.png',
  },
  engineer: { name: 'Mr. Anton Makarenko', title: 'Project Engineer' },
};

// Рабочее состояние текущего листа (одно на экран).
let mState = null;
let _mSaveTimer = null;
let _mSaveRetryTimer = null;
let _mOnlineBound = false;

// __MAINTENANCE_VISIT_CALENDAR_v1__ Большой удобный календарь выбора даты следующего визита
// (работает и на телефоне, и на компе — крупные клетки). Клик по дню = дата визита.
let _mCalView = null; // {y, m} показываемый месяц
const M_MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
function _isoLocal(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
// Несколько дат визитов: mState.visitDates = массив YYYY-MM-DD. Клик по дню — добавить/убрать.
function maintenanceVisitDates() { return (mState && Array.isArray(mState.visitDates)) ? mState.visitDates : []; }
function maintenanceCalendarHtml() {
  const sel = new Set(maintenanceVisitDates());
  const todayIso = _isoLocal(new Date());
  if (!_mCalView) {
    const upcoming = [...sel].filter((d) => d >= todayIso).sort()[0] || [...sel].sort()[0];
    const base = upcoming ? new Date(upcoming + 'T00:00:00') : new Date();
    _mCalView = { y: base.getFullYear(), m: base.getMonth() };
  }
  const { y, m } = _mCalView;
  const wd = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
  const lastDay = new Date(y, m + 1, 0).getDate();
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<div class="m-cal-cell m-cal-empty"></div>';
  for (let d = 1; d <= lastDay; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cls = (sel.has(iso) ? ' is-sel' : '') + (iso === todayIso ? ' is-today' : '') + (iso < todayIso ? ' is-past' : '');
    cells += `<button type="button" class="m-cal-cell m-cal-day${cls}" data-iso="${iso}">${d}</button>`;
  }
  const list = [...sel].sort();
  const chips = list.length
    ? list.map((iso) => { const dd = new Date(iso + 'T00:00:00'); const past = iso < todayIso; return `<span class="m-cal-chip${past ? ' is-past' : ''}">${dd.getDate()} ${M_MONTHS_RU[dd.getMonth()].slice(0, 3)} ${dd.getFullYear()}<button type="button" class="m-cal-chip-x" data-del-iso="${iso}" aria-label="убрать">✕</button></span>`; }).join('')
    : '<span class="m-cal-none">пока не выбрано — тыкни нужные дни в календаре</span>';
  return `<div class="m-cal">
    <div class="m-cal-head">
      <button type="button" class="m-cal-nav" data-cal-nav="-1" aria-label="предыдущий месяц">‹</button>
      <div class="m-cal-title">${M_MONTHS_RU[m]} ${y}</div>
      <button type="button" class="m-cal-nav" data-cal-nav="1" aria-label="следующий месяц">›</button>
    </div>
    <div class="m-cal-grid m-cal-wd">${wd.map((w) => `<div class="m-cal-wdname">${w}</div>`).join('')}</div>
    <div class="m-cal-grid m-cal-days">${cells}</div>
    <div class="m-cal-list"><div class="m-cal-list-h">📅 Запланированные визиты (${list.length}):</div><div class="m-cal-chips">${chips}</div></div>
  </div>`;
}
function rerenderMaintCalendar() {
  const z = document.getElementById('m-cal-zone');
  if (!z) return;
  z.innerHTML = maintenanceCalendarHtml();
  attachMaintCalendarHandlers(z);
}
function attachMaintCalendarHandlers(zone) {
  if (!zone) return;
  zone.querySelectorAll('[data-cal-nav]').forEach((b) => b.addEventListener('click', () => {
    let m = _mCalView.m + Number(b.getAttribute('data-cal-nav')), y = _mCalView.y;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    _mCalView = { y, m }; rerenderMaintCalendar();
  }));
  zone.querySelectorAll('.m-cal-day').forEach((d) => d.addEventListener('click', () => {
    const iso = d.getAttribute('data-iso');
    const arr = maintenanceVisitDates().slice();
    const i = arr.indexOf(iso);
    if (i >= 0) arr.splice(i, 1); else arr.push(iso);
    mState.visitDates = arr; maintenanceScheduleSave(); rerenderMaintCalendar();
  }));
  zone.querySelectorAll('[data-del-iso]').forEach((x) => x.addEventListener('click', () => {
    mState.visitDates = maintenanceVisitDates().filter((d) => d !== x.getAttribute('data-del-iso'));
    maintenanceScheduleSave(); rerenderMaintCalendar();
  }));
}

// __MAINTENANCE_CHECKLIST_v1__ Свой чек-лист у каждого листа (можно добавлять/удалять пункты).
// Источник по умолчанию — глобальный шаблон; при создании листа делается копия в mState.checklist.
function maintenanceDefaultChecklist() {
  return JSON.parse(JSON.stringify(MAINTENANCE_TEMPLATE.sections));
}
function mSections() { return (mState && Array.isArray(mState.checklist)) ? mState.checklist : []; }
function mSectionById(id) { return mSections().find((s) => String(s.id) === String(id)) || null; }
function maintenanceItemById(id) {
  for (const sec of mSections()) {
    const it = (sec.items || []).find((x) => x.id === id);
    if (it) return it;
  }
  return null;
}
function maintenanceNextItemId(sec) {
  let max = 0;
  for (const it of (sec.items || [])) { const t = Number(String(it.id).split('.').pop()); if (Number.isFinite(t) && t > max) max = t; }
  return `${sec.id}.${max + 1}`;
}
function maintenanceNextSectionId() {
  let max = 0;
  for (const s of mSections()) { const n = Number(s.id); if (Number.isFinite(n) && n > max) max = n; }
  return max + 1;
}

// Режим правки пунктов: одна строка-пункт с полями EN/RU + тип статуса + удалить.
function maintenanceItemEditRowHtml(sec, it) {
  const isDone = it.status === 'done';
  return `<div class="m-item m-item-edit" data-item="${escapeHtml(it.id)}">
    <div class="m-item-edit-top"><span class="m-item-no">${escapeHtml(it.id)}</span><button type="button" class="m-item-del" title="удалить пункт">✕ удалить</button></div>
    <input class="m-it-edit m-it-en" data-itfield="en" value="${escapeHtml(it.en || '')}" placeholder="Item (English)">
    <input class="m-it-edit m-it-ru" data-itfield="ru" value="${escapeHtml(it.ru || '')}" placeholder="Пункт (русский)">
    <div class="m-it-type">
      <button type="button" class="m-it-type-btn ${!isDone ? 'is-on' : ''}" data-type="pass">✓ Норма / ✗ Не норма</button>
      <button type="button" class="m-it-type-btn ${isDone ? 'is-on' : ''}" data-type="done">✓ Сделано / ✗ Не сделано</button>
    </div>
  </div>`;
}
// Зона чек-листа = тулбар + секции + кнопки. Перерисовывается отдельно, не трогая остальной экран.
function checklistZoneHtml() {
  const editing = !!(mState && mState.editItems);
  const secHtml = mSections().map((sec, si) => {
    const rows = (sec.items || []).map((it) => editing ? maintenanceItemEditRowHtml(sec, it) : maintenanceItemRowHtml(it)).join('');
    const head = editing
      ? `<div class="m-section-head m-section-head--edit">
           <span class="m-section-no">${si + 1}</span>
           <input class="m-sec-edit m-sec-en" data-secfield="en" value="${escapeHtml(sec.en || '')}" placeholder="SECTION (EN)">
           <input class="m-sec-edit m-sec-ru" data-secfield="ru" value="${escapeHtml(sec.ru || '')}" placeholder="Раздел (рус)">
           <button type="button" class="m-sec-del" title="удалить раздел">✕</button>
         </div>`
      : `<div class="m-section-head"><span class="m-section-no">${si + 1}</span><span class="m-section-name">${escapeHtml(sec.en)}</span><span class="m-section-ru">${escapeHtml(sec.ru)}</span></div>`;
    return `<div class="m-section" data-section="${escapeHtml(String(sec.id))}">
      ${head}
      ${rows}
      ${editing ? `<button type="button" class="m-item-add" data-section="${escapeHtml(String(sec.id))}">＋ добавить пункт</button>` : ''}
    </div>`;
  }).join('');
  const bar = `<div class="m-edit-bar">
    <button type="button" class="m-edit-toggle ${editing ? 'is-on' : ''}" id="m-edit-toggle">${editing ? '✓ Готово' : '✏️ Править пункты'}</button>
    ${editing ? '<span class="m-edit-hint">меняй текст пунктов, ＋ добавляй и ✕ удаляй</span>' : ''}
  </div>`;
  const addSec = editing ? `<button type="button" class="m-section-add" id="m-section-add">＋ Добавить раздел</button>` : '';
  // В режиме правки показываем и удаление всего листа — там, где его естественно искать.
  const delProj = editing
    ? `<div class="m-edit-danger">
         <button type="button" class="m-delete-btn" id="m-edit-delete-proj">🗑 Удалить весь лист обслуживания</button>
         <div class="m-edit-danger-sub">Удалит проект целиком со всей историей. Исчезнет с главной. Отменить нельзя.</div>
       </div>`
    : '';
  return bar + secHtml + addSec + delProj;
}
function rerenderChecklistZone(s) {
  const zone = document.getElementById('m-checklist-zone');
  if (!zone) return;
  zone.innerHTML = checklistZoneHtml();
  attachChecklistHandlers(zone, s);
}
function attachChecklistHandlers(zone, s) {
  if (!zone) return;
  const tg = zone.querySelector('#m-edit-toggle');
  if (tg) tg.addEventListener('click', () => { mState.editItems = !mState.editItems; rerenderChecklistZone(s); });
  const delP = zone.querySelector('#m-edit-delete-proj');
  if (delP) delP.addEventListener('click', () => maintenanceDeleteProject(s, delP));
  const addS = zone.querySelector('#m-section-add');
  if (addS) addS.addEventListener('click', () => {
    mSections().push({ id: maintenanceNextSectionId(), en: '', ru: '', items: [] });
    maintenanceScheduleSave(); rerenderChecklistZone(s);
  });
  zone.querySelectorAll('.m-section[data-section]').forEach((secEl) => {
    const secId = secEl.getAttribute('data-section');
    const sec = mSectionById(secId);
    if (!sec) return;
    secEl.querySelectorAll('[data-secfield]').forEach((inp) => {
      inp.addEventListener('input', () => { sec[inp.getAttribute('data-secfield')] = inp.value; maintenanceScheduleSave(); });
    });
    const dS = secEl.querySelector('.m-sec-del');
    if (dS) dS.addEventListener('click', () => {
      if (!confirm('Удалить весь раздел и все его пункты?')) return;
      mState.checklist = mSections().filter((x) => String(x.id) !== String(secId));
      maintenanceScheduleSave(); rerenderChecklistZone(s);
    });
    const aI = secEl.querySelector('.m-item-add');
    if (aI) aI.addEventListener('click', () => {
      sec.items = sec.items || [];
      sec.items.push({ id: maintenanceNextItemId(sec), en: '', ru: '', status: 'pass' });
      maintenanceScheduleSave(); rerenderChecklistZone(s);
    });
    secEl.querySelectorAll('.m-item[data-item]').forEach((row) => {
      const id = row.getAttribute('data-item');
      if (mState.editItems) {
        const it = (sec.items || []).find((x) => x.id === id);
        if (!it) return;
        row.querySelectorAll('[data-itfield]').forEach((inp) => {
          inp.addEventListener('input', () => { it[inp.getAttribute('data-itfield')] = inp.value; maintenanceScheduleSave(); });
        });
        row.querySelectorAll('.m-it-type-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            it.status = btn.getAttribute('data-type');
            row.querySelectorAll('.m-it-type-btn').forEach((b) => b.classList.toggle('is-on', b.getAttribute('data-type') === it.status));
            maintenanceScheduleSave();
          });
        });
        const dI = row.querySelector('.m-item-del');
        if (dI) dI.addEventListener('click', () => {
          sec.items = (sec.items || []).filter((x) => x.id !== id);
          maintenanceScheduleSave(); rerenderChecklistZone(s);
        });
      } else {
        if (!mState.answers[id]) mState.answers[id] = { value: '', notes: '', extra: {} };
        row.querySelectorAll('.m-st').forEach((btn) => {
          btn.addEventListener('click', () => {
            const val = btn.getAttribute('data-val');
            const a = mState.answers[id];
            a.value = (a.value === val) ? '' : val;
            row.querySelectorAll('.m-st').forEach((b) => b.classList.toggle('is-on', b.getAttribute('data-val') === a.value));
            maintenanceScheduleSave();
          });
        });
        const noteEl = row.querySelector('[data-note]');
        if (noteEl) noteEl.addEventListener('input', () => { mState.answers[id].notes = noteEl.value; maintenanceScheduleSave(); });
        row.querySelectorAll('[data-extra]').forEach((ex) => {
          ex.addEventListener('input', () => { const a = mState.answers[id]; a.extra = a.extra || {}; a.extra[ex.getAttribute('data-extra')] = ex.value; maintenanceScheduleSave(); });
        });
      }
    });
  });
}

// __MAINTENANCE_AUTOSAVE_RESILIENT_v1__ Автосейв листа осмотра, устойчивый к обрыву сети в поле.
// Каждое сохранение сперва кладётся в буфер браузера (localStorage) — переживает обрыв сети и
// перезагрузку вкладки. При неудаче статус честно говорит «нет сети, сохраню позже» и сам
// повторяет: по таймеру и при возврате сети (событие online). Данные инженера не теряются.
function _mPendingKey(slug) { return 'mPendingSave:' + (slug || state.projectSlug || ''); }
function _mSetSaveStatus(text, kind) { // kind: 'saving' | 'ok' | 'warn'
  const el = document.getElementById('m-save-status'); if (!el) return;
  el.textContent = text;
  el.classList.toggle('ok', kind === 'ok');
  el.classList.toggle('warn', kind === 'warn');
}
function _mWriteBuffer(payload) { try { localStorage.setItem(_mPendingKey(payload.slug), JSON.stringify({ at: Date.now(), payload })); } catch (_) {} }
function _mClearBuffer(slug) { try { localStorage.removeItem(_mPendingKey(slug)); } catch (_) {} }
function _mReadBuffer(slug) {
  try { const raw = localStorage.getItem(_mPendingKey(slug)); if (!raw) return null; const o = JSON.parse(raw); return (o && o.payload) ? o : null; }
  catch (_) { return null; }
}

function buildMaintenanceSavePayload() {
  const report = { meta: mState.meta, answers: mState.answers, defects: mState.defects, signature: mState.signature };
  const payload = { slug: state.projectSlug, report, official: mState.official, contractNo: mState.contractNo,
    checklist: mState.checklist, visitDates: maintenanceVisitDates(),
    engineerChatId: mState.engineerChatId, engineerName: mState.engineerName, mapsUrl: mState.mapsUrl, intervalMonths: mState.intervalMonths, by: 'web' };
  // nextDueDate (одиночное, для совместимости/отображения) = ближайший предстоящий из визитов.
  const _today = _isoLocal(new Date());
  const _up = payload.visitDates.filter((d) => d >= _today).sort()[0] || payload.visitDates.slice().sort().pop() || '';
  mState.nextDueDate = _up;
  payload.nextDueDate = _up;
  return payload;
}

function _mPushSave(payload, isRecovery) {
  _mWriteBuffer(payload); // буфер до отправки — на случай обрыва прямо сейчас
  return postDataAction('maintenance:save', payload)
    .then(() => {
      _mClearBuffer(payload.slug);
      _mSetSaveStatus('✓ сохранено', 'ok');
      if (isRecovery) showToast('✓ восстановил несохранённые правки');
      return true;
    })
    .catch((e) => {
      console.warn('maintenance save', e);
      _mSetSaveStatus('⚠ нет сети — сохраню позже', 'warn');
      clearTimeout(_mSaveRetryTimer);
      _mSaveRetryTimer = setTimeout(() => maintenanceFlushPendingSave(payload.slug), 8000);
      return false;
    });
}

// Доотправить буфер (по таймеру, при возврате сети, или при открытии листа после обрыва).
function maintenanceFlushPendingSave(slug, isRecovery) {
  slug = slug || state.projectSlug;
  const o = _mReadBuffer(slug);
  if (!o) return;
  if (Date.now() - (o.at || 0) > 24 * 3600 * 1000) { _mClearBuffer(slug); return; } // протух — не перетираем свежие данные
  _mSetSaveStatus('сохраняю…', 'saving');
  _mPushSave(o.payload, isRecovery);
}

function maintenanceScheduleSave() {
  clearTimeout(_mSaveTimer);
  _mSaveTimer = setTimeout(() => { _mPushSave(buildMaintenanceSavePayload()); }, 700);
  _mSetSaveStatus('сохраняю…', 'saving');
  // Один раз: при возврате сети — доотправляем буфер автоматически.
  if (!_mOnlineBound) {
    _mOnlineBound = true;
    window.addEventListener('online', () => maintenanceFlushPendingSave());
  }
}

function renderMaintenanceView(s) {
  injectMaintenanceStyles();
  hideAdminMenu();
  hideMobileTasksFab();
  document.title = (s.project.name || 'Лист обслуживания') + ' · Обслуживание · CYFR';
  const m = s.maintenance || {};
  const r = m.report || {};
  mState = {
    official: m.official === true,
    contractNo: m.contractNo || (r.meta && r.meta.contractNo) || '',
    meta: Object.assign({ contractNo: m.contractNo || '', propertyAddress: s.project.location || '', customer: s.project.customer || '', date: { day: '', month: '', year: String(new Date().getFullYear()) } }, r.meta || {}),
    answers: r.answers || {},
    defects: r.defects || { selected: 'a', notes: '' },
    signature: r.signature || { png: '', engineerName: '', engineerTitle: 'Project Engineer', signedAt: '' },
    nextDueDate: m.nextDueDate || '',
    lastVisitDate: m.lastVisitDate || '',
    engineerChatId: m.engineerChatId || '',
    engineerName: m.engineerName || '',
    mapsUrl: m.mapsUrl || '',
    intervalMonths: m.intervalMonths || 6,
    archive: Array.isArray(m.archive) ? m.archive : [],
  };
  // __MAINTENANCE_CHECKLIST_v1__ Своя копия пунктов листа. Старые листы без checklist
  // подхватывают копию шаблона (мигрируют при первом автосохранении).
  mState.checklist = (Array.isArray(m.checklist) && m.checklist.length) ? m.checklist : maintenanceDefaultChecklist();
  mState.editItems = false;
  _mCalView = null; // календарь визита заново считает месяц от выбранной даты этого листа
  // Несколько дат визитов. Старые листы (одиночный nextDueDate) мигрируют в массив.
  mState.visitDates = Array.isArray(m.visitDates) ? m.visitDates.slice() : (m.nextDueDate ? [m.nextDueDate] : []);

  const page = clearPageBelowTopbar();
  if (!page) return;
  const wrap = document.createElement('section');
  wrap.className = 'm-wrap';
  page.appendChild(wrap);

  const meta = mState.meta;
  wrap.innerHTML = `
    <div class="m-top">
      <a class="m-back" href="/">‹ Все проекты</a>
      <div class="m-save-status" id="m-save-status"></div>
    </div>
    <h1 class="m-title">Лист планового обслуживания</h1>
    <div class="m-sub">${escapeHtml(s.project.name || '')}</div>

    <div class="m-officialbar">
      <label class="m-switch">
        <input type="checkbox" id="m-official" ${mState.official ? 'checked' : ''}>
        <span class="m-switch-track"><span class="m-switch-thumb"></span></span>
        <span class="m-switch-label">${mState.official ? 'Официальный (с печатью и логотипом)' : 'Неофициальный (без печати)'}</span>
      </label>
    </div>

    <div class="m-meta">
      <label class="m-field"><span>Номер контракта</span><input type="text" id="m-contract" value="${escapeHtml(meta.contractNo || '')}" placeholder="напр. 9-M или 1-XM"></label>
      <label class="m-field"><span>Адрес объекта</span><input type="text" id="m-address" value="${escapeHtml(meta.propertyAddress || '')}" placeholder="Apt. 902, Diamond, ..."></label>
      <label class="m-field"><span>Заказчик</span><input type="text" id="m-customer" value="${escapeHtml(meta.customer || '')}" placeholder="Ms. ..."></label>
      <div class="m-field m-field-date"><span>Дата осмотра (идёт в отчёт)</span>
        <div class="m-date-row">
          <input type="text" id="m-date-day" inputmode="numeric" maxlength="2" value="${escapeHtml(meta.date && meta.date.day || '')}" placeholder="ДД">
          <input type="text" id="m-date-month" maxlength="12" value="${escapeHtml(meta.date && meta.date.month || '')}" placeholder="месяц">
          <input type="text" id="m-date-year" inputmode="numeric" maxlength="4" value="${escapeHtml(meta.date && meta.date.year || '')}" placeholder="ГГГГ">
        </div>
      </div>
      <div class="m-field"><span>Визиты — отметь нужные дни (можно несколько, бот напомнит по каждому)</span>
        <div id="m-cal-zone">${maintenanceCalendarHtml()}</div>
        ${mState.lastVisitDate ? `<em class="m-hint">последний визит: ${escapeHtml(mState.lastVisitDate)}</em>` : ''}
      </div>
    </div>

    <details class="m-settings" ${mState.engineerChatId || mState.mapsUrl ? '' : 'open'}>
      <summary>⚙️ Настройки и напоминания</summary>
      <div class="m-meta">
        <label class="m-field"><span>Telegram ID инженера (кому слать напоминание)</span><input type="text" id="m-eng-id" inputmode="numeric" value="${escapeHtml(mState.engineerChatId || '')}" placeholder="напр. 1861757950"><em class="m-hint">Инженер должен один раз написать боту @Cyfr_work_bot, иначе бот не сможет ему написать.</em></label>
        <label class="m-field"><span>Имя инженера</span><input type="text" id="m-eng-name" value="${escapeHtml(mState.engineerName || '')}" placeholder="напр. Антон М."></label>
        <label class="m-field"><span>Ссылка на карту (Google Maps)</span><input type="url" id="m-maps" value="${escapeHtml(mState.mapsUrl || '')}" placeholder="https://maps.google.com/?q=..."><em class="m-hint">В напоминании будет кнопка «Открыть маршрут» — откроет навигатор на телефоне.</em></label>
        <label class="m-field"><span>Как часто визит (месяцев)</span><input type="number" id="m-interval" min="1" max="60" value="${escapeHtml(String(mState.intervalMonths || 6))}"><em class="m-hint">6 = два раза в год. После «Завершить осмотр» следующий визит ставится сам через это число месяцев.</em></label>
      </div>
    </details>

    <div id="m-checklist-zone">${checklistZoneHtml()}</div>

    <div class="m-section m-defects">
      <div class="m-section-head"><span class="m-section-name">Выявленные дефекты и замечания</span></div>
      <label class="m-defect-opt"><input type="radio" name="m-defect" value="a" ${mState.defects.selected === 'a' ? 'checked' : ''}><span>Дефектов нет — все системы исправны и работают нормально</span></label>
      <label class="m-defect-opt"><input type="radio" name="m-defect" value="b" ${mState.defects.selected === 'b' ? 'checked' : ''}><span>Есть дефекты (укажите номер пункта, описание и что нужно сделать)</span></label>
      <div class="m-defect-notes-wrap" ${mState.defects.selected === 'b' ? '' : 'hidden'}>
        <textarea id="m-defect-notes" rows="4" placeholder="Опишите дефекты…">${escapeHtml(mState.defects.notes || '')}</textarea>
        <button type="button" class="m-voice-btn" data-voice="defects">🎤 Надиктовать голосом</button>
      </div>
    </div>

    <div class="m-section m-sign">
      <div class="m-section-head"><span class="m-section-name">Подпись инженера</span></div>
      <div class="m-sign-name">${mState.engineerName ? escapeHtml(mState.engineerName) + ' · Project Engineer' : '<span class="m-sign-noeng">Имя инженера не указано — впиши в «⚙️ Настройки и напоминания»</span>'}</div>
      <div class="m-sign-box" id="m-sign-box">
        ${mState.signature.png ? `<img src="${mState.signature.png}" alt="подпись" class="m-sign-img">` : '<div class="m-sign-empty">подпись не поставлена</div>'}
      </div>
      <button type="button" class="m-sign-btn" id="m-sign-btn">✍️ Расписаться пальцем</button>
    </div>

    <div class="m-actions">
      <button type="button" class="m-complete-btn" id="m-complete-btn">✅ Завершить осмотр</button>
      <div class="m-share-row">
        <button type="button" class="m-share-btn" id="m-share-btn">📲 Поделиться (WhatsApp / Telegram)</button>
        <button type="button" class="m-pdf-btn" id="m-pdf-btn">📄 Скачать PDF</button>
        <button type="button" class="m-send-btn" id="m-send-btn">📤 Отправить клиенту</button>
      </div>
    </div>
    <div class="m-foot-note">Порядок: заполни лист → подпись пальцем → «Завершить осмотр». После завершения сохранится копия в историю, поставится следующий визит, и готовый PDF (офиц./неофиц.) уйдёт руководителю в Telegram. Поделиться или скачать можно в любой момент.</div>

    <div class="m-section m-history" id="m-history">${maintenanceHistoryHtml()}</div>
  `;

  attachMaintenanceHandlers(wrap, s);
}

// История завершённых отчётов (из архива). Каждый можно перегенерировать в PDF.
function maintenanceHistoryHtml() {
  const arch = mState.archive || [];
  const head = '<div class="m-section-head"><span class="m-section-name">📚 История отчётов</span><span class="m-section-ru">завершённые осмотры</span></div>';
  if (!arch.length) return head + '<div class="m-hist-empty">Пока нет завершённых отчётов. Заполни лист, подпиши и нажми «Завершить осмотр».</div>';
  const rows = arch.map((a) => {
    const dft = a.defects && a.defects.selected === 'b';
    return `<div class="m-hist-row" data-report="${escapeHtml(a.id)}">
      <div class="m-hist-info">
        <div class="m-hist-date">🗓 ${escapeHtml(a.visitDate || (a.completedAt || '').slice(0, 10))}</div>
        <div class="m-hist-meta">${a.official ? '<span class="m-hist-badge">официальный</span>' : '<span class="m-hist-badge m-hist-badge--un">неоф.</span>'} ${dft ? '<span class="m-hist-badge m-hist-badge--warn">есть дефекты</span>' : '<span class="m-hist-badge m-hist-badge--ok">без дефектов</span>'}</div>
      </div>
      <button type="button" class="m-hist-pdf" data-report="${escapeHtml(a.id)}">📄 PDF</button>
    </div>`;
  }).join('');
  return head + rows;
}

function maintenanceItemRowHtml(it) {
  const ans = mState.answers[it.id] || {};
  const posVal = it.status === 'pass' ? 'pass' : 'done';
  const negVal = it.status === 'pass' ? 'notpass' : 'notdone';
  const posLabel = it.status === 'pass' ? 'Норма' : 'Сделано';
  const negLabel = it.status === 'pass' ? 'Не норма' : 'Не сделано';
  const extraHtml = (it.extra || []).map((ex) => {
    const v = (ans.extra && ans.extra[ex.key]) || '';
    return `<label class="m-extra"><span>${escapeHtml(ex.label || '')}</span><input type="text" data-extra="${escapeHtml(ex.key)}" value="${escapeHtml(v)}" placeholder="—">${ex.unit ? `<i>${escapeHtml(ex.unit)}</i>` : ''}</label>`;
  }).join('');
  return `<div class="m-item" data-item="${it.id}">
    <div class="m-item-head"><span class="m-item-no">${it.id}</span><span class="m-item-en">${escapeHtml(it.en)}</span></div>
    <div class="m-item-ru">${escapeHtml(it.ru)}</div>
    <div class="m-item-controls">
      <div class="m-status">
        <button type="button" class="m-st m-st-pos ${ans.value === posVal ? 'is-on' : ''}" data-val="${posVal}">✓ ${posLabel}</button>
        <button type="button" class="m-st m-st-neg ${ans.value === negVal ? 'is-on' : ''}" data-val="${negVal}">✗ ${negLabel}</button>
      </div>
      ${extraHtml ? `<div class="m-extras">${extraHtml}</div>` : ''}
    </div>
    <input type="text" class="m-item-note" data-note="1" value="${escapeHtml(ans.notes || '')}" placeholder="Заметка / причина (если не норма)">
  </div>`;
}

function attachMaintenanceHandlers(wrap, s) {
  // Официальный / неофициальный
  const off = wrap.querySelector('#m-official');
  off.addEventListener('change', () => {
    mState.official = off.checked;
    const lbl = wrap.querySelector('.m-switch-label');
    if (lbl) lbl.textContent = off.checked ? 'Официальный (с печатью и логотипом)' : 'Неофициальный (без печати)';
    maintenanceScheduleSave();
  });
  // Мета-поля
  const bindMeta = (id, set) => { const el = wrap.querySelector(id); if (el) el.addEventListener('input', () => { set(el.value); maintenanceScheduleSave(); }); };
  bindMeta('#m-contract', (v) => { mState.meta.contractNo = v; mState.contractNo = v; });
  bindMeta('#m-address', (v) => { mState.meta.propertyAddress = v; });
  bindMeta('#m-customer', (v) => { mState.meta.customer = v; });
  bindMeta('#m-date-day', (v) => { mState.meta.date.day = v; });
  bindMeta('#m-date-month', (v) => { mState.meta.date.month = v; });
  bindMeta('#m-date-year', (v) => { mState.meta.date.year = v; });

  // Пункты чек-листа (статусы/заметки + режим правки) — вынесены в отдельную зону.
  attachChecklistHandlers(wrap.querySelector('#m-checklist-zone'), s);

  // Дефекты
  wrap.querySelectorAll('input[name="m-defect"]').forEach((rb) => {
    rb.addEventListener('change', () => {
      mState.defects.selected = rb.value;
      const nw = wrap.querySelector('.m-defect-notes-wrap');
      if (nw) nw.hidden = rb.value !== 'b';
      maintenanceScheduleSave();
    });
  });
  const dn = wrap.querySelector('#m-defect-notes');
  if (dn) dn.addEventListener('input', () => { mState.defects.notes = dn.value; maintenanceScheduleSave(); });

  // Голосовая диктовка замечаний (использует тот же бэкенд транскрипции, что и отчёты)
  wrap.querySelectorAll('[data-voice]').forEach((vb) => {
    vb.addEventListener('click', () => maintenanceVoiceDictate(dn));
  });

  // Подпись
  const signBtn = wrap.querySelector('#m-sign-btn');
  if (signBtn) signBtn.addEventListener('click', () => openSignatureModal((png) => {
    mState.signature.png = png;
    mState.signature.signedAt = new Date().toISOString();
    mState.signature.engineerName = mState.engineerName || '';
    const box = wrap.querySelector('#m-sign-box');
    if (box) box.innerHTML = `<img src="${png}" alt="подпись" class="m-sign-img">`;
    maintenanceScheduleSave();
  }));

  // Следующий визит + настройки проекта (инженер / карта / частота)
  attachMaintCalendarHandlers(wrap.querySelector('#m-cal-zone'));
  bindMeta('#m-eng-id', (v) => { mState.engineerChatId = v.replace(/[^0-9-]/g, ''); });
  bindMeta('#m-eng-name', (v) => { mState.engineerName = v; });
  bindMeta('#m-maps', (v) => { mState.mapsUrl = v; });
  bindMeta('#m-interval', (v) => { mState.intervalMonths = Math.max(1, Math.min(60, Number(v) || 6)); });

  // PDF + отправка + завершение
  const pdfBtn = wrap.querySelector('#m-pdf-btn');
  if (pdfBtn) pdfBtn.addEventListener('click', () => buildMaintenancePdf(s, pdfBtn));
  const sendBtn = wrap.querySelector('#m-send-btn');
  if (sendBtn) sendBtn.addEventListener('click', () => maintenanceSendPdf(s, sendBtn));
  const shareBtn = wrap.querySelector('#m-share-btn');
  if (shareBtn) shareBtn.addEventListener('click', () => maintenanceSharePdf(s, shareBtn));
  const complBtn = wrap.querySelector('#m-complete-btn');
  if (complBtn) complBtn.addEventListener('click', () => maintenanceComplete(s, complBtn));

  // История: перегенерировать PDF архивного отчёта
  wrap.querySelectorAll('.m-hist-pdf').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.getAttribute('data-report');
      const snap = (mState.archive || []).find((x) => String(x.id) === String(id));
      if (snap) maintenanceDownloadArchived(snap, b);
    });
  });

  // Если прошлый сеанс не успел сохранить (обрыв сети, закрыли вкладку) — доотправляем буфер.
  maintenanceFlushPendingSave(state.projectSlug, true);
}

// Завершить осмотр → сервер архивирует копию, ставит следующий визит, чистит лист. Перерисовываем.
// __MAINTENANCE_COMPLETE_PDF_v2__ Надёжный порядок завершения:
// 1) собрать PDF из ТЕКУЩИХ (целых) данных листа, 2) заархивировать на сервере (источник правды),
// 3) отправить заранее собранный PDF руководителю, 4) перерисовать. Если отправка упала —
// данные не теряются (снимок в Истории), и инженеру явно сказано как переслать вручную.
async function maintenanceComplete(s, btn) {
  if (!mState.signature.png && !confirm('Отчёт ещё не подписан. Всё равно завершить и сохранить в историю?')) return;
  if (!confirm('Завершить осмотр? Копия отчёта уйдёт в историю, лист очистится под следующий визит.')) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Готовлю отчёт…'; }
  const engChat = mState.engineerChatId;

  // 1. Собираем PDF ПОКА данные листа целы (до архивации/очистки).
  let pdfB64 = null;
  try {
    const pdf = await maintenanceBuildPdfDoc();
    const blob = pdf.output('blob');
    pdfB64 = await new Promise((res2, rej2) => { const fr = new FileReader(); fr.onload = () => res2(String(fr.result)); fr.onerror = rej2; fr.readAsDataURL(blob); });
  } catch (e) {
    console.warn('maintenance pdf build failed', e);
    if (!confirm('Не получилось собрать PDF. Всё равно завершить осмотр и сохранить в Историю? (PDF можно пересобрать позже из Истории.)')) {
      if (btn) { btn.disabled = false; btn.textContent = '✅ Завершить осмотр'; }
      return;
    }
  }

  try {
    // 2. Архивируем: снимок в Историю + следующий визит + очистка листа.
    btn && (btn.textContent = 'Сохраняю…');
    const r = await postDataAction('maintenance:complete', { slug: state.projectSlug, by: 'web' });
    if (!r || !r.maintenance) throw new Error('сервер не вернул данные');

    // 3. Шлём заранее собранный PDF руководителю.
    let sentToManager = false;
    if (engChat && pdfB64) {
      try {
        btn && (btn.textContent = 'Отправляю отчёт руководителю…');
        const sr = await fetch('/api/maintenance-send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: state.projectSlug, pdfBase64: pdfB64, filename: maintenancePdfFilename(), target: engChat,
            caption: `✅ Осмотр завершён — ${(s.project && s.project.name) || ''}\n${mState.official ? '📄 Официальный отчёт (с печатью и логотипом)' : '📄 Неофициальный отчёт'}` }) });
        const sj = await sr.json().catch(() => ({}));
        sentToManager = !!(sj && sj.ok);
      } catch (e) { console.warn('send pdf to manager failed', e); }
    }

    // 4. Перерисовываем под следующий визит.
    const res = await fetch(scheduleJsonUrl(state.projectSlug), { cache: 'no-store' });
    const j = await res.json();
    const sched = j && j.schedule && j.ok ? j.schedule : j;
    state.schedule = sched;
    renderMaintenanceView(sched);

    // 5. Понятный итог + путь восстановления при провале отправки.
    let msg = '✅ Осмотр завершён. Отчёт сохранён в Историю, следующий визит запланирован.';
    if (engChat) {
      msg += sentToManager
        ? '\n📤 Готовый PDF отправлен руководителю в Telegram.'
        : '\n⚠️ PDF не ушёл руководителю. Отчёт цел — открой «📚 История отчётов» внизу и нажми PDF, чтобы переслать вручную. (Проверь Telegram ID в ⚙️ Настройках — инженер должен один раз написать боту.)';
    } else {
      msg += '\nℹ️ Чтобы готовый PDF уходил руководителю сам — впиши его Telegram ID в «⚙️ Настройки и напоминания».';
    }
    alert(msg);
  } catch (e) {
    alert('Не удалось завершить: ' + (e.message || e) + '\nДанные осмотра не потеряны — попробуй ещё раз.');
    if (btn) { btn.disabled = false; btn.textContent = '✅ Завершить осмотр'; }
  }
}

// __MAINTENANCE_DELETE_v1__ Удалить лист обслуживания целиком (как у фит-аут проектов).
// Бэкенд project:delete работает по slug одинаково для fit-out и maintenance.
async function maintenanceDeleteProject(s, btn) {
  const name = (s && s.project && s.project.name) || state.projectSlug || 'этот лист';
  const expected = String(name).trim();
  const typed = prompt(
    `⚠️ Удалить лист обслуживания «${expected}»?\n\n` +
    `Удалится сам лист, чек-лист, дефекты, подписи и вся история осмотров.\n` +
    `Проект исчезнет с главной страницы. Отменить нельзя.\n\n` +
    `Впиши название точно как «${expected}» для подтверждения:`
  );
  if (typed === null) return; // отмена
  if (typed.trim().toLowerCase() !== expected.toLowerCase()) {
    alert('Название не совпало. Удаление отменено.');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Удаляю…'; }
  try {
    await postDataAction('project:delete', { slug: state.projectSlug, confirmName: typed });
    showToast('✓ Лист удалён');
    setTimeout(() => { window.location.href = '/'; }, 900);
  } catch (e) {
    alert('Не удалось удалить: ' + (e.message || e));
    if (btn) { btn.disabled = false; btn.textContent = '🗑 Удалить лист обслуживания'; }
  }
}

// Скачать PDF архивного (завершённого) отчёта из его снимка.
async function maintenanceDownloadArchived(snap, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const src = { official: snap.official, meta: snap.meta || {}, answers: snap.answers || {}, defects: snap.defects || { selected: 'a', notes: '' }, signature: snap.signature || {} };
    const pdf = await maintenanceBuildPdfDoc(src);
    const safeSlug = (state.projectSlug || 'report').replace(/[^a-z0-9-]/gi, '');
    pdf.save(`PPM-${safeSlug}-${snap.visitDate || (snap.completedAt || '').slice(0, 10)}.pdf`);
  } catch (e) {
    alert('Не удалось сделать PDF: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📄 PDF'; }
  }
}

// Голосовая диктовка в textarea замечаний — запись с микрофона → /api/transcribe.
async function maintenanceVoiceDictate(textarea) {
  if (!textarea) return;
  if (!navigator.mediaDevices || !window.MediaRecorder) { alert('Голос не поддерживается на этом устройстве — впиши текстом.'); return; }
  const btn = document.querySelector('[data-voice="defects"]');
  if (btn && btn.dataset.recording === '1') { window._mStopRec && window._mStopRec(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (btn) { btn.dataset.recording = '0'; btn.textContent = '🎤 Надиктовать голосом'; }
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const fd = new FormData(); fd.append('file', blob, 'note.webm');
      try {
        const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
        const j = await r.json().catch(() => ({}));
        const text = (j && (j.text || j.transcript)) || '';
        if (text) { textarea.value = (textarea.value ? textarea.value + ' ' : '') + text; mState.defects.notes = textarea.value; maintenanceScheduleSave(); }
        else alert('Не расслышал. Повтори или впиши текстом.');
      } catch (e) { alert('Ошибка распознавания: ' + (e.message || e)); }
    };
    window._mStopRec = () => rec.state !== 'inactive' && rec.stop();
    rec.start();
    if (btn) { btn.dataset.recording = '1'; btn.textContent = '⏹ Остановить запись'; }
  } catch (e) { alert('Нет доступа к микрофону.'); }
}

/* ── Подпись пальцем (signature_pad) ── */
let _sigPadPromise = null;
function loadSignaturePad() {
  if (_sigPadPromise) return _sigPadPromise;
  _sigPadPromise = new Promise((res, rej) => {
    if (window.SignaturePad) return res();
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/signature_pad@4.1.7/dist/signature_pad.umd.min.js';
    sc.onload = res; sc.onerror = () => rej(new Error('Не удалось загрузить signature_pad'));
    document.head.appendChild(sc);
  });
  return _sigPadPromise;
}

function openSignatureModal(onDone) {
  loadSignaturePad().then(() => {
    const ov = document.createElement('div');
    ov.className = 'm-sig-overlay';
    ov.innerHTML = `
      <div class="m-sig-card">
        <div class="m-sig-title">Распишитесь пальцем</div>
        <canvas class="m-sig-canvas" id="m-sig-canvas"></canvas>
        <div class="m-sig-line">— ведите пальцем по полю —</div>
        <div class="m-sig-actions">
          <button type="button" class="m-sig-clear" id="m-sig-clear">Стереть</button>
          <button type="button" class="m-sig-cancel" id="m-sig-cancel">Отмена</button>
          <button type="button" class="m-sig-done" id="m-sig-done">Готово</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const canvas = ov.querySelector('#m-sig-canvas');
    const pad = new window.SignaturePad(canvas, { minWidth: 1.2, maxWidth: 3.2, penColor: '#0b2a5b', backgroundColor: 'rgba(255,255,255,0)' });
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      canvas.getContext('2d').scale(ratio, ratio);
      pad.clear();
    };
    setTimeout(resize, 30);
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    const close = () => { window.removeEventListener('resize', onResize); ov.remove(); };
    ov.querySelector('#m-sig-clear').addEventListener('click', () => pad.clear());
    ov.querySelector('#m-sig-cancel').addEventListener('click', close);
    ov.querySelector('#m-sig-done').addEventListener('click', () => {
      if (pad.isEmpty()) { alert('Поставьте подпись или нажмите Отмена.'); return; }
      const png = pad.toDataURL('image/png');
      close();
      onDone(png);
    });
  }).catch((e) => alert(e.message || 'Ошибка подписи'));
}

/* ── PDF, точно как бумажный бланк ── */
function maintenancePdfFilename() {
  const safeSlug = (state.projectSlug || 'report').replace(/[^a-z0-9-]/gi, '');
  return `PPM-${safeSlug}-${new Date().toISOString().slice(0, 10)}.pdf`;
}

// Собрать документ PDF (jsPDF) из состояния src (по умолчанию — текущий лист mState).
// Для архивных отчётов передаётся снимок: { official, meta, answers, defects, signature }.
async function maintenanceBuildPdfDoc(src) {
  src = src || mState;
  await loadPdfLibs();
  maintenanceLoadBrandFont();
  const host = document.createElement('div');
  host.className = 'm-pdf-host' + (src.official ? ' is-official' : '');
  host.innerHTML = maintenancePdfPagesHtml(src);
  document.body.appendChild(host);
  try {
    if (document.fonts) {
      try { await Promise.all(['400 14px Mulish', '600 14px Mulish', '700 16px Mulish', '800 18px Mulish', 'italic 400 12px Mulish'].map((f) => document.fonts.load(f))); } catch (_) {}
      try { await document.fonts.ready; } catch (_) {}
    }
    // дождаться загрузки картинок (подпись/лого)
    await Promise.all(Array.from(host.querySelectorAll('img')).map((img) => img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pages = host.querySelectorAll('.m-pdf-page');
    for (let i = 0; i < pages.length; i++) {
      const canvas = await window.html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      // JPEG вместо PNG: страница-картинка весит ~0.3 МБ вместо ~14 МБ — важно для отправки клиенту.
      const img = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, 0, 210, 297);
    }
    return pdf;
  } finally {
    host.remove();
  }
}

// __MAINTENANCE_SHARE_v1__ Поделиться готовым PDF куда угодно (WhatsApp/Telegram/почта) — системное «Поделиться».
async function maintenanceSharePdf(s, btn) {
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Готовлю PDF…'; }
  try {
    const pdf = await maintenanceBuildPdfDoc();
    const blob = pdf.output('blob');
    const file = new File([blob], maintenancePdfFilename(), { type: 'application/pdf' });
    const title = 'Отчёт о плановом обслуживании — ' + ((s.project && s.project.name) || '');
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title, text: title });
    } else {
      // Браузер не умеет делиться файлом (часто десктоп) — скачиваем, чтобы отправить вручную.
      pdf.save(maintenancePdfFilename());
      alert('Прямое «Поделиться» тут не поддерживается — PDF скачан, отправь его в WhatsApp/Telegram вручную. (На телефоне «Поделиться» работает напрямую.)');
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') { alert('Не удалось поделиться: ' + (e.message || e)); console.error(e); }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig || '📲 Поделиться (WhatsApp / Telegram)'; }
  }
}

async function buildMaintenancePdf(s, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Готовлю PDF…'; }
  try {
    const pdf = await maintenanceBuildPdfDoc();
    pdf.save(maintenancePdfFilename());
  } catch (e) {
    alert('Не удалось сделать PDF: ' + (e.message || e));
    console.error(e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📄 Скачать PDF'; }
  }
}

// Отправить готовый PDF в Telegram (бот) — пока владельцу (демо), потом в чат клиента.
async function maintenanceSendPdf(s, btn) {
  if (!mState.signature.png && !confirm('Отчёт ещё не подписан. Всё равно отправить?')) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Отправляю…'; }
  try {
    const pdf = await maintenanceBuildPdfDoc();
    const blob = pdf.output('blob');
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(blob); });
    const r = await fetch('/api/maintenance-send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: state.projectSlug, pdfBase64: b64, filename: maintenancePdfFilename(), caption: `Отчёт о плановом обслуживании — ${(s.project && s.project.name) || state.projectSlug}` })
    });
    const j = await r.json().catch(() => ({}));
    if (j && j.ok) alert(j.demo ? '✅ Отправлено тебе в Telegram (демо). Когда дашь чат клиента — будет уходить туда.' : '✅ Отчёт отправлен в чат клиента.');
    else alert('⚠️ Не удалось отправить: ' + ((j && j.reason) || (j && j.results && j.results[0] && j.results[0].error) || 'ошибка'));
  } catch (e) {
    alert('Ошибка отправки: ' + (e.message || e));
    console.error(e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📤 Отправить отчёт'; }
  }
}

// Фирменный шрифт CYFR — Mulish (с кириллицей). Грузим один раз перед PDF.
function maintenanceLoadBrandFont() {
  if (document.getElementById('m-brand-font')) return;
  const l = document.createElement('link');
  l.id = 'm-brand-font'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Mulish:ital,wght@0,400;0,600;0,700;0,800;1,400&display=swap';
  document.head.appendChild(l);
}

function _mChk(on) { return `<span class="pcbx">${on ? '✓' : ''}</span>`; }

function maintenancePdfRowsHtml(sec, src) {
  const answers = (src && src.answers) || {};
  return sec.items.map((it) => {
    const ans = answers[it.id] || {};
    const isPass = it.status === 'pass';
    const posVal = isPass ? 'pass' : 'done', negVal = isPass ? 'notpass' : 'notdone';
    const posLabel = isPass ? 'Pass' : 'Done', negLabel = isPass ? 'Not Pass' : 'Not Done';
    const extras = (it.extra || []).map((ex) => {
      const v = (ans.extra && ans.extra[ex.key]) || '';
      return `${ex.label ? ex.label + ': ' : ''}${v || '____'}${ex.unit ? ' ' + ex.unit : ''}`;
    }).join('   ');
    const notes = [extras, ans.notes || ''].filter(Boolean).join(' · ');
    return `<tr>
      <td class="pno">${it.id}</td>
      <td class="ptask"><div class="pen">${escapeHtml(it.en)}</div><div class="pru">[${escapeHtml(it.ru)}]</div></td>
      <td class="pstatus">
        <div class="pstrow">${_mChk(ans.value === posVal)} ${posLabel}</div>
        <div class="pstrow">${_mChk(ans.value === negVal)} ${negLabel}</div>
      </td>
      <td class="pnotes">${escapeHtml(notes)}</td>
    </tr>`;
  }).join('');
}

function maintenancePdfSectionHtml(sec, src) {
  return `<tr class="psec"><td></td><td colspan="3">${sec.id}. ${escapeHtml(sec.en)}</td></tr>` + maintenancePdfRowsHtml(sec, src);
}

function maintenancePdfHeaderHtml() {
  const c = MAINTENANCE_TEMPLATE.company;
  // Шапка/лого только в официальном режиме (CSS скрывает в неофициальном).
  return `<div class="phead">
    <img class="plogo" src="${c.logo}" alt="" onerror="this.style.display='none'">
    <div class="pcompany">
      <div class="pcname">${escapeHtml(c.name)}</div>
      <div class="pcline">${escapeHtml(c.address)}</div>
      <div class="pcline">tel: ${escapeHtml(c.tel)} | email: ${escapeHtml(c.email)}</div>
      <div class="pcline">License No ${escapeHtml(c.licenseNo)} | TRN: ${escapeHtml(c.trn)}</div>
    </div>
  </div>`;
}

function maintenancePdfPagesHtml(src) {
  src = src || mState;
  const meta = src.meta || {};
  const date = meta.date || {};
  // __MAINTENANCE_CHECKLIST_v1__ Разделы — из самого листа (или снимка архива), не из общего шаблона.
  const secs = (Array.isArray(src.checklist) && src.checklist.length) ? src.checklist
             : (mSections().length ? mSections() : MAINTENANCE_TEMPLATE.sections);
  const metaBlock = `
    <div class="pmeta">
      <div><b>Contract No:</b> ${escapeHtml(meta.contractNo || '')}</div>
      <div><b>Property Address:</b> ${escapeHtml(meta.propertyAddress || '')}</div>
      <div><b>Customer:</b> ${escapeHtml(meta.customer || '')}</div>
      <div><b>Date:</b> «${escapeHtml(date.day || '__')}» ${escapeHtml(date.month || '________')} ${escapeHtml(date.year || '')}</div>
    </div>`;
  const tableHead = `<tr class="phrow"><th class="pno">No.</th><th>Task Description</th><th class="pstatus">Status</th><th class="pnotes">Notes (Reason if Not Pass / Not Done)</th></tr>`;

  const def = src.defects || { selected: 'a', notes: '' };
  const sig = src.signature || {};
  const defectsSignHtml = `
    <div class="pdefects">
      <div class="pdef-title">Identified Defects and Observations</div>
      <div class="pdef-opt">${_mChk(def.selected === 'a')} No defects found / All systems are fully operational and work normally.</div>
      <div class="pdef-opt">${_mChk(def.selected === 'b')} Defects identified (specify item number, description of the fault, and required actions):</div>
      <div class="pdef-notes">${escapeHtml(def.notes || '')}</div>
    </div>
    <div class="psign">
      <div class="psign-name"><b>${escapeHtml((src.signature && src.signature.engineerName) || src.engineerName || '')}</b><br>Project Engineer</div>
      <div class="psign-area">
        ${sig.png ? `<img class="psign-img" src="${sig.png}" alt="">` : ''}
        <div class="pstamp-ph">М.П.<br><span>печать</span></div>
        <div class="psign-line">Signature</div>
      </div>
    </div>`;

  // По 2 раздела на страницу (для 4 дефолтных — те же 2 страницы, что и раньше).
  // Дефекты+подпись добавляются после последнего раздела.
  const groups = [];
  for (let i = 0; i < secs.length; i += 2) groups.push(secs.slice(i, i + 2));
  if (!groups.length) groups.push([]);

  return groups.map((g, gi) => {
    const isFirst = gi === 0;
    const isLast = gi === groups.length - 1;
    return `<div class="m-pdf-page">
      ${isFirst ? `${maintenancePdfHeaderHtml()}<div class="ptitle">PLANNED PREVENTATIVE MAINTENANCE REPORT</div>${metaBlock}` : ''}
      <table class="ptable"><thead>${tableHead}</thead><tbody>
        ${g.map((sec) => maintenancePdfSectionHtml(sec, src)).join('')}
      </tbody></table>
      ${isLast ? defectsSignHtml : ''}
      <div class="ppagenum">${gi + 1}</div>
    </div>`;
  }).join('');
}

/* ── Создание maintenance-проекта (модалка) ── */
// __MAINTENANCE_FROM_PHOTO_v1__ Сжатие фото на клиенте перед отправкой (меньше трафик + дешевле OCR).
function maintenanceCompressPhoto(file, max = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
      else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      try { resolve(c.toDataURL('image/jpeg', quality)); } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('не удалось прочитать фото')); };
    img.src = url;
  });
}

function openCreateMaintenanceModal() {
  injectMaintenanceStyles(); // стили окна (.m-create-*, .m-field, .mc-tabs…) — на главной они ещё не подключены
  document.querySelectorAll('.m-create-overlay').forEach((e) => e.remove()); // не плодим окна
  let recognized = null; // { checklist, answers, defects, meta } из распознавания фото
  const ov = document.createElement('div');
  ov.className = 'm-create-overlay';
  ov.innerHTML = `
    <div class="m-create-card">
      <div class="m-create-title">Новый лист обслуживания</div>
      <div class="mc-tabs">
        <button type="button" class="mc-tab is-on" data-tab="manual">✍️ Вручную</button>
        <button type="button" class="mc-tab" data-tab="photo">📷 С фото</button>
      </div>
      <div class="mc-photo" id="mc-photo" hidden>
        <div class="mc-photo-hint">Сфоткай бумажный лист с двух сторон — ИИ сам прочитает пункты и галочки и заполнит лист. Потом всё можно поправить.</div>
        <label class="mc-file"><span id="mc-f1-name">📷 Фото — сторона 1</span><input type="file" id="mc-f1" accept="image/*" capture="environment"></label>
        <label class="mc-file"><span id="mc-f2-name">📷 Фото — сторона 2 (если есть)</span><input type="file" id="mc-f2" accept="image/*" capture="environment"></label>
        <button type="button" class="mc-recognize" id="mc-recognize">🔍 Распознать фото</button>
        <div class="mc-recog-status" id="mc-recog-status"></div>
      </div>
      <label class="m-field"><span>Название (объект)</span><input type="text" id="mc-name" placeholder="напр. Apt. 902, Diamond"></label>
      <label class="m-field"><span>Адрес объекта</span><input type="text" id="mc-address" placeholder="Apt. 902, Diamond, Palm Jumeirah, Dubai, UAE"></label>
      <label class="m-field"><span>Заказчик</span><input type="text" id="mc-customer" placeholder="Ms. ..."></label>
      <label class="m-field"><span>Номер контракта</span><input type="text" id="mc-contract" placeholder="напр. 9-M или 1-XM"></label>
      <label class="m-switch m-create-switch">
        <input type="checkbox" id="mc-official">
        <span class="m-switch-track"><span class="m-switch-thumb"></span></span>
        <span class="m-switch-label">Официальный (с печатью и логотипом)</span>
      </label>
      <div class="m-create-actions">
        <button type="button" class="m-create-cancel" id="mc-cancel">Отмена</button>
        <button type="button" class="m-create-go" id="mc-go">Создать</button>
      </div>
      <div class="m-create-err" id="mc-err"></div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('#mc-cancel').addEventListener('click', close);
  const $ = (s) => ov.querySelector(s);
  const offEl = $('#mc-official');
  offEl.addEventListener('change', () => { $('.m-create-switch .m-switch-label').textContent = offEl.checked ? 'Официальный (с печатью и логотипом)' : 'Неофициальный (без печати)'; });

  // Переключение вкладок «Вручную» / «С фото»
  ov.querySelectorAll('.mc-tab').forEach((t) => t.addEventListener('click', () => {
    ov.querySelectorAll('.mc-tab').forEach((x) => x.classList.toggle('is-on', x === t));
    $('#mc-photo').hidden = t.getAttribute('data-tab') !== 'photo';
  }));
  // Показать имя выбранного файла
  ['mc-f1', 'mc-f2'].forEach((id, i) => {
    const inp = $('#' + id);
    inp.addEventListener('change', () => { const n = $('#' + (i ? 'mc-f2-name' : 'mc-f1-name')); if (inp.files[0]) n.textContent = '✓ ' + inp.files[0].name.slice(0, 32); });
  });

  // Распознать фото → заполнить поля + запомнить чек-лист
  $('#mc-recognize').addEventListener('click', async () => {
    const st = $('#mc-recog-status');
    const f1 = $('#mc-f1').files[0], f2 = $('#mc-f2').files[0];
    if (!f1 && !f2) { st.textContent = 'Выбери хотя бы одно фото.'; st.className = 'mc-recog-status err'; return; }
    const rb = $('#mc-recognize'); rb.disabled = true;
    try {
      st.className = 'mc-recog-status'; st.textContent = 'Сжимаю фото…';
      const photos = [];
      if (f1) photos.push(await maintenanceCompressPhoto(f1));
      if (f2) photos.push(await maintenanceCompressPhoto(f2));
      st.textContent = '🤖 ИИ читает лист… (10-20 сек)';
      const r = await fetch('/api/maintenance-from-photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photos }) });
      const j = await r.json().catch(() => ({ ok: false, error: 'кривой ответ сервера' }));
      if (!j.ok) { st.className = 'mc-recog-status err'; st.textContent = 'Не вышло: ' + (j.error || 'ошибка'); rb.disabled = false; return; }
      recognized = { checklist: j.checklist, answers: j.answers || {}, defects: j.defects, meta: j.meta || {} };
      const m = j.meta || {};
      if (!$('#mc-name').value.trim()) $('#mc-name').value = m.customer || m.propertyAddress || '';
      if (m.propertyAddress) $('#mc-address').value = m.propertyAddress;
      if (m.customer) $('#mc-customer').value = m.customer;
      if (m.contractNo) $('#mc-contract').value = m.contractNo;
      const items = (j.checklist || []).reduce((n, s) => n + ((s.items && s.items.length) || 0), 0);
      const marked = Object.keys(j.answers || {}).length;
      st.className = 'mc-recog-status ok';
      st.textContent = `✓ Распознано: ${(j.checklist || []).length} разделов, ${items} пунктов, отмечено ${marked}. Проверь название и нажми «Создать».`;
    } catch (e) {
      st.className = 'mc-recog-status err'; st.textContent = 'Ошибка: ' + (e.message || e);
    } finally { rb.disabled = false; }
  });

  $('#mc-go').addEventListener('click', async () => {
    const name = $('#mc-name').value.trim();
    const err = $('#mc-err');
    if (!name) { err.textContent = 'Впиши название объекта (или распознай фото).'; return; }
    const btn = $('#mc-go'); btn.disabled = true; btn.textContent = 'Создаю…';
    try {
      const propertyAddress = $('#mc-address').value.trim();
      const customer = $('#mc-customer').value.trim();
      const contractNo = $('#mc-contract').value.trim();
      const r = await postDataAction('maintenance:create', { name, propertyAddress, customer, contractNo, official: offEl.checked });
      if (!r || !r.slug) throw new Error('сервер не вернул slug');
      // Если был распознан чек-лист с фото — сразу сохраняем его в новый лист.
      if (recognized && Array.isArray(recognized.checklist) && recognized.checklist.length) {
        btn.textContent = 'Сохраняю распознанное…';
        const rm = recognized.meta || {};
        await postDataAction('maintenance:save', {
          slug: r.slug,
          checklist: recognized.checklist,
          official: offEl.checked,
          contractNo,
          report: {
            meta: { contractNo, propertyAddress, customer, date: rm.date || { day: '', month: '', year: String(new Date().getFullYear()) } },
            answers: recognized.answers || {},
            defects: recognized.defects || { selected: 'a', notes: '' },
            signature: { png: '', engineerName: '', engineerTitle: 'Project Engineer', signedAt: '' },
          },
          by: 'web-photo',
        });
      }
      window.location.href = '/p/' + r.slug;
    } catch (e) { err.textContent = 'Ошибка: ' + (e.message || e); btn.disabled = false; btn.textContent = 'Создать'; }
  });
}

function injectMaintenanceStyles() {
  if (document.getElementById('m-styles')) return;
  const css = `
  .m-wrap{max-width:760px;margin:0 auto;padding:14px 14px 64px;color:var(--ink,#0f172a);}
  .m-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}
  .m-back{font-size:14px;color:var(--accent,#2563eb);text-decoration:none;}
  .m-save-status{font-size:12px;color:var(--muted,#64748b);}
  .m-save-status.ok{color:#16a34a;}
  .m-save-status.warn{color:#b45309;font-weight:700;}
  .m-title{font-size:22px;font-weight:800;margin:6px 0 2px;}
  .m-sub{font-size:14px;color:var(--muted,#64748b);margin-bottom:14px;}
  .m-officialbar{margin:10px 0 16px;}
  .m-switch{display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;}
  .m-switch input{display:none;}
  .m-switch-track{width:46px;height:26px;border-radius:999px;background:#cbd5e1;position:relative;transition:.2s;flex:0 0 auto;}
  .m-switch-thumb{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.3);}
  .m-switch input:checked + .m-switch-track{background:#2563eb;}
  .m-switch input:checked + .m-switch-track .m-switch-thumb{left:23px;}
  .m-switch-label{font-size:14px;font-weight:600;}
  .m-meta{display:grid;gap:10px;margin-bottom:18px;}
  .m-field{display:flex;flex-direction:column;gap:4px;}
  .m-field>span{font-size:12px;color:var(--muted,#64748b);font-weight:600;}
  .m-field input,.m-field textarea{font:inherit;font-size:15px;padding:10px 12px;border:1px solid var(--line,#e2e8f0);border-radius:10px;background:var(--surface,#fff);color:var(--ink,#0f172a);}
  .m-date-row{display:flex;gap:8px;}
  .m-date-row input{width:100%;}
  .m-date-row input:first-child{max-width:64px;}
  .m-date-row input:last-child{max-width:80px;}
  .m-section{background:var(--surface,#fff);border:1px solid var(--line,#e2e8f0);border-radius:14px;padding:12px;margin-bottom:14px;}
  .m-section-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--line-2,#eef2f6);}
  .m-section-no{font-weight:800;color:#fff;background:#475569;border-radius:6px;padding:1px 8px;font-size:13px;}
  .m-section-name{font-weight:800;font-size:15px;text-transform:uppercase;letter-spacing:.3px;}
  .m-section-ru{font-size:12px;color:var(--muted,#64748b);}
  .m-item{padding:12px 0;border-bottom:1px solid var(--line-2,#f1f5f9);}
  .m-item:last-child{border-bottom:none;}
  .m-item-head{display:flex;gap:8px;align-items:baseline;}
  .m-item-no{font-weight:700;color:var(--muted,#64748b);font-size:13px;flex:0 0 auto;}
  .m-item-en{font-weight:600;font-size:15px;line-height:1.3;}
  .m-item-ru{font-size:12.5px;color:var(--muted,#64748b);margin:2px 0 10px 24px;line-height:1.3;}
  .m-item-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-left:24px;}
  .m-status{display:flex;gap:8px;}
  .m-st{font:inherit;font-size:14px;font-weight:700;padding:10px 16px;border-radius:10px;border:1.5px solid var(--line,#e2e8f0);background:var(--surface,#fff);color:var(--ink,#0f172a);cursor:pointer;min-height:44px;}
  .m-st-pos.is-on{background:#16a34a;border-color:#16a34a;color:#fff;}
  .m-st-neg.is-on{background:#dc2626;border-color:#dc2626;color:#fff;}
  .m-extras{display:flex;gap:10px;flex-wrap:wrap;}
  .m-extra{display:flex;align-items:center;gap:5px;font-size:13px;color:var(--muted,#64748b);}
  .m-extra input{width:70px;font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--line,#e2e8f0);border-radius:8px;text-align:center;background:var(--surface,#fff);color:var(--ink,#0f172a);}
  .m-item-note{margin:10px 0 0 24px;width:calc(100% - 24px);font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--line,#e2e8f0);border-radius:8px;background:var(--surface,#fff);color:var(--ink,#0f172a);}
  .m-defect-opt{display:flex;gap:10px;align-items:flex-start;padding:8px 0;font-size:14px;cursor:pointer;}
  .m-defect-opt input{margin-top:3px;width:20px;height:20px;flex:0 0 auto;}
  .m-defect-notes-wrap{margin-top:8px;}
  .m-defect-notes-wrap textarea{width:100%;}
  .m-voice-btn{margin-top:8px;font:inherit;font-size:14px;padding:10px 14px;border-radius:10px;border:1.5px solid var(--accent,#2563eb);background:transparent;color:var(--accent,#2563eb);cursor:pointer;}
  .m-sign-name{font-size:14px;font-weight:600;margin-bottom:8px;}
  .m-sign-box{border:1.5px dashed var(--line,#cbd5e1);border-radius:12px;min-height:96px;display:flex;align-items:center;justify-content:center;background:#fff;margin-bottom:10px;}
  .m-sign-empty{color:var(--muted,#94a3b8);font-size:13px;}
  .m-sign-img{max-height:120px;max-width:100%;}
  .m-sign-btn,.m-pdf-btn,.m-send-btn,.m-share-btn,.m-complete-btn{font:inherit;font-size:16px;font-weight:700;padding:14px 18px;border-radius:12px;border:none;cursor:pointer;width:100%;min-height:52px;}
  .m-sign-btn{background:#0b2a5b;color:#fff;}
  .m-actions{margin-top:18px;display:flex;flex-direction:column;gap:10px;}
  .m-share-row{display:flex;flex-direction:column;gap:8px;border-top:1px dashed var(--line,#e2e8f0);padding-top:10px;margin-top:2px;}
  .m-pdf-btn{background:#fff;color:#2563eb;border:1.5px solid #2563eb;}
  .m-send-btn{background:#fff;color:#16a34a;border:1.5px solid #16a34a;}
  .m-share-btn{background:#25D366;color:#fff;}
  .m-complete-btn{background:#BD773E;color:#fff;font-size:17px;min-height:56px;}
  .m-sign-noeng{color:var(--muted,#94a3b8);font-weight:600;font-style:italic;font-size:13px;}
  /* __MAINTENANCE_VISIT_CALENDAR_v1__ большой календарь визита */
  .m-cal{border:1px solid var(--line,#e2e8f0);border-radius:14px;padding:12px;background:var(--surface,#fff);}
  .m-cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
  .m-cal-title{font-size:16px;font-weight:800;color:var(--ink,#0f172a);}
  .m-cal-nav{font:inherit;font-size:22px;font-weight:700;line-height:1;width:44px;height:44px;border-radius:10px;border:1.5px solid var(--line,#e2e8f0);background:var(--surface,#fff);color:var(--accent,#2563eb);cursor:pointer;}
  .m-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;}
  .m-cal-wd{margin-bottom:4px;}
  .m-cal-wdname{text-align:center;font-size:11px;font-weight:700;color:var(--muted,#94a3b8);padding:2px 0;}
  .m-cal-cell{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;font:inherit;font-size:15px;font-weight:600;border-radius:10px;}
  .m-cal-empty{visibility:hidden;}
  .m-cal-day{border:1.5px solid var(--line,#e2e8f0);background:var(--surface,#fff);color:var(--ink,#0f172a);cursor:pointer;min-height:40px;}
  .m-cal-day:hover{border-color:var(--accent,#2563eb);}
  .m-cal-day.is-past{color:var(--muted,#cbd5e1);background:var(--surface-2,#f8fafc);}
  .m-cal-day.is-today{border-color:#BD773E;font-weight:800;}
  .m-cal-day.is-sel{background:#2563eb!important;border-color:#2563eb!important;color:#fff!important;box-shadow:0 2px 8px rgba(37,99,235,.4);}
  .m-cal-list{margin-top:12px;border-top:1px solid var(--line-2,#eef2f6);padding-top:10px;}
  .m-cal-list-h{font-size:13px;font-weight:700;color:var(--ink,#0f172a);margin-bottom:8px;}
  .m-cal-chips{display:flex;flex-wrap:wrap;gap:8px;}
  .m-cal-chip{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;background:#eaf1ff;color:#1e40af;border-radius:999px;padding:6px 8px 6px 12px;}
  .m-cal-chip.is-past{background:var(--surface-2,#f1f5f9);color:var(--muted,#94a3b8);}
  .m-cal-chip-x{font:inherit;font-size:13px;font-weight:700;width:20px;height:20px;border-radius:50%;border:none;background:rgba(0,0,0,.08);color:inherit;cursor:pointer;line-height:1;}
  .m-cal-none{font-size:13px;color:var(--muted,#94a3b8);font-style:italic;}
  .m-hint{display:block;font-style:normal;font-size:11px;color:var(--muted,#94a3b8);margin-top:4px;}
  .m-settings{margin:0 0 18px;border:1px solid var(--line,#e2e8f0);border-radius:14px;background:var(--surface,#fff);overflow:hidden;}
  .m-settings>summary{cursor:pointer;padding:13px 14px;font-weight:700;font-size:15px;list-style:none;user-select:none;}
  .m-settings>summary::-webkit-details-marker{display:none;}
  .m-settings .m-meta{padding:0 14px 14px;margin:0;}
  .m-danger{margin:0 14px 14px;padding:13px 14px;border:1px solid rgba(220,38,38,.28);border-radius:12px;background:rgba(220,38,38,.05);}
  .m-danger-head{font-weight:700;font-size:14px;color:#b91c1c;}
  .m-danger-sub{font-size:12.5px;color:var(--muted,#94a3b8);margin:4px 0 10px;}
  .m-delete-btn{font:inherit;font-size:15px;font-weight:700;width:100%;min-height:48px;padding:12px 16px;border-radius:11px;border:1.5px solid #dc2626;background:#fff;color:#dc2626;cursor:pointer;}
  .m-delete-btn:active{background:#dc2626;color:#fff;}
  .m-delete-btn:disabled{opacity:.6;cursor:default;}
  .m-edit-danger{margin-top:18px;padding-top:16px;border-top:1px dashed rgba(220,38,38,.35);}
  .m-edit-danger-sub{font-size:12.5px;color:var(--muted,#94a3b8);margin-top:7px;text-align:center;}
  .m-history{margin-top:16px;}
  .m-hist-empty{color:var(--muted,#94a3b8);font-size:13px;padding:4px 0;}
  .m-hist-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid var(--line-2,#f1f5f9);}
  .m-hist-row:last-child{border-bottom:none;}
  .m-hist-date{font-weight:700;font-size:14px;}
  .m-hist-meta{margin-top:3px;display:flex;gap:6px;flex-wrap:wrap;}
  .m-hist-badge{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:#eef2f6;color:#475569;}
  .m-hist-badge--ok{background:rgba(34,197,94,.14);color:#15803d;}
  .m-hist-badge--warn{background:rgba(245,158,11,.16);color:#b45309;}
  .m-hist-badge--un{background:#f1f5f9;color:#64748b;}
  .m-hist-pdf{font:inherit;font-size:14px;font-weight:700;padding:9px 14px;border-radius:10px;border:1.5px solid #2563eb;background:#fff;color:#2563eb;cursor:pointer;flex:0 0 auto;min-height:42px;}
  .m-foot-note{text-align:center;font-size:12.5px;color:var(--muted,#94a3b8);margin-top:12px;}
  /* signature modal */
  .m-sig-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;}
  .m-sig-card{background:#fff;border-radius:16px;padding:16px;width:100%;max-width:520px;}
  .m-sig-title{font-size:16px;font-weight:700;margin-bottom:10px;color:#0f172a;}
  .m-sig-canvas{width:100%;height:220px;border:2px solid #cbd5e1;border-radius:12px;touch-action:none;background:#fff;display:block;}
  .m-sig-line{text-align:center;font-size:12px;color:#94a3b8;margin:6px 0 12px;}
  .m-sig-actions{display:flex;gap:8px;}
  .m-sig-actions button{flex:1;font:inherit;font-size:15px;font-weight:600;padding:12px;border-radius:10px;cursor:pointer;min-height:48px;border:1.5px solid #cbd5e1;background:#fff;color:#0f172a;}
  .m-sig-done{background:#16a34a!important;border-color:#16a34a!important;color:#fff!important;}
  /* create modal */
  .m-create-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;}
  .m-create-card{background:var(--surface,#fff);border-radius:16px;padding:20px;width:100%;max-width:460px;display:grid;gap:12px;color:var(--ink,#0f172a);}
  .m-create-title{font-size:18px;font-weight:800;}
  .m-create-actions{display:flex;gap:10px;margin-top:6px;}
  .m-create-actions button{flex:1;font:inherit;font-size:15px;font-weight:700;padding:13px;border-radius:11px;cursor:pointer;min-height:50px;border:none;}
  .m-create-cancel{background:var(--line-2,#eef2f6);color:var(--ink,#0f172a);}
  .m-create-go{background:#2563eb;color:#fff;}
  .m-create-err{color:#dc2626;font-size:13px;min-height:16px;}
  /* __MAINTENANCE_FROM_PHOTO_v1__ вкладки создания + блок фото */
  .m-create-card [hidden]{display:none!important;} /* hidden должен прятать, даже если у блока display:grid */
  .mc-tabs{display:flex;gap:8px;background:var(--line-2,#eef2f6);padding:4px;border-radius:11px;}
  .mc-tab{flex:1;font:inherit;font-size:14px;font-weight:700;padding:10px;border-radius:9px;border:none;background:transparent;color:var(--muted,#64748b);cursor:pointer;min-height:44px;}
  .mc-tab.is-on{background:var(--surface,#fff);color:var(--ink,#0f172a);box-shadow:0 1px 3px rgba(0,0,0,.12);}
  .mc-photo{display:grid;gap:10px;padding:12px;border:1.5px dashed var(--accent,#2563eb);border-radius:12px;background:rgba(37,99,235,.04);}
  .mc-photo-hint{font-size:13px;color:var(--muted,#64748b);line-height:1.4;}
  .mc-file{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px;font-weight:600;padding:11px 13px;border:1px solid var(--line,#e2e8f0);border-radius:10px;background:var(--surface,#fff);cursor:pointer;color:var(--ink,#0f172a);}
  .mc-file input{display:none;}
  .mc-recognize{font:inherit;font-size:15px;font-weight:700;padding:12px;border-radius:11px;border:none;background:#0b2a5b;color:#fff;cursor:pointer;min-height:48px;}
  .mc-recognize:disabled{opacity:.6;}
  .mc-recog-status{font-size:13px;color:var(--muted,#64748b);min-height:16px;line-height:1.4;}
  .mc-recog-status.ok{color:#16a34a;font-weight:600;}
  .mc-recog-status.err{color:#dc2626;font-weight:600;}
  /* __MAINTENANCE_CHECKLIST_v1__ режим правки пунктов */
  .m-edit-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0 12px;}
  .m-edit-toggle{font:inherit;font-size:14px;font-weight:700;padding:9px 16px;border-radius:10px;border:1.5px solid var(--accent,#2563eb);background:transparent;color:var(--accent,#2563eb);cursor:pointer;min-height:42px;}
  .m-edit-toggle.is-on{background:#16a34a;border-color:#16a34a;color:#fff;}
  .m-edit-hint{font-size:12.5px;color:var(--muted,#64748b);}
  .m-section-head--edit{flex-wrap:wrap;gap:6px;}
  .m-sec-edit{font:inherit;font-size:14px;font-weight:700;padding:8px 10px;border:1px solid var(--line,#e2e8f0);border-radius:8px;background:var(--surface,#fff);color:var(--ink,#0f172a);}
  .m-sec-en{flex:1 1 180px;text-transform:uppercase;}
  .m-sec-ru{flex:1 1 160px;font-weight:600;}
  .m-sec-del{font:inherit;font-size:15px;font-weight:700;width:38px;height:38px;border-radius:9px;border:1.5px solid #fecaca;background:#fff;color:#dc2626;cursor:pointer;flex:0 0 auto;}
  .m-item-edit{display:flex;flex-direction:column;gap:8px;}
  .m-item-edit-top{display:flex;align-items:center;justify-content:space-between;}
  .m-item-del{font:inherit;font-size:13px;font-weight:700;padding:6px 12px;border-radius:8px;border:1.5px solid #fecaca;background:#fff;color:#dc2626;cursor:pointer;}
  .m-it-edit{font:inherit;font-size:14px;padding:9px 11px;border:1px solid var(--line,#e2e8f0);border-radius:9px;background:var(--surface,#fff);color:var(--ink,#0f172a);width:100%;box-sizing:border-box;}
  .m-it-en{font-weight:600;}
  .m-it-type{display:flex;gap:8px;flex-wrap:wrap;}
  .m-it-type-btn{font:inherit;font-size:13px;font-weight:700;padding:8px 12px;border-radius:9px;border:1.5px solid var(--line,#e2e8f0);background:var(--surface,#fff);color:var(--muted,#64748b);cursor:pointer;min-height:40px;}
  .m-it-type-btn.is-on{background:#0b2a5b;border-color:#0b2a5b;color:#fff;}
  .m-item-add{font:inherit;font-size:14px;font-weight:700;padding:9px 14px;border-radius:10px;border:1.5px dashed var(--accent,#2563eb);background:transparent;color:var(--accent,#2563eb);cursor:pointer;margin-top:10px;min-height:42px;}
  .m-section-add{font:inherit;font-size:15px;font-weight:700;padding:12px 16px;border-radius:11px;border:1.5px dashed #16a34a;background:transparent;color:#16a34a;cursor:pointer;width:100%;margin-bottom:14px;min-height:48px;}
  .landing-create-btn{margin-top:14px;font:inherit;font-size:15px;font-weight:700;padding:12px 18px;border-radius:11px;border:none;background:#2563eb;color:#fff;cursor:pointer;}
  /* PDF host (off-screen, A4) */
  .m-pdf-host{position:fixed;left:-9999px;top:0;background:#fff;}
  .m-pdf-page{width:794px;min-height:1123px;background:#fff;color:#000;padding:40px 44px;box-sizing:border-box;font-family:'Mulish',Arial,sans-serif;position:relative;}
  .m-pdf-host .phead{display:none;align-items:center;gap:16px;border-bottom:2px solid #BD773E;padding-bottom:10px;margin-bottom:14px;}
  .m-pdf-host.is-official .phead{display:flex;}
  .phead .plogo{height:62px;width:auto;}
  .pcname{font-weight:800;font-size:15px;color:#BD773E;}
  .pcline{font-size:10.5px;color:#334155;line-height:1.45;}
  .ptitle{text-align:center;font-weight:800;font-size:18px;letter-spacing:.4px;text-decoration:underline;margin:6px 0 16px;}
  .pmeta{font-size:12.5px;line-height:1.9;margin-bottom:16px;}
  .ptable{width:100%;border-collapse:collapse;font-size:11px;}
  .ptable th,.ptable td{border:1px solid #475569;padding:5px 7px;vertical-align:top;text-align:left;}
  .ptable .phrow th{background:#e8edf3;font-weight:700;font-size:11px;}
  .ptable .pno{width:34px;text-align:center;}
  .ptable .pstatus{width:96px;}
  .ptable .pnotes{width:190px;}
  .ptable .psec td{background:#cfd8e3;font-weight:800;text-transform:uppercase;font-size:11px;letter-spacing:.3px;}
  .pen{font-weight:600;}
  .pru{color:#475569;font-style:italic;font-size:10px;margin-top:2px;}
  .pstrow{white-space:nowrap;line-height:1.7;}
  .pcbx{display:inline-block;width:13px;height:13px;border:1px solid #334155;text-align:center;line-height:12px;font-size:11px;margin-right:4px;vertical-align:middle;}
  .pdefects{margin-top:18px;font-size:12px;}
  .pdef-title{font-weight:800;text-align:center;font-size:14px;margin-bottom:10px;}
  .pdef-opt{line-height:1.9;}
  .pdef-notes{min-height:48px;border-bottom:1px solid #cbd5e1;margin-top:6px;white-space:pre-wrap;}
  .psign{margin-top:42px;display:flex;justify-content:space-between;align-items:flex-end;}
  .psign-name{font-size:12.5px;line-height:1.5;}
  .psign-area{position:relative;text-align:center;min-width:240px;}
  .psign-img{max-height:80px;position:absolute;bottom:18px;left:50%;transform:translateX(-50%);}
  .pstamp-ph{display:none;}
  .m-pdf-host.is-official .pstamp-ph{display:flex;flex-direction:column;align-items:center;justify-content:center;position:absolute;bottom:-8px;right:4px;width:104px;height:104px;border:2px dashed #BD773E;border-radius:50%;color:#BD773E;font-size:15px;font-weight:800;line-height:1.2;opacity:.75;transform:rotate(-10deg);text-align:center;}
  .pstamp-ph span{font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;}
  .psign-line{border-top:1px solid #000;padding-top:4px;font-size:11px;color:#475569;margin-top:60px;}
  .ppagenum{position:absolute;bottom:16px;right:24px;font-size:11px;color:#475569;}
  @media (max-width:560px){.m-item-controls{margin-left:0;}.m-item-ru{margin-left:0;}.m-item-note{margin-left:0;width:100%;}.m-st{flex:1;}}
  `;
  const tag = document.createElement('style');
  tag.id = 'm-styles';
  tag.textContent = css;
  document.head.appendChild(tag);
}
