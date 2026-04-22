// core/mcp.js
// MCP-compliant tool layer per PWA domotica
// Trasporto: function calls dirette (client e server nello stesso processo)
// Flusso: OpenAI tool_use / tool_result compatible

const McpLayer = (() => {

  // ─────────────────────────────────────────
  // SEZIONE 1 — TOOL STATICI
  // ─────────────────────────────────────────

  const STATIC_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'describe_tools',
        description: `Restituisce la lista completa di tutti i tool disponibili in questo momento,
sia statici (sempre presenti) sia dinamici (generati dalla discovery del broker LAN).
Per ogni tool mostra nome, descrizione e parametri richiesti.
Chiamare quando l'utente chiede "cosa puoi fare?", "quali comandi hai?",
"che strumenti hai?", "cosa sai fare?", "quali tool hai?".`,
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'start_broker_scan',
        description: `Avvia la scansione della rete LAN per trovare broker domotici (Home Assistant, MQTT, Node-RED, ecc.).
La scansione parte in background. Usare quando l'utente dice "cerca broker", "scansiona la rete",
"avvia ricerca broker". Non usare questo tool per cercare dispositivi se esiste gia un broker HeyCasa connesso:
in quel caso usare scan_lan_devices o find_lan_device.`,
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'stop_broker_scan',
        description: `Interrompe una scansione broker in corso. Usare quando l'utente dice
"ferma", "stop", "interrompi la ricerca", "annulla scansione".
Se non c'è nessuna scansione attiva, lo segnala.`,
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_broker_scan_status',
        description: `Restituisce lo stato attuale della scansione broker: se è in corso, completata o ferma,
la percentuale di avanzamento, e i broker già trovati. Usare quando l'utente chiede
"com'è la ricerca?", "hai trovato qualcosa?", "a che punto sei?", "stato scansione".`,
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_broker_scan_logs',
        description: `Restituisce i log dettagliati dell'ultima scansione broker: ogni IP sondato,
ogni porta testata, ogni broker trovato. Usare quando l'utente chiede "mostra i log",
"vedi dettagli ricerca", "cosa sta succedendo nella scansione".`,
        parameters: {
          type: 'object',
          properties: {
            last: {
              type: 'number',
              description: 'Numero di righe di log da restituire (default 50, max 200).'
            }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_broker_status',
        description: `Verifica se il broker domotico è raggiungibile e operativo.
Chiamare sempre come primo tool se l'utente segnala problemi di connessione
o se altri tool falliscono.`,
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_home_overview',
        description: `Restituisce una panoramica completa della casa: tutti i dispositivi,
sensori attivi, luci accese, temperature per stanza. Usare quando l'utente chiede
"com'è la casa", "tutto ok?", "stato generale".`,
        parameters: { type: 'object', properties: {}, required: [] }
      }
    }
  ];

  // ─────────────────────────────────────────
  // SEZIONE 2 — META TOOL
  // Espansi a runtime con le entità reali dal broker
  // ─────────────────────────────────────────

  const META_TOOLS = {
    lights: entities => ({
      type: 'function',
      function: {
        name: 'control_light',
        description: `Accende, spegne o dimmerare le luci di casa.
Per "romantico" o "relax" usare brightness 20-30.
Per "lavoro" o "leggere" usare brightness 80-100.
Per "buio" o "spegni tutto" usare action "off".`,
        parameters: {
          type: 'object',
          properties: {
            entity_id: { type: 'string', enum: entities.map(e => e.entity_id), description: 'ID entità luce' },
            action:    { type: 'string', enum: ['on', 'off', 'toggle'] },
            brightness:{ type: 'number', description: 'Intensità 0-100. Opzionale.' }
          },
          required: ['entity_id', 'action']
        }
      }
    }),

    sensors: entities => ({
      type: 'function',
      function: {
        name: 'get_sensor',
        description: `Legge il valore attuale di un sensore.
Chiamare SEMPRE prima di rispondere su temperature, umidità, qualità dell'aria.
Non assumere mai valori — leggi sempre dal sensore.`,
        parameters: {
          type: 'object',
          properties: {
            entity_id: { type: 'string', enum: entities.map(e => e.entity_id), description: 'ID entità sensore' }
          },
          required: ['entity_id']
        }
      }
    }),

    climate: entities => ({
      type: 'function',
      function: {
        name: 'set_climate',
        description: `Controlla termostati e climatizzatori.
Chiedere conferma all'utente prima di modifiche superiori a 3 gradi rispetto all'attuale.`,
        parameters: {
          type: 'object',
          properties: {
            entity_id:   { type: 'string', enum: entities.map(e => e.entity_id) },
            temperature: { type: 'number', description: 'Temperatura target in °C' },
            hvac_mode:   { type: 'string', enum: ['heat', 'cool', 'auto', 'off'], description: 'Modalità operativa. Opzionale.' }
          },
          required: ['entity_id', 'temperature']
        }
      }
    }),

    switches: entities => ({
      type: 'function',
      function: {
        name: 'control_switch',
        description: `Controlla switch, prese intelligenti, relay.
Usare per elettrodomestici e prese che non sono classificati come luci.`,
        parameters: {
          type: 'object',
          properties: {
            entity_id: { type: 'string', enum: entities.map(e => e.entity_id) },
            action:    { type: 'string', enum: ['on', 'off', 'toggle'] }
          },
          required: ['entity_id', 'action']
        }
      }
    }),

    locks: entities => ({
      type: 'function',
      function: {
        name: 'control_lock',
        description: `Controlla serrature smart.
IMPORTANTE: prima di sbloccare chiedere sempre conferma esplicita all'utente.`,
        parameters: {
          type: 'object',
          properties: {
            entity_id: { type: 'string', enum: entities.map(e => e.entity_id) },
            action:    { type: 'string', enum: ['lock', 'unlock'] }
          },
          required: ['entity_id', 'action']
        }
      }
    })
  };

  const HEYCASA_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'get_lan_broker_info',
        description: `Legge le informazioni del broker HeyCasa connesso: host, IP LAN rilevato e processo.
Usare per verificare che il broker LAN sia operativo e quale macchina vede la rete dell'host.`,
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'scan_lan_devices',
        description: `Scansiona la LAN tramite il broker HeyCasa e restituisce gli host raggiungibili.
Usare quando l'utente chiede "che dispositivi ci sono in rete?", "scansiona la LAN",
"trova dispositivi", oppure prima di cercare un device specifico come Google Home, Chromecast, Nest, stampanti, NAS o router.`,
        parameters: {
          type: 'object',
          properties: {
            cidr: {
              type: 'string',
              description: 'Rete CIDR opzionale, ad esempio 192.168.1.0/24. Se assente il broker usa la /24 dell IP locale.'
            }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'inspect_lan_device',
        description: `Ispeziona un host LAN tramite il broker HeyCasa: porte note aperte, titolo/server HTTP e classificazione broker.map.
Usare per capire che tipo di dispositivo e' un IP trovato dalla scansione.`,
        parameters: {
          type: 'object',
          properties: {
            host: {
              type: 'string',
              description: 'IP o hostname LAN da ispezionare, ad esempio 192.168.1.23 o dispositivo.local.'
            }
          },
          required: ['host']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'ping_lan_host',
        description: `Esegue ping ICMP tramite il broker HeyCasa verso un IP o hostname LAN.
Usare per verificare se un host specifico e' raggiungibile.`,
        parameters: {
          type: 'object',
          properties: {
            host: {
              type: 'string',
              description: 'IP o hostname LAN da raggiungere.'
            }
          },
          required: ['host']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'find_lan_device',
        description: `Cerca un dispositivo nella LAN tramite il broker HeyCasa. Fa una scansione host e ispeziona i servizi per trovare corrispondenze.
Usare quando l'utente chiede frasi come "e' presente un Google Home in rete?", "trova Chromecast", "c'e' una stampante?", "vedi se c'e' un NAS".
La ricerca e' best effort: usa nomi reverse DNS, porte note, titolo/server HTTP e classificazione broker.map.`,
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Dispositivo o famiglia da cercare, ad esempio "google home", "chromecast", "nest", "stampante", "nas".'
            },
            cidr: {
              type: 'string',
              description: 'Rete CIDR opzionale, ad esempio 192.168.1.0/24.'
            },
            limit: {
              type: 'number',
              description: 'Numero massimo di host da ispezionare dopo la scansione. Default 32, max 80.'
            }
          },
          required: ['query']
        }
      }
    }
  ];

  // ─────────────────────────────────────────
  // SEZIONE 3 — REGISTRY
  // ─────────────────────────────────────────

  const registry = {
    dynamic:     [],
    brokerUrl:   null,
    brokerToken: null,
    brokerType:  null,
  };

  function hasDynamicTool(name) {
    return registry.dynamic.some(tool => tool.function?.name === name);
  }

  function ensureHeyCasaTools() {
    if (registry.brokerType !== 'heycasa') return;
    if (!hasDynamicTool('find_lan_device')) registry.dynamic.push(...HEYCASA_TOOLS);
  }

  function saveRegistry() {
    localStorage.setItem('mcp_registry', JSON.stringify({
      dynamic: registry.dynamic,
      brokerUrl: registry.brokerUrl,
      brokerToken: registry.brokerToken,
      brokerType: registry.brokerType,
    }));
  }

  function restoreSavedBroker() {
    try {
      const raw = localStorage.getItem('hc-broker');
      if (!raw) return false;
      const broker = JSON.parse(raw);
      if (!broker?.url || !broker?.id) return false;

      registry.brokerUrl = broker.url;
      registry.brokerToken = broker.haToken || null;
      registry.brokerType = broker.id;
      registry.dynamic = [];
      if (broker.id === 'heycasa') ensureHeyCasaTools();
      saveRegistry();
      console.log('[MCP] registry ripristinato da hc-broker', {
        brokerUrl: registry.brokerUrl,
        brokerType: registry.brokerType,
        dynamicTools: registry.dynamic.length,
      });
      return true;
    } catch (err) {
      console.warn('[MCP] impossibile ripristinare hc-broker:', err.message);
      return false;
    }
  }

  function ensureBrokerConfigured() {
    if (registry.brokerUrl) {
      ensureHeyCasaTools();
      return true;
    }
    return restoreSavedBroker();
  }

  // ─────────────────────────────────────────
  // SEZIONE 4 — DISCOVERY → ESPANSIONE META TOOL
  // ─────────────────────────────────────────

  async function initFromBroker(brokerUrl, brokerToken, brokerType = 'homeassistant') {
    console.groupCollapsed('[MCP] initFromBroker');
    console.log({ brokerUrl, brokerType, hasToken: !!brokerToken });
    let entitiesLoaded = 0;
    let entityLoadError = null;
    registry.brokerUrl   = brokerUrl;
    registry.brokerToken = brokerToken;
    registry.brokerType  = brokerType;
    registry.dynamic     = [];

    if (brokerType === 'homeassistant' && brokerToken) {
      let entities = [];
      try {
        console.log('[MCP] caricamento entità Home Assistant:', `${brokerUrl}/api/states`);
        const res = await fetch(`${brokerUrl}/api/states`, {
          headers: { Authorization: `Bearer ${brokerToken}` }
        });
        console.log('[MCP] risposta /api/states:', res.status, res.statusText);
        if (!res.ok) throw new Error(`Home Assistant /api/states HTTP ${res.status}`);
        entities = await res.json();
        entitiesLoaded = Array.isArray(entities) ? entities.length : 0;
      } catch (err) {
        entityLoadError = err.message;
        console.warn('[MCP] impossibile caricare entità da HA:', err.message);
        console.warn('[MCP] se è un errore CORS, configura Home Assistant:', {
          origin: location.origin,
          configuration: `http:\n  cors_allowed_origins:\n    - ${location.origin}`
        });
      }

      if (Array.isArray(entities)) {
        const byDomain = entities.reduce((acc, e) => {
          const domain = e.entity_id.split('.')[0];
          (acc[domain] = acc[domain] || []).push(e);
          return acc;
        }, {});

        if (byDomain.light?.length)   registry.dynamic.push(META_TOOLS.lights(byDomain.light));
        if (byDomain.sensor?.length)  registry.dynamic.push(META_TOOLS.sensors(byDomain.sensor));
        if (byDomain.climate?.length) registry.dynamic.push(META_TOOLS.climate(byDomain.climate));
        if (byDomain.switch?.length)  registry.dynamic.push(META_TOOLS.switches(byDomain.switch));
        if (byDomain.lock?.length)    registry.dynamic.push(META_TOOLS.locks(byDomain.lock));

        console.log(`[MCP] espansi ${registry.dynamic.length} tool dinamici da ${entities.length} entità`);
      }
    } else if (brokerType === 'homeassistant') {
      console.warn('[MCP] Home Assistant connesso senza token: salto caricamento entità dinamiche');
    } else if (brokerType === 'heycasa') {
      registry.dynamic.push(...HEYCASA_TOOLS);
      try {
        await heycasaCommand('info', brokerUrl);
      } catch (err) {
        entityLoadError = err.message;
        console.warn('[MCP] broker HeyCasa non verificato:', err.message);
      }
    }

    try {
      saveRegistry();
      console.log('[MCP] registry salvato in localStorage');
    } catch (err) {
      console.warn('[MCP] impossibile salvare registry:', err.message);
    }
    console.groupEnd();
    return {
      brokerUrl,
      brokerType,
      dynamicTools: registry.dynamic.length,
      entitiesLoaded,
      entityLoadError,
      hasToken: !!brokerToken,
    };
  }

  function loadFromCache() {
    try {
      const raw = localStorage.getItem('mcp_registry');
      if (!raw) return restoreSavedBroker();
      const data = JSON.parse(raw);
      Object.assign(registry, data);
      if (!registry.brokerUrl) return restoreSavedBroker();
      ensureHeyCasaTools();
      console.log(`[MCP] registry caricato dalla cache — ${registry.dynamic.length} tool dinamici`);
      return true;
    } catch {
      return restoreSavedBroker();
    }
  }

  function clearCache() {
    registry.dynamic = [];
    registry.brokerUrl = registry.brokerToken = registry.brokerType = null;
    try { localStorage.removeItem('mcp_registry'); } catch {}
  }

  // ─────────────────────────────────────────
  // SEZIONE 5 — getTools()
  // ─────────────────────────────────────────

  function getTools() {
    ensureBrokerConfigured();
    return [...STATIC_TOOLS, ...registry.dynamic];
  }

  function hasBroker() {
    ensureBrokerConfigured();
    return !!registry.brokerUrl;
  }

  function getBrokerInfo() {
    ensureBrokerConfigured();
    return {
      connected: !!registry.brokerUrl,
      url: registry.brokerUrl,
      type: registry.brokerType,
      dynamicTools: registry.dynamic.length,
    };
  }

  // ─────────────────────────────────────────
  // SEZIONE 6 — EXECUTOR
  // ─────────────────────────────────────────

  async function executeTool(name, input) {
    ensureBrokerConfigured();
    const { brokerUrl, brokerToken } = registry;

    const ha = async (path, method = 'GET', body = null) => {
      const url = `${brokerUrl}/api/${path}`;
      console.log('[MCP][HA] request', { method, url, hasToken: !!brokerToken, origin: location.origin });
      try {
        const res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${brokerToken}`,
            'Content-Type': 'application/json'
          },
          body: body ? JSON.stringify(body) : null
        });
        console.log('[MCP][HA] response', { url, status: res.status, statusText: res.statusText });
        if (!res.ok) throw new Error(`Home Assistant HTTP ${res.status} su ${url}`);
        return res.json();
      } catch (err) {
        console.error('[MCP][HA] fetch fallita', {
          url,
          origin: location.origin,
          error: err.message,
          hint: `Se il browser segnala CORS, aggiungi ${location.origin} a http.cors_allowed_origins in Home Assistant.`
        });
        throw err;
      }
    };

    console.log(`[MCP] executeTool: ${name}`, input);

    switch (name) {

      case 'get_broker_status': {
        if (!brokerUrl) return { status: 'offline', reason: 'Nessun broker configurato' };
        if (registry.brokerType === 'heycasa') {
          try {
            const info = await heycasaCommand('info');
            return { status: 'online', broker: registry.brokerType, url: brokerUrl, info };
          } catch (err) {
            return { status: 'offline', broker: registry.brokerType, url: brokerUrl, error: err.message };
          }
        }
        try {
          await ha('');
          return { status: 'online', broker: registry.brokerType, url: brokerUrl };
        } catch {
          return { status: 'offline' };
        }
      }

      case 'get_home_overview': {
        if (!brokerUrl) return { error: 'Nessun broker configurato' };
        const states = await ha('states');
        return (states || []).map(e => ({
          id:    e.entity_id,
          state: e.state,
          name:  e.attributes?.friendly_name
        }));
      }

      case 'get_lan_broker_info': {
        if (!brokerUrl || registry.brokerType !== 'heycasa') return { error: 'Nessun broker HeyCasa configurato' };
        return heycasaCommand('info');
      }

      case 'scan_lan_devices': {
        if (!brokerUrl || registry.brokerType !== 'heycasa') return { error: 'Nessun broker HeyCasa configurato' };
        const command = input?.cidr ? `scan ${input.cidr}` : 'scan';
        return heycasaCommand(command);
      }

      case 'inspect_lan_device': {
        if (!brokerUrl || registry.brokerType !== 'heycasa') return { error: 'Nessun broker HeyCasa configurato' };
        if (!input?.host) return { error: 'host mancante' };
        return heycasaCommand(`services ${input.host}`);
      }

      case 'ping_lan_host': {
        if (!brokerUrl || registry.brokerType !== 'heycasa') return { error: 'Nessun broker HeyCasa configurato' };
        if (!input?.host) return { error: 'host mancante' };
        return heycasaCommand(`ping ${input.host}`);
      }

      case 'find_lan_device': {
        if (!brokerUrl || registry.brokerType !== 'heycasa') return { error: 'Nessun broker HeyCasa configurato' };
        return findLanDevice(input);
      }

      case 'control_light': {
        const data = { entity_id: input.entity_id };
        if (input.brightness !== undefined) data.brightness = Math.round(input.brightness * 2.55);
        return ha(`services/light/turn_${input.action}`, 'POST', data);
      }

      case 'get_sensor': {
        const state = await ha(`states/${input.entity_id}`);
        return {
          entity_id: input.entity_id,
          state:     state.state,
          unit:      state.attributes?.unit_of_measurement,
          name:      state.attributes?.friendly_name
        };
      }

      case 'set_climate': {
        const data = { entity_id: input.entity_id };
        if (input.temperature) data.temperature = input.temperature;
        if (input.hvac_mode)   data.hvac_mode   = input.hvac_mode;
        return ha('services/climate/set_temperature', 'POST', data);
      }

      case 'control_switch':
        return ha(`services/switch/turn_${input.action}`, 'POST', { entity_id: input.entity_id });

      case 'control_lock': {
        const svc = input.action === 'lock' ? 'lock/lock' : 'lock/unlock';
        return ha(`services/${svc}`, 'POST', { entity_id: input.entity_id });
      }

      case 'start_broker_scan': {
        if (brokerUrl && registry.brokerType === 'heycasa') {
          return {
            started: false,
            broker_connected: true,
            broker: registry.brokerType,
            url: brokerUrl,
            message: 'Broker HeyCasa gia connesso. Per cercare dispositivi nella LAN usa scan_lan_devices o find_lan_device.',
          };
        }
        const s = BrokerDiscovery.getStatus();
        if (s.status === 'running') {
          if (typeof App !== 'undefined') App.showDiscoveryBar();
          return { started: false, reason: 'Scansione già in corso', progress: s.progress, found: s.found };
        }
        // Mostra barra UI e avvia scan (showDiscoveryBar chiama scan internamente)
        if (typeof App !== 'undefined') {
          App.showDiscoveryBar();
        } else {
          BrokerDiscovery.scan();
        }
        return { started: true, message: 'Scansione avviata. La barra di ricerca in alto mostra l\'avanzamento.' };
      }

      case 'stop_broker_scan': {
        const stopped = BrokerDiscovery.abort();
        if (!stopped) {
          return { stopped: false, reason: 'Nessuna scansione in corso al momento.' };
        }
        return { stopped: true, message: 'Scansione interrotta.' };
      }

      case 'get_broker_scan_status': {
        const s = BrokerDiscovery.getStatus();
        return {
          status:      s.status,
          progress:    `${s.progress}%`,
          found_count: s.found.length,
          found:       s.found,
          started_at:  s.startedAt,
          completed_at:s.completedAt,
        };
      }

      case 'get_broker_scan_logs': {
        const n    = Math.min(input.last ?? 50, 200);
        const logs = BrokerDiscovery.getLogs(n);
        const s    = BrokerDiscovery.getStatus();
        return {
          status:     s.status,
          total_lines:s.logLines,
          showing:    logs.length,
          logs,
        };
      }

      case 'describe_tools': {
        const all = getTools();
        const staticNames  = STATIC_TOOLS.map(t => t.function.name);
        const dynamicNames = registry.dynamic.map(t => t.function.name);

        return {
          total: all.length,
          broker_connected: !!registry.brokerUrl,
          broker_type: registry.brokerType ?? 'nessuno',
          static_tools: STATIC_TOOLS.map(t => ({
            name:        t.function.name,
            description: t.function.description.split('\n')[0].trim(),
            params:      Object.keys(t.function.parameters.properties ?? {})
          })),
          dynamic_tools: registry.dynamic.length > 0
            ? registry.dynamic.map(t => ({
                name:        t.function.name,
                description: t.function.description.split('\n')[0].trim(),
                params:      Object.keys(t.function.parameters.properties ?? {}),
                entities:    t.function.parameters.properties?.entity_id?.enum?.length ?? 0
              }))
            : [],
          note: registry.dynamic.length === 0
            ? 'Nessun tool dinamico attivo — collega un broker dalla barra di ricerca per abilitarli.'
            : `${dynamicNames.length} tool dinamici attivi dal broker ${registry.brokerType} su ${registry.brokerUrl}`
        };
      }

      default:
        return { error: `Tool sconosciuto: ${name}` };
    }
  }

  // ─────────────────────────────────────────
  // SEZIONE 7 — AGENTIC LOOP
  // request → tool_use → tool_result → response (loop fino a risposta testuale)
  // ─────────────────────────────────────────

  async function runAgentLoop(messages, model, token) {
    const tools = getTools();

    while (true) {
      const body = {
        model,
        messages,
        ...(tools.length > 0 && { tools, tool_choice: 'auto' })
      };

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.origin,
          'X-Title':      'Hey Casa',
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      if (!res.ok) {
        throw Object.assign(new Error(data?.error?.message || `HTTP ${res.status}`), { status: res.status });
      }

      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error('Risposta LLM vuota');

      messages.push(msg);

      // Nessun tool call → risposta testuale finale
      if (!msg.tool_calls?.length) {
        return msg.content ?? '';
      }

      // Esegui tool calls in parallelo
      const results = await Promise.all(
        msg.tool_calls.map(async tc => {
          let result;
          try {
            result = await executeTool(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
          } catch (err) {
            result = { error: err.message };
          }
          return {
            role:         'tool',
            tool_call_id: tc.id,
            content:      JSON.stringify(result)
          };
        })
      );

      messages.push(...results);
      // continua il loop
    }
  }

  function brokerWsUrl(url = registry.brokerUrl) {
    if (!url) throw new Error('Nessun broker configurato');
    const u = new URL(url);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/ws';
    u.search = '';
    u.hash = '';
    return u.toString();
  }

  function heycasaCommand(command, explicitBrokerUrl = null, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      let ws = null;
      let settled = false;
      const id = Date.now();
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { if (ws) ws.close(); } catch {}
        fn(value);
      };
      const timer = setTimeout(() => {
        finish(reject, new Error(`Timeout broker HeyCasa su comando "${command}"`));
      }, timeoutMs);

      try {
        ws = new WebSocket(brokerWsUrl(explicitBrokerUrl || registry.brokerUrl));
        ws.addEventListener('open', () => {
          ws.send(JSON.stringify({ id, command }));
        });
        ws.addEventListener('message', event => {
          let msg;
          try { msg = JSON.parse(event.data); } catch { return; }
          if (msg.type !== 'result') return;
          if (msg.id !== id && msg.id !== null) return;
          finish(resolve, {
            ok: msg.ok,
            command: msg.command,
            elapsed_ms: msg.elapsed_ms,
            data: msg.data,
          });
        });
        ws.addEventListener('error', () => {
          finish(reject, new Error('Connessione WebSocket al broker HeyCasa fallita'));
        });
      } catch (err) {
        finish(reject, err);
      }
    });
  }

  async function findLanDevice(input = {}) {
    const query = String(input.query ?? '').trim();
    if (!query) return { error: 'query mancante' };

    const limit = Math.min(Math.max(Number(input.limit ?? 32), 1), 80);
    const scanCommand = input.cidr ? `scan ${input.cidr}` : 'scan';
    const scan = await heycasaCommand(scanCommand);
    const hosts = scan?.data?.hosts ?? [];
    const inspected = [];
    const matches = [];
    const needles = deviceNeedles(query);

    for (const host of hosts.slice(0, limit)) {
      const ip = host.ip;
      if (!ip) continue;
      let services;
      try {
        services = await heycasaCommand(`services ${ip}`, null, 15000);
      } catch (err) {
        inspected.push({ ip, name: host.name ?? null, error: err.message });
        continue;
      }

      const candidate = {
        ip,
        name: host.name ?? null,
        open_ports: services?.data?.open_ports ?? [],
        http_title: services?.data?.http_title ?? null,
        http_server: services?.data?.http_server ?? null,
        device_type: services?.data?.device_type ?? '',
        device_label: services?.data?.device_label ?? '',
      };
      const score = scoreDevice(candidate, needles);
      inspected.push({ ...candidate, score });
      if (score > 0) matches.push({ ...candidate, score });
    }

    matches.sort((a, b) => b.score - a.score);
    return {
      query,
      network: scan?.data?.network ?? null,
      scanned_hosts: hosts.length,
      inspected_hosts: inspected.length,
      found: matches.length > 0,
      matches,
      note: matches.length
        ? 'Corrispondenze trovate tramite nome, servizi o broker.map.'
        : 'Nessuna corrispondenza trovata. La ricerca dipende da ping, reverse DNS, porte note e broker.map.',
    };
  }

  function deviceNeedles(query) {
    const q = query.toLowerCase();
    const words = q.split(/[^a-z0-9]+/).filter(Boolean);
    const aliases = {
      google: ['google', 'googlehome', 'google-home', 'nest', 'chromecast', 'cast', 'google cast'],
      home: ['home', 'googlehome', 'google-home'],
      chromecast: ['chromecast', 'cast', 'google'],
      nest: ['nest', 'google'],
      stampante: ['printer', 'stampante', 'ipp', 'jetdirect', '9100'],
      printer: ['printer', 'stampante', 'ipp', 'jetdirect', '9100'],
      nas: ['nas', 'smb', '445', 'file server'],
      router: ['router', 'gateway', 'access point', 'ap'],
    };
    const expanded = new Set(words);
    words.forEach(w => (aliases[w] || []).forEach(a => expanded.add(a)));
    if (q.includes('google home')) ['googlehome', 'google-home', 'nest', 'chromecast', 'cast'].forEach(a => expanded.add(a));
    return [...expanded];
  }

  function scoreDevice(candidate, needles) {
    const haystack = [
      candidate.ip,
      candidate.name,
      candidate.http_title,
      candidate.http_server,
      candidate.device_type,
      candidate.device_label,
      ...(candidate.open_ports || []).flatMap(p => [String(p.port), p.service]),
    ].filter(Boolean).join(' ').toLowerCase();

    return needles.reduce((score, needle) => {
      if (!needle) return score;
      return haystack.includes(needle.toLowerCase()) ? score + 1 : score;
    }, 0);
  }

  return { initFromBroker, loadFromCache, clearCache, getTools, executeTool, runAgentLoop, hasBroker, getBrokerInfo };
})();
