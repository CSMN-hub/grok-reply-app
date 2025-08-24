const Bottleneck = require('bottleneck');
const CircuitBreaker = require('opossum');
const { CONFIG } = require('../config');

const readLimiter = new Bottleneck({
  reservoir: CONFIG.READS_PER_WINDOW,
  reservoirRefreshInterval: CONFIG.RATE_WINDOW_MS,
  reservoirRefreshAmount: CONFIG.READS_PER_WINDOW,
  maxConcurrent: 4,
  minTime: 100
});

const writeLimiter = new Bottleneck({
  reservoir: CONFIG.POSTS_PER_WINDOW,
  reservoirRefreshInterval: CONFIG.RATE_WINDOW_MS,
  reservoirRefreshAmount: CONFIG.POSTS_PER_WINDOW,
  maxConcurrent: 2,
  minTime: 250
});

function withBreaker(fn) {
  const breaker = new CircuitBreaker(fn, { timeout: 15000, errorThresholdPercentage: 50, resetTimeout: 10000 });
  return breaker.fire.bind(breaker);
}

module.exports = { readLimiter, writeLimiter, withBreaker };
