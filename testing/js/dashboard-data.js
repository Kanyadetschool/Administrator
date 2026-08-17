/**
 * dashboard-data.js
 * Live data for dashboard.html. Every function is defensive: if a
 * collection/path doesn't exist yet, is empty, or the read is denied,
 * it fails soft (logs + shows a neutral state) rather than breaking
 * the rest of the page. Collections used all come straight from
 * firestore.rules: Students, teachers, resources, leaveRequests,
 * welfareContributions. Realtime Database path comes from config.js's
 * PATHS.ATTENDANCE_PATH.
 *
 * ASSUMPTIONS (flagged since they weren't given explicitly):
 *  - Students and teachers collections are flat (one doc per student/
 *    teacher at the top level) — the rules' `{document=**}` wildcard
 *    also matches this, so a plain collection count is a reasonable
 *    read, but if your data actually lives in nested subcollections
 *    per grade, these counts will read as 0 and need adjusting.
 *  - ATTENDANCE_PATH in the Realtime Database is shaped as
 *    `attendance/{yyyy-mm-dd}/{classKey}: {...}` — i.e. one child key
 *    per class that submitted that day. The chart counts child keys,
 *    not individual student records.
 */
import {
  collection, getDocs, getCountFromServer, query, where, orderBy, limit,
  doc, updateDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { ref, get } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, rtdb } from './firebase-init.js';
import { PATHS } from './config.js';
import { fetchAllStudents, computeStudentStats } from './students-data.js';

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function safeCount(collectionName, ...constraints) {
  try {
    const q = constraints.length
      ? query(collection(db, collectionName), ...constraints)
      : collection(db, collectionName);
    const snap = await getCountFromServer(q);
    return snap.data().count;
  } catch (err) {
    console.error(`[dashboard-data] count failed for ${collectionName}:`, err);
    return null;
  }
}

/** Overview card: students (from RTDB roster), classes/grades, teachers,
 *  pending leave, welfare total, resources. */
export async function loadOverviewStats() {
  const [students, teachers, pendingLeave, resources] = await Promise.all([
    fetchAllStudents(),
    safeCount('teachers'),
    safeCount('leaveRequests', where('status', '==', 'pending')),
    safeCount('resources'),
  ]);

  const stats = computeStudentStats(students);
  setText('stat-students', stats.total ? stats.total.toLocaleString() : '—');
  setText('stat-classes', stats.gradeCount ? stats.gradeCount.toLocaleString() : '—');
  setText('stat-teachers', teachers === null ? '—' : teachers.toLocaleString());
  setText('stat-pending-leave', pendingLeave === null ? '—' : pendingLeave.toLocaleString());
  setText('stat-resources', resources === null ? '—' : resources.toLocaleString());
  renderGradeBreakdown(stats);

  // Welfare total needs the actual amounts, not just a count.
  try {
    const snap = await getDocs(collection(db, 'welfareContributions'));
    let total = 0;
    snap.forEach((d) => { total += Number(d.data().amount) || 0; });
    setText('stat-welfare-total', total.toLocaleString());
  } catch (err) {
    console.error('[dashboard-data] welfare total failed:', err);
    setText('stat-welfare-total', '—');
  }
}

function renderGradeBreakdown(stats) {
  const el = document.getElementById('grade-breakdown-list');
  if (!el) return;
  const entries = Object.entries(stats.byGrade).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    el.innerHTML = '<p class="empty-note">No student records found yet.</p>';
    return;
  }
  const max = Math.max(...entries.map(([, n]) => n));
  el.innerHTML = entries.map(([grade, n]) => `
    <div class="row-item" style="gap:10px;">
      <span style="min-width:70px;font-weight:600;">${escapeHtml(grade)}</span>
      <span style="flex:1;height:6px;border-radius:999px;background:var(--line);overflow:hidden;">
        <span style="display:block;height:100%;width:${Math.max(4, (n / max) * 100)}%;background:var(--ink);"></span>
      </span>
      <span class="row-time" style="margin-left:0;">${n}</span>
    </div>
  `).join('');
}

/** Pending actions: live pending leave requests, oldest first, with approve/reject. */
export async function loadPendingActions() {
  const grid = document.getElementById('pending-actions-grid');
  const countEl = document.getElementById('pending-actions-count');
  if (!grid) return;

  try {
    const q = query(
      collection(db, 'leaveRequests'),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'asc'),
      limit(6),
    );
    const snap = await getDocs(q);
    if (countEl) countEl.textContent = `(${snap.size})`;

    if (snap.empty) {
      grid.innerHTML = '<p class="empty-note" style="grid-column:1/-1;">No pending leave requests.</p>';
      return;
    }

    grid.innerHTML = '';
    snap.forEach((docSnap) => {
      const r = docSnap.data();
      const card = document.createElement('div');
      card.className = 'task-mini';
      card.innerHTML = `
        <div class="top-row">
          <div class="icon-chip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>
          </div>
          <span class="wip-badge">Pending</span>
        </div>
        <div class="title">${escapeHtml(r.name || 'Unknown staff')} — ${escapeHtml(r.start || '')} to ${escapeHtml(r.end || '')}</div>
        <div class="meta" style="gap:6px;">
          <button class="btn btn-primary" data-action="approve" style="padding:5px 10px;font-size:11px;">Approve</button>
          <button class="btn btn-ghost" data-action="reject" style="padding:5px 10px;font-size:11px;">Reject</button>
        </div>
      `;
      card.querySelector('[data-action="approve"]').addEventListener('click', () => resolveLeaveRequest(docSnap.id, 'approved', card));
      card.querySelector('[data-action="reject"]').addEventListener('click', () => resolveLeaveRequest(docSnap.id, 'rejected', card));
      grid.appendChild(card);
    });
  } catch (err) {
    console.error('[dashboard-data] pending actions failed:', err);
    grid.innerHTML = '<p class="empty-note" style="grid-column:1/-1;">Couldn\'t load pending actions right now.</p>';
  }
}

async function resolveLeaveRequest(docId, newStatus, cardEl) {
  try {
    await updateDoc(doc(db, 'leaveRequests', docId), {
      status: newStatus,
      resolvedAt: serverTimestamp(),
    });
    cardEl.style.opacity = '0.4';
    cardEl.style.pointerEvents = 'none';
  } catch (err) {
    console.error('[dashboard-data] resolveLeaveRequest failed:', err);
    alert('Could not update that request — check your connection and try again.');
  }
}

function fmtWhen(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Recent activity feed: merges resources / leaveRequests / welfareContributions by createdAt. */
export async function loadRecentActivity() {
  const el = document.getElementById('recent-activity-list');
  if (!el) return;

  try {
    const [resSnap, leaveSnap, welfareSnap] = await Promise.all([
      getDocs(query(collection(db, 'resources'), orderBy('createdAt', 'desc'), limit(5))),
      getDocs(query(collection(db, 'leaveRequests'), orderBy('createdAt', 'desc'), limit(5))),
      getDocs(query(collection(db, 'welfareContributions'), orderBy('createdAt', 'desc'), limit(5))),
    ]);

    const items = [];
    resSnap.forEach((d) => {
      const r = d.data();
      items.push({ ts: r.createdAt, dot: 'status-dot-done', text: `Resource shared: ${r.title || 'Untitled'}` });
    });
    leaveSnap.forEach((d) => {
      const r = d.data();
      items.push({ ts: r.createdAt, dot: r.status === 'pending' ? 'status-dot-pending' : 'status-dot-done', text: `Leave request from ${r.name || 'staff'} — ${r.status || 'pending'}` });
    });
    welfareSnap.forEach((d) => {
      const r = d.data();
      items.push({ ts: r.createdAt, dot: 'status-dot-done', text: `Welfare contribution logged (KES ${r.amount ?? '—'})` });
    });

    items.sort((a, b) => {
      const ta = a.ts?.toMillis ? a.ts.toMillis() : 0;
      const tb = b.ts?.toMillis ? b.ts.toMillis() : 0;
      return tb - ta;
    });

    const top = items.slice(0, 6);
    if (top.length === 0) {
      el.innerHTML = '<p class="empty-note">No activity yet.</p>';
      return;
    }
    el.innerHTML = top.map(i => `
      <div class="row-item"><span class="row-dot ${i.dot}"></span> ${escapeHtml(i.text)} <span class="row-time">${fmtWhen(i.ts)}</span></div>
    `).join('');
  } catch (err) {
    console.error('[dashboard-data] recent activity failed:', err);
    el.innerHTML = '<p class="empty-note">Couldn\'t load recent activity right now.</p>';
  }
}

/** Recently shared resources as tiles. */
export async function loadRecentResources() {
  const grid = document.getElementById('recent-resources-grid');
  if (!grid) return;

  try {
    const q = query(collection(db, 'resources'), orderBy('createdAt', 'desc'), limit(3));
    const snap = await getDocs(q);
    if (snap.empty) {
      grid.innerHTML = '<p class="empty-note" style="grid-column:1/-1;">No resources shared yet.</p>';
      return;
    }
    grid.innerHTML = '';
    let i = 0;
    snap.forEach((d) => {
      const r = d.data();
      const tile = document.createElement('a');
      tile.className = `tile ${i === 1 ? 'tile-dark' : 'tile-light'}`;
      tile.href = r.link && /^https?:\/\//.test(r.link) ? r.link : '#';
      tile.target = tile.href !== '#' ? '_blank' : '_self';
      tile.rel = 'noopener';
      tile.innerHTML = `
        <div class="tile-title">${escapeHtml(r.title || 'Untitled')}</div>
        <div class="tile-meta"><span class="row-dot status-dot-done"></span> ${escapeHtml(r.createdByName || 'Staff')} — ${fmtWhen(r.createdAt)}</div>
      `;
      grid.appendChild(tile);
      i++;
    });
  } catch (err) {
    console.error('[dashboard-data] recent resources failed:', err);
    grid.innerHTML = '<p class="empty-note" style="grid-column:1/-1;">Couldn\'t load resources right now.</p>';
  }
}

/** Attendance chart: classes-submitted count per day for the last 7 days. */
export async function loadAttendanceChart() {
  const svg = document.getElementById('attendance-polyline');
  const labelsEl = document.getElementById('attendance-chart-labels');
  if (!svg || !labelsEl) return;

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  try {
    const counts = await Promise.all(days.map(async (d) => {
      const key = d.toISOString().slice(0, 10);
      try {
        const snap = await get(ref(rtdb, `${PATHS.ATTENDANCE_PATH}/${key}`));
        return snap.exists() ? Object.keys(snap.val()).length : 0;
      } catch (err) {
        return 0;
      }
    }));

    const max = Math.max(1, ...counts);
    const w = 300, h = 110, pad = 10;
    const stepX = (w) / (counts.length - 1);
    const points = counts.map((c, i) => {
      const x = i * stepX;
      const y = h - pad - (c / max) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    svg.setAttribute('points', points);

    labelsEl.innerHTML = days.map((d, i) => {
      const isToday = i === days.length - 1;
      const label = d.toLocaleDateString(undefined, { weekday: 'short' });
      return `<span style="${isToday ? 'font-weight:700;color:var(--ink);' : ''}">${label}</span>`;
    }).join('');
  } catch (err) {
    console.error('[dashboard-data] attendance chart failed:', err);
    labelsEl.innerHTML = '<span>Couldn\'t load attendance history.</span>';
  }
}

/** Today's attendance summary line under the chart. */
export async function loadTodayAttendanceSummary() {
  const el = document.querySelector('[data-module="attendance-summary"]');
  if (!el) return;
  try {
    const todayKey = new Date().toISOString().slice(0, 10);
    const snap = await get(ref(rtdb, `${PATHS.ATTENDANCE_PATH}/${todayKey}`));
    if (!snap.exists()) { el.textContent = 'No attendance submitted for today yet.'; return; }
    const classes = Object.keys(snap.val()).length;
    el.textContent = `${classes} class${classes === 1 ? '' : 'es'} submitted today.`;
  } catch (err) {
    console.error('[dashboard-data] today attendance failed:', err);
    el.textContent = 'Could not load live attendance right now.';
  }
}

export async function loadAllDashboardData() {
  await Promise.all([
    loadOverviewStats(),
    loadPendingActions(),
    loadRecentActivity(),
    loadRecentResources(),
    loadAttendanceChart(),
    loadTodayAttendanceSummary(),
  ]);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
