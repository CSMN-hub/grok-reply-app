const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const client = require('prom-client');
const { CONFIG } = require('./config');
const auth = require('./routes/auth');
const twitter = require('./routes/twitter');
const replies = require('./routes/replies');
const persona = require('./routes/persona');

const app = express();

// Metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register });
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.025,0.05,0.1,0.2,0.5,1,2,5]
});
register.registerMetric(httpDuration);
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
app.use((req, res, next) => {
  const end = httpDuration.startTimer({ method: req.method });
  res.on('finish', () => end({ route: req.path, code: String(res.statusCode) }));
  next();
});

app.use(cors({ origin: CONFIG.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  secret: CONFIG.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

app.use('/auth', auth);
app.use('/api/twitter', twitter);
app.use('/api/replies', replies);
app.use('/api/persona', persona);

// Static SPA
const staticDir = path.join(process.cwd(), 'public');
app.use(express.static(staticDir));
app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));

// Errors
app.use((err, _req, res, _next) => {
  console.error('ERROR', err);
  const msg = err?.message || 'Error';
  const code = msg === 'NotAuthenticated' ? 401 : 500;
  res.status(code).json({ ok: false, error: msg });
});

app.listen(CONFIG.PORT, () => console.log(`Server running on :${CONFIG.PORT}`));
