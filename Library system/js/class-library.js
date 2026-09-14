// Class Library View
// -------------------------------------------------------------------------
// Read-only per-grade view of who currently has which book out, and who's
// overdue — the "Class Library" panel noted as still-pending in the
// Teachers Portal integration plan. Built here first (against the
// StudentsCache + issuance data this admin app already keeps in sync) as
// a standalone module so the same rendering logic can be lifted into
// Teachers Portal / Parent Portal later without re-deriving the queries.
class ClassLibraryView {
    constructor() {
        this.db = db;
        this.setupUI();
    }

    setupUI() {
        const gradeSelect = document.getElementById('classLibraryGrade');
        if (gradeSelect) {
            gradeSelect.addEventListener('change', () => this.render());
        }
        document.querySelectorAll('.nav-links li[data-page="classLibrary"]').forEach(li => {
            li.addEventListener('click', () => this.render());
        });
    }

    async render() {
        const gradeSelect = document.getElementById('classLibraryGrade');
        const container = document.getElementById('classLibraryList');
        if (!gradeSelect || !container) return;

        const grade = gradeSelect.value;
        if (!grade) {
            container.innerHTML = '<p class="text-muted">Select a grade to see its active and overdue books.</p>';
            return;
        }

        container.innerHTML = '<p class="text-muted">Loading…</p>';

        const snapshot = await this.db.ref('issuance').once('value');
        const today = new Date();
        const rows = [];

        snapshot.forEach(child => {
            const issuance = child.val();
            if (issuance.status !== 'active') return;
            if (issuance.grade !== grade) return; // issuance already stores the student's grade at issue time
            const dueDate = new Date(issuance.returnDate);
            const overdue = dueDate < today;
            rows.push({ ...issuance, id: child.key, overdue });
        });

        if (rows.length === 0) {
            container.innerHTML = `<p class="text-muted">No books currently out for ${grade}.</p>`;
            return;
        }

        rows.sort((a, b) => (a.overdue === b.overdue ? 0 : a.overdue ? -1 : 1));

        const overdueCount = rows.filter(r => r.overdue).length;

        container.innerHTML = `
            <div class="mb-3">
                <span class="badge bg-primary me-2">${rows.length} book(s) out</span>
                <span class="badge ${overdueCount ? 'bg-danger' : 'bg-success'}">${overdueCount} overdue</span>
            </div>
            <div class="table-responsive">
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Student</th>
                            <th>Book</th>
                            <th>Issued</th>
                            <th>Due</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr class="${r.overdue ? 'table-danger' : ''}">
                                <td>${r.studentName || 'N/A'}</td>
                                <td>${r.bookTitle || 'N/A'}</td>
                                <td>${r.issueDate || ''}</td>
                                <td>${r.returnDate || ''}</td>
                                <td>${r.overdue ? 'Overdue' : 'Active'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.classLibraryView = new ClassLibraryView();
});
