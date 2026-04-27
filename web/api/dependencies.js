// CRUD для TaskDependencies (Airtable tblQWE4SobOy5m01q).
//
// GET  /api/dependencies?slug=<slug>
//   → { deps: [{ id, taskId, dependsOnTaskId, source, rationale, at }] }
//
// POST /api/dependencies
//   body: { action: 'add' | 'remove' | 'replaceAll', payload }
//     - 'add'        { slug, taskId, dependsOnTaskId, source?, rationale? }
//     - 'remove'     { slug, taskId, dependsOnTaskId }
//     - 'replaceAll' { slug, edges: [{taskId, dependsOnTaskId, source, rationale}] }
//                    атомарно стирает все записи slug'а и записывает новые

const AT_PAT = process.env.AIRTABLE_PAT;
const BASE = 'apph1Z1U3OU2gBvnL';
const TABLE = 'TaskDependencies';

function bad(res, code, msg) { res.status(code).json({ error: msg }); }

async function airtable(method, path, body) {
  const r = await fetch(`https://api.airtable.com/v0/${path}`, {
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
    throw err;
  }
  return data;
}

async function listAll(filter) {
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams();
    params.set('pageSize', '100');
    if (filter) params.set('filterByFormula', filter);
    if (offset) params.set('offset', offset);
    const data = await airtable('GET', `${BASE}/${TABLE}?${params.toString()}`);
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return records;
}

function escapeFormula(s) { return String(s || '').replace(/'/g, "\\'"); }

function shape(r) {
  return {
    id: r.id,
    taskId: r.fields.TaskId || '',
    dependsOnTaskId: r.fields.DependsOnTaskId || '',
    source: r.fields.Source || 'manual',
    rationale: r.fields.Rationale || '',
    at: r.fields.At || ''
  };
}

async function listForSlug(slug) {
  const recs = await listAll(`{ProjectSlug}='${escapeFormula(slug)}'`);
  return recs.map(shape);
}

async function findEdge(slug, taskId, dependsOnTaskId) {
  const f = `AND({ProjectSlug}='${escapeFormula(slug)}',{TaskId}='${escapeFormula(taskId)}',{DependsOnTaskId}='${escapeFormula(dependsOnTaskId)}')`;
  const recs = await listAll(f);
  return recs[0] || null;
}

async function addEdge({ slug, taskId, dependsOnTaskId, source = 'manual', rationale = '' }) {
  if (!slug || !taskId || !dependsOnTaskId) throw new Error('slug, taskId, dependsOnTaskId required');
  if (taskId === dependsOnTaskId) throw new Error('self-dependency forbidden');
  const existing = await findEdge(slug, taskId, dependsOnTaskId);
  if (existing) {
    // Update source/rationale only
    const r = await airtable('PATCH', `${BASE}/${TABLE}/${existing.id}`, {
      fields: { Source: source, Rationale: rationale, At: new Date().toISOString() }
    });
    return shape(r);
  }
  const r = await airtable('POST', `${BASE}/${TABLE}`, {
    fields: {
      ProjectSlug: slug,
      TaskId: taskId,
      DependsOnTaskId: dependsOnTaskId,
      Source: source,
      Rationale: rationale,
      At: new Date().toISOString()
    }
  });
  return shape(r);
}

async function removeEdge({ slug, taskId, dependsOnTaskId }) {
  const existing = await findEdge(slug, taskId, dependsOnTaskId);
  if (!existing) return { ok: true, removed: 0 };
  await airtable('DELETE', `${BASE}/${TABLE}/${existing.id}`);
  return { ok: true, removed: 1 };
}

// Atomic-ish replace: delete all for slug, then bulk create new.
async function replaceAll({ slug, edges }) {
  if (!slug) throw new Error('slug required');
  const list = Array.isArray(edges) ? edges : [];
  const existing = await listForSlug(slug);
  // Delete in batches of 10 (Airtable limit)
  for (let i = 0; i < existing.length; i += 10) {
    const batch = existing.slice(i, i + 10);
    const params = new URLSearchParams();
    batch.forEach(r => params.append('records[]', r.id));
    await airtable('DELETE', `${BASE}/${TABLE}?${params.toString()}`);
  }
  // Insert in batches of 10
  const at = new Date().toISOString();
  const created = [];
  for (let i = 0; i < list.length; i += 10) {
    const batch = list.slice(i, i + 10);
    const r = await airtable('POST', `${BASE}/${TABLE}`, {
      records: batch
        .filter(e => e.taskId && e.dependsOnTaskId && e.taskId !== e.dependsOnTaskId)
        .map(e => ({
          fields: {
            ProjectSlug: slug,
            TaskId: String(e.taskId),
            DependsOnTaskId: String(e.dependsOnTaskId),
            Source: e.source === 'manual' ? 'manual' : 'auto',
            Rationale: String(e.rationale || ''),
            At: at
          }
        }))
    });
    created.push(...(r.records || []).map(shape));
  }
  return { ok: true, count: created.length, deps: created };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!AT_PAT) return bad(res, 503, 'AIRTABLE_PAT not set');

  try {
    if (req.method === 'GET') {
      const slug = req.query.slug;
      if (!slug) return bad(res, 400, 'slug required');
      const deps = await listForSlug(slug);
      return res.status(200).json({ deps });
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      const { action, payload } = body;
      if (!action) return bad(res, 400, 'action required');
      if (action === 'add') {
        const dep = await addEdge(payload || {});
        return res.status(200).json({ ok: true, dep });
      }
      if (action === 'remove') {
        const r = await removeEdge(payload || {});
        return res.status(200).json(r);
      }
      if (action === 'replaceAll') {
        const r = await replaceAll(payload || {});
        return res.status(200).json(r);
      }
      return bad(res, 400, `unknown action: ${action}`);
    }
    return bad(res, 405, 'GET or POST only');
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
};
