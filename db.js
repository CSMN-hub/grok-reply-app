const Database = require('better-sqlite3');
const db = new Database('data.sqlite');

db.exec(`
CREATE TABLE IF NOT EXISTS tokens (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  scope TEXT
);
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS personas (
  username TEXT PRIMARY KEY,
  summary_json TEXT,
  updated_at INTEGER
);
`);

function saveToken(row) {
  const stmt = db.prepare(`INSERT INTO tokens (user_id, username, access_token, refresh_token, expires_at, scope)
  VALUES (@user_id,@username,@access_token,@refresh_token,@expires_at,@scope)
  ON CONFLICT(user_id) DO UPDATE SET
    username=excluded.username,
    access_token=excluded.access_token,
    refresh_token=excluded.refresh_token,
    expires_at=excluded.expires_at,
    scope=excluded.scope`);
  stmt.run(row);
}

function getToken(user_id) {
  return db.prepare(`SELECT * FROM tokens WHERE user_id = ?`).get(user_id);
}

function idempotencyKey(tweetId, text) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(String(text || '').trim()).digest('hex');
  return `reply:${tweetId}:${hash}`;
}

function putIdempotency(key) {
  try {
    db.prepare(`INSERT INTO idempotency (key, created_at) VALUES (?, ?)`).run(key, Date.now());
    return true;
  } catch {
    return false;
  }
}

function savePersona(username, summary_json) {
  db.prepare(`INSERT INTO personas (username, summary_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET summary_json=excluded.summary_json, updated_at=excluded.updated_at`
  ).run(username, JSON.stringify(summary_json), Date.now());
}

function getPersona(username) {
  const row = db.prepare(`SELECT summary_json FROM personas WHERE username = ?`).get(username);
  return row ? JSON.parse(row.summary_json) : null;
}

function getPersonaMeta(username) {
  const row = db.prepare(`SELECT summary_json, updated_at FROM personas WHERE username = ?`).get(username);
  if (!row) return null;
  return { summary: JSON.parse(row.summary_json), updated_at: row.updated_at };
}

module.exports = { db, saveToken, getToken, idempotencyKey, putIdempotency, savePersona, getPersona, getPersonaMeta };
