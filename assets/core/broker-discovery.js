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

  // ── Stato condiviso della scansione ────────
  const state = {
    status:      'idle',   // 'idle' | 'running' | 'completed' | 'aborted'
    aborted:     false,
    found:       [],
    logs:        [],
    progress:    0,        // 0-1
    startedAt:   null,
    completedAt: null,
  };

  function ts() {
    const d = new Date();
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
  }

  function pushLog(line) {
    state.logs.push(`[${ts()}] ${line}`);
    if (state.logs.length > 500) state.logs.shift(); // cap
  }

  // ── WebRTC: rileva IP locale ───────────────
  function getLocalIP() {
    return new Promise(resolve => {
      try {
        pushLog('WebRTC: rilevamento IP locale…');
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {
          pushLog('WebRTC: createOffer fallito');
          resolve(null);
        });

        const timeout = setTimeout(() => {
          pc.close();
          pushLog('WebRTC: timeout — IP non rilevato');
          resolve(null);
        }, 2500);

        pc.onicecandidate = e => {
          if (!e.candidate) return;
          const m = e.candidate.candidate.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
          if (m && !m[1].startsWith('127.') && !m[1].startsWith('169.')) {
            clearTimeout(timeout);
            pc.close();
            pushLog(`WebRTC: IP locale rilevato → ${m[1]}`);
            resolve(m[1]);
          }
        };
      } catch (err) {
        pushLog(`WebRTC: errore — ${err.message}`);
        resolve(null);
      }
    });
  }

  function subnet(ip) {
    const p = ip.split('.');
    return `${p[0]}.${p[1]}.${p[2]}`;
  }

  // ── TCP probe via fetch + AbortController ──
  async function probe(ip, port, path) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 300);
      await fetch(`http://${ip}:${port}${path}`, {
        signal: ctrl.signal,
        mode:   'no-cors',
        cache:  'no-store',
      });
      clearTimeout(tid);
      return true;
    } catch {
      return false;
    }
  }

  // ── Scan subnet con abort check ────────────
  async function scanSubnet(base, onProgress) {
    const found   = [];
    const total   = 254;
    let   scanned = 0;
    const BATCH   = 40;
    const batches = Math.ceil(total / BATCH);

    pushLog(`Subnet: scansione ${base}.x — ${total} host, ${batches} batch da ${BATCH}`);

    for (let start = 1; start <= total; start += BATCH) {
      if (state.aborted) { pushLog('Scansione interrotta dall\'utente'); break; }

      const batchNum = Math.ceil(start / BATCH);
      const end = Math.min(start + BATCH - 1, total);
      pushLog(`Batch ${batchNum}/${batches}: probe ${base}.${start} → ${base}.${end}`);

      const ips = [];
      for (let i = start; i <= end; i++) ips.push(`${base}.${i}`);

      await Promise.all(ips.map(async ip => {
        if (state.aborted) return;
        const hits = await Promise.all(
          BROKERS.map(async b => {
            const ok = await probe(ip, b.port, b.path);
            if (ok) pushLog(`✓ ${ip}:${b.port} → ${b.name}`);
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
      }));
    }

    pushLog(`Batch completati — trovati ${found.length} servizi su ${base}.x`);
    return found;
  }

  // ── Probe IP fissi (localhost) ─────────────
  async function probeFixed(ips) {
    const found = [];
    pushLog(`Fixed: probe ${ips.join(', ')}`);
    await Promise.all(ips.map(async ip => {
      if (state.aborted) return;
      const hits = await Promise.all(
        BROKERS.map(async b => {
          const ok = await probe(ip, b.port, b.path);
          if (ok) pushLog(`✓ ${ip}:${b.port} → ${b.name}`);
          return ok ? { ...b, ip, url: `http://${ip}:${b.port}` } : null;
        })
      );
      hits.filter(Boolean).forEach(h => found.push(h));
    }));
    return found;
  }

  // ── API pubblica ───────────────────────────

  function abort() {
    if (state.status !== 'running') return false;
    state.aborted = true;
    pushLog('--- scansione interrotta ---');
    return true;
  }

  function getStatus() {
    return {
      status:      state.status,
      progress:    Math.round(state.progress * 100),
      found:       state.found.map(b => ({ name: b.name, ip: b.ip, port: b.port, url: b.url })),
      logLines:    state.logs.length,
      startedAt:   state.startedAt,
      completedAt: state.completedAt,
    };
  }

  function getLogs(last = 50) {
    return state.logs.slice(-last);
  }

  function resetState() {
    state.status      = 'idle';
    state.aborted     = false;
    state.found       = [];
    state.logs        = [];
    state.progress    = 0;
    state.startedAt   = null;
    state.completedAt = null;
  }

  async function scan(onProgress, onLog) {
    if (state.status === 'running') {
      pushLog('Scansione già in corso');
      return state.found;
    }

    resetState();
    state.status    = 'running';
    state.startedAt = new Date().toISOString();

    // Mirror log verso callback esterno (es. discovery bar)
    const origPushLog = pushLog;
    const log = line => {
      pushLog(line);
      if (onLog) onLog(line);
    };

    pushLog('--- avvio scansione broker ---');

    try {
      const fixed = await probeFixed(['0.0.0.0', '127.0.0.1']);
      if (fixed.length > 0) {
        state.found = dedupe(fixed);
        pushLog(`--- completata: ${state.found.length} broker trovati (localhost) ---`);
        state.status      = state.aborted ? 'aborted' : 'completed';
        state.completedAt = new Date().toISOString();
        return state.found;
      }

      if (!state.aborted) {
        const localIP = await getLocalIP();
        const subnets = localIP
          ? [subnet(localIP)]
          : ['192.168.1', '192.168.0', '10.0.0', '172.16.0'];

        if (!localIP) pushLog(`Fallback: provo subnet predefinite → ${subnets.join(', ')}`);

        for (const base of subnets) {
          if (state.aborted) break;
          const results = await scanSubnet(base, onProgress);
          if (results.length > 0) {
            state.found = dedupe(results);
            break;
          }
        }
      }

      pushLog(`--- ${state.aborted ? 'interrotta' : 'completata'}: ${state.found.length} broker trovati ---`);
    } catch (err) {
      pushLog(`Errore inatteso: ${err.message}`);
    }

    state.status      = state.aborted ? 'aborted' : 'completed';
    state.completedAt = new Date().toISOString();
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

  return { scan, abort, getStatus, getLogs, resetState, BROKERS };
})();