# Casa — L'agente domestico open source

> Un agente conversazionale per la casa che vive nel browser.  
> Zero server. Zero abbonamento. Zero lock-in.

---

## Il problema

Gli assistenti AI esistenti sono generalisti, cloud-dipendenti, e non hanno memoria della tua casa.  
Le app domotiche sono chiuse, costose, e richiedono hub proprietari.  
I portali immobiliari ti danno dati, non intelligenza.

**Casa** risolve un problema diverso: vuoi un agente che *conosce* la tua casa, ci ragiona sopra, e agisce — senza che i tuoi dati escano dal tuo browser.

---

## Il concept

Una chat UI dove parli con un agente che capisce il contesto domestico ed esegue azioni concrete.

```
Tu:    "Accendi il soggiorno"
Casa:  ✓ Soggiorno acceso — 21:34

Tu:    "Ho pagato 180€ di luce"
Casa:  ✓ Registrato. Totale luce 2025: 847€ (+12% vs 2024)

Tu:    "C'è qualche bonus per il cappotto termico?"
Casa:  Sì — Ecobonus 65% ancora attivo per interventi su involucro.
       Fonte: ENEA, aggiornato 3 giorni fa.

Tu:    "Ricordami di chiamare l'idraulico venerdì"
Casa:  ✓ Promemoria impostato per venerdì 25 aprile.
```

Questo non è un chatbot. È un **agente con tool calling**, memoria locale, e contesto aggiornato periodicamente — tutto nel browser.

---

## Architettura

### Stack

| Layer | Tecnologia | Perché |
|---|---|---|
| UI | Vanilla JS + CSS custom | Zero dipendenze, massimo controllo |
| Storage | IndexedDB | Persistenza locale, strutturata, offline |
| AI | Claude API / OpenAI / Ollama | Swappabile per design |
| Dati esterni | JSON statici via GitHub Action | ETL asincrono, zero runtime server |
| Hosting | GitHub Pages / qualsiasi CDN | Deploy triviale, costo zero |

### Principi architetturali

**1. Tool Calling Client-Side**

I tool sono unità dichiarative: nome, descrizione, parametri, handler JS.  
L'agente li carica dinamicamente e decide quale invocare in base al messaggio.  
Aggiungere un nuovo tool = aggiungere un file. Nessuna modifica al core.

```json
{
  "name": "record_expense",
  "description": "Registra una spesa domestica",
  "parameters": {
    "amount": "number",
    "category": "luce | gas | acqua | manutenzione | altro",
    "note": "string?"
  }
}
```

**2. Casa Graph — la memoria locale**

IndexedDB con uno schema che modella la casa come grafo:

```
Casa
├── Stanze (soggiorno, cucina, camera...)
│   └── Dispositivi (luci, termostato, elettrodomestici...)
├── Spese (categoria, importo, data)
├── Scadenze (boiler, filtri, contratti...)
└── Documenti (contratti, garanzie, planimetrie...)
```

L'agente interroga questo grafo ad ogni turno. Ha *contesto* reale, non solo memoria della conversazione.

**3. GitHub Action come ETL periodico**

Una Action settimanale aggrega fonti pubbliche e produce JSON statici:

```
/data/
  energia-prezzi.json      ← prezzi energia ARERA aggiornati
  bonus-edilizi.json       ← incentivi attivi da ENEA / Governo
  meteo-alert.json         ← alert meteo per zona (da API pubblica)
```

L'agente carica questi file come contesto. Nessun backend in ascolto, nessun costo runtime. La freschezza dei dati è garantita dal cron della Action, non da un server.

**4. LLM Adapter — swappabile per design**

```js
// Cambi una riga per cambiare provider
const llm = new LLMAdapter({ provider: 'claude' })  // o 'openai', 'ollama'
```

Stessa interfaccia, provider intercambiabili. Self-hostabile con Ollama per chi vuole privacy totale.

---

## Tool inclusi nella demo

| Tool | Trigger esempio | Azione |
|---|---|---|
| `control_device` | "Accendi il soggiorno" | Simula chiamata domotica (stub → integrabile con Home Assistant) |
| `record_expense` | "Ho pagato 180€ di luce" | Scrive su IndexedDB, aggiorna aggregati |
| `query_expenses` | "Quanto ho speso di gas?" | Legge IndexedDB, risponde con dato |
| `set_reminder` | "Ricordami il boiler venerdì" | Crea entry scadenza, notifica browser |
| `query_bonus` | "C'è un bonus per le finestre?" | Legge bonus-edilizi.json da CDN |
| `home_status` | "Com'è messa casa?" | Aggregato: dispositivi, spese mese, prossime scadenze |

---

## Cosa dimostra tecnicamente

Questo progetto non è un'app. È una **dimostrazione di pensiero architetturale**.

- **Function calling implementato da zero** in vanilla JS, senza SDK, con schema dichiarativo
- **Offline-first reale**: Service Worker + IndexedDB, funziona senza connessione dopo il primo caricamento
- **ETL asincrono serverless**: GitHub Action come pipeline dati — pattern usato in produzione da team seri, raramente visto in progetti personali
- **Adapter pattern** applicato all'LLM: il provider è un dettaglio di configurazione, non un accoppiamento
- **Domain modeling**: lo schema IndexedDB riflette un modello di dominio preciso (casa come grafo), non un semplice key-value store
- **Zero lock-in**: l'utente possiede i suoi dati, può esportarli, può cambiare LLM provider

---

## Estensioni naturali

Il core è un runtime per tool domestici. Le estensioni ovvie:

- **Integrazione Home Assistant** — `control_device` diventa reale via API locale
- **Import estratti conto** — parsing PDF/CSV per popolare le spese automaticamente
- **Multi-casa** — profili separati su IndexedDB, stessa UI
- **Tool marketplace** — tool scritti dalla community, caricati come moduli ES
- **Voice input** — Web Speech API, già compatibile con l'interfaccia

---

## Struttura repo

```
casa/
├── index.html
├── app.js                  ← entry point, orchestrazione
├── core/
│   ├── agent.js            ← loop conversazionale + tool dispatch
│   ├── llm-adapter.js      ← interfaccia unificata LLM
│   ├── memory.js           ← IndexedDB wrapper con schema
│   └── context-loader.js   ← carica JSON statici da CDN
├── tools/
│   ├── control-device.js
│   ├── record-expense.js
│   ├── query-expenses.js
│   ├── set-reminder.js
│   ├── query-bonus.js
│   └── home-status.js
├── data/                   ← generato da GitHub Action, non editare
│   ├── energia-prezzi.json
│   ├── bonus-edilizi.json
│   └── meteo-alert.json
├── .github/
│   └── workflows/
│       └── update-data.yml ← ETL settimanale
├── style.css
└── README.md
```

---

## Status

- [ ] UI chat — design e implementazione
- [ ] Core agent loop con tool dispatch
- [ ] LLM Adapter (Claude + OpenAI)
- [ ] IndexedDB schema v1 (stanze, dispositivi, spese, scadenze)
- [ ] Tool: record_expense, query_expenses
- [ ] Tool: set_reminder
- [ ] Tool: home_status
- [ ] Tool: control_device (stub + Home Assistant bridge)
- [ ] Tool: query_bonus
- [ ] GitHub Action: ETL bonus-edilizi (ENEA)
- [ ] GitHub Action: ETL prezzi energia (ARERA)
- [ ] Service Worker — offline support
- [ ] Export dati (JSON / CSV)
- [ ] README tecnico da portfolio

---

*gestione.casa — perché la casa più intelligente non è quella con più sensori,  
è quella dove i dati restano tuoi.*