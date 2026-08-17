/**
 * roles.js — resolves a signed-in Firebase user's role by reading the
 * SAME documents your Firestore rules check, so the UI can gate nav and
 * routing consistently with what the backend will actually allow.
 *
 * This is a UI convenience only — it grants no access by itself. Every
 * read/write it triggers is still enforced server-side by firestore.rules
 * (isAdmin / isAdminByUID / isAdvancedAdmin / isTeacher). If a rule and
 * this file ever disagree, the rule wins and the request just fails.
 *
 * Mirrors, from firestore.rules:
 *   isAdmin()         -> authorized_users/{email}.role == 'admin'
 *   isAdminByUID()     -> users/{uid}.role == 'admin'
 *   isAdvancedAdmin()  -> users/{uid}.Advancedadmin == true
 *   isTeacher()        -> users/{uid}.role == 'Teacher'
 */
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-init.js';

/**
 * @returns {Promise<{
 *   role: 'advancedAdmin'|'admin'|'teacher'|'parent'|'unknown',
 *   isAdmin: boolean, isAdvancedAdmin: boolean, isTeacher: boolean,
 *   uid: string, email: string,
 *   usersDoc: object|null, authorizedUserDoc: object|null,
 * }>}
 */
export async function resolveUserRole(firebaseUser) {
  const uid = firebaseUser.uid;
  const email = (firebaseUser.email || '').toLowerCase();

  const [usersSnap, authorizedSnap] = await Promise.all([
    getDoc(doc(db, 'users', uid)).catch(() => null),
    email ? getDoc(doc(db, 'authorized_users', email)).catch(() => null) : Promise.resolve(null),
  ]);

  const usersDoc = usersSnap && usersSnap.exists() ? usersSnap.data() : null;
  const authorizedUserDoc = authorizedSnap && authorizedSnap.exists() ? authorizedSnap.data() : null;

  const isAdminByUID = usersDoc?.role === 'admin';
  const isAdminByEmail = authorizedUserDoc?.role === 'admin';
  const isAdvancedAdmin = usersDoc?.Advancedadmin === true;
  const isTeacher = usersDoc?.role === 'Teacher';
  const isAdmin = isAdminByUID || isAdminByEmail || isAdvancedAdmin;

  let role = 'unknown';
  if (isAdvancedAdmin) role = 'advancedAdmin';
  else if (isAdmin) role = 'admin';
  else if (isTeacher) role = 'teacher';
  else if (!usersDoc && !authorizedUserDoc) role = 'parent'; // no staff doc at all -> treat as parent/unrecognized
  else role = 'unknown';

  return { role, isAdmin, isAdvancedAdmin, isTeacher, uid, email, usersDoc, authorizedUserDoc };
}

/** Which nav modules a role is allowed to see, for client-side gating only. */
export const ROLE_NAV = {
  advancedAdmin: ['dashboard', 'calendar', 'announcements', 'results', 'attendance', 'timetables', 'leave', 'welfare', 'resources', 'library', 'settings', 'auditlog'],
  admin:         ['dashboard', 'calendar', 'announcements', 'results', 'attendance', 'timetables', 'leave', 'welfare', 'resources', 'library'],
  teacher:       ['resources', 'leave', 'welfare', 'timetables', 'calendar', 'library'],
  parent:        ['parent-home', 'library'],
  unknown:       [],
};

export function landingPageFor(role) {
  switch (role) {
    case 'advancedAdmin':
    case 'admin':
      return './dashboard.html';
    case 'teacher':
      return './teacher-portal.html';
    case 'parent':
      return './parent-portal.html';
    default:
      return './no-access.html';
  }
}
