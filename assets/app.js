// app.js — Chat UI controller

const App = (() => {
  const $ = id => document.getElementById(id);

  const messagesEl    = $('messages');
  const container     = $('messagesContainer');
  const input         = $('userInput');
  const sendBtn       = $('sendBtn');
  const clearBtn      = $('clearBtn');
  const suggestionsRow = $('suggestionsRow');
  const statusGrid    = $('statusGrid');
  const deadlinesList = $('deadlinesList');
  const expensesMini  = $('expensesMini');
  const sidebar       = $('sidebar');
  const sidebarToggle = $('sidebarToggle');
  const agentTagline  = $('agentTagline');

  let isBusy = false;
  const sidebarRevealed = new Set(); // keys of sidebar values already revealed
  let discoveryUiBound = false;
  let discoveryLogLines = new Set();
  let discoveryHandledCompletion = null;

  const INIT_SUGGESTIONS = [
    'Hey Casa, accendi le luci del soggiorno',
    "Hey Casa, com'è messa casa?",
    'Hey Casa, quanto paghiamo di luce?',
    'Hey Casa, quando scade il contratto gas?',
  ];

  // ── INIT ───────────────────────────────────
  function init() {
    McpLayer.loadFromCache();
    renderWelcome();
    renderSuggestions(INIT_SUGGESTIONS);
    renderSidebar();
    renderAuthWidget();
    bindEvents();
    bindDiscoveryUi();
    initMic();
    updateInputLayout();
    runDiscovery();
  }

  // ── BROKER DISCOVERY (background) ─────────
  function isLocalContext() {
    const h = location.hostname;
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (navigator.standalone) return true;
    return isLocalhost()
      || /^192\.168\./.test(h) || /^10\./.test(h)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
      || h.endsWith('.local');
  }

  function isLocalhost() {
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  }

  function runDiscovery() {
    if (BrokerDiscovery.getStatus().status === 'running') {
      showDiscoveryBar({ autoStart: false });
      return;
    }
    if (!isLocalContext()) return;
    if (!isLocalhost() && getSavedBroker()) return;
    showDiscoveryBar({ autoStart: true });
  }

  function bindDiscoveryUi() {
    if (discoveryUiBound) return;
    discoveryUiBound = true;

    const closeBtn   = $('discoveryBarClose');
    const detailsBtn = $('discoveryBarDetails');
    const logPanel   = $('discoveryLog');
    const logPre     = $('discoveryLogPre');

    closeBtn.addEventListener('click', () => {
      const s = BrokerDiscovery.getStatus();
      if (s.status === 'running') BrokerDiscovery.abort();
      $('discoveryBar').hidden = true;
      $('discoveryBar').style.display = 'none';
      logPanel.hidden = true;
    });

    detailsBtn.addEventListener('click', () => {
      const open = !logPanel.hidden;
      logPanel.hidden = open;
      detailsBtn.textContent = open ? 'Log' : 'Nascondi';
      detailsBtn.setAttribute('aria-expanded', String(!open));
      if (!open) logPre.scrollTop = logPre.scrollHeight;
    });

    BrokerDiscovery.onChange(evt => {
      if (evt.type === 'reset') {
        discoveryLogLines = new Set();
        logPre.textContent = '';
        discoveryHandledCompletion = null;
        return;
      }
      if (evt.line) appendDiscoveryLog(evt.line);
      syncDiscoveryBar(evt.status);
    });

    syncDiscoveryBar();
  }

  function appendDiscoveryLog(line) {
    const logPanel = $('discoveryLog');
    const logPre   = $('discoveryLogPre');
    if (discoveryLogLines.has(line)) return;
    discoveryLogLines.add(line);
    logPre.textContent += `${line}\n`;
    if (!logPanel.hidden) logPre.scrollTop = logPre.scrollHeight;
  }

  function syncDiscoveryLogs() {
    BrokerDiscovery.getLogs(500).forEach(appendDiscoveryLog);
  }

  function syncDiscoveryBar(status = BrokerDiscovery.getStatus()) {
    const bar        = $('discoveryBar');
    const spinner    = $('discoveryBarSpinner');
    const textEl     = $('discoveryBarText');
    const actionsEl  = $('discoveryBarActions');
    const detailsBtn = $('discoveryBarDetails');
    const logPanel   = $('discoveryLog');

    syncDiscoveryLogs();
    actionsEl.innerHTML = '';
    detailsBtn.textContent = logPanel.hidden ? 'Log' : 'Nascondi';
    detailsBtn.setAttribute('aria-expanded', String(!logPanel.hidden));

    if (status.status === 'idle') {
      bar.hidden = true;
      logPanel.hidden = true;
      return;
    }

    bar.hidden = false;
    bar.style.display = 'flex';

    if (status.status === 'running') {
      spinner.style.display = '';
      textEl.textContent = status.aborted
        ? 'Interruzione ricerca broker in corso…'
        : status.progress > 0
        ? `Ricerca broker in corso… ${status.progress}%`
        : 'Ricerca broker in corso…';
      return;
    }

    spinner.style.display = 'none';

    if (status.status === 'aborted') {
      textEl.textContent = 'Ricerca broker interrotta. Puoi vedere i log.';
      return;
    }

    if (status.status === 'completed' && status.found.length === 0) {
      textEl.textContent = 'Ricerca completata: nessun broker trovato. Puoi vedere i log.';
      return;
    }

    if (status.status === 'completed' && status.found.length > 0) {
      const key = `${status.startedAt}:${status.completedAt}:${status.found.length}`;
      bar.hidden = true;
      logPanel.hidden = true;
      if (discoveryHandledCompletion === key) return;
      discoveryHandledCompletion = key;
      const found = status.found.map(b => ({ ...b, icon: brokerIcon(b) }));
      const names = found.map(b => `${b.icon} **${b.name}**`).join(', ');
      addAgentMessage({
        message: `Ho trovato ${found.length === 1 ? 'un broker' : `${found.length} broker`} nella tua rete: ${names}.\n\nVuoi che mi connetta?`,
        _brokerFound: found,
      });
    }
  }

  function brokerIcon(broker) {
    return BrokerDiscovery.BROKERS.find(b => b.id === broker.id || b.name === broker.name)?.icon ?? '•';
  }

  function showDiscoveryBar({ autoStart = true } = {}) {
    bindDiscoveryUi();
    const status = BrokerDiscovery.getStatus();
    if (status.status === 'running') {
      syncDiscoveryBar(status);
      return;
    }
    if (autoStart) {
      showDiscoveryPending();
      BrokerDiscovery.scan();
    }
  }

  function showDiscoveryPending() {
    const bar     = $('discoveryBar');
    const spinner = $('discoveryBarSpinner');
    const textEl  = $('discoveryBarText');
    $('discoveryBarActions').innerHTML = '';
    $('discoveryBarDetails').textContent = 'Log';
    $('discoveryBarDetails').setAttribute('aria-expanded', 'false');
    spinner.style.display = '';
    textEl.textContent = 'Ricerca broker in corso…';
    bar.hidden = false;
    bar.style.display = 'flex';
  }

  async function connectBroker(broker) {
    console.groupCollapsed('[BrokerConnect] avvio connessione');
    console.log('broker selezionato:', broker);
    console.log('tools prima:', McpLayer.getTools().map(t => t.function?.name));
    try {
      saveBroker(broker);
      console.log('broker salvato in localStorage');
      agentTagline.textContent = `Connessione a ${broker.name}…`;
      const startedAt = performance.now();
      await McpLayer.initFromBroker(broker.url, broker.haToken || null, broker.id);
      const elapsed = Math.round(performance.now() - startedAt);
      const tools = McpLayer.getTools();
      console.log(`MCP init completato in ${elapsed}ms`);
      console.log('tools dopo:', tools.map(t => t.function?.name));
      agentTagline.textContent = `Connesso — ${broker.name}`;
      addAgentMessage({ message: `Connesso a **${broker.name}** su \`${broker.url}\`. ${tools.length} tool disponibili.` });
      return { ok: true, tools: tools.length };
    } catch (e) {
      console.error('[BrokerConnect] errore connessione:', e);
      agentTagline.textContent = 'Connessione broker fallita';
      addAgentMessage({ message: `Errore connessione MCP a **${broker.name}** su \`${broker.url}\`: ${e.message}` });
      return { ok: false, error: e };
    } finally {
      console.groupEnd();
    }
  }

  function saveBroker(broker) {
    try { localStorage.setItem('hc-broker', JSON.stringify(broker)); } catch {}
  }

  function getSavedBroker() {
    try { return JSON.parse(localStorage.getItem('hc-broker')); } catch { return null; }
  }

  // ── SIDEBAR ───────────────────────────────
  function ask(prompt) {
    return `<span class="val-ask" data-prompt="${esc(prompt)}" title="Clicca per sapere">??</span>`;
  }

  function renderSidebar() {
    const s = FakeAgent.getState();
    const on = Object.values(s.devices).filter(d => d.type === 'luce' && d.on);
    const totalLights = Object.values(s.devices).filter(d => d.type === 'luce').length;
    const activeAppl  = Object.values(s.devices).filter(d => d.type === 'elettrodomestico' && d.on);
    const risc = s.devices['riscaldamento'];

    // After a value has been revealed (post-click), show the real value; otherwise show ??
    // We track revealed state per card key via sidebarRevealed set.
    const R = sidebarRevealed;

    statusGrid.innerHTML = `
      <div class="status-card" data-key="luci">
        <div class="status-card-icon">💡</div>
        <div class="status-card-value ${on.length > 0 ? 'status-on' : 'status-off'}">
          ${R.has('luci') ? `${on.length}/${totalLights}` : ask('Quante luci ho accese adesso?')}
        </div>
        <div class="status-card-label">Luci accese</div>
      </div>
      <div class="status-card" data-key="temp">
        <div class="status-card-icon">🌡️</div>
        <div class="status-card-value">
          ${R.has('temp') ? `${s.temperature.inside}°` : ask('Che temperatura fa in casa?')}
        </div>
        <div class="status-card-label">Dentro${R.has('temp') ? ` · ${s.temperature.outside}° fuori` : ''}</div>
      </div>
      <div class="status-card" data-key="risc">
        <div class="status-card-icon">🔥</div>
        <div class="status-card-value ${risc.on ? 'status-active' : 'status-off'}">
          ${R.has('risc') ? (risc.on ? `${risc.temp}°C` : 'OFF') : ask('Com\'è il riscaldamento adesso?')}
        </div>
        <div class="status-card-label">Riscaldamento</div>
      </div>
      <div class="status-card" data-key="appl">
        <div class="status-card-icon">🔌</div>
        <div class="status-card-value ${activeAppl.length > 0 ? 'status-active' : ''}">
          ${R.has('appl') ? activeAppl.length : ask('Quali elettrodomestici sono accesi?')}
        </div>
        <div class="status-card-label">Elettrodomestici</div>
      </div>
    `;

    deadlinesList.innerHTML = s.deadlines.map(d => {
      const cls = d.daysLeft <= 14 ? 'urgent' : d.daysLeft <= 45 ? 'soon' : 'ok';
      const dKey = `dead-${d.id}`;
      return `
        <div class="deadline-item">
          <div class="deadline-dot ${cls}"></div>
          <span class="deadline-name">${esc(d.name)}</span>
          <span class="deadline-days">
            ${R.has(dKey) ? `${d.daysLeft}g` : ask(`Quando scade ${d.name}?`)}
          </span>
        </div>`;
    }).join('');

    expensesMini.innerHTML = [
      { icon: '⚡', label: 'Luce',  key: 'luce',  prompt: 'Quanto paghiamo di luce questo mese?'  },
      { icon: '🔥', label: 'Gas',   key: 'gas',   prompt: 'Quanto paghiamo di gas questo mese?'   },
      { icon: '💧', label: 'Acqua', key: 'acqua', prompt: 'Quanto paghiamo di acqua questo mese?' },
    ].map(({ icon, label, key, prompt }) => {
      const e = s.expenses[key];
      const tCls  = e.vsLastYear > 0 ? 'trend-up' : e.vsLastYear < 0 ? 'trend-down' : 'trend-flat';
      const tIcon = e.vsLastYear > 0 ? '↑' : e.vsLastYear < 0 ? '↓' : '→';
      const eKey  = `exp-${key}`;
      return `
        <div class="expense-item">
          <span class="expense-cat">${icon} ${label}</span>
          <span class="expense-amount">
            ${R.has(eKey)
              ? `€${e.thisMonth}<span class="expense-trend ${tCls}">${tIcon}</span>`
              : ask(prompt)}
          </span>
        </div>`;
    }).join('');
  }

  // ── MESSAGES ──────────────────────────────
  function renderWelcome() {
    const examples = [
      { icon: '💡', text: 'accendi le luci del soggiorno' },
      { icon: '💶', text: 'quanto paghiamo di luce?' },
      { icon: '🔄', text: 'avvisami quando finisce la lavatrice' },
      { icon: '📅', text: 'quando scade il contratto gas?' },
    ];
    messagesEl.innerHTML = `
      <div class="welcome-msg">
        <img src="assets/images/logo.png" alt="Casa" class="welcome-logo">
        <div class="welcome-headline"><span class="welcome-hey">Hey</span> <span class="welcome-casa">Casa.</span></div>
        <div class="welcome-sub">Il tuo agente domestico. Controlla dispositivi, tieni traccia delle spese, gestisce le scadenze — tutto privato, tutto tuo.</div>
        <div class="welcome-examples">
          ${examples.map(e => `
            <button class="welcome-example" data-text="Hey Casa, ${esc(e.text)}">
              <span class="welcome-example-icon">${e.icon}</span>
              <span><em>Hey Casa</em>, ${esc(e.text)}</span>
            </button>`).join('')}
        </div>
      </div>`;

    // Bind example clicks
    messagesEl.querySelectorAll('.welcome-example').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.text;
        sendBtn.disabled = false;
        send();
      });
    });
  }

  function addUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg user';
    el.innerHTML = `
      <div class="msg-avatar user-av">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="7" r="4" fill="white"/>
          <path d="M20 21a8 8 0 0 0-16 0z" fill="white"/>
        </svg>
      </div>
      <div class="msg-body">
        <div class="msg-bubble">${esc(text)}</div>
        <div class="msg-time">${nowStr()}</div>
      </div>`;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'typing-indicator';
    el.id = 'typingEl';
    el.innerHTML = `
      <div class="msg-avatar agent-av"></div>
      <div class="typing-bubble">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>`;
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function showToolExecuting(toolName) {
    const el = document.createElement('div');
    el.className = 'msg agent';
    el.id = 'toolExecEl';
    el.innerHTML = `
      <div class="msg-avatar agent-av"></div>
      <div class="msg-body">
        <div class="tool-executing">
          <div class="tool-executing-spinner"></div>
          <span>Eseguendo <code>${esc(toolName)}</code>…</span>
        </div>
      </div>`;
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function removeEl(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function addAgentMessage(result) {
    const toolCard = result.tool ? buildToolCard(result) : '';
    const el = document.createElement('div');
    el.className = 'msg agent';
    el.innerHTML = `
      <div class="msg-avatar agent-av"></div>
      <div class="msg-body">
        ${toolCard}
        <div class="msg-bubble">${fmt(result.message)}</div>
        ${result._brokerFound ? buildBrokerButtons(result._brokerFound) : ''}
        <div class="msg-time">${nowStr()}</div>
      </div>`;
    // Collega i bottoni broker trovati
    if (result._brokerFound) {
      el.querySelectorAll('.broker-connect-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const broker = result._brokerFound[parseInt(btn.dataset.idx)];
          const row = btn.closest('.broker-connect-row');
          const allBtns = row.querySelectorAll('.broker-connect-btn');
          console.log('[BrokerConnect] click bottone:', { index: btn.dataset.idx, broker });
          allBtns.forEach(b => { b.disabled = true; });
          btn.textContent = 'Connessione…';
          btn.classList.add('is-loading');
          const connectResult = await connectBroker(broker);
          btn.classList.remove('is-loading');
          if (connectResult.ok) {
            btn.textContent = 'Connesso';
            btn.classList.add('is-connected');
          } else {
            allBtns.forEach(b => { b.disabled = false; });
            btn.textContent = `${broker.icon ?? ''} ${broker.name} — errore, riprova`;
            btn.classList.add('is-error');
          }
        }, { once: true });
      });
    }
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function buildBrokerButtons(brokers) {
    const btns = brokers.map((b, i) =>
      `<button class="broker-connect-btn disc-bar-btn" data-idx="${i}">${esc(b.icon)} ${esc(b.name)}<span>${esc(b.ip)}:${esc(String(b.port ?? ''))}</span></button>`
    ).join('');
    return `<div class="broker-connect-row">${btns}</div>`;
  }

  function buildToolCard(result) {
    const params = Object.entries(result.toolParams || {})
      .map(([k, v]) => `<div class="tool-param"><span class="param-key">${esc(k)}:</span> <span class="param-value">${esc(String(v))}</span></div>`)
      .join('');
    return `
      <div class="tool-card">
        <div class="tool-card-header">
          <span class="tool-card-icon">⚡</span>
          <span class="tool-card-name">${esc(result.tool)}</span>
          <span class="tool-card-result">${esc(result.toolResult || '')}</span>
        </div>
        <div class="tool-card-params">${params}</div>
      </div>`;
  }

  // ── SEND ──────────────────────────────────
  async function send() {
    const text = input.value.trim();
    if (!text || isBusy) return;

    isBusy = true;
    input.value = '';
    updateInputLayout();
    sendBtn.disabled = true;
    agentTagline.textContent = 'Sto elaborando…';
    $('agentAvatar').classList.add('thinking');

    // Remove welcome screen on first message
    const welcome = messagesEl.querySelector('.welcome-msg');
    if (welcome) welcome.remove();

    suggestionsRow.innerHTML = '';
    addUserMessage(text);

    const commandResult = await handleLocalCommand(text);
    if (commandResult) {
      addAgentMessage(commandResult);
      renderSuggestions(['/install', '/uninstall', '/cache clean', 'Stato casa']);

      agentTagline.textContent = 'Pronto — cosa vuoi fare?';
      $('agentAvatar').classList.remove('thinking');
      isBusy = false;
      return;
    }

    // Step 1 — typing indicator (rimane fino alla risposta)
    const typingEl = showTyping();

    // Step 2 — process via active agent
    const result = await activeAgent().process(text);
    removeEl(typingEl);

    // Step 3 — if tool call, show spinner briefly
    if (result.tool) {
      const toolEl = showToolExecuting(result.tool);
      await sleep(450);
      removeEl(toolEl);
    }

    // Step 4 — show answer
    addAgentMessage(result);
    renderSidebar();
    renderSuggestions(contextualSuggestions(text, result));

    agentTagline.textContent = 'Pronto — cosa vuoi fare?';
    $('agentAvatar').classList.remove('thinking');
    isBusy = false;
  }

  // ── SUGGESTIONS ───────────────────────────
  function renderSuggestions(chips) {
    suggestionsRow.innerHTML = chips.map(c =>
      `<button class="suggestion-chip" data-text="${esc(c)}">${esc(c)}</button>`
    ).join('');
  }

  function contextualSuggestions(msg, result) {
    const m = msg.toLowerCase();
    if (/luc[ei]|soggiorn|cucin|camer|bagn/.test(m))
      return ['Spegni tutte le luci', "Com'è messa casa?", 'Temperatura attuale', 'Check notturno'];
    if (/lavatric/.test(m))
      return ['Stato lavatrice', 'Avvisami quando finisce', 'Avvia la lavastoviglie', 'Spegni la lavatrice'];
    if (/gas|luc[ei]|bolletta|spes[ao]/.test(m))
      return ['Quanto paghiamo di gas?', 'Quando scade il contratto?', 'Ho pagato 90€ di luce', 'Totale spese'];
    if (/scadenz|contratt|revisione/.test(m))
      return ['Dettagli contratto gas', 'Revisione caldaia', 'Bonus caldaia', 'Ricordami la scadenza'];
    if (/tv|televi/.test(m))
      return ['Accendi le luci', 'Spegni tutto', "Com'è messa casa?", 'Temperatura'];
    return ['Accendi le luci', 'Stato lavatrice', 'Spese questo mese', 'Scadenze imminenti'];
  }

  async function handleLocalCommand(text) {
    const command = text.trim().toLowerCase();
    if (!['/install', '/uninstall', '/cache clean'].includes(command)) return null;

    if (!window.HeyCasaPWA) {
      return {
        tool: 'pwa_command',
        toolResult: 'non disponibile',
        message: 'La gestione PWA non e ancora pronta. Riprova tra qualche secondo.',
      };
    }

    if (command === '/install') return window.HeyCasaPWA.install();
    if (command === '/uninstall') return window.HeyCasaPWA.uninstall();
    return window.HeyCasaPWA.cleanCache();
  }

  // ── UTILS ─────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function nowStr() {
    const d = new Date();
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function scrollToBottom() {
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }

  function updateInputLayout() {
    input.style.height = 'auto';
    const nextHeight = Math.min(input.scrollHeight, 160);
    input.style.height = nextHeight + 'px';

    const lineHeight = parseFloat(getComputedStyle(input).lineHeight);
    input.closest('.input-bar').classList.toggle('multiline', nextHeight > lineHeight * 1.8);
  }

  // ── EVENTS ────────────────────────────────
  function bindEvents() {
    // Enter = send, Shift+Enter = newline
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    input.addEventListener('input', () => {
      sendBtn.disabled = !input.value.trim() || isBusy;
      updateInputLayout();
    });

    sendBtn.addEventListener('click', send);

    clearBtn.addEventListener('click', () => {
      messagesEl.innerHTML = '';
      OpenRouterAgent.clearHistory();
      renderWelcome();
      renderSuggestions(INIT_SUGGESTIONS);
      authBadge();
      $('agentAvatar').classList.remove('thinking', 'listening');
    });

    suggestionsRow.addEventListener('click', e => {
      const chip = e.target.closest('.suggestion-chip');
      if (!chip) return;
      input.value = chip.dataset.text;
      sendBtn.disabled = false;
      send();
    });

    // Mobile sidebar
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.id = 'sidebarOverlay';
    document.body.appendChild(overlay);

    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('active');
    });

    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });

    // Click on sidebar ?? placeholders → compose & send prompt
    sidebar.addEventListener('click', e => {
      const span = e.target.closest('.val-ask');
      if (!span) return;
      const prompt = span.dataset.prompt;
      if (!prompt) return;

      // Mark the parent card/item key as revealed for next re-render
      const card = span.closest('[data-key]');
      if (card) sidebarRevealed.add(card.dataset.key);
      // For deadline/expense items, infer key from prompt text
      const deadlineMatch = prompt.match(/scade (.+)\?/i);
      if (deadlineMatch) {
        const id = FakeAgent.getState().deadlines.find(d => d.name === deadlineMatch[1])?.id;
        if (id) sidebarRevealed.add(`dead-${id}`);
      }
      const expMatch = prompt.match(/di (luce|gas|acqua)/i);
      if (expMatch) sidebarRevealed.add(`exp-${expMatch[1].toLowerCase()}`);

      sidebar.classList.remove('open');
      overlay.classList.remove('active');

      // Send as chat message
      input.value = prompt;
      sendBtn.disabled = false;
      send();
    });
  }

  // ── MIC / WEB SPEECH API ──────────────────
  function initMic() {
    const micBtn = $('micBtn');
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { micBtn.classList.add('hidden'); return; }

    const rec = new SR();
    rec.lang = 'it-IT';
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    let listening = false;

    function startListening() {
      if (isBusy) return;
      listening = true;
      rec.start();
      micBtn.classList.add('listening');
      $('agentAvatar').classList.add('listening');
      input.placeholder = 'Sto ascoltando…';
      agentTagline.textContent = '🎙 In ascolto…';
    }

    function stopListening() {
      listening = false;
      micBtn.classList.remove('listening');
      $('agentAvatar').classList.remove('listening');
      input.placeholder = 'Hey Casa, …';
      agentTagline.textContent = 'Pronto — cosa vuoi fare?';
    }

    micBtn.addEventListener('click', () => {
      listening ? rec.stop() : startListening();
    });

    rec.onresult = e => {
      const transcript = e.results[0][0].transcript;
      stopListening();
      input.value = transcript;
      sendBtn.disabled = false;
      send();
    };

    rec.onend  = () => { if (listening) stopListening(); };
    rec.onerror = () => stopListening();
  }

  // ── AGENT SWITCH ──────────────────────────
  function activeAgent() {
    return OpenRouterAuth.isAuthenticated() ? OpenRouterAgent : FakeAgent;
  }

  // ── SIDEBAR AUTH WIDGET ────────────────────
  function renderAuthWidget() {
    const authEl = $('sidebarAuth');
    if (!authEl) return;

    if (OpenRouterAuth.isAuthenticated()) {
      authEl.innerHTML = `
        <div class="sidebar-auth-info">
          <span class="sidebar-auth-dot"></span>
          <span class="sidebar-auth-label">OpenRouter connesso</span>
        </div>
        <div class="sidebar-auth-credits" id="sidebarAuthCredits">
          <div class="sidebar-auth-credits-loading">Caricamento crediti…</div>
        </div>
        <button class="sidebar-auth-logout" id="sidebarLogoutBtn">Esci</button>`;
      $('sidebarLogoutBtn').addEventListener('click', () => {
        OpenRouterAuth.logout();
        OpenRouterAgent.clearHistory();
        McpLayer.clearCache();
        renderAuthWidget();
        agentTagline.textContent = 'Pronto — cosa vuoi fare?';
      }, { once: true });
      agentTagline.textContent = 'Connesso a OpenRouter';
      loadOpenRouterKeyStats();
    } else {
      authEl.innerHTML = `
        <button class="sidebar-auth-btn" id="sidebarLoginBtn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
            <polyline points="10 17 15 12 10 7"/>
            <line x1="15" y1="12" x2="3" y2="12"/>
          </svg>
          Accedi con OpenRouter
        </button>`;
      $('sidebarLoginBtn').addEventListener('click', () => {
        OpenRouterAuth.startOAuth();
      }, { once: true });
    }
  }

  async function loadOpenRouterKeyStats() {
    const creditsEl = $('sidebarAuthCredits');
    const token = OpenRouterAuth.getToken();
    if (!creditsEl || !token) return;

    console.groupCollapsed('[OpenRouter] caricamento crediti key');
    try {
      const res = await fetch('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      console.log('status:', res.status, res.statusText);
      console.log('payload:', data);
      if (!res.ok) throw new Error(data?.error?.message || `OpenRouter key info HTTP ${res.status}`);

      const key = data.data || {};
      creditsEl.innerHTML = buildOpenRouterCredits(key);
    } catch (err) {
      console.warn('[OpenRouter] crediti non disponibili:', err);
      creditsEl.innerHTML = `
        <div class="sidebar-auth-credits-error" title="${esc(err.message)}">
          Crediti non disponibili
        </div>`;
    } finally {
      console.groupEnd();
    }
  }

  function buildOpenRouterCredits(key) {
    const remaining = key.limit_remaining;
    const limit = key.limit;
    const usage = key.usage ?? 0;
    const monthly = key.usage_monthly ?? 0;
    const daily = key.usage_daily ?? 0;
    const remainingText = remaining == null ? 'Illimitati' : formatCredits(remaining);
    const limitText = limit == null ? 'Nessun limite' : formatCredits(limit);

    return `
      <div class="sidebar-auth-credit-grid">
        <div class="sidebar-auth-credit-card">
          <span class="sidebar-auth-credit-label">Rimasti</span>
          <strong>${esc(remainingText)}</strong>
          <span>${esc(limitText)}</span>
        </div>
        <div class="sidebar-auth-credit-card">
          <span class="sidebar-auth-credit-label">Usati</span>
          <strong>${esc(formatCredits(usage))}</strong>
          <span>mese ${esc(formatCredits(monthly))}</span>
        </div>
      </div>
      <div class="sidebar-auth-credit-foot">Oggi ${esc(formatCredits(daily))}</div>`;
  }

  function formatCredits(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('it-IT', {
      minimumFractionDigits: n < 1 && n > 0 ? 4 : 2,
      maximumFractionDigits: n < 1 && n > 0 ? 4 : 2,
    });
  }

  return { init, renderAuthWidget, showDiscoveryBar };
})();

document.addEventListener('DOMContentLoaded', async () => {
  const code = new URLSearchParams(location.search).get('code');
  if (code) {
    history.replaceState({}, '', location.pathname);
    // Init UI first so the user sees the app, not a blank page
    App.init();
    // Show spinner in tagline while exchanging the code
    const tagline = document.getElementById('agentTagline');
    if (tagline) tagline.textContent = 'Connessione a OpenRouter…';
    try {
      await OpenRouterAuth.handleCallback(code);
      App.renderAuthWidget();
    } catch (err) {
      console.error('[Auth] callback error:', err);
      if (tagline) tagline.textContent = `Auth error: ${err.message}`;
      // Mostra l'errore anche nel widget sidebar
      const authEl = document.getElementById('sidebarAuth');
      if (authEl) authEl.innerHTML = `<p class="sidebar-auth-error" title="${err.message}">⚠ Login fallito — <button class="sidebar-auth-btn" id="sidebarLoginBtn" style="display:inline;padding:2px 8px">Riprova</button></p>`;
      document.getElementById('sidebarLoginBtn')?.addEventListener('click', () => OpenRouterAuth.startOAuth(), { once: true });
    }
  } else {
    App.init();
  }
});
