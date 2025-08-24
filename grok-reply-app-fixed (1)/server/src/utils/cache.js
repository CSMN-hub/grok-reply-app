class TTLCache {
  constructor(ttlMs = 120000, max = 1000) {
    this.ttl = ttlMs; this.max = max; this.map = new Map();
  }
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) { this.map.delete(key); return null; }
    return hit.value;
  }
  set(key, value) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { value, expires: Date.now() + this.ttl });
  }
}
module.exports = { TTLCache };
