const { Router } = require('express');
const { TwitterApi } = require('twitter-api-v2');
const { CONFIG } = require('../config');
const { getToken, saveToken } = require('../db');
const { readLimiter, withBreaker } = require('../utils/limiter');
const { TTLCache } = require('../utils/cache');
const { setReadLockUntil, getReadLockUntil } = require('../utils/gate');

const router = Router();

// ---------- tiny helpers ----------
const cache = new TTLCache(120000, 2000); // 2 min TTL, up to 2k keys
const inflight = new Map();               // coalesce duplicate requests

function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function parseReset(headers) {
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
  const epoch = parseInt(h['x-rate-limit-reset'] || '', 10);
  return Number.isFinite(epoch) ? epoch * 1000 : null;
}

// ---------- existing getClient with refresh ----------
async function getClient(req) {
  const user_id = req.session?.user_id;
  if (!user_id) throw new Error('NotAuthenticated');
  let t = getToken(user_id);
  if (!t) throw new Error('NoToken');

  if (Date.now() > (t.expires_at || 0)) {
    const tmp = new TwitterApi({ clientId: CONFIG.X_CLIENT_ID, clientSecret: CONFIG.X_CLIENT_SECRET });
    const refreshed = await tmp.refreshOAuth2Token(t.refresh_token);
    const { accessToken, refreshToken, expiresIn } = refreshed;
    t = {
      user_id,
      username: t.username,
      access_token: accessToken,
      refresh_token: refreshToken || t.refresh_token,
      expires_at: Date.now() + (expiresIn * 1000),
      scope: t.scope
    };
    saveToken(t);
  }
  return new TwitterApi(t.access_token);
}

// ---------- routes ----------

// Resolve @username -> user object (read-lock aware)
router.get('/resolve', async (req, res, next) => {
  try {
    const username = String(req.query.username || '').replace(/^@/, '');
    if (!username) return res.status(400).json({ ok: false, error: 'username required' });

    // If reads are locked, short-circuit
    if (Date.now() < getReadLockUntil()) {
      return res.status(429).json({ ok: false, rate_limited: true, scope: 'read', reset_ms: getReadLockUntil() });
    }

    const key = `resolve:@${username}`;
    const hit = cache.get(key);
    if (hit) return res.json({ ok: true, data: hit });

    const client = await getClient(req);
    const run = async () => {
      const data = await client.v2.userByUsername(username);
      cache.set(key, data.data);
      return data.data;
    };

    const data = await readLimiter.schedule(() => once(key, () => withBreaker(run)()));
    res.json({ ok: true, data });
  } catch (e) {
    const resetMs = parseReset(e?.response?.headers);
    if ((e?.response?.status === 429) && resetMs) {
      setReadLockUntil(resetMs + 1000);
      return res.status(429).json({ ok: false, rate_limited: true, scope: 'read', reset_ms: resetMs + 1000 });
    }
    next(e);
  }
});

// Get latest tweet for @username (cache + read-lock aware)
router.get('/latest', async (req, res, next) => {
  try {
    const username = String(req.query.username || '').replace(/^@/, '');
    if (!username) return res.status(400).json({ ok: false, error: 'username required' });

    if (Date.now() < getReadLockUntil()) {
      return res.status(429).json({ ok: false, rate_limited: true, scope: 'read', reset_ms: getReadLockUntil() });
    }

    const key = `latest:@${username}`;
    const hit = cache.get(key);
    if (hit) return res.json({ ok: true, latest: hit });

    const client = await getClient(req);

    const run = async () => {
      const user = await client.v2.userByUsername(username);
      // exclude both retweets & replies (you had only retweets)
      const tl = await client.v2.userTimeline(user.data.id, { max_results: 5, exclude: ['retweets', 'replies'] });
      const latest = tl.tweets?.[0] || null;
      cache.set(key, latest);
      return latest;
    };

    const latest = await readLimiter.schedule(() => once(key, () => withBreaker(run)()));
    res.json({ ok: true, latest });
  } catch (e) {
    const resetMs = parseReset(e?.response?.headers);
    if ((e?.response?.status === 429) && resetMs) {
      setReadLockUntil(resetMs + 1000);
      return res.status(429).json({ ok: false, rate_limited: true, scope: 'read', reset_ms: resetMs + 1000 });
    }
    next(e);
  }
});

// Search #tag (cache + read-lock aware). We keep just the first result to minimize calls.
router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '');
    if (!q || !q.startsWith('#')) return res.status(400).json({ ok: false, error: 'q must be a #tag' });

    if (Date.now() < getReadLockUntil()) {
      return res.status(429).json({ ok: false, rate_limited: true, scope: 'read', reset_ms: getReadLockUntil() });
    }

    const key = `search:${q}`;
    const hit = cache.get(key);
    if (hit) return res.json({ ok: true, data: hit });

    const client = await getClient(req);
    const run = async () => {
      const r = await client.v2.search(q, { max_results: 10 });
      const list = Array.isArray(r.tweets) ? r.tweets.slice(0, 1) : []; // only first to be safe
      cache.set(key, list);
      return list;
    };

    const data = await readLimiter.schedule(() => once(key, () => withBreaker(run)()));
    res.json({ ok: true, data });
  } catch (e) {
    const resetMs = parseReset(e?.response?.headers);
    if ((e?.response?.status === 429) && resetMs) {
      setReadLockUntil(resetMs + 1000);
      return res.status(429).json({ ok: false, rate_limited: true, scope: 'read', reset_ms: resetMs + 1000 });
    }
    next(e);
  }
});

module.exports = router;
