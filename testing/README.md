# Kanyadet School — Admin Portal

## What's here
- `login.html` — Google One Tap + email/password sign-in. Resolves the signed-in user's role and routes them to the right portal.
- `dashboard.html` — admin/advanced-admin dashboard, styled after your reference design. Sidebar items are hidden per role via `ROLE_NAV`. The "Weekly attendance" card pulls a live today's-submission count from `PATHS.ATTENDANCE_PATH` in the Realtime Database; everything else on it is still sample data.
- `teacher-portal.html` — live, working CRUD against `resources`, `leaveRequests`, and `welfareContributions`, matching your Firestore rules exactly (own-record reads, `uid`/`createdByUid` ownership on create, immutable welfare log).
- `parent-portal.html` — self-registration flow: creates `parents/{uid}` (status `pending`) and `authorizedParents/{email}`, polls for admin approval, flips to the approved view per the exact rule your `parents` collection allows (self-approve only if `authorizedParents` already says `approved`).
- `no-access.html` — fallback for a signed-in user with no matching `users`/`authorized_users` record.
- `js/firebase-init.js` — **the one place `initializeApp()` is called.** Every page imports `auth`/`db`/`rtdb` from here — don't call `initializeApp()` again in a page, Firebase will double-init.
- `js/roles.js` — resolves role client-side by reading the *same* documents your Firestore rules check (`users/{uid}`, `authorized_users/{email}`), so the UI stays consistent with what the backend will actually allow. This grants nothing by itself — the rules are still the real enforcement.
- `js/session-manager.js` — **placeholder**, still pending your real file. Same exports (`SessionManager`, `guardPage`); now also stores the resolved role on the session record so pages don't re-query Firestore every load.
- `js/config.js`, `js/google-one-tap.js` — your files, unchanged.
- `css/styles.css` — shared design system.

## ⚠️ Flagged from your Firestore rules
- **`messages/{document=**}` and `message_threads/{document=**}` allow `read, write: if true`** — open to anyone, including unauthenticated requests, not just signed-in users. If that's intentional (e.g. a public contact form) it's fine; if not, this is a real data-exposure gap worth tightening to `if request.auth != null` at minimum.
- Three parallel admin checks (`isAdmin()` by email, `isAdminByUID()`/`isAdvancedAdmin()` by uid) and three separate audit-log collections (`auditLog`, `auditLogs`, `audit_logs`) are all live at once. `roles.js` reads all the relevant docs to stay consistent with this, but it's worth eventually consolidating so a staff member can't be "admin" under one check and not another.
- I don't have your **Realtime Database rules**, only Firestore's. The live attendance read in `dashboard.html` assumes `ATTENDANCE_PATH` is readable by any authenticated user — verify that before relying on it.

## Try it
Serve the folder locally (ES module imports need `http://`, not `file://`):

```bash
python3 -m http.server 8080
# then open http://localhost:8080/login.html
```

## Before this goes live
1. **Replace `js/session-manager.js`** with your real implementation (keep the same two exports).
2. **Enable Auth providers** in the Firebase console for `kanyadet-school-admin`: Google, and Email/Password if you want the fallback form to work.
3. **Add your domain** to the OAuth consent screen's authorized origins (and `localhost` while testing).
4. Decide on the `messages`/`message_threads` access flagged above.
5. Get me your Realtime Database rules so the attendance/results modules can be built against confirmed read/write permissions instead of assumptions.

## Still placeholder / not wired to live data
- Results, Timetables, Calendar, Announcements, Library, Settings, and the audit log viewer — sidebar links exist, nothing behind them yet.
- Dashboard's Overview, term-progress, term-goals, and "jump back in" tiles are still sample data.
