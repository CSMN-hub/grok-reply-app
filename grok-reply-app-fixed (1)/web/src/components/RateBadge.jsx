import * as React from 'react';

export default function RateBadge(props) {
  const { resetIso, lockedUntilMs } = props;
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!lockedUntilMs || now >= lockedUntilMs) return null;

  const ms = Math.max(0, lockedUntilMs - now);
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / (1000 * 60)) % 60;
  const h = Math.floor(ms / (1000 * 60 * 60));

  return (
    <div style={{
      background: '#fff4e5',
      border: '1px solid #f0c36d',
      color: '#8a6d3b',
      padding: 8,
      borderRadius: 8,
      marginBottom: 12
    }}>
      <strong>Posting temporarily blocked by X</strong>
      <div>
        Resets in <b>{h}h {m}m {s}s</b>
        {resetIso ? ` (at ${new Date(resetIso).toLocaleString()})` : ''}
      </div>
    </div>
  );
}