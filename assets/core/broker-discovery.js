// core/broker-discovery.js
// LAN broker discovery via fetch probing + WebRTC IP leak

const BrokerDiscovery = (() => {

  const BROKERS = [
    { id: 'homeassistant', name: 'Home Assistant', port: 8123, path: '/api/',   icon: '🏠' },
    { id: 'nodered',       name: 'Node-RED',       port: 1880, path: '/',       icon: '🔴' },
    { id: 'mqtt',          name: 'MQTT',           port: 9001, path: '/',       icon: '📡' },
    { id: 'zigbee2mqtt',   name: 'Zigbee2MQTT',   port: 8080, path: '/',       icon: '📶' },
    { id: 'openhab',       name: 'openHAB',        port: 8080, path: '/rest/',  icon: '🔧' },
    { id: 'shelly',        name: 'Shelly',         port: 80,   path: '/shelly', icon: '💡' },
  ];

  // ── Stato condiviso ────────────────────────
  const state = {
    status:      'idle',  // 'idle' | 'running' | 'completed' | 'aborted'
    aborted:     false,
    found:       [],
    logs:        [],
    progress:    0,
    startedAt:   null,
    completedAt: null,
  };

  const listeners = new Set();

  function ts() {
    const d = new Date();
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
  }

  function notify(type, data = {}) {
    const snapshot = getStatus();
    listeners.forEach(cb => {
      try { cb({ type, status: snapshot, ...data }); } catch {}
    });
  }

  function onChange(cb) {
    if (typeof cb !== 'function') return () => {};
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  function pushLog(line, externalCb) {
    const entry = `[${ts()}] ${line}`;
    state.logs.push(entry);
    if (state.logs.length > 500) state.logs.shift();
    if (externalCb) externalCb(entry);
    notify('log', { line: entry });
  }

  function makeLogger(externalCb) {
    return line => pushLog(line, externalCb);
  }

  // ── WebRTC: rileva IP locale ───────────────
  function getLocalIP(log) {
    return new Promise(resolve => {
      try {
        log('WebRTC: rilevamento IP locale…');
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {
          log('WebRTC: createOffer fallito');
          resolve(null);
        });
        const timeout = setTimeout(() => {
          pc.close();
          log('WebRTC: timeout — IP non rilevato');
          resolve(null);
        }, 2500);
        pc.onicecandidate = e => {
          if (!e.candidate) return;
          const m = e.candidate.candidate.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
          if (m && !m[1].startsWith('127.') && !m[1].startsWith('169.')) {
            clearTimeout(timeout);
            pc.close();
            log(`WebRTC: IP locale rilevato → ${m[1]}`);
            resolve(m[1]);
          }
        };
      } catch (err) {
        log(`WebRTC: errore — ${err.message}`);
        resolve(null);
      }
    });
  }

  function subnet(ip) {
    const p = ip.split('.');
    return `${p[0]}.${p[1]}.${p[2]}`;
  }

  function fixedProbeIps() {
    const ips = ['127.0.0.1'];
    const h = location.hostname;
    if (h && h !== 'localhost' && h !== '127.0.0.1') ips.unshift(h);
    return [...new Set(ips)];
  }

  function withTimeout(ms = 500) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), ms);
    return { ctrl, done: () => clearTimeout(tid) };
  }

  // ── Reachability probe ─────────────────────
  async function probe(ip, port, path) {
    try {
      const { ctrl, done } = withTimeout(300);
      await fetch(`http://${ip}:${port}${path}`, { signal: ctrl.signal, mode: 'no-cors', cache: 'no-store' });
      done();
      return true;
    } catch { return false; }
  }

  async function fetchText(ip, port, path) {
    try {
      const { ctrl, done } = withTimeout(700);
      const res = await fetch(`http://${ip}:${port}${path}`, { signal: ctrl.signal, cache: 'no-store' });
      const text = await res.text();
      done();
      return text;
    } catch {
      return null;
    }
  }

  async function probeZigbee2Mqtt(ip) {
    const pages = [
      await fetchText(ip, 8080, '/'),
      await fetchText(ip, 8080, '/index.html'),
    ].filter(Boolean);

    return pages.some(text => /zigbee2mqtt|zigbee2mqtt-frontend|z2m/i.test(text));
  }

  async function probeOpenHab(ip) {
    const pages = [
      await fetchText(ip, 8080, '/rest/'),
      await fetchText(ip, 8080, '/rest'),
      await fetchText(ip, 8080, '/'),
    ].filter(Boolean);

    return pages.some(text => /openhab|org\.openhab|openhabcloud|Main UI/i.test(text));
  }

  async function detectBroker(ip, broker) {
    if (broker.id === 'zigbee2mqtt') {
      return probeZigbee2Mqtt(ip);
    }
    if (broker.id === 'openhab') {
      return probeOpenHab(ip);
    }
    return probe(ip, broker.port, broker.path);
  }

  async function diagnoseIp(ip) {
    const startedAt = performance.now();
    const results = await Promise.all(BROKERS.map(async broker => {
      const t0 = performance.now();
      try {
        const ok = await detectBroker(ip, broker);
        return {
          ...broker,
          ip,
          url: `http://${ip}:${broker.port}`,
          ok,
          elapsed: Math.round(performance.now() - t0),
          note: ok ? 'fingerprint/porta compatibile' : 'nessuna risposta valida',
        };
      } catch (err) {
        return {
          ...broker,
          ip,
          url: `http://${ip}:${broker.port}`,
          ok: false,
          elapsed: Math.round(performance.now() - t0),
          note: err.message,
        };
      }
    }));

    return {
      ip,
      elapsed: Math.round(performance.now() - startedAt),
      results,
      found: results.filter(r => r.ok),
    };
  }

  // ── Probe IP fissi ─────────────────────────
  async function probeFixed(ips, log) {
    const found = [];
    log(`Fixed: probe ${ips.join(', ')}`);
    await Promise.all(ips.map(async ip => {
      if (state.aborted) return;
      const hits = await Promise.all(
        BROKERS.map(async b => {
          const ok = await detectBroker(ip, b);
          if (ok) log(`✓ ${ip}:${b.port} → ${b.name}`);
          return ok ? { ...b, ip, url: `http://${ip}:${b.port}` } : null;
        })
      );
      hits.filter(Boolean).forEach(h => found.push(h));
    }));
    return found;
  }

  // ── Scan subnet con abort check ────────────
  async function scanSubnet(base, onProgress, log) {
    const found   = [];
    const total   = 254;
    let   scanned = 0;
    const BATCH   = 40;
    const batches = Math.ceil(total / BATCH);

    log(`Subnet: scansione ${base}.x — ${total} host, ${batches} batch da ${BATCH}`);

    for (let start = 1; start <= total; start += BATCH) {
      if (state.aborted) { log('Scansione interrotta'); break; }

      const batchNum = Math.ceil(start / BATCH);
      const end = Math.min(start + BATCH - 1, total);
      log(`Batch ${batchNum}/${batches}: probe ${base}.${start} → ${base}.${end}`);

      const ips = [];
      for (let i = start; i <= end; i++) ips.push(`${base}.${i}`);

      await Promise.all(ips.map(async ip => {
        if (state.aborted) return;
        const hits = await Promise.all(
          BROKERS.map(async b => {
            const ok = await detectBroker(ip, b);
            if (ok) log(`✓ ${ip}:${b.port} → ${b.name}`);
            return ok ? { ...b, ip, url: `http://${ip}:${b.port}` } : null;
          })
        );
        hits.filter(Boolean).forEach(h => {
          found.push(h);
          state.found = dedupe([...state.found, h]);
        });
        scanned++;
        state.progress = scanned / total;
        if (onProgress) onProgress(state.progress, [...state.found]);
        notify('progress');
      }));
    }

    log(`Batch completati — trovati ${found.length} servizi su ${base}.x`);
    return found;
  }

  // ── API pubblica ───────────────────────────

  function abort() {
    if (state.status !== 'running') return false;
    state.aborted = true;
    pushLog('Interruzione richiesta');
    notify('abort');
    return true;
  }

  function getStatus() {
    return {
      status:      state.status,
      aborted:     state.aborted,
      progress:    Math.round(state.progress * 100),
      found:       state.found.map(b => ({ id: b.id, name: b.name, ip: b.ip, port: b.port, url: b.url, icon: b.icon })),
      logLines:    state.logs.length,
      startedAt:   state.startedAt,
      completedAt: state.completedAt,
    };
  }

  function getLogs(last = 50) {
    return state.logs.slice(-last);
  }

  function resetState() {
    state.status = 'idle'; state.aborted = false; state.found = [];
    state.logs = []; state.progress = 0;
    state.startedAt = state.completedAt = null;
    notify('reset');
  }

  async function scan(onProgress, onLog) {
    if (state.status === 'running') return state.found;

    resetState();
    state.status    = 'running';
    state.startedAt = new Date().toISOString();
    notify('start');

    const log = makeLogger(onLog); // unico logger, propaga anche a onLog
    log('--- avvio scansione broker ---');

    try {
      const fixed = await probeFixed(fixedProbeIps(), log);
      if (fixed.length > 0) {
        state.found = dedupe(fixed);
        log(`--- completata: ${state.found.length} broker trovati (localhost) ---`);
        state.status = state.aborted ? 'aborted' : 'completed';
        state.completedAt = new Date().toISOString();
        notify(state.status);
        return state.found;
      }

      if (!state.aborted) {
        const localIP = await getLocalIP(log);
        const subnets = localIP
          ? [subnet(localIP)]
          : ['192.168.1', '192.168.0', '10.0.0', '172.16.0'];
        if (!localIP) log(`Fallback subnet: ${subnets.join(', ')}`);

        for (const base of subnets) {
          if (state.aborted) break;
          const results = await scanSubnet(base, onProgress, log);
          if (results.length > 0) { state.found = dedupe(results); break; }
        }
      }

      log(`--- ${state.aborted ? 'interrotta' : 'completata'}: ${state.found.length} broker trovati ---`);
    } catch (err) {
      log(`Errore inatteso: ${err.message}`);
    }

    state.status      = state.aborted ? 'aborted' : 'completed';
    state.completedAt = new Date().toISOString();
    notify(state.status);
    return state.found;
  }

  function dedupe(list) {
    const seen = new Set();
    return list.filter(b => {
      const k = `${b.ip}:${b.port}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  return { scan, abort, getStatus, getLogs, resetState, onChange, diagnoseIp, BROKERS };
})();
