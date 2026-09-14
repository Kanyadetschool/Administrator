// Overdue Automation
// -------------------------------------------------------------------------
// The dashboard already computes "overdue" on the fly for display (see
// renderIssuanceCard / updateIssuanceStats in app.js) by comparing
// returnDate to today, but nothing ever acted on that: no reminder ever
// reached the student and nothing recorded how overdue a book was. This
// module adds that missing step without touching the existing "active"
// status field (renderIssuanceCard's Return/Report-Lost buttons key off
// status === 'active', so leaving status alone keeps that working).
//
// For each active, past-due issuance it does not already have a recent
// reminder for, it:
//   1. Stamps issuance/{id} with overdueDays + lastReminderAt (additive
//      fields only — never touches `status`).
//   2. Pushes one entry to `messages` addressed to the student, in the
//      exact shape student-portal.js's loadMessages() and functions.js's
//      loadNotifications() both actually read (subject/description/
//      studentName/studentGrade/readByStudent/read) — confirmed against
//      both files, not guessed.
//   3. Logs one `activities` entry so it shows up in Recent Activities.
//
// Reminders are re-sent at most once every REMINDER_COOLDOWN_DAYS so a
// book overdue for a month doesn't spam the student every scan.
class OverdueAutomation {
    static REMINDER_COOLDOWN_DAYS = 3;

    constructor() {
        this.db = db; // global from firebaseConfig.js / app.js
        this.setupUI();
    }

    setupUI() {
        const btn = document.getElementById('runOverdueScanBtn');
        if (btn) {
            btn.addEventListener('click', () => this.scanForOverdue(true));
        }
        const repairBtn = document.getElementById('repairOverdueMessagesBtn');
        if (repairBtn) {
            repairBtn.addEventListener('click', () => this.repairUnknownStudentMessages());
        }
    }

    // One-time repair for messages already sitting in the database with a
    // blank/"Unknown Student" name — from before the studentName/grade
    // fallback lookup existed in scanForOverdue(), or from any issuance
    // record that still has no matching student. Safe to run repeatedly:
    // it only ever touches messages it can actually resolve a name for.
    // One-time repair for messages already sitting in the database from
    // before two rounds of fixes: (a) blank/"Unknown Student" name (before
    // the studentName/grade fallback lookup existed), and (b) missing
    // `sender: 'librarian'` / non-'resolved' status on our own system
    // notices (overdue/reservation-ready), from before message.js was
    // available to check field usage against — without `sender`,
    // message.js's detail view misattributes these to the student
    // ("From: {studentName}" instead of "Sent by: Librarian"). Safe to
    // run repeatedly: it only ever touches what it can actually fix.
    async repairUnknownStudentMessages() {
        try {
            const snapshot = await this.db.ref('messages').once('value');
            if (!snapshot.exists()) {
                await Swal.fire('Nothing to repair', 'No messages found.', 'info');
                return;
            }

            const broken = [];
            const missingSender = [];
            snapshot.forEach((child) => {
                const msg = child.val();
                const nameLooksBlank = !msg.studentName || msg.studentName === 'Unknown Student';
                if (nameLooksBlank && msg.studentId) {
                    broken.push({ id: child.key, studentId: msg.studentId });
                }
                const isOurSystemNotice = msg.type === 'overdue' || msg.type === 'info';
                if (isOurSystemNotice && msg.sender !== 'librarian') {
                    missingSender.push(child.key);
                }
            });

            if (broken.length === 0 && missingSender.length === 0) {
                await Swal.fire('Nothing to repair', 'No messages needed fixing.', 'info');
                return;
            }

            const studentIds = [...new Set(broken.map(b => b.studentId))];
            const studentLookup = {};
            await Promise.all(studentIds.map(async (studentId) => {
                const s = (await this.db.ref(`students/${studentId}`).once('value')).val();
                if (s) studentLookup[studentId] = (typeof normalizeStudent === 'function') ? normalizeStudent(s) : s;
            }));

            const updates = {};
            let fixed = 0;
            let stillUnresolved = 0;
            for (const { id, studentId } of broken) {
                const student = studentLookup[studentId];
                if (!student) { stillUnresolved++; continue; }
                updates[`messages/${id}/studentName`] = student.name || 'Unknown Student';
                updates[`messages/${id}/studentGrade`] = student.grade || '';
                fixed++;
            }
            for (const id of missingSender) {
                updates[`messages/${id}/sender`] = 'librarian';
                updates[`messages/${id}/status`] = 'resolved';
            }

            if (Object.keys(updates).length > 0) await this.db.ref().update(updates);

            await Swal.fire({
                icon: (fixed > 0 || missingSender.length > 0) ? 'success' : 'warning',
                title: 'Repair complete',
                html: `${fixed} name(s) fixed. ${missingSender.length} system notice(s) corrected to "Sent by: Librarian".` +
                    (stillUnresolved > 0
                        ? `<br>${stillUnresolved} message(s) reference a studentId with no matching student record — those issuances are likely orphaned/legacy data and may be worth reviewing directly.`
                        : '')
            });
        } catch (error) {
            console.error('Error repairing messages:', error);
            await Swal.fire('Error', 'Failed to repair messages: ' + error.message, 'error');
        }
    }

    daysBetween(a, b) {
        return Math.floor((a - b) / (1000 * 60 * 60 * 24));
    }

    async scanForOverdue(manual = false) {
        try {
            const snapshot = await this.db.ref('issuance').once('value');
            if (!snapshot.exists()) {
                if (manual) await Swal.fire('No records', 'There are no issuance records yet.', 'info');
                return { scanned: 0, reminded: 0 };
            }

            const now = Date.now();
            const today = new Date();
            const cooldownMs = OverdueAutomation.REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

            const updates = {};
            let overdueCount = 0;
            let remindedCount = 0;
            const reminderList = [];
            const overdueIssuances = [];

            snapshot.forEach((child) => {
                const issuance = child.val();
                const issuanceId = child.key;
                if (issuance.status !== 'active' || !issuance.returnDate) return;

                const dueDate = new Date(issuance.returnDate);
                if (dueDate >= today) return; // not overdue

                overdueCount++;
                const overdueDays = this.daysBetween(today, dueDate);
                updates[`issuance/${issuanceId}/overdueDays`] = overdueDays;

                const lastReminderAt = issuance.lastReminderAt || 0;
                if (now - lastReminderAt < cooldownMs) return; // reminded recently, skip

                updates[`issuance/${issuanceId}/lastReminderAt`] = now;
                remindedCount++;
                overdueIssuances.push({ issuance, issuanceId, overdueDays });
            });

            // Older issuance records don't always carry a denormalized
            // studentName/grade (bulk-imported ones especially), so
            // backfill from the students node itself for any that need it,
            // rather than pushing "Unknown Student" into the message feed.
            const studentIdsNeedingLookup = [...new Set(
                overdueIssuances
                    .filter(({ issuance }) => !issuance.studentName || !issuance.grade)
                    .map(({ issuance }) => issuance.studentId)
                    .filter(Boolean)
            )];
            const studentLookup = {};
            await Promise.all(studentIdsNeedingLookup.map(async (studentId) => {
                const s = (await this.db.ref(`students/${studentId}`).once('value')).val();
                // Real records use raw keys like "Official Student Name" /
                // "Grade" rather than name/grade — normalizeStudent() (from
                // app.js, loaded before this file) maps those over. Without
                // this, fallback.name/grade are always undefined and every
                // reminder falls through to "Unknown Student" / "N/A".
                if (s) studentLookup[studentId] = (typeof normalizeStudent === 'function') ? normalizeStudent(s) : s;
            }));

            for (const { issuance, issuanceId, overdueDays } of overdueIssuances) {
                const fallback = studentLookup[issuance.studentId] || {};
                const studentName = issuance.studentName || fallback.name || 'Unknown Student';
                const grade = issuance.grade || fallback.grade || '';
                reminderList.push({ issuance, issuanceId, overdueDays, studentName, grade });
            }

            if (Object.keys(updates).length > 0) {
                await this.db.ref().update(updates);
            }

            for (const { issuance, issuanceId, overdueDays, studentName, grade } of reminderList) {
                const text = `"${issuance.bookTitle || 'A book'}" was due on ${issuance.returnDate} and is now ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue. Please return it to the library.`;
                // Shape confirmed against three separate consumers, each with
                // slightly different field priority — this covers all of them:
                // student-portal.js's loadMessages() (subject/description/
                // studentName/studentGrade/readByStudent), functions.js's
                // loadNotifications() (subject/read/type — 'overdue' matches
                // an existing icon), and message.js's detail view + thread
                // (sender==='librarian' for the "Sent by: Librarian" header —
                // omitting this made earlier reminders misattribute to the
                // student instead; status 'pending'/'resolved' for the badge
                // and the sidebar's unread count, which counts status==='pending'
                // specifically, not readByLibrarian; message.message||description
                // for the chat bubble). read/readByLibrarian/status:'resolved'
                // reflect that this is an outbound system notice, not an
                // incoming item needing librarian triage.
                await this.db.ref('messages').push({
                    issuanceId,
                    studentId: issuance.studentId,
                    studentName,
                    studentGrade: grade,
                    bookId: issuance.bookId,
                    bookTitle: issuance.bookTitle || '',
                    type: 'overdue',
                    subject: `Overdue: ${issuance.bookTitle || 'Book'}`,
                    description: text,
                    message: text,
                    status: 'resolved',
                    sender: 'librarian',
                    timestamp: now,
                    readByStudent: false,
                    readByLibrarian: true,
                    read: true
                });
                await this.db.ref('activities').push({
                    type: 'overdue_reminder',
                    bookId: issuance.bookId,
                    studentId: issuance.studentId,
                    description: `Sent overdue reminder to ${studentName} for "${issuance.bookTitle || 'book'}" (${overdueDays}d overdue)`,
                    timestamp: now
                });
            }

            if (manual) {
                await Swal.fire({
                    icon: 'success',
                    title: 'Overdue scan complete',
                    html: `${overdueCount} book(s) currently overdue.<br>${remindedCount} reminder(s) sent just now.`,
                    timer: 2500,
                    showConfirmButton: true
                });
            } else if (remindedCount > 0) {
                console.log(`Overdue Automation: sent ${remindedCount} reminder(s) for ${overdueCount} overdue book(s).`);
            }

            return { scanned: overdueCount, reminded: remindedCount };
        } catch (error) {
            console.error('Error running overdue scan:', error);
            if (manual) await Swal.fire('Error', 'Failed to run overdue scan: ' + error.message, 'error');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.overdueAutomation = new OverdueAutomation();
    // One quiet automatic pass per page load, in addition to the manual button.
    setTimeout(() => window.overdueAutomation.scanForOverdue(false), 3000);
});