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
  attachGanttGestures();
  attachPrintHandlers();

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

  // Last updated label
  const upd = $('#hero-updated');
  if (upd && p.lastUpdated) {
    const d = new Date(p.lastUpdated);
    const timeStr = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const rel = fmtRelative(d);
    const by = p.lastUpdatedBy ? ` · ${escapeHtml(p.lastUpdatedBy)}` : '';
    upd.innerHTML = `<span class="hero-updated-dot" aria-hidden="true"></span><span class="hero-updated-text">Обновлено ${escapeHtml(rel)} · ${escapeHtml(timeStr)}${by}</span>`;
    upd.title = d.toLocaleString('ru-RU');
  } else if (upd) {
    upd.innerHTML = '';
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

  // ── column stripes (weekend/holiday/today)
  const stripes = [];
  const today = todayStripeISO;
  days.forEach((d, i) => {
    const iso = toISO(d);
    let color = null;
    if (iso === today) color = 'rgba(253, 230, 138, 0.45)';
    else if (state.holidayMap.has(iso)) color = 'rgba(251, 230, 217, 0.55)';
    else if (isWeekend(d)) color = 'rgba(240, 238, 233, 0.55)';
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
  // ── milestones (rendered in dates-header + vertical guide on body)
  const milestones = state.schedule.milestones || [];
  const milestoneMarks = milestones.map((m) => {
    const mDate = parseISO(m.date);
    if (mDate < start || mDate > end) return { inView: false };
    const offsetDays = dayDiff(start, mDate);
    return { ...m, inView: true, left: offsetDays * cellW + cellW / 2 };
  }).filter((m) => m.inView);

  const milestonesHtml = milestoneMarks
    .map(
      (m) => `<div class="milestone-mark" style="left:${m.left}px" data-mid="${escapeHtml(m.id || '')}" title="${escapeHtml(m.name)} · ${escapeHtml(fmtDate(m.date))}">
        <span class="milestone-diamond"></span>
        <span class="milestone-label">${escapeHtml(m.name)}</span>
      </div>`
    )
    .join('');

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
      <div class="milestones-row">${milestonesHtml}</div>
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
      body += `<div class="task-label${hidden}" data-tid="${t.id}" data-section-id="${secId}" tabindex="0">
        <span class="tbullet" style="background:${catColor}"></span>
        <span class="tid">${escapeHtml(t.id)}</span>
        <span class="tname" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
        ${progBadge}
        ${subBadge}
        <button class="task-open-btn" data-tid="${t.id}" tabindex="-1" title="Подробнее" aria-label="Открыть детали: ${escapeHtml(t.name)}">→</button>
      </div>`;
      const progFill = prog > 0 ? `<div class="bar-plan-progress" style="width:${progPct}%; background:${bTop}" aria-hidden="true"></div>` : '';
      const ticketBadge = buildTaskTicketBadge(t.id, pLeft, pWidth);
      body += `<div class="task-grid${hidden}" data-tid="${t.id}" data-section-id="${secId}" style="width:${gridW}px; background-image: ${stripeBg ? stripeBg + ', ' : ''}linear-gradient(to right, var(--line-2) 1px, transparent 1px); background-size: auto, ${cellW}px 100%;">
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
      ${kv('Количество', t.qty != null ? `${t.qty} ${t.unit || ''}`.trim() : '—')}
      ${kv('Стоимость (с НДС)', t.costIncVat > 0 ? fmtAED(t.costIncVat) : '—', { span: true, big: true })}
    </div>${buildDrawerDelaysHtml(t)}${buildDrawerTicketsHtml(t.id)}`;

  attachTicketHandlers();
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

const TICKET_SORT_LABEL = { deadline: 'По дедлайну', status: 'По статусу', created: 'По дате' };
const STATUS_URGENCY = { in_progress: 0, open: 1, in_review: 2, deferred: 3, resolved: 4, rejected: 5 };

function buildTicketCards(taskId) {
  const vs = ticketViewState[String(taskId)] || { filter: 'all', sort: 'deadline' };
  const today = new Date().toISOString().slice(0, 10);
  let list = state.tickets.filter((tk) => tk.task_id === String(taskId));
  if (vs.filter !== 'all') list = list.filter((tk) => tk.status === vs.filter);

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
    return `<div class="ticket-card ticket-card--${escapeHtml(tk.status)}${isSelected ? ' ticket-card--selected' : ''}" data-ticket-id="${escapeHtml(tk.id)}" data-task-id="${tid}">
      ${vs.selectionMode ? `<span class="ticket-select-mark${isSelected ? ' ticket-select-mark--on' : ''}" aria-hidden="true">${isSelected ? '✓' : ''}</span>` : ''}
      <div class="ticket-card-head">
        <span class="ticket-status-dot"></span>
        <span class="ticket-card-title">${escapeHtml((tk.title || '').replace(/\[task:\w+\]/gi, '').trim() || tk.title || '')}</span>
        <span class="ticket-card-meta">${tk.created_at ? escapeHtml(fmtDate(tk.created_at)) : ''}</span>
      </div>
      ${descClean ? `<div class="ticket-card-desc">${escapeHtml(descClean)}</div>` : ''}
      ${dueLabel}
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

function buildDrawerTicketsHtml(taskId) {
  const tid = escapeHtml(String(taskId));
  const taskTickets = state.tickets.filter((tk) => tk.task_id === String(taskId));
  const vs = ticketViewState[String(taskId)] || { filter: 'all', sort: 'deadline' };

  // Count per status for chips
  const countByStatus = {};
  for (const tk of taskTickets) countByStatus[tk.status] = (countByStatus[tk.status] || 0) + 1;
  const usedStatuses = TICKET_STATUSES.filter((s) => countByStatus[s]);

  const chips = taskTickets.length
    ? `<div class="ticket-filter-chips">
        <button class="ticket-chip${vs.filter === 'all' ? ' ticket-chip--active' : ''}" data-filter="all" data-task-id="${tid}">
          Все${taskTickets.length ? ` · ${taskTickets.length}` : ''}
        </button>
        ${usedStatuses.map((s) => `<button class="ticket-chip ticket-chip--${escapeHtml(s)}${vs.filter === s ? ' ticket-chip--active' : ''}" data-filter="${escapeHtml(s)}" data-task-id="${tid}">
          ${escapeHtml(TICKET_STATUS_LABEL[s])} · ${countByStatus[s]}
        </button>`).join('')}
      </div>
      <select class="ticket-sort-select" data-task-id="${tid}" aria-label="Сортировка">
        ${Object.keys(TICKET_SORT_LABEL).map((k) =>
          `<option value="${k}"${vs.sort === k ? ' selected' : ''}>${TICKET_SORT_LABEL[k]}</option>`
        ).join('')}
      </select>`
    : '';

  const todayIso = new Date().toISOString().slice(0, 10);
  const createForm = `
    <div class="ticket-create-form" id="ticket-create-form-${tid}" style="display:none">
      <input class="ticket-form-input" type="text" placeholder="Краткое описание проблемы *" id="ticket-subject-${tid}" maxlength="200" />
      <textarea class="ticket-form-textarea" placeholder="Подробности (необязательно)" id="ticket-desc-${tid}" rows="2"></textarea>
      <label class="ticket-form-label">Срок устранения *
        <input class="ticket-form-input" type="date" id="ticket-due-${tid}" min="${todayIso}" required />
      </label>
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
  return `<div class="tickets-section${selecting ? ' tickets-section--selecting' : ''}" data-task-id="${tid}">
    <div class="drawer-section-title">Полевые тикеты${taskTickets.length ? ` (${taskTickets.length})` : ''}
      ${canSelect ? `<button class="ticket-select-toggle" data-task-id="${tid}" title="${selecting ? 'Выйти из режима выбора' : 'Выбрать тикеты'}">${selecting ? '✕' : '☑'}</button>` : ''}
      <button class="ticket-add-btn" data-task-id="${tid}" title="Создать тикет">➕</button>
    </div>
    ${createForm}
    ${chips}
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
        <div class="edit-row">
          <label class="edit-label">Срок
            <input class="edit-input" id="edit-due" type="date" value="${tk.due_date || ''}" />
          </label>
          <label class="edit-label">Статус
            <select class="edit-input" id="edit-status">${statusOpts}</select>
          </label>
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
      if (form) form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    });
  });
  // Submit
  document.querySelectorAll('.ticket-form-submit').forEach((btn) => {
    btn.addEventListener('click', () => createTicket(btn.dataset.taskId));
  });
  // Cancel
  document.querySelectorAll('.ticket-form-cancel').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = document.getElementById(`ticket-create-form-${btn.dataset.taskId}`);
      if (form) form.style.display = 'none';
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

init().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<div style="padding:40px;color:#b00020;font-family:Inter,sans-serif;">
    <h2>Ошибка загрузки графика</h2><pre>${escapeHtml(err.stack || err.message)}</pre></div>`;
});
