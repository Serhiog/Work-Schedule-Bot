#!/usr/bin/env node
/**
 * Add analysis-friendly fields to the AuditLog table:
 *  - Transcript       (текст голосового после Whisper)
 *  - Confidence       (GPT confidence 0..1)
 *  - GPTRawOutput     (полный JSON что вернул GPT)
 *  - ReformulationOf  (ID записи AuditLog если юзер переформулировал предыдущий)
 *  - LatencyMs        (ответная задержка бота)
 *
 * Usage: AIRTABLE_PAT=... node n8n/scripts/extend-auditlog.js
 */

const PAT = process.env.AIRTABLE_PAT;
if (!PAT) { console.error('Missing AIRTABLE_PAT'); process.exit(1); }

const BASE = 'apph1Z1U3OU2gBvnL';
const AUDITLOG_TABLE = 'tblWkS72GumLM0Npm';

async function req(path, opts = {}) {
  const r = await fetch(`https://api.airtable.com${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0,300)}`);
  return j;
}

async function currentFields() {
  const d = await req(`/v0/meta/bases/${BASE}/tables`);
  const t = d.tables.find(t => t.id === AUDITLOG_TABLE);
  return new Set(t.fields.map(f => f.name));
}

async function addField(spec) {
  return req(`/v0/meta/bases/${BASE}/tables/${AUDITLOG_TABLE}/fields`, {
    method: 'POST',
    body: JSON.stringify(spec),
  });
}

const NEW_FIELDS = [
  { name: 'Transcript',      type: 'multilineText' },
  { name: 'Confidence',      type: 'number', options: { precision: 2 } },
  { name: 'GPTRawOutput',    type: 'multilineText' },
  { name: 'ReformulationOf', type: 'singleLineText' },
  { name: 'LatencyMs',       type: 'number', options: { precision: 0 } },
];

(async () => {
  const existing = await currentFields();
  for (const f of NEW_FIELDS) {
    if (existing.has(f.name)) {
      console.log(`= ${f.name} exists`);
      continue;
    }
    const r = await addField(f);
    console.log(`+ ${f.name} created (${r.id})`);
  }
  console.log('Done.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
