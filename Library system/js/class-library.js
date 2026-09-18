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
//
// v3:
//   - status filter (All / Overdue / Due soon / Active-not-due) alongside
//     the existing free-text search, instead of relying on sort order alone
//     to surface overdue books
//   - student photo avatars in the Student column. This app has no photo
//     pipeline of its own (studentOverview's .student-avatar-large is a
//     static Bootstrap icon, never a real image), so this file carries its
//     own small image loader rather than assuming one exists. It tries a
//     handful of relative paths — library.html is one level below the site
//     root ("Library system/library.html"), so both "../" and "./" bases
//     are tried — and falls back to initials silently if nothing resolves,
//     exactly like the rest of this app degrades when data is missing.
class ClassLibraryView {
    static PAGE_SIZE = 15;
    static DEBOUNCE_MS = 200;

    // Tried in order for every student photo lookup. Grade is normalized to
    // "Grade N" (stripping any stream suffix like "Grade 4 Blue") since
    // that's the folder convention the main admin portal's photo uploads
    // already use.
    static PHOTO_BASES = [
        '../Report-Cards/student_images/',
        './Report-Cards/student_images/',
        '../student_images/',
        './student_images/',
    ];

    constructor() {
        this.db = db;
        this.pageSize = ClassLibraryView.PAGE_SIZE;

        this.state = {
            grade: '',
            search: '',
            statusFilter: 'all',  // 'all' | 'overdue' | 'due7' | 'active'
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

        this._injectStyles();
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
            const daysUntilDue = (!overdue && dueDate)
                ? Math.ceil((dueDate - today) / 86400000)
                : null;

            rows.push({
                ...issuance,
                id: child.key,
                overdue,
                daysOverdue,
                daysUntilDue,
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

        if (this.state.statusFilter === 'overdue') {
            rows = rows.filter(r => r.overdue);
        } else if (this.state.statusFilter === 'due7') {
            rows = rows.filter(r => !r.overdue && r.daysUntilDue != null && r.daysUntilDue <= 7);
        } else if (this.state.statusFilter === 'active') {
            rows = rows.filter(r => !r.overdue && !(r.daysUntilDue != null && r.daysUntilDue <= 7));
        }

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
        const due7Count = allRows.filter(r => !r.overdue && r.daysUntilDue != null && r.daysUntilDue <= 7).length;
        const totalPages = Math.max(1, Math.ceil(visible.length / this.pageSize));
        this.state.page = Math.min(this.state.page, totalPages);
        const start = (this.state.page - 1) * this.pageSize;
        const pageRows = visible.slice(start, start + this.pageSize);

        const sortIndicator = (key) => {
            if (this.state.sortKey !== key) return '';
            return this.state.sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
        };

        const statusOption = (value, label) =>
            `<option value="${value}" ${this.state.statusFilter === value ? 'selected' : ''}>${label}</option>`;

        container.innerHTML = `
            <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                <div>
                    <span class="badge bg-primary me-2">${allRows.length} book(s) out</span>
                    <span class="badge ${overdueCount ? 'bg-danger' : 'bg-success'} me-2">${overdueCount} overdue</span>
                    <span class="badge bg-warning text-dark">${due7Count} due within 7d</span>
                    ${visible.length !== allRows.length
                        ? `<span class="text-muted ms-2 small">(${visible.length} match filter)</span>`
                        : ''}
                </div>
                <div class="d-flex gap-2 flex-wrap">
                    <select id="classLibraryStatusFilter" class="form-select form-select-sm" style="width:170px" aria-label="Filter by status">
                        ${statusOption('all', 'All active loans')}
                        ${statusOption('overdue', 'Overdue only')}
                        ${statusOption('due7', 'Due within 7 days')}
                        ${statusOption('active', 'Not due soon')}
                    </select>
                    <input type="search" id="classLibrarySearch" class="form-control form-control-sm"
                           style="width:220px" placeholder="Search student or book…"
                           value="${this._esc(this.state.search)}" aria-label="Search class library">
                    <button type="button" class="btn btn-sm btn-outline-secondary" id="classLibraryExport">
                        Export CSV
                    </button>
                </div>
            </div>

            ${visible.length === 0
                ? `<p class="text-muted">No results match the current search/filter.</p>`
                : `
                <div class="table-responsive">
                    <table class="table table-sm align-middle" aria-describedby="classLibraryList">
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
                                    <td>${this._studentCellHtml(r)}</td>
                                    <td>${this._esc(r.bookTitle) || 'N/A'}</td>
                                    <td>${this._esc(r.issueDate) || ''}</td>
                                    <td>${this._esc(r.returnDate) || ''}</td>
                                    <td>${r.overdue
                                        ? `Overdue (${r.daysOverdue}d)`
                                        : (r.daysUntilDue != null && r.daysUntilDue <= 7
                                            ? `Due in ${r.daysUntilDue}d`
                                            : 'Active')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                ${this._paginationHtml(this.state.page, totalPages)}
                `}
        `;

        this._wireInteractions(container);
        this._hydratePhotos(container);
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

        const statusSelect = document.getElementById('classLibraryStatusFilter');
        if (statusSelect) {
            statusSelect.addEventListener('change', (e) => {
                this.state.statusFilter = e.target.value;
                this.state.page = 1;
                this.render();
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
    // Student photo avatars
    // ---------------------------------------------------------------------
    // Self-contained: no shared cache or helper exists elsewhere in this app
    // to lean on, so this loads/caches its own images. Renders initials
    // instantly (synchronously, in the row markup) and swaps in a real photo
    // a moment later if one resolves — never blocks or delays the table.

    _injectStyles() {
        if (document.querySelector('style#class-library-avatar-styles')) return;
        const style = document.createElement('style');
        style.id = 'class-library-avatar-styles';
        style.textContent = `
            .cl-av-wrap {
                position: relative; overflow: hidden; flex-shrink: 0;
                width: 28px; height: 28px; border-radius: 8px;
                display: flex; align-items: center; justify-content: center;
                background: linear-gradient(135deg, #f39c12, #f1c40f);
                color: #fff; font-weight: 800; font-size: 11px;
            }
            .cl-av-wrap img {
                position: absolute; inset: 0; width: 100%; height: 100%;
                object-fit: cover;
            }
            .cl-av-wrap.has-photo { cursor: zoom-in; }
            .cl-student-cell { display: flex; align-items: center; gap: 8px; }
            #classLibraryPhotoLightbox {
                display: none; position: fixed; inset: 0; z-index: 2000;
                background: rgba(0,0,0,.5); backdrop-filter: blur(6px);
                align-items: center; justify-content: center; cursor: zoom-out;
            }
            #classLibraryPhotoLightbox img {
                max-width: min(85vw, 420px); max-height: 75vh;
                border-radius: 12px; box-shadow: 0 12px 36px rgba(0,0,0,.5);
                background: #fff;
            }
        `;
        document.head.appendChild(style);
    }

    _initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return '?';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    _normalizedGrade(grade) {
        return String(grade || '').match(/Grade\s*\d+/i)?.[0] || grade || '';
    }

    _loadImg(src) {
        this._imgCache = this._imgCache || {};
        if (this._imgCache[src] !== undefined) return Promise.resolve(this._imgCache[src]);
        return new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const timer = setTimeout(() => { this._imgCache[src] = null; resolve(null); }, 2000);
            img.onload = () => { clearTimeout(timer); this._imgCache[src] = img.src; resolve(img.src); };
            img.onerror = () => { clearTimeout(timer); this._imgCache[src] = null; resolve(null); };
            img.src = src;
        });
    }

    async _resolveStudentPhoto(name, grade) {
        const g = this._normalizedGrade(grade);
        const cleanName = String(name || '').trim();
        if (!cleanName) return null;
        const encGrade = encodeURIComponent(g);
        const encName = encodeURIComponent(cleanName);

        const candidates = [];
        ClassLibraryView.PHOTO_BASES.forEach(base => {
            candidates.push(`${base}${g}/${cleanName}.jpg`);
            candidates.push(`${base}${encGrade}/${encName}.jpg`);
        });

        for (const src of candidates) {
            const resolved = await this._loadImg(src);
            if (resolved) return resolved;
        }
        return null;
    }

    // Synchronous placeholder markup for a row — initials, tagged with a
    // unique id so the async photo swap below can find it after render.
    _studentCellHtml(row) {
        const uid = 'cl_av_' + row.id.replace(/[^a-zA-Z0-9]/g, '') + '_' + Math.random().toString(36).slice(2, 6);
        return `
            <div class="cl-student-cell">
                <div class="cl-av-wrap" id="${uid}" data-student="${this._esc(row.studentName || '')}" data-grade="${this._esc(row.grade || '')}">
                    ${this._esc(this._initials(row.studentName))}
                </div>
                <span>${this._esc(row.studentName) || 'N/A'}</span>
            </div>`;
    }

    // Called once per render, after the table is in the DOM: resolves every
    // visible row's photo in parallel and swaps it in if found. Deliberately
    // scoped to `container` (the current page of rows only), so paging
    // never triggers lookups for rows that aren't on screen.
    _hydratePhotos(container) {
        const wraps = container.querySelectorAll('.cl-av-wrap[id]');
        wraps.forEach(async (el) => {
            const name = el.getAttribute('data-student');
            const grade = el.getAttribute('data-grade');
            if (!name) return;
            const src = await this._resolveStudentPhoto(name, grade);
            // The table may have re-rendered (search/sort/page) while this
            // was in flight — bail if this element is no longer attached.
            if (!src || !document.body.contains(el)) return;
            let img = el.querySelector('img');
            if (!img) {
                img = document.createElement('img');
                img.loading = 'lazy';
                img.alt = name;
                el.textContent = '';
                el.appendChild(img);
            }
            img.src = src;
            el.classList.add('has-photo');
            el.title = `${name} — click to view photo`;
            el.onclick = () => this._openPhotoLightbox(src, name, grade);
        });
    }

    _openPhotoLightbox(src, name, grade) {
        let lb = document.getElementById('classLibraryPhotoLightbox');
        if (!lb) {
            lb = document.createElement('div');
            lb.id = 'classLibraryPhotoLightbox';
            lb.innerHTML = `
                <figure style="margin:0;text-align:center" onclick="event.stopPropagation()">
                    <img id="classLibraryPhotoLightboxImg" src="" alt="">
                    <figcaption id="classLibraryPhotoLightboxCaption" style="color:#fff;margin-top:10px;font-weight:600;font-size:13px"></figcaption>
                </figure>`;
            lb.addEventListener('click', () => { lb.style.display = 'none'; });
            document.body.appendChild(lb);
        }
        lb.querySelector('#classLibraryPhotoLightboxImg').src = src;
        lb.querySelector('#classLibraryPhotoLightboxImg').alt = name || '';
        lb.querySelector('#classLibraryPhotoLightboxCaption').textContent =
            [name, grade].filter(Boolean).join(' — ');
        lb.style.display = 'flex';
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