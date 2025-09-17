import { useEffect, useState, useRef } from 'react';
import { fetchKpiHistory, openAppStream } from '../services/kpiService';

export default function useLiveKpis(range = '15m') {
  const [history, setHistory] = useState({});
  const [latest, setLatest] = useState(null);
  const unsubRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const hist = await fetchKpiHistory(range);
        if (mounted) setHistory(hist);
      } catch {}
      unsubRef.current = openAppStream((msg) => {
        if (msg.type === 'kpi_snapshot') setLatest(msg.data);
        if (msg.type === 'settings_changed') {
          // Optionally trigger a refresh of current settings in UI
        }
      });
    })();
    return () => { mounted = false; unsubRef.current?.(); };
  }, [range]);

  return { history, latest };
}