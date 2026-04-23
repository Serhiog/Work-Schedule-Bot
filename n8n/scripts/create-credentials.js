#!/usr/bin/env node
/**
 * Create n8n credentials for Work Schedule Bot in the local sqlite DB.
 * Idempotent: updates existing credentials by name, inserts new ones otherwise.
 * Also links them to Personal project via shared_credentials.
 *
 * Requires: env AIRTABLE_PAT, OPENAI_KEY, TELEGRAM_BOT_TOKEN, GITHUB_PAT.
 */

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const cryptoJs = require('/opt/homebrew/lib/node_modules/n8n/node_modules/crypto-js');

const fs = require('fs');
const DB = `${process.env.HOME}/.n8n/database.sqlite`;
const ENC_KEY = JSON.parse(fs.readFileSync(`${process.env.HOME}/.n8n/config`, 'utf8')).encryptionKey;
const PROJECT_ID = '7UoCEHRs6ntAn59R'; // Personal

function encrypt(obj) {
  return cryptoJs.AES.encrypt(JSON.stringify(obj), ENC_KEY).toString();
}

function sql(q) {
  const r = spawnSync('sqlite3', [DB], { input: q, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`sqlite: ${r.stderr}`);
  return r.stdout.trim();
}

const REQUIRED_ENVS = ['AIRTABLE_PAT', 'OPENAI_KEY', 'TELEGRAM_BOT_TOKEN', 'GITHUB_PAT'];
for (const v of REQUIRED_ENVS) if (!process.env[v]) { console.error(`Missing env ${v}`); process.exit(1); }

const CREDS = [
  {
    name: 'WSB · Telegram Bot',
    type: 'telegramApi',
    data: { accessToken: process.env.TELEGRAM_BOT_TOKEN },
  },
  {
    name: 'WSB · Airtable PAT',
    type: 'airtableTokenApi',
    data: { accessToken: process.env.AIRTABLE_PAT },
  },
  {
    name: 'WSB · OpenAI',
    type: 'openAiApi',
    data: { apiKey: process.env.OPENAI_KEY },
  },
  {
    name: 'WSB · GitHub PAT',
    type: 'githubApi',
    data: { server: 'https://api.github.com', user: 'Serhiog', accessToken: process.env.GITHUB_PAT },
  },
];

function q(s) { return String(s).replace(/'/g, "''"); }

(async () => {
  for (const c of CREDS) {
    const enc = encrypt(c.data);
    const existing = sql(`SELECT id FROM credentials_entity WHERE name='${q(c.name)}';`);
    let id;
    if (existing) {
      id = existing.split('\n')[0];
      sql(`UPDATE credentials_entity SET data='${q(enc)}', type='${q(c.type)}', updatedAt=STRFTIME('%Y-%m-%d %H:%M:%f','NOW') WHERE id='${id}';`);
      console.log(`= ${c.name} updated (${id})`);
    } else {
      id = crypto.randomUUID().slice(0, 16);
      sql(`INSERT INTO credentials_entity (id, name, data, type, isManaged, isGlobal, isResolvable, resolvableAllowFallback)
           VALUES ('${id}', '${q(c.name)}', '${q(enc)}', '${q(c.type)}', 0, 0, 0, 0);`);
      console.log(`+ ${c.name} created (${id})`);
    }
    // Link to Personal project
    const shared = sql(`SELECT credentialsId FROM shared_credentials WHERE credentialsId='${id}' AND projectId='${PROJECT_ID}';`);
    if (!shared) {
      sql(`INSERT INTO shared_credentials (credentialsId, projectId, role) VALUES ('${id}', '${PROJECT_ID}', 'credential:owner');`);
      console.log(`  + linked to Personal project`);
    }
  }
  console.log('\nDone.');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
