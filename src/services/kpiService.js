export async function fetchKpiHistory(range = '15m') {
  const base = process.env.REACT_APP_API_URL || 'http://localhost:5001';
  const token = localStorage.getItem('token');
  const res = await fetch(`${base}/api/kpi/history?range=${encodeURIComponent(range)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) throw new Error('Failed to fetch KPI history');
  return res.json();
}

export function openAppStream(onMessage, onError) {
  const base = process.env.REACT_APP_API_URL || 'http://localhost:5001';
  const es = new EventSource(`${base}/api/stream`);
  es.onmessage = (evt) => {
    try {
      const payload = JSON.parse(evt.data);
      onMessage?.(payload);
    } catch {}
  };
  es.onerror = (e) => { onError?.(e); es.close(); };
  return () => es.close();
}