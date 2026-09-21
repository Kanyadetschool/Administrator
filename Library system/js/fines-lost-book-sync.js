// Fines ↔ Lost-Book / Replacement-Cost Sync
// -------------------------------------------------------------------------
// fines-management.js and replacement-cost-summary.js currently know
// nothing about each other:
//
//   - Reporting a book lost — via EITHER functions.js's reportBookLost
//     (Books list → "Report Lost") OR app.js's LostBooksManager
//     .showAddLostBookModal ("Add Lost Book" in the Lost Books modal) —
//     only ever writes to issuance/books. Neither path ever creates a
//     fine, so fineSettings.lostBookFine (editable in the Fine Settings
//     modal) is a dead setting that nothing applies.
//   - Recovering a lost book (handleBookRecovery — there are TWO separate
//     copies of this method in app.js, on two different manager classes)
//     never touches whatever fine might exist for it either, so a
//     recovered/replaced book leaves its fine (if one existed) sitting
//     there forever as if the book were still missing.
//   - replacement-cost-summary.js separately shows a running total of
//     replacement cost across unrecovered lost books, but that total
//     lives only in the Lost Books modal — it was never actually turned
//     into a fine the student/parent could be billed and tracked against
//     through the same Fines UI as overdue fines.
//
// Rather than patch three-plus separate UI code paths, this listens on
// `issuance` itself — the one thing every one of those paths writes to —
// the same way overdue-automation.js already does. That means it works
// no matter which button created or changed the record, and needs no
// changes to app.js / functions.js / fines-management.js.
//
// New additive field only (nothing existing is touched):
//   issuance/{id}.fineId — the fines/{id} this loss's fine lives at, so a
//   book is never double-billed if child_added and child_changed both
//   fire for the same write, and so recovery can find the right fine.
//
// Fine amount: prefers the book's own books/{id}.replacementCost (the
// per-title figure set via the "Replacement Cost" field on the book form
// — see book-condition.js / replacement-cost-summary.js) since it's
// specific to that title. Falls back to the flat fineSettings.lostBookFine
// only when a book has never had a replacement cost recorded.
class FinesLostBookSync {
    constructor() {
        this.db = firebase.database();
        this.issuanceRef = this.db.ref('issuance');
        // issuanceIds currently being processed — guards against
        // child_added and child_changed both landing on the same write
        // and racing each other into creating two fines for one loss.
        this._syncing = new Set();
        this.init();
    }

    init() {
        this.issuanceRef.on('child_added', (snap) => this.handleIssuanceChange(snap.key, snap.val()));
        this.issuanceRef.on('child_changed', (snap) => this.handleIssuanceChange(snap.key, snap.val()));
    }

    async handleIssuanceChange(issuanceId, issuance) {
        if (!issuance || this._syncing.has(issuanceId)) return;
        try {
            if (issuance.status === 'lost' && !issuance.recoveryStatus && !issuance.fineId) {
                this._syncing.add(issuanceId);
                await this.createLostBookFine(issuanceId, issuance);
            } else if (issuance.recoveryStatus && issuance.fineId) {
                this._syncing.add(issuanceId);
                await this.resolveLostBookFine(issuanceId, issuance);
            }
        } catch (error) {
            console.error('FinesLostBookSync: failed to sync issuance', issuanceId, error);
        } finally {
            this._syncing.delete(issuanceId);
        }
    }

    async getFineSettings() {
        try {
            const snap = await this.db.ref('fineSettings').once('value');
            return snap.exists() ? snap.val() : {};
        } catch (e) {
            return {};
        }
    }

    async createLostBookFine(issuanceId, issuance) {
        // Re-check right before writing — closes the race window between
        // the guard above and this actually landing, the same
        // check-then-act pattern fines-management.js's own
        // calculateOverdueFines() already uses for its dedupe check.
        const freshFineId = await this.db.ref(`issuance/${issuanceId}/fineId`).once('value');
        if (freshFineId.exists()) return;

        const [bookSnap, settings] = await Promise.all([
            this.db.ref(`books/${issuance.bookId}`).once('value'),
            this.getFineSettings()
        ]);
        const book = bookSnap.exists() ? bookSnap.val() : {};
        const hasReplacementCost = Number(book.replacementCost) > 0;
        const amount = hasReplacementCost
            ? Number(book.replacementCost)
            : (Number(settings.lostBookFine) || 300);

        const student = (typeof StudentsCache !== 'undefined') ? StudentsCache.get(issuance.studentId) : null;
        const bookTitle = issuance.bookTitle || book.title || 'Unknown title';

        const fineRef = this.db.ref('fines').push();
        await fineRef.set({
            studentId: issuance.studentId || '',
            studentName: issuance.studentName || student?.name || 'Unknown',
            studentGrade: issuance.grade || student?.grade || '',
            studentAssessmentNo: student?.assessmentNo || '',
            issuanceId,
            bookId: issuance.bookId || '',
            amount,
            amountPaid: 0,
            amountOutstanding: amount,
            reason: 'lost',
            description: hasReplacementCost
                ? `Replacement cost for lost book "${bookTitle}"`
                : `Replacement cost for lost book "${bookTitle}" (no replacement cost set on the book — used the default lost-book fine instead)`,
            status: 'pending',
            dueDate: null,
            autoCalculated: true,
            createdBy: firebase.auth().currentUser?.uid || 'system',
            createdByName: firebase.auth().currentUser?.displayName || 'System (lost-book sync)',
            createdAt: Date.now(),
            updatedAt: Date.now()
        });

        // Stamped after the fine exists so a crash/reload between the two
        // writes just re-runs createLostBookFine (harmless — the fresh
        // check above catches it) rather than silently losing the fine.
        await this.db.ref(`issuance/${issuanceId}/fineId`).set(fineRef.key);
    }

    async resolveLostBookFine(issuanceId, issuance) {
        const fineSnap = await this.db.ref(`fines/${issuance.fineId}`).once('value');
        if (!fineSnap.exists()) return;
        const fine = fineSnap.val();
        // Already paid/waived (e.g. an admin resolved it by hand before
        // recovery got recorded) — leave it exactly as an admin left it.
        if (fine.status !== 'pending' && fine.status !== 'partial') return;

        if (issuance.recoveryMethod === 'found') {
            // The book itself turned up — no replacement cost was ever
            // actually incurred.
            await this.db.ref(`fines/${issuance.fineId}`).update({
                status: 'waived',
                amountOutstanding: 0,
                waiveReason: 'Book recovered (found) — no replacement was needed',
                waiveAuthorizedBy: 'System (lost-book sync)',
                waiveDate: Date.now(),
                updatedAt: Date.now()
            });
        } else {
            // 'replaced', or any other recovery method — a replacement
            // copy (or its cost) was supplied, which is exactly what this
            // fine exists to cover. Record it the same way
            // fines-management.js's own confirmPayment() records a manual
            // payment, so it shows up identically in payment history.
            const amount = Number(fine.amount) || 0;
            const paymentId = this.db.ref(`fines/${issuance.fineId}/payments`).push().key;
            await this.db.ref(`fines/${issuance.fineId}`).update({
                amountPaid: amount,
                amountOutstanding: 0,
                status: 'paid',
                updatedAt: Date.now(),
                [`payments/${paymentId}`]: {
                    amount,
                    method: issuance.recoveryMethod === 'replaced' ? 'Book replaced' : (issuance.recoveryMethod || 'Recovered'),
                    reference: issuanceId,
                    notes: issuance.recoveryNotes || '',
                    processedBy: firebase.auth().currentUser?.uid || 'system',
                    processedByName: firebase.auth().currentUser?.displayName || 'System (lost-book sync)',
                    processedAt: Date.now()
                }
            });
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.finesLostBookSync = new FinesLostBookSync();
});
