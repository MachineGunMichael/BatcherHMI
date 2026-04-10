/**
 * React render monitoring utility.
 *
 * Usage in a component:
 *   import { useRenderMonitor } from '../utils/renderMonitor';
 *   useRenderMonitor('Dashboard');
 *
 * Start/stop from the browser console:
 *   window.startRenderMonitor()   — logs every 10s
 *   window.stopRenderMonitor()
 *   window.renderStats()          — snapshot of all counters
 *
 * Heap monitor (separate, runs independently):
 *   window.startHeapMonitor(5000) — log heap every 5s (default)
 *   window.stopHeapMonitor()
 */

import { useRef, useEffect } from 'react';

const counters = {};
let intervalId = null;

function bump(name) {
  if (!counters[name]) counters[name] = { total: 0, window: 0 };
  counters[name].total += 1;
  counters[name].window += 1;
}

function resetWindow() {
  Object.values(counters).forEach(c => { c.window = 0; });
}

function snapshot() {
  const out = {};
  Object.entries(counters).forEach(([name, c]) => {
    out[name] = { total: c.total, 'renders/10s': c.window };
  });
  return out;
}

export function useRenderMonitor(name) {
  const count = useRef(0);
  count.current += 1;
  useEffect(() => { bump(name); });
}

/* ---- Shared page-visibility state ---- */
let _pageVisible = typeof document !== 'undefined' ? !document.hidden : true;
let _visibilityChanges = 0;
let _lastHiddenAt = 0;
let _totalHiddenMs = 0;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const nowVisible = !document.hidden;
    _visibilityChanges++;
    if (!nowVisible) {
      _lastHiddenAt = performance.now();
    } else if (_lastHiddenAt > 0) {
      _totalHiddenMs += performance.now() - _lastHiddenAt;
      _lastHiddenAt = 0;
    }
    _pageVisible = nowVisible;
  });
}

export function isPageVisible() { return _pageVisible; }

/* ---- SSE event counter (bump from SSE handlers) ---- */
let _sseEvents = 0;
let _sseEventsWindow = 0;

export function bumpSseEvent() { _sseEvents++; _sseEventsWindow++; }

if (typeof window !== 'undefined') {
  window.startRenderMonitor = (ms = 10000) => {
    if (intervalId) clearInterval(intervalId);
    resetWindow();
    _sseEventsWindow = 0;
    intervalId = setInterval(() => {
      const s = snapshot();
      const lines = Object.entries(s).map(
        ([n, v]) => `${n}: ${v['renders/10s']} renders / ${ms / 1000}s  (total: ${v.total})`
      );
      lines.push(`SSE events: ${_sseEventsWindow} / ${ms / 1000}s  (total: ${_sseEvents})`);
      console.log(`%c[RenderMonitor]%c\n${lines.join('\n')}`, 'color:#00bcd4;font-weight:bold', '');
      resetWindow();
      _sseEventsWindow = 0;
    }, ms);
    console.log(`[RenderMonitor] Started (interval ${ms}ms). Stop: window.stopRenderMonitor()`);
  };

  window.stopRenderMonitor = () => {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    console.log('[RenderMonitor] Stopped');
  };

  window.renderStats = () => {
    console.table(snapshot());
    return snapshot();
  };

  /* ---- CPU (Main-Thread Busy %) Sampler ---- */
  const CPU_SAMPLE_MS = 200;
  let cpuSampleTimer = null;
  let cpuLastSampleTime = 0;
  let cpuBusyMs = 0;
  let cpuFgTotalMs = 0;     // foreground wall-clock time only
  let cpuBgTotalMs = 0;     // background wall-clock time (jitter measurement invalid)
  let cpuLongTasks = 0;
  let ltObserver = null;

  function startCpuSampler() {
    cpuBusyMs = 0;
    cpuFgTotalMs = 0;
    cpuBgTotalMs = 0;
    cpuLongTasks = 0;
    cpuLastSampleTime = performance.now();

    const tick = () => {
      if (!cpuSampleTimer) return;
      const now = performance.now();
      const elapsed = now - cpuLastSampleTime;
      cpuLastSampleTime = now;

      if (_pageVisible) {
        // Foreground: jitter is a valid proxy for main-thread busy time
        const jitter = Math.max(0, elapsed - CPU_SAMPLE_MS);
        cpuBusyMs += jitter;
        cpuFgTotalMs += elapsed;
      } else {
        // Background: Chrome throttles timers to >=1s; jitter is meaningless
        cpuBgTotalMs += elapsed;
      }
      cpuSampleTimer = setTimeout(tick, CPU_SAMPLE_MS);
    };
    cpuSampleTimer = setTimeout(tick, CPU_SAMPLE_MS);

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        ltObserver = new PerformanceObserver(list => {
          cpuLongTasks += list.getEntries().length;
        });
        ltObserver.observe({ type: 'longtask', buffered: false });
      } catch (_) { /* longtask not supported */ }
    }
  }

  function stopCpuSampler() {
    if (cpuSampleTimer) { clearTimeout(cpuSampleTimer); cpuSampleTimer = null; }
    if (ltObserver) { ltObserver.disconnect(); ltObserver = null; }
  }

  function readAndResetCpu() {
    const pct = cpuFgTotalMs > 0 ? Math.round((cpuBusyMs / cpuFgTotalMs) * 100) : 0;
    const bgPct = (cpuFgTotalMs + cpuBgTotalMs) > 0
      ? Math.round((cpuBgTotalMs / (cpuFgTotalMs + cpuBgTotalMs)) * 100) : 0;
    const lt = cpuLongTasks;
    cpuBusyMs = 0;
    cpuFgTotalMs = 0;
    cpuBgTotalMs = 0;
    cpuLongTasks = 0;
    return { pct, bgPct, longTasks: lt };
  }

  /* ---- Heap Monitor with Leak Detection ---- */
  let heapId = null;
  const heapLog = [];
  const gcBaselines = [];
  const GC_DROP_MIN_MB = 30;
  const GC_DROP_MIN_PERCENT = 0.20;

  window.startHeapMonitor = (ms = 5000) => {
    if (heapId) clearInterval(heapId);
    gcBaselines.length = 0;
    heapLog.length = 0;
    _totalHiddenMs = 0;
    _visibilityChanges = 0;
    stopCpuSampler();
    startCpuSampler();
    let prevHeap = 0;
    let prevDom = 0;
    let peakSinceGC = 0;
    const startTime = Date.now();

    heapId = setInterval(() => {
      const mem = performance.memory || {};
      const heap = Math.round((mem.usedJSHeapSize || 0) / 1048576);
      const total = Math.round((mem.totalJSHeapSize || 0) / 1048576);
      const dom = document.getElementsByTagName('*').length;
      const dHeap = heap - prevHeap;
      const dDom = dom - prevDom;
      const ts = new Date().toLocaleTimeString();
      const now = Date.now();
      const visible = _pageVisible;

      const drop = prevHeap - heap;
      const gcDetected = prevHeap > 0
        && drop >= GC_DROP_MIN_MB
        && drop >= prevHeap * GC_DROP_MIN_PERCENT;
      if (gcDetected) {
        gcBaselines.push({ time: now, heap, peak: peakSinceGC || prevHeap });
        if (gcBaselines.length > 500) gcBaselines.splice(0, gcBaselines.length - 500);
        peakSinceGC = heap;
      }
      if (heap > peakSinceGC) peakSinceGC = heap;

      const lastBaseline = gcBaselines.length > 0 ? gcBaselines[gcBaselines.length - 1].heap : null;
      const retained = lastBaseline ?? heap;
      const garbage = Math.max(0, heap - retained);

      const cpu = readAndResetCpu();

      let leakRateStr = '';
      if (gcBaselines.length >= 2) {
        const oldest = gcBaselines[0];
        const newest = gcBaselines[gcBaselines.length - 1];
        const spanMin = (newest.time - oldest.time) / 60000;
        if (spanMin >= 1) {
          const leakMBperHour = ((newest.heap - oldest.heap) / spanMin) * 60;
          const sign = leakMBperHour >= 0 ? '+' : '';
          leakRateStr = ` | Leak: ${sign}${leakMBperHour.toFixed(1)} MB/hr`;
          if (leakMBperHour > 20) leakRateStr += ' ⚠️';
        }
      }

      const entry = {
        ts, heap, total, dom, dHeap, dDom,
        retained, garbage, gcDetected,
        cpuPct: cpu.pct, bgPct: cpu.bgPct, longTasks: cpu.longTasks,
        visible,
        elapsed: Math.round((now - startTime) / 1000),
      };
      heapLog.push(entry);
      if (heapLog.length > 2000) heapLog.splice(0, heapLog.length - 2000);

      const flags = [];
      if (gcDetected) flags.push(`🧹 GC swept ${prevHeap - heap}MB`);
      if (Math.abs(dHeap) >= 10 && !gcDetected) flags.push(`heap ${dHeap > 0 ? '+' : ''}${dHeap}MB`);
      if (Math.abs(dDom) >= 50) flags.push(`DOM ${dDom > 0 ? '+' : ''}${dDom}`);
      if (cpu.longTasks > 0) flags.push(`${cpu.longTasks} long tasks`);

      // CPU string: show actual foreground CPU%, plus a background indicator
      let cpuStr;
      if (cpu.bgPct >= 90) {
        cpuStr = ' | CPU: n/a (backgrounded)';
      } else if (cpu.bgPct > 0) {
        cpuStr = ` | CPU: ${cpu.pct}% (${cpu.bgPct}% bg)${cpu.pct > 50 ? ' ⚠️' : ''}`;
      } else {
        cpuStr = ` | CPU: ${cpu.pct}%${cpu.pct > 50 ? ' ⚠️' : ''}`;
      }

      const visStr = visible ? '' : ' [HIDDEN]';

      console.log(
        `[${ts}] Heap: ${heap}MB | Retained: ~${retained}MB | Garbage: ~${garbage}MB | DOM: ${dom}${cpuStr}${leakRateStr}${visStr}` +
        (flags.length ? `  ${flags.join(', ')}` : '')
      );

      prevHeap = heap;
      prevDom = dom;
    }, ms);
    console.log(`[HeapMonitor] Started (interval ${ms}ms). Stop: window.stopHeapMonitor()`);
    console.log('Commands: window.heapAnalysis()  window._heapLog  window._gcBaselines');
  };

  window.stopHeapMonitor = () => {
    if (heapId) { clearInterval(heapId); heapId = null; }
    stopCpuSampler();
    console.log('[HeapMonitor] Stopped');
  };

  window.heapAnalysis = () => {
    if (gcBaselines.length < 2) {
      console.log('%c[HeapAnalysis]%c Need at least 2 GC events to analyze. Keep the monitor running.', 'color:#ff9800;font-weight:bold', '');
      console.log(`GC events recorded so far: ${gcBaselines.length}`);
      console.log('Tip: switch away from this tab and back to trigger GC, or wait for Chrome to auto-collect.');
      return;
    }

    const first = gcBaselines[0];
    const last = gcBaselines[gcBaselines.length - 1];
    const spanMin = (last.time - first.time) / 60000;
    const leakMBperHour = spanMin > 0 ? ((last.heap - first.heap) / spanMin) * 60 : 0;
    const avgGarbageCollected = gcBaselines.reduce((s, b) => s + (b.peak - b.heap), 0) / gcBaselines.length;

    const diagnosis = leakMBperHour <= 5
      ? '✅ HEALTHY — no significant leak detected'
      : leakMBperHour <= 30
        ? '⚠️ SLOW LEAK — retained memory growing gradually'
        : '🔴 SIGNIFICANT LEAK — retained memory growing fast';

    console.log('%c[HeapAnalysis] Memory & CPU Health Report', 'color:#00bcd4;font-weight:bold;font-size:14px');
    console.log('─'.repeat(55));
    console.log(`Monitoring period:    ${spanMin.toFixed(1)} minutes`);
    console.log(`GC events detected:   ${gcBaselines.length}`);
    console.log(`First post-GC heap:   ${first.heap} MB`);
    console.log(`Latest post-GC heap:  ${last.heap} MB`);
    console.log(`Retained growth:      ${last.heap - first.heap} MB over ${spanMin.toFixed(1)} min`);
    console.log(`Leak rate:            ${leakMBperHour >= 0 ? '+' : ''}${leakMBperHour.toFixed(1)} MB/hour`);
    console.log(`Avg garbage per GC:   ${avgGarbageCollected.toFixed(0)} MB`);
    console.log('─'.repeat(55));
    console.log(`Diagnosis: ${diagnosis}`);
    console.log('─'.repeat(55));

    // CPU summary — only count foreground entries
    const fgEntries = heapLog.filter(e => e.visible !== false && e.cpuPct !== undefined);
    const bgEntries = heapLog.filter(e => e.visible === false);
    if (fgEntries.length > 0) {
      const avgCpu = Math.round(fgEntries.reduce((s, e) => s + e.cpuPct, 0) / fgEntries.length);
      const maxCpu = Math.max(...fgEntries.map(e => e.cpuPct));
      const totalLT = fgEntries.reduce((s, e) => s + (e.longTasks || 0), 0);
      console.log(`Avg CPU (foreground): ${avgCpu}%`);
      console.log(`Peak CPU (foreground):${maxCpu}%`);
      console.log(`Total long tasks:     ${totalLT} (>50ms main-thread blocks)`);
      console.log(`Foreground samples:   ${fgEntries.length} / ${heapLog.length}`);
      console.log(`Background samples:   ${bgEntries.length} / ${heapLog.length}`);
      console.log(`Visibility changes:   ${_visibilityChanges}`);
      console.log('─'.repeat(55));
    }

    // SSE throughput
    console.log(`Total SSE events:     ${_sseEvents}`);
    console.log('─'.repeat(55));

    if (gcBaselines.length >= 3) {
      console.log('\nPost-GC baselines over time:');
      console.table(gcBaselines.map((b, i) => ({
        '#': i + 1,
        time: new Date(b.time).toLocaleTimeString(),
        'retained (MB)': b.heap,
        'peak before GC (MB)': b.peak,
        'garbage collected (MB)': b.peak - b.heap,
      })));
    }

    return { leakMBperHour, retainedFirst: first.heap, retainedLast: last.heap, gcCount: gcBaselines.length, spanMin };
  };

  window._heapLog = heapLog;
  window._gcBaselines = gcBaselines;
}
