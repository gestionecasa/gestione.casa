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

  const INIT_SUGGESTIONS = [
    'Accendi le luci del soggiorno',
    "Com'è messa casa?",
    'Quanto paghiamo di luce?',
    'Avvisami quando finisce la lavatrice',
    'Quando scade il contratto gas?',
    'Spegni la TV dopo mezzanotte',
  ];

  // ── INIT ───────────────────────────────────
  function init() {
    renderWelcome();
    renderSuggestions(INIT_SUGGESTIONS.slice(0, 4));
    renderSidebar();
    bindEvents();
  }

  // ── SIDEBAR ───────────────────────────────
  function renderSidebar() {
    const s = FakeAgent.getState();
    const on = Object.values(s.devices).filter(d => d.type === 'luce' && d.on);
    const totalLights = Object.values(s.devices).filter(d => d.type === 'luce').length;
    const activeAppl  = Object.values(s.devices).filter(d => d.type === 'elettrodomestico' && d.on);
    const risc = s.devices['riscaldamento'];

    statusGrid.innerHTML = `
      <div class="status-card">
        <div class="status-card-icon">💡</div>
        <div class="status-card-value ${on.length > 0 ? 'status-on' : 'status-off'}">${on.length}/${totalLights}</div>
        <div class="status-card-label">Luci accese</div>
      </div>
      <div class="status-card">
        <div class="status-card-icon">🌡️</div>
        <div class="status-card-value">${s.temperature.inside}°</div>
        <div class="status-card-label">Dentro · ${s.temperature.outside}° fuori</div>
      </div>
      <div class="status-card">
        <div class="status-card-icon">🔥</div>
        <div class="status-card-value ${risc.on ? 'status-active' : 'status-off'}">${risc.on ? `${risc.temp}°C` : 'OFF'}</div>
        <div class="status-card-label">Riscaldamento</div>
      </div>
      <div class="status-card">
        <div class="status-card-icon">🔌</div>
        <div class="status-card-value ${activeAppl.length > 0 ? 'status-active' : ''}">${activeAppl.length}</div>
        <div class="status-card-label">Elettrodomestici</div>
      </div>
    `;

    deadlinesList.innerHTML = s.deadlines.map(d => {
      const cls = d.daysLeft <= 14 ? 'urgent' : d.daysLeft <= 45 ? 'soon' : 'ok';
      return `
        <div class="deadline-item">
          <div class="deadline-dot ${cls}"></div>
          <span class="deadline-name">${d.name}</span>
          <span class="deadline-days">${d.daysLeft}g</span>
        </div>`;
    }).join('');

    expensesMini.innerHTML = [
      { icon: '⚡', label: 'Luce',  key: 'luce'  },
      { icon: '🔥', label: 'Gas',   key: 'gas'   },
      { icon: '💧', label: 'Acqua', key: 'acqua' },
    ].map(({ icon, label, key }) => {
      const e = s.expenses[key];
      const tCls  = e.vsLastYear > 0 ? 'trend-up' : e.vsLastYear < 0 ? 'trend-down' : 'trend-flat';
      const tIcon = e.vsLastYear > 0 ? '↑' : e.vsLastYear < 0 ? '↓' : '→';
      return `
        <div class="expense-item">
          <span class="expense-cat">${icon} ${label}</span>
          <span class="expense-amount">€${e.thisMonth}<span class="expense-trend ${tCls}">${tIcon}</span></span>
        </div>`;
    }).join('');
  }

  // ── MESSAGES ──────────────────────────────
  function renderWelcome() {
    const h = new Date().getHours();
    const gr = h < 12 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
    messagesEl.innerHTML = `
      <div class="welcome-msg">
        <div class="welcome-icon">⌂</div>
        <div class="welcome-title">${gr}!</div>
        <div class="welcome-sub">Sono <strong>Casa</strong>, il tuo agente domestico. Posso controllare dispositivi, tenere traccia delle spese e gestire le scadenze di casa.<br>Cosa vuoi fare?</div>
      </div>`;
  }

  function addUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg user';
    el.innerHTML = `
      <div class="msg-avatar user-av">F</div>
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
      <div class="msg-avatar agent-av">⌂</div>
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
      <div class="msg-avatar agent-av">⌂</div>
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
      <div class="msg-avatar agent-av">⌂</div>
      <div class="msg-body">
        ${toolCard}
        <div class="msg-bubble">${fmt(result.message)}</div>
        <div class="msg-time">${nowStr()}</div>
      </div>`;
    messagesEl.appendChild(el);
    scrollToBottom();
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
    input.style.height = 'auto';
    sendBtn.disabled = true;
    agentTagline.textContent = 'Sto pensando…';

    // Remove welcome screen on first message
    const welcome = messagesEl.querySelector('.welcome-msg');
    if (welcome) welcome.remove();

    suggestionsRow.innerHTML = '';
    addUserMessage(text);

    // Step 1 — typing indicator
    const typingEl = showTyping();
    await sleep(500);
    removeEl(typingEl);

    // Step 2 — process (fake agent does its own delay)
    const result = await FakeAgent.process(text);

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

  // ── EVENTS ────────────────────────────────
  function bindEvents() {
    // Enter = send, Shift+Enter = newline
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    input.addEventListener('input', () => {
      sendBtn.disabled = !input.value.trim() || isBusy;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    });

    sendBtn.addEventListener('click', send);

    clearBtn.addEventListener('click', () => {
      messagesEl.innerHTML = '';
      renderWelcome();
      renderSuggestions(INIT_SUGGESTIONS.slice(0, 4));
      agentTagline.textContent = 'Pronto — cosa vuoi fare?';
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
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
