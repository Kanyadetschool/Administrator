/**
 * google-one-tap.js
 * Google Sign-In / One Tap helper. Also re-exports SessionManager +
 * guardPage (see session-manager.js) so both import from one file.
 *
 * import { GoogleOneTap, SessionManager } from './js/google-one-tap.js';
 * new GoogleOneTap({ clientId, buttonContainer, onSuccess, onUnavailable }).init();
 * onSuccess(profile) -> { email, name, givenName, familyName, picture, sub, emailVerified }
 *
 * Doesn't touch Firebase - just resolves a Google profile and hands it
 * to onSuccess; what the page does with it is up to the page.
 */

export { SessionManager, guardPage } from './session-manager.js';


const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const GIS_LOAD_TIMEOUT_MS = 6000;

/** Decodes a Google ID token (JWT) into its payload, client-side only.
 *  This is NOT signature verification - it's purely for reading the
 *  profile fields (email, name, picture) to prefill/display in the UI.
 *  Any security-sensitive check must still happen server-side / via
 *  Firebase Auth as normal. */
function decodeIdToken(idToken) {
  try {
    const payload = idToken.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch (e) {
    console.error('[GoogleOneTap] Could not decode ID token:', e);
    return null;
  }
}

function toProfile(idToken, raw) {
  const payload = decodeIdToken(idToken);
  if (!payload) return null;
  return {
    email: (payload.email || '').trim(),
    emailVerified: !!payload.email_verified,
    name: payload.name || '',
    givenName: payload.given_name || '',
    familyName: payload.family_name || '',
    picture: payload.picture || '',
    sub: payload.sub || '',
    raw,
  };
}

/** Loads the Google Identity Services script once, even if several
 *  GoogleOneTap instances exist on the same page. Safe to call repeatedly. */
let gisLoadPromise = null;
function loadGis() {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    return Promise.resolve();
  }
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('GIS script failed to load')));
      // In case it already loaded before we attached listeners:
      if (window.google && window.google.accounts && window.google.accounts.id) resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('GIS script failed to load'));
    document.head.appendChild(script);
  });

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('GIS script load timed out')), GIS_LOAD_TIMEOUT_MS)
  );

  return Promise.race([gisLoadPromise, timeout]);
}

export class GoogleOneTap {
  /**
   * @param {Object} opts
   * @param {string} opts.clientId - Google OAuth Client ID (required).
   * @param {HTMLElement} [opts.buttonContainer] - Element to render the
   *   official "Sign in with Google" button into. Omit if you only want
   *   the silent prompt and no visible button.
   * @param {Object} [opts.buttonOptions] - Overrides passed to
   *   google.accounts.id.renderButton (theme, size, shape, text, width...).
   * @param {boolean} [opts.autoSilentPrompt=false] - Also call the
   *   zero-click One Tap prompt in the background as soon as init() runs.
   * @param {boolean} [opts.autoSelect=false] - Google's auto_select option.
   * @param {boolean} [opts.useFedCM=true] - Google's use_fedcm_for_prompt option.
   * @param {(profile: object) => void} [opts.onSuccess] - Called with the
   *   decoded profile once a credential comes back (button click or silent).
   * @param {() => void} [opts.onUnavailable] - Called if GIS can't load at
   *   all (offline, blocked, ad-blocker, etc.) - show a manual fallback here.
   * @param {(err: Error) => void} [opts.onError] - Called on any other error.
   * @param {boolean} [opts.debug=true] - console.log the internal steps.
   */
  constructor(opts = {}) {
    if (!opts.clientId) throw new Error('[GoogleOneTap] clientId is required');
    this.clientId = opts.clientId;
    this.buttonContainer = opts.buttonContainer || null;
    this.buttonOptions = Object.assign(
      {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        logo_alignment: 'left',
        width: 280,
      },
      opts.buttonOptions || {}
    );
    this.autoSilentPrompt = !!opts.autoSilentPrompt;
    this.autoSelect = !!opts.autoSelect;
    this.useFedCM = opts.useFedCM !== false;
    this.onSuccess = typeof opts.onSuccess === 'function' ? opts.onSuccess : () => {};
    this.onUnavailable = typeof opts.onUnavailable === 'function' ? opts.onUnavailable : () => {};
    this.onError = typeof opts.onError === 'function' ? opts.onError : (err) => console.error(err);
    this.debug = opts.debug !== false;

    this._buttonRendered = false;
    this._initialized = false;
  }

  _log(...args) {
    if (this.debug) console.log('[GoogleOneTap]', ...args);
  }

  async _handleCredentialResponse(response) {
    this._log('Credential received', response);
    const profile = toProfile(response.credential, response);
    if (!profile || !profile.email) {
      this._log('Could not decode a usable profile/email from the credential');
      this.onError(new Error('Could not decode Google credential'));
      return;
    }
    this._log('Decoded profile', profile);
    this.onSuccess(profile);
  }

  /** Loads GIS (if needed), initializes it, and renders the button
   *  (if buttonContainer was given). Safe to call more than once. */
  async init() {
    try {
      await loadGis();
    } catch (err) {
      this._log('GIS unavailable:', err.message);
      this.onUnavailable();
      return;
    }

    if (!this._initialized) {
      this._log('Initializing with client ID', this.clientId);
      window.google.accounts.id.initialize({
        client_id: this.clientId,
        auto_select: this.autoSelect,
        use_fedcm_for_prompt: this.useFedCM,
        callback: (response) => this._handleCredentialResponse(response),
      });
      this._initialized = true;
    }

    if (this.buttonContainer && !this._buttonRendered) {
      this._log('Rendering button into container');
      window.google.accounts.id.renderButton(this.buttonContainer, this.buttonOptions);
      this._buttonRendered = true;
    }

    if (this.autoSilentPrompt) {
      this.promptSilent();
    }
  }

  /** Triggers the zero-click One Tap prompt. Resolves/rejects nothing -
   *  outcomes are reported via the notification callback (logged) and,
   *  on success, via onSuccess like the button. */
  promptSilent(onNotification) {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      this._log('promptSilent() called before GIS was ready - ignoring');
      return;
    }
    this._log('Prompting (silent One Tap)...');
    window.google.accounts.id.prompt((notification) => {
      this._log('Silent prompt notification:', notification);
      if (typeof onNotification === 'function') onNotification(notification);
    });
  }

  /** Cancels any in-flight One Tap prompt. Call this when closing a modal
   *  or navigating away so a stray prompt doesn't linger. */
  cancel() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.cancel();
    }
  }

  /** Fully signs the user out of Google One Tap's auto-select for this
   *  site (so it won't auto-pick the same account next time). */
  disableAutoSelect() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  }
}

// Also expose on window for pages that aren't using ES module imports.
if (typeof window !== 'undefined') {
  window.GoogleOneTap = GoogleOneTap;
}