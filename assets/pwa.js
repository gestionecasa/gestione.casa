// assets/pwa.js — PWA install banner + service worker registration

(() => {
  const DISMISS_KEY = 'pwa-banner-dismissed';
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

  function isLocalDev() {
    return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
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
    document.documentElement.classList.remove('pwa-banner-dismissed');
    banner.classList.remove('hidden');
  }

  function setDismissed() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch (_) {}
    document.documentElement.classList.add('pwa-banner-dismissed');
  }

  function clearDismissed() {
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch (_) {}
    document.documentElement.classList.remove('pwa-banner-dismissed');
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

  async function cleanCacheFromCommand() {
    clearDismissed();

    let deletedCaches = 0;
    let unregisteredWorkers = 0;

    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
      deletedCaches = keys.length;
    }

    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
      unregisteredWorkers = registrations.length;
    }

    setTimeout(() => {
      window.location.reload();
    }, 900);

    return {
      tool: 'cache_clean',
      toolResult: `${deletedCaches} cache · ${unregisteredWorkers} service worker`,
      message: `Cache frontend pulita. Ho eliminato **${deletedCaches}** cache e deregistrato **${unregisteredWorkers}** service worker.\n\nRicarico la pagina tra un secondo per prendere gli asset freschi.`,
    };
  }

  window.HeyCasaPWA = {
    install: installFromCommand,
    uninstall: uninstallFromCommand,
    cleanCache: cleanCacheFromCommand,
    showBanner,
    hideBanner,
  };

  // ── Service Worker ─────────────────────────
  if ('serviceWorker' in navigator && isLocalDev()) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.getRegistrations()
        .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
        .catch(() => {});
    });
  } else if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // ── Cattura prompt Android (se disponibile) ─
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
  });

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
