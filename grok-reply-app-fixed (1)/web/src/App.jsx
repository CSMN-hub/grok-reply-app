import React from 'react'
import RateBadge from './components/RateBadge'
import { getWriteStatus } from './api'

function api(path, opts={}) {
  return fetch(path, { credentials: 'include', ...opts }).then(r => r.json())
}

export default function App() {
  const [auth, setAuth] = React.useState({ ok: false })
  const [entries, setEntries] = React.useState([])
  const [tweets, setTweets] = React.useState({})
  const [selected, setSelected] = React.useState(null)
  const [persona, setPersona] = React.useState(null)
  const [n, setN] = React.useState(3)
  const [temp, setTemp] = React.useState(0.7)
  const [options, setOptions] = React.useState([])
  const [loading, setLoading] = React.useState(false)
  const [writeStatus, setWriteStatus] = React.useState(null)

  React.useEffect(() => { api('/auth/me').then(setAuth) }, [])

  React.useEffect(() => {
    let stop = false;
    async function tick() {
      try { const s = await getWriteStatus(); if (!stop) setWriteStatus(s); } catch {}
    }
    tick();
    const id = setInterval(tick, 30000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  async function load(list) {
    const out = {}
    for (const e of list) {
      try {
        if (e.startsWith('#')) {
          const r = await api('/api/twitter/search?q=' + encodeURIComponent(e))
          out[e] = (r.data && r.data[0]) ? { id: r.data[0].id, text: r.data[0].text } : null
        } else {
          const r = await api('/api/twitter/latest?username=' + encodeURIComponent(e))
          out[e] = r.latest || null
        }
      } catch (err) {
        console.error('load failed for', e, err)
      }
    }
    setTweets(out)
  }

  async function ensurePersona(handle) {
    const uname = handle.replace(/^@/, '')
    const got = await api('/api/persona/' + encodeURIComponent(uname))
    if (got?.persona) { setPersona(got.persona); return }
    const built = await api('/api/persona/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: handle })
    })
    if (built?.persona) setPersona(built.persona)
  }

  async function doGenerate() {
    if (!selected) return
    const t = tweets[selected]
    if (!t) return
    setLoading(true)
    try {
      const r = await api('/api/replies/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tweet_text: t.text, persona, n, temperature: temp })
      })
      if (r.ok) setOptions(r.options || [])
      else alert(r.error || 'Generate failed')
    } finally { setLoading(false) }
  }

  async function doPost(text) {
    if (!selected) return
    const t = tweets[selected]
    const r = await api('/api/replies/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ in_reply_to_tweet_id: t.id, text })
    })
    if (r.ok) alert('Posted (or deduped).')
    else alert(r.error || 'Post failed')
  }

  if (!auth.ok) {
    return (
      <div style={{ maxWidth: 900, margin: '40px auto', fontFamily: 'system-ui' }}>
        <h1>Grok Reply App</h1>
        <p>Connect your X account to begin.</p>
        <a href="/auth/login"><button>Connect X</button></a>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '20px auto', fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <span>Logged in as @{auth.username}</span>
        <button onClick={async () => { await api('/auth/logout', { method: 'POST' }); location.reload() }}>Logout</button>
      </div>

      {writeStatus && (
        <RateBadge resetIso={writeStatus.reset_iso} lockedUntilMs={writeStatus.locked_until_ms} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 16 }}>
        <div>
          <h2>Import</h2>
          <textarea rows={10} style={{ width: '100%' }} placeholder="@handle or #tag (one per line)"
            onChange={e => setEntries(e.target.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0,50))} />
          <div style={{ marginTop: 8 }}>
            <button onClick={() => load(entries)}>Load</button>
          </div>
          <div style={{ marginTop: 16 }}>
            <h3>Entries</h3>
            <ul>
              {entries.map(e => (
                <li key={e} style={{ cursor: 'pointer', color: selected===e ? '#222' : '#06f' }}
                  onClick={() => { setSelected(e); setOptions([]); setPersona(null); }}>
                  {e}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          <h2>Latest Posts</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {entries.map(e => (
              <div key={e} style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
                <div style={{ fontWeight: 600 }}>{e}</div>
                <div style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{tweets[e]?.text || 'No result yet.'}</div>
                <div style={{ marginTop: 8 }}>
                  <button onClick={async () => { setSelected(e); await ensurePersona(e); await doGenerate(); }} disabled={loading}>
                    {loading && selected===e ? 'Generating…' : 'Generate Replies'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2>Generator</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label>Options: {n}</label>
            <input type="range" min={1} max={6} value={n} onChange={e => setN(parseInt(e.target.value))} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label>Variability: {temp.toFixed(2)}</label>
            <input type="range" min={0} max={1} step={0.05} value={temp} onChange={e => setTemp(parseFloat(e.target.value))} />
          </div>
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {options.map((opt, i) => (
              <div key={i} style={{ border: '1px solid #ddd', padding: 8, borderRadius: 8 }}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{opt}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button onClick={() => navigator.clipboard.writeText(opt)}>Copy</button>
                  <button
                    disabled={!!(writeStatus && writeStatus.locked_until_ms && Date.now() < writeStatus.locked_until_ms)}
                    title={writeStatus && writeStatus.locked_until_ms && Date.now() < writeStatus.locked_until_ms
                      ? 'Posting is temporarily blocked by X.' : 'Post Reply'}
                    onClick={() => doPost(opt)}
                  >
                    Post Reply
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
