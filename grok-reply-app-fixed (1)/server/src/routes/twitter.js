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

// Resolve @username -> user object (read-lock aware + cache)
router.get('/resolve', async (req, res, next) => {
  try {
    const username = String(req.query.username || '').replace(/^@/, '');
    if (!username) return res.status(400).json({ ok: false, error: 'username required' });

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
    if (e?.message === 'NotAuthenticated') {
      return res.status(401).json({ ok:false, error:'NotAuthenticated' });
    }
    next(e);
  }
});

// Get latest tweet for @username with cascade (orig → +replies → anything)
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

    const fetchLatest = async (userId) => {
      const attempt = async (opts) => {
        const tl = await client.v2.userTimeline(userId, opts);
        return tl.tweets?.[0] || (Array.isArray(tl.data) ? tl.data[0] : null) || null;
      };

      // 1) Only originals (no RTs, no replies)
      let latest = await attempt({ max_results: 5, exclude: ['retweets', 'replies'] });
      if (latest) return latest;

      // 2) Originals + replies (no RTs)
      latest = await attempt({ max_results: 5, exclude: ['retweets'] });
      if (latest) return latest;

      // 3) Anything (last resort)
      latest = await attempt({ max_results: 5 });
      return latest;
    };

    const user = await readLimiter.schedule(() => client.v2.userByUsername(username));
    const latest = await readLimiter.schedule(() => once(key, () => withBreaker(() => fetchLatest(user.data.id))()));
    cache.set(key, latest);
    res.json({ ok: true, latest });
  } catch (e) {
    const resetMs = parseReset(e?.response?.headers);
    if ((e?.response?.status === 429) && resetMs) {
      setReadLockUntil(resetMs + 1000);
      return res.status(429).json({ ok: false, rate_limited: true, scope: 'read', reset_ms: resetMs + 1000 });
    }
    if (e?.message === 'NotAuthenticated') {
      return res.status(401).json({ ok:false, error:'NotAuthenticated' });
    }
    next(e);
  }
});

// Search #tag (cache + read-lock aware). Return 1 safe result to minimize reads.
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
      // twitter-api-v2 may expose results under .tweets or .data depending on version
      const list = Array.isArray(r.tweets) ? r.tweets.slice(0, 1)
                 : Array.isArray(r.data)   ? r.data.slice(0, 1)
                 : [];
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
    if (e?.message === 'NotAuthenticated') {
      return res.status(401).json({ ok:false, error:'NotAuthenticated' });
    }
    next(e);
  }
});

module.exports = router;
