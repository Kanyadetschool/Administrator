// dashboard-widgets.js
//
// Four additive Dashboard widgets, following the same pattern as
// overdue-automation.js / reservations.js / class-library.js: a small
// self-contained class that opens its own Firebase listeners (rather than
// hooking into DashboardFunctions' internal state) and self-initializes on
// DOMContentLoaded. Nothing here replaces existing dashboard code — it only
// fills in the new stat cards / panels added to the Dashboard page.
//
// Widgets:
//   1. Fines snapshot      — outstanding-fines stat card + "Fines to Collect" list
//   2. Due This Week       — active loans due in the next 7 days, with a Remind button
//   3. Reservation queue   — students-waiting stat card + "Most Reserved" list
//   4. Class Library health— per-grade out/overdue counts

class DashboardWidgetsManager {
    constructor() {
        this.db = firebase.database();
        this.finesRef = this.db.ref('fines');
        this.issuanceRef = this.db.ref('issuance');
        this.reservationsRef = this.db.ref('reservations');
        this.init();
    }

    init() {
        this.wireFines();
        this.wireIssuanceWidgets();
        this.wireReservations();
        this.wireRemindButtonDelegation();
    }

    // ---------------- 1. Fines snapshot ----------------
    wireFines() {
        this.finesRef.on('value', (snapshot) => {
            let totalOutstanding = 0;
            const rows = [];

            if (snapshot.exists()) {
                snapshot.forEach((child) => {
                    const fine = child.val();
                    if (!fine || fine.status === 'waived') return;
                    const outstanding = Number(
                        fine.amountOutstanding ?? ((Number(fine.amount) || 0) - (Number(fine.amountPaid) || 0))
                    );
                    if (outstanding > 0) {
                        totalOutstanding += outstanding;
                        rows.push({ studentName: fine.studentName || 'Unknown student', outstanding });
                    }
                });
            }

            const totalEl = document.getElementById('dashOutstandingFines');
            if (totalEl) totalEl.textContent = `Ksh ${totalOutstanding.toFixed(2)}`;

            const list = document.getElementById('topUnpaidFinesList');
            if (!list) return;
            if (rows.length === 0) {
                list.innerHTML = `<p class="leaderboard-empty">No outstanding fines.</p>`;
                return;
            }
            const top = rows.sort((a, b) => b.outstanding - a.outstanding).slice(0, 5);
            list.innerHTML = top.map((r, i) => `
                <div class="leaderboard-item">
                    <span class="leaderboard-rank">${i + 1}</span>
                    <span class="leaderboard-name">${r.studentName}</span>
                    <span class="leaderboard-count">Ksh ${r.outstanding.toFixed(2)}</span>
                </div>
            `).join('');
        }, (error) => console.error('Dashboard widgets: fines listener error', error));
    }

    // ---------------- 2 & 4. Due This Week + Class Library health ----------------
    // Share one 'issuance' listener since both are derived from the same
    // active-loan set.
    wireIssuanceWidgets() {
        this.issuanceRef.on('value', (snapshot) => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const dueSoon = [];
            const byGrade = {}; // grade -> { out, overdue }

            if (snapshot.exists()) {
                snapshot.forEach((child) => {
                    const issuance = child.val();
                    if (!issuance || issuance.status !== 'active' || !issuance.returnDate) return;

                    const grade = issuance.grade || 'Ungraded';
                    if (!byGrade[grade]) byGrade[grade] = { out: 0, overdue: 0 };
                    byGrade[grade].out++;

                    const returnDate = new Date(issuance.returnDate);
                    returnDate.setHours(0, 0, 0, 0);
                    const daysUntilDue = Math.round((returnDate - today) / 86400000);

                    if (daysUntilDue < 0) {
                        byGrade[grade].overdue++;
                    } else if (daysUntilDue <= 7) {
                        dueSoon.push({
                            issuanceId: child.key,
                            studentId: issuance.studentId || '',
                            studentName: issuance.studentName || 'Unknown student',
                            grade,
                            bookTitle: issuance.bookTitle || 'Untitled',
                            returnDate: issuance.returnDate,
                            daysUntilDue
                        });
                    }
                });
            }

            this.renderDueThisWeek(dueSoon);
            this.renderClassHealth(byGrade);
        }, (error) => console.error('Dashboard widgets: issuance listener error', error));
    }

    renderDueThisWeek(rows) {
        const container = document.getElementById('dueThisWeekList');
        if (!container) return;

        if (rows.length === 0) {
            container.innerHTML = `<p class="leaderboard-empty">Nothing due in the next 7 days.</p>`;
            return;
        }

        rows.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

        container.innerHTML = rows.slice(0, 8).map((r) => {
            const dueLabel = r.daysUntilDue === 0 ? 'Due today' : `Due in ${r.daysUntilDue}d`;
            // Staff loans (see staff-issuance.js) have no studentId and no
            // way to receive a message — messages/ is only ever read by
            // student-portal.js — so skip the dead-end Remind button for them.
            const isStaff = r.grade === 'Staff';
            const remindBtn = isStaff ? '' : `
                    <button type="button" class="btn btn-sm btn-outline-primary due-remind-btn"
                        data-student-id="${r.studentId}"
                        data-student-name="${r.studentName}"
                        data-grade="${r.grade}"
                        data-book-title="${r.bookTitle}"
                        data-return-date="${r.returnDate}">
                        Remind
                    </button>`;
            return `
                <div class="leaderboard-item due-item">
                    <span class="leaderboard-name">
                        ${r.studentName} <small class="text-muted">(${r.grade})</small><br>
                        <small class="text-muted">${r.bookTitle}</small>
                    </span>
                    <span class="leaderboard-count">${dueLabel}</span>
                    ${remindBtn}
                </div>
            `;
        }).join('');
    }

    renderClassHealth(byGrade) {
        const container = document.getElementById('classHealthTable');
        if (!container) return;

        const grades = Object.entries(byGrade).sort((a, b) => b[1].overdue - a[1].overdue);
        if (grades.length === 0) {
            container.innerHTML = `<p class="leaderboard-empty">No active loans.</p>`;
            return;
        }

        container.innerHTML = `
            <table class="table table-sm class-health-table mb-0">
                <thead>
                    <tr><th>Grade</th><th class="text-end">Out</th><th class="text-end">Overdue</th></tr>
                </thead>
                <tbody>
                    ${grades.slice(0, 8).map(([grade, counts]) => `
                        <tr class="${counts.overdue > 0 ? 'table-danger' : ''}">
                            <td>${grade}</td>
                            <td class="text-end">${counts.out}</td>
                            <td class="text-end">${counts.overdue}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    // ---------------- 3. Reservation queue snapshot ----------------
    wireReservations() {
        this.reservationsRef.on('value', async (snapshot) => {
            let totalWaiting = 0;
            const queues = [];

            if (snapshot.exists()) {
                snapshot.forEach((bookChild) => {
                    const queueLength = bookChild.numChildren();
                    totalWaiting += queueLength;
                    if (queueLength > 0) queues.push({ bookId: bookChild.key, queueLength });
                });
            }

            const totalEl = document.getElementById('dashStudentsWaiting');
            if (totalEl) totalEl.textContent = String(totalWaiting);

            const list = document.getElementById('mostReservedList');
            if (!list) return;

            if (queues.length === 0) {
                list.innerHTML = `<p class="leaderboard-empty">No active reservations.</p>`;
                return;
            }

            const top = queues.sort((a, b) => b.queueLength - a.queueLength).slice(0, 3);
            const withTitles = await Promise.all(top.map(async (q) => {
                let title = 'Unknown title';
                try {
                    const book = await window.getBookCached(q.bookId);
                    if (book && book.title) title = book.title;
                } catch (e) { /* leave as Unknown title */ }
                return { ...q, title };
            }));

            list.innerHTML = withTitles.map((q, i) => `
                <div class="leaderboard-item">
                    <span class="leaderboard-rank">${i + 1}</span>
                    <span class="leaderboard-name">${q.title}</span>
                    <span class="leaderboard-count">${q.queueLength} waiting</span>
                </div>
            `).join('');
        }, (error) => console.error('Dashboard widgets: reservations listener error', error));
    }

    // ---------------- Remind button (event delegation — the list re-renders often) ----------------
    wireRemindButtonDelegation() {
        const container = document.getElementById('dueThisWeekList');
        if (!container) return;

        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.due-remind-btn');
            if (!btn) return;
            this.sendReminder(btn);
        });
    }

    async sendReminder(btn) {
        const { studentId, studentName, grade, bookTitle, returnDate } = btn.dataset;
        if (!studentId) {
            if (window.Swal) Swal.fire('Missing student', 'This loan record has no linked student ID.', 'warning');
            return;
        }

        const text = `Reminder: "${bookTitle}" is due back on ${returnDate}. Please return it to the library on time.`;

        btn.disabled = true;
        const originalLabel = btn.textContent;
        btn.textContent = 'Sending…';

        try {
            await this.db.ref('messages').push({
                type: 'message',
                title: 'Book Return Reminder',
                subject: 'Book Return Reminder',
                message: text,
                description: text,
                studentId,
                studentName,
                studentGrade: grade,
                sender: 'librarian',
                status: 'pending',
                read: false,
                readByStudent: false,
                readByLibrarian: true,
                timestamp: Date.now()
            });
            btn.textContent = 'Sent ✓';
            if (window.Swal) {
                Swal.fire({ icon: 'success', title: 'Reminder sent', timer: 1400, showConfirmButton: false });
            }
        } catch (error) {
            console.error('Dashboard widgets: failed to send reminder', error);
            btn.disabled = false;
            btn.textContent = originalLabel;
            if (window.Swal) Swal.fire('Error', 'Could not send the reminder. Please try again.', 'error');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.dashboardWidgetsManager = new DashboardWidgetsManager();
});