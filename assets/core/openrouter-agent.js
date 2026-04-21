// core/openrouter-agent.js — LLM reale via OpenRouter

const OpenRouterAgent = (() => {

  const MODEL = 'google/gemma-3-4b-it:free';

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
    if (!token) return { message: 'Non sei autenticato. Accedi con OpenRouter dalla sidebar.' };

    history.push({ role: 'user', content: rawMsg });
    trimHistory();

    let res, data;
    try {
      res  = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
          'HTTP-Referer':  window.location.origin,
          'X-Title':       'Hey Casa',
        },
        body: JSON.stringify({
          model:    MODEL,
          messages: [{ role: 'system', content: SYSTEM }, ...history],
        }),
      });
      data = await res.json();
    } catch (err) {
      history.pop();
      return { message: `Errore di rete: ${err.message}` };
    }

    if (!res.ok) {
      history.pop();
      const msg = data?.error?.message || `Errore ${res.status}`;
      if (res.status === 429) return { message: `Il modello è momentaneamente sovraccarico (429). Riprova tra qualche secondo.\n\nModello usato: \`${MODEL}\`` };
      return { message: `Errore OpenRouter: ${msg}` };
    }

    const content = data.choices?.[0]?.message?.content ?? '(nessuna risposta)';
    history.push({ role: 'assistant', content });
    return { message: content };
  }

  function clearHistory() { history.length = 0; }

  return { process, clearHistory, MODEL };
})();