export async function getWriteStatus() {
  const r = await fetch('/debug/writes', { credentials: 'include' });
  if (!r.ok) throw new Error('Failed to read write status');
  return r.json();
}