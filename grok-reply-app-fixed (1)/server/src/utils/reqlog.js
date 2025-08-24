let seq = 0;
const ON = process.env.LOG_CALLS === 'true';
function log(kind, meta = {}) { if (!ON) return 0; const id = ++seq; console.log(`[CALL ${id}] ${kind} ${JSON.stringify(meta)}`); return id; }
function done(id, status, extra = {}) { if (!ON || !id) return; console.log(`[DONE ${id}] ${status} ${JSON.stringify(extra)}`); }
module.exports = { log, done };
