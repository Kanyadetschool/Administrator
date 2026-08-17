/**
 * user-store.js
 * session-manager.js deliberately only tracks a session EXPIRY timestamp —
 * it has no concept of who's signed in. This stores the resolved profile
 * (uid, email, name, picture, role, isAdmin, isAdvancedAdmin, isTeacher)
 * alongside it, in localStorage so it's available the moment a protected
 * page loads and stays in sync across tabs like the session itself does.
 *
 * Lifecycle: userStore.set() right after resolveUserRole() succeeds on
 * login, userStore.get() on every protected page, userStore.clear()
 * whenever the session ends (logout OR expiry) — always paired with
 * clearing/expiring the SessionManager itself, never used alone as an
 * access check.
 */

const PROFILE_KEY = 'kanyadet_profile';

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
