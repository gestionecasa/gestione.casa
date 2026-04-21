// core/fake-agent.js
// Keyword-based fake agent for UI demo. Replaces a real LLM adapter.

const FakeAgent = (() => {

  // ─────────────────────────────────────────
  // HOME STATE — simulates IndexedDB data
  // ─────────────────────────────────────────
  const state = {
    devices: {
      'luci-soggiorno':  { label: 'Luci soggiorno',  type: 'luce', room: 'soggiorno',  on: false },
      'luci-cucina':     { label: 'Luci cucina',     type: 'luce', room: 'cucina',     on: true  },
      'luci-camera':     { label: 'Luci camera',     type: 'luce', room: 'camera',     on: false },
      'luci-bagno':      { label: 'Luci bagno',      type: 'luce', room: 'bagno',      on: false },
      'luci-studio':     { label: 'Luci studio',     type: 'luce', room: 'studio',     on: true  },
      'luci-corridoio':  { label: 'Luci corridoio',  type: 'luce', room: 'corridoio',  on: false },
      'tv-soggiorno':    { label: 'TV soggiorno',    type: 'tv',   room: 'soggiorno',  on: false },
      'lavatrice':       { label: 'Lavatrice',       type: 'elettrodomestico', room: 'lavanderia', on: false, cycle: null, minutesLeft: 0 },
      'lavastoviglie':   { label: 'Lavastoviglie',   type: 'elettrodomestico', room: 'cucina',     on: false, cycle: null, minutesLeft: 0 },
      'forno':           { label: 'Forno',           type: 'elettrodomestico', room: 'cucina',     on: false },
      'riscaldamento':   { label: 'Riscaldamento',   type: 'clima', room: 'centrale',  on: true,  temp: 21 },
    },
    expenses: {
      luce:  { thisMonth: 87,  ytd: 542, vsLastYear: +8.3 },
      gas:   { thisMonth: 124, ytd: 891, vsLastYear: -3.1 },
      acqua: { thisMonth: 23,  ytd: 187, vsLastYear:  0.0 },
    },
    deadlines: [
      { id: 'water-filter',   name: 'Filtro acqua frigo',    date: '2026-05-01', daysLeft: 10,  provider: null },
      { id: 'gas-contract',   name: 'Contratto gas ENI',     date: '2026-05-15', daysLeft: 24,  provider: 'ENI Gas e Luce' },
      { id: 'boiler-service', name: 'Revisione caldaia',     date: '2026-06-01', daysLeft: 41,  provider: null },
      { id: 'home-insurance', name: 'Assicurazione casa',    date: '2026-09-30', daysLeft: 162, provider: 'Generali' },
    ],
    reminders: [],
    temperature: { inside: 21.5, outside: 16.2 },
  };

  // ─────────────────────────────────────────
  // TEXT HELPERS
  // ─────────────────────────────────────────

  // Normalize: lowercase + strip accents + collapse spaces
  function norm(s) {
    return s.toLowerCase()
      .replace(/[àáâã]/g, 'a').replace(/[èéêë]/g, 'e')
      .replace(/[ìíî]/g, 'i').replace(/[òóô]/g, 'o')
      .replace(/[ùúû]/g, 'u')
      .replace(/\s+/g, ' ').trim();
  }

  function hhmm(date) {
    return `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
  }

  function nowStr() { return hhmm(new Date()); }

  function addMinutes(min) { return hhmm(new Date(Date.now() + min * 60000)); }

  function lightsOn()  { return Object.values(state.devices).filter(d => d.type === 'luce' && d.on); }
  function lightsOff() { return Object.values(state.devices).filter(d => d.type === 'luce' && !d.on); }

  // Extract room from message
  function extractRoom(m) {
    if (/soggior|salone|living/.test(m))          return 'soggiorno';
    if (/cucin/.test(m))                          return 'cucina';
    if (/camer|letto|dormir|notte/.test(m))       return 'camera';
    if (/bagn|toilet/.test(m))                    return 'bagno';
    if (/studi|uffici/.test(m))                   return 'studio';
    if (/corridoi|ingress/.test(m))               return 'corridoio';
    return null;
  }

  // Extract time expression from message
  function extractTime(m) {
    // "alle HH:MM" or "alle HH" or "alle HH di sera/mattina"
    const t1 = m.match(/alle\s+(\d{1,2})[:\.](\d{2})/);
    if (t1) return `${t1[1].padStart(2,'0')}:${t1[2]}`;
    const t2 = m.match(/alle\s+(\d{1,2})(?:\s+(di\s+sera|di\s+mattina|del\s+mattino|di\s+notte))?/);
    if (t2) {
      let h = parseInt(t2[1]);
      if (t2[2] && /sera|notte/.test(t2[2]) && h < 12) h += 12;
      return `${h.toString().padStart(2,'0')}:00`;
    }
    const t3 = m.match(/(\d{2})[:\.](\d{2})/);
    if (t3) return `${t3[1]}:${t3[2]}`;
    if (/mezzanott|00:00|midnight/.test(m)) return '00:00';
    return null;
  }

  // Extract amount (euros) from message
  function extractAmount(m) {
    const match = m.match(/(\d+(?:[,\.]\d{1,2})?)\s*(?:euro|€)?/);
    return match ? parseFloat(match[1].replace(',', '.')) : null;
  }

  // Build a simple reminder label from message
  function extractReminderText(raw) {
    let s = raw
      .replace(/^(ricordami|avvisami|metti un promemoria per|imposta un promemoria per)\s*(di\s*|che\s*)?/i, '')
      .replace(/\s+alle?\s+\d{1,2}[:\.]?\d{0,2}.*$/i, '')
      .trim();
    return s.charAt(0).toUpperCase() + s.slice(1) || 'Promemoria';
  }

  // ─────────────────────────────────────────
  // INTENT PATTERNS
  // Each entry: { test(normalizedMsg) → bool, handle(normalizedMsg, rawMsg) → ResponseObj }
  // ─────────────────────────────────────────
  const intents = [

    // ── GREETING ──────────────────────────
    {
      test: m => /^(buongiorno|buonasera|buonanotte|ciao|salve|hey|hei|oh casa|casa ciao)/.test(m),
      handle() {
        const h = new Date().getHours();
        const gr = h < 12 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
        const on = lightsOn().length;
        return {
          message: `${gr}! Casa va bene — ${on} ${on === 1 ? 'luce accesa' : 'luci accese'}, ${state.temperature.inside}°C dentro.\n\nCosa vuoi fare?`,
        };
      },
    },

    // ── HOME STATUS ────────────────────────
    {
      test: m => /com[e'].*messa.*casa|stato.*casa|panoramic|riassunt|overview|tutto.*ok|cosa.*acceso|com[e'].*sta.*casa/.test(m),
      handle() {
        const on = lightsOn();
        const appl = Object.values(state.devices).filter(d => d.type === 'elettrodomestico' && d.on);
        const next = state.deadlines[0];
        return {
          tool: 'home_status',
          toolParams: { dettaglio: 'completo' },
          toolResult: `${on.length} luci · ${appl.length} elettrodomestici · ${state.temperature.inside}°C`,
          message: `**Casa in ordine** — riepilogo:\n\n` +
            `💡 **Luci:** ${on.length} accese${on.length ? ` (${on.map(d => d.room).join(', ')})` : ''}\n` +
            `🌡️ **Temperatura:** ${state.temperature.inside}°C dentro · ${state.temperature.outside}°C fuori\n` +
            `💶 **Spese mese:** luce €${state.expenses.luce.thisMonth} · gas €${state.expenses.gas.thisMonth}\n` +
            `⏰ **Prossima scadenza:** ${next.name} tra ${next.daysLeft} giorni`,
        };
      },
    },

    // ── LIGHTS ON (with room) ──────────────
    {
      test: m => /(accend[ieo]|alza|illumina|metti.*luc).*(luc[ei]|soggior|cucin|camer|bagn|studi|corridoi)/
               .test(m) || /(luc[ei]|soggior|cucin|camer|bagn|studi).*(accend[ieo]|alza)/.test(m),
      handle(m) {
        const room = extractRoom(m);
        if (room) {
          const key = `luci-${room}`;
          state.devices[key].on = true;
          return {
            tool: 'control_device',
            toolParams: { device: state.devices[key].label, action: 'accendi' },
            toolResult: `✓ ${state.devices[key].label} ON`,
            message: `Luci del **${room}** accese. Sono le ${nowStr()}.`,
          };
        }
        // All lights
        Object.values(state.devices).filter(d => d.type === 'luce').forEach(d => d.on = true);
        return {
          tool: 'control_device',
          toolParams: { device: 'Tutte le luci', action: 'accendi' },
          toolResult: '✓ Tutte le luci ON',
          message: `Ho acceso tutte le luci di casa. Sono le ${nowStr()}.`,
        };
      },
    },

    // ── LIGHTS OFF ─────────────────────────
    {
      test: m => /spegn[ieo].*(luc[ei]|soggior|cucin|camer|bagn|studi|corridoi|tutte|tutto)/
               .test(m) || /(luc[ei]).*(spegn[ieo])/.test(m),
      handle(m) {
        const room = extractRoom(m);
        if (room) {
          const key = `luci-${room}`;
          state.devices[key].on = false;
          return {
            tool: 'control_device',
            toolParams: { device: state.devices[key].label, action: 'spegni' },
            toolResult: `✓ ${state.devices[key].label} OFF`,
            message: `Luci del **${room}** spente.`,
          };
        }
        Object.values(state.devices).filter(d => d.type === 'luce').forEach(d => d.on = false);
        return {
          tool: 'control_device',
          toolParams: { device: 'Tutte le luci', action: 'spegni' },
          toolResult: '✓ Tutte le luci OFF',
          message: `Tutte le luci spente. Buonanotte! 🌙`,
        };
      },
    },

    // ── LIGHTS STATUS ──────────────────────
    {
      test: m => /quante.*luc[ei]|luc[ei].*accese|luc[ei].*stato|stato.*luc[ei]/.test(m),
      handle() {
        const on  = lightsOn();
        const off = lightsOff();
        if (on.length === 0) {
          return { message: `Nessuna luce accesa in casa.` };
        }
        return {
          tool: 'query_device',
          toolParams: { device: 'luci', query: 'stato' },
          toolResult: `${on.length} accese · ${off.length} spente`,
          message: `${on.length} ${on.length === 1 ? 'luce accesa' : 'luci accese'}: **${on.map(d => d.room).join(', ')}**.\n${off.length > 0 ? `Spente: ${off.map(d => d.room).join(', ')}.` : 'Tutte le luci sono accese.'}`,
        };
      },
    },

    // ── TV ON ──────────────────────────────
    {
      test: m => /(accend[ieo]|metti.*su|apri).*(tv|televi|tele\b)/.test(m),
      handle() {
        state.devices['tv-soggiorno'].on = true;
        return {
          tool: 'control_device',
          toolParams: { device: 'TV soggiorno', action: 'accendi' },
          toolResult: '✓ TV ON',
          message: `TV del soggiorno accesa. Buona visione! 📺`,
        };
      },
    },

    // ── TV OFF (scheduled or immediate) ───
    {
      test: m => /(spegn[ieo]|speli|chiudi).*(tv|televi)|(tv|televi).*(spegn[ieo]|speli|off)/.test(m),
      handle(m) {
        const orario = extractTime(m);
        const isFuture = orario || /dopo|tra|mezzan|stanott|mezzanott/.test(m);
        if (isFuture) {
          const t = orario || '00:00';
          return {
            tool: 'set_reminder',
            toolParams: { action: 'spegni_tv', orario: t },
            toolResult: `✓ Spegnimento TV programmato alle ${t}`,
            message: `Ho programmato lo spegnimento della TV alle **${t}**. Ti avviso 5 minuti prima. 🕛`,
          };
        }
        state.devices['tv-soggiorno'].on = false;
        return {
          tool: 'control_device',
          toolParams: { device: 'TV soggiorno', action: 'spegni' },
          toolResult: '✓ TV OFF',
          message: `TV spenta.`,
        };
      },
    },

    // ── LAVATRICE — avvia ──────────────────
    {
      test: m => /lavatric/.test(m) && /(avvia|accend[ieo]|metti|fai.*gir|parti|start)/.test(m),
      handle() {
        state.devices['lavatrice'].on = true;
        state.devices['lavatrice'].cycle = 'Cotone 40°';
        state.devices['lavatrice'].minutesLeft = 87;
        const fine = addMinutes(87);
        return {
          tool: 'control_device',
          toolParams: { device: 'Lavatrice', action: 'avvia', programma: 'Cotone 40°' },
          toolResult: '✓ Ciclo avviato — stima 1h 27min',
          message: `Lavatrice avviata con programma **Cotone 40°**. Fine ciclo prevista alle **${fine}**. Ti avviso quando ha finito.`,
        };
      },
    },

    // ── LAVATRICE — avvisami ───────────────
    {
      test: m => /lavatric/.test(m) && /(avvisa|notific|dimmelo|fammelo sapere|quando.*finit|quando.*ha finit)/.test(m),
      handle() {
        const d = state.devices['lavatrice'];
        const status = d.on
          ? `Stima fine: ${addMinutes(d.minutesLeft)}.`
          : `Non è in funzione al momento — avvisami se la vuoi avviare.`;
        return {
          tool: 'set_reminder',
          toolParams: { trigger: 'lavatrice_fine', channel: 'notifica' },
          toolResult: '✓ Notifica impostata',
          message: `Perfetto, ti avviso quando la lavatrice ha finito il ciclo. ${status}`,
        };
      },
    },

    // ── LAVATRICE — stato ──────────────────
    {
      test: m => /lavatric/.test(m) && /(stato|com.*sta|quant.*manc|finit|andando|progress)/.test(m),
      handle() {
        const d = state.devices['lavatrice'];
        if (d.on) {
          return {
            tool: 'query_device',
            toolParams: { device: 'Lavatrice' },
            toolResult: `In funzione — ${d.minutesLeft} min rimanenti`,
            message: `La lavatrice è in funzione con programma **${d.cycle}**. Mancano circa **${d.minutesLeft} minuti** (fine alle ${addMinutes(d.minutesLeft)}).`,
          };
        }
        return {
          tool: 'query_device',
          toolParams: { device: 'Lavatrice' },
          toolResult: 'Ferma',
          message: `La lavatrice è ferma. Vuoi avviarla?`,
        };
      },
    },

    // ── LAVATRICE — spegni ─────────────────
    {
      test: m => /lavatric/.test(m) && /spegn[ieo]/.test(m),
      handle() {
        state.devices['lavatrice'].on = false;
        state.devices['lavatrice'].cycle = null;
        return {
          tool: 'control_device',
          toolParams: { device: 'Lavatrice', action: 'spegni' },
          toolResult: '✓ Ciclo interrotto',
          message: `Lavatrice spenta. Ricorda che il bucato potrebbe essere bagnato.`,
        };
      },
    },

    // ── LAVASTOVIGLIE — spegni ─────────────
    {
      test: m => /(lavastovigl|lava.?stovig)/.test(m) && /spegn[ieo]/.test(m),
      handle() {
        state.devices['lavastoviglie'].on = false;
        return {
          tool: 'control_device',
          toolParams: { device: 'Lavastoviglie', action: 'spegni' },
          toolResult: '✓ Ciclo interrotto',
          message: `Lavastoviglie spenta.`,
        };
      },
    },

    // ── LAVASTOVIGLIE — avvia ──────────────
    {
      test: m => /(lavastovigl|lava.?stovig)/.test(m),
      handle() {
        state.devices['lavastoviglie'].on = true;
        state.devices['lavastoviglie'].minutesLeft = 65;
        const fine = addMinutes(65);
        return {
          tool: 'control_device',
          toolParams: { device: 'Lavastoviglie', action: 'avvia', programma: 'Eco 50°' },
          toolResult: '✓ Ciclo avviato — stima 1h 05min',
          message: `Lavastoviglie avviata con programma **Eco 50°**. Fine ciclo prevista alle **${fine}**.`,
        };
      },
    },

    // ── RISCALDAMENTO — accendi ────────────
    {
      test: m => /(accend[ieo]|alza|aumenta|metti.*su).*(riscaldament|scalda|caldai|termosifon|caldo)/.test(m),
      handle(m) {
        state.devices['riscaldamento'].on = true;
        const tm = m.match(/(\d{1,2})\s*(?:grad[io]|°)/);
        const temp = tm ? parseInt(tm[1]) : 21;
        state.devices['riscaldamento'].temp = temp;
        return {
          tool: 'control_device',
          toolParams: { device: 'Riscaldamento', action: 'accendi', temperatura: `${temp}°C` },
          toolResult: `✓ Riscaldamento ON — target ${temp}°C`,
          message: `Riscaldamento acceso, temperatura target a **${temp}°C**. Ora in casa ci sono ${state.temperature.inside}°C — ci vorranno circa 20 minuti.`,
        };
      },
    },

    // ── RISCALDAMENTO — spegni ─────────────
    {
      test: m => /spegn[ieo].*(riscaldament|scalda|caldai|termosifon)/.test(m),
      handle() {
        state.devices['riscaldamento'].on = false;
        return {
          tool: 'control_device',
          toolParams: { device: 'Riscaldamento', action: 'spegni' },
          toolResult: '✓ Riscaldamento OFF',
          message: `Riscaldamento spento. Temperatura attuale: ${state.temperature.inside}°C.`,
        };
      },
    },

    // ── TEMPERATURA ────────────────────────
    {
      test: m => /(temperatura|quant.*grad[io]|che.*caldo|che.*freddo|grad[io].*casa|fa.*caldo|fa.*freddo)/.test(m),
      handle() {
        const risc = state.devices['riscaldamento'];
        return {
          tool: 'query_sensors',
          toolParams: { sensore: 'temperatura' },
          toolResult: `Dentro: ${state.temperature.inside}°C — Fuori: ${state.temperature.outside}°C`,
          message: `In casa ci sono **${state.temperature.inside}°C**. Fuori sono ${state.temperature.outside}°C.\n\nIl riscaldamento è ${risc.on ? `attivo (target ${risc.temp}°C)` : 'spento'}.`,
        };
      },
    },

    // ── SPESE — luce ───────────────────────
    {
      test: m => /(quant[oa].*pagh|cost[ao]|bolletta|spes[ao]).*(luc[ei]|elettric)|(luc[ei]|elettric).*(quant|cost|spes|bolletta)/.test(m),
      handle() {
        const e = state.expenses.luce;
        const sign = e.vsLastYear >= 0 ? '+' : '';
        return {
          tool: 'query_expenses',
          toolParams: { categoria: 'luce', periodo: 'corrente' },
          toolResult: `Mese: €${e.thisMonth} — YTD: €${e.ytd}`,
          message: `Questo mese hai speso **€${e.thisMonth}** di luce.\n\nNel 2026 siamo a **€${e.ytd}** totali (${sign}${e.vsLastYear.toFixed(0)}% vs 2025). La prossima bolletta arriva tra circa 2 settimane.`,
        };
      },
    },

    // ── SPESE — gas ────────────────────────
    {
      test: m => /(quant[oa].*pagh|cost[ao]|bolletta|spes[ao]).*(gas)|(gas).*(quant|cost|spes|bolletta)/.test(m),
      handle() {
        const e = state.expenses.gas;
        const sign = e.vsLastYear >= 0 ? '+' : '';
        const trend = e.vsLastYear < 0 ? 'in calo' : 'in aumento';
        return {
          tool: 'query_expenses',
          toolParams: { categoria: 'gas', periodo: 'corrente' },
          toolResult: `Mese: €${e.thisMonth} — YTD: €${e.ytd}`,
          message: `Questo mese hai speso **€${e.thisMonth}** di gas.\n\nNel 2026 siamo a **€${e.ytd}** totali, ${trend} del ${sign}${e.vsLastYear.toFixed(0)}% vs 2025. Ottimo!`,
        };
      },
    },

    // ── SPESE — acqua ──────────────────────
    {
      test: m => /(acqua).*(quant|cost|spes|bolletta)|(quant|cost|spes|bolletta).*(acqua)/.test(m),
      handle() {
        const e = state.expenses.acqua;
        return {
          tool: 'query_expenses',
          toolParams: { categoria: 'acqua', periodo: 'corrente' },
          toolResult: `Mese: €${e.thisMonth} — YTD: €${e.ytd}`,
          message: `Questo mese hai speso **€${e.thisMonth}** di acqua.\n\nNel 2026 siamo a **€${e.ytd}** totali — stabile rispetto all'anno scorso.`,
        };
      },
    },

    // ── SPESE — riepilogo totale ───────────
    {
      test: m => /(tutte|totale|riepilog|riassunt).*(spes|utenz|bollette)|(spes|utenz|bollette).*(tutte|totale)/.test(m),
      handle() {
        const tot = state.expenses.luce.thisMonth + state.expenses.gas.thisMonth + state.expenses.acqua.thisMonth;
        return {
          tool: 'query_expenses',
          toolParams: { categoria: 'tutte', periodo: 'mese_corrente' },
          toolResult: `Totale mese: €${tot}`,
          message: `Spese utenze questo mese:\n\n⚡ Luce: **€${state.expenses.luce.thisMonth}**\n🔥 Gas: **€${state.expenses.gas.thisMonth}**\n💧 Acqua: **€${state.expenses.acqua.thisMonth}**\n\n**Totale: €${tot}**`,
        };
      },
    },

    // ── REGISTRA SPESA ─────────────────────
    {
      test: m => /(ho pagato|pagato|registra).+\d/.test(m),
      handle(m, raw) {
        const amount = extractAmount(m);
        let cat = 'altro';
        if (/(luc[ei]|elettric)/.test(m)) cat = 'luce';
        else if (/gas/.test(m)) cat = 'gas';
        else if (/acqua/.test(m)) cat = 'acqua';

        if (amount && cat !== 'altro') {
          state.expenses[cat].thisMonth += amount;
          state.expenses[cat].ytd += amount;
        }
        return {
          tool: 'record_expense',
          toolParams: { importo: amount || '?', categoria: cat },
          toolResult: `✓ Registrato €${amount} · ${cat}`,
          message: `Registrato! **€${amount}** di ${cat} aggiunti ad aprile.\n\nTotale ${cat} questo mese: **€${state.expenses[cat]?.thisMonth || amount}**.`,
        };
      },
    },

    // ── SCADENZA GAS ───────────────────────
    {
      test: m => /gas/.test(m) && /(scad[ei]|rinnov|contratt|quando|finisce)/.test(m),
      handle() {
        const d = state.deadlines.find(x => x.id === 'gas-contract');
        return {
          tool: 'query_deadlines',
          toolParams: { tipo: 'contratto_gas' },
          toolResult: `Scadenza: ${d.date} — ${d.daysLeft} giorni`,
          message: `Il contratto gas con **${d.provider}** scade il **15 maggio 2026**, tra ${d.daysLeft} giorni.\n\nVuoi che imposti un promemoria per confrontare le offerte prima?`,
        };
      },
    },

    // ── SCADENZA CALDAIA ───────────────────
    {
      test: m => /(caldai|boiler|revisione)/.test(m) && /(scad[ei]|quando|manutenzion|revisione)/.test(m),
      handle() {
        const d = state.deadlines.find(x => x.id === 'boiler-service');
        return {
          tool: 'query_deadlines',
          toolParams: { tipo: 'revisione_caldaia' },
          toolResult: `Prossima: ${d.date} — ${d.daysLeft} giorni`,
          message: `La prossima revisione della caldaia è il **1° giugno 2026**, tra ${d.daysLeft} giorni.\n\nSei già in regola per quest'anno.`,
        };
      },
    },

    // ── SCADENZE GENERALI ──────────────────
    {
      test: m => /(scadenz|scad[ei]|rinnov|prossim.*contratt|contratt.*scad)/.test(m),
      handle() {
        const list = state.deadlines.slice(0, 4)
          .map(d => {
            const dot = d.daysLeft <= 14 ? '🔴' : d.daysLeft <= 45 ? '🟡' : '🟢';
            return `${dot} **${d.name}** — tra ${d.daysLeft} giorni (${d.date})`;
          }).join('\n');
        return {
          tool: 'query_deadlines',
          toolParams: { tipo: 'tutte', limite: 4 },
          toolResult: `${state.deadlines.length} scadenze trovate`,
          message: `Prossime scadenze:\n\n${list}\n\nLa più urgente è il **filtro acqua frigo** tra soli ${state.deadlines[0].daysLeft} giorni.`,
        };
      },
    },

    // ── PROMEMORIA ─────────────────────────
    {
      test: m => /(ricordam[ei]|avvisam[ei]|metti.*promemoria|imposta.*promemoria|non.*dimentic)/.test(m),
      handle(m, raw) {
        const orario = extractTime(m);
        const testo  = extractReminderText(raw);
        state.reminders.push({ id: Date.now(), text: testo, time: orario });
        return {
          tool: 'set_reminder',
          toolParams: { testo, orario: orario || 'da definire' },
          toolResult: '✓ Promemoria impostato',
          message: `Promemoria impostato${orario ? ` per le **${orario}**` : ''}: "${testo}". Ti notifico quando è il momento. ✓`,
        };
      },
    },

    // ── BONUS EDILIZI ──────────────────────
    {
      test: m => /(bonus|incentiv|detrazion|ecobonus|superbonus|agevolazion)/.test(m),
      handle(m) {
        let nome = 'Ecobonus';
        let dettaglio = 'Ecobonus 50-65%, Bonus Ristrutturazione 50%, Sismabonus. Dimmi che tipo di intervento ti interessa.';
        if (/cappott|isolament|involucr/.test(m)) {
          nome = 'Ecobonus 65%';
          dettaglio = 'per cappotto termico e isolamento dell\'involucro. Max €100.000, in 10 anni.';
        } else if (/finestre|serrament|infissi/.test(m)) {
          nome = 'Ecobonus 50%';
          dettaglio = 'per sostituzione finestre e infissi a bassa trasmittanza. Max €60.000, in 10 anni.';
        } else if (/caldai|riscaldament/.test(m)) {
          nome = 'Bonus Caldaia 50%';
          dettaglio = 'per sostituzione con caldaia a condensazione classe A. Max €30.000, in 10 anni.';
        } else if (/fotovoltai|solar/.test(m)) {
          nome = 'Detrazione 50%';
          dettaglio = 'per impianti fotovoltaici su abitazioni principali. Combinabile con altri bonus.';
        }
        return {
          tool: 'query_bonus',
          toolParams: { tipo: nome },
          toolResult: `Trovato: ${nome}`,
          message: `**${nome}** — ${dettaglio}\n\nFonte: ENEA / Agenzia delle Entrate, aprile 2026.`,
        };
      },
    },

    // ── CHECK SERALE ───────────────────────
    {
      test: m => /(prima.*letto|vado.*dormir|buonanotte|notte|tutto.*spento|check.*notte)/.test(m),
      handle() {
        const luciOn = lightsOn();
        const appl = Object.values(state.devices).filter(d => d.type === 'elettrodomestico' && d.on);
        const issues = [];
        if (luciOn.length > 0) issues.push(`⚠️ Luci accese: ${luciOn.map(d => d.room).join(', ')}`);
        if (appl.length > 0)   issues.push(`⚠️ Elettrodomestici: ${appl.map(d => d.label).join(', ')}`);
        if (state.devices['tv-soggiorno'].on) issues.push(`📺 TV ancora accesa`);
        const risc = state.devices['riscaldamento'];

        if (issues.length === 0) {
          return {
            tool: 'home_status',
            toolParams: { check: 'notte' },
            toolResult: '✓ Tutto ok',
            message: `Tutto a posto! ✓\n\nNessuna luce accesa, nessun elettrodomestico in funzione. Riscaldamento: ${risc.on ? `attivo a ${risc.temp}°C (puoi abbassarlo a 18°C per la notte)` : 'spento'}.\n\nBuona notte! 🌙`,
          };
        }
        return {
          tool: 'home_status',
          toolParams: { check: 'notte' },
          toolResult: `${issues.length} cose da verificare`,
          message: `Check notturno:\n\n${issues.join('\n')}\n\n✅ TV: spenta\n✅ Lavatrice: ferma\n\nVuoi che spenga tutto?`,
        };
      },
    },

    // ── FALLBACK ───────────────────────────
    {
      test: () => true,
      handle() {
        const examples = [
          '"Accendi le luci del soggiorno"',
          '"Quanto paghiamo di gas?"',
          '"Quando scade il contratto gas?"',
          '"Avvisami quando la lavatrice finisce"',
          '"Spegni la TV dopo mezzanotte"',
          '"Com\'è messa casa?"',
        ];
        const ex = examples[Math.floor(Math.random() * examples.length)];
        return {
          message: `Non ho capito bene. Posso aiutarti con:\n\n• Luci e dispositivi\n• Spese e bollette\n• Scadenze e contratti\n• Promemoria e avvisi\n• Stato della casa\n\nProva con qualcosa tipo: ${ex}`,
        };
      },
    },
  ];

  // ─────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────

  async function process(rawMsg) {
    const m = norm(rawMsg);
    for (const intent of intents) {
      if (intent.test(m)) {
        const result = intent.handle(m, rawMsg);
        // Realistic delay: longer when there's a tool call
        const delay = result.tool
          ? 1100 + Math.random() * 700
          :  600 + Math.random() * 400;
        await sleep(delay);
        return result;
      }
    }
  }

  function getState() {
    return state;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  return { process, getState, state };
})();
