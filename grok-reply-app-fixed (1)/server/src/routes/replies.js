const { Router } = require('express');
const axios = require('axios');
const { TwitterApi } = require('twitter-api-v2');
const { CONFIG } = require('../config');
const { getToken, saveToken, idempotencyKey, putIdempotency } = require('../db');
const { writeLimiter, withBreaker } = require('../utils/limiter');

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

router.post('/generate', async (req, res, next) => {
  try {
    const { tweet_text, persona, n = 3, temperature = 0.7 } = req.body || {};
    const sys = `You are an expert at drafting concise, context-aware, engaging X replies under 240 characters. Use advanced reasoning to align with the original post's intent and provided tone guidance. Avoid spam or repetitive phrasing.`;
    const personaText = persona ? `Tone/Style Guidance: ${JSON.stringify(persona)}` : '';

    const approximateTokens = (tweet_text?.length || 0) + (persona ? JSON.stringify(persona).length : 0) + 1000;
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

router.post('/post', async (req, res, next) => {
  try {
    const { in_reply_to_tweet_id, text } = req.body || {};
    const key = idempotencyKey(in_reply_to_tweet_id, text);
    if (!putIdempotency(key)) return res.status(200).json({ ok: true, duplicate: true });

    const client = await getClient(req);
    const fn = withBreaker(async () => client.v2.tweet({ text, reply: { in_reply_to_tweet_id } }));
    const result = await writeLimiter.schedule(() => fn());
    res.json({ ok: true, result });
  } catch (e) { next(e); }
});

module.exports = router;
