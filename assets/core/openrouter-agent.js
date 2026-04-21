// core/openrouter-agent.js — LLM reale via OpenRouter

const OpenRouterAgent = (() => {

  const MODEL = 'meta-llama/llama-3.2-3b-instruct:free';

  const SYSTEM = `Sei Casa, un assistente domestico intelligente e conversazionale.
Aiuti l'utente a gestire la casa: luci e dispositivi smart, spese e bollette, scadenze e contratti, promemoria, bonus edilizi.
Rispondi sempre in italiano. Sii conciso e diretto. Usa markdown (grassetto, elenchi) per strutturare le risposte quando utile.
Se non sai qualcosa o non hai accesso ai dati reali della casa, dillo chiaramente e suggerisci come ottenerli.`;

  // Storico messaggi in memoria (max ultimi 20 scambi)
  const history = [];
  const MAX_PAIRS = 20;

  function trimHistory() {
    while (history.length > MAX_PAIRS * 2) history.splice(0, 2);
  }

  async function process(rawMsg) {
    const token = OpenRouterAuth.getToken();
    if (!token) throw new Error('Non autenticato');

    history.push({ role: 'user', content: rawMsg });
    trimHistory();

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${token}`,
        'Content-Type':   'application/json',
        'HTTP-Referer':   window.location.origin,
        'X-Title':        'Hey Casa',
      },
      body: JSON.stringify({
        model:    MODEL,
        messages: [
          { role: 'system', content: SYSTEM },
          ...history,
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    const data    = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '(nessuna risposta)';

    history.push({ role: 'assistant', content });
    return { message: content };
  }

  function clearHistory() { history.length = 0; }

  return { process, clearHistory, MODEL };
})();