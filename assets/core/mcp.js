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
"trova dispositivi", "avvia ricerca". Se una scansione è già in corso, lo segnala senza riavviarla.`,
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

  // ─────────────────────────────────────────
  // SEZIONE 3 — REGISTRY
  // ─────────────────────────────────────────

  const registry = {
    dynamic:     [],
    brokerUrl:   null,
    brokerToken: null,
    brokerType:  null,
  };

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
    }

    try {
      localStorage.setItem('mcp_registry', JSON.stringify({
        dynamic: registry.dynamic, brokerUrl, brokerToken, brokerType
      }));
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
      if (!raw) return false;
      const data = JSON.parse(raw);
      Object.assign(registry, data);
      console.log(`[MCP] registry caricato dalla cache — ${registry.dynamic.length} tool dinamici`);
      return true;
    } catch { return false; }
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
    return [...STATIC_TOOLS, ...registry.dynamic];
  }

  function hasBroker() {
    return !!registry.brokerUrl;
  }

  // ─────────────────────────────────────────
  // SEZIONE 6 — EXECUTOR
  // ─────────────────────────────────────────

  async function executeTool(name, input) {
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

  return { initFromBroker, loadFromCache, clearCache, getTools, executeTool, runAgentLoop, hasBroker };
})();
