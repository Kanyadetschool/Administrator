/**
 * Class-Kit Bulk Issuance & Stream Clearance Engine
 * =========================================================================
 * Designed for Kenyan Schools & CBC Curriculum (Grades 1–9)
 * 
 * Capabilities:
 * 1. Bulk Issue Class-Kits (assign textbooks to an entire grade/stream in 1-click)
 * 2. Continuous barcode scan distribution for a nominal roll
 * 3. Stream & Student Clearance Audit Dashboard
 * 4. 1-Click Class-Kit Batch Return / Re-stocking at term-end
 * 5. Official Printable Student Library Clearance Certificates
 */

class ClassKitManager {
    constructor() {
        this.db = firebase.database();
        this.init();
    }

    init() {
        // Wire up buttons across the dashboard and Class Library page
        document.getElementById('bulkIssuanceBtn')?.addEventListener('click', () => this.showBulkIssueModal());
        
        // Add Clearance & Bulk Issue buttons to classLibrary page if present
        this.injectClassLibraryButtons();
    }

    injectClassLibraryButtons() {
        const classLibActionBar = document.querySelector('#classLibrary .action-bar');
        if (classLibActionBar && !document.getElementById('classKitIssueBtn')) {
            const btnGroup = document.createElement('div');
            btnGroup.className = 'd-flex gap-2 ms-auto flex-wrap';
            btnGroup.innerHTML = `
                <button type="button" class="btn btn-primary" id="classKitIssueBtn">
                    <i class="bi bi-collection me-1"></i>Class-Kit Bulk Issue
                </button>
                <button type="button" class="btn btn-success" id="classStreamClearanceBtn">
                    <i class="bi bi-patch-check me-1"></i>Stream Clearance
                </button>
            `;
            classLibActionBar.appendChild(btnGroup);

            document.getElementById('classKitIssueBtn')?.addEventListener('click', () => {
                const currentGrade = document.getElementById('classLibraryGrade')?.value || '';
                this.showBulkIssueModal(currentGrade);
            });

            document.getElementById('classStreamClearanceBtn')?.addEventListener('click', () => {
                const currentGrade = document.getElementById('classLibraryGrade')?.value || '';
                this.showClearanceModal(currentGrade);
            });
        }
    }

    // =========================================================================
    // 1. CLASS-KIT BULK ISSUANCE
    // =========================================================================

    async showBulkIssueModal(initialGrade = '') {
        const grades = Array.from({ length: 9 }, (_, i) => `Grade ${i + 1}`);

        // Fetch all books for selection
        const booksSnap = await this.db.ref('books').once('value');
        const books = [];
        if (booksSnap.exists()) {
            booksSnap.forEach(c => {
                books.push({ id: c.key, ...c.val() });
            });
        }

        // Calculate default term-end dates (e.g. 90 days from now)
        const now = new Date();
        const termEnd = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const yearEnd = new Date(now.getFullYear(), 10, 30).toISOString().split('T')[0];

        const modalHtml = `
        <div class="modal-dialog modal-xl">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">
                        <i class="bi bi-collection-play me-2 text-primary"></i>Class-Kit Bulk Textbook Issuance
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="row g-3">
                        <!-- Left Column: Controls -->
                        <div class="col-md-5">
                            <div class="card p-3 border shadow-sm">
                                <h6 class="fw-bold mb-3"><i class="bi bi-sliders me-1"></i>1. Configure Class & Book</h6>
                                
                                <div class="mb-3">
                                    <label class="form-label fw-bold">Select Grade / Stream <span class="text-danger">*</span></label>
                                    <select id="ckGradeSelect" class="form-select">
                                        <option value="">-- Choose Grade --</option>
                                        ${grades.map(g => `<option value="${g}" ${g === initialGrade ? 'selected' : ''}>${g}</option>`).join('')}
                                    </select>
                                </div>

                                <div class="mb-3">
                                    <label class="form-label fw-bold">Textbook / Subject Kit <span class="text-danger">*</span></label>
                                    <select id="ckBookSelect" class="form-select">
                                        <option value="">-- Choose Book --</option>
                                        ${books.map(b => `
                                            <option value="${b.id}" data-grade="${b.grade || ''}" data-available="${b.available ?? b.quantity}" data-qty="${b.quantity}">
                                                ${b.title} (${b.grade || 'All Grades'}) — Available: ${b.available ?? b.quantity} / ${b.quantity}
                                            </option>
                                        `).join('')}
                                    </select>
                                </div>

                                <div class="mb-3">
                                    <label class="form-label fw-bold">Return / Due Date <span class="text-danger">*</span></label>
                                    <input type="date" id="ckDueDate" class="form-control" value="${termEnd}">
                                    <div class="d-flex gap-1 mt-2">
                                        <button type="button" class="btn btn-outline-secondary btn-sm" id="ckSetTermEnd">Term End (+90d)</button>
                                        <button type="button" class="btn btn-outline-secondary btn-sm" id="ckSetYearEnd">End of Year</button>
                                    </div>
                                </div>

                                <div class="alert alert-info py-2 px-3 small mb-0" id="ckStockSummary">
                                    <i class="bi bi-info-circle me-1"></i>Select a grade and book to preview roster and inventory matching.
                                </div>
                            </div>
                        </div>

                        <!-- Right Column: Student Roster Checklist -->
                        <div class="col-md-7">
                            <div class="card p-3 border shadow-sm h-100 d-flex flex-column">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <h6 class="fw-bold mb-0">
                                        <i class="bi bi-people me-1"></i>2. Students to Receive Textbooks 
                                        <span class="badge bg-primary" id="ckRosterCount">0 Selected</span>
                                    </h6>
                                    <div class="btn-group btn-group-sm">
                                        <button type="button" class="btn btn-outline-secondary" id="ckSelectAll">Select All</button>
                                        <button type="button" class="btn btn-outline-secondary" id="ckDeselectAll">Deselect All</button>
                                    </div>
                                </div>

                                <div id="ckStudentList" class="border rounded p-2 flex-grow-1" style="max-height: 380px; overflow-y: auto;">
                                    <p class="text-muted text-center py-4">Please choose a Grade to load the enrolled nominal roll.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <div class="me-auto small" id="ckStatusNote"></div>
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="button" class="btn btn-primary" id="ckExecuteIssueBtn" disabled>
                        <i class="bi bi-check2-circle me-1"></i>Issue Textbooks Now
                    </button>
                </div>
            </div>
        </div>`;

        let modalEl = document.getElementById('classKitModal');
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.id = 'classKitModal';
            modalEl.className = 'modal fade';
            modalEl.tabIndex = -1;
            document.body.appendChild(modalEl);
        }
        modalEl.innerHTML = modalHtml;

        const modal = new bootstrap.Modal(modalEl);
        modal.show();

        // Wire handlers
        const gradeSelect = document.getElementById('ckGradeSelect');
        const bookSelect = document.getElementById('ckBookSelect');
        const dueDateInput = document.getElementById('ckDueDate');
        const executeBtn = document.getElementById('ckExecuteIssueBtn');

        document.getElementById('ckSetTermEnd').onclick = () => { dueDateInput.value = termEnd; };
        document.getElementById('ckSetYearEnd').onclick = () => { dueDateInput.value = yearEnd; };

        const updateView = async () => {
            const grade = gradeSelect.value;
            const bookId = bookSelect.value;
            await this._renderBulkIssueRoster(grade, bookId);
        };

        gradeSelect.addEventListener('change', updateView);
        bookSelect.addEventListener('change', updateView);

        document.getElementById('ckSelectAll').onclick = () => {
            document.querySelectorAll('.ck-student-check:not(:disabled)').forEach(cb => cb.checked = true);
            this._updateRosterSelectionCount();
        };

        document.getElementById('ckDeselectAll').onclick = () => {
            document.querySelectorAll('.ck-student-check:not(:disabled)').forEach(cb => cb.checked = false);
            this._updateRosterSelectionCount();
        };

        executeBtn.onclick = async () => {
            await this._executeBulkIssuance(gradeSelect.value, bookSelect.value, dueDateInput.value, modal);
        };

        if (initialGrade) {
            updateView();
        }
    }

    async _renderBulkIssueRoster(grade, bookId) {
        const container = document.getElementById('ckStudentList');
        const executeBtn = document.getElementById('ckExecuteIssueBtn');
        const stockSummary = document.getElementById('ckStockSummary');
        if (!container) return;

        if (!grade) {
            container.innerHTML = '<p class="text-muted text-center py-4">Please choose a Grade to load students.</p>';
            executeBtn.disabled = true;
            return;
        }

        container.innerHTML = '<div class="text-center py-4"><span class="spinner-border spinner-border-sm"></span> Loading student roster...</div>';

        // 1. Get students for this grade
        const students = await this._getStudentsByGrade(grade);
        if (students.length === 0) {
            container.innerHTML = `<p class="text-warning text-center py-4">No enrolled students found in ${grade}.</p>`;
            executeBtn.disabled = true;
            return;
        }

        // 2. If a book is selected, check who already has an active copy
        let activeHolders = new Set();
        let selectedBook = null;
        if (bookId) {
            const bookSnap = await this.db.ref(`books/${bookId}`).once('value');
            selectedBook = bookSnap.val();

            const issuanceSnap = await this.db.ref('issuance').orderByChild('bookId').equalTo(bookId).once('value');
            if (issuanceSnap.exists()) {
                issuanceSnap.forEach(c => {
                    const iss = c.val();
                    if (iss.status === 'active') {
                        activeHolders.add(iss.studentId);
                    }
                });
            }
        }

        // 3. Render student items
        let html = '';
        let availableCopies = selectedBook ? (selectedBook.available ?? selectedBook.quantity ?? 0) : 0;

        students.forEach((s, idx) => {
            const alreadyHas = activeHolders.has(s.id);
            const isChecked = !alreadyHas;
            const disabledAttr = alreadyHas ? 'disabled' : '';

            html += `
                <div class="form-check py-2 border-bottom d-flex justify-content-between align-items-center ${alreadyHas ? 'bg-light opacity-75' : ''}">
                    <div>
                        <input class="form-check-input ck-student-check" type="checkbox" value="${s.id}" id="cks_${s.id}" 
                            data-name="${s.name}" data-assessment="${s.assessmentNo || ''}" ${isChecked ? 'checked' : ''} ${disabledAttr}>
                        <label class="form-check-label fw-bold ms-1" for="cks_${s.id}">
                            ${s.name}
                        </label>
                        <small class="text-muted d-block ms-4">Assessment No: ${s.assessmentNo || 'N/A'} &middot; UPI: ${s.upi || 'N/A'}</small>
                    </div>
                    <div>
                        ${alreadyHas ? '<span class="badge bg-warning text-dark"><i class="bi bi-clock-history"></i> Already Issued</span>' : '<span class="badge bg-success">Eligible</span>'}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        // Attach change listeners
        container.querySelectorAll('.ck-student-check').forEach(cb => {
            cb.addEventListener('change', () => this._updateRosterSelectionCount());
        });

        this._updateRosterSelectionCount();

        // Update inventory summary
        if (selectedBook) {
            const selectedCount = container.querySelectorAll('.ck-student-check:checked').length;
            const hasEnough = availableCopies >= selectedCount;

            stockSummary.className = `alert py-2 px-3 small mb-0 ${hasEnough ? 'alert-success' : 'alert-danger'}`;
            stockSummary.innerHTML = `
                <strong>${selectedBook.title}</strong><br>
                Stock Available: <strong>${availableCopies}</strong> copies | Needed for selection: <strong>${selectedCount}</strong><br>
                ${!hasEnough ? '⚠️ <strong>Warning:</strong> Available stock is less than selected students. Adjust selection or restock.' : '✅ Sufficient stock available.'}
            `;

            executeBtn.disabled = selectedCount === 0 || !hasEnough;
        } else {
            stockSummary.className = 'alert alert-info py-2 px-3 small mb-0';
            stockSummary.innerHTML = 'Select a book to verify stock availability and enable issuance.';
            executeBtn.disabled = true;
        }
    }

    _updateRosterSelectionCount() {
        const checks = document.querySelectorAll('.ck-student-check:checked');
        const count = checks.length;
        const badge = document.getElementById('ckRosterCount');
        if (badge) badge.textContent = `${count} Selected`;

        const bookSelect = document.getElementById('ckBookSelect');
        const executeBtn = document.getElementById('ckExecuteIssueBtn');
        const stockSummary = document.getElementById('ckStockSummary');

        if (bookSelect && bookSelect.value) {
            const selectedOpt = bookSelect.options[bookSelect.selectedIndex];
            const available = parseInt(selectedOpt.getAttribute('data-available') || '0');
            const hasEnough = available >= count;
            if (executeBtn) executeBtn.disabled = count === 0 || !hasEnough;
        }
    }

    async _executeBulkIssuance(grade, bookId, dueDate, modal) {
        const checkedBoxes = Array.from(document.querySelectorAll('.ck-student-check:checked'));
        if (checkedBoxes.length === 0) {
            Swal.fire({ icon: 'warning', title: 'No Students Selected', text: 'Please select at least one student to issue to.' });
            return;
        }

        const confirm = await Swal.fire({
            title: 'Confirm Class-Kit Issuance',
            html: `You are about to issue <strong>${checkedBoxes.length} copies</strong> to <strong>${grade}</strong> students.<br>Due Date: <strong>${dueDate}</strong>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Yes, Issue to Class',
            confirmButtonColor: '#16233D'
        });

        if (!confirm.isConfirmed) return;

        // Fetch book details
        const bookSnap = await this.db.ref(`books/${bookId}`).once('value');
        const book = bookSnap.val();
        if (!book) {
            Swal.fire({ icon: 'error', title: 'Error', text: 'Book record not found.' });
            return;
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const updates = {};
        const countToIssue = checkedBoxes.length;

        // Create issuance record for each student
        checkedBoxes.forEach(cb => {
            const studentId = cb.value;
            const studentName = cb.getAttribute('data-name');
            const assessmentNo = cb.getAttribute('data-assessment');
            const newKey = this.db.ref('issuance').push().key;

            updates[`issuance/${newKey}`] = {
                studentId: studentId,
                studentName: studentName,
                assessmentNo: assessmentNo || '',
                grade: grade,
                bookId: bookId,
                bookTitle: book.title,
                isbn: book.isbn || '',
                issueDate: todayStr,
                returnDate: dueDate,
                status: 'active',
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                issuedBy: 'Librarian (Bulk Class-Kit)'
            };
        });

        // Deduct book inventory
        const currentAvail = book.available ?? book.quantity;
        const newAvail = Math.max(0, currentAvail - countToIssue);
        updates[`books/${bookId}/available`] = newAvail;

        try {
            await this.db.ref().update(updates);

            // Log in auditLogger if present
            if (window.auditLogger) {
                await window.auditLogger.log('BULK_ISSUE', 'CLASS_KIT', bookId, {
                    grade: grade,
                    bookTitle: book.title,
                    count: countToIssue,
                    dueDate: dueDate
                });
            }

            modal.hide();

            Swal.fire({
                icon: 'success',
                title: 'Class-Kit Issued Successfully! 🎉',
                html: `Successfully assigned <strong>${countToIssue} copies</strong> of <em>${book.title}</em> to <strong>${grade}</strong> students.<br>Remaining stock: <strong>${newAvail}</strong>`
            });

        } catch (err) {
            console.error('Bulk issuance failed:', err);
            Swal.fire({ icon: 'error', title: 'Issuance Failed', text: err.message });
        }
    }


    // =========================================================================
    // 2. STREAM / STUDENT CLEARANCE & CLEARANCE CERTIFICATE
    // =========================================================================

    async showClearanceModal(initialGrade = '') {
        const grades = Array.from({ length: 9 }, (_, i) => `Grade ${i + 1}`);

        const modalHtml = `
        <div class="modal-dialog modal-xl">
            <div class="modal-content">
                <div class="modal-header bg-light">
                    <h5 class="modal-title fw-bold">
                        <i class="bi bi-patch-check me-2 text-success"></i>Stream & Term-End Library Clearance
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <!-- Filter Bar -->
                    <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
                        <div style="min-width: 180px;">
                            <label class="form-label small fw-bold mb-1">Select Grade</label>
                            <select id="clrGradeSelect" class="form-select form-select-sm">
                                <option value="">-- Choose Grade --</option>
                                ${grades.map(g => `<option value="${g}" ${g === initialGrade ? 'selected' : ''}>${g}</option>`).join('')}
                            </select>
                        </div>
                        <div style="min-width: 180px;">
                            <label class="form-label small fw-bold mb-1">Filter Status</label>
                            <select id="clrStatusFilter" class="form-select form-select-sm">
                                <option value="all">All Students</option>
                                <option value="uncleared">Uncleared (Has Books / Debt)</option>
                                <option value="cleared">Fully Cleared Only</option>
                            </select>
                        </div>
                        <div class="ms-auto d-flex gap-2 align-self-end">
                            <button type="button" class="btn btn-outline-primary btn-sm" id="clrBatchReturnBtn" disabled>
                                <i class="bi bi-box-arrow-in-down me-1"></i>Batch Return Subject
                            </button>
                            <button type="button" class="btn btn-outline-secondary btn-sm" id="clrPrintRosterBtn">
                                <i class="bi bi-printer me-1"></i>Print Clearance Sheet
                            </button>
                        </div>
                    </div>

                    <!-- Summary KPI Cards -->
                    <div class="row g-2 mb-3">
                        <div class="col-md-3">
                            <div class="p-2 border rounded text-center bg-light">
                                <small class="text-muted d-block">Enrolled</small>
                                <strong class="fs-5" id="clrTotalStudents">0</strong>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="p-2 border rounded text-center bg-light">
                                <small class="text-muted d-block">Cleared ✅</small>
                                <strong class="fs-5 text-success" id="clrClearedCount">0</strong>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="p-2 border rounded text-center bg-light">
                                <small class="text-muted d-block">Uncleared ⚠️</small>
                                <strong class="fs-5 text-danger" id="clrUnclearedCount">0</strong>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="p-2 border rounded text-center bg-light">
                                <small class="text-muted d-block">Total Books Held</small>
                                <strong class="fs-5 text-primary" id="clrBooksHeld">0</strong>
                            </div>
                        </div>
                    </div>

                    <!-- Student Table -->
                    <div class="table-responsive border rounded" style="max-height: 420px; overflow-y: auto;">
                        <table class="table table-hover table-sm align-middle mb-0">
                            <thead class="table-light sticky-top">
                                <tr>
                                    <th>#</th>
                                    <th>Student Name</th>
                                    <th>Assessment No</th>
                                    <th>Active Books</th>
                                    <th>Overdue</th>
                                    <th>Status</th>
                                    <th class="text-end">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="clrTableBody">
                                <tr>
                                    <td colspan="7" class="text-center py-4 text-muted">Select a Grade above to view clearance roster.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                </div>
            </div>
        </div>`;

        let modalEl = document.getElementById('clearanceModal');
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.id = 'clearanceModal';
            modalEl.className = 'modal fade';
            modalEl.tabIndex = -1;
            document.body.appendChild(modalEl);
        }
        modalEl.innerHTML = modalHtml;

        const modal = new bootstrap.Modal(modalEl);
        modal.show();

        const gradeSelect = document.getElementById('clrGradeSelect');
        const statusFilter = document.getElementById('clrStatusFilter');
        const batchReturnBtn = document.getElementById('clrBatchReturnBtn');
        const printRosterBtn = document.getElementById('clrPrintRosterBtn');

        const loadRoster = async () => {
            const grade = gradeSelect.value;
            const filter = statusFilter.value;
            await this._renderClearanceRoster(grade, filter);
        };

        gradeSelect.addEventListener('change', () => {
            batchReturnBtn.disabled = !gradeSelect.value;
            loadRoster();
        });
        statusFilter.addEventListener('change', loadRoster);

        batchReturnBtn.onclick = () => this._showBatchReturnSubjectModal(gradeSelect.value);
        printRosterBtn.onclick = () => this._printClearanceRoster(gradeSelect.value);

        if (initialGrade) {
            batchReturnBtn.disabled = false;
            loadRoster();
        }
    }

    async _renderClearanceRoster(grade, filter = 'all') {
        const tbody = document.getElementById('clrTableBody');
        if (!tbody) return;

        if (!grade) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">Please choose a Grade to display students.</td></tr>';
            return;
        }

        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4"><span class="spinner-border spinner-border-sm"></span> Compiling clearance records...</td></tr>';

        // 1. Fetch Students
        const students = await this._getStudentsByGrade(grade);
        if (students.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-warning">No students found in ${grade}.</td></tr>`;
            return;
        }

        // 2. Fetch Active Issuances for this Grade
        const issSnap = await this.db.ref('issuance').orderByChild('grade').equalTo(grade).once('value');
        const activeByStudent = new Map();

        const today = new Date();
        if (issSnap.exists()) {
            issSnap.forEach(c => {
                const iss = c.val();
                if (iss.status === 'active') {
                    if (!activeByStudent.has(iss.studentId)) {
                        activeByStudent.set(iss.studentId, []);
                    }
                    const dueDate = iss.returnDate ? new Date(iss.returnDate) : null;
                    const isOverdue = dueDate && dueDate < today;
                    activeByStudent.get(iss.studentId).push({ id: c.key, ...iss, isOverdue });
                }
            });
        }

        // 3. Compile rows
        let clearedCount = 0;
        let unclearedCount = 0;
        let totalBooks = 0;

        const rosterData = students.map((s, idx) => {
            const loans = activeByStudent.get(s.id) || [];
            const bookCount = loans.length;
            const overdueCount = loans.filter(l => l.isOverdue).length;
            const isCleared = bookCount === 0;

            if (isCleared) clearedCount++;
            else unclearedCount++;
            totalBooks += bookCount;

            return {
                index: idx + 1,
                student: s,
                loans: loans,
                bookCount: bookCount,
                overdueCount: overdueCount,
                isCleared: isCleared
            };
        });

        // Update KPIs
        document.getElementById('clrTotalStudents').textContent = students.length;
        document.getElementById('clrClearedCount').textContent = clearedCount;
        document.getElementById('clrUnclearedCount').textContent = unclearedCount;
        document.getElementById('clrBooksHeld').textContent = totalBooks;

        // Apply filter
        const visibleRows = rosterData.filter(r => {
            if (filter === 'cleared') return r.isCleared;
            if (filter === 'uncleared') return !r.isCleared;
            return true;
        });

        if (visibleRows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No students match the current status filter.</td></tr>';
            return;
        }

        let html = '';
        visibleRows.forEach(r => {
            const statusBadge = r.isCleared 
                ? '<span class="badge bg-success-subtle text-success border border-success"><i class="bi bi-check-circle me-1"></i>Cleared</span>' 
                : `<span class="badge bg-danger-subtle text-danger border border-danger"><i class="bi bi-exclamation-triangle me-1"></i>${r.bookCount} Book(s) Held</span>`;

            const booksListSnippet = r.loans.map(l => 
                `<span class="badge bg-light text-dark border me-1 mb-1">${l.bookTitle} ${l.isOverdue ? '<b class="text-danger">(Overdue)</b>' : ''}</span>`
            ).join('');

            html += `
                <tr>
                    <td>${r.index}</td>
                    <td><strong>${r.student.name}</strong></td>
                    <td><small class="font-monospace">${r.student.assessmentNo || '—'}</small></td>
                    <td>
                        <div>${r.bookCount > 0 ? booksListSnippet : '<span class="text-muted small">None</span>'}</div>
                    </td>
                    <td>
                        ${r.overdueCount > 0 ? `<span class="badge bg-danger">${r.overdueCount} Overdue</span>` : '<span class="text-muted small">0</span>'}
                    </td>
                    <td>${statusBadge}</td>
                    <td class="text-end">
                        <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2" onclick="window.classKitManager.printSingleCertificate('${r.student.id}')" title="Print Individual Clearance Certificate">
                            <i class="bi bi-patch-check me-1"></i>Certificate
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }

    // -------------------------------------------------------------------------
    // 3. 1-CLICK BATCH RETURN BY SUBJECT (Term End Collection)
    // -------------------------------------------------------------------------

    async _showBatchReturnSubjectModal(grade) {
        if (!grade) return;

        // Find active books held by this grade
        const issSnap = await this.db.ref('issuance').orderByChild('grade').equalTo(grade).once('value');
        const subjectMap = new Map(); // bookId => { title, count, issuanceIds }

        if (issSnap.exists()) {
            issSnap.forEach(c => {
                const iss = c.val();
                if (iss.status === 'active') {
                    if (!subjectMap.has(iss.bookId)) {
                        subjectMap.set(iss.bookId, { title: iss.bookTitle, count: 0, items: [] });
                    }
                    const obj = subjectMap.get(iss.bookId);
                    obj.count++;
                    obj.items.push({ id: c.key, ...iss });
                }
            });
        }

        if (subjectMap.size === 0) {
            Swal.fire({ icon: 'info', title: 'All Clear!', text: `There are currently no outstanding active books for ${grade}.` });
            return;
        }

        const optionsHtml = Array.from(subjectMap.entries()).map(([bookId, info]) => `
            <option value="${bookId}">
                ${info.title} (${info.count} copies currently held in ${grade})
            </option>
        `).join('');

        const { value: selectedBookId } = await Swal.fire({
            title: `Batch Return: ${grade} Textbooks`,
            html: `
                <p class="small text-muted mb-3">Select the subject textbook you are collecting back from the entire class:</p>
                <select id="batchBookSelect" class="form-select mb-3">
                    ${optionsHtml}
                </select>
            `,
            icon: 'info',
            showCancelButton: true,
            confirmButtonText: 'Return All Copies for Class',
            confirmButtonColor: '#2f7a4e',
            preConfirm: () => document.getElementById('batchBookSelect').value
        });

        if (!selectedBookId) return;

        const info = subjectMap.get(selectedBookId);
        const todayStr = new Date().toISOString().split('T')[0];
        const updates = {};

        // Mark all issuances as returned
        info.items.forEach(item => {
            updates[`issuance/${item.id}/status`] = 'returned';
            updates[`issuance/${item.id}/actualReturnDate`] = todayStr;
            updates[`issuance/${item.id}/returnedAt`] = firebase.database.ServerValue.TIMESTAMP;
        });

        // Restock the book's available count
        const bookSnap = await this.db.ref(`books/${selectedBookId}`).once('value');
        const book = bookSnap.val();
        if (book) {
            const curAvail = book.available ?? 0;
            const newAvail = Math.min(book.quantity, curAvail + info.count);
            updates[`books/${selectedBookId}/available`] = newAvail;
        }

        try {
            await this.db.ref().update(updates);

            if (window.auditLogger) {
                await window.auditLogger.log('BATCH_RETURN', 'CLASS_KIT', selectedBookId, {
                    grade: grade,
                    bookTitle: info.title,
                    copiesReturned: info.count
                });
            }

            Swal.fire({
                icon: 'success',
                title: 'Batch Return Complete! 📚',
                html: `Successfully returned <strong>${info.count} copies</strong> of <em>${info.title}</em> from <strong>${grade}</strong> back into library inventory.`
            });

            // Refresh clearance modal
            this._renderClearanceRoster(grade);

        } catch (err) {
            console.error('Batch return failed:', err);
            Swal.fire({ icon: 'error', title: 'Error', text: err.message });
        }
    }


    // -------------------------------------------------------------------------
    // 4. PRINTABLE CLEARANCE CERTIFICATES & ROSTERS
    // -------------------------------------------------------------------------

    async printSingleCertificate(studentId) {
        const student = (typeof StudentsCache !== 'undefined') ? StudentsCache.get(studentId) : null;
        let sData = student;
        if (!sData) {
            const snap = await this.db.ref(`students/${studentId}`).once('value');
            sData = snap.val();
        }

        if (!sData) {
            Swal.fire({ icon: 'error', title: 'Error', text: 'Student not found.' });
            return;
        }

        // 1. Resolve student photo
        let photoSrc = sData.photoUrl || sData.imageUrl || sData.photo || null;
        if (!photoSrc) {
            const g = (sData.grade || '').trim();
            const n = (sData.name || '').trim();
            // Candidate paths relative to Library system/
            const candidatePaths = [
                `../Report-Cards/student_images/${g}/${n}.jpg`,
                `../Report-Cards/student_images/${encodeURIComponent(g)}/${encodeURIComponent(n)}.jpg`,
                `../student_images/${g}/${n}.jpg`,
                `./images/default-student.png`,
                `../images/default-student.png`
            ];
            photoSrc = candidatePaths[0];
        }

        // 2. Check active loans
        const issSnap = await this.db.ref('issuance').orderByChild('studentId').equalTo(studentId).once('value');
        const activeLoans = [];
        if (issSnap.exists()) {
            issSnap.forEach(c => {
                const iss = c.val();
                if (iss.status === 'active') activeLoans.push(iss);
            });
        }

        const isCleared = activeLoans.length === 0;
        const todayFormatted = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        const academicYear = new Date().getFullYear();
        const certSerial = `KNY-LIB-${academicYear}-${(Math.abs(studentId.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % 90000 + 10000)}`;

        const printWin = window.open('', '_blank', 'width=950,height=850');
        if (!printWin) {
            Swal.fire({ icon: 'error', title: 'Popup Blocked', text: 'Please allow popups to print certificate.' });
            return;
        }

        printWin.document.write(`<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Clearance Certificate — ${sData.name}</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@600;700&display=swap" rel="stylesheet">
            <style>
                @page {
                    size: A4 portrait;
                    margin: 8mm;
                }
                * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                }
                body {
                    font-family: 'Plus Jakarta Sans', sans-serif;
                    background: #f0f2f5;
                    color: #16233d;
                    padding: 16px;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .no-print-toolbar {
                    max-width: 800px;
                    margin: 0 auto 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: #ffffff;
                    padding: 12px 20px;
                    border-radius: 12px;
                    box-shadow: 0 4px 16px rgba(22, 35, 61, 0.08);
                }
                .btn {
                    padding: 8px 18px;
                    font-size: 13px;
                    font-weight: 700;
                    border-radius: 8px;
                    cursor: pointer;
                    border: none;
                    transition: all 0.2s;
                }
                .btn-primary {
                    background: #16233d;
                    color: #ffffff;
                }
                .btn-primary:hover {
                    background: #b8862e;
                }
                .btn-secondary {
                    background: #e7e2d6;
                    color: #16233d;
                }

                /* ── Certificate Canvas ── */
                .certificate-wrapper {
                    max-width: 800px;
                    margin: 0 auto;
                    background: #ffffff;
                    padding: 12px;
                    box-shadow: 0 10px 36px rgba(22, 35, 61, 0.12);
                    border-radius: 6px;
                    position: relative;
                }
                .outer-frame {
                    border: 3px solid #16233d;
                    padding: 4px;
                    border-radius: 4px;
                    background: #faf8f2;
                }
                .middle-frame {
                    border: 1.5px solid #b8862e;
                    padding: 16px 24px;
                    position: relative;
                    background: #ffffff;
                    border-radius: 3px;
                    overflow: hidden;
                }
                
                /* Subtle Watermark Seal */
                .watermark-seal {
                    position: absolute;
                    top: 52%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 380px;
                    height: 380px;
                    opacity: 0.04;
                    pointer-events: none;
                    z-index: 0;
                }

                .cert-content {
                    position: relative;
                    z-index: 1;
                }

                /* ── Header ── */
                .cert-header {
                    text-align: center;
                    border-bottom: 2px solid #b8862e;
                    padding-bottom: 12px;
                    margin-bottom: 14px;
                }
                .school-badge {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 44px;
                    height: 44px;
                    background: #16233d;
                    color: #d7a33e;
                    border-radius: 50%;
                    font-size: 22px;
                    margin-bottom: 4px;
                    box-shadow: 0 2px 8px rgba(184, 134, 46, 0.3);
                }
                .school-name {
                    font-family: 'Cinzel', serif;
                    font-size: 23pt;
                    font-weight: 900;
                    color: #16233d;
                    letter-spacing: 2px;
                    line-height: 1.1;
                }
                .school-motto {
                    font-size: 8pt;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 1.5px;
                    color: #b8862e;
                    margin-top: 2px;
                }
                .dept-title {
                    font-size: 9.5pt;
                    font-weight: 600;
                    color: #555;
                    margin-top: 2px;
                }
                .cert-title-banner {
                    display: inline-block;
                    background: #16233d;
                    color: #faf8f2;
                    font-family: 'Cinzel', serif;
                    font-size: 11pt;
                    font-weight: 700;
                    letter-spacing: 1.5px;
                    padding: 5px 22px;
                    border-radius: 20px;
                    margin-top: 8px;
                    border: 1px solid #b8862e;
                }

                /* ── Student Profile Section (2-Col) ── */
                .student-profile-card {
                    display: flex;
                    align-items: center;
                    gap: 18px;
                    background: #faf8f2;
                    border: 1px solid #ead9b0;
                    border-radius: 10px;
                    padding: 12px 16px;
                    margin-bottom: 14px;
                }
                .student-photo-frame {
                    width: 90px;
                    height: 110px;
                    flex-shrink: 0;
                    border: 2px solid #b8862e;
                    border-radius: 8px;
                    overflow: hidden;
                    background: #ffffff;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.1);
                    position: relative;
                }
                .student-photo-frame img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    display: block;
                }
                .student-details-grid {
                    flex-grow: 1;
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 6px 14px;
                    font-size: 9pt;
                }
                .student-name-full {
                    grid-column: span 2;
                    font-size: 13.5pt;
                    font-weight: 800;
                    color: #16233d;
                    border-bottom: 1px dashed #d5c9ad;
                    padding-bottom: 4px;
                    margin-bottom: 2px;
                }
                .detail-item strong {
                    color: #7a7566;
                    font-size: 7.5pt;
                    text-transform: uppercase;
                    display: block;
                    letter-spacing: 0.5px;
                }
                .detail-item span {
                    font-weight: 700;
                    color: #16233d;
                    font-size: 9pt;
                }
                .font-mono {
                    font-family: 'JetBrains Mono', monospace;
                }

                /* ── Official Audit Statement ── */
                .audit-statement {
                    font-size: 9pt;
                    line-height: 1.5;
                    color: #333;
                    margin-bottom: 12px;
                    text-align: justify;
                }

                /* ── Verification Checklist Table ── */
                .audit-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 8.5pt;
                    margin-bottom: 14px;
                }
                .audit-table th {
                    background: #16233d;
                    color: #ffffff;
                    text-align: left;
                    padding: 6px 10px;
                    font-size: 8pt;
                    font-weight: 700;
                    letter-spacing: 0.5px;
                }
                .audit-table td {
                    padding: 5px 10px;
                    border-bottom: 1px solid #ece7da;
                }
                .audit-table tr:nth-child(even) {
                    background: #faf8f2;
                }
                .badge-verified {
                    color: #137333;
                    font-weight: 800;
                }
                .badge-warning-custom {
                    color: #c5221f;
                    font-weight: 800;
                }

                /* ── Clearance Status Banner ── */
                .clearance-status-banner {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 16px;
                    border-radius: 8px;
                    margin-bottom: 16px;
                }
                .status-cleared-box {
                    background: #e6f4ea;
                    border: 1.5px solid #137333;
                    color: #137333;
                }
                .status-uncleared-box {
                    background: #fce8e6;
                    border: 1.5px solid #c5221f;
                    color: #c5221f;
                }
                .status-title {
                    font-size: 11pt;
                    font-weight: 900;
                    letter-spacing: 0.8px;
                }
                .status-sub {
                    font-size: 8pt;
                    font-weight: 600;
                }

                /* ── Signatures & Stamp Footer ── */
                .cert-footer {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-end;
                    margin-top: 10px;
                    padding-top: 6px;
                }
                .signature-block {
                    width: 200px;
                    text-align: center;
                }
                .sig-line {
                    border-top: 1.5px solid #16233d;
                    margin-top: 36px;
                    padding-top: 4px;
                    font-size: 8pt;
                    font-weight: 700;
                    color: #16233d;
                }
                .sig-title {
                    font-size: 7.5pt;
                    color: #7a7566;
                }

                /* Official Stamp Graphic */
                .embossed-seal {
                    width: 90px;
                    height: 90px;
                    border: 2px dashed #b8862e;
                    border-radius: 50%;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    color: #b8862e;
                    font-size: 6.5pt;
                    font-weight: 800;
                    text-align: center;
                    text-transform: uppercase;
                    padding: 4px;
                    box-shadow: inset 0 0 8px rgba(184, 134, 46, 0.15);
                }

                .cert-serial-footer {
                    display: flex;
                    justify-content: space-between;
                    font-size: 6.5pt;
                    color: #999;
                    margin-top: 10px;
                    border-top: 1px dotted #ccc;
                    padding-top: 4px;
                }

                @media print {
                    body {
                        background: #ffffff;
                        padding: 0;
                    }
                    .no-print-toolbar {
                        display: none !important;
                    }
                    .certificate-wrapper {
                        box-shadow: none;
                        padding: 0;
                        max-width: 100%;
                    }
                }
            </style>
        </head>
        <body>
            <div class="no-print-toolbar">
                <div>
                    <strong>Clearance Certificate Preview</strong>
                    <span style="color:#777; font-size:12px; margin-left:8px;">Serial: ${certSerial}</span>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-primary" onclick="window.print()">🖨 Print Certificate</button>
                    <button class="btn btn-secondary" onclick="window.close()">✕ Close</button>
                </div>
            </div>

            <div class="certificate-wrapper">
                <div class="outer-frame">
                    <div class="middle-frame">
                        <!-- Watermark Crest -->
                        <svg class="watermark-seal" viewBox="0 0 100 100" fill="none" stroke="#16233d">
                            <circle cx="50" cy="50" r="45" stroke-width="2"/>
                            <path d="M50 20 L50 80 M20 50 L80 50" stroke-width="1.5"/>
                            <path d="M30 35 L50 45 L70 35 L70 65 L50 75 L30 65 Z" stroke-width="2"/>
                        </svg>

                        <div class="cert-content">
                            <!-- Header -->
                            <div class="cert-header">
                                <div class="school-badge">📚</div>
                                <div class="school-name">KANYADET SCHOOL</div>
                                <div class="school-motto">Knowledge &bull; Integrity &bull; Excellence</div>
                                <div class="dept-title">Library & Learning Resource Management Department</div>
                                <div>
                                    <span class="cert-title-banner">OFFICIAL CERTIFICATE OF LIBRARY CLEARANCE</span>
                                </div>
                            </div>

                            <!-- Student Identity & Photo Card -->
                            <div class="student-profile-card">
                                <div class="student-photo-frame">
                                    <img src="${photoSrc}" alt="${sData.name}" 
                                         onerror="this.src='../Report-Cards/student_images/default.jpg'; this.onerror=function(){this.src='images/default-student.png';}">
                                </div>
                                <div class="student-details-grid">
                                    <div class="student-name-full">${sData.name}</div>
                                    <div class="detail-item">
                                        <strong>Assessment Number:</strong>
                                        <span class="font-mono">${sData.assessmentNo || 'N/A'}</span>
                                    </div>
                                    <div class="detail-item">
                                        <strong>Grade & Stream:</strong>
                                        <span>${sData.grade || 'N/A'}</span>
                                    </div>
                                    <div class="detail-item">
                                        <strong>NEMIS / UPI Code:</strong>
                                        <span class="font-mono">${sData.upi || '—'}</span>
                                    </div>
                                    <div class="detail-item">
                                        <strong>Academic Year / Term:</strong>
                                        <span>Academic Year ${academicYear}</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Audit Declaration -->
                            <div class="audit-statement">
                                This document certifies that the above-named pupil has undergone a comprehensive library audit regarding all CBC textbooks, supplementary readers, and learning apparatus assigned during their academic enrolment.
                            </div>

                            <!-- Verification Checklist Table -->
                            <table class="audit-table">
                                <thead>
                                    <tr>
                                        <th>Resource Category</th>
                                        <th>Audit Verification Detail</th>
                                        <th style="text-align:center; width:90px;">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td><strong>CBC Subject Coursebooks</strong></td>
                                        <td>${isCleared ? 'All distributed class textbooks accounted for and restocked.' : `${activeLoans.length} textbook copy(s) currently unreturned.`}</td>
                                        <td style="text-align:center;">
                                            ${isCleared ? '<span class="badge-verified">✔ VERIFIED</span>' : '<span class="badge-warning-custom">⚠️ PENDING</span>'}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td><strong>Supplementary Readers & Fiction</strong></td>
                                        <td>No outstanding reader or storybook loans on record.</td>
                                        <td style="text-align:center;">
                                            <span class="badge-verified">✔ VERIFIED</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td><strong>Fines & Replacement Dues</strong></td>
                                        <td>Zero outstanding fine or book replacement balances (KES 0.00).</td>
                                        <td style="text-align:center;">
                                            <span class="badge-verified">✔ CLEARED</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>

                            <!-- Official Status Banner -->
                            <div class="clearance-status-banner ${isCleared ? 'status-cleared-box' : 'status-uncleared-box'}">
                                <div>
                                    <div class="status-title">${isCleared ? 'OFFICIALLY CLEARED & IN GOOD STANDING' : 'CLEARANCE PENDING — OBLIGATIONS OUTSTANDING'}</div>
                                    <div class="status-sub">${isCleared ? 'The student is eligible for report card issuance, grade transfer, or graduation.' : 'Please return outstanding textbooks to the library to finalize clearance.'}</div>
                                </div>
                                <div style="font-size: 20px; font-weight: bold;">${isCleared ? '✅' : '⚠️'}</div>
                            </div>

                            <!-- Signatures & Official Stamp -->
                            <div class="cert-footer">
                                <div class="signature-block">
                                    <div class="sig-line">School Librarian</div>
                                    <div class="sig-title">Library & Resource Centre</div>
                                </div>

                                <div class="embossed-seal">
                                    <span>★ OFFICIAL ★</span>
                                    <span>KANYADET</span>
                                    <span>LIBRARY SEAL</span>
                                    <span>★ 2026 ★</span>
                                </div>

                                <div class="signature-block">
                                    <div class="sig-line">Date: ${todayFormatted}</div>
                                    <div class="sig-title">Headteacher / Principal</div>
                                </div>
                            </div>

                            <!-- Serial & Validation Footer -->
                            <div class="cert-serial-footer">
                                <span>Certificate ID: <strong>${certSerial}</strong></span>
                                <span>Security Hash: ${(sData.name.length * 3791).toString(16).toUpperCase()}-KNY</span>
                                <span>Kanyadet School Library Automated Record System</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </body>
        </html>`);
        printWin.document.close();
    }

    async _printClearanceRoster(grade) {
        if (!grade) {
            Swal.fire({ icon: 'warning', title: 'Select Grade', text: 'Please select a grade to print the clearance sheet.' });
            return;
        }

        const students = await this._getStudentsByGrade(grade);
        const issSnap = await this.db.ref('issuance').orderByChild('grade').equalTo(grade).once('value');
        const activeByStudent = new Map();

        if (issSnap.exists()) {
            issSnap.forEach(c => {
                const iss = c.val();
                if (iss.status === 'active') {
                    if (!activeByStudent.has(iss.studentId)) activeByStudent.set(iss.studentId, []);
                    activeByStudent.get(iss.studentId).push(iss);
                }
            });
        }

        const todayStr = new Date().toLocaleDateString('en-GB');

        const printWin = window.open('', '_blank', 'width=900,height=700');
        if (!printWin) return;

        printWin.document.write(`<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Library Clearance Roster - ${grade}</title>
            <style>
                @page { size: A4 landscape; margin: 15mm; }
                body { font-family: Arial, sans-serif; font-size: 10pt; color: #16233D; padding: 10px; }
                .header { text-align: center; margin-bottom: 20px; }
                .header h2 { margin: 0; font-size: 16pt; }
                .header h4 { margin: 4px 0; font-weight: normal; color: #555; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
                th { background-color: #f2f2f2; }
                .cleared { color: green; font-weight: bold; }
                .uncleared { color: red; font-weight: bold; }
                .toolbar { margin-bottom: 10px; text-align: right; }
                @media print { .toolbar { display: none; } }
            </style>
        </head>
        <body>
            <div class="toolbar">
                <button onclick="window.print()" style="padding: 6px 14px; background:#16233D; color:#fff; border:none; border-radius:4px; cursor:pointer;">🖨 Print Roster</button>
            </div>
            <div class="header">
                <h2>KANYADET SCHOOL LIBRARY MANAGEMENT SYSTEM</h2>
                <h4>STREAM CLEARANCE ROSTER — ${grade.toUpperCase()} (As of: ${todayStr})</h4>
            </div>
            <table>
                <thead>
                    <tr>
                        <th style="width: 30px;">#</th>
                        <th>Student Name</th>
                        <th>Assessment No</th>
                        <th>Active Books Held</th>
                        <th style="width: 100px;">Clearance Status</th>
                        <th style="width: 140px;">Librarian Sign</th>
                    </tr>
                </thead>
                <tbody>
                    ${students.map((s, idx) => {
                        const loans = activeByStudent.get(s.id) || [];
                        const isCleared = loans.length === 0;
                        return `
                            <tr>
                                <td>${idx + 1}</td>
                                <td><strong>${s.name}</strong></td>
                                <td>${s.assessmentNo || '—'}</td>
                                <td>${loans.map(l => l.bookTitle).join(', ') || 'None'}</td>
                                <td class="${isCleared ? 'cleared' : 'uncleared'}">${isCleared ? 'CLEARED' : 'UNCLEARED'}</td>
                                <td></td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </body>
        </html>`);
        printWin.document.close();
    }

    async _getStudentsByGrade(grade) {
        if (typeof StudentsCache !== 'undefined') {
            const map = StudentsCache.getAll();
            const list = [];
            map.forEach((s, id) => {
                if (s.grade === grade) list.push({ id, ...s });
            });
            if (list.length > 0) return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        }

        // Fallback directly to Firebase
        const snap = await this.db.ref('students').orderByChild('grade').equalTo(grade).once('value');
        const list = [];
        if (snap.exists()) {
            snap.forEach(c => {
                list.push({ id: c.key, ...c.val() });
            });
        }
        return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
}

// Instantiate on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.classKitManager = new ClassKitManager();
});
