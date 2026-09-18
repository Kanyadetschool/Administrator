// Staff / Teacher Book Issuance
// -------------------------------------------------------------------------
// The existing Issuance flow (app.js's IssuanceManager) only knows how to
// issue to a STUDENT — the student picker is StudentsCache-driven, and
// there was no way to hand a book to a teacher. This adds that as a
// separate, additive flow rather than reworking the existing form.
//
// Uses a real Bootstrap modal + form (#issueToStaffModal), matching the
// convention every other form on this page already follows (Add Fine,
// Record Payment, Fine Settings) — no SweetAlert2 here, by request.
// Feedback uses the shared window.showAppToast() helper (a plain
// Bootstrap Toast) instead of Swal.fire.
//
// Teacher records come from the SAME place the Advanced Admin Portal
// (index.html) reads them from — the Firestore `users` collection
// (`getDocs(collection(fst, 'users'))` there), NOT the Realtime Database.
// That collection is the staff *account* roster (used for login/role
// gating), keyed by Firebase Auth uid, with fields like displayName/name,
// email, subject, disabled. This file reads it the same way, via the
// compat SDK this page already loads (firebase.firestore()).
//
// Writes to the SAME `issuance` node the student flow uses, so Quick
// Return, the Issuance list, and book-availability recalculation all work
// against staff loans with no changes to app.js. Two deliberate schema
// choices:
//   - NO `studentId` field is set. app.js's returnBook() does
//     `if (issuance.studentId) studentManager.updateStudentIssuanceStatus(...)`,
//     which writes activeIssuances onto students/{id} — pointed at a
//     teacher's Firestore uid, that would create a bogus phantom "student"
//     record. Leaving studentId unset skips that branch entirely.
//   - `grade` is set to the literal string "Staff". Every other view that
//     groups issuance rows by grade (Class Library, the Dashboard's Due
//     This Week / Class Library Health widgets) does so generically with
//     no student-only assumption, so staff loans automatically land in
//     their own clearly-labeled "Staff" bucket — no changes needed there.
//
// Known limitation: there is currently no notification channel to staff —
// the `messages` node is only ever read by student-portal.js. The Due
// This Week widget's "Remind" button is hidden for Staff rows for exactly
// this reason (see dashboard-widgets.js). Returns, availability, and the
// Issuance list all work fully for staff loans; messaging does not yet.
class StaffIssuanceManager {
    constructor() {
        this.db = db;
        this.teachers = [];
        this.modalEl = document.getElementById('issueToStaffModal');
        this.modal = this.modalEl ? new bootstrap.Modal(this.modalEl) : null;
        this.setupUI();
    }

    setupUI() {
        document.getElementById('issueToStaffBtn')?.addEventListener('click', () => this.openModal());
        document.getElementById('submitStaffIssuanceBtn')?.addEventListener('click', () => this.handleSubmit());
        this.modalEl?.addEventListener('hidden.bs.modal', () => this._resetForm());
    }

    _teacherName(t) {
        return t.displayName || t.name || [t.firstName, t.lastName].filter(Boolean).join(' ') || 'Unnamed';
    }

    _showAlert(message) {
        const alertEl = document.getElementById('staffIssuanceAlert');
        if (!alertEl) return;
        alertEl.textContent = message;
        alertEl.classList.remove('d-none');
    }

    _clearAlert() {
        document.getElementById('staffIssuanceAlert')?.classList.add('d-none');
    }

    _resetForm() {
        document.getElementById('issueToStaffForm')?.reset();
        this._clearAlert();
    }

    _setLoading(isLoading) {
        const btn = document.getElementById('submitStaffIssuanceBtn');
        const spinner = document.getElementById('siSpinner');
        if (btn) btn.disabled = isLoading;
        if (spinner) spinner.classList.toggle('d-none', !isLoading);
    }

    async loadTeachers() {
        const snap = await firebase.firestore().collection('users').get();
        const list = [];
        snap.forEach(doc => {
            const u = doc.data() || {};
            if (u.disabled === true) return; // don't offer disabled accounts
            list.push({ uid: doc.id, ...u });
        });
        list.sort((a, b) => this._teacherName(a).localeCompare(this._teacherName(b)));
        this.teachers = list;
        return list;
    }

    async openModal() {
        if (!this.modal) {
            console.error('Staff issuance: #issueToStaffModal not found in the page.');
            return;
        }

        const bookSelect = document.getElementById('siBook');
        const teacherSelect = document.getElementById('siTeacher');
        bookSelect.innerHTML = '<option value="">Loading books…</option>';
        teacherSelect.innerHTML = '<option value="">Loading staff…</option>';
        this.modal.show();

        try {
            const [teachers, booksSnap] = await Promise.all([
                this.loadTeachers(),
                this.db.ref('books').once('value')
            ]);

            let bookOptions = '<option value="">Select book</option>';
            booksSnap.forEach(child => {
                const b = child.val();
                const available = Number(b.available) || 0;
                if (available > 0) {
                    bookOptions += `<option value="${child.key}">${b.title} (${available}/${b.quantity} available)</option>`;
                }
            });
            bookSelect.innerHTML = bookOptions;

            teacherSelect.innerHTML = '<option value="">Select staff member</option>' +
                teachers.map(t => `<option value="${t.uid}">${this._teacherName(t)}${t.subject ? ' · ' + t.subject : ''}</option>`).join('');

            if (bookOptions === '<option value="">Select book</option>') {
                this._showAlert('Every copy is currently checked out — nothing available to issue.');
            }
            if (teachers.length === 0) {
                this._showAlert('No active staff accounts were found in the roster.');
            }

            const today = new Date().toISOString().slice(0, 10);
            const defaultReturn = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
            document.getElementById('siIssueDate').value = today;
            document.getElementById('siReturnDate').value = defaultReturn;
        } catch (error) {
            console.error('Error loading staff issuance form data:', error);
            this._showAlert('Could not load books/staff. Is the staff roster reachable?');
        }
    }

    async handleSubmit() {
        this._clearAlert();

        const bookId = document.getElementById('siBook').value;
        const teacherId = document.getElementById('siTeacher').value;
        const bookNo = document.getElementById('siBookNo').value.trim();
        const issueDate = document.getElementById('siIssueDate').value;
        const returnDate = document.getElementById('siReturnDate').value;

        if (!bookId || !teacherId || !bookNo || !issueDate || !returnDate) {
            this._showAlert('Please fill in every field, including Book Number.');
            return;
        }

        this._setLoading(true);
        try {
            await this.issueToStaff({ bookId, teacherId, bookNo, issueDate, returnDate });
            this.modal.hide();
            window.showAppToast('success', 'Book issued to staff successfully.');
        } catch (error) {
            console.error('Error issuing book to staff:', error);
            this._showAlert(error.message || 'Could not issue this book.');
        } finally {
            this._setLoading(false);
        }
    }

    async issueToStaff({ bookId, teacherId, bookNo, issueDate, returnDate }) {
        const teacher = this.teachers.find(t => t.uid === teacherId);
        const bookSnap = await this.db.ref(`books/${bookId}`).once('value');
        const book = bookSnap.val();

        if (!teacher || !book) throw new Error('Invalid staff member or book selection.');
        if ((Number(book.available) || 0) <= 0) throw new Error('Book is not available for issuance.');

        const teacherName = this._teacherName(teacher);
        const issuanceData = {
            // Deliberately no studentId — see file header note.
            staffId: teacherId,
            staffEmail: teacher.email || '',
            borrowerType: 'staff',
            studentName: teacherName,   // shared field name so existing
            grade: 'Staff',             // display/reporting code needs no changes
            bookId,
            bookTitle: book.title,
            bookNo,
            isbn: bookNo || book.isbn || '',
            issueDate,
            returnDate,
            status: 'active',
            timestamp: Date.now()
        };

        const newIssuanceRef = this.db.ref('issuance').push();
        await Promise.all([
            newIssuanceRef.set(issuanceData),
            this.db.ref('activities').push({
                type: 'issue',
                bookId,
                borrowerType: 'staff',
                staffId: teacherId,
                issuanceId: newIssuanceRef.key,
                description: `Issued "${book.title}" (${bookNo}) to ${teacherName} (Staff)`,
                timestamp: Date.now()
            })
        ]);

        if (window.recalculateBookAvailability) {
            await window.recalculateBookAvailability(bookId);
        }

        // Reuse the existing Issuance list refresh if that page has already
        // been opened/loaded this session.
        if (window.issuanceManager && typeof window.issuanceManager.loadIssuances === 'function') {
            window.issuanceManager.loadIssuances();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.staffIssuanceManager = new StaffIssuanceManager();
});

// ---------------------------------------------------------------------
// Fix: staff issuance rows were invisible on the Issuance page.
//
// app.js's IssuanceManager.applyFilters() resolves each row's "student"
// via `StudentsCache.get(issuance.studentId)`, then hands it to
// renderIssuanceCard(), whose very first line is `if (!student || !book)
// return;`. Since a staff issuance deliberately has no studentId (see the
// note at the top of this file), that lookup always returns undefined —
// so the card silently never renders, even though the record and the
// book's availability count are both correct in the database. The same
// blind spot would also hide any issuance whose student was later
// deleted, independent of this feature.
//
// Rather than edit app.js directly, this monkey-patches
// IssuanceManager.prototype.applyFilters with a corrected copy that
// falls back to a synthesized "virtual student" — built from the
// issuance's own denormalized studentName/grade — whenever the real
// StudentsCache lookup comes back empty. This mirrors how reservations.js
// already patches issuanceManager.returnBook for the same reason: adding
// behavior without touching the two core files.
document.addEventListener('DOMContentLoaded', () => {
    if (typeof IssuanceManager === 'undefined' || !IssuanceManager.prototype.applyFilters) {
        console.warn('Staff issuance: IssuanceManager.applyFilters not found — staff rows may not display on the Issuance page.');
        return;
    }

    IssuanceManager.prototype.applyFilters = function () {
        const status = this.statusFilter.value;
        const grade = this.classFilter ? this.classFilter.value : '';
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        const currentDate = new Date();

        this.issuanceList.innerHTML = '';

        for (const [issuanceId, issuance] of this.allIssuances) {
            let showIssuance = true;

            let student = StudentsCache.get(issuance.studentId);
            if (!student && issuance.studentName) {
                // Staff loan, or an issuance whose student record no longer
                // exists — fall back to what the issuance itself recorded
                // at the time, instead of dropping the row entirely.
                student = {
                    name: issuance.studentName,
                    grade: issuance.grade || 'Unknown',
                    assessmentNo: issuance.staffId ? 'STAFF' : (issuance.ULI || ''),
                    Gender: null
                };
            }
            const book = window.bookManager ? window.bookManager.allBooks.get(issuance.bookId) : undefined;

            if (status) {
                const returnDate = new Date(issuance.returnDate);
                const isOverdue = returnDate < currentDate && issuance.status === 'active';

                switch (status) {
                    case 'active':
                        showIssuance = issuance.status === 'active' && !isOverdue;
                        break;
                    case 'returned':
                        showIssuance = issuance.status === 'returned';
                        break;
                    case 'overdue':
                        showIssuance = isOverdue;
                        break;
                    case 'lost':
                        showIssuance = issuance.status === 'lost';
                        break;
                }
            }

            if (grade && showIssuance) {
                showIssuance = student?.grade === grade;
            }

            if (searchTerm && showIssuance) {
                const searchableText = `${student?.name || ''} ${student?.assessmentNo || ''} ${book?.title || ''}`.toLowerCase();
                if (!searchableText.includes(searchTerm)) {
                    showIssuance = false;
                }
            }

            if (showIssuance) {
                this.renderIssuanceCard(issuance, issuanceId, student, book);
            }
        }
    };

    // Re-run once immediately so already-loaded issuance data reflects the
    // fix without needing a manual refresh/filter change.
    if (window.issuanceManager) window.issuanceManager.applyFilters();
});