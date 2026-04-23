#!/usr/bin/env node
/**
 * Creates Users / AuditLog / PendingConfirmations / Projects / SectionOwners tables
 * in the Work Schedule base (apph1Z1U3OU2gBvnL) and inserts seed rows
 * (owner user 584268213 + orange project).
 *
 * Usage:  AIRTABLE_PAT=pat... node n8n/scripts/create-bot-tables.js
 *
 * Idempotent: skips a table if it already exists.
 */

const PAT = process.env.AIRTABLE_PAT;
if (!PAT) { console.error('Missing AIRTABLE_PAT env'); process.exit(1); }

const BASE = 'apph1Z1U3OU2gBvnL';
const OWNER_TG_ID = '584268213';

async function req(path, opts = {}) {
  const r = await fetch(`https://api.airtable.com${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${PAT}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${JSON.stringify(json)}`);
  return json;
}

async function listTables() {
  const d = await req(`/v0/meta/bases/${BASE}/tables`);
  return d.tables || [];
}

async function createTable(spec) {
  return req(`/v0/meta/bases/${BASE}/tables`, { method: 'POST', body: JSON.stringify(spec) });
}

async function insertRecords(tableId, records) {
  return req(`/v0/${BASE}/${tableId}`, {
    method: 'POST',
    body: JSON.stringify({ records: records.map((fields) => ({ fields })) }),
  });
}

const TABLE_SPECS = [
  {
    name: 'Projects',
    fields: [
      { name: 'ProjectId', type: 'singleLineText' },
      { name: 'Name', type: 'singleLineText' },
      { name: 'RepoUrl', type: 'url' },
      { name: 'ScheduleJsonPath', type: 'singleLineText' },
      { name: 'TelegramChatId', type: 'singleLineText' },
      { name: 'VercelAliasUrl', type: 'url' },
      { name: 'Active', type: 'checkbox', options: { color: 'greenBright', icon: 'check' } },
    ],
  },
  {
    name: 'Users',
    fields: [
      { name: 'TelegramUserId', type: 'singleLineText' },
      { name: 'TelegramUsername', type: 'singleLineText' },
      { name: 'Name', type: 'singleLineText' },
      {
        name: 'Role',
        type: 'singleSelect',
        options: { choices: [
          { name: 'owner', color: 'redBright' },
          { name: 'foreman', color: 'orangeBright' },
          { name: 'viewer', color: 'blueBright' },
        ] },
      },
      {
        name: 'Language',
        type: 'singleSelect',
        options: { choices: [
          { name: 'ru', color: 'blueLight2' },
          { name: 'en', color: 'greenLight2' },
        ] },
      },
      { name: 'AllowedSections', type: 'multilineText' },
      { name: 'Active', type: 'checkbox', options: { color: 'greenBright', icon: 'check' } },
    ],
  },
  {
    name: 'AuditLog',
    fields: [
      { name: 'Timestamp', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
      { name: 'TelegramUserId', type: 'singleLineText' },
      { name: 'ProjectId', type: 'singleLineText' },
      { name: 'Intent', type: 'singleLineText' },
      { name: 'MessageText', type: 'multilineText' },
      { name: 'ParsedPayload', type: 'multilineText' },
      {
        name: 'Status',
        type: 'singleSelect',
        options: { choices: [
          { name: 'ok', color: 'greenBright' },
          { name: 'pending_confirm', color: 'yellowBright' },
          { name: 'rejected', color: 'grayBright' },
          { name: 'error', color: 'redBright' },
        ] },
      },
      { name: 'ResultMessage', type: 'multilineText' },
      { name: 'CommitSha', type: 'singleLineText' },
    ],
  },
  {
    name: 'PendingConfirmations',
    fields: [
      { name: 'ConfirmId', type: 'singleLineText' },
      { name: 'TelegramUserId', type: 'singleLineText' },
      { name: 'ProjectId', type: 'singleLineText' },
      { name: 'Action', type: 'multilineText' },
      { name: 'CreatedAt', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
      { name: 'ExpiresAt', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
      {
        name: 'Resolution',
        type: 'singleSelect',
        options: { choices: [
          { name: 'pending', color: 'yellowBright' },
          { name: 'confirmed', color: 'greenBright' },
          { name: 'cancelled', color: 'grayBright' },
          { name: 'expired', color: 'redBright' },
        ] },
      },
    ],
  },
  {
    name: 'SectionOwners',
    fields: [
      { name: 'ProjectId', type: 'singleLineText' },
      { name: 'SectionId', type: 'singleLineText' },
      { name: 'Name', type: 'singleLineText' },
      { name: 'Contact', type: 'singleLineText' },
      {
        name: 'Type',
        type: 'singleSelect',
        options: { choices: [
          { name: 'cyfr', color: 'blueBright' },
          { name: 'sub', color: 'orangeBright' },
        ] },
      },
    ],
  },
];

(async () => {
  const existing = await listTables();
  const byName = new Map(existing.map((t) => [t.name, t]));
  const created = {};

  for (const spec of TABLE_SPECS) {
    if (byName.has(spec.name)) {
      console.log(`= ${spec.name}: exists (${byName.get(spec.name).id})`);
      created[spec.name] = byName.get(spec.name).id;
    } else {
      const r = await createTable(spec);
      console.log(`+ ${spec.name}: created (${r.id})`);
      created[spec.name] = r.id;
    }
  }

  // Seed Users: owner
  const usersTable = created['Users'];
  const usersList = await req(`/v0/${BASE}/${usersTable}?filterByFormula=${encodeURIComponent(`{TelegramUserId}="${OWNER_TG_ID}"`)}`);
  if (!usersList.records.length) {
    await insertRecords(usersTable, [{
      TelegramUserId: OWNER_TG_ID,
      TelegramUsername: 'Serhiog',
      Name: 'Sergei Grishenkov',
      Role: 'owner',
      Language: 'ru',
      AllowedSections: 'all',
      Active: true,
    }]);
    console.log(`+ Users: seeded owner ${OWNER_TG_ID}`);
  } else {
    console.log(`= Users: owner ${OWNER_TG_ID} already present`);
  }

  // Seed Projects: orange
  const projectsTable = created['Projects'];
  const projList = await req(`/v0/${BASE}/${projectsTable}?filterByFormula=${encodeURIComponent(`{ProjectId}="orange"`)}`);
  if (!projList.records.length) {
    await insertRecords(projectsTable, [{
      ProjectId: 'orange',
      Name: 'Orange Group Office 3.0',
      RepoUrl: 'https://github.com/Serhiog/Work-Schedule-Bot',
      ScheduleJsonPath: 'web/schedule.json',
      TelegramChatId: '584268213', // 1-on-1 with owner until group is set up
      VercelAliasUrl: 'https://cyfr-schedule-app.vercel.app/',
      Active: true,
    }]);
    console.log(`+ Projects: seeded orange`);
  } else {
    console.log(`= Projects: orange already present`);
  }

  console.log('\nDone. Table IDs:');
  for (const [k, v] of Object.entries(created)) console.log(`  ${k}: ${v}`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
