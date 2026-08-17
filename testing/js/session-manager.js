/**
 * session-manager.js
 * Tracks a session EXPIRY timestamp (SESSION_DURATION_MS from config.js)
 * plus the resolved user profile (uid, email, name, picture, role, isAdmin,
 * isAdvancedAdmin, isTeacher), both in localStorage so they're available
 * the moment a protected page loads and stay in sync across tabs.
 *
 * Lifecycle: `new SessionManager().start(profile)` right after
 * resolveUserRole() succeeds on login, `guardPage()` on every protected
 * page, `SessionManager.clear()` whenever the session ends (logout OR
 * expiry) — always paired with clearing the stored profile, never used
 * alone as an access check.
 */
import { SESSION_DURATION_MS } from './config.js';

const PROFILE_KEY = 'kanyadet_profile';
const SESSION_KEY = 'kanyadet_session';

export const userStore = {
  set(profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  },
  get() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },
  clear() {
    localStorage.removeItem(PROFILE_KEY);
  },
};

export class SessionManager {
  /** Starts (or restarts) a session for the given profile and stores it.
   *  Returns the expiry timestamp (ms epoch). */
  start(profile) {
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ expiresAt }));
    userStore.set(profile);
    return expiresAt;
  }

  /** Slides the expiry forward without touching the stored profile.
   *  No-op if there's no active session. */
  static touch() {
    if (!SessionManager.isActive()) return;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ expiresAt: Date.now() + SESSION_DURATION_MS }));
  }

  /** True if a non-expired session exists. */
  static isActive() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const { expiresAt } = JSON.parse(raw);
      return typeof expiresAt === 'number' && Date.now() < expiresAt;
    } catch (e) {
      return false;
    }
  }

  /** Clears both the session expiry and the stored profile. Always call
   *  this alongside Firebase signOut() on logout, and it's also what
   *  guardPage() calls itself when it finds an expired/invalid session. */
  static clear() {
    localStorage.removeItem(SESSION_KEY);
    userStore.clear();
  }
}

/**
 * Runs `onAuthed(profile)` if there's a live session + stored profile,
 * otherwise clears any stale state and runs `onUnauthed()`. Re-evaluates
 * automatically when the session/profile changes in another tab (e.g. a
 * sign-out on one tab logs every open tab out), matching the "stays in
 * sync across tabs like the session itself does" behavior every page
 * here relies on.
 *
 * @param {{onAuthed?: (profile: object) => void, onUnauthed?: () => void}} handlers
 */
export function guardPage({ onAuthed, onUnauthed } = {}) {
  function evaluate() {
    if (SessionManager.isActive()) {
      const profile = userStore.get();
      if (profile) {
        if (typeof onAuthed === 'function') onAuthed(profile);
        return;
      }
    }
    // Expired, or a session marker with no matching profile — treat as
    // signed out and make sure both halves are actually cleared.
    SessionManager.clear();
    if (typeof onUnauthed === 'function') onUnauthed();
  }

  evaluate();

  window.addEventListener('storage', (e) => {
    if (e.key === SESSION_KEY || e.key === PROFILE_KEY) evaluate();
  });
}