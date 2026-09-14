// Book Reservations / Hold Queue
// -------------------------------------------------------------------------
// Adds a hold-queue on top of the existing books/issuance schema without
// changing either: reservations/{bookId}/{pushId} = { studentId,
// studentName, grade, requestedAt, status }. Firebase push keys sort
// chronologically, so the queue order for a book is just that node's
// natural child order.
//
// This ships both halves: a "Reservations" tab here for the librarian to
// see/manage the queue and add a walk-in request, and (in student-portal.js)
// a "Reserve" button on out-of-stock books in the Browse view that writes
// to the same reservations/{bookId} node — kept in sync via a
// reservationsByStudent/{studentId}/{bookId} index both sides maintain.
//
// Hooks in via monkey-patching issuanceManager.returnBook and both
// handleBookRecovery methods (IssuanceManager's and LostBooksManager's)
// rather than editing app.js directly, since those are the two places a
// book's `available` count goes up.
class ReservationManager {
    constructor() {
        this.db = db;
        this.setupUI();
        this.setupHooks();
    }

    setupUI() {
        const addBtn = document.getElementById('addReservationBtn');
        if (addBtn) addBtn.addEventListener('click', () => this.showAddReservationDialog());

        // Render whenever the Reservations tab is opened.
        document.querySelectorAll('.nav-links li[data-page="reservations"]').forEach(li => {
            li.addEventListener('click', () => this.render());
        });
    }

    setupHooks() {
        const tryHook = () => {
            if (window.issuanceManager && !window.issuanceManager._reservationHooked) {
                const originalReturn = window.issuanceManager.returnBook.bind(window.issuanceManager);
                window.issuanceManager.returnBook = async (issuanceId, bookId) => {
                    const before = await this._getAvailable(bookId);
                    await originalReturn(issuanceId, bookId);
                    const after = await this._getAvailable(bookId);
                    if (after > before) await this.notifyNextInQueue(bookId);
                };
                window.issuanceManager._reservationHooked = true;
            }
            if (window.lostBooksManager && !window.lostBooksManager._reservationHooked) {
                const originalRecover = window.lostBooksManager.handleBookRecovery.bind(window.lostBooksManager);
                window.lostBooksManager.handleBookRecovery = async (issuanceId, recoveryMethod, notes) => {
                    const issuanceSnap = await this.db.ref(`issuance/${issuanceId}`).once('value');
                    const bookId = issuanceSnap.val()?.bookId;
                    const before = bookId ? await this._getAvailable(bookId) : null;
                    await originalRecover(issuanceId, recoveryMethod, notes);
                    if (bookId) {
                        const after = await this._getAvailable(bookId);
                        if (after > before) await this.notifyNextInQueue(bookId);
                    }
                };
                window.lostBooksManager._reservationHooked = true;
            }
            if (!window.issuanceManager || !window.lostBooksManager) {
                setTimeout(tryHook, 500);
            }
        };
        tryHook();
    }

    async _getAvailable(bookId) {
        const snap = await this.db.ref(`books/${bookId}/available`).once('value');
        return snap.val() || 0;
    }

    async reserveBookForStudent(bookId, studentId) {
        const student = (window.StudentsCache && StudentsCache.get(studentId)) ||
            (await this.db.ref(`students/${studentId}`).once('value')).val();
        if (!student) throw new Error('Student not found');

        // Don't let the same student double-queue for the same book.
        const existing = await this.db.ref(`reservations/${bookId}`).once('value');
        let alreadyQueued = false;
        existing.forEach(child => {
            if (child.val().studentId === studentId) alreadyQueued = true;
        });
        if (alreadyQueued) throw new Error(`${student.name} is already in the queue for this book`);

        // Mirrors the reservationsByStudent/{studentId}/{bookId} index that
        // student-portal.js's Browse view keeps in step, so a walk-in
        // request added here also shows as "already queued" if that
        // student later opens the Browse tab themselves.
        const newRef = this.db.ref(`reservations/${bookId}`).push();
        await newRef.set({
            studentId,
            studentName: student.name,
            grade: student.grade || '',
            requestedAt: Date.now(),
            status: 'waiting'
        });
        await this.db.ref(`reservationsByStudent/${studentId}/${bookId}`).set(newRef.key);
    }

    async notifyNextInQueue(bookId) {
        try {
            const snapshot = await this.db.ref(`reservations/${bookId}`).once('value');
            if (!snapshot.exists()) return;

            let firstKey = null;
            let firstVal = null;
            snapshot.forEach(child => {
                if (firstKey === null) {
                    firstKey = child.key;
                    firstVal = child.val();
                }
                return true; // stop after first child (push keys are chronological)
            });
            if (!firstKey) return;

            const bookSnap = await this.db.ref(`books/${bookId}`).once('value');
            const book = bookSnap.val() || {};
            const text = `Good news — "${book.title || 'the book you reserved'}" is available now. Visit the library to collect it. Reservations are held for a limited time.`;

            // Shape confirmed against three consumers — see overdue-automation.js
            // for the full breakdown (student-portal.js, functions.js,
            // message.js all read slightly different fields/priority).
            await this.db.ref('messages').push({
                studentId: firstVal.studentId,
                studentName: firstVal.studentName || '',
                studentGrade: firstVal.grade || '',
                bookId,
                bookTitle: book.title || '',
                type: 'info',
                subject: `Reserved book ready: ${book.title || 'Book'}`,
                description: text,
                message: text,
                status: 'resolved',
                sender: 'librarian',
                timestamp: Date.now(),
                readByStudent: false,
                readByLibrarian: true,
                read: true
            });

            await this.db.ref(`reservations/${bookId}/${firstKey}`).remove();
            await this.db.ref(`reservationsByStudent/${firstVal.studentId}/${bookId}`).remove();

            await this.db.ref('activities').push({
                type: 'reservation_ready',
                bookId,
                studentId: firstVal.studentId,
                description: `Notified ${firstVal.studentName} that "${book.title || 'book'}" is ready for pickup`,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error notifying next in reservation queue:', error);
        }
    }

    async showAddReservationDialog() {
        const grades = Array.from({ length: 9 }, (_, i) => `Grade ${i + 1}`);
        const booksSnap = await this.db.ref('books').once('value');
        let bookOptions = '<option value="">Select book</option>';
        booksSnap.forEach(child => {
            const b = child.val();
            bookOptions += `<option value="${child.key}">${b.title} (${b.available}/${b.quantity} available)</option>`;
        });

        const { value: formValues } = await Swal.fire({
            title: 'Add Reservation',
            html: `
                <select id="resBook" class="swal2-select" style="display:block;width:100%;margin-bottom:8px;">${bookOptions}</select>
                <select id="resGrade" class="swal2-select" style="display:block;width:100%;margin-bottom:8px;">
                    <option value="">Select grade</option>
                    ${grades.map(g => `<option value="${g}">${g}</option>`).join('')}
                </select>
                <select id="resStudent" class="swal2-select" style="display:block;width:100%;" disabled>
                    <option value="">Select grade first</option>
                </select>
            `,
            didOpen: () => {
                document.getElementById('resGrade').addEventListener('change', (e) => {
                    const studentSelect = document.getElementById('resStudent');
                    const grade = e.target.value;

                    // Drop any listener from a previously-selected grade.
                    if (this._resStudentUnsub) { this._resStudentUnsub(); this._resStudentUnsub = null; }

                    studentSelect.innerHTML = '<option value="">Select student</option>';
                    if (!grade || !window.StudentsCache) return;

                    const renderForGrade = () => {
                        studentSelect.innerHTML = '<option value="">Select student</option>';
                        StudentsCache.getAll().forEach((student, id) => {
                            if (student.grade === grade) {
                                studentSelect.innerHTML += `<option value="${id}">${student.name}</option>`;
                            }
                        });
                        studentSelect.disabled = false;
                    };

                    // Paint immediately with whatever's cached right now, but
                    // also subscribe: if this is the first time anything has
                    // touched StudentsCache this page load, getAll() above
                    // returns an empty Map (the cache's IndexedDB/Firebase
                    // warm-up hasn't finished yet) — onChange() re-renders
                    // once the real data actually lands.
                    renderForGrade();
                    this._resStudentUnsub = StudentsCache.onChange(renderForGrade);
                });
            },
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Add to queue',
            didClose: () => {
                if (this._resStudentUnsub) { this._resStudentUnsub(); this._resStudentUnsub = null; }
            },
            preConfirm: () => {
                const bookId = document.getElementById('resBook').value;
                const studentId = document.getElementById('resStudent').value;
                if (!bookId || !studentId) {
                    Swal.showValidationMessage('Please select both a book and a student');
                    return false;
                }
                return { bookId, studentId };
            }
        });

        if (!formValues) return;

        try {
            await this.reserveBookForStudent(formValues.bookId, formValues.studentId);
            await Swal.fire('Added', 'Student added to the reservation queue.', 'success');
            this.render();
        } catch (error) {
            await Swal.fire('Error', error.message, 'error');
        }
    }

    async cancelReservation(bookId, reservationId) {
        const confirm = await Swal.fire({
            title: 'Cancel reservation?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Yes, cancel it'
        });
        if (!confirm.isConfirmed) return;
        const entrySnap = await this.db.ref(`reservations/${bookId}/${reservationId}`).once('value');
        const studentId = entrySnap.val()?.studentId;
        await this.db.ref(`reservations/${bookId}/${reservationId}`).remove();
        if (studentId) await this.db.ref(`reservationsByStudent/${studentId}/${bookId}`).remove();
        this.render();
    }

    async render() {
        const container = document.getElementById('reservationsList');
        if (!container) return;
        container.innerHTML = '<p class="text-muted">Loading reservations…</p>';

        const snapshot = await this.db.ref('reservations').once('value');
        if (!snapshot.exists()) {
            container.innerHTML = '<p class="text-muted">No active reservations.</p>';
            return;
        }

        const bookIds = [];
        snapshot.forEach(child => bookIds.push(child.key));
        const bookTitles = {};
        await Promise.all(bookIds.map(async id => {
            const b = (await this.db.ref(`books/${id}`).once('value')).val();
            bookTitles[id] = b?.title || id;
        }));

        let html = '';
        snapshot.forEach(bookChild => {
            const bookId = bookChild.key;
            const entries = [];
            bookChild.forEach(entryChild => {
                entries.push({ id: entryChild.key, ...entryChild.val() });
            });
            if (entries.length === 0) return;
            entries.sort((a, b) => a.requestedAt - b.requestedAt);

            html += `
                <div class="card mb-3">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <strong>${bookTitles[bookId]}</strong>
                        <span class="badge bg-secondary">${entries.length} waiting</span>
                    </div>
                    <ul class="list-group list-group-flush">
                        ${entries.map((e, i) => `
                            <li class="list-group-item d-flex justify-content-between align-items-center">
                                <span>${i + 1}. ${e.studentName} (${e.grade || 'N/A'}) — requested ${new Date(e.requestedAt).toLocaleDateString()}</span>
                                <button class="btn btn-sm btn-outline-danger" onclick="reservationManager.cancelReservation('${bookId}', '${e.id}')">
                                    <i class="bi bi-x-lg"></i>
                                </button>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        });

        container.innerHTML = html || '<p class="text-muted">No active reservations.</p>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.reservationManager = new ReservationManager();
});