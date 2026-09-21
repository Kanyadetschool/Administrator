// Copy Inventory
// -------------------------------------------------------------------------
// Adds per-physical-copy tracking on top of the existing title-level model
// (books/{id}.quantity/.available/.lost, issuance.bookNo as freeform text).
// Nothing in app.js/functions.js/class-kit-issuance.js is touched: this is
// a pure additive layer, opt-in per title.
//
// Data model (new node, does not replace anything):
//   books/{bookId}/copies/{copyId}: {
//     copyNo: string,            // e.g. "9780198390212-03" — what goes in
//                                // issuance.bookNo once this copy is issued
//     condition: 'good'|'fair'|'damaged',
//     replacementCost: number|null,  // null = inherit book.replacementCost
//     status: 'available'|'issued'|'lost'|'retired',
//     addedAt: number
//   }
//
// Sync strategy: rather than editing every place an issuance gets created
// (single issuance in app.js, bulk issuance in class-kit-issuance.js, the
// two separate "report lost" flows), this listens to the one place they
// all converge — the `issuance` node itself — and matches records to
// copies by bookId + bookNo. A title with no copies generated yet is
// completely unaffected (matches nothing, no-ops).
//
// It also freezes the copy's replacementCost onto the issuance record
// (issuance.copyReplacementCost) the moment a copy goes 'lost', so the
// Lost Books cost summary reflects that copy's actual cost even if the
// book's default replacementCost changes later. replacement-cost-summary.js
// reads that field when present.
(function () {
    const db = () => window.db || firebase.database();

    function currency(n) {
        return 'KES ' + Number(n || 0).toLocaleString();
    }

    // ---- Reactive sync: issuance status changes -> copy status ----------

    function statusForIssuance(issuance) {
        if (issuance.status === 'active' || issuance.status === 'overdue') return 'issued';
        if (issuance.status === 'returned') return 'available';
        if (issuance.status === 'lost') return 'lost';
        return null;
    }

    async function syncCopyForIssuance(issuance) {
        if (!issuance || !issuance.bookId || !issuance.bookNo) return;
        const targetStatus = statusForIssuance(issuance);
        if (!targetStatus) return;

        try {
            const copiesSnap = await db().ref(`books/${issuance.bookId}/copies`).once('value');
            if (!copiesSnap.exists()) return; // title has no copies defined — no-op

            let matchId = null, matchCopy = null;
            copiesSnap.forEach((child) => {
                if (child.val().copyNo === issuance.bookNo) {
                    matchId = child.key;
                    matchCopy = child.val();
                }
            });
            if (!matchId) return;

            const updates = {};
            if (matchCopy.status !== targetStatus) {
                updates[`books/${issuance.bookId}/copies/${matchId}/status`] = targetStatus;
            }
            if (targetStatus === 'lost') {
                const frozenCost = matchCopy.replacementCost != null ? matchCopy.replacementCost : null;
                if (frozenCost != null && issuance.copyReplacementCost !== frozenCost) {
                    // Write back onto the issuance record so cost reporting
                    // survives later edits to the copy/book's default cost.
                    await db().ref(`issuance`).child(issuance._id).update({ copyReplacementCost: frozenCost });
                }
                if (issuance.condition && matchCopy.condition !== issuance.condition) {
                    updates[`books/${issuance.bookId}/copies/${matchId}/condition`] = issuance.condition;
                }
            }
            if (Object.keys(updates).length > 0) {
                await db().ref().update(updates);
            }
        } catch (error) {
            console.error('Copy inventory sync error:', error);
        }
    }

    function attachIssuanceListener() {
        const ref = db().ref('issuance');
        const handler = (snap) => syncCopyForIssuance({ ...snap.val(), _id: snap.key });
        ref.on('child_added', handler);
        ref.on('child_changed', handler);
    }

    // ---- "Copies" button on each book card -------------------------------

    function hookBookCardButton() {
        if (typeof BookManager === 'undefined' || BookManager.prototype._copyInventoryHooked) return;
        const original = BookManager.prototype.renderBookCard;
        BookManager.prototype.renderBookCard = function (book, bookId) {
            original.call(this, book, bookId);
            const cards = this.booksList.querySelectorAll('.book-card');
            const card = cards[cards.length - 1];
            const actions = card && card.querySelector('.card-actions');
            if (actions && !actions.querySelector('.btn-copies')) {
                const btn = document.createElement('button');
                btn.className = 'btn-ghost btn-copies';
                btn.textContent = 'Copies';
                btn.onclick = () => window.copyInventory.showCopiesModal(bookId, book);
                actions.insertBefore(btn, actions.lastElementChild.nextSibling);
            }
        };
        BookManager.prototype._copyInventoryHooked = true;
    }

    // ---- Manage Copies modal ---------------------------------------------

    function ensureModalShell() {
        if (document.getElementById('copyInventoryModal')) return;
        const div = document.createElement('div');
        div.innerHTML = `
            <div class="modal fade" id="copyInventoryModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="copyInventoryModalTitle">Copies</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body" id="copyInventoryModalBody"></div>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(div.firstElementChild);
    }

    async function showCopiesModal(bookId, book) {
        ensureModalShell();
        document.getElementById('copyInventoryModalTitle').textContent = `Copies — ${book.title}`;
        const body = document.getElementById('copyInventoryModalBody');
        body.innerHTML = '<p class="text-muted">Loading...</p>';
        const modal = new bootstrap.Modal(document.getElementById('copyInventoryModal'));
        modal.show();

        const snap = await db().ref(`books/${bookId}/copies`).once('value');

        if (!snap.exists()) {
            body.innerHTML = `
                <p>No individual copies tracked yet for this title (quantity: ${Number(book.quantity) || 0}).</p>
                <button class="btn btn-primary" id="generateCopiesBtn">Generate ${Number(book.quantity) || 0} copies</button>
                <small class="d-block text-muted mt-2">Each copy inherits this book's replacement cost by default; edit any copy individually afterward.</small>`;
            document.getElementById('generateCopiesBtn').onclick = () => generateCopies(bookId, book, body);
            return;
        }

        renderCopiesTable(bookId, book, snap, body);
    }

    async function generateCopies(bookId, book, body) {
        const qty = Number(book.quantity) || 0;
        if (qty <= 0) return;

        // Best-effort split: we can't know which physical copy an existing
        // freeform bookNo referred to, so just seed enough 'issued' copies
        // to match the current active-loan count, rest 'available'.
        const activeSnap = await db().ref('issuance').orderByChild('bookId').equalTo(bookId).once('value');
        let activeCount = 0;
        activeSnap.forEach((c) => { if (c.val().status === 'active' || c.val().status === 'overdue') activeCount++; });

        const base = (book.isbn || bookId).toString();
        const updates = {};
        for (let i = 1; i <= qty; i++) {
            const copyId = db().ref(`books/${bookId}/copies`).push().key;
            updates[`books/${bookId}/copies/${copyId}`] = {
                copyNo: `${base}-${String(i).padStart(2, '0')}`,
                condition: 'good',
                replacementCost: null,
                status: i <= activeCount ? 'issued' : 'available',
                addedAt: Date.now()
            };
        }
        await db().ref().update(updates);
        const snap = await db().ref(`books/${bookId}/copies`).once('value');
        renderCopiesTable(bookId, book, snap, body);
    }

    function renderCopiesTable(bookId, book, snap, body) {
        const rows = [];
        snap.forEach((child) => rows.push({ id: child.key, ...child.val() }));
        rows.sort((a, b) => (a.copyNo || '').localeCompare(b.copyNo || ''));

        const badge = (status) => ({
            available: 'bg-success',
            issued: 'bg-primary',
            lost: 'bg-danger',
            retired: 'bg-secondary'
        }[status] || 'bg-secondary');

        body.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-2">
                <small class="text-muted">Default replacement cost: ${currency(book.replacementCost)}. Leave a copy's cost blank to inherit it.</small>
                <button class="btn btn-sm btn-outline-primary" id="addCopyBtn"><i class="bi bi-plus"></i> Add copy</button>
            </div>
            <div class="table-responsive">
                <table class="table table-sm align-middle">
                    <thead><tr><th>Copy No.</th><th>Condition</th><th>Cost override</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr data-copy-id="${r.id}">
                                <td><input type="text" class="form-control form-control-sm copy-no" value="${r.copyNo || ''}"></td>
                                <td>
                                    <select class="form-select form-select-sm copy-condition">
                                        ${['good', 'fair', 'damaged'].map(c => `<option value="${c}" ${r.condition === c ? 'selected' : ''}>${c}</option>`).join('')}
                                    </select>
                                </td>
                                <td><input type="number" min="0" step="1" class="form-control form-control-sm copy-cost" placeholder="inherit" value="${r.replacementCost != null ? r.replacementCost : ''}"></td>
                                <td><span class="badge ${badge(r.status)} copy-status-badge">${r.status}</span></td>
                                <td class="text-nowrap">
                                    <button class="btn btn-sm btn-outline-secondary save-copy-btn" title="Save"><i class="bi bi-check2"></i></button>
                                    <button class="btn btn-sm btn-outline-danger retire-copy-btn" title="Retire"><i class="bi bi-x-lg"></i></button>
                                </td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;

        body.querySelectorAll('tr[data-copy-id]').forEach((tr) => {
            const copyId = tr.getAttribute('data-copy-id');
            tr.querySelector('.save-copy-btn').onclick = async () => {
                const copyNo = tr.querySelector('.copy-no').value.trim();
                const condition = tr.querySelector('.copy-condition').value;
                const costVal = tr.querySelector('.copy-cost').value;
                await db().ref(`books/${bookId}/copies/${copyId}`).update({
                    copyNo,
                    condition,
                    replacementCost: costVal === '' ? null : parseFloat(costVal)
                });
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'success', title: 'Saved', timer: 1000, showConfirmButton: false });
                }
            };
            tr.querySelector('.retire-copy-btn').onclick = async () => {
                if (!confirm('Retire this copy? It will no longer count as available or issuable.')) return;
                await db().ref(`books/${bookId}/copies/${copyId}`).update({ status: 'retired' });
                tr.querySelector('.copy-status-badge').className = 'badge bg-secondary copy-status-badge';
                tr.querySelector('.copy-status-badge').textContent = 'retired';
            };
        });

        const addBtn = document.getElementById('addCopyBtn');
        if (addBtn) {
            addBtn.onclick = async () => {
                const copyId = db().ref(`books/${bookId}/copies`).push().key;
                await db().ref(`books/${bookId}/copies/${copyId}`).set({
                    copyNo: '', condition: 'good', replacementCost: null, status: 'available', addedAt: Date.now()
                });
                const freshSnap = await db().ref(`books/${bookId}/copies`).once('value');
                renderCopiesTable(bookId, book, freshSnap, body);
            };
        }
    }

    // ---- Issuance form: swap freeform Book No. for a copy picker ---------
    // Runs after IssuanceManager's own listener (registered on
    // DOMContentLoaded before this), so it can safely override the value
    // it set. If a title has no copies, nothing changes here.

    function hookIssuanceCopyPicker() {
        const bookSelect = document.getElementById('issuanceBook');
        const bookNoInput = document.getElementById('issuanceBookNo');
        if (!bookSelect || !bookNoInput) return;

        bookSelect.addEventListener('change', async () => {
            const bookId = bookSelect.value;
            if (!bookId) return;
            const copiesSnap = await db().ref(`books/${bookId}/copies`).once('value');
            const available = [];
            copiesSnap.forEach((child) => {
                const c = child.val();
                if (c.status === 'available') available.push({ id: child.key, ...c });
            });

            let picker = document.getElementById('issuanceCopyPicker');
            if (available.length === 0) {
                if (picker) picker.remove();
                bookNoInput.style.display = '';
                return;
            }

            bookNoInput.style.display = 'none';
            if (!picker) {
                picker = document.createElement('select');
                picker.id = 'issuanceCopyPicker';
                picker.className = bookNoInput.className;
                bookNoInput.insertAdjacentElement('afterend', picker);
                picker.addEventListener('change', () => { bookNoInput.value = picker.value; });
            }
            picker.innerHTML = available.map(c => `<option value="${c.copyNo}">${c.copyNo} (${c.condition})</option>`).join('');
            bookNoInput.value = picker.value;
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        attachIssuanceListener();
        hookBookCardButton();
        hookIssuanceCopyPicker();
    });

    window.copyInventory = { showCopiesModal };
})();
