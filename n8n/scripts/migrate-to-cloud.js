#!/usr/bin/env node
/**
 * Migrate WSB workflows from localhost to n8n cloud.
 * Creates 4 credentials in cloud, rewrites workflow JSONs with new cred IDs, imports, activates.
 */
const fs = require('fs');
const path = require('path');

const N8N_URL = 'https://grishenkov.app.n8n.cloud/api/v1';
const API_KEY = process.env.N8N_CLOUD_API_KEY;

const SECRETS = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  openaiKey: process.env.OPENAI_KEY,
  airtablePAT: process.env.AIRTABLE_PAT,
  githubPAT: process.env.GITHUB_PAT,
};

for (const [k,v] of Object.entries({ API_KEY, ...SECRETS })) {
  if (!v) { console.error(`Missing env ${k}`); process.exit(1); }
}

async function api(method, path, body) {
  const r = await fetch(`${N8N_URL}${path}`, {
    method,
    headers: {
      'X-N8N-API-KEY': API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let json;
  try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
  if (!r.ok) {
    console.error(`HTTP ${r.status} ${method} ${path}:`, JSON.stringify(json).slice(0, 400));
    throw new Error(`api ${r.status}`);
  }
  return json;
}

async function ensureCredential(name, type, data) {
  // Lookup by name
  const list = await api('GET', '/credentials?limit=100').catch(() => ({ data: [] }));
  const existing = (list.data || []).find(c => c.name === name);
  if (existing) {
    console.log(`  = credential ${name} exists: ${existing.id}`);
    return existing.id;
  }
  const created = await api('POST', '/credentials', { name, type, data });
  console.log(`  + credential ${name} created: ${created.id}`);
  return created.id;
}

async function upsertWorkflow(wf) {
  const list = await api('GET', `/workflows?limit=100`);
  const existing = (list.data || []).find(w => w.name === wf.name);
  let id;
  if (existing) {
    id = existing.id;
    // Deactivate first so import is clean
    if (existing.active) {
      try { await api('POST', `/workflows/${id}/deactivate`); } catch {}
    }
    // PUT update — strip readonly fields
    const body = {
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings || {},
      staticData: wf.staticData || null,
    };
    await api('PUT', `/workflows/${id}`, body);
    console.log(`  = workflow ${wf.name} updated: ${id}`);
  } else {
    const body = {
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings || {},
    };
    const created = await api('POST', '/workflows', body);
    id = created.id;
    console.log(`  + workflow ${wf.name} created: ${id}`);
  }
  return id;
}

function rewriteCredIds(wf, credMap) {
  // Map local cred IDs (in workflow JSON) → cloud cred IDs.
  // credMap: { 'local-id-or-name-key' : 'cloud-id' }
  for (const node of wf.nodes) {
    if (!node.credentials) continue;
    for (const [type, cred] of Object.entries(node.credentials)) {
      const cloudId = credMap[type];
      if (cloudId) {
        node.credentials[type] = { id: cloudId, name: `WSB · ${type}` };
      }
    }
  }
  return wf;
}

function rewriteSubWorkflowCall(wf, oldId, newId) {
  for (const node of wf.nodes) {
    if (node.type === 'n8n-nodes-base.executeWorkflow' && node.parameters?.workflowId) {
      if (node.parameters.workflowId.value === oldId) {
        node.parameters.workflowId.value = newId;
      }
    }
  }
}

(async () => {
  console.log('=== Creating cloud credentials ===');
  const credIds = {};
  credIds.telegramApi = await ensureCredential('WSB · Telegram Bot', 'telegramApi', {
    accessToken: SECRETS.telegramToken,
  });
  credIds.openAiApi = await ensureCredential('WSB · OpenAI', 'openAiApi', {
    apiKey: SECRETS.openaiKey,
    header: false,
  });
  credIds.airtableTokenApi = await ensureCredential('WSB · Airtable PAT', 'airtableTokenApi', {
    accessToken: SECRETS.airtablePAT,
  });
  credIds.githubApi = await ensureCredential('WSB · GitHub PAT', 'githubApi', {
    server: 'https://api.github.com',
    user: 'Serhiog',
    accessToken: SECRETS.githubPAT,
  });

  console.log('\n=== Importing sub-workflow (SchedulePatch) ===');
  const subJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflows', 'schedule-patch.json'), 'utf8'));
  rewriteCredIds(subJson, credIds);
  const subId = await upsertWorkflow(subJson);

  console.log('\n=== Importing main workflow (Telegram bot) ===');
  const mainJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflows', 'main-telegram-bot.json'), 'utf8'));
  rewriteCredIds(mainJson, credIds);
  // Rewrite sub-workflow call: old localhost ID → new cloud ID
  const OLD_SUB_ID = '2a8758b3-5407-431f-9f44-79020db3a5ba';
  rewriteSubWorkflowCall(mainJson, OLD_SUB_ID, subId);
  const mainId = await upsertWorkflow(mainJson);

  console.log('\n=== Activating ===');
  try {
    await api('POST', `/workflows/${subId}/activate`);
    console.log(`  ✓ ${subJson.name} active`);
  } catch (e) { console.log(`  ! sub activation: ${e.message}`); }
  try {
    await api('POST', `/workflows/${mainId}/activate`);
    console.log(`  ✓ ${mainJson.name} active`);
  } catch (e) { console.log(`  ! main activation: ${e.message}`); }

  console.log('\n=== Done ===');
  console.log(`  Main workflow ID: ${mainId}`);
  console.log(`  Sub  workflow ID: ${subId}`);
  console.log(`\n  View: https://grishenkov.app.n8n.cloud/workflow/${mainId}`);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
