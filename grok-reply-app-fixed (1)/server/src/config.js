// Make dotenv optional in production
try { require('dotenv').config(); } catch (_) {}


const CONFIG = {
  PORT: parseInt(process.env.PORT || '8080', 10),
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev',
  WEB_ORIGIN: process.env.WEB_ORIGIN || 'http://localhost:8080',
  // X OAuth
  X_CLIENT_ID: process.env.X_CLIENT_ID || '',
  X_CLIENT_SECRET: process.env.X_CLIENT_SECRET || '',
  X_REDIRECT_URI: process.env.X_REDIRECT_URI || '',
  X_SCOPES: (process.env.X_SCOPES || 'tweet.read users.read tweet.write offline.access').split(' '),
  // xAI (Grok)
  XAI_API_KEY: process.env.XAI_API_KEY || '',
  XAI_BASE_URL: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
  XAI_MODEL: process.env.XAI_MODEL || 'grok-4-0709',
  XAI_TOKEN_BUDGET_DAILY: parseInt(process.env.XAI_TOKEN_BUDGET_DAILY || '1000000', 10),
  // Rate knobs
  RATE_WINDOW_MS: parseInt(process.env.RATE_WINDOW_MS || '900000', 10),
  POSTS_PER_WINDOW: parseInt(process.env.POSTS_PER_WINDOW || '45', 10),
  READS_PER_WINDOW: parseInt(process.env.READS_PER_WINDOW || '180', 10)
};

Object.entries(CONFIG).forEach(([k, v]) => {
  if (v === undefined || v === null || v === '') {
    // Allow empty DB/envs for local, but warn
  }
});

module.exports = { CONFIG };
