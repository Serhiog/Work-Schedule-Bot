#!/usr/bin/env node
// Idempotent workflow import into n8n sqlite (Vision Tower folder).
// Usage: node import-workflow.js <path-to-workflow.json>

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const DB = `${process.env.HOME}/.n8n/database.sqlite`;
const FOLDER_ID = '044e7604-fbae-4826-bf06-64a562e7f97d'; // Vision Tower | office 1801
const PROJECT_ID = '7UoCEHRs6ntAn59R'; // Personal project

function runSql(sqlText) {
  const res = spawnSync('sqlite3', [DB], { input: sqlText, encoding: 'utf8' });
  if (res.status !== 0) {
    console.error('sqlite error:', res.stderr);
    throw new Error('sqlite failed');
  }
  return res.stdout.trim();
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node import-workflow.js <path-to-workflow.json>');
  process.exit(1);
}

const abs = path.resolve(file);
const wf = JSON.parse(fs.readFileSync(abs, 'utf8'));

const name = wf.name;
if (!name) throw new Error('workflow.name required');

// SQLite single-quote escape: ' → ''
const q = (s) => String(s).replace(/'/g, "''");

const nodesJson = JSON.stringify(wf.nodes || []);
const connectionsJson = JSON.stringify(wf.connections || {});
const settingsJson = JSON.stringify(wf.settings || {});
const staticDataJson = wf.staticData ? JSON.stringify(wf.staticData) : null;
const pinDataJson = JSON.stringify(wf.pinData || {});
const metaJson = JSON.stringify(wf.meta || {});
const versionId = crypto.randomUUID();

// Check existing
const existing = runSql(
  `SELECT id FROM workflow_entity WHERE name='${q(name)}' AND parentFolderId='${FOLDER_ID}';`
);

let sql;
let wfId;
if (existing) {
  wfId = existing.split('\n')[0];
  sql = `UPDATE workflow_entity SET
    nodes='${q(nodesJson)}',
    connections='${q(connectionsJson)}',
    settings='${q(settingsJson)}',
    ${staticDataJson ? `staticData='${q(staticDataJson)}',` : 'staticData=NULL,'}
    pinData='${q(pinDataJson)}',
    meta='${q(metaJson)}',
    versionId='${versionId}',
    updatedAt=STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')
    WHERE id='${wfId}';`;
} else {
  wfId = crypto.randomUUID();
  sql = `INSERT INTO workflow_entity (id, name, active, nodes, connections, settings, staticData, pinData, versionId, triggerCount, meta, parentFolderId, isArchived, versionCounter)
    VALUES (
      '${wfId}',
      '${q(name)}',
      0,
      '${q(nodesJson)}',
      '${q(connectionsJson)}',
      '${q(settingsJson)}',
      ${staticDataJson ? `'${q(staticDataJson)}'` : 'NULL'},
      '${q(pinDataJson)}',
      '${versionId}',
      0,
      '${q(metaJson)}',
      '${FOLDER_ID}',
      0,
      1
    );`;
}

runSql(sql);

// Ensure shared_workflow row exists (required for workflow to appear in UI)
const shared = runSql(
  `SELECT workflowId FROM shared_workflow WHERE workflowId='${wfId}' AND projectId='${PROJECT_ID}';`
);
if (!shared) {
  runSql(
    `INSERT INTO shared_workflow (workflowId, projectId, role) VALUES ('${wfId}', '${PROJECT_ID}', 'workflow:owner');`
  );
  console.log(`  + linked to project ${PROJECT_ID} (workflow:owner)`);
}

console.log(existing ? `✓ Updated '${name}' (id=${wfId})` : `✓ Inserted '${name}' (id=${wfId})`);
