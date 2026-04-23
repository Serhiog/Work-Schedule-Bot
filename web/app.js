const $ = (sel) => document.querySelector(sel);
const DAY_MS = 86400000;

const MOBILE_MQ = window.matchMedia('(max-width: 720px)');
const isMobile = () => MOBILE_MQ.matches;
const ZOOM_LEVELS = [14, 18, 22, 28, 36];
const ZOOM_LABELS = ['−35%', '−18%', '100%', '+27%', '+64%'];
const currentCellW = () => isMobile() ? 16 : ZOOM_LEVELS[state.zoomIdx];
const currentLabelW = () => (isMobile() ? 0 : 260);

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
  // zoom (index into ZOOM_LEVELS, default 2 = 22px = 100%)
  zoomIdx: 2,
  // filter state
  filterSection: null, // null = all, or section id
  filterSubOnly: false,
  // layout cache
  layout: { cellW: 22, labelColW: 260, totalDays: 0, rows: new Map() },
};

async function init() {
  const res = await fetch('/schedule.json');
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
      return `<div class="stage-bar${isLight(st.color) ? ' light' : ''}" style="--bar-color:${st.color}" title="${escapeHtml(st.name)}: ${done} из ${total} задач">
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

function attachToolbarHandlers() {
  const sel = $('#section-filter');
  if (sel) {
    sel.addEventListener('change', () => {
      state.filterSection = sel.value || null;
      updateFilterUrl();
      renderGantt();
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
      renderTasksSheet();
    });
  }
  const printBtn = $('#btn-print');
  if (printBtn) printBtn.addEventListener('click', () => window.print());
}

/* ─── Gantt ─── */
function renderGantt() {
  const gantt = $('#gantt');
  const p = state.schedule.project;
  const start = parseISO(p.startDate);
  const end = parseISO(p.endDate);
  const todayD = effectiveToday();
  const todayStripeISO = toISO(todayD);
  const totalDays = dayDiff(start, end) + 1;
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

  const zoomLabel = ZOOM_LABELS[state.zoomIdx];
  const header = `<div class="corner">
      <div class="corner-title">Виды работ · <strong style="color:var(--navy);margin-left:4px;">${state.schedule.tasks.length}</strong></div>
      <div class="zoom-btns">
        <button class="zoom-btn" id="zoom-out" title="Уменьшить масштаб" ${state.zoomIdx === 0 ? 'disabled' : ''}>−</button>
        <span class="zoom-label">${zoomLabel}</span>
        <button class="zoom-btn" id="zoom-in" title="Увеличить масштаб" ${state.zoomIdx === ZOOM_LEVELS.length - 1 ? 'disabled' : ''}>+</button>
      </div>
    </div>
    <div class="dates-header">
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
    body += `<div class="section-label${isSub ? ' is-sub' : ''}">
      <span class="section-dot" style="background:${sec.color}"></span>
      ${escapeHtml(sec.name)}
      <span class="section-count">${secTasks.length}</span>
      ${isSub ? '<span class="sub-badge-sec">СУБ</span>' : ''}
    </div>`;
    body += `<div class="section-grid"></div>`;

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
        factHtml = `<div class="bar-fact${light ? ' light' : ''}${running ? ' running' : ''}" style="left:${aLeft}px; width:${aWidth}px; --b-top:${bTop}; --b-bot:${bBot};" data-tid="${t.id}" title="Факт: ${escapeHtml(fmtDate(aStart))} — ${t.actualEnd ? escapeHtml(fmtDate(t.actualEnd)) : 'в работе'}">
          ${escapeHtml(t.name)}
        </div>`;
      }

      const subBadge = sec.sub ? '<span class="sub-badge">СУБ</span>' : '';
      const prog = taskProgress(t);
      const progPct = Math.round(prog * 100);
      let progBadge = '';
      if (prog >= 1) progBadge = '<span class="pbadge pbadge-done" title="Завершено">100%</span>';
      else if (prog > 0) progBadge = `<span class="pbadge" title="Выполнено ${progPct}%">${progPct}%</span>`;

      body += `<div class="task-label" data-tid="${t.id}" tabindex="0">
        <span class="tbullet" style="background:${catColor}"></span>
        <span class="tid">${escapeHtml(t.id)}</span>
        <span class="tname" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
        ${progBadge}
        ${subBadge}
        <button class="task-open-btn" data-tid="${t.id}" tabindex="-1" title="Подробнее" aria-label="Открыть детали: ${escapeHtml(t.name)}">→</button>
      </div>`;
      const progFill = prog > 0 ? `<div class="bar-plan-progress" style="width:${progPct}%; background:${bTop}" aria-hidden="true"></div>` : '';
      body += `<div class="task-grid" data-tid="${t.id}" style="background-image: ${stripeBg ? stripeBg + ', ' : ''}linear-gradient(to right, var(--line-2) 1px, transparent 1px); background-size: auto, ${cellW}px 100%;">
        <div class="bar-plan${light ? ' light' : ''}" style="left:${pLeft}px; width:${pWidth}px; --b-top:${bTop}; --b-bot:${bBot};" data-tid="${t.id}" title="План: ${escapeHtml(fmtDate(pStart))} — ${escapeHtml(fmtDate(pEnd))} · ${progPct}%">
          ${progFill}
          <span class="bar-plan-text">${escapeHtml(t.name)}</span>
        </div>
        ${factHtml}
      </div>`;
    }
  }

  // preserve overlays container (it's already in the DOM)
  const overlays = $('#gantt-overlays');
  gantt.innerHTML = header + body;
  if (overlays) gantt.appendChild(overlays);

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

  // ── zoom buttons
  const zoomOut = $('#zoom-out'), zoomIn = $('#zoom-in');
  if (zoomOut) zoomOut.addEventListener('click', (e) => { e.stopPropagation(); if (state.zoomIdx > 0) { state.zoomIdx--; renderGantt(); } });
  if (zoomIn) zoomIn.addEventListener('click', (e) => { e.stopPropagation(); if (state.zoomIdx < ZOOM_LEVELS.length - 1) { state.zoomIdx++; renderGantt(); } });

  // ── scroll to today (or start)
  requestAnimationFrame(() => {
    const todayDate = parseISO(today);
    if (todayDate >= start && todayDate <= end) {
      const off = dayDiff(start, todayDate) * cellW;
      gantt.scrollLeft = Math.max(0, off - 120);
    }
  });
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
  const dur = dayDiff(parseISO(pStart), parseISO(pEnd)) + 1;

  let status = 'not-started', statusLabel = 'Не начата';
  if (t.actualEnd) { status = 'done'; statusLabel = 'Завершена'; }
  else if (t.actualStart) { status = 'running'; statusLabel = 'В работе'; }
  const asOf = effectiveToday();
  const isOverdue = !t.actualEnd && asOf > parseISO(pEnd);
  if (isOverdue && status !== 'done') { status = 'overdue'; statusLabel = 'Просрочена'; }

  $('#drawer-tag').innerHTML = `<span class="drawer-tag-dot" style="background:${sec.color}"></span>${escapeHtml(sec.name)} · ${escapeHtml(st.name)}`;
  $('#drawer-title').textContent = t.name;

  const factRange = t.actualStart
    ? `${fmtDate(t.actualStart)} → ${t.actualEnd ? fmtDate(t.actualEnd) : 'в работе'}`
    : '—';

  const contractorLabel = sec.sub ? 'Субподрядчик' : 'CYFR FITOUT';
  $('#drawer-body').innerHTML = `
    <div class="drawer-status drawer-status--${status}">${escapeHtml(statusLabel)}</div>
    <div class="drawer-grid">
      ${kv('Исполнитель', escapeHtml(contractorLabel))}
      ${kv('Этап', escapeHtml(st.name))}
      ${kv('План', fmtDate(pStart) + ' → ' + fmtDate(pEnd), { span: true })}
      ${kv('Факт', escapeHtml(factRange), { span: true })}
      ${kv('Длительность', dur + ' ' + daysWord(dur))}
      ${kv('Количество', t.qty != null ? `${t.qty} ${t.unit || ''}`.trim() : '—')}
      ${kv('Стоимость (с НДС)', t.costIncVat > 0 ? fmtAED(t.costIncVat) : '—', { span: true, big: true })}
    </div>`;

  $('#drawer').setAttribute('aria-hidden', 'false');
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
      ${kv('По задачам', pctTasks + '%')}
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
          <span class="drawer-row-val">${ts.length} ${plural(ts.length, ['задача', 'задачи', 'задач'])}</span>
        </div>
        <div class="drawer-row-meta">${done > 0 ? `завершено ${done}` : 'не начато'}</div>
      </div>`;
    }).join('');
    const sectionCount = new Set(tasks.map((t) => t.section)).size;
    html = `<div class="drawer-grid">
      ${kv('Всего задач', String(tasks.length))}
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
      if (t.actualEnd) { status = 'done'; statusLabel = 'Готово'; }
      else if (t.actualStart) { status = 'running'; statusLabel = 'В работе'; }
      else if (asOf > parseISO(t.planEnd || t.end)) { status = 'running'; statusLabel = 'Просрочено'; }
      const statusHtml = statusLabel ? `<span class="tstatus ${status}">${escapeHtml(statusLabel)}</span>` : '';
      html += `<button type="button" class="tasks-sheet-item${t.actualEnd ? ' done' : ''}" data-tid="${escapeHtml(t.id)}">
        <span class="tdot" style="background:${sec.color}"></span>
        <span class="tid">${escapeHtml(t.id)}</span>
        <span class="tname">${escapeHtml(t.name)}</span>
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
