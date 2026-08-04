// ── Service Worker registration (offline app-shell caching) ──────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('[SW] registered, scope:', reg.scope))
      .catch((err) => console.warn('[SW] registration failed:', err));
  });
}

// ── PWA "Install App" (standalone-only) ───────────────────────────────────
// Button is visible by default on the auth screen. If the browser has fired
// beforeinstallprompt we use the native prompt; otherwise (prompt not fired
// yet, or an unsupported browser like iOS Safari) we fall back to short
// manual instructions. The app only ever installs in standalone mode
// because manifest.json must declare "display": "standalone" (or
// "window-controls-overlay") — the browser, not this code, decides the
// display mode based on that manifest value.
let _pwaDeferredPrompt = null;

function _isRunningStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true; // iOS Safari
}

function _hideInstallBtn() {
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.classList.add('hide');
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // stop the mini-infobar
  _pwaDeferredPrompt = e;      // stash it for the button click
});

window.addEventListener('appinstalled', () => {
  _pwaDeferredPrompt = null;
  _hideInstallBtn();
  console.log('[PWA] App installed as standalone.');
});

async function installPwaApp() {
  // Native path — browser already offered us the install prompt.
  if (_pwaDeferredPrompt) {
    const promptEvent = _pwaDeferredPrompt;
    _pwaDeferredPrompt = null;
    promptEvent.prompt();
    try {
      const { outcome } = await promptEvent.userChoice;
      console.log('[PWA] install choice:', outcome);
    } catch (err) {
      console.warn('[PWA] install prompt failed:', err);
    }
    return;
  }

  // Fallback path — prompt hasn't fired (not ready yet / unsupported
  // browser such as iOS Safari or Firefox). Give manual instructions.
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const msg = isIOS
    ? 'To install: tap the Share icon, then "Add to Home Screen".'
    : 'To install: open your browser menu and choose "Install App" (or "Add to Home screen").';
  if (window.Swal) {
    Swal.fire({ icon: 'info', title: 'Install App', text: msg, confirmButtonColor: '#2980b9' });
  } else {
    alert(msg);
  }
}
window.installPwaApp = installPwaApp;

// If already launched standalone, no need to offer install.
document.addEventListener('DOMContentLoaded', () => {
  if (_isRunningStandalone()) _hideInstallBtn();
});
