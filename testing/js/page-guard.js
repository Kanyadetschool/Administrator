/**
 * page-guard.js
 * One helper for every PROTECTED page (never the login page itself —
 * see the warning in login.html about why guardPage() there causes a
 * reload loop).
 *
 * Usage at the top of a protected page's module script:
 *   import { protectPage, wireLogout } from './js/page-guard.js';
 *   const { ok, session, profile } = protectPage();
 *   if (!ok) { /* guardPage already redirected — stop here * / }
 *   else { renderPageFor(profile); wireLogout(session, document.getElementById('sign-out-btn')); }
 */
import { signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth } from './firebase-init.js';
import { guardPage } from './google-one-tap.js'; // re-exported from the real session-manager.js
import { userStore } from './user-store.js';

export function protectPage() {
  const session = guardPage({
    loginUrl: './login.html?reason=session-expired',
    debug: false,
    onExpire: () => {
      // Fires on natural timeout, expiry found on resume(), a manual
      // expireNow() call (including from wireLogout below), or another
      // tab clearing the session — cover all of them here in one place.
      userStore.clear();
      signOut(auth).catch(() => {});
    },
  });

  if (!session.isActive()) {
    // guardPage() has already redirected (or is mid-redirect) to
    // loginUrl — the caller should render nothing further.
    return { session, profile: null, ok: false };
  }

  const profile = userStore.get();
  if (!profile) {
    // Session clock is running but we have no idea who this is —
    // don't render a page with an empty identity, force a clean
    // re-login instead.
    session.expireNow();
    return { session, profile: null, ok: false };
  }

  return { session, profile, ok: true };
}

/** Wires a sign-out element to fully tear down: clears the profile,
 *  signs out of Firebase, then ends the SessionManager session (which
 *  triggers onExpire above and redirects to login). */
export function wireLogout(session, buttonEl) {
  if (!buttonEl) return;
  buttonEl.addEventListener('click', (e) => {
    e.preventDefault();
    session.expireNow(); // onExpire (set in protectPage) clears profile + signs out + redirects
  });
}
