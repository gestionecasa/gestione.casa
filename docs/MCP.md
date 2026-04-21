# mcp.js — MCP Compliance senza trasporto

## Concetto architetturale

Questo file implementa un **MCP-compliant tool layer** senza stdio o HTTP+SSE. Non esiste un trasporto perché il client (PWA) e il server (tool executor) vivono nello stesso processo browser. Il protocollo MCP viene rispettato nel **flusso** — tool definitions → tool_use → tool_result — ma il trasporto è collassato in chiamate di funzione dirette.

```
MCP standard:          client → [stdio/SSE] → server → sistema
Questa implementazione: PWA → [function call] → mcp.js → broker LAN
```

L'LLM non sa la differenza. Vede tool definitions OpenAI-compatible e riceve tool_result — esattamente come in un flusso MCP tradizionale. Se in futuro si vuole estrarre questo layer in un MCP server standalone (per Claude Desktop, per altri client), basta wrappare `getTools()` e `executeTool()` in un HTTP+SSE server. Il business logic rimane identico.

---

## Struttura del file

```javascript
// mcp.js
// MCP-compliant tool layer per PWA domotica
// Trasporto: function calls dirette (client e server nello stesso processo)
// Flusso: OpenAI tool_use / tool_result compatible

// ─────────────────────────────────────────
// SEZIONE 1 — TOOL STATICI
// Sempre disponibili, indipendenti dalla discovery
// ─────────────────────────────────────────

const STATIC_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_broker_status",
      description: `Verifica se il broker domotico è raggiungibile e operativo.
                    Chiamare sempre come primo tool se l'utente segnala problemi
                    di connessione o se altri tool falliscono.`,
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_home_overview",
      description: `Restituisce una panoramica completa della casa:
                    tutti i dispositivi, sensori attivi, luci accese, 
                    temperature per stanza. Usare quando l'utente chiede
                    "com'è la casa", "tutto ok?", "stato generale".`,
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  }
];

// ─────────────────────────────────────────
// SEZIONE 2 — META TOOL
// Definizioni template che vengono espanse a runtime
// dalla discovery del broker in tool concreti
// ─────────────────────────────────────────

const META_TOOLS = {

  // Meta tool per le luci
  // Viene espanso in un tool con enum delle entità reali
  lights: (entities) => ({
    type: "function",
    function: {
      name: "control_light",
      description: `Accende, spegne o dimmerare le luci di casa.
                    Chiamare quando l'utente menziona luci, illuminazione,
                    visibilità, atmosfera. 
                    Per "romantico" o "relax" usare brightness 20-30.
                    Per "lavoro" o "leggere" usare brightness 80-100.
                    Per "buio" o "spegni tutto" usare action "off".`,
      parameters: {
        type: "object",
        properties: {
          entity_id: {
            type: "string",
            enum: entities.map(e => e.entity_id),
            description: "ID entità luce da controllare"
          },
          action: {
            type: "string",
            enum: ["on", "off", "toggle"]
          },
          brightness: {
            type: "number",
            description: "Intensità 0-100. Opzionale, default 100."
          }
        },
        required: ["entity_id", "action"]
      }
    }
  }),

  // Meta tool per i sensori
  sensors: (entities) => ({
    type: "function",
    function: {
      name: "get_sensor",
      description: `Legge il valore attuale di un sensore.
                    Chiamare SEMPRE prima di rispondere su temperature,
                    umidità, qualità dell'aria, o stato di un dispositivo.
                    Non assumere mai valori — leggi sempre dal sensore.`,
      parameters: {
        type: "object",
        properties: {
          entity_id: {
            type: "string",
            enum: entities.map(e => e.entity_id),
            description: "ID entità sensore da leggere"
          }
        },
        required: ["entity_id"]
      }
    }
  }),

  // Meta tool per il clima
  climate: (entities) => ({
    type: "function",
    function: {
      name: "set_climate",
      description: `Controlla termostati e climatizzatori.
                    Usare per alzare/abbassare la temperatura,
                    cambiare modalità (heat, cool, auto, off).
                    Chiedere conferma all'utente prima di modifiche
                    superiori a 3 gradi rispetto all'attuale.`,
      parameters: {
        type: "object",
        properties: {
          entity_id: {
            type: "string",
            enum: entities.map(e => e.entity_id)
          },
          temperature: {
            type: "number",
            description: "Temperatura target in gradi Celsius"
          },
          hvac_mode: {
            type: "string",
            enum: ["heat", "cool", "auto", "off"],
            description: "Modalità operativa. Opzionale."
          }
        },
        required: ["entity_id", "temperature"]
      }
    }
  }),

  // Meta tool per switch e prese
  switches: (entities) => ({
    type: "function",
    function: {
      name: "control_switch",
      description: `Controlla switch, prese intelligenti, relay.
                    Usare per elettrodomestici, prese, interruttori
                    che non sono classificati come luci.`,
      parameters: {
        type: "object",
        properties: {
          entity_id: {
            type: "string",
            enum: entities.map(e => e.entity_id)
          },
          action: {
            type: "string",
            enum: ["on", "off", "toggle"]
          }
        },
        required: ["entity_id", "action"]
      }
    }
  }),

  // Meta tool per serrature e accessi
  locks: (entities) => ({
    type: "function",
    function: {
      name: "control_lock",
      description: `Controlla serrature smart e accessi.
                    IMPORTANTE: prima di sbloccare chiedere sempre
                    conferma esplicita all'utente.
                    Registrare sempre orario e azione nel log.`,
      parameters: {
        type: "object",
        properties: {
          entity_id: {
            type: "string",
            enum: entities.map(e => e.entity_id)
          },
          action: {
            type: "string",
            enum: ["lock", "unlock"]
          }
        },
        required: ["entity_id", "action"]
      }
    }
  })
};

// ─────────────────────────────────────────
// SEZIONE 3 — REGISTRY
// Stato runtime dei tool dinamici generati dalla discovery
// ─────────────────────────────────────────

const registry = {
  dynamic: [],       // tool espansi dalla discovery
  brokerUrl: null,
  brokerToken: null,
  brokerType: null,  // 'homeassistant' | 'mqtt' | 'nodered'
};

// ─────────────────────────────────────────
// SEZIONE 4 — DISCOVERY → ESPANSIONE META TOOL
// Chiamato dopo che la PWA ha trovato il broker sulla LAN
// ─────────────────────────────────────────

async function initFromBroker(brokerUrl, brokerToken, brokerType = 'homeassistant') {
  registry.brokerUrl = brokerUrl;
  registry.brokerToken = brokerToken;
  registry.brokerType = brokerType;
  registry.dynamic = [];

  if (brokerType === 'homeassistant') {
    const entities = await fetch(`${brokerUrl}/api/states`, {
      headers: { Authorization: `Bearer ${brokerToken}` }
    }).then(r => r.json());

    // Gruppa le entità per dominio
    const byDomain = entities.reduce((acc, entity) => {
      const domain = entity.entity_id.split('.')[0];
      if (!acc[domain]) acc[domain] = [];
      acc[domain].push(entity);
      return acc;
    }, {});

    // Espandi i meta tool con le entità reali trovate
    if (byDomain.light?.length)   registry.dynamic.push(META_TOOLS.lights(byDomain.light));
    if (byDomain.sensor?.length)  registry.dynamic.push(META_TOOLS.sensors(byDomain.sensor));
    if (byDomain.climate?.length) registry.dynamic.push(META_TOOLS.climate(byDomain.climate));
    if (byDomain.switch?.length)  registry.dynamic.push(META_TOOLS.switches(byDomain.switch));
    if (byDomain.lock?.length)    registry.dynamic.push(META_TOOLS.locks(byDomain.lock));
  }

  // Persisti per sessioni successive
  localStorage.setItem('mcp_registry', JSON.stringify({
    dynamic: registry.dynamic,
    brokerUrl,
    brokerToken,
    brokerType
  }));
}

// Ripristina registry da localStorage senza fare discovery
function loadFromCache() {
  const cached = localStorage.getItem('mcp_registry');
  if (!cached) return false;
  const data = JSON.parse(cached);
  Object.assign(registry, data);
  return true;
}

// ─────────────────────────────────────────
// SEZIONE 5 — getTools()
// Unico punto di accesso per le tool definitions
// Chiamato ad ogni request verso l'LLM
// ─────────────────────────────────────────

function getTools() {
  return [
    ...STATIC_TOOLS,
    ...registry.dynamic
  ];
}

// ─────────────────────────────────────────
// SEZIONE 6 — EXECUTOR
// Riceve tool_use dall'LLM, esegue sul broker, restituisce tool_result
// Questo è il "server" nel pattern MCP
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
      const states = await ha('states');
      return states.map(e => ({
        id: e.entity_id,
        state: e.state,
        name: e.attributes.friendly_name
      }));
    }

    case 'control_light': {
      const service = `light/turn_${input.action}`;
      const data = { entity_id: input.entity_id };
      if (input.brightness !== undefined) {
        data.brightness = Math.round(input.brightness * 2.55); // 0-100 → 0-255
      }
      return ha(`services/${service}`, 'POST', data);
    }

    case 'get_sensor': {
      const state = await ha(`states/${input.entity_id}`);
      return {
        entity_id: input.entity_id,
        state: state.state,
        unit: state.attributes.unit_of_measurement,
        name: state.attributes.friendly_name
      };
    }

    case 'set_climate': {
      const data = { entity_id: input.entity_id };
      if (input.temperature) data.temperature = input.temperature;
      if (input.hvac_mode)   data.hvac_mode = input.hvac_mode;
      return ha('services/climate/set_temperature', 'POST', data);
    }

    case 'control_switch': {
      return ha(`services/switch/turn_${input.action}`, 'POST', {
        entity_id: input.entity_id
      });
    }

    case 'control_lock': {
      const service = input.action === 'lock' ? 'lock/lock' : 'lock/unlock';
      return ha(`services/${service}`, 'POST', { entity_id: input.entity_id });
    }

    default:
      return { error: `Tool sconosciuto: ${name}` };
  }
}

// ─────────────────────────────────────────
// SEZIONE 7 — AGENTIC LOOP
// Il flusso MCP completo: request → tool_use → tool_result → response
// ─────────────────────────────────────────

async function runAgentLoop(messages, onChunk) {
  while (true) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('openrouter_token')}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin
      },
      body: JSON.stringify({
        model: localStorage.getItem('llm_model') || 'anthropic/claude-sonnet-4',
        messages,
        tools: getTools(),   // ← sempre freschi, statici + dinamici
        system: `Sei un assistente domotico intelligente. 
                 Hai accesso ai dispositivi di casa tramite tool.
                 Usa sempre i tool per leggere stati reali — non inventare.
                 Per azioni irreversibili (serrature, allarmi) chiedi conferma.`
      })
    }).then(r => r.json());

    const msg = response.choices[0].message;
    messages.push(msg);

    // Risposta testuale finale — esci dal loop
    if (!msg.tool_calls?.length) {
      return msg.content;
    }

    // Esegui tutti i tool calls in parallelo
    const toolResults = await Promise.all(
      msg.tool_calls.map(async tc => {
        const result = await executeTool(
          tc.function.name,
          JSON.parse(tc.function.arguments)
        );
        return {
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result)
        };
      })
    );

    messages.push(...toolResults);
    // continua il loop — rimanda tutto all'LLM
  }
}

// ─────────────────────────────────────────
// EXPORT — interfaccia pubblica del modulo
// ─────────────────────────────────────────

export {
  initFromBroker,   // chiamato dopo discovery LAN
  loadFromCache,    // chiamato all'avvio se già configurato
  getTools,         // usato da runAgentLoop e per debug
  executeTool,      // usato da runAgentLoop
  runAgentLoop      // entry point principale dalla UI
};
```

---

## Come si usa nella PWA

```javascript
import { initFromBroker, loadFromCache, runAgentLoop } from './mcp.js';

// All'avvio
if (!loadFromCache()) {
  await runDiscovery(); // trova HA sulla LAN
  await initFromBroker(foundUrl, userToken, 'homeassistant');
}

// Ad ogni messaggio utente
async function sendMessage(userText) {
  messages.push({ role: 'user', content: userText });
  const reply = await runAgentLoop(messages);
  messages.push({ role: 'assistant', content: reply });
  renderMessage(reply);
}
```

---

## Perché questo è MCP-compliant anche senza trasporto

Il protocollo MCP definisce tre cose: **tool definitions**, **tool_use**, **tool_result**. Questo file le implementa tutte e tre rispettando esattamente la struttura. Il trasporto (stdio, SSE) è solo il canale fisico — qui sostituito da function calls dirette perché client e server vivono nello stesso processo. Quando servirà un MCP server standalone, `getTools()` diventa il handler di `tools/list` e `executeTool()` diventa il handler di `tools/call`. Zero riscrittura della logica.