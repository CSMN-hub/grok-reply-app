const { Router } = require('express');
const axios = require('axios');
const { TwitterApi } = require('twitter-api-v2');
const { CONFIG } = require('../config');
const { getToken, saveToken, savePersona, getPersonaMeta } = require('../db');
const { readLimiter } = require('../utils/limiter');

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

router.get('/:username', async (req, res, next) => {
  try {
    const username = String(req.params.username || '').replace(/^@/, '');
    const ttlMs = 1000 * 60 * 60 * 24 * 7; // 7 days
    const meta = getPersonaMeta(username);
    if (!meta) return res.json({ ok: true, persona: null });
    if (Date.now() - meta.updated_at > ttlMs) return res.json({ ok: true, persona: null });
    res.json({ ok: true, persona: meta.summary });
  } catch (e) { next(e); }
});

router.post('/build', async (req, res, next) => {
  try {
    const { username } = req.body || {};
    const uname = String(username || '').replace(/^@/, '');
    const client = await getClient(req);
    const user = await readLimiter.schedule(() => client.v2.userByUsername(uname));
    const tl = await readLimiter.schedule(() => client.v2.userTimeline(user.data.id, { max_results: 15, exclude: ['retweets'] }));
    const texts = (tl.tweets || []).map(t => t.text).join('\n---\n');

    const approximateTokens = texts.length + 1000;
    if (approximateTokens > CONFIG.XAI_TOKEN_BUDGET_DAILY) {
      return res.status(429).json({ ok: false, error: 'Daily token budget exceeded' });
    }

    const sys = `You analyze an author's recent posts to create a compact JSON persona summary for reply drafting. Focus on tone, style, key topics, and phrases to avoid. Use precise reasoning to ensure accuracy and relevance.`;
    const response = await axios.post(
      `${CONFIG.XAI_BASE_URL}/chat/completions`,
      {
        model: CONFIG.XAI_MODEL,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `Summarize the author's persona as JSON with keys tone_keywords, style_rules, common_topics, taboo_phrases. Posts (most recent first):\n${texts}` }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      },
      { headers: { Authorization: `Bearer ${CONFIG.XAI_API_KEY}` } }
    );

    const content = response.data?.choices?.[0]?.message?.content || '{}';
    let parsed = {};
    try { parsed = JSON.parse(content); }
    catch { return res.status(502).json({ ok: false, error: 'Invalid JSON from xAI' }); }
    savePersona(uname, parsed);
    res.json({ ok: true, persona: parsed });
  } catch (e) { next(e); }
});

module.exports = router;
