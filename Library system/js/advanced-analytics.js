class AdvancedAnalyticsManager {
    constructor() {
        this.db = firebase.database();
        this.charts = {};
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadAnalytics();
    }

    setupEventListeners() {
        document.getElementById('refreshAnalyticsBtn')?.addEventListener('click', () => this.loadAnalytics());
        document.getElementById('exportAnalyticsBtn')?.addEventListener('click', () => this.exportAnalyticsReport());
        document.getElementById('analyticsPeriod')?.addEventListener('change', () => this.loadAnalytics());
        document.getElementById('analyticsGrade')?.addEventListener('change', () => this.loadAnalytics());
    }

    async loadAnalytics() {
        try {
            const period = parseInt(document.getElementById('analyticsPeriod')?.value) || 30;
            const gradeFilter = document.getElementById('analyticsGrade')?.value || '';

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - period);

            // Load data
            const [issuanceSnapshot, booksSnapshot] = await Promise.all([
                this.db.ref('issuance').once('value'),
                this.db.ref('books').once('value')
            ]);

            const issuances = [];
            const books = {};

            if (issuanceSnapshot.exists()) {
                issuanceSnapshot.forEach(child => {
                    const issuance = child.val();
                    issuance.id = child.key;
                    // Filter by date
                    const issueDate = new Date(issuance.issueDate);
                    if (issueDate >= startDate) {
                        // Filter by grade if specified
                        if (!gradeFilter || issuance.grade === gradeFilter) {
                            issuances.push(issuance);
                        }
                    }
                });
            }

            if (booksSnapshot.exists()) {
                booksSnapshot.forEach(child => {
                    const book = child.val();
                    books[child.key] = book;
                });
            }

            // Update statistics
            this.updateStatistics(issuances);

            // Render charts
            this.renderReadingTrendsChart(issuances, period);
            this.renderGenreByGradeChart(issuances, books);
            this.renderTopReaders(issuances);
            this.renderSeasonalPatternsChart(issuances);

        } catch (error) {
            console.error('Error loading analytics:', error);
        }
    }

    updateStatistics(issuances) {
        const totalIssues = issuances.length;
        const totalReturns = issuances.filter(i => i.status === 'returned').length;
        
        // Calculate average loan duration
        const returnedIssuances = issuances.filter(i => i.status === 'returned' && i.returnedAt);
        let totalDuration = 0;
        returnedIssuances.forEach(i => {
            const issueDate = new Date(i.issueDate);
            const returnDate = new Date(i.returnedAt);
            totalDuration += (returnDate - issueDate) / (1000 * 60 * 60 * 24);
        });
        const avgDuration = returnedIssuances.length > 0 ? (totalDuration / returnedIssuances.length).toFixed(1) : 0;

        // Calculate overdue rate
        const overdueCount = issuances.filter(i => i.status === 'overdue').length;
        const overdueRate = totalIssues > 0 ? ((overdueCount / totalIssues) * 100).toFixed(1) : 0;

        document.getElementById('analyticsTotalIssues').textContent = totalIssues;
        document.getElementById('analyticsTotalReturns').textContent = totalReturns;
        document.getElementById('analyticsAvgDuration').textContent = `${avgDuration} days`;
        document.getElementById('analyticsOverdueRate').textContent = `${overdueRate}%`;
    }

    renderReadingTrendsChart(issuances, period) {
        const canvas = document.getElementById('readingTrendsChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // Destroy existing chart
        if (this.charts.readingTrends) {
            this.charts.readingTrends.destroy();
        }

        // Group data by day
        const dailyData = {};
        const today = new Date();
        
        for (let i = period - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(today.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            dailyData[dateStr] = { issues: 0, returns: 0 };
        }

        issuances.forEach(issuance => {
            const issueDate = issuance.issueDate?.split('T')[0];
            if (dailyData[issueDate]) {
                dailyData[issueDate].issues++;
            }

            if (issuance.status === 'returned' && issuance.returnedAt) {
                const returnDate = new Date(issuance.returnedAt).toISOString().split('T')[0];
                if (dailyData[returnDate]) {
                    dailyData[returnDate].returns++;
                }
            }
        });

        const labels = Object.keys(dailyData).map(date => {
            const d = new Date(date);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });

        const issuesData = Object.values(dailyData).map(d => d.issues);
        const returnsData = Object.values(dailyData).map(d => d.returns);

        this.charts.readingTrends = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Books Issued',
                        data: issuesData,
                        borderColor: '#16233D',
                        backgroundColor: 'rgba(22, 35, 61, 0.1)',
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: 'Books Returned',
                        data: returnsData,
                        borderColor: '#B8862E',
                        backgroundColor: 'rgba(184, 134, 46, 0.1)',
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                }
            }
        });
    }

    renderGenreByGradeChart(issuances, books) {
        const canvas = document.getElementById('genreByGradeChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // Destroy existing chart
        if (this.charts.genreByGrade) {
            this.charts.genreByGrade.destroy();
        }

        // Group data by grade and category
        const gradeGenreData = {};
        const allGenres = new Set();

        issuances.forEach(issuance => {
            const grade = issuance.grade || 'Unknown';
            const book = books[issuance.bookId];
            const genre = book?.category || 'Unknown';

            if (!gradeGenreData[grade]) {
                gradeGenreData[grade] = {};
            }
            if (!gradeGenreData[grade][genre]) {
                gradeGenreData[grade][genre] = 0;
            }
            gradeGenreData[grade][genre]++;
            allGenres.add(genre);
        });

        const grades = Object.keys(gradeGenreData).sort();
        const genres = Array.from(allGenres).sort();

        const datasets = genres.map((genre, index) => {
            const colors = [
                '#16233D', '#B8862E', '#5B7553', '#A6553C',
                '#6E7F8D', '#D9A94E', '#3E5C50', '#8C6E63'
            ];
            return {
                label: genre,
                data: grades.map(grade => gradeGenreData[grade]?.[genre] || 0),
                backgroundColor: colors[index % colors.length]
            };
        });

        this.charts.genreByGrade = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: grades,
                datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top'
                    }
                },
                scales: {
                    x: {
                        stacked: true
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true
                    }
                }
            }
        });
    }

    renderTopReaders(issuances) {
        const container = document.getElementById('topReadersList');
        if (!container) return;

        // Count books per student
        const studentCounts = {};
        issuances.forEach(issuance => {
            if (issuance.studentId) {
                studentCounts[issuance.studentId] = (studentCounts[issuance.studentId] || 0) + 1;
            }
        });

        // Sort and get top 10
        const topReaders = Object.entries(studentCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        if (topReaders.length === 0) {
            container.innerHTML = '<p class="text-muted">No reading activity in this period.</p>';
            return;
        }

        container.innerHTML = `
            <div class="table-responsive">
                <table class="table table-striped">
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Student</th>
                            <th>Grade</th>
                            <th>Books Read</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topReaders.map(([studentId, count], index) => {
                            const student = (typeof StudentsCache !== 'undefined') ? StudentsCache.get(studentId) : null;
                            const studentName = student?.name || 'Unknown';
                            const grade = student?.grade || 'Unknown';
                            return `
                                <tr>
                                    <td>${index + 1}</td>
                                    <td>${studentName}</td>
                                    <td>${grade}</td>
                                    <td><span class="badge bg-primary">${count}</span></td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    renderSeasonalPatternsChart(issuances) {
        const canvas = document.getElementById('seasonalPatternsChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // Destroy existing chart
        if (this.charts.seasonalPatterns) {
            this.charts.seasonalPatterns.destroy();
        }

        // Group by month
        const monthlyData = {
            'January': 0, 'February': 0, 'March': 0, 'April': 0,
            'May': 0, 'June': 0, 'July': 0, 'August': 0,
            'September': 0, 'October': 0, 'November': 0, 'December': 0
        };

        issuances.forEach(issuance => {
            if (issuance.issueDate) {
                const month = new Date(issuance.issueDate).toLocaleString('default', { month: 'long' });
                if (monthlyData[month] !== undefined) {
                    monthlyData[month]++;
                }
            }
        });

        this.charts.seasonalPatterns = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(monthlyData),
                datasets: [{
                    label: 'Books Issued',
                    data: Object.values(monthlyData),
                    backgroundColor: '#B8862E'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    async exportAnalyticsReport() {
        try {
            const period = parseInt(document.getElementById('analyticsPeriod')?.value) || 30;
            const gradeFilter = document.getElementById('analyticsGrade')?.value || '';

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - period);

            const [issuanceSnapshot, booksSnapshot] = await Promise.all([
                this.db.ref('issuance').once('value'),
                this.db.ref('books').once('value')
            ]);

            const issuances = [];
            const books = {};

            if (issuanceSnapshot.exists()) {
                issuanceSnapshot.forEach(child => {
                    const issuance = child.val();
                    const issueDate = new Date(issuance.issueDate);
                    if (issueDate >= startDate) {
                        if (!gradeFilter || issuance.grade === gradeFilter) {
                            issuances.push(issuance);
                        }
                    }
                });
            }

            if (booksSnapshot.exists()) {
                booksSnapshot.forEach(child => {
                    books[child.key] = child.val();
                });
            }

            // Prepare report data
            const reportData = {
                headers: ['Date', 'Student', 'Grade', 'Book Title', 'Author', 'Category', 'Status', 'Return Date'],
                body: issuances.map(issuance => {
                    const book = books[issuance.bookId];
                    return [
                        issuance.issueDate,
                        issuance.studentName,
                        issuance.grade,
                        book?.title || 'Unknown',
                        book?.author || 'Unknown',
                        book?.category || 'Unknown',
                        issuance.status,
                        issuance.returnedAt ? new Date(issuance.returnedAt).toLocaleDateString() : 'Not returned'
                    ];
                }),
                statsInfo: {
                    'Period': `Last ${period} days`,
                    'Grade Filter': gradeFilter || 'All grades',
                    'Total Issues': issuances.length,
                    'Total Returns': issuances.filter(i => i.status === 'returned').length,
                    'Overdue': issuances.filter(i => i.status === 'overdue').length
                }
            };

            await exportToPdfEnhanced(reportData, 'Advanced Analytics Report');

            await Swal.fire({
                icon: 'success',
                title: 'Report Exported',
                text: 'Analytics report has been generated',
                timer: 2000,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('Error exporting analytics report:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to export report: ' + error.message
            });
        }
    }
}

// Initialize the advanced analytics manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.advancedAnalyticsManager = new AdvancedAnalyticsManager();
});