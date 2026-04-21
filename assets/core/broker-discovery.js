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

  // ── WebRTC trick: leak the device's LAN IP ──
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

  // ── Scan one subnet (x.x.x.1-254) ──
  async function scanSubnet(base, onProgress, log) {
    const found   = [];
    const total   = 254;
    let   scanned = 0;
    const BATCH   = 40;
    const batches = Math.ceil(total / BATCH);

    log(`Subnet: scansione ${base}.x — ${total} host, ${batches} batch da ${BATCH}`);

    for (let start = 1; start <= total; start += BATCH) {
      const batchNum = Math.ceil(start / BATCH);
      const end = Math.min(start + BATCH - 1, total);
      log(`Batch ${batchNum}/${batches}: probe ${base}.${start} → ${base}.${end}`);

      const ips = [];
      for (let i = start; i <= end; i++) ips.push(`${base}.${i}`);

      await Promise.all(ips.map(async ip => {
        const hits = await Promise.all(
          BROKERS.map(async b => {
            const ok = await probe(ip, b.port, b.path);
            if (ok) log(`✓ ${ip}:${b.port} → ${b.name}`);
            return ok ? { ...b, ip, url: `http://${ip}:${b.port}` } : null;
          })
        );
        hits.filter(Boolean).forEach(h => found.push(h));
        scanned++;
        if (onProgress) onProgress(scanned / total, [...found]);
      }));
    }

    log(`Batch completati — trovati ${found.length} servizi su ${base}.x`);
    return found;
  }

  // ── Probe a fixed list of IPs (localhost, 0.0.0.0, …) ──
  async function probeFixed(ips, log) {
    const found = [];
    log(`Fixed: probe ${ips.join(', ')}`);
    await Promise.all(ips.map(async ip => {
      const hits = await Promise.all(
        BROKERS.map(async b => {
          const ok = await probe(ip, b.port, b.path);
          if (ok) log(`✓ ${ip}:${b.port} → ${b.name}`);
          return ok ? { ...b, ip, url: `http://${ip}:${b.port}` } : null;
        })
      );
      hits.filter(Boolean).forEach(h => found.push(h));
    }));
    return found;
  }

  // ── Public scan ──
  async function scan(onProgress, onLog) {
    const log = onLog || (() => {});

    log('--- avvio scansione broker ---');

    // Always probe localhost variants first
    const fixed = await probeFixed(['0.0.0.0', '127.0.0.1'], log);
    if (fixed.length > 0) {
      const found = dedupe(fixed);
      log(`--- scansione completata: ${found.length} broker trovati (localhost) ---`);
      return found;
    }

    const localIP = await getLocalIP(log);

    let subnets;
    if (localIP) {
      subnets = [subnet(localIP)];
    } else {
      subnets = ['192.168.1', '192.168.0', '10.0.0', '172.16.0'];
      log(`Fallback: provo subnet predefinite → ${subnets.join(', ')}`);
    }

    for (const base of subnets) {
      const results = await scanSubnet(base, onProgress, log);
      if (results.length > 0) {
        const found = dedupe(results);
        log(`--- scansione completata: ${found.length} broker trovati ---`);
        return found;
      }
    }

    log('--- scansione completata: nessun broker trovato ---');
    return [];
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

  return { scan, BROKERS };
})();