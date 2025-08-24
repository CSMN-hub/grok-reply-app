const { Router } = require('express');
const { TwitterApi } = require('twitter-api-v2');
const { CONFIG } = require('../config');
const { saveToken } = require('../db');

const router = Router();

router.get('/login', async (req, res, next) => {
  try {
    const client = new TwitterApi({ clientId: CONFIG.X_CLIENT_ID, clientSecret: CONFIG.X_CLIENT_SECRET });
    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(CONFIG.X_REDIRECT_URI, { scope: CONFIG.X_SCOPES });
    req.session.oauth = { state, codeVerifier };
    res.redirect(url);
  } catch (e) { next(e); }
});

router.get('/x/callback', async (req, res, next) => {
  try {
    const { state, code } = req.query;
    const stored = req.session.oauth;
    if (!stored?.state || !stored?.codeVerifier || state !== stored.state) {
      return res.status(400).send('Invalid state/verifier. Start over.');
    }
    const client = new TwitterApi({ clientId: CONFIG.X_CLIENT_ID, clientSecret: CONFIG.X_CLIENT_SECRET });
    const { client: logged, accessToken, refreshToken, expiresIn } = await client.loginWithOAuth2({
      code: code.toString(), codeVerifier: stored.codeVerifier, redirectUri: CONFIG.X_REDIRECT_URI
    });
    const me = await logged.v2.me();
    const user_id = me.data.id;
    const username = me.data.username;
    const expires_at = Date.now() + (expiresIn * 1000);
    saveToken({ user_id, username, access_token: accessToken, refresh_token: refreshToken, expires_at, scope: CONFIG.X_SCOPES.join(' ') });
    req.session.user_id = user_id;
    req.session.username = username;
    res.redirect('/');
  } catch (e) { next(e); }
});

router.get('/me', (req, res) => {
  if (req.session?.user_id) return res.json({ ok: true, user_id: req.session.user_id, username: req.session.username });
  res.json({ ok: false });
});

router.post('/logout', (req, res) => {
  req.session?.destroy(() => {});
  res.json({ ok: true });
});

module.exports = router;
