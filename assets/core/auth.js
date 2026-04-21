// core/auth.js — OpenRouter OAuth PKCE (no app registration required)

const OpenRouterAuth = (() => {

  const TOKEN_KEY    = 'or_token';
  const VERIFIER_KEY = 'or_pkce_verifier';

  // ── PKCE helpers ───────────────────────────
  function generateVerifier() {
    const arr = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...arr))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  async function generateChallenge(verifier) {
    const data   = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function callbackUrl() {
    return window.location.origin + '/';
  }

  // ── OAuth flow ─────────────────────────────
  async function startOAuth() {
    const verifier  = generateVerifier();
    const challenge = await generateChallenge(verifier);
    sessionStorage.setItem(VERIFIER_KEY, verifier);

    const params = new URLSearchParams({
      callback_url:          callbackUrl(),
      code_challenge:        challenge,
      code_challenge_method: 'S256',
    });
    window.location.href = `https://openrouter.ai/auth?${params}`;
  }

  async function handleCallback(code) {
    console.log('[Auth] handleCallback — code:', code);

    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    console.log('[Auth] verifier from sessionStorage:', verifier ? '✓ presente' : '✗ MANCANTE');

    const body = verifier
      ? { code, code_verifier: verifier }
      : { code }; // fallback senza PKCE se il verifier è andato perso

    const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    console.log('[Auth] risposta OpenRouter:', res.status, data);

    if (!res.ok) {
      throw new Error(data?.error?.message || `Token exchange fallito (${res.status})`);
    }

    // OpenRouter può rispondere con { key } oppure { token } o { api_key }
    const token = data.key ?? data.token ?? data.api_key ?? null;
    if (!token) throw new Error('Risposta inattesa: nessun token nel body → ' + JSON.stringify(data));

    sessionStorage.removeItem(VERIFIER_KEY);
    saveToken(token);
    console.log('[Auth] token salvato ✓');
    return token;
  }

  // ── API key diretta ─────────────────────────
  function saveApiKey(key) {
    saveToken(key.trim());
  }

  // ── Token storage ───────────────────────────
  function saveToken(token) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch {}
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
  }

  function isAuthenticated() { return !!getToken(); }

  function logout() {
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
  }

  // ── Verifica token live ─────────────────────
  async function verify() {
    const token = getToken();
    if (!token) return false;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch { return false; }
  }

  return { startOAuth, handleCallback, saveApiKey, getToken, isAuthenticated, logout, verify };
})();