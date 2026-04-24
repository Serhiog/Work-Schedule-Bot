const CUSTOMER_ID = process.env.PLANRADAR_CUSTOMER_ID || '1500855';
const PROJECT_ID = process.env.PLANRADAR_PROJECT_ID || '1533951';
const PLANRADAR_BASE    = `https://www.planradar.com/api/v1/${CUSTOMER_ID}`;
const PLANRADAR_BASE_V2 = `https://www.planradar.com/api/v2/${CUSTOMER_ID}`;
const TICKET_TYPE_ID = 'ymmgmdn';
const FIELD_ISSUE = 'tf811471518c82f258'; // LongText "Issue"
// Floor plan component ID — must be set after uploading a plan to PlanRadar project
const COMPONENT_ID = process.env.PLANRADAR_COMPONENT_ID || null;

// Status ID mapping — PlanRadar uses short STRING IDs per project (e.g. "lm"=Open, "gk"=Closed)
// Inferred from this project's tickets (see diagnostic debug=statuses).
// TODO when other statuses confirmed: add full mapping
const STATUS_TO_ID = {
  open:        'lm',
  resolved:    'gk',
  // Fallback for less-common statuses — send default "closed" / "open" to keep write working
  in_progress: 'lm',
  in_review:   'lm',
  deferred:    'lm',
  rejected:    'gk'
};

const MOCK_TICKETS = [
  { id: 'T001', title: 'Кабель не проходит через стену', description: 'В зоне санузла кабель не проходит через капитальную стену — нужна дополнительная протяжка [task:3]', status: 'resolved', created_at: '2026-03-18', due_date: '2026-03-22', creator: 'Бригадир', task_id: '3', photos: [] },
  { id: 'T002', title: 'Задержка поставки труб ХВС', description: 'Поставщик задержал трубы ХВС на 3 рабочих дня. Монтаж приостановлен [task:5]', status: 'resolved', created_at: '2026-03-25', due_date: '2026-03-30', creator: 'Бригадир', task_id: '5', photos: [] },
  { id: 'T003', title: 'Трещина в стяжке наливного пола', description: 'Обнаружена трещина 0.5 мм в зоне коридора. Требует ремонта перед укладкой плитки [task:18]', status: 'open', created_at: '2026-04-20', due_date: '2026-04-28', creator: 'Бригадир', task_id: '18', photos: [] },
  { id: 'T004', title: 'Не хватает профиля для ГКЛ потолка', description: 'Недостача 40 пог.м. CD-профиля для зоны open-space. Заказ размещён [task:20]', status: 'in_progress', created_at: '2026-04-14', due_date: '2026-04-25', creator: 'Прораб', task_id: '20', photos: [] },
  { id: 'T005', title: 'Покраска: разводы первого слоя', description: 'В переговорной комнате 3 видны разводы после первого слоя шпаклёвки. Нужна повторная обработка [task:24]', status: 'open', created_at: '2026-04-21', due_date: '2026-04-30', creator: 'Бригадир', task_id: '24', photos: [] },
  { id: 'T006', title: 'Стеклянная перегородка — сколол угол', description: 'При монтаже скол на нижнем углу секции B2. Стекло заменено, демонтаж произведён [task:23]', status: 'in_progress', created_at: '2026-04-22', due_date: '2026-04-27', creator: 'Субподрядчик', task_id: '23', photos: [] }
];

function parseTaskId(text) {
  if (!text) return null;
  const m = String(text).match(/\[task:(\w+)\]/i);
  return m ? m[1] : null;
}

// PlanRadar project-specific status IDs → our internal status keys
const PR_STATUS_TO_KEY = {
  lm: 'open',
  gk: 'resolved',
  // Unknowns fall through (see below)
};

function normalizeStatus(rawStatusId, attrs) {
  // Primary signal: closed-at timestamp — reliably set when ticket moved to a "closed" state
  if (attrs && attrs['closed-at']) return 'resolved';
  // Secondary: explicit mapping by PR status id
  const mapped = PR_STATUS_TO_KEY[rawStatusId];
  if (mapped) return mapped;
  // Fallback string heuristics (legacy)
  const s = String(rawStatusId || '').toLowerCase();
  if (s.includes('resolv') || s.includes('clos') || s.includes('done')) return 'resolved';
  if (s.includes('progress')) return 'in_progress';
  if (s.includes('review')) return 'in_review';
  if (s.includes('defer') || s.includes('hold')) return 'deferred';
  if (s.includes('reject')) return 'rejected';
  return 'open';
}

// Normalise a JSON:API ticket resource from PlanRadar
function normalizeTicket(t) {
  const attrs = t.attributes || t;
  const typed = attrs['typed-values'] || {};
  const desc = typed[FIELD_ISSUE] || attrs.description || attrs.body || '';
  const subject = attrs.subject || '';
  const uuid = attrs.uuid || String(t.id || '');
  return {
    id: uuid,
    title: subject || '(без названия)',
    description: desc,
    status: normalizeStatus(attrs['status-id'] || attrs.status, attrs),
    created_at: (attrs['created-at'] || attrs.createdAt || '').slice(0, 10),
    due_date: (attrs['due-date'] || attrs.dueDate || '').slice(0, 10) || null,
    creator: attrs['created-by']?.name || attrs.creator?.name || '',
    task_id: parseTaskId(desc) || parseTaskId(subject),
    photos: (attrs['ticket-images'] || attrs.attachments || attrs.documents || [])
      .map((a) => ({ url: a.url || a.file_url, thumb: a.thumbnail_url || a.thumb_url || a.url || a.file_url }))
      .filter((a) => a.url)
  };
}

const PR_HEADERS = (apiKey) => ({
  'X-PlanRadar-API-Key': apiKey,
  'Content-Type': 'application/json',
  'Accept': 'application/json'
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Image proxy — bypass PlanRadar CDN CORS so client can read photo bytes
  if (req.method === 'GET' && req.query?.image) {
    const apiKeyLocal = process.env.PLANRADAR_API_KEY;
    const imgUrl = String(req.query.image);
    // Whitelist: PlanRadar domain OR PlanRadar S3 bucket (pre-signed URLs for photos)
    const isPlanRadar = /planradar\.(com|net|io)/i.test(imgUrl);
    const isPrS3 = /(^|\/\/)(prd-)?planradar[^/]*\.s3[.-][^/]*\.amazonaws\.com/i.test(imgUrl)
      || /defectradar_issue_images/i.test(imgUrl);
    if (!isPlanRadar && !isPrS3) {
      return res.status(400).json({ error: 'invalid image URL host' });
    }
    try {
      // S3 pre-signed URLs must NOT have extra headers — would break signature
      const headers = (isPrS3 || !apiKeyLocal) ? {} : { 'X-PlanRadar-API-Key': apiKeyLocal };
      const r = await fetch(imgUrl, { headers });
      if (!r.ok) return res.status(r.status).json({ error: `upstream ${r.status}` });
      const ab = await r.arrayBuffer();
      const ct = r.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
      return res.status(200).send(Buffer.from(ab));
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  const prError = (data, status) => {
    if (!data) return `HTTP ${status}`;
    if (typeof data === 'string') return data.slice(0, 240);
    if (data.error) return data.error;
    if (data.message) return data.message;
    if (Array.isArray(data.errors) && data.errors[0]) {
      const e = data.errors[0];
      return e.detail || e.title || e.message || `HTTP ${status}`;
    }
    return `HTTP ${status}`;
  };

  const apiKey = process.env.PLANRADAR_API_KEY;

  // PUT /api/planradar — update ticket (status / subject / description / dueDate)
  if (req.method === 'PUT') {
    if (!apiKey) return res.status(503).json({ error: 'API key not configured' });
    const { ticketId, status, subject, description, dueDate, taskId } = req.body || {};
    if (!ticketId) return res.status(400).json({ error: 'ticketId required' });
    const attrs = {};
    if (status) {
      const statusId = STATUS_TO_ID[status];
      if (!statusId) return res.status(400).json({ error: `Unknown status: ${status}` });
      attrs['status-id'] = statusId;
    }
    if (subject !== undefined) attrs.subject = subject;
    if (dueDate !== undefined) attrs['due-date'] = dueDate || null;
    if (description !== undefined) {
      const descWithTag = taskId
        ? `${description || ''} [task:${taskId}]`.trim()
        : (description || '');
      attrs['typed-values'] = { [FIELD_ISSUE]: descWithTag };
    }
    if (!Object.keys(attrs).length) return res.status(400).json({ error: 'no fields to update' });
    try {
      const r = await fetch(
        `${PLANRADAR_BASE}/projects/${PROJECT_ID}/tickets/${ticketId}`,
        { method: 'PUT', headers: PR_HEADERS(apiKey), body: JSON.stringify({ data: { attributes: attrs } }) }
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(r.status).json({ error: prError(data, r.status), raw: data });
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // DELETE /api/planradar — delete photo attachment or whole ticket
  if (req.method === 'DELETE') {
    if (!apiKey) return res.status(503).json({ error: 'API key not configured' });
    const { ticketId, photoId } = req.body || {};
    if (photoId) {
      // Delete single DMS attachment by its resource id
      try {
        const r = await fetch(
          `${PLANRADAR_BASE_V2}/projects/${PROJECT_ID}/dms/nodes/${photoId}`,
          { method: 'DELETE', headers: { 'X-PlanRadar-API-Key': apiKey, 'Accept': 'application/json' } }
        );
        if (!r.ok) {
          const txt = await r.text();
          return res.status(r.status).json({ error: `PR ${r.status}: ${txt.slice(0,200)}` });
        }
        return res.status(200).json({ ok: true });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }
    if (ticketId) {
      try {
        const r = await fetch(
          `${PLANRADAR_BASE}/projects/${PROJECT_ID}/tickets/${ticketId}`,
          { method: 'DELETE', headers: { 'X-PlanRadar-API-Key': apiKey, 'Accept': 'application/json' } }
        );
        return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }
    return res.status(400).json({ error: 'photoId or ticketId required' });
  }

  // POST /api/planradar — create ticket OR add photo to existing ticket (action: 'addPhoto')
  if (req.method === 'POST') {
    if (!apiKey) return res.status(503).json({ error: 'API key not configured' });

    // Add photo to existing ticket
    if (req.body?.action === 'addPhoto') {
      const { ticketId, photo } = req.body;
      if (!ticketId || !photo?.data) return res.status(400).json({ error: 'ticketId and photo.data required' });
      try {
        const dataUri = `data:${photo.mimeType || 'image/jpeg'};base64,${photo.data}`;
        const r = await fetch(
          `${PLANRADAR_BASE_V2}/projects/${PROJECT_ID}/dms/nodes/ticket_attachments/${ticketId}`,
          {
            method: 'POST',
            headers: { 'X-PlanRadar-API-Key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ data: { attributes: { attachment: dataUri, 'attachment-name': photo.name || 'photo.jpg' } } })
          }
        );
        const txt = await r.text();
        let data = {};
        try { data = JSON.parse(txt); } catch (_) { /* keep empty */ }
        if (!r.ok) return res.status(r.status).json({ error: prError(data, r.status) || `HTTP ${r.status}` });
        const att = (data.included || []).find((i) => i.type === 'dms-attachment') || data.data;
        const ia = att?.attributes || {};
        const thumbs = ia['file-data']?.metadata?.thumbnails || ia['current-version-thumbnails'] || {};
        const url   = ia.url || thumbs.large || thumbs.medium || '';
        const thumb = thumbs.small || thumbs.medium || thumbs.large || url;
        return res.status(200).json({ photo: { photoId: att?.id || '', url, thumb } });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    const { subject, description, taskId, dueDate, photos } = req.body || {};
    if (!subject) return res.status(400).json({ error: 'subject required' });
    if (!dueDate) return res.status(400).json({ error: 'dueDate required' });
    if (!COMPONENT_ID) return res.status(503).json({ error: 'PLANRADAR_COMPONENT_ID not configured — upload a floor plan to your PlanRadar project first' });
    const descWithTag = taskId
      ? `${description || ''} [task:${taskId}]`.trim()
      : (description || '');
    const ticketUuid = crypto.randomUUID();
    const attrs = {
      'ticket-type-id': TICKET_TYPE_ID,
      'component-id': COMPONENT_ID,
      uuid: ticketUuid,
      subject,
      'due-date': dueDate,
      'typed-values': { [FIELD_ISSUE]: descWithTag }
    };
    try {
      const r = await fetch(
        `${PLANRADAR_BASE}/projects/${PROJECT_ID}/tickets/`,
        {
          method: 'POST',
          headers: PR_HEADERS(apiKey),
          body: JSON.stringify({ data: { attributes: attrs } })
        }
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(r.status).json({ error: prError(data, r.status), raw: data });
      const created = normalizeTicket(data.data || data);

      // Use the actual UUID returned by PlanRadar (may differ from ticketUuid we sent)
      const actualTicketId = data.data?.attributes?.uuid || data.data?.id || ticketUuid;
      console.log('[planradar] created ticket id:', actualTicketId, '(sent uuid:', ticketUuid, ')');

      // Upload photos if provided
      const uploadedPhotos = [];
      const uploadDebug = [];
      if (Array.isArray(photos) && photos.length) {
        for (const photo of photos) {
          try {
            const dataUri = `data:${photo.mimeType || 'image/jpeg'};base64,${photo.data}`;
            const imgUrl = `${PLANRADAR_BASE_V2}/projects/${PROJECT_ID}/dms/nodes/ticket_attachments/${actualTicketId}`;
            console.log('[planradar] uploading photo to:', imgUrl);
            const imgR = await fetch(imgUrl, {
              method: 'POST',
              headers: { 'X-PlanRadar-API-Key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ data: { attributes: { attachment: dataUri, 'attachment-name': photo.name || 'photo.jpg' } } })
            });
            const imgText = await imgR.text();
            let imgData = {};
            try { imgData = JSON.parse(imgText); } catch (_) {}
            if (imgR.ok) {
              uploadDebug.push({ status: imgR.status, ok: true, name: photo.name });
              const attachment = (imgData.included || []).find((i) => i.type === 'dms-attachment');
              const ia = attachment?.attributes || {};
              const thumbs = ia['file-data']?.metadata?.thumbnails || ia['current-version-thumbnails'] || {};
              const url   = ia.url || thumbs.large || thumbs.medium || '';
              const thumb = thumbs.small || thumbs.medium || thumbs.large || url;
              if (url) uploadedPhotos.push({ photoId: attachment?.id || '', url, thumb });
            } else {
              uploadDebug.push({ status: imgR.status, ok: false, name: photo.name, error: prError(imgData, imgR.status) });
            }
          } catch (e) {
            console.error('[planradar] photo upload error:', e.message);
            uploadDebug.push({ ok: false, name: photo.name, error: e.message });
          }
        }
      }
      created.photos = uploadedPhotos;

      return res.status(201).json({ ticket: created, uploadDebug });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Diagnostic: list all statuses for this project (disabled in production)
  if (req.method === 'GET' && req.query?.debug === 'statuses' && process.env.NODE_ENV !== 'production') {
    if (!apiKey) return res.status(503).json({ error: 'no key' });
    // Try both common endpoints
    const urls = [
      `${PLANRADAR_BASE}/projects/${PROJECT_ID}/issue-statuses`,
      `${PLANRADAR_BASE}/projects/${PROJECT_ID}/tickets/?per_page=5&include=issue-statuses`,
      `${PLANRADAR_BASE}/projects/${PROJECT_ID}/tickets/?per_page=5&include=status`,
      `${PLANRADAR_BASE}/projects/${PROJECT_ID}/ticket-type/${TICKET_TYPE_ID}`,
      `${PLANRADAR_BASE_V2}/projects/${PROJECT_ID}/issue-statuses`,
    ];
    const out = {};
    for (const u of urls) {
      try {
        const r = await fetch(u, { headers: { 'X-PlanRadar-API-Key': apiKey, 'Accept': 'application/json' } });
        const txt = await r.text();
        let parsed = null;
        try { parsed = JSON.parse(txt); } catch (_) {}
        if (parsed && parsed.included) {
          const byType = {};
          parsed.included.forEach(i => { (byType[i.type] ||= []).push({ id: i.id, attrs: i.attributes }); });
          out[u] = { status: r.status, includedTypes: Object.keys(byType), byTypeSample: Object.fromEntries(Object.entries(byType).map(([k,v]) => [k, v.slice(0,5)])) };
        } else if (parsed && parsed.data) {
          out[u] = { status: r.status, dataSample: Array.isArray(parsed.data) ? parsed.data.slice(0,5) : parsed.data };
        } else {
          out[u] = { status: r.status, raw: txt.slice(0, 200) };
        }
      } catch (e) { out[u] = { err: e.message }; }
    }
    return res.json(out);
  }

  // Diagnostic: GET /api/planradar?debug=status — show raw status attribute shape
  if (req.method === 'GET' && req.query?.debug === 'status') {
    if (!apiKey) return res.status(503).json({ error: 'no key' });
    try {
      const r = await fetch(`${PLANRADAR_BASE}/projects/${PROJECT_ID}/tickets/?per_page=5`,
        { headers: { 'X-PlanRadar-API-Key': apiKey, 'Accept': 'application/json' } });
      const body = await r.text();
      const d = JSON.parse(body);
      const arr = Array.isArray(d) ? d : (d.data || d.tickets || []);
      // group by status-id + check closed-at
      const byStatusId = {};
      arr.forEach(t => {
        const a = t.attributes || t;
        const sid = a['status-id'] || 'NONE';
        byStatusId[sid] = byStatusId[sid] || { count: 0, anyClosedAt: null, sampleSubject: null };
        byStatusId[sid].count++;
        if (a['closed-at'] && !byStatusId[sid].anyClosedAt) byStatusId[sid].anyClosedAt = a['closed-at'];
        if (!byStatusId[sid].sampleSubject) byStatusId[sid].sampleSubject = a.subject;
      });
      const sample = arr.slice(0, 3).map(t => {
        const a = t.attributes || t;
        return {
          uuid: a.uuid,
          subject: a.subject,
          'status-id': a['status-id'],
          'closed-at': a['closed-at'],
          'closed-by-id': a['closed-by-id'],
          'approval-status': a['approval-status'],
          status_relationship: t.relationships?.status?.data
        };
      });
      return res.json({ sample, byStatusId, totalTickets: arr.length });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // GET /api/planradar — fetch tickets
  if (!apiKey) return res.json({ mock: true, tickets: MOCK_TICKETS });

  try {
    // Fetch tickets and DMS attachments in parallel
    const [r, dmsR] = await Promise.all([
      fetch(`${PLANRADAR_BASE}/projects/${PROJECT_ID}/tickets/?per_page=100`,
        { headers: { 'X-PlanRadar-API-Key': apiKey, 'Accept': 'application/json' } }),
      fetch(`${PLANRADAR_BASE_V2}/projects/${PROJECT_ID}/dms/nodes/ticket_attachments`,
        { headers: { 'X-PlanRadar-API-Key': apiKey, 'Accept': 'application/json' } })
    ]);
    if (!r.ok) throw new Error(`PlanRadar ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const raw = Array.isArray(data) ? data : (data.data || data.tickets || []);
    const tickets = raw.map(normalizeTicket).filter((t) => t.task_id);

    // Build photo map from DMS attachments (ticketUuid → photos[])
    if (dmsR.ok) {
      try {
        const dmsData = await dmsR.json();
        const items = dmsData.included?.filter((i) => i.type === 'dms-attachment') || [];
        const photoMap = {};
        for (const att of items) {
          const ia = att.attributes || {};
          const tUuid = ia['ticket-uuid'];
          if (!tUuid) continue;
          const thumbs = ia['file-data']?.metadata?.thumbnails || ia['current-version-thumbnails'] || {};
          const url   = ia.url || thumbs.large || thumbs.medium || '';
          const thumb = thumbs.small || thumbs.medium || url;
          if (!url) continue;
          if (!photoMap[tUuid]) photoMap[tUuid] = [];
          photoMap[tUuid].push({ photoId: att.id || '', url, thumb });
        }
        for (const t of tickets) t.photos = photoMap[t.id] || [];
      } catch (_) { /* DMS parse failure: photos stay empty */ }
    }

    return res.json({ mock: false, tickets });
  } catch (e) {
    console.error('PlanRadar proxy error:', e.message);
    return res.json({ mock: true, tickets: MOCK_TICKETS });
  }
}
