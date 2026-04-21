// core/auth.js — OpenRouter OAuth (no PKCE, no app registration)

const OpenRouterAuth = (() => {

  const TOKEN_KEY = 'or_token';

  function callbackUrl() {
    return window.location.origin + '/';
  }

  // ── OAuth flow ─────────────────────────────
  function startOAuth() {
    const params = new URLSearchParams({ callback_url: callbackUrl() });
    window.location.href = `https://openrouter.ai/auth?${params}`;
  }

  async function handleCallback(code) {
    console.log('[Auth] handleCallback — code:', code);

    const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    const data = await res.json().catch(() => ({}));
    console.log('[Auth] risposta OpenRouter:', res.status, data);

    if (!res.ok) {
      throw new Error(data?.error?.message || `Token exchange fallito (${res.status})`);
    }

    const token = data.key ?? data.token ?? data.api_key ?? null;
    if (!token) throw new Error('Nessun token nella risposta: ' + JSON.stringify(data));

    try { localStorage.setItem(TOKEN_KEY, token); } catch {}
    console.log('[Auth] token salvato ✓');
    return token;
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
  }

  function isAuthenticated() { return !!getToken(); }

  function logout() {
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
  }

  return { startOAuth, handleCallback, getToken, isAuthenticated, logout };
})();