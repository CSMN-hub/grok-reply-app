// Tracks X "user 24h write" headers and blocks further posts until reset.
let writeLockedUntilMs = 0; // epoch ms
let last = { remaining: null, limit: null, resetEpoch: null, updatedAt: 0 };

function _lower(h) { 
  const o = Object.create(null);
  for (const k in (h||{})) o[k.toLowerCase()] = h[k];
  return o;
}

function updateFromHeaders(h) {
  const L = _lower(h);
  const rem   = parseInt(L['x-user-limit-24hour-remaining'] || '', 10);
  const lim   = parseInt(L['x-user-limit-24hour-limit'] || '', 10);
  const reset = parseInt(L['x-user-limit-24hour-reset'] || '', 10); // seconds

  let changed = false;
  if (!Number.isNaN(rem))   { last.remaining   = rem;   changed = true; }
  if (!Number.isNaN(lim))   { last.limit       = lim;   changed = true; }
  if (!Number.isNaN(reset)) { last.resetEpoch  = reset; changed = true; }

  if (changed) {
    last.updatedAt = Date.now();
    if (last.resetEpoch) {
      const ms = last.resetEpoch * 1000;
      writeLockedUntilMs = Math.max(writeLockedUntilMs, ms);
    }
  }
}

function getStatus() {
  return {
    remaining: last.remaining,
    limit: last.limit,
    reset_epoch: last.resetEpoch,
    locked_until_ms: writeLockedUntilMs,
    updated_at: last.updatedAt
  };
}

function getLockUntil() { return writeLockedUntilMs; }
function setLockUntil(ms) { if (ms) writeLockedUntilMs = Math.max(writeLockedUntilMs, ms); }

module.exports = { updateFromHeaders, getStatus, getLockUntil, setLockUntil };
