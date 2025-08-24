const { Router } = require('express');
const { TwitterApi } = require('twitter-api-v2');
const { CONFIG } = require('../config');
const { getToken, saveToken } = require('../db');
const { readLimiter, withBreaker } = require('../utils/limiter');

const router = Router();

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

router.get('/resolve', async (req, res, next) => {
  try {
    const username = String(req.query.username || '').replace(/^@/, '');
    const client = await getClient(req);
    const fn = withBreaker(async () => client.v2.userByUsername(username));
    const data = await readLimiter.schedule(() => fn());
    res.json({ ok: true, data: data.data });
  } catch (e) { next(e); }
});

router.get('/latest', async (req, res, next) => {
  try {
    const username = String(req.query.username || '').replace(/^@/, '');
    const client = await getClient(req);
    const user = await readLimiter.schedule(() => client.v2.userByUsername(username));
    const tl = await readLimiter.schedule(() => client.v2.userTimeline(user.data.id, { max_results: 5, exclude: ['retweets'] }));
    const latest = tl.tweets?.[0] || null;
    res.json({ ok: true, latest });
  } catch (e) { next(e); }
});

router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '');
    const client = await getClient(req);
    const data = await readLimiter.schedule(() => client.v2.search(q, { max_results: 10 }));
    res.json({ ok: true, data: data.tweets || [] });
  } catch (e) { next(e); }
});

module.exports = router;
