// core/openrouter-agent.js — LLM reale via OpenRouter + MCP tool loop

const OpenRouterAgent = (() => {

  let MODEL = null;

  const SYSTEM = `Sei Casa, un assistente domotico intelligente e conversazionale.
Gestisci la casa: luci, dispositivi smart, spese, bollette, scadenze, promemoria, bonus edilizi.
Hai accesso ai dispositivi reali tramite tool — usali sempre per leggere stati reali, non inventare.
Per azioni irreversibili (serrature) chiedi sempre conferma esplicita.
Rispondi in italiano. Sii conciso e diretto. Usa markdown quando utile.`;

  const history = [];
  const MAX_PAIRS = 20;

  function trimHistory() {
    while (history.length > MAX_PAIRS * 2) history.splice(0, 2);
  }

  async function resolveModel(token) {
    if (MODEL) return MODEL;
    try {
      const res  = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const { data } = await res.json();
      const free = (data || [])
        .filter(m => m.id.endsWith(':free'))
        .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0));
      MODEL = free[0]?.id ?? 'openai/gpt-4o-mini';
    } catch {
      MODEL = 'openai/gpt-4o-mini';
    }
    console.log('[OpenRouter] modello selezionato:', MODEL);
    return MODEL;
  }

  async function process(rawMsg) {
    const token = OpenRouterAuth.getToken();
    if (!token) return { message: 'Non sei autenticato. Accedi con OpenRouter dalla sidebar.' };

    history.push({ role: 'user', content: rawMsg });
    trimHistory();

    const model = await resolveModel(token);

    // Costruisci messages con system prompt
    const messages = [
      { role: 'system', content: SYSTEM },
      ...history,
    ];

    let content;
    try {
      content = await McpLayer.runAgentLoop(messages, model, token);
    } catch (err) {
      history.pop();
      console.error('[OpenRouter] error:', err);
      if (err.status === 429) {
        MODEL = null;
        return { message: `Modello sovraccarico (429). Riprova — verrà selezionato un modello alternativo.\n\nModello usato: \`${model}\`` };
      }
      if (err.status === 404) {
        MODEL = null;
        return { message: `Modello \`${model}\` non disponibile. Riprova tra un momento.` };
      }
      return { message: `Errore: ${err.message}` };
    }

    // Rimuovi i tool messages intermedi dallo history (teniamo solo user+assistant)
    // messages ora include system + history + eventuali tool rounds
    // Sincronizza history con le ultime aggiunte (solo i turni user/assistant)
    const lastAssistant = messages.filter(m => m.role === 'assistant').at(-1);
    if (lastAssistant && !history.includes(lastAssistant)) {
      history.push({ role: 'assistant', content });
    }

    return { message: content };
  }

  function clearHistory() { history.length = 0; }

  return { process, clearHistory };
})();