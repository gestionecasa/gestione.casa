// assets/pwa.js — PWA install banner + service worker registration

(() => {
  // ── Service Worker ─────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // ── Already installed as standalone → never show banner ──
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (isStandalone) return;

  // ── Only on mobile ─────────────────────────
  const isMobile = () => window.innerWidth <= 768;

  // ── Detect iOS (no beforeinstallprompt) ────
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  const banner      = document.getElementById('pwaBanner');
  const installBtn  = document.getElementById('pwaInstallBtn');
  const dismissBtn  = document.getElementById('pwaDismissBtn');
  const bannerSub   = document.getElementById('pwaBannerSub');
  const DISMISS_KEY = 'pwa-banner-dismissed';

  let deferredPrompt = null;

  function showBanner() {
    if (localStorage.getItem(DISMISS_KEY)) return;
    if (!isMobile()) return;
    banner.classList.add('visible');
  }

  function hideBanner() {
    banner.classList.remove('visible');
  }

  // ── Android / Chrome: capture install prompt ─
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    // Small delay so the UI settles first
    setTimeout(showBanner, 2500);
  });

  installBtn.addEventListener('click', async () => {
    if (isIOS) {
      // Can't trigger programmatically on iOS — user already knows what to do
      hideBanner();
      return;
    }
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    hideBanner();
  });

  dismissBtn.addEventListener('click', () => {
    localStorage.setItem(DISMISS_KEY, '1');
    hideBanner();
  });

  // ── iOS: show banner with manual instructions ─
  if (isIOS) {
    bannerSub.textContent = 'Tocca  ↑  poi "Aggiungi a Home" per accesso rapido.';
    installBtn.textContent = 'Come si fa?';
    installBtn.addEventListener('click', () => {
      // Replace sub with step-by-step, briefly
      bannerSub.textContent = '1. Tocca il tasto Condividi (↑) in Safari  2. Scorri e tocca "Aggiungi alla schermata Home"';
    }, { once: true });
    setTimeout(showBanner, 2500);
  }
})();
