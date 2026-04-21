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
    registry.brokerUrl   = brokerUrl;
    registry.brokerToken = brokerToken;
    registry.brokerType  = brokerType;
    registry.dynamic     = [];

    if (brokerType === 'homeassistant' && brokerToken) {
      let entities = [];
      try {
        const res = await fetch(`${brokerUrl}/api/states`, {
          headers: { Authorization: `Bearer ${brokerToken}` }
        });
        entities = await res.json();
      } catch (err) {
        console.warn('[MCP] impossibile caricare entità da HA:', err.message);
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
    }

    try {
      localStorage.setItem('mcp_registry', JSON.stringify({
        dynamic: registry.dynamic, brokerUrl, brokerToken, brokerType
      }));
    } catch {}
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

    const ha = (path, method = 'GET', body = null) =>
      fetch(`${brokerUrl}/api/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${brokerToken}`,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : null
      }).then(r => r.json());

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