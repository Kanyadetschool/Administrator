// Term Report
// -------------------------------------------------------------------------
// One printable PDF that pulls together numbers already computed
// separately across the dashboard (Monthly Statistics, Leaderboard,
// Low Stock banner, Lost Books cost summary, Fines) instead of the head
// teacher having to open five different panels. Reads the same nodes
// those features already read (issuance, books, fines) — no new writes,
// no changes to app.js/functions.js. Reuses window.jspdf, already loaded
// for exportToPdfEnhanced.
(function () {
    const db = () => window.db || firebase.database();

    function currency(n) {
        return 'KES ' + Number(n || 0).toLocaleString();
    }

    // ---- Button injection --------------------------------------------

    function injectButton() {
        const exportBtn = document.getElementById('exportAnalyticsBtn');
        if (!exportBtn || document.getElementById('generateTermReportBtn')) return;
        const btn = document.createElement('button');
        btn.id = 'generateTermReportBtn';
        btn.className = exportBtn.className;
        btn.title = 'Generate a full term summary report';
        btn.innerHTML = '<i class="bi bi-file-earmark-text"></i> Term Report';
        exportBtn.insertAdjacentElement('afterend', btn);
        btn.addEventListener('click', promptAndGenerate);
    }

    async function promptAndGenerate() {
        const today = new Date();
        const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
        const toStr = today.toISOString().split('T')[0];
        const fromStr = defaultFrom.toISOString().split('T')[0];

        const { value: formValues } = await Swal.fire({
            title: 'Generate Term Report',
            html: `
                <div class="mb-2 text-start">
                    <label class="form-label">From</label>
                    <input type="date" id="termReportFrom" class="swal2-input" value="${fromStr}">
                </div>
                <div class="text-start">
                    <label class="form-label">To</label>
                    <input type="date" id="termReportTo" class="swal2-input" value="${toStr}">
                </div>`,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Generate',
            preConfirm: () => ({
                from: document.getElementById('termReportFrom').value,
                to: document.getElementById('termReportTo').value
            })
        });
        if (!formValues || !formValues.from || !formValues.to) return;

        Swal.fire({ title: 'Building report...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        try {
            await generateReport(formValues.from, formValues.to);
            Swal.close();
        } catch (error) {
            console.error('Term report error:', error);
            Swal.fire('Error', 'Failed to generate report: ' + error.message, 'error');
        }
    }

    // ---- Data assembly --------------------------------------------------

    async function gatherData(from, to) {
        const [issuanceSnap, booksSnap, finesSnap] = await Promise.all([
            db().ref('issuance').once('value'),
            db().ref('books').once('value'),
            db().ref('fines').once('value').catch(() => null)
        ]);

        const books = {};
        booksSnap.forEach(c => { books[c.key] = c.val(); });

        const fromTime = new Date(from).getTime();
        const toTime = new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1;

        let issuedInRange = 0, returnedInRange = 0, durations = [];
        let overdueNow = 0, activeNow = 0;
        const studentCounts = {}, bookCounts = {}, bookTitles = {};
        const lostOutstanding = [];

        issuanceSnap.forEach((child) => {
            const rec = child.val();
            const issueTime = rec.issueDate ? new Date(rec.issueDate).getTime() : null;
            const inRange = issueTime && issueTime >= fromTime && issueTime <= toTime;

            if (inRange) {
                issuedInRange++;
                if (rec.studentId) studentCounts[rec.studentId] = (studentCounts[rec.studentId] || 0) + 1;
                if (rec.bookId) {
                    bookCounts[rec.bookId] = (bookCounts[rec.bookId] || 0) + 1;
                    if (rec.bookTitle && !bookTitles[rec.bookId]) bookTitles[rec.bookId] = rec.bookTitle;
                }
            }
            if (rec.status === 'returned' && rec.actualReturnDate) {
                const returnTime = new Date(rec.actualReturnDate).getTime();
                if (returnTime >= fromTime && returnTime <= toTime) {
                    returnedInRange++;
                    if (issueTime) durations.push(Math.max(0, Math.round((returnTime - issueTime) / 86400000)));
                }
            }
            if (rec.status === 'active') {
                activeNow++;
                if (rec.returnDate && new Date(rec.returnDate).getTime() < Date.now()) overdueNow++;
            }
            if (rec.status === 'lost' && !rec.recoveryStatus) {
                const cost = rec.copyReplacementCost ?? books[rec.bookId]?.replacementCost;
                lostOutstanding.push({ title: rec.bookTitle || books[rec.bookId]?.title || 'Unknown', cost: Number(cost || 0) });
            }
        });

        const lowStock = [];
        Object.entries(books).forEach(([id, book]) => {
            const quantity = Number(book.quantity) || 0;
            const available = Number(book.available ?? quantity);
            if (quantity > 0 && available <= 1) lowStock.push({ title: book.title || 'Untitled', available });
        });

        const topBorrowers = Object.entries(studentCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([id, count]) => {
                const s = (typeof StudentsCache !== 'undefined') ? StudentsCache.get(id) : null;
                return { name: s ? `${s.name}${s.grade ? ' · ' + s.grade : ''}` : 'Unknown student', count };
            });
        const topBooks = Object.entries(bookCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([id, count]) => ({ title: bookTitles[id] || books[id]?.title || 'Unknown title', count }));

        let finesIssued = 0, finesCollected = 0, finesOutstanding = 0, finesCount = 0;
        if (finesSnap && finesSnap.exists()) {
            finesSnap.forEach((child) => {
                const f = child.val();
                const created = f.createdAt || 0;
                if (created >= fromTime && created <= toTime) {
                    finesCount++;
                    finesIssued += Number(f.amount || 0);
                    finesCollected += Number(f.amountPaid || 0);
                    finesOutstanding += Number(f.amountOutstanding || 0);
                }
            });
        }

        const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

        return {
            totals: {
                titles: Object.keys(books).length,
                copies: Object.values(books).reduce((s, b) => s + (Number(b.quantity) || 0), 0),
                issuedInRange, returnedInRange, avgDuration, activeNow, overdueNow
            },
            topBorrowers, topBooks, lowStock, lostOutstanding, finesIssued, finesCollected, finesOutstanding, finesCount
        };
    }

    // ---- PDF rendering ----------------------------------------------------

    function generateReport(from, to) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!window.jspdf) throw new Error('PDF library not loaded. Please refresh the page.');
                const data = await gatherData(from, to);

                const { jsPDF } = window.jspdf;
                const doc = new jsPDF('portrait');
                const pageWidth = doc.internal.pageSize.width;
                const pageHeight = doc.internal.pageSize.height;
                let y = 20;

                function header() {
                    doc.setFillColor(41, 128, 185);
                    doc.rect(0, 0, pageWidth, 18, 'F');
                    doc.setTextColor(255, 255, 255);
                    doc.setFontSize(14);
                    doc.setFont(undefined, 'bold');
                    doc.text('KANYADET PRI & JUNIOR SCHOOL', 14, 8);
                    doc.setFontSize(10);
                    doc.setFont(undefined, 'normal');
                    doc.text(`Library Term Report — ${from} to ${to}`, 14, 14);
                    doc.setTextColor(0, 0, 0);
                }

                function ensureSpace(needed) {
                    if (y + needed > pageHeight - 15) {
                        doc.addPage();
                        header();
                        y = 24;
                    }
                }

                function sectionTitle(text) {
                    ensureSpace(12);
                    doc.setFontSize(12);
                    doc.setFont(undefined, 'bold');
                    doc.setTextColor(41, 128, 185);
                    doc.text(text, 14, y);
                    doc.setTextColor(0, 0, 0);
                    doc.setFont(undefined, 'normal');
                    y += 6;
                }

                function table(head, body) {
                    doc.autoTable({ head: [head], body, startY: y, margin: { left: 14, right: 14 }, styles: { fontSize: 9 } });
                    y = doc.lastAutoTable.finalY + 10;
                }

                header();
                y = 24;

                sectionTitle('Overview');
                table(
                    ['Metric', 'Value'],
                    [
                        ['Titles in catalog', data.totals.titles],
                        ['Total copies (quantity)', data.totals.copies],
                        ['Issued this period', data.totals.issuedInRange],
                        ['Returned this period', data.totals.returnedInRange],
                        ['Average loan duration', `${data.totals.avgDuration} days`],
                        ['Currently on loan', data.totals.activeNow],
                        ['Currently overdue', data.totals.overdueNow]
                    ]
                );

                sectionTitle('Top Borrowers (this period)');
                table(['#', 'Student', 'Loans'],
                    data.topBorrowers.length
                        ? data.topBorrowers.map((b, i) => [i + 1, b.name, b.count])
                        : [['—', 'No activity recorded', '—']]);

                sectionTitle('Most Borrowed Books (this period)');
                table(['#', 'Title', 'Loans'],
                    data.topBooks.length
                        ? data.topBooks.map((b, i) => [i + 1, b.title, b.count])
                        : [['—', 'No activity recorded', '—']]);

                sectionTitle('Low Stock (0-1 copies available)');
                table(['Title', 'Available'],
                    data.lowStock.length
                        ? data.lowStock.map(b => [b.title, b.available])
                        : [['None — all titles adequately stocked', '']]);

                sectionTitle(`Lost Books Outstanding (${data.lostOutstanding.length})`);
                const lostTotal = data.lostOutstanding.reduce((s, b) => s + b.cost, 0);
                table(['Title', 'Replacement Cost'],
                    data.lostOutstanding.length
                        ? [...data.lostOutstanding.map(b => [b.title, currency(b.cost)]), ['TOTAL', currency(lostTotal)]]
                        : [['None currently outstanding', '']]);

                sectionTitle('Fines (this period)');
                table(['Metric', 'Value'],
                    [
                        ['Fines issued', data.finesCount],
                        ['Total amount issued', currency(data.finesIssued)],
                        ['Total collected', currency(data.finesCollected)],
                        ['Total outstanding', currency(data.finesOutstanding)]
                    ]);

                ensureSpace(20);
                doc.setFontSize(8);
                doc.setTextColor(100, 100, 100);
                doc.text(`Generated ${new Date().toLocaleString('en-GB')}`, 14, pageHeight - 10);
                doc.text('Prepared by: ______________________', pageWidth - 90, pageHeight - 10);

                doc.save(`Kanyadet-Library-Term-Report-${from}-to-${to}.pdf`);

                await db().ref('activities').push({
                    type: 'term_report',
                    description: `Generated library term report (${from} to ${to})`,
                    timestamp: Date.now()
                });

                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', injectButton);
})();
