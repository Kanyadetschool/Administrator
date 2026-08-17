/**
 * students-data.js
 * Reads the real student roster from the Realtime Database at
 * `artifacts/${sanitizedAppId}/students`.
 *
 * CONFIRMED structure: flat, keyed by Assessment No —
 *   artifacts/{appId}/students/{assessmentNo} = { Grade, 'Official
 *   Student Name', UPI, Gender, ... }
 * (Not nested per grade — that ambiguity from the first version of
 * this file is resolved.)
 *
 * Known fields (from the uploaded roster's headers), used as-is:
 *   Grade, 'Assessment No', 'Official Student Name', UPI, Gender,
 *   'Birth Entry', Class, DOB, DateOfAdmission, Dissability, District,
 *   Email, Father, 'Home phone', IDNO, 'Medical Condition', Mother,
 *   Status, 'Where Born', _pdfHref, _prevGrade, _promotedAt,
 *   _promotedBy, _searchCache, birthCertName
 *
 * Blank/unknown values in the source data show up as '', '---', or
 * 'N/A' interchangeably — isBlank() treats all three as empty.
 *
 * PERFORMANCE: this path is a DIFFERENT store from Firestore, so there's
 * no query/index/pagination layer here unless your RTDB rules add one
 * (see the README note on `.indexOn`). A single get() on this node pulls
 * every field for every student — including the large `_searchCache`
 * string per record — in one shot, which is what was making loads slow.
 * Two things fix that at this layer:
 *   1. Cache the fetched roster in sessionStorage for a few minutes, so
 *      navigating dashboard → students → dashboard doesn't refetch the
 *      whole thing each time.
 *   2. Drop `_searchCache` and `_pdfHref` from each record right after
 *      the read — they're never used by the dashboard or the directory,
 *      so there's no reason to keep carrying them around in memory or
 *      in the cache.
 * The one thing this can't fix is the initial network transfer size —
 * that needs either a schema change (splitting large fields into a
 * separate node so summary reads stay light) or an RTDB index so a
 * grade-scoped query doesn't have to download the whole node. Flagged
 * in the README.
 */
import { ref, get } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { rtdb } from './firebase-init.js';
import { APP_ID } from './config.js';

const CACHE_KEY_PREFIX = 'kanyadet_students_cache_';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — covers dashboard <-> students navigation without showing a stale roster for long

function sanitizeAppId(id) {
  return String(id).replace(/[.#$[\]]/g, '_');
}

function isBlank(v) {
  if (v === null || v === undefined) return true;
  const s = String(v).trim().toLowerCase();
  return s === '' || s === '---' || s === 'n/a' || s === 'none.' || s === 'none';
}

function looksLikeStudent(obj) {
  return obj && typeof obj === 'object' && ('Official Student Name' in obj || 'UPI' in obj || 'Assessment No' in obj);
}

/** Confirmed flat: artifacts/{appId}/students/{assessmentNo} = record.
 *  Kept defensive (falls back to one level of nesting) only in case a
 *  future export or migration changes the shape — but the fast path
 *  below is what actually runs today. */
function flattenStudents(node) {
  if (!node || typeof node !== 'object') return [];

  const topLevel = Object.values(node);
  const flat = topLevel.filter(looksLikeStudent);
  if (flat.length === topLevel.length) return flat; // confirmed flat shape — done, no recursion needed

  // Fallback for an unexpected nested shape (e.g. grouped by grade).
  const results = [...flat];
  topLevel.forEach((child) => {
    if (looksLikeStudent(child)) return; // already counted above
    if (child && typeof child === 'object') {
      Object.values(child).forEach((grandchild) => {
        if (looksLikeStudent(grandchild)) results.push(grandchild);
      });
    }
  });
  return results;
}

function stripUnusedFields(record) {
  const { _searchCache, _pdfHref, ...rest } = record;
  return rest;
}

function cacheKey() {
  return `${CACHE_KEY_PREFIX}${sanitizeAppId(APP_ID)}`;
}

function readCache() {
  try {
    const raw = sessionStorage.getItem(cacheKey());
    if (!raw) return null;
    const { fetchedAt, students } = JSON.parse(raw);
    if (!fetchedAt || Date.now() - fetchedAt > CACHE_TTL_MS) return null;
    return students;
  } catch (err) {
    return null;
  }
}

function writeCache(students) {
  try {
    sessionStorage.setItem(cacheKey(), JSON.stringify({ fetchedAt: Date.now(), students }));
  } catch (err) {
    // sessionStorage full or unavailable — fine, just means no caching this session
    console.warn('[students-data] could not cache roster:', err);
  }
}

/** Fetches (or reuses a cached) full roster. Returns [] on any read
 *  failure rather than throwing, so dashboard widgets fail soft.
 *  Pass { forceRefresh: true } to bypass the cache (e.g. a manual
 *  "Refresh roster" button). */
export async function fetchAllStudents({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = readCache();
    if (cached) return cached;
  }

  try {
    const path = `artifacts/${sanitizeAppId(APP_ID)}/students`;
    const t0 = performance.now();
    const snap = await get(ref(rtdb, path));
    const students = snap.exists()
      ? flattenStudents(snap.val()).map(stripUnusedFields)
      : [];
    console.log(`[students-data] fetched ${students.length} students in ${Math.round(performance.now() - t0)}ms`);
    writeCache(students);
    return students;
  } catch (err) {
    console.error('[students-data] fetchAllStudents failed:', err);
    return [];
  }
}

export function invalidateStudentsCache() {
  try { sessionStorage.removeItem(cacheKey()); } catch (err) { /* no-op */ }
}

/** Aggregate stats used across the dashboard and the students directory. */
export function computeStudentStats(students) {
  const byGrade = {};
  const byGender = {};
  let active = 0;

  students.forEach((s) => {
    const grade = isBlank(s.Grade) ? 'Unassigned' : s.Grade;
    byGrade[grade] = (byGrade[grade] || 0) + 1;

    const gender = isBlank(s.Gender) ? 'Unspecified' : s.Gender;
    byGender[gender] = (byGender[gender] || 0) + 1;

    if (isBlank(s.Status) || String(s.Status).trim().toLowerCase() === 'active') active++;
  });

  return {
    total: students.length,
    active,
    byGrade,
    byGender,
    gradeCount: Object.keys(byGrade).length,
  };
}

export { isBlank };