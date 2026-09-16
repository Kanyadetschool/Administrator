/**
 * Spine Label Manager — Batch barcode & QR label printing
 * ========================================================
 * Generates printable sheets of barcode/QR spine labels for library books.
 * Supports Avery 5160 (3-column, 30/sheet), 2-column spine tags (14/sheet),
 * and single-strip barcode rolls.
 *
 * Dependencies (CDN): JsBarcode, QRCode (qrcodejs)
 */
class SpineLabelManager {
    constructor() {
        this.db = firebase.database();
        this.allBooks = new Map();
        this.selectedBooks = new Set();
        this.init();
    }

    init() {
        document.getElementById('printSpineLabelsBtn')?.addEventListener('click', () => this.openModal());
    }

    // ── Open the label configuration modal ────────────────────────────
    async openModal() {
        // Load current books
        await this.loadBooks();

        const grades = Array.from({ length: 9 }, (_, i) => `Grade ${i + 1}`);
        const categories = new Set();
        this.allBooks.forEach(b => { if (b.category) categories.add(b.category); });

        const modalHtml = `
        <div class="modal-dialog modal-xl">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="bi bi-printer me-2"></i>Print Spine Labels</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <!-- Filters row -->
                    <div class="d-flex flex-wrap gap-2 mb-3 align-items-end">
                        <div>
                            <label class="form-label small mb-1">Grade</label>
                            <select id="slGradeFilter" class="form-select form-select-sm" style="width:150px">
                                <option value="">All Grades</option>
                                ${grades.map(g => `<option value="${g}">${g}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="form-label small mb-1">Category</label>
                            <select id="slCategoryFilter" class="form-select form-select-sm" style="width:170px">
                                <option value="">All Categories</option>
                                ${[...categories].sort().map(c => `<option value="${c}">${c}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="form-label small mb-1">Search</label>
                            <input type="text" id="slSearch" class="form-control form-control-sm" placeholder="Title / ISBN" style="width:180px">
                        </div>
                        <div class="ms-auto d-flex gap-2">
                            <button id="slSelectAll" class="btn btn-outline-secondary btn-sm"><i class="bi bi-check-all"></i> Select All</button>
                            <button id="slDeselectAll" class="btn btn-outline-secondary btn-sm">Deselect All</button>
                        </div>
                    </div>

                    <!-- Book list -->
                    <div id="slBookList" class="border rounded p-2" style="max-height:280px; overflow-y:auto;"></div>

                    <hr>

                    <!-- Label options -->
                    <div class="row g-3">
                        <div class="col-md-4">
                            <label class="form-label fw-bold">Layout</label>
                            <select id="slLayout" class="form-select form-select-sm">
                                <option value="avery5160">Avery 5160 — 3 col, 30/sheet</option>
                                <option value="spine2col">Spine Tags — 2 col, 14/sheet</option>
                                <option value="strip">Single Strip / Roll</option>
                            </select>
                        </div>
                        <div class="col-md-4">
                            <label class="form-label fw-bold">Code Type</label>
                            <select id="slCodeType" class="form-select form-select-sm">
                                <option value="barcode">Code 128 Barcode</option>
                                <option value="qr">QR Code</option>
                                <option value="both">Both</option>
                            </select>
                        </div>
                        <div class="col-md-4">
                            <label class="form-label fw-bold">Copies</label>
                            <select id="slCopies" class="form-select form-select-sm">
                                <option value="1">1 label per title</option>
                                <option value="qty">1 label per copy in stock</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-check mt-2">
                        <input class="form-check-input" type="checkbox" id="slShowSchoolName" checked>
                        <label class="form-check-label small" for="slShowSchoolName">Include school name header</label>
                    </div>
                </div>
                <div class="modal-footer">
                    <span id="slSelectedCount" class="me-auto text-muted small">0 books selected</span>
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="button" class="btn btn-primary" id="slPreviewBtn"><i class="bi bi-eye me-1"></i>Preview & Print</button>
                </div>
            </div>
        </div>`;

        // Reuse or create the modal container
        let modalEl = document.getElementById('spineLabelModal');
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.id = 'spineLabelModal';
            modalEl.className = 'modal fade';
            modalEl.tabIndex = -1;
            document.body.appendChild(modalEl);
        }
        modalEl.innerHTML = modalHtml;

        const modal = new bootstrap.Modal(modalEl);
        modal.show();

        // Wire up
        this.selectedBooks.clear();
        this.renderBookList();
        document.getElementById('slGradeFilter').addEventListener('change', () => this.renderBookList());
        document.getElementById('slCategoryFilter').addEventListener('change', () => this.renderBookList());
        document.getElementById('slSearch').addEventListener('input', () => this.renderBookList());
        document.getElementById('slSelectAll').addEventListener('click', () => this.selectAll(true));
        document.getElementById('slDeselectAll').addEventListener('click', () => this.selectAll(false));
        document.getElementById('slPreviewBtn').addEventListener('click', () => {
            modal.hide();
            this.generatePreview();
        });
    }

    // ── Load books from Firebase ──────────────────────────────────────
    async loadBooks() {
        const snap = await this.db.ref('books').once('value');
        this.allBooks.clear();
        if (snap.exists()) {
            snap.forEach(child => {
                this.allBooks.set(child.key, child.val());
            });
        }
    }

    // ── Filter & render book checklist ────────────────────────────────
    renderBookList() {
        const grade = document.getElementById('slGradeFilter')?.value || '';
        const category = document.getElementById('slCategoryFilter')?.value || '';
        const search = (document.getElementById('slSearch')?.value || '').toLowerCase();
        const container = document.getElementById('slBookList');
        if (!container) return;

        let html = '';
        let count = 0;
        this.allBooks.forEach((book, id) => {
            if (grade && book.grade !== grade) return;
            if (category && book.category !== category) return;
            if (search && !(book.title || '').toLowerCase().includes(search) && !(book.isbn || '').toLowerCase().includes(search)) return;
            count++;
            const checked = this.selectedBooks.has(id) ? 'checked' : '';
            html += `
                <div class="form-check py-1 border-bottom">
                    <input class="form-check-input sl-book-check" type="checkbox" value="${id}" id="slb_${id}" ${checked}>
                    <label class="form-check-label small d-flex justify-content-between w-100" for="slb_${id}">
                        <span><strong>${book.title || 'Untitled'}</strong> <span class="text-muted">— ${book.grade || ''}</span></span>
                        <span class="text-muted">${book.isbn || 'No ISBN'} &middot; Qty: ${book.quantity || 0}</span>
                    </label>
                </div>`;
        });

        container.innerHTML = count > 0 ? html : '<p class="text-muted small p-2">No books match the current filters.</p>';

        // Attach change listeners
        container.querySelectorAll('.sl-book-check').forEach(cb => {
            cb.addEventListener('change', (e) => {
                if (e.target.checked) this.selectedBooks.add(e.target.value);
                else this.selectedBooks.delete(e.target.value);
                this.updateCount();
            });
        });
        this.updateCount();
    }

    selectAll(select) {
        document.querySelectorAll('.sl-book-check').forEach(cb => {
            cb.checked = select;
            if (select) this.selectedBooks.add(cb.value);
            else this.selectedBooks.delete(cb.value);
        });
        this.updateCount();
    }

    updateCount() {
        const el = document.getElementById('slSelectedCount');
        if (el) el.textContent = `${this.selectedBooks.size} book${this.selectedBooks.size !== 1 ? 's' : ''} selected`;
    }

    // ── Generate label preview & print window ────────────────────────
    generatePreview() {
        if (this.selectedBooks.size === 0) {
            Swal.fire({ icon: 'warning', title: 'No Books Selected', text: 'Please select at least one book to print labels for.' });
            return;
        }

        const layout   = document.getElementById('slLayout')?.value || 'avery5160';
        const codeType = document.getElementById('slCodeType')?.value || 'barcode';
        const copies   = document.getElementById('slCopies')?.value || '1';
        const showSchool = document.getElementById('slShowSchoolName')?.checked ?? true;

        // Build label data
        const labels = [];
        this.selectedBooks.forEach(id => {
            const book = this.allBooks.get(id);
            if (!book) return;
            const count = copies === 'qty' ? (book.quantity || 1) : 1;
            for (let i = 0; i < count; i++) {
                labels.push({ id, book });
            }
        });

        // Layout config
        const layoutConfig = {
            avery5160: { cols: 3, labelW: '63.5mm', labelH: '25.4mm', gap: '0mm', fontSize: '7.5pt', barcodeH: 28, barcodeW: 1.2 },
            spine2col: { cols: 2, labelW: '95mm',   labelH: '38mm',   gap: '2mm', fontSize: '8.5pt', barcodeH: 34, barcodeW: 1.4 },
            strip:     { cols: 1, labelW: '100%',    labelH: '42mm',   gap: '3mm', fontSize: '9pt',   barcodeH: 40, barcodeW: 1.5 }
        };
        const cfg = layoutConfig[layout];

        // Open print window
        const win = window.open('', '_blank', 'width=900,height=700');
        if (!win) {
            Swal.fire({ icon: 'error', title: 'Popup Blocked', text: 'Please allow popups for this site to preview labels.' });
            return;
        }

        win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Spine Labels — Print</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
        <style>
            @page { margin: 6mm; }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Arial', 'Helvetica', sans-serif; }
            .label-grid {
                display: flex; flex-wrap: wrap;
                gap: ${cfg.gap};
            }
            .label {
                width: ${cfg.labelW}; height: ${cfg.labelH};
                border: 0.5px dashed #ccc;
                padding: 3px 5px;
                display: flex; flex-direction: column;
                justify-content: center; align-items: center;
                overflow: hidden; page-break-inside: avoid;
                text-align: center;
            }
            .label-school { font-size: 6pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #333; margin-bottom: 1px; }
            .label-title { font-size: ${cfg.fontSize}; font-weight: 700; line-height: 1.2; max-height: 2.4em; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-bottom: 1px; }
            .label-meta { font-size: 6pt; color: #666; margin-bottom: 2px; }
            .label-barcode svg, .label-barcode canvas { display: block; margin: 0 auto; }
            .label-isbn { font-size: 5.5pt; color: #888; font-family: monospace; }
            .toolbar { padding: 10px 20px; background: #f8f8f8; border-bottom: 1px solid #ddd; display: flex; gap: 10px; align-items: center; }
            .toolbar button { padding: 6px 16px; border: 1px solid #ccc; border-radius: 6px; cursor: pointer; font-size: 13px; background: #fff; }
            .toolbar button.primary { background: #16233D; color: #fff; border: none; }
            @media print {
                .toolbar { display: none !important; }
                .label { border: none !important; }
            }
        </style></head><body>
        <div class="toolbar">
            <button class="primary" onclick="window.print()"><b>🖨 Print Labels</b></button>
            <button onclick="window.close()">Close</button>
            <span style="margin-left:auto; font-size:12px; color:#888;">${labels.length} label(s) · ${layout} layout</span>
        </div>
        <div class="label-grid" id="labelGrid"></div>
        <script>
        document.addEventListener('DOMContentLoaded', function() {
            var labels = ${JSON.stringify(labels.map(l => ({
                id: l.id,
                title: l.book.title || 'Untitled',
                grade: l.book.grade || '',
                subject: l.book.subject || l.book.category || '',
                isbn: l.book.isbn || l.id
            })))};
            var codeType = '${codeType}';
            var showSchool = ${showSchool};
            var barcodeH = ${cfg.barcodeH};
            var barcodeW = ${cfg.barcodeW};
            var grid = document.getElementById('labelGrid');

            labels.forEach(function(lbl, idx) {
                var div = document.createElement('div');
                div.className = 'label';

                var html = '';
                if (showSchool) html += '<div class="label-school">KANYADET SCHOOL LIBRARY</div>';
                html += '<div class="label-title">' + lbl.title + '</div>';
                html += '<div class="label-meta">' + lbl.grade + (lbl.subject ? ' · ' + lbl.subject : '') + '</div>';

                // Barcode container
                if (codeType === 'barcode' || codeType === 'both') {
                    html += '<div class="label-barcode"><svg id="bc_' + idx + '"></svg></div>';
                }
                if (codeType === 'qr' || codeType === 'both') {
                    html += '<div class="label-barcode" id="qr_' + idx + '" style="margin-top:2px;"></div>';
                }
                html += '<div class="label-isbn">' + lbl.isbn + '</div>';
                div.innerHTML = html;
                grid.appendChild(div);

                // Render barcode
                if (codeType === 'barcode' || codeType === 'both') {
                    try {
                        JsBarcode('#bc_' + idx, lbl.isbn, {
                            format: 'CODE128', width: barcodeW, height: barcodeH,
                            displayValue: false, margin: 0
                        });
                    } catch(e) { console.warn('Barcode error for', lbl.isbn, e); }
                }
                // Render QR
                if (codeType === 'qr' || codeType === 'both') {
                    try {
                        new QRCode(document.getElementById('qr_' + idx), {
                            text: lbl.isbn, width: barcodeH, height: barcodeH, correctLevel: QRCode.CorrectLevel.M
                        });
                    } catch(e) { console.warn('QR error for', lbl.isbn, e); }
                }
            });
        });
        <\/script></body></html>`);
        win.document.close();
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.spineLabelManager = new SpineLabelManager();
});
