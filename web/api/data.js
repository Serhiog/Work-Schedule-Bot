// Unified Airtable-backed data store for the schedule UI.
//
// GET /api/data?slug=<projectSlug>
//   Возвращает agregat: { assignees, updates, ticketMeetingNotes, taskMeetingNotes, taskResources, taskMaterials }
//
// POST /api/data
//   body: { action: '<name>', payload: {...} }
//   Поддерживаемые actions:
//     - 'assignees:set'           { ticketId, slug, names: string[] }
//     - 'update:add'              { ticketId, slug, text } → returns { update }
//     - 'update:delete'           { ticketId, updateId }
//     - 'ticket-note:add'         { ticketId, slug, meetingDate, text } → { note }
//     - 'task-note:add'           { taskId, slug, meetingDate, text } → { note }
//     - 'task-resources:upsert'   { taskId, slug, resources: [{type,count}] }
//     - 'task-materials:upsert'   { taskId, slug, materials: [{...}] }
//
// All writes return { ok: true, ...result }.

const AT_PAT = process.env.AIRTABLE_PAT;
const BASE = 'apph1Z1U3OU2gBvnL';
const TABLES = {
  assignees:           'TicketAssignees',
  updates:             'TicketUpdates',
  ticketMeetingNotes:  'TicketMeetingNotes',
  taskMeetingNotes:    'TaskMeetingNotes',
  taskResources:       'TaskResources',
  taskMaterials:       'TaskMaterials',
  taskDependencies:    'TaskDependencies'
};

function bad(res, code, msg, extra) {
  res.status(code).json({ error: msg, ...(extra || {}) });
}

async function airtable(method, path, body) {
  const url = `https://api.airtable.com/v0/${path}`;
  const r = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${AT_PAT}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`Airtable ${r.status}: ${JSON.stringify(data)}`);
    err.status = r.status;
    err.detail = data;
    throw err;
  }
  return data;
}

// fetch ALL records (paginated)
async function listAll(table, filter, sort) {
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams();
    params.set('pageSize', '100');
    if (filter) params.set('filterByFormula', filter);
    if (sort) sort.forEach((s, i) => {
      params.set(`sort[${i}][field]`, s.field);
      params.set(`sort[${i}][direction]`, s.direction || 'asc');
    });
    if (offset) params.set('offset', offset);
    const data = await airtable('GET', `${BASE}/${table}?${params.toString()}`);
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return records;
}

function escapeFormula(s) {
  return String(s || '').replace(/'/g, "\\'");
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- GET: aggregate read by slug ----------
async function readAggregate(slug) {
  const slugFilter = `{ProjectSlug}='${escapeFormula(slug)}'`;
  const [assigneesR, updatesR, ticketNotesR, taskNotesR, resourcesR, materialsR, depsR] = await Promise.all([
    listAll(TABLES.assignees, slugFilter),
    listAll(TABLES.updates, slugFilter, [{ field: 'At', direction: 'asc' }]),
    listAll(TABLES.ticketMeetingNotes, slugFilter, [{ field: 'At', direction: 'asc' }]),
    listAll(TABLES.taskMeetingNotes, slugFilter, [{ field: 'At', direction: 'asc' }]),
    listAll(TABLES.taskResources, slugFilter),
    listAll(TABLES.taskMaterials, slugFilter),
    listAll(TABLES.taskDependencies, slugFilter)
  ]);

  // Shape: { byTicket: { ticketId: [...] }, byTask: { taskId: [...] } }
  const assignees = {};
  for (const r of assigneesR) {
    const tid = r.fields.TicketId;
    if (!tid) continue;
    let names = [];
    try { names = JSON.parse(r.fields.Names || '[]'); } catch (_) {}
    assignees[tid] = Array.isArray(names) ? names : [];
  }

  const updates = {};
  for (const r of updatesR) {
    const tid = r.fields.TicketId;
    if (!tid) continue;
    if (!updates[tid]) updates[tid] = [];
    updates[tid].push({
      id: r.fields.UpdateId || r.id,
      text: r.fields.Text || '',
      at: r.fields.At || ''
    });
  }

  const ticketMeetingNotes = {};
  for (const r of ticketNotesR) {
    const tid = r.fields.TicketId;
    if (!tid) continue;
    if (!ticketMeetingNotes[tid]) ticketMeetingNotes[tid] = [];
    ticketMeetingNotes[tid].push({
      id: r.fields.NoteId || r.id,
      text: r.fields.Text || '',
      meetingDate: r.fields.MeetingDate || '',
      at: r.fields.At || ''
    });
  }

  const taskMeetingNotes = {};
  for (const r of taskNotesR) {
    const tid = r.fields.TaskId;
    if (!tid) continue;
    if (!taskMeetingNotes[tid]) taskMeetingNotes[tid] = [];
    taskMeetingNotes[tid].push({
      id: r.fields.NoteId || r.id,
      text: r.fields.Text || '',
      meetingDate: r.fields.MeetingDate || '',
      at: r.fields.At || ''
    });
  }

  const taskResources = {};
  for (const r of resourcesR) {
    const tid = r.fields.TaskId;
    if (!tid) continue;
    let res = [];
    try { res = JSON.parse(r.fields.Resources || '[]'); } catch (_) {}
    taskResources[tid] = Array.isArray(res) ? res : [];
  }

  const taskMaterials = {};
  for (const r of materialsR) {
    const tid = r.fields.TaskId;
    if (!tid) continue;
    let mats = [];
    try { mats = JSON.parse(r.fields.Materials || '[]'); } catch (_) {}
    taskMaterials[tid] = Array.isArray(mats) ? mats : [];
  }

  const taskDependencies = depsR.map(r => ({
    id: r.id,
    taskId: r.fields.TaskId || '',
    dependsOnTaskId: r.fields.DependsOnTaskId || '',
    source: r.fields.Source || 'manual',
    rationale: r.fields.Rationale || '',
    at: r.fields.At || ''
  })).filter(d => d.taskId && d.dependsOnTaskId);

  return { assignees, updates, ticketMeetingNotes, taskMeetingNotes, taskResources, taskMaterials, taskDependencies };
}

// ---------- POST: action handlers ----------
async function actionAssigneesSet({ ticketId, slug, names }) {
  if (!ticketId || !slug) throw new Error('ticketId and slug required');
  const list = Array.isArray(names) ? names.map(String) : [];
  // Find existing
  const filter = `AND({TicketId}='${escapeFormula(ticketId)}', {ProjectSlug}='${escapeFormula(slug)}')`;
  const existing = await listAll(TABLES.assignees, filter);
  const fields = {
    TicketId: ticketId,
    ProjectSlug: slug,
    Names: JSON.stringify(list),
    UpdatedAt: new Date().toISOString()
  };
  if (existing.length) {
    await airtable('PATCH', `${BASE}/${TABLES.assignees}/${existing[0].id}`, { fields });
    // Cleanup duplicates if any
    if (existing.length > 1) {
      const dupIds = existing.slice(1).map(r => r.id);
      const params = new URLSearchParams();
      dupIds.forEach(id => params.append('records[]', id));
      await airtable('DELETE', `${BASE}/${TABLES.assignees}?${params.toString()}`);
    }
  } else if (list.length) {
    await airtable('POST', `${BASE}/${TABLES.assignees}`, { fields });
  }
  return { names: list };
}

async function actionUpdateAdd({ ticketId, slug, text, author }) {
  if (!ticketId || !slug || !text) throw new Error('ticketId, slug, text required');
  const t = String(text).trim();
  if (!t) throw new Error('text empty');
  const updateId = genId('u');
  const at = new Date().toISOString();
  await airtable('POST', `${BASE}/${TABLES.updates}`, {
    fields: {
      UpdateId: updateId, TicketId: ticketId, ProjectSlug: slug,
      Text: t, At: at, Author: author || 'admin'
    }
  });
  return { update: { id: updateId, text: t, at } };
}

async function actionUpdateDelete({ ticketId, updateId }) {
  if (!updateId) throw new Error('updateId required');
  const filter = `{UpdateId}='${escapeFormula(updateId)}'`;
  const existing = await listAll(TABLES.updates, filter);
  if (existing.length) {
    const params = new URLSearchParams();
    existing.forEach(r => params.append('records[]', r.id));
    await airtable('DELETE', `${BASE}/${TABLES.updates}?${params.toString()}`);
  }
  return { deleted: existing.length };
}

async function actionTicketNoteAdd({ ticketId, slug, meetingDate, text }) {
  if (!ticketId || !slug || !text) throw new Error('ticketId, slug, text required');
  const noteId = genId('tn');
  const at = new Date().toISOString();
  await airtable('POST', `${BASE}/${TABLES.ticketMeetingNotes}`, {
    fields: {
      NoteId: noteId, TicketId: ticketId, ProjectSlug: slug,
      Text: String(text),
      MeetingDate: meetingDate || at.slice(0, 10),
      At: at
    }
  });
  return { note: { id: noteId, text, meetingDate, at } };
}

async function actionTaskNoteAdd({ taskId, slug, meetingDate, text }) {
  if (!taskId || !slug || !text) throw new Error('taskId, slug, text required');
  const noteId = genId('mn');
  const at = new Date().toISOString();
  await airtable('POST', `${BASE}/${TABLES.taskMeetingNotes}`, {
    fields: {
      NoteId: noteId, TaskId: String(taskId), ProjectSlug: slug,
      Text: String(text),
      MeetingDate: meetingDate || at.slice(0, 10),
      At: at
    }
  });
  return { note: { id: noteId, text, meetingDate, at } };
}

async function upsertByKey(table, key, taskId, slug, payloadField, payloadValue) {
  const filter = `{Key}='${escapeFormula(key)}'`;
  const existing = await listAll(table, filter);
  const fields = {
    Key: key,
    TaskId: String(taskId),
    ProjectSlug: slug,
    [payloadField]: JSON.stringify(payloadValue || []),
    UpdatedAt: new Date().toISOString()
  };
  if (existing.length) {
    await airtable('PATCH', `${BASE}/${table}/${existing[0].id}`, { fields });
    if (existing.length > 1) {
      const dupIds = existing.slice(1).map(r => r.id);
      const params = new URLSearchParams();
      dupIds.forEach(id => params.append('records[]', id));
      await airtable('DELETE', `${BASE}/${table}?${params.toString()}`);
    }
  } else {
    await airtable('POST', `${BASE}/${table}`, { fields });
  }
}

async function actionTaskResourcesUpsert({ taskId, slug, resources }) {
  if (!taskId || !slug) throw new Error('taskId, slug required');
  await upsertByKey(TABLES.taskResources, `${slug}:${taskId}`, taskId, slug, 'Resources', resources || []);
  return { resources };
}

async function actionTaskMaterialsUpsert({ taskId, slug, materials }) {
  if (!taskId || !slug) throw new Error('taskId, slug required');
  await upsertByKey(TABLES.taskMaterials, `${slug}:${taskId}`, taskId, slug, 'Materials', materials || []);
  return { materials };
}

/* ════════════════════════════════════════════════════════════════════ */
/*  Schedule mutations: commit обратно в schedule.json на GitHub        */
/* ════════════════════════════════════════════════════════════════════ */

const GH_OWNER = 'Serhiog';
const GH_REPO = 'Work-Schedule-Bot';
const GH_BRANCH = 'main';
const GH_TOKEN = process.env.GITHUB_TOKEN;

async function ghReadSchedule(slug) {
  if (!GH_TOKEN) {
    const err = new Error('GITHUB_TOKEN env missing — добавь PAT с repo:contents в Vercel env');
    err.status = 503;
    throw err;
  }
  const path = `web/schedules/${slug}.json`;
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (r.status === 404) {
    const err = new Error(`schedule.json not found for slug "${slug}"`);
    err.status = 404;
    throw err;
  }
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`GitHub read failed ${r.status}: ${txt.slice(0, 300)}`);
  }
  const j = await r.json();
  const content = Buffer.from(j.content || '', 'base64').toString('utf8');
  return { schedule: JSON.parse(content), sha: j.sha, path };
}

async function ghCommitSchedule(slug, schedule, sha, message) {
  const path = `web/schedules/${slug}.json`;
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  const content = Buffer.from(JSON.stringify(schedule, null, 2), 'utf8').toString('base64');
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({
      message: message || `chore: schedule ${slug} update`,
      content,
      sha,
      branch: GH_BRANCH
    })
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    const err = new Error(`GitHub commit failed ${r.status}: ${txt.slice(0, 400)}`);
    err.status = r.status === 409 ? 409 : 500;
    throw err;
  }
  return r.json();
}

// Apply mutator to schedule, commit, return updated schedule.
// Mutator: (schedule) => string (commit message). Mutates schedule in place.
// Авто-ретрай при 409 (SHA conflict): кто-то закоммитил в промежутке между read и write.
async function mutateSchedule(slug, mutator, attempt = 0) {
  if (!slug) throw new Error('slug required');
  const { schedule, sha } = await ghReadSchedule(slug);
  const message = await mutator(schedule);
  recomputeProjectBounds(schedule);
  try {
    await ghCommitSchedule(slug, schedule, sha, message);
  } catch (e) {
    // 409 — конфликт SHA, перечитать и попробовать снова (до 3 попыток)
    if (e.status === 409 && attempt < 3) {
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
      return mutateSchedule(slug, mutator, attempt + 1);
    }
    throw e;
  }
  return schedule;
}

function recomputeProjectBounds(schedule) {
  const tasks = schedule.tasks || [];
  let minS = null, maxE = null;
  for (const t of tasks) {
    const ps = t.planStart || t.start;
    const pe = t.planEnd || t.end;
    if (ps && (!minS || ps < minS)) minS = ps;
    if (pe && (!maxE || pe > maxE)) maxE = pe;
  }
  if (minS) schedule.project.startDate = minS;
  if (maxE) schedule.project.endDate = maxE;
}

function isoOnly(d) {
  if (!d) return d;
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function nextTaskId(schedule) {
  const ids = (schedule.tasks || []).map(t => Number(t.id)).filter(Number.isFinite);
  return String(ids.length ? Math.max(...ids) + 1 : 1);
}

function nextSectionId(schedule, baseName) {
  const slug = (baseName || 'sec')
    .toLowerCase()
    .replace(/[ё]/g, 'e').replace(/[а]/g, 'a').replace(/[б]/g, 'b').replace(/[в]/g, 'v')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '') || 'sec';
  const existing = new Set((schedule.sections || []).map(s => s.id));
  if (!existing.has(slug)) return slug;
  let i = 2;
  while (existing.has(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

async function actionTaskUpdate({ slug, taskId, patch }) {
  if (!slug || !taskId || !patch) throw new Error('slug, taskId, patch required');
  const allowed = ['name', 'planStart', 'planEnd', 'actualStart', 'actualEnd', 'section', 'stage', 'progress'];
  const updated = await mutateSchedule(slug, (sched) => {
    const t = (sched.tasks || []).find(x => String(x.id) === String(taskId));
    if (!t) throw Object.assign(new Error('task not found'), { status: 404 });
    const changes = [];
    for (const k of allowed) {
      if (patch[k] === undefined) continue;
      let v = patch[k];
      if (k.endsWith('Start') || k.endsWith('End')) {
        if (v === null) { delete t[k]; changes.push(`${k}=null`); continue; }
        v = isoOnly(v);
        if (!v) throw new Error(`${k} must be YYYY-MM-DD`);
      }
      t[k] = v;
      changes.push(`${k}=${v}`);
    }
    // Sanity: planEnd >= planStart, actualEnd >= actualStart
    if (t.planStart && t.planEnd && t.planEnd < t.planStart) t.planEnd = t.planStart;
    if (t.actualStart && t.actualEnd && t.actualEnd < t.actualStart) t.actualEnd = t.actualStart;
    return `task ${taskId}: ${changes.join(', ')}`;
  });
  const task = (updated.tasks || []).find(x => String(x.id) === String(taskId));
  return { task, schedule: updated };
}

async function actionTaskCreate({ slug, sectionId, name, planStart, planEnd, actualStart, actualEnd, stage }) {
  if (!slug || !name) throw new Error('slug, name required');
  const updated = await mutateSchedule(slug, (sched) => {
    if (sectionId && !(sched.sections || []).some(s => s.id === sectionId)) {
      throw new Error(`section "${sectionId}" not found`);
    }
    const id = nextTaskId(sched);
    const today = new Date().toISOString().slice(0, 10);
    const ps = isoOnly(planStart) || today;
    const pe = isoOnly(planEnd) || ps;
    const t = {
      id,
      name: String(name).slice(0, 200),
      section: sectionId || (sched.sections?.[0]?.id || ''),
      stage: stage || (sched.stages?.[0]?.id || 'rough'),
      planStart: ps,
      planEnd: pe
    };
    const aS = isoOnly(actualStart);
    const aE = isoOnly(actualEnd);
    if (aS) t.actualStart = aS;
    if (aE) t.actualEnd = aE;
    sched.tasks = sched.tasks || [];
    sched.tasks.push(t);
    return `task ${id} created: "${t.name}"${aS ? ` actualStart=${aS}` : ''}${aE ? ` actualEnd=${aE}` : ''}`;
  });
  return { task: updated.tasks[updated.tasks.length - 1], schedule: updated };
}

async function actionTaskDelete({ slug, taskId }) {
  if (!slug || !taskId) throw new Error('slug, taskId required');
  const updated = await mutateSchedule(slug, (sched) => {
    const idx = (sched.tasks || []).findIndex(x => String(x.id) === String(taskId));
    if (idx < 0) throw Object.assign(new Error('task not found'), { status: 404 });
    const removed = sched.tasks[idx];
    sched.tasks.splice(idx, 1);
    return `task ${taskId} deleted: "${removed.name}"`;
  });
  return { schedule: updated };
}

async function actionTaskBulkShift({ slug, taskIds, deltaDays, kind }) {
  if (!slug || !Array.isArray(taskIds) || !taskIds.length) throw new Error('slug, taskIds required');
  const delta = Math.round(Number(deltaDays) || 0);
  if (!delta) return { changed: 0 };
  const k = kind === 'fact' ? 'fact' : 'plan';
  const updated = await mutateSchedule(slug, (sched) => {
    let n = 0;
    for (const id of taskIds) {
      const t = (sched.tasks || []).find(x => String(x.id) === String(id));
      if (!t) continue;
      if (k === 'plan') {
        if (t.planStart) t.planStart = shiftIso(t.planStart, delta);
        if (t.planEnd) t.planEnd = shiftIso(t.planEnd, delta);
      } else {
        if (t.actualStart) t.actualStart = shiftIso(t.actualStart, delta);
        if (t.actualEnd) t.actualEnd = shiftIso(t.actualEnd, delta);
      }
      n++;
    }
    return `bulk-shift ${kind} ${delta>0?'+':''}${delta}d for ${n} tasks`;
  });
  return { schedule: updated };
}

function shiftIso(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function actionSectionCreate({ slug, name, color, sub }) {
  if (!slug || !name) throw new Error('slug, name required');
  const updated = await mutateSchedule(slug, (sched) => {
    const id = nextSectionId(sched, name);
    const sec = {
      id,
      name: String(name).slice(0, 80),
      color: color || '#94a3b8'
    };
    if (sub) sec.sub = true;
    sched.sections = sched.sections || [];
    sched.sections.push(sec);
    return `section ${id} created: "${sec.name}"`;
  });
  return { section: updated.sections[updated.sections.length - 1], schedule: updated };
}

async function actionSectionUpdate({ slug, sectionId, patch }) {
  if (!slug || !sectionId || !patch) throw new Error('slug, sectionId, patch required');
  const allowed = ['name', 'color', 'sub'];
  const updated = await mutateSchedule(slug, (sched) => {
    const sec = (sched.sections || []).find(s => s.id === sectionId);
    if (!sec) throw Object.assign(new Error('section not found'), { status: 404 });
    const changes = [];
    for (const k of allowed) {
      if (patch[k] === undefined) continue;
      sec[k] = patch[k];
      changes.push(`${k}=${patch[k]}`);
    }
    return `section ${sectionId}: ${changes.join(', ')}`;
  });
  return { section: (updated.sections || []).find(s => s.id === sectionId), schedule: updated };
}

async function actionSectionDelete({ slug, sectionId }) {
  if (!slug || !sectionId) throw new Error('slug, sectionId required');
  const updated = await mutateSchedule(slug, (sched) => {
    const idx = (sched.sections || []).findIndex(s => s.id === sectionId);
    if (idx < 0) throw Object.assign(new Error('section not found'), { status: 404 });
    const orphans = (sched.tasks || []).filter(t => t.section === sectionId);
    if (orphans.length) {
      throw new Error(`Раздел не пустой: ${orphans.length} работ. Сначала удали или перенеси работы.`);
    }
    const removed = sched.sections[idx];
    sched.sections.splice(idx, 1);
    return `section ${sectionId} deleted: "${removed.name}"`;
  });
  return { schedule: updated };
}

const ACTIONS = {
  'assignees:set':         actionAssigneesSet,
  'update:add':            actionUpdateAdd,
  'update:delete':         actionUpdateDelete,
  'ticket-note:add':       actionTicketNoteAdd,
  'task-note:add':         actionTaskNoteAdd,
  'task-resources:upsert': actionTaskResourcesUpsert,
  'task-materials:upsert': actionTaskMaterialsUpsert,
  'task:update':           actionTaskUpdate,
  'task:create':           actionTaskCreate,
  'task:delete':           actionTaskDelete,
  'task:bulk-shift':       actionTaskBulkShift,
  'section:create':        actionSectionCreate,
  'section:update':        actionSectionUpdate,
  'section:delete':        actionSectionDelete
};

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const slug = (req.query?.slug || '').toString().trim();
      if (!slug) return bad(res, 400, 'slug required');
      // GET /api/data?slug=X&schedule=1 — вернуть свежий schedule.json через GitHub Contents API
      // (минуя 5-минутный кеш raw.githubusercontent.com). Не требует AIRTABLE_PAT.
      if (req.query?.schedule === '1' || req.query?.schedule === 'true') {
        const { schedule } = await ghReadSchedule(slug);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('CDN-Cache-Control', 'no-store');
        res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
        return res.status(200).json({ ok: true, slug, schedule });
      }
      if (!AT_PAT) return bad(res, 500, 'AIRTABLE_PAT env missing');
      const data = await readAggregate(slug);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, slug, data });
    }
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) { return bad(res, 400, 'Invalid JSON'); }
      }
      const { action, payload } = body || {};
      if (!action || !ACTIONS[action]) return bad(res, 400, `Unknown action: ${action}`);
      // task:* / section:* идут в GitHub, остальное — в Airtable. Проверяем только для Airtable-actions.
      const isScheduleMutation = action.startsWith('task:') || action.startsWith('section:');
      if (!isScheduleMutation && !AT_PAT) return bad(res, 500, 'AIRTABLE_PAT env missing');
      const result = await ACTIONS[action](payload || {});
      return res.status(200).json({ ok: true, action, result });
    }
    return bad(res, 405, 'GET or POST');
  } catch (err) {
    console.error('data handler error', err);
    return bad(res, err.status || 500, err.message || 'Server error', err.detail ? { detail: err.detail } : undefined);
  }
};
