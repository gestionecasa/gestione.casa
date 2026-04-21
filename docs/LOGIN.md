# OpenRouter OAuth PKCE — Auth Flow per PWA Statica

## Prerequisiti

Registra la tua app su [openrouter.ai/settings/oauth-apps](https://openrouter.ai/settings/oauth-apps) e ottieni un `client_id`. Non ti serve `client_secret` — PKCE è pensato per app senza backend.

---

## Il Flow

### 1. Genera code verifier e challenge

```javascript
function generateCodeVerifier() {
  const array = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
```

### 2. Redirect verso OpenRouter

```javascript
async function startAuth() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  
  sessionStorage.setItem('pkce_verifier', verifier);
  
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'YOUR_CLIENT_ID',
    redirect_uri: window.location.origin + '/callback',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `https://openrouter.ai/auth?${params}`;
}
```

### 3. Gestisci il callback

```javascript
async function handleCallback() {
  const code = new URLSearchParams(window.location.search).get('code');
  const verifier = sessionStorage.getItem('pkce_verifier');

  const response = await fetch('https://openrouter.ai/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: 'YOUR_CLIENT_ID',
      redirect_uri: window.location.origin + '/callback',
      code,
      code_verifier: verifier,
    })
  });

  const { token } = await response.json();
  localStorage.setItem('openrouter_token', token);
  sessionStorage.removeItem('pkce_verifier');
  
  window.location.href = '/'; // torna alla home
}
```

### 4. Usa il token per le chiamate LLM

```javascript
async function chat(messages, model = 'anthropic/claude-sonnet-4') {
  const token = localStorage.getItem('openrouter_token');
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
    },
    body: JSON.stringify({ model, messages })
  });

  return response.json();
}
```

---

## Routing nella SPA

```javascript
// All'avvio controlla dove sei
if (window.location.pathname === '/callback') {
  handleCallback();
} else if (!localStorage.getItem('openrouter_token')) {
  showLoginScreen(); // mostra pulsante "Connetti OpenRouter"
} else {
  startApp(); // token presente, vai
}
```

---

## Note importanti

- Il `token` restituito da OpenRouter è un **API key** a tutti gli effetti, non un JWT con scadenza — non serve refresh flow
- Salvarlo in `localStorage` è accettabile per questa use case (BYOK, nessun dato sensibile server-side)
- `HTTP-Referer` è richiesto da OpenRouter per identificare l'app nelle statistiche
- L'utente paga con il suo credito OpenRouter — tu non gestisci billingaut