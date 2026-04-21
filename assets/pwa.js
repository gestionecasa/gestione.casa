// assets/pwa.js — PWA install banner + service worker registration

(() => {
  // ── Service Worker ─────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // ── Already installed as standalone → mai mostrare ──
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (isStandalone) return;

  // ── Solo mobile ────────────────────────────
  if (window.innerWidth > 768) return;

  // ── Controllo dismiss (24h) ────────────────
  const DISMISS_KEY = 'pwa-banner-dismissed-at';
  const dismissedAt = localStorage.getItem(DISMISS_KEY);
  if (dismissedAt && Date.now() - Number(dismissedAt) < 24 * 60 * 60 * 1000) return;

  // ── Elementi ───────────────────────────────
  const banner     = document.getElementById('pwaBanner');
  const installBtn = document.getElementById('pwaInstallBtn');
  const dismissBtn = document.getElementById('pwaDismissBtn');
  const bannerSub  = document.getElementById('pwaBannerSub');

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  let deferredPrompt = null;

  // ── Mostra subito ──────────────────────────
  banner.classList.add('visible');

  // ── Cattura prompt Android (se disponibile) ─
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
  });

  // ── Installa ───────────────────────────────
  installBtn.addEventListener('click', async () => {
    if (isIOS) {
      bannerSub.textContent = '1. Tocca  ↑  in Safari  2. Scorri e tocca "Aggiungi alla schermata Home"';
      return;
    }
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    banner.classList.remove('visible');
  });

  // ── Chiudi → ricompare dopo 24h ────────────
  dismissBtn.addEventListener('click', () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    banner.classList.remove('visible');
  });

  // ── iOS: testo adattato ────────────────────
  if (isIOS) {
    bannerSub.textContent = 'Tocca  ↑  poi "Aggiungi alla schermata Home" in Safari.';
    installBtn.textContent = 'Come si fa?';
  }
})();
