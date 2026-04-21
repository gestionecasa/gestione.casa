// assets/pwa.js — PWA install banner + service worker registration

(() => {
  const DISMISS_KEY = 'pwa-banner-dismissed-at';
  const MOBILE_QUERY = '(max-width: 768px)';

  let deferredPrompt = null;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  function recentlyDismissed() {
    try {
      const dismissedAt = localStorage.getItem(DISMISS_KEY);
      return dismissedAt && Date.now() - Number(dismissedAt) < 24 * 60 * 60 * 1000;
    } catch (_) {
      return false;
    }
  }

  function setDismissed() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (_) {}
  }

  function clearDismissed() {
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch (_) {}
  }

  function elements() {
    return {
      banner: document.getElementById('pwaBanner'),
      installBtn: document.getElementById('pwaInstallBtn'),
      dismissBtn: document.getElementById('pwaDismissBtn'),
      bannerSub: document.getElementById('pwaBannerSub'),
    };
  }

  function hideBanner() {
    const { banner } = elements();
    if (banner) banner.classList.add('hidden');
  }

  function showBanner() {
    const { banner } = elements();
    if (!banner || isStandalone() || !isMobile()) return;
    document.documentElement.classList.add('pwa-banner-mobile');
    document.documentElement.classList.remove('pwa-banner-suppressed');
    banner.classList.remove('hidden');
  }

  function applyIOSCopy() {
    if (!isIOS) return;
    const { bannerSub, installBtn } = elements();
    if (bannerSub) bannerSub.textContent = 'Tocca  ↑  poi "Aggiungi alla schermata Home" in Safari.';
    if (installBtn) installBtn.textContent = 'Come si fa?';
  }

  function iosInstallMessage() {
    return 'Su iPhone e iPad non posso aprire l’installazione automaticamente. Tocca il pulsante di condivisione di Safari, poi scegli "Aggiungi alla schermata Home".';
  }

  async function installFromCommand() {
    clearDismissed();

    if (isStandalone()) {
      hideBanner();
      return {
        tool: 'pwa_install',
        toolResult: 'gia installata',
        message: 'Hey Casa risulta gia aperta come app installata.',
      };
    }

    if (!isMobile()) {
      hideBanner();
      return {
        tool: 'pwa_install',
        toolResult: 'solo mobile',
        message: 'Il banner di installazione resta nascosto su desktop. Apri questa pagina dal telefono e scrivi **/install** per avviare l’installazione della PWA.',
      };
    }

    showBanner();

    if (isIOS) {
      applyIOSCopy();
      return {
        tool: 'pwa_install',
        toolResult: 'istruzioni iOS',
        message: iosInstallMessage(),
      };
    }

    if (!deferredPrompt) {
      return {
        tool: 'pwa_install',
        toolResult: 'prompt non pronto',
        message: 'Il browser non ha ancora reso disponibile il prompt di installazione. Il banner e visibile: appena il prompt e disponibile puoi usare il pulsante **Installa**.',
      };
    }

    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;

    if (choice.outcome === 'accepted') {
      hideBanner();
      return {
        tool: 'pwa_install',
        toolResult: 'installazione avviata',
        message: 'Installazione di Hey Casa avviata.',
      };
    }

    showBanner();
    return {
      tool: 'pwa_install',
      toolResult: 'annullata',
      message: 'Installazione annullata. Puoi riprovare dal banner o scrivendo di nuovo **/install**.',
    };
  }

  async function uninstallFromCommand() {
    clearDismissed();

    const message = isIOS
      ? 'iOS non permette a una pagina web di rimuovere una PWA. Tieni premuta l’icona di Hey Casa nella schermata Home e scegli "Rimuovi app".'
      : 'Android non permette a una pagina web di disinstallare direttamente una PWA. Tieni premuta l’icona di Hey Casa e scegli "Disinstalla" o rimuovila dalle impostazioni dell’app/browser.';

    if (!isStandalone() && isMobile()) showBanner();

    return {
      tool: 'pwa_uninstall',
      toolResult: 'azione manuale richiesta',
      message,
    };
  }

  window.HeyCasaPWA = {
    install: installFromCommand,
    uninstall: uninstallFromCommand,
    showBanner,
    hideBanner,
  };

  // ── Service Worker ─────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // ── Cattura prompt Android (se disponibile) ─
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (!recentlyDismissed()) showBanner();
  });

  if (isStandalone() || !isMobile() || recentlyDismissed()) {
    hideBanner();
  } else {
    showBanner();
  }

  const { installBtn, dismissBtn, bannerSub } = elements();

  installBtn?.addEventListener('click', async () => {
    const result = await installFromCommand();
    if (isIOS && bannerSub) {
      bannerSub.textContent = '1. Tocca  ↑  in Safari  2. Scorri e tocca "Aggiungi alla schermata Home"';
    } else if (result.toolResult === 'prompt non pronto' && bannerSub) {
      bannerSub.textContent = 'Installazione non ancora pronta: riprova tra qualche secondo.';
    }
  });

  dismissBtn?.addEventListener('click', () => {
    setDismissed();
    hideBanner();
  });

  applyIOSCopy();
})();
