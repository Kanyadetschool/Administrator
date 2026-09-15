// Class Library View
// -------------------------------------------------------------------------
// Read-only per-grade view of who currently has which book out, and who's
// overdue — the "Class Library" panel noted as still-pending in the
// Teachers Portal integration plan. Built here first (against the
// StudentsCache + issuance data this admin app already keeps in sync) as
// a standalone module so the same rendering logic can be lifted into
// Teachers Portal / Parent Portal later without re-deriving the queries.
//
// v2 — hardened for production use:
//   - live RTDB listener (auto-updates) instead of one-shot snapshot
//   - HTML-escaped output (issuance data is user-entered; raw interpolation
//     into innerHTML was an XSS hole)
//   - search/filter, sortable columns, days-overdue calc
//   - client-side pagination so a full-grade roster doesn't render as one
//     giant table
//   - CSV export
//   - defensive error/empty/loading states, listener cleanup on teardown
class ClassLibraryView {
    static PAGE_SIZE = 15;
    static DEBOUNCE_MS = 200;

    constructor() {
        this.db = db;
        this.pageSize = ClassLibraryView.PAGE_SIZE;

        this.state = {
            grade: '',
            search: '',
            sortKey: 'overdue',   // 'overdue' | 'student' | 'book' | 'due'
            sortDir: 'desc',
            page: 1,
            rows: [],
            status: 'idle',       // 'idle' | 'loading' | 'ready' | 'error'
            error: null,
        };

        this._issuanceRef = null;
        this._onIssuanceChange = null;
        this._searchDebounce = null;

        this.setupUI();
    }

    // ---------------------------------------------------------------------
    // Setup / teardown
    // ---------------------------------------------------------------------

    setupUI() {
        const gradeSelect = document.getElementById('classLibraryGrade');
        if (gradeSelect) {
            gradeSelect.addEventListener('change', () => {
                this.state.grade = gradeSelect.value;
                this.state.page = 1;
                this.subscribe();
            });
        }

        document.querySelectorAll('.nav-links li[data-page="classLibrary"]').forEach(li => {
            li.addEventListener('click', () => {
                // Re-attach the live listener each time the panel is opened,
                // in case it was torn down while navigating elsewhere.
                if (gradeSelect && gradeSelect.value) {
                    this.state.grade = gradeSelect.value;
                    this.subscribe();
                } else {
                    this.renderShell();
                }
            });
        });

        // Detach the RTDB listener if the page is being unloaded, to avoid
        // leaking a callback against a stale DOM.
        window.addEventListener('beforeunload', () => this.teardown());
    }

    teardown() {
        if (this._issuanceRef && this._onIssuanceChange) {
            this._issuanceRef.off('value', this._onIssuanceChange);
        }
        this._issuanceRef = null;
        this._onIssuanceChange = null;
    }

    // ---------------------------------------------------------------------
    // Data
    // ---------------------------------------------------------------------

    subscribe() {
        this.teardown();

        const container = document.getElementById('classLibraryList');
        if (!container) return;

        if (!this.state.grade) {
            this.state.status = 'idle';
            this.renderShell();
            return;
        }

        this.state.status = 'loading';
        this.renderShell();

        this._issuanceRef = this.db.ref('issuance');
        this._onIssuanceChange = (snapshot) => {
            try {
                this.state.rows = this._deriveRows(snapshot, this.state.grade);
                this.state.status = 'ready';
                this.state.error = null;
            } catch (err) {
                console.error('ClassLibraryView: failed to process issuance snapshot', err);
                this.state.status = 'error';
                this.state.error = err;
            }
            this.renderShell();
        };
        const onError = (err) => {
            console.error('ClassLibraryView: issuance listener error', err);
            this.state.status = 'error';
            this.state.error = err;
            this.renderShell();
        };

        this._issuanceRef.on('value', this._onIssuanceChange, onError);
    }

    _deriveRows(snapshot, grade) {
        const today = new Date();
        const rows = [];

        snapshot.forEach(child => {
            const issuance = child.val();
            if (!issuance || issuance.status !== 'active') return;
            if (issuance.grade !== grade) return; // issuance already stores the student's grade at issue time

            const dueDate = this._parseDate(issuance.returnDate);
            const overdue = !!dueDate && dueDate < today;
            const daysOverdue = overdue ? Math.floor((today - dueDate) / 86400000) : 0;

            rows.push({
                ...issuance,
                id: child.key,
                overdue,
                daysOverdue,
                _dueSortValue: dueDate ? dueDate.getTime() : Number.POSITIVE_INFINITY,
            });
        });

        return rows;
    }

    _parseDate(value) {
        if (!value) return null;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    // ---------------------------------------------------------------------
    // Derived view (filter + sort + paginate)
    // ---------------------------------------------------------------------

    _getVisibleRows() {
        const q = this.state.search.trim().toLowerCase();
        let rows = this.state.rows;

        if (q) {
            rows = rows.filter(r => {
                const student = (r.studentName || '').toLowerCase();
                const book = (r.bookTitle || '').toLowerCase();
                return student.includes(q) || book.includes(q);
            });
        }

        const dir = this.state.sortDir === 'asc' ? 1 : -1;
        const sorted = [...rows].sort((a, b) => {
            switch (this.state.sortKey) {
                case 'student':
                    return dir * (a.studentName || '').localeCompare(b.studentName || '');
                case 'book':
                    return dir * (a.bookTitle || '').localeCompare(b.bookTitle || '');
                case 'due':
                    return dir * (a._dueSortValue - b._dueSortValue);
                case 'overdue':
                default:
                    // Overdue first (or last, if dir flipped), then by days
                    // overdue descending, then by student name for stability.
                    if (a.overdue !== b.overdue) return dir * (b.overdue - a.overdue);
                    if (a.daysOverdue !== b.daysOverdue) return dir * (b.daysOverdue - a.daysOverdue);
                    return (a.studentName || '').localeCompare(b.studentName || '');
            }
        });

        return sorted;
    }

    // ---------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------

    renderShell() {
        const container = document.getElementById('classLibraryList');
        if (!container) return;

        if (this.state.status === 'idle') {
            container.innerHTML = `<p class="text-muted">Select a grade to see its active and overdue books.</p>`;
            return;
        }

        if (this.state.status === 'loading') {
            container.innerHTML = this._skeletonHtml();
            return;
        }

        if (this.state.status === 'error') {
            container.innerHTML = `
                <div class="alert alert-danger d-flex justify-content-between align-items-center" role="alert">
                    <span>Couldn't load the class library right now. ${this._esc(this.state.error?.message || '')}</span>
                    <button type="button" class="btn btn-sm btn-outline-danger" id="classLibraryRetry">Retry</button>
                </div>`;
            const retryBtn = document.getElementById('classLibraryRetry');
            if (retryBtn) retryBtn.addEventListener('click', () => this.subscribe());
            return;
        }

        this.render();
    }

    render() {
        const container = document.getElementById('classLibraryList');
        if (!container) return;

        const grade = this.state.grade;
        const allRows = this.state.rows;
        const visible = this._getVisibleRows();

        if (allRows.length === 0) {
            container.innerHTML = `<p class="text-muted">No books currently out for ${this._esc(grade)}.</p>`;
            return;
        }

        const overdueCount = allRows.filter(r => r.overdue).length;
        const totalPages = Math.max(1, Math.ceil(visible.length / this.pageSize));
        this.state.page = Math.min(this.state.page, totalPages);
        const start = (this.state.page - 1) * this.pageSize;
        const pageRows = visible.slice(start, start + this.pageSize);

        const sortIndicator = (key) => {
            if (this.state.sortKey !== key) return '';
            return this.state.sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
        };

        container.innerHTML = `
            <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                <div>
                    <span class="badge bg-primary me-2">${allRows.length} book(s) out</span>
                    <span class="badge ${overdueCount ? 'bg-danger' : 'bg-success'}">${overdueCount} overdue</span>
                    ${visible.length !== allRows.length
                        ? `<span class="text-muted ms-2 small">(${visible.length} match filter)</span>`
                        : ''}
                </div>
                <div class="d-flex gap-2">
                    <input type="search" id="classLibrarySearch" class="form-control form-control-sm"
                           style="width:220px" placeholder="Search student or book…"
                           value="${this._esc(this.state.search)}" aria-label="Search class library">
                    <button type="button" class="btn btn-sm btn-outline-secondary" id="classLibraryExport">
                        Export CSV
                    </button>
                </div>
            </div>

            ${visible.length === 0
                ? `<p class="text-muted">No results match "${this._esc(this.state.search)}".</p>`
                : `
                <div class="table-responsive">
                    <table class="table table-sm" aria-describedby="classLibraryList">
                        <thead>
                            <tr>
                                <th scope="col" role="button" data-sort="student" style="cursor:pointer">Student${sortIndicator('student')}</th>
                                <th scope="col" role="button" data-sort="book" style="cursor:pointer">Book${sortIndicator('book')}</th>
                                <th scope="col">Issued</th>
                                <th scope="col" role="button" data-sort="due" style="cursor:pointer">Due${sortIndicator('due')}</th>
                                <th scope="col" role="button" data-sort="overdue" style="cursor:pointer">Status${sortIndicator('overdue')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pageRows.map(r => `
                                <tr class="${r.overdue ? 'table-danger' : ''}">
                                    <td>${this._esc(r.studentName) || 'N/A'}</td>
                                    <td>${this._esc(r.bookTitle) || 'N/A'}</td>
                                    <td>${this._esc(r.issueDate) || ''}</td>
                                    <td>${this._esc(r.returnDate) || ''}</td>
                                    <td>${r.overdue
                                        ? `Overdue (${r.daysOverdue}d)`
                                        : 'Active'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                ${this._paginationHtml(this.state.page, totalPages)}
                `}
        `;

        this._wireInteractions(container);
    }

    _wireInteractions(container) {
        const searchInput = document.getElementById('classLibrarySearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const value = e.target.value;
                clearTimeout(this._searchDebounce);
                this._searchDebounce = setTimeout(() => {
                    this.state.search = value;
                    this.state.page = 1;
                    this.render();
                    // Restore focus/cursor position after re-render.
                    const el = document.getElementById('classLibrarySearch');
                    if (el) {
                        el.focus();
                        el.setSelectionRange(el.value.length, el.value.length);
                    }
                }, ClassLibraryView.DEBOUNCE_MS);
            });
        }

        container.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.getAttribute('data-sort');
                if (this.state.sortKey === key) {
                    this.state.sortDir = this.state.sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    this.state.sortKey = key;
                    this.state.sortDir = key === 'overdue' ? 'desc' : 'asc';
                }
                this.render();
            });
        });

        const exportBtn = document.getElementById('classLibraryExport');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this._exportCsv());
        }

        container.querySelectorAll('[data-page-btn]').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.getAttribute('data-page-btn');
                const totalPages = Math.max(1, Math.ceil(this._getVisibleRows().length / this.pageSize));
                if (target === 'prev') this.state.page = Math.max(1, this.state.page - 1);
                else if (target === 'next') this.state.page = Math.min(totalPages, this.state.page + 1);
                this.render();
            });
        });
    }

    _paginationHtml(page, totalPages) {
        if (totalPages <= 1) return '';
        return `
            <div class="d-flex justify-content-between align-items-center mt-2">
                <button type="button" class="btn btn-sm btn-outline-secondary" data-page-btn="prev" ${page <= 1 ? 'disabled' : ''}>
                    Prev
                </button>
                <span class="text-muted small">Page ${page} of ${totalPages}</span>
                <button type="button" class="btn btn-sm btn-outline-secondary" data-page-btn="next" ${page >= totalPages ? 'disabled' : ''}>
                    Next
                </button>
            </div>`;
    }

    _skeletonHtml() {
        const line = () => `<div class="placeholder-glow mb-2"><span class="placeholder col-12"></span></div>`;
        return `<div aria-live="polite" aria-busy="true">${line()}${line()}${line()}</div>`;
    }

    // ---------------------------------------------------------------------
    // Export
    // ---------------------------------------------------------------------

    _exportCsv() {
        const rows = this._getVisibleRows();
        if (rows.length === 0) return;

        const headers = ['Student', 'Book', 'Issued', 'Due', 'Status', 'Days Overdue'];
        const csvEscape = (val) => {
            const s = String(val ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };

        const lines = [
            headers.join(','),
            ...rows.map(r => [
                r.studentName || '',
                r.bookTitle || '',
                r.issueDate || '',
                r.returnDate || '',
                r.overdue ? 'Overdue' : 'Active',
                r.overdue ? r.daysOverdue : 0,
            ].map(csvEscape).join(',')),
        ];

        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const gradeSlug = (this.state.grade || 'class').replace(/[^a-z0-9]+/gi, '-');
        a.href = url;
        a.download = `class-library-${gradeSlug}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    // ---------------------------------------------------------------------
    // Utils
    // ---------------------------------------------------------------------

    _esc(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.classLibraryView = new ClassLibraryView();
});