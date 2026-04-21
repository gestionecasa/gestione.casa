a// core/broker-discovery.js
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
  function getLocalIP() {
    return new Promise(resolve => {
      try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => resolve(null));

        const timeout = setTimeout(() => { pc.close(); resolve(null); }, 2500);

        pc.onicecandidate = e => {
          if (!e.candidate) return;
          const m = e.candidate.candidate.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
          if (m && !m[1].startsWith('127.') && !m[1].startsWith('169.')) {
            clearTimeout(timeout);
            pc.close();
            resolve(m[1]);
          }
        };
      } catch {
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
  async function scanSubnet(base, onProgress) {
    const found   = [];
    const total   = 254;
    let   scanned = 0;

    // Probe IPs in batches to avoid saturating the browser
    const BATCH = 40;
    for (let start = 1; start <= total; start += BATCH) {
      const ips = [];
      for (let i = start; i < start + BATCH && i <= total; i++) {
        ips.push(`${base}.${i}`);
      }

      await Promise.all(ips.map(async ip => {
        const hits = await Promise.all(
          BROKERS.map(async b => {
            const ok = await probe(ip, b.port, b.path);
            return ok ? { ...b, ip, url: `http://${ip}:${b.port}` } : null;
          })
        );
        hits.filter(Boolean).forEach(h => found.push(h));
        scanned++;
        if (onProgress) onProgress(scanned / total, [...found]);
      }));
    }

    return found;
  }

  // ── Public scan ──
  async function scan(onProgress) {
    const localIP = await getLocalIP();
    const subnets = localIP
      ? [subnet(localIP)]
      : ['192.168.1', '192.168.0', '10.0.0', '172.16.0'];

    for (const base of subnets) {
      const results = await scanSubnet(base, onProgress);
      if (results.length > 0) {
        return dedupe(results);
      }
    }
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