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
  taskMaterials:       'TaskMaterials'
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
  const [assigneesR, updatesR, ticketNotesR, taskNotesR, resourcesR, materialsR] = await Promise.all([
    listAll(TABLES.assignees, slugFilter),
    listAll(TABLES.updates, slugFilter, [{ field: 'At', direction: 'asc' }]),
    listAll(TABLES.ticketMeetingNotes, slugFilter, [{ field: 'At', direction: 'asc' }]),
    listAll(TABLES.taskMeetingNotes, slugFilter, [{ field: 'At', direction: 'asc' }]),
    listAll(TABLES.taskResources, slugFilter),
    listAll(TABLES.taskMaterials, slugFilter)
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

  return { assignees, updates, ticketMeetingNotes, taskMeetingNotes, taskResources, taskMaterials };
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

const ACTIONS = {
  'assignees:set':         actionAssigneesSet,
  'update:add':            actionUpdateAdd,
  'update:delete':         actionUpdateDelete,
  'ticket-note:add':       actionTicketNoteAdd,
  'task-note:add':         actionTaskNoteAdd,
  'task-resources:upsert': actionTaskResourcesUpsert,
  'task-materials:upsert': actionTaskMaterialsUpsert
};

module.exports = async function handler(req, res) {
  if (!AT_PAT) return bad(res, 500, 'AIRTABLE_PAT env missing');

  try {
    if (req.method === 'GET') {
      const slug = (req.query?.slug || '').toString().trim();
      if (!slug) return bad(res, 400, 'slug required');
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
      const result = await ACTIONS[action](payload || {});
      return res.status(200).json({ ok: true, action, result });
    }
    return bad(res, 405, 'GET or POST');
  } catch (err) {
    console.error('data handler error', err);
    return bad(res, err.status || 500, err.message || 'Server error', err.detail ? { detail: err.detail } : undefined);
  }
};
