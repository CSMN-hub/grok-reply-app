const Bottleneck = require('bottleneck');

const READS_PER_WINDOW = parseInt(process.env.READS_PER_WINDOW || '5', 10);
const RATE_WINDOW_MS  = parseInt(process.env.RATE_WINDOW_MS  || '900000', 10);
const MIN_TIME_MS     = parseInt(process.env.MIN_TIME_MS     || '1200', 10);

const POSTS_PER_WINDOW = parseInt(process.env.POSTS_PER_WINDOW || '45', 10);
const POSTS_WINDOW_MS  = parseInt(process.env.POSTS_WINDOW_MS  || '900000', 10);

const readLimiter = new Bottleneck({
  reservoir: READS_PER_WINDOW,
  reservoirRefreshInterval: RATE_WINDOW_MS,
  reservoirRefreshAmount: READS_PER_WINDOW,
  minTime: MIN_TIME_MS,
  maxConcurrent: 1,
});

const writeLimiter = new Bottleneck({
  reservoir: POSTS_PER_WINDOW,
  reservoirRefreshInterval: POSTS_WINDOW_MS,
  reservoirRefreshAmount: POSTS_PER_WINDOW,
  minTime: 500,
  maxConcurrent: 1,
});

// Read rate limit tracking
let readLockedUntilMs = 0; // epoch ms

function getReadLockUntil() { return readLockedUntilMs; }
function setReadLockUntil(ms) { if (ms) readLockedUntilMs = Math.max(readLockedUntilMs, ms); }

module.exports = { readLimiter, writeLimiter, getReadLockUntil, setReadLockUntil };
