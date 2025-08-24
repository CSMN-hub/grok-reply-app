// server/src/db.js
// Postgres-backed storage (no better-sqlite3). Safe fallbacks for dev.

const crypto = require('crypto');
const { Pool } = require('pg');

const HAS_DB = !!process.env.DATABASE_URL;

let pool = null;
if (HAS_DB) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });

  // Create tables if missing
  (async () => {
    try {
      await pool.query(`
        create table if not exists tokens (
          user_id      text primary key,
          username     text not null,
          access_token text not null,
          refresh_token text,
          expires_at   bigint,
          scope        text
        );
        create table if not exists reply_ledger (
          key         text primary key,
          created_at  bigint not null
        );
        create table if not exists personas (
          username     text primary key,
          summary_json jsonb not null,
          updated_at   bigint not null
        );
      `);
      console.log('[db] tables ready');
    } catch (e) {
      console.error('[db:init] failed', e);
    }
  })();
}

// In-memory caches so existing sync call-sites keep working.
const tokenCache = new Map();   // user_id -> token row
const personaCache = new Map(); // username -> { summary, updated_at }
const memLedger = new Set();    // idempotency for dev/no-DB

// ---------- Helpers ----------
function idempotencyKey(tweetId, text) {
  const hash = crypto
    .createHash('sha256')
    .update(String(text || '').trim())
    .digest('hex');
  return `reply:${tweetId}:${hash}`;
}

// ---------- Idempotency ----------
async function putIdempotency(key) {
  if (!HAS_DB) {
    if (memLedger.has(key)) return false;
    memLedger.add(key);
    return true;
  }
  try {
    await pool.query(
      'insert into reply_ledger(key, created_at) values ($1,$2)',
      [key, Date.now()]
    );
    return true;
  } catch (e) {
    // duplicate primary key -> already used
    return false;
  }
}

// ---------- Tokens ----------
function getToken(user_id) {
  // Sync return to match existing call-sites.
  // After login/saveToken, cache will have the fresh row.
  return tokenCache.get(user_id) || null;
}

async function saveToken(row) {
  // Row shape expected:
  // { user_id, username, access_token, refresh_token?, expires_at?, scope? }
  tokenCache.set(row.user_id, row);

  if (!HAS_DB) return;

  await pool.query(
    `
    insert into tokens (user_id, username, access_token, refresh_token, expires_at, scope)
    values ($1,$2,$3,$4,$5,$6)
    on conflict (user_id) do update set
      username     = excluded.username,
      access_token = excluded.access_token,
      refresh_token= excluded.refresh_token,
      expires_at   = excluded.expires_at,
      scope        = excluded.scope
    `,
    [
      row.user_id,
      row.username,
      row.access_token,
      row.refresh_token || null,
      row.expires_at || null,
      row.scope || null
    ]
  );
}

// ---------- Personas ----------
async function savePersona(username, summary_json) {
  const now = Date.now();
  personaCache.set(username, { summary: summary_json, updated_at: now });

  if (!HAS_DB) return;

  await pool.query(
    `
    insert into personas (username, summary_json, updated_at)
    values ($1,$2,$3)
    on conflict (username) do update set
      summary_json = excluded.summary_json,
      updated_at   = excluded.updated_at
    `,
    [username, JSON.stringify(summary_json), now]
  );
}

function getPersona(username) {
  const hit = personaCache.get(username);
  return hit ? hit.summary : null;
}

function getPersonaMeta(username) {
  const hit = personaCache.get(username);
  return hit ? { summary: hit.summary, updated_at: hit.updated_at } : null;
}

module.exports = {
  // tokens
  getToken,
  saveToken,
  // persona
  savePersona,
  getPersona,
  getPersonaMeta,
  // idempotency
  idempotencyKey,
  putIdempotency
};
