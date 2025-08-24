const { Router } = require('express');
const axios = require('axios');
const { TwitterApi } = require('twitter-api-v2');
const { CONFIG } = require('../config');
const { getToken, saveToken, idempotencyKey, putIdempotency } = require('../db');
const { writeLimiter, withBreaker } = require('../utils/limiter');
const { updateFromHeaders, getStatus, getLockUntil, setLockUntil } = require('../utils/writeGate');

const router = Router();

// --------- helper: getClient with refresh ----------
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

// --------- GENERATE (unchanged logic, with JSON guard) ----------
router.post('/generate', async (req, res, next) => {
  try {
    const { tweet_text, persona, n = 3, temperature = 0.7 } = req.body || {};
    if (!tweet_text || !tweet_text.trim()) {
      return res.status(400).json({ ok: false, error: 'tweet_text required' });
    }
    const sys = `You are an expert at drafting concise, context-aware, engaging X replies under 240 characters. Use advanced reasoning to align with the original post's intent and provided tone guidance. Avoid spam or repetitive phrasing.`;
    const personaText = persona ? `Tone/Style Guidance: ${JSON.stringify(persona)}` : '';

    const approximateTokens =
      (tweet_text?.length || 0) +
      (persona ? JSON.stringify(persona).length : 0) +
      1000;
    if (approximateTokens > CONFIG.XAI_TOKEN_BUDGET_DAILY) {
      return res.status(429).json({ ok: false, error: 'Daily token budget exceeded' });
    }

    const response = await axios.post(
      `${CONFIG.XAI_BASE_URL}/chat/completions`,
      {
        model: CONFIG.XAI_MODEL,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `${personaText}\n\nOriginal Post:\n${tweet_text}\n\nDraft ${n} distinct reply options as JSON: {"options":["..."]}` }
        ],
        temperature,
        response_format: { type: 'json_object' }
      },
      { headers: { Authorization: `Bearer ${CONFIG.XAI_API_KEY}` } }
    );

    const content = response.data?.choices?.[0]?.message?.content || '{}';
    let options = [];
    try {
      const parsed = JSON.parse(content);
      options = Array.isArray(parsed.options) ? parsed.options : [];
    } catch {
      return res.status(502).json({ ok: false, error: 'Invalid JSON from xAI' });
    }
    res.json({ ok: true, options });
  } catch (e) { next(e); }
});

// --------- POST (write-gated, idempotent, friendly 429) ----------
router.post('/post', async (req, res, next) => {
  try {
    const { in_reply_to_tweet_id, text } = req.body || {};
    if (!in_reply_to_tweet_id || !text || !text.trim()) {
      return res.status(400).json({ ok:false, error:'in_reply_to_tweet_id and text required' });
    }

    // If we previously saw a 24h write cap, short-circuit until reset passes
    const status = getStatus();
    if (Date.now() < (status.locked_until_ms || 0)) {
      return res.status(429).json({
        ok:false, rate_limited:true, scope:'user-24h',
        remaining: status.remaining ?? null,
        reset_epoch: status.reset_epoch ?? null,
        reset_iso: status.reset_epoch ? new Date(status.reset_epoch*1000).toISOString() : null,
        message: 'Daily posting limit currently blocked (cached).'
      });
    }

    // Idempotency: avoid duplicate posts for the same reply text
    const key = idempotencyKey(in_reply_to_tweet_id, text);
    const accepted = await putIdempotency(key); // IMPORTANT: await
    if (!accepted) return res.json({ ok: true, deduped: true });

    const client = await getClient(req);

    const doPost = async () => {
      // twitter-api-v2 reply helper; equivalent to client.v2.tweet({ text, reply: { in_reply_to_tweet_id } })
      return client.v2.reply(text.trim(), in_reply_to_tweet_id);
    };

    // Use your write limiter + breaker if present
    const result = await writeLimiter.schedule(() => withBreaker(doPost)());

    // On success, try to record any headers (usually none, but safe)
    if (result?._headers) updateFromHeaders(result._headers);

    return res.json({ ok: true });
  } catch (e) {
    // Capture X headers (the important x-user-limit-24hour-*), then lock until reset
    const hdrs = e?.response?.headers || e?.headers;
    if (hdrs) {
      updateFromHeaders(hdrs);
      const s = getStatus();
      if (s.reset_epoch) setLockUntil(s.reset_epoch * 1000);
    }

    // Friendly 429 with reset time for the UI
    if (e?.response?.status === 429) {
      const s = getStatus();
      return res.status(429).json({
        ok:false, rate_limited:true, scope:'user-24h',
        remaining: s.remaining ?? null,
        reset_epoch: s.reset_epoch ?? null,
        reset_iso: s.reset_epoch ? new Date(s.reset_epoch*1000).toISOString() : null,
        message: 'Daily posting limit reached on X for this account.'
      });
    }
    next(e);
  }
});

module.exports = router;
