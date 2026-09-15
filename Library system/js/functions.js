class DashboardFunctions {
    constructor() {
        this.db = firebase.database();
        // Same students collection app.js's StudentManager reads/writes —
        // real records there use fields like "Official Student Name", "Grade",
        // "Assessment No", "UPI" rather than lowerCamelCase. Reuse app.js's
        // normalizeStudent() if it's already loaded; define a fallback otherwise.
        if (typeof normalizeStudent !== 'function') {
            window.normalizeStudent = function(raw) {
                if (!raw) return raw;
                return {
                    ...raw,
                    name: raw.name || raw.fullName || raw['Official Student Name'] || 'Unknown',
                    fullName: raw.fullName || raw['Official Student Name'] || raw.name || 'Unknown',
                    assessmentNo: (raw.assessmentNo || raw['Assessment No'] || '').toString().trim(),
                    grade: raw.grade || raw['Grade'] || '',
                    upi: raw.upi || raw.upiNo || raw['UPI'] || '',
                    phoneNumber: raw.phoneNumber || raw['Home phone'] || ''
                };
            };
        }
        // Same shared helper app.js defines for keeping books/{id}.available in
        // sync (derived from quantity - lost - active issuances) rather than
        // hand-adjusted in a dozen places — reuse it if already loaded, define
        // a fallback otherwise, matching the normalizeStudent pattern above.
        if (typeof recalculateBookAvailability !== 'function') {
            window.recalculateBookAvailability = async function(bookId) {
                const dbRef = firebase.database();
                const [bookSnap, issuanceSnap] = await Promise.all([
                    dbRef.ref(`books/${bookId}`).once('value'),
                    dbRef.ref('issuance').orderByChild('bookId').equalTo(bookId).once('value')
                ]);
                const book = bookSnap.val();
                if (!book) return null;
                let activeCount = 0;
                issuanceSnap.forEach(child => {
                    const status = child.val().status;
                    if (status === 'active' || status === 'overdue') activeCount++;
                });
                const quantity = Number(book.quantity) || 0;
                const lost = Number(book.lost) || 0;
                const available = Math.max(0, quantity - lost - activeCount);
                await dbRef.ref(`books/${bookId}`).update({ available, updatedAt: Date.now() });
                return available;
            };
        }
        // Cache-first book lookup for display (see app.js's BooksCache) —
        // reuse it if already loaded, else fall back to a plain direct read.
        if (typeof getBookCached !== 'function') {
            window.getBookCached = async function(bookId) {
                if (!bookId) return null;
                if (typeof BooksCache !== 'undefined') {
                    const cached = BooksCache.get(bookId);
                    if (cached) return cached;
                }
                const snapshot = await firebase.database().ref(`books/${bookId}`).once('value');
                return snapshot.val();
            };
        }
        this.studentsPath = (typeof sanitizedAppId !== 'undefined')
            ? `artifacts/${sanitizedAppId}/students`
            : 'students';
        this.chartListeners = []; // Move this line up before any method calls
        this.initGlobalModal();
        this.setupEventListeners();
        this.initializeCharts();
        this.loadRecentActivities();
        this.loadNotifications();
    }

    setupEventListeners() {
        // Quick action buttons
        const quickActions = {
            'quickIssueBtn': () => this.handleQuickIssue(),
            'quickReturnBtn': () => this.handleQuickReturn(),
            'lostBooksBtn': () => this.showLostBooks(),
            'bulkImportBtn': () => this.handleBulkImport(),
            'downloadBulkTemplate': (e) => {
                e.preventDefault();
                this.downloadBulkTemplate();
            },
            'systemBackupBtn': () => this.handleSystemBackup(),
            'viewAllActivities': () => this.showAllActivities(),
            'clearAllActivitiesBtn': () => this.clearAllActivities(),
            'clearAllNotificationsBtn': () => this.clearAllNotifications(),
            'bulkIssuanceBtn': () => this.handleBulkIssuance(),
            'downloadTemplate': (e) => {
                e.preventDefault();
                this.downloadIssuanceTemplate();
            },
            // Optional — only wires up if index.html has a button with this
            // id. Runs a one-time repair pass over every book, recomputing
            // available from ground truth to fix any already-drifted records
            // (e.g. "46 available / 46 total / 1 lost"). Can also be run
            // from the console: dashboardFunctions.repairAllBookCounts()
            'repairBookCountsBtn': () => this.repairAllBookCounts()
        };

        // Attach event listeners using optional chaining
        for (const [id, handler] of Object.entries(quickActions)) {
            document.getElementById(id)?.addEventListener('click', handler);
        }
    }

    async initializeCharts() {
        // Initialize empty charts first
        this.initMonthlyStatsChart();
        this.initCategoryChart();
        
        // Set up real-time listeners
        this.setupChartListeners();
    }

    initMonthlyStatsChart() {
        const ctx1 = document.getElementById('monthlyStatsChart').getContext('2d');
        this.monthlyStatsChart = new Chart(ctx1, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Issues',
                    data: [],
                    borderColor: '#0d6efd'
                }, {
                    label: 'Returns',
                    data: [],
                    borderColor: '#198754'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
    }

    initCategoryChart() {
        const ctx2 = document.getElementById('categoryPieChart').getContext('2d');
        this.categoryChart = new Chart(ctx2, {
            type: 'pie',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: [
                        '#0d6efd', '#6610f2', '#6f42c1', '#d63384', 
                        '#dc3545', '#fd7e14', '#ffc107', '#198754'
                    ]
                }]
            }
        });
    }

    setupChartListeners() {
        try {
            // Clear any existing listeners
            this.cleanupChartListeners();
            
            // Listen for issuance changes
            const issuanceListener = this.db.ref('issuance').on('value', snapshot => {
                this.updateMonthlyStats(snapshot);
            });

            // Listen for books changes
            const booksListener = this.db.ref('books').on('value', snapshot => {
                this.updateCategoryStats(snapshot);
            });

            // Store listeners for cleanup
            this.chartListeners = [
                { ref: 'issuance', listener: issuanceListener },
                { ref: 'books', listener: booksListener }
            ];
        } catch (error) {
            console.error('Error setting up chart listeners:', error);
        }
    }

  async updateMonthlyStats(snapshot) {
    try {
        // Initialize arrays for the last 12 months
        const months = Array.from({ length: 12 }, (_, i) => {
            const d = new Date();
            d.setMonth(d.getMonth() - (2 - i)); // Chronological order: oldest to newest
            d.setDate(1); // Normalize to first of the month
            d.setHours(0, 0, 0, 0); // Reset time for consistent comparison
            return d;
        });

        // Format labels for the chart
        const monthLabels = months.map(d =>
            d.toLocaleString('default', { month: 'short', year: 'numeric' })
        );

        // Initialize data arrays
        const messagesData = new Array(12).fill(0);
        const returnsData = new Array(12).fill(0);

        // Process snapshot
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const record = child.val();
                
                // Parse dates, ensuring valid dates
                const issueDate = record.issueDate ? new Date(record.issueDate) : null;
                const returnedAt = record.returnedAt ? new Date(record.returnedAt) : null;

                if (issueDate && !isNaN(issueDate)) {
                    // Normalize issue date to start of month
                    const issueMonth = new Date(issueDate.getFullYear(), issueDate.getMonth(), 1);
                    
                    months.forEach((month, index) => {
                        if (
                            issueMonth.getFullYear() === month.getFullYear() &&
                            issueMonth.getMonth() === month.getMonth()
                        ) {
                            messagesData[index]++;
                        }
                    });
                }

                if (returnedAt && !isNaN(returnedAt)) {
                    // Normalize return date to start of month
                    const returnMonth = new Date(returnedAt.getFullYear(), returnedAt.getMonth(), 1);
                    
                    months.forEach((month, index) => {
                        if (
                            returnMonth.getFullYear() === month.getFullYear() &&
                            returnMonth.getMonth() === month.getMonth()
                        ) {
                            returnsData[index]++;
                        }
                    });
                }
            });
        } else {
            console.warn('No issuance data found in snapshot');
        }

        // Log data for debugging
        console.log('Monthly Stats:', { labels: monthLabels, messages: messagesData, returns: returnsData });

        // Update chart
        if (this.monthlyStatsChart) {
            this.monthlyStatsChart.data.labels = monthLabels;
            this.monthlyStatsChart.data.datasets[0].data = messagesData;
            this.monthlyStatsChart.data.datasets[1].data = returnsData;
            
            // Enhanced chart options
            this.monthlyStatsChart.options = {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Count' }
                    },
                    x: {
                        title: { display: true, text: 'Month' }
                    }
                },
                plugins: {
                    legend: { position: 'top' },
                    title: { display: true, text: 'Monthly Issues and Returns' }
                }
            };

            this.monthlyStatsChart.update();
        } else {
            console.error('Monthly stats chart not initialized');
        }
    } catch (error) {
        console.error('Error updating monthly stats:', error);
        await this.showError('Chart Update Failed', error.message);
    }
}

    updateCategoryStats(snapshot) {
        try {
            const categories = {};
            
            // Count books by category including individual quantities
            snapshot.forEach(child => {
                const book = child.val();
                if (book.category && book.quantity) {
                    // Add the quantity to the category total
                    categories[book.category] = (categories[book.category] || 0) + parseInt(book.quantity || 0);
                }
            });

            // Update chart data if chart exists
            if (this.categoryChart) {
                // Update labels and data
                this.categoryChart.data.labels = Object.keys(categories);
                this.categoryChart.data.datasets[0].data = Object.values(categories);
                
                // Calculate total books for percentage
                const totalBooks = Object.values(categories).reduce((sum, num) => sum + num, 0);
                
                // Update tooltip to show quantity and percentage
                this.categoryChart.options = {
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const value = context.raw;
                                    const percentage = ((value / totalBooks) * 100).toFixed(1);
                                    return `${context.label}: ${value} books (${percentage}%)`;
                                }
                            }
                        }
                    }
                };
                
                // Update the chart
                this.categoryChart.update();

                // Update category stats display if element exists
                const categoryStatsElement = document.getElementById('categoryStats');
                if (categoryStatsElement) {
                    const statsHTML = Object.entries(categories)
                        .map(([category, count]) => `
                            <div class="category-stat">
                                <span class="category-name">${category}</span>
                                <span class="category-count">${count} books</span>
                                <span class="category-percent">(${((count / totalBooks) * 100).toFixed(1)}%)</span>
                            </div>
                        `).join('');
                    categoryStatsElement.innerHTML = statsHTML;
                }
            }
        } catch (error) {
            console.error('Error updating category stats:', error);
        }
    }

    // Add cleanup method for chart listeners
    cleanupChartListeners() {
        this.chartListeners.forEach(({ ref, listener }) => {
            this.db.ref(ref).off('value', listener);
        });
        this.chartListeners = [];
    }

    async handleQuickIssue() {
        try {
            const modal = new bootstrap.Modal(document.getElementById('quickIssueModal'));
            const confirmBtn = document.getElementById('confirmQuickIssue');
            
            // Get select elements
            const gradeSelect = document.getElementById('quickGrade');
            const studentSelect = document.getElementById('quickStudent');
            const bookSelect = document.getElementById('quickBook');
            
            // Clear previous options
            gradeSelect.innerHTML = '<option value="">Select Grade</option>';
            studentSelect.innerHTML = '<option value="">Select Student</option>';
            bookSelect.innerHTML = '<option value="">Select Book</option>';
            
            // Disable student select until grade is chosen
            studentSelect.disabled = true;

            // Fetch and populate grades
            //const grades = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'];
            const grades = Array.from({length: 9}, (_, i) => `Grade ${i + 1}`);
            grades.forEach(grade => {
                const option = document.createElement('option');
                option.value = grade;
                option.textContent = grade;
                gradeSelect.appendChild(option);
            });

            // Add grade change listener
            gradeSelect.onchange = async () => {
                studentSelect.innerHTML = '<option value="">Select Student</option>';
                studentSelect.disabled = true;
                
                if (gradeSelect.value) {
                    // Filter the shared, already-synced cache instead of
                    // issuing a fresh Firebase query every time this opens.
                    const students = [];
                    StudentsCache.getAll().forEach((student, id) => {
                        if (student.grade === gradeSelect.value) {
                            students.push({ id, ...student });
                        }
                    });

                    // Sort students by name
                    students.sort((a, b) => a.name.localeCompare(b.name));
                    
                    // Populate student select
                    students.forEach(student => {
                        const option = document.createElement('option');
                        option.value = student.id;
                        option.textContent = `${student.name} (${student.assessmentNo || 'No ID'})`;
                        studentSelect.appendChild(option);
                    });
                    
                    studentSelect.disabled = false;
                }
            };
            
            // Fetch and populate available books
            const booksSnapshot = await this.db.ref('books').once('value');
            booksSnapshot.forEach(childSnapshot => {
                const book = childSnapshot.val();
                if (book.available > 0) {
                    const option = document.createElement('option');
                    option.value = childSnapshot.key;
                    option.textContent = `${book.title} (${book.available} available)`;
                    bookSelect.appendChild(option);
                }
            });

            // Add confirm button handler
            confirmBtn.onclick = async () => {
                const studentId = studentSelect.value;
                const bookId = bookSelect.value;

                if (!studentId || !bookId) {
                    await this.showWarning('Missing Information', 'Please select both student and book');
                    return;
                }

                try {
                    const bookSnapshot = await this.db.ref(`books/${bookId}`).once('value');
                    const student = StudentsCache.get(studentId);
                    const book = bookSnapshot.val();

                    if (!student || !book) {
                        throw new Error('Student or book not found');
                    }

                    // Create issuance record — grab the key up front so the
                    // activity log entry below can point at this exact
                    // issuance (needed so "Report Lost" from the activity
                    // feed marks the right student's copy, not just any
                    // active issuance of this book title).
                    const newIssuanceRef = this.db.ref('issuance').push();
                    await newIssuanceRef.set({
                        studentId,
                        studentName: student.name,
                        grade: student.grade,
                        upi: student.upi,
                        bookId,
                        isbn: book.isbn || '',
                        bookTitle: book.title,
                        issueDate: new Date().toISOString().split('T')[0],
                        returnDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                        status: 'active',
                        timestamp: Date.now()
                    });

                    // Update book availability
                    await recalculateBookAvailability(bookId);

                    // Create activity record
                    await this.createActivity('issue', `Issued "${book.title}" to ${student.name}`, {
                        bookId, studentId, issuanceId: newIssuanceRef.key
                    });

                    modal.hide();
                    await this.showSuccess('Success', 'Book issued successfully');
                    
                    // Refresh relevant UI components
                    if (this.loadNotifications) {
                        await this.loadNotifications();
                    }
                } catch (error) {
                    await this.showError('Issue Error', error);
                }
            };

            modal.show();
        } catch (error) {
            await this.showError('Initialization Error', error);
        }
    }

    async handleQuickReturn() {
    try {
        const modalElement = document.getElementById('quickReturnModal');
        if (!modalElement) throw new Error('Quick return modal not found');
        
        const modal = new bootstrap.Modal(modalElement);
        const confirmBtn = document.getElementById('confirmQuickReturn');
        const gradeSelect = document.getElementById('quickReturnGrade');
        const issuanceSelect = document.getElementById('quickReturnIssuance');
        
        // Clear and disable issuance select
        issuanceSelect.innerHTML = '<option value="">Select Active Issuance</option>';
        issuanceSelect.disabled = true;

        // Clear and populate grade select
        gradeSelect.innerHTML = '<option value="">Select Grade</option>';
        const grades = Array.from({length: 9}, (_, i) => `Grade ${i + 1}`);
        grades.forEach(grade => {
            const option = document.createElement('option');
            option.value = grade;
            option.textContent = grade;
            gradeSelect.appendChild(option);
        });

        // Add grade change listener
        gradeSelect.onchange = async () => {
            issuanceSelect.innerHTML = '<option value="">Select Active Issuance</option>';
            issuanceSelect.disabled = true;

            if (gradeSelect.value) {
                // Get active issuances for selected grade
                const issuanceSnapshot = await this.db.ref('issuance')
                    .orderByChild('status')
                    .equalTo('active')
                    .once('value');
                
                const promises = [];
                issuanceSnapshot.forEach(childSnapshot => {
                    const issuance = childSnapshot.val();
                    if (issuance.grade === gradeSelect.value) {
                        const student = StudentsCache.get(issuance.studentId);
                        promises.push(
                            getBookCached(issuance.bookId).then(book => {
                                if (student && book) {
                                    const option = document.createElement('option');
                                    option.value = childSnapshot.key;
                                    option.dataset.bookId = issuance.bookId; // Ensure bookId is stored
                                    option.textContent = `${student.name} - ${book.title} (Due: ${issuance.returnDate})`;
                                    issuanceSelect.appendChild(option);
                                }
                            })
                        );
                    }
                });

                await Promise.all(promises);
                issuanceSelect.disabled = false;
            }
        };

        // Add confirm button handler
        confirmBtn.onclick = async () => {
            const issuanceId = issuanceSelect.value;
            const selectedOption = issuanceSelect.selectedOptions[0];
            const bookId = selectedOption?.dataset.bookId; // Get bookId from dataset

            if (!issuanceId || !bookId) {
                await this.showWarning('Selection Required', 'Please select a book to return');
                return;
            }

            try {
                // Get issuance details first
                const issuanceSnapshot = await this.db.ref(`issuance/${issuanceId}`).once('value');
                const issuance = issuanceSnapshot.val();

                // Update issuance status
                await this.db.ref(`issuance/${issuanceId}`).update({
                    status: 'returned',
                    returnedAt: Date.now(),
                    actualReturnDate: new Date().toISOString()
                });

                // Update book availability
                await recalculateBookAvailability(bookId);

                // Create activity record
                await this.createActivity('return', 
                    `Returned "${issuance.bookTitle}" from ${issuance.studentName}`
                );

                modal.hide();
                await this.showSuccess('Success', 'Book returned successfully');

                // Refresh UI components
                await Promise.all([
                    this.loadRecentActivities(),
                    this.loadNotifications(),
                    this.updateDashboardStats?.()
                ]);

            } catch (error) {
                await this.showError('Return Error', error);
            }
        };

        modal.show();
    } catch (error) {
        await this.showError('Quick Return Error', error);
    }
}

    async handleBulkImport() {
        try {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv,.xlsx';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    try {
                        await this.processBulkImport(file);
                        await this.showSuccess('Import Success', 'File processed successfully');
                    } catch (error) {
                        await this.showError('Import Error', error);
                    }
                }
            };
            input.click();
        } catch (error) {
            await this.showError('Import Error', 'Failed to initialize bulk import');
        }
    }

    async handleSystemBackup() {
        try {
            // ...existing backup code...
            await this.showSuccess('Backup Complete', 'System backup created successfully');
        } catch (error) {
            await this.showError('Backup Failed', error);
        }
    }

    async loadRecentActivities() {
        try {
            const activitiesList = document.getElementById('recentActivitiesList');
            if (!activitiesList) return;

            const snapshot = await this.db.ref('activities')
                .orderByChild('timestamp')
                .limitToLast(3) // ...maximum number of activities to show...
                .once('value');

            const activities = [];
            snapshot.forEach(child => {
                activities.unshift({
                    id: child.key,
                    ...child.val()
                });
            });

            if (activities.length === 0) {
                activitiesList.innerHTML = `
                    <div class="activity-item">
                        <div class="activity-content">
                            <p>No recent activities</p>
                        </div>
                    </div>
                `;
                return;
            }

            activitiesList.innerHTML = activities.map(activity => `
                <div class="activity-item ${activity.type}" data-activity-id="${activity.id}">
                    <div class="activity-content" onclick="dashboardFunctions.showActivityDetails('${activity.id}')">
                        <div class="activity-icon">
                            <i class="bi ${this.getActivityIcon(activity.type)}"></i>
                        </div>
                        <div class="activity-details">
                            <p>${activity.description}</p>
                            <small>${new Date(activity.timestamp).toLocaleString()}</small>
                        </div>
                    </div>
                    <div class="activity-actions">
                        ${this.getActivityActionButtons(activity)}
                    </div>
                </div>
            `).join('');

        } catch (error) {
            console.error('Error loading recent activities:', error);
        }
    }

    // Add helper method to generate action buttons
    getActivityActionButtons(activity) {
        let buttons = '';
        
        switch (activity.type) {
            case 'issue':
                buttons += `
                    <button class="btn btn-sm btn-outline-primary" 
                            onclick="dashboardFunctions.handleQuickReturn('${activity.bookId}')">
                        <i class="bi bi-arrow-return-left"></i> Return
                    </button>
                    <button class="btn btn-sm btn-outline-warning" 
                            onclick="dashboardFunctions.reportBookLost('${activity.bookId}', '${activity.issuanceId || ''}')">
                        <i class="bi bi-exclamation-triangle"></i> Report Lost
                    </button>
                `;
                break;
            case 'return':
                buttons += `
                    <button class="btn btn-sm btn-outline-success" disabled>
                        <i class="bi bi-check-circle"></i> Returned
                    </button>
                `;
                break;
            case 'lost':
                buttons += `
                    <button class="btn btn-sm btn-outline-warning" 
                            onclick="dashboardFunctions.markBookFound('${activity.bookId}')">
                        <i class="bi bi-check-circle"></i> Mark Found
                    </button>
                `;
                break;
        }

        // Add delete button for all activities
        buttons += `
            <button class="btn btn-sm btn-outline-danger" 
                    onclick="dashboardFunctions.deleteActivity('${activity.id}')">
                <i class="bi bi-trash"></i>
            </button>
        `;

        return buttons;
    }

    async showActivityDetails(activityId) {
        try {
            const snapshot = await this.db.ref(`activities/${activityId}`).once('value');
            const activity = snapshot.val();
            
            if (!activity) throw new Error('Activity not found');

            this.showGlobalModal({
                title: 'Activity Details',
                content: `
                    <div class="activity-detail">
                        <div class="activity-icon-large ${activity.type} mb-3">
                            <i class="bi ${this.getActivityIcon(activity.type)} fs-1"></i>
                        </div>
                        <h5>${activity.description}</h5>
                        <p class="text-muted mb-3">
                            ${new Date(activity.timestamp).toLocaleString()}
                        </p>
                        ${await this.getActivityExtraDetails(activity)}
                    </div>
                `,
                showConfirmButton: false
            });
        } catch (error) {
            await this.showError('Error', 'Failed to load activity details');
        }
    }

    // Add this helper method
    async getActivityExtraDetails(activity) {
        try {
            let details = '';
            
            if (activity.bookId) {
                const book = await getBookCached(activity.bookId);
                if (book) {
                    details += `
                        <div class="detail-group">
                            <label>Book:</label>
                            <span>${book.title}</span>
                        </div>
                    `;
                }
            }
            
            if (activity.studentId) {
                const student = StudentsCache.get(activity.studentId);
                if (student) {
                    details += `
                        <div class="detail-group">
                            <label>Student:</label>
                            <span>${student.name} (${student.grade})</span>
                        </div>
                    `;
                }
            }
            
            return details;
        } catch (error) {
            console.error('Error getting extra details:', error);
            return '';
        }
    }

    // Update loadNotifications method to include more actions
  async loadNotifications() {
    try {
        const notificationsList = document.getElementById('notificationsList');
        if (!notificationsList) {
            console.warn('Notifications list element not found');
            return;
        }

        // Set up real-time listener on the messages node
        this.db.ref('messages')
            .orderByChild('timestamp')
            .limitToLast(3)
            .on('value', (snapshot) => {
                const notifications = [];
                
                snapshot.forEach(child => {
                    const message = child.val();
                    notifications.unshift({
                        id: child.key,
                        message: message.subject || 'No issue specified',
                        title: message.subject || 'Unknown Issue',
                        type: message.type || 'info',
                        timestamp: message.timestamp || Date.now(),
                        status: message.status || 'pending',
                        studentName: message.studentName || 'Unknown Student',
                        studentGrade: message.studentGrade || 'N/A',
                        studentId: message.studentId || 'N/A',
                        isNew: !message.read // Adjust if read flag is not used
                    });
                });

                if (notifications.length === 0) {
                    notificationsList.innerHTML = `
                        <div class="notification-item info">
                            <div class="notification-content">
                                <p>No notifications at this time</p>
                            </div>
                        </div>
                    `;
                    return;
                }

                notificationsList.innerHTML = notifications.map(notification => `
                    <div class="notification-item ${notification.type} ${notification.isNew ? 'new' : ''}" 
                         data-id="${notification.id}">
                        <div class="notification-content" onclick="dashboardFunctions.showNotificationDetails('${notification.id}')">
                            <div class="notification-icon">
                                <i class="bi ${this.getNotificationIcon(notification.type)}"></i>
                            </div>
                            <div class="notification-info">
                                <p class="notification-title">${notification.title}</p>
                                <p class="notification-message">${notification.message}</p>
                                <small class="notification-meta">
                                    ${notification.studentName} (${notification.studentGrade}, ID: ${notification.studentId})
                                    <span class="notification-time">
                                        ${new Date(notification.timestamp).toLocaleString()}
                                    </span>
                                </small>
                            </div>
                        </div>
                        <div class="notification-actions">
                            ${notification.isNew ? '<span class="new-badge">New</span>' : ''}
                            <button class="btn btn-sm btn-outline-primary" 
                                    onclick="dashboardFunctions.handleQuickReply('${notification.id}')">
                                <i class="bi bi-reply"></i> Reply
                            </button>
                            ${notification.status !== 'resolved' ? `
                                <button class="btn btn-sm btn-outline-success" 
                                        onclick="dashboardFunctions.markNotificationResolved('${notification.id}')">
                                    <i class="bi bi-check-circle"></i> Resolve
                                </button>
                            ` : ''}
                            <button class="btn btn-sm btn-outline-danger" 
                                    onclick="dashboardFunctions.deleteNotification('${notification.id}')">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('');
            }, (error) => {
                console.error('Error in real-time listener:', error);
                this.showError('Notification Error', 'Failed to load notifications: ' + error.message);
            });

        // Add notification styles (only if not already added)
        if (!document.querySelector('style#notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                .notification-item {
                    display: flex;
                    align-items: start;
                    justify-content: space-between;
                    padding: 12px;
                    border-bottom: 1px solid #eee;
                    transition: all 0.2s ease;
                }
                .notification-content {
                    display: flex;
                    gap: 12px;
                    cursor: pointer;
                    flex: 1;
                }
                .notification-icon {
                    width: 40px;
                    height: 40px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    background: #e9ecef;
                }
                .notification-info {
                    flex: 1;
                }
                .notification-title {
                    font-weight: 500;
                    margin-bottom: 4px;
                }
                .notification-message {
                    color: #666;
                    margin-bottom: 4px;
                }
                .notification-meta {
                    color: #888;
                    font-size: 0.8rem;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .notification-actions {
                    display: flex;
                    gap: 8px;
                    align-items: start;
                }
                .new-badge {
                    background: #dc3545;
                    color: white;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 0.75rem;
                }
                .notification-item.new {
                    background: #f8f9fa;
                }
            `;
            document.head.appendChild(style);
        }

    } catch (error) {
        console.error('Error setting up notifications listener:', error);
        await this.showError('Notification Error', 'Failed to set up notifications: ' + error.message);
    }
}

    // Add this helper method if not already present
    getNotificationIcon(type) {
        const icons = {
            'info': 'bi-info-circle',
            'warning': 'bi-exclamation-triangle',
            'success': 'bi-check-circle',
            'danger': 'bi-x-circle',
            'lost': 'bi-question-circle',
            'overdue': 'bi-clock-history',
            'default': 'bi-bell'
        };
        return icons[type] || icons.default;
    }

    async getRecentActivities() {
        try {
            const snapshot = await this.db.ref('activities')
                .orderByChild('timestamp')
                .limitToLast(10)
                .once('value');
            
            const activities = [];
            snapshot.forEach(child => {
                activities.unshift({
                    id: child.key,
                    ...child.val()
                });
            });
            
            return activities.length > 0 ? activities : [{
                type: 'info',
                description: 'No recent activities',
                timestamp: Date.now()
            }];
        } catch (error) {
            console.error('Error fetching activities:', error);
            return [{
                type: 'error',
                description: 'Error loading activities',
                timestamp: Date.now()
            }];
        }
    }

    async getCategoryStats() {
        try {
            const snapshot = await this.db.ref('books').once('value');
            const categories = {};
            
            snapshot.forEach(child => {
                const book = child.val();
                categories[book.category] = (categories[book.category] || 0) + 1;
            });

            return {
                labels: Object.keys(categories),
                values: Object.values(categories)
            };
        } catch (error) {
            console.error('Error fetching category stats:', error);
            return { labels: [], values: [] };
        }
    }

    async scanBarcode() {
        // Mock barcode scanning functionality
        try {
            const barcodeInput = prompt('Enter book barcode or ISBN:');
            if (!barcodeInput) return null;
            
            // Here you would typically integrate with a real barcode scanner
            // For now, we'll just return the input
            return barcodeInput;
        } catch (error) {
            console.error('Error scanning barcode:', error);
            return null;
        }
    }

    async showLostBooks() {
        if (window.lostBooksManager) {
            window.lostBooksManager.showLostBooksModal();
        }
    }

    // One-time/repeatable repair pass: recomputes every book's `available`
    // from ground truth (quantity - lost - active issuances). Use this to fix
    // records that drifted before the shared recalculateBookAvailability()
    // helper was wired into every issue/return/lost/recovery/import path —
    // e.g. a book showing 46 available / 46 total / 1 lost.
    async repairAllBookCounts() {
        try {
            const booksSnapshot = await this.db.ref('books').once('value');
            const bookIds = [];
            booksSnapshot.forEach(child => bookIds.push(child.key));

            const before = {};
            booksSnapshot.forEach(child => { before[child.key] = child.val().available; });

            let changed = 0;
            for (const bookId of bookIds) {
                const newAvailable = await recalculateBookAvailability(bookId);
                if (newAvailable !== before[bookId]) changed++;
            }

            await this.showSuccess(
                'Book Counts Repaired',
                `Checked ${bookIds.length} books, corrected ${changed} with drifted available counts.`
            );
        } catch (error) {
            console.error('Error repairing book counts:', error);
            await this.showError('Repair Failed', `Failed to repair book counts: ${error.message}`);
        }
    }

    async showAllActivities() {
        // Implementation for showing all activities
        const activities = await this.getRecentActivities();
        // Show in a modal or navigate to activities page
        console.log('Showing all activities:', activities);
    }

    async processBulkImport(file) {
        try {
            const data = await this.readFileData(file);
            // Process the data based on file type
            if (file.name.endsWith('.csv')) {
                await this.processCSV(data);
            } else if (file.name.endsWith('.xlsx')) {
                await this.processExcel(data);
            }
        } catch (error) {
            console.error('Error processing import:', error);
            alert('Error processing file. Please check the format and try again.');
        }
    }

    async readFileData(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);

            if (file.name.endsWith('.csv')) {
                reader.readAsText(file);
            } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                reader.readAsArrayBuffer(file); // Changed from readAsBinaryString to readAsArrayBuffer
            } else {
                reject(new Error('Unsupported file format'));
            }
        });
    }

    async collectSystemData() {
        try {
            const data = {};
            const refs = { books: 'books', students: this.studentsPath, issuance: 'issuance', activities: 'activities', notifications: 'notifications' };
            
            for (const [label, path] of Object.entries(refs)) {
                const snapshot = await this.db.ref(path).once('value');
                data[label] = snapshot.val();
            }
            
            return data;
        } catch (error) {
            console.error('Error collecting system data:', error);
            throw error;
        }
    }

    renderBookCard(book, bookId) {
        const card = document.createElement('div');
        card.className = 'grid-item';
        card.innerHTML = `
            <h3>${book.grade} - ${book.title}</h3>
            <p>Subject: ${book.subject}</p>
            <p>Author: ${book.author}</p>
            <p>The International Standard Book Number (ISBN): ${book.isbn}</p>
            <p>Category: ${book.category}</p>
            <p>Available: ${book.available}/${book.quantity}</p>
            <p>Lost: ${book.lost || 0}</p>
            <div class="card-actions">
                <button onclick="bookManager.showBookModal('${bookId}')">Edit</button>
                <button onclick="bookManager.deleteBook('${bookId}')">Delete</button>
            </div>
        `;
        this.booksList.appendChild(card);
    }

    async createActivity(type, description, extra = {}) {
        try {
            await this.db.ref('activities').push({
                type,
                description,
                ...extra,
                timestamp: Date.now()
            });
            // Refresh activities display
            await this.loadRecentActivities();
        } catch (error) {
            console.error('Error creating activity:', error);
        }
    }

    // Add this new method to handle quick replies
    async handleQuickReply(issueId, studentId, bookTitle) {
        try {
            const reply = prompt(`Quick reply regarding: ${bookTitle}`);
            if (!reply) return;

            await this.db.ref(`messages/${issueId}/replies`).push({
                message: reply,
                timestamp: Date.now(),
                sender: 'librarian'
            });

            // Mark the issue as read
            await this.db.ref(`messages/${issueId}`).update({
                read: true
            });

            // Create activity
            await this.createActivity('reply', 
                `Replied to issue regarding "${bookTitle}"`
            );

            // Refresh notifications
            await this.loadNotifications();

            alert('Reply sent successfully!');
        } catch (error) {
            console.error('Error sending reply:', error);
            alert('Failed to send reply. Please try again.');
        }
    }

    // Add these methods to the DashboardFunctions class
   
async processCSV(data) {
    try {
        // Clean and validate raw data
        if (!data || typeof data !== 'string') {
            throw new Error('Invalid CSV data format');
        }

        // Split into rows and clean empty rows
        const rows = data.split(/\r?\n/).map(row => row.trim()).filter(row => row);
        
        if (rows.length < 2) {
            throw new Error('CSV file must contain a header row and at least one book entry');
        }

        // Validate and normalize headers
        const headers = rows[0].split(',').map(h => h.trim().toLowerCase());
        const requiredFields = ['title', 'isbn', 'quantity'];
        const missingFields = requiredFields.filter(field => !headers.includes(field));
        
        if (missingFields.length > 0) {
            throw new Error(`Missing required columns: ${missingFields.join(', ')}`);
        }

        const booksToUpdate = [];
        const booksToCreate = [];
        let errorRows = [];

        // Get existing books to check for duplicates and determine counter
        const existingBooksSnapshot = await this.db.ref('books').once('value');
        const existingBooksByIsbn = new Map();
        const existingIds = new Set();
        let counter = 1;

        existingBooksSnapshot.forEach(child => {
            const bookId = child.key;
            const book = child.val();
            if (bookId.startsWith('BK')) {
                existingIds.add(bookId);
                const num = parseInt(bookId.replace('BK', ''));
                if (!isNaN(num)) {
                    counter = Math.max(counter, num + 1);
                }
            }
            if (book.isbn) {
                existingBooksByIsbn.set(book.isbn, { bookId, data: book });
            }
        });

        // Process each data row
        for (let i = 1; i < rows.length; i++) {
            try {
                const values = rows[i].split(',').map(v => v.trim());
                if (values.length !== headers.length) {
                    errorRows.push(`Row ${i + 1}: Invalid number of columns`);
                    continue;
                }

                const book = {};
                let isValid = true;

                headers.forEach((header, index) => {
                    const value = values[index];
                    if (!value && requiredFields.includes(header)) {
                        errorRows.push(`Row ${i + 1}: Missing required field "${header}"`);
                        isValid = false;
                        return;
                    }

                    switch (header) {
                        case 'title':
                            book.title = value;
                            break;
                        case 'isbn':
                            if (!/^[A-Za-z0-9-]{3,17}$/.test(value)) {
                                errorRows.push(`Row ${i + 1}: Invalid ISBN format. Must be 3-17 alphanumeric characters with optional hyphens`);
                                isValid = false;
                            }
                            book.isbn = value;
                            break;
                        case 'quantity':
                            const qty = parseInt(value);
                            if (isNaN(qty) || qty <= 0) {
                                errorRows.push(`Row ${i + 1}: Invalid quantity`);
                                isValid = false;
                            }
                            book.quantity = qty;
                            book.available = qty; // Initialize available to quantity
                            break;
                        case 'publisher':
                        case 'publishyear':
                        case 'edition':
                            if (value) book[header] = value;
                            break;
                        case 'author':
                        case 'category':
                        case 'subject':
                        case 'grade':
                            if (value) book[header] = value;
                            break;
                    }
                });

                if (isValid) {
                    book.createdAt = book.createdAt || Date.now();
                    book.updatedAt = Date.now();
                    book.lost = book.lost || 0;
                    book.status = book.status || 'active';

                    if (existingBooksByIsbn.has(book.isbn)) {
                        // Update existing book
                        const { bookId, data: existingBook } = existingBooksByIsbn.get(book.isbn);
                        book.bookId = bookId;
                        book.lost = existingBook.lost || 0;
                        // Safe placeholder until the post-batch recalc below
                        // corrects it against active issuances + lost.
                        book.available = book.quantity;
                        booksToUpdate.push({ bookId, data: book });
                    } else {
                        // Create new book
                        let bookId;
                        do {
                            bookId = `BK${String(counter).padStart(3, '0')}`;
                            counter++;
                        } while (existingIds.has(bookId));

                        existingIds.add(bookId);
                        book.bookId = bookId;
                        booksToCreate.push({ bookId, data: book });
                    }
                }
            } catch (rowError) {
                errorRows.push(`Row ${i + 1}: ${rowError.message}`);
            }
        }

        if (errorRows.length > 0) {
            throw new Error(`Validation errors found:\n${errorRows.join('\n')}`);
        }

        if (booksToUpdate.length === 0 && booksToCreate.length === 0) {
            throw new Error('No valid books found in the CSV file');
        }

        // Update issuance records to reference correct bookIds
        const issuanceSnapshot = await this.db.ref('issuance').once('value');
        const issuanceUpdates = [];

        issuanceSnapshot.forEach(child => {
            const issuance = child.val();
            const issuanceId = child.key;

            // Find the bookId corresponding to the issuance's bookId or isbn
            let newBookId = issuance.bookId;
            if (!newBookId.startsWith('BK')) {
                // Try to match by ISBN
                const book = Array.from(existingBooksByIsbn.values()).find(b => b.data.isbn === issuance.isbn);
                if (book) {
                    newBookId = book.bookId;
                } else {
                    // Check if the book is in the new/updated books
                    const newBook = [...booksToUpdate, ...booksToCreate].find(b => b.data.isbn === issuance.isbn);
                    if (newBook) {
                        newBookId = newBook.bookId;
                    }
                }
            }

            if (newBookId && newBookId !== issuance.bookId) {
                issuanceUpdates.push(
                    this.db.ref(`issuance/${issuanceId}`).update({
                        bookId: newBookId,
                        bookTitle: issuance.bookTitle || (booksToUpdate.find(b => b.bookId === newBookId) || booksToCreate.find(b => b.bookId === newBookId))?.data.title || issuance.bookTitle,
                        updatedAt: Date.now()
                    })
                );
            }
        });

        // Batch update existing books, create new books, and update issuances
        const batch = [];
        
        // Update existing books
        for (const { bookId, data } of booksToUpdate) {
            batch.push(this.db.ref(`books/${bookId}`).set(data));
        }

        // Create new books
        for (const { bookId, data } of booksToCreate) {
            batch.push(this.db.ref(`books/${bookId}`).set(data));
        }

        // Include issuance updates
        batch.push(...issuanceUpdates);

        await Promise.all(batch);

        // Recompute available for every updated book from ground truth
        // (quantity - lost - active issuances) now that issuance bookId
        // references may also have shifted above.
        await Promise.all(booksToUpdate.map(({ bookId }) => recalculateBookAvailability(bookId)));

        // Create activity record and show success message
        const totalBooks = booksToUpdate.length + booksToCreate.length;
        const activityDescription = `Imported ${totalBooks} books (${booksToUpdate.length} updated, ${booksToCreate.length} created)`;
        await this.createActivity('import', activityDescription);
        await this.showSuccess('Import Success', activityDescription);
    } catch (error) {
        console.error('Error processing CSV:', error);
        throw new Error(error.message || 'Failed to process CSV file');
    }
}

    async processExcel(data) {
        throw new Error('Excel processing not implemented yet');
    }

    async handleBulkIssuance() {
        try {
            const modal = new bootstrap.Modal(document.getElementById('bulkIssuanceModal'));
            const fileInput = document.getElementById('bulkIssuanceFile');
            const confirmBtn = document.getElementById('confirmBulkIssuance');

            confirmBtn.onclick = async () => {
                const file = fileInput.files[0];
                if (!file) {
                    alert('Please select a file to import');
                    return;
                }

                try {
                    const data = await this.readFileData(file);
                    if (file.name.endsWith('.csv')) {
                        await this.processBulkIssuanceCSV(data);
                    } else if (file.name.endsWith('.xlsx')) {
                        await this.processBulkIssuanceExcel(data);
                    }
                    modal.hide();
                } catch (error) {
                    console.error('Error processing bulk issuance:', error);
                    alert('Error processing file. Please check the format and try again.');
                }
            };

            modal.show();
        } catch (error) {
            console.error('Error initializing bulk issuance:', error);
            alert('Failed to initialize bulk issuance. Please try again.');
        }
    }

    async processBulkIssuanceCSV(data) {
        try {
            const rows = data.split('\n');
            const headers = rows[0].toLowerCase().split(',').map(h => h.trim());
            const issuances = [];

            for (let i = 1; i < rows.length; i++) {
                if (!rows[i].trim()) continue;
                
                const values = rows[i].split(',').map(v => v.trim());
                const issuance = {
                    studentId: values[headers.indexOf('studentid')],
                    studentName: values[headers.indexOf('studentname')],
                    grade: values[headers.indexOf('grade')],
                    gender: values[headers.indexOf('gender')],
                    upi: values[headers.indexOf('upi')],
                    bookId: values[headers.indexOf('bookid')],
                    bookTitle: values[headers.indexOf('booktitle')],
                    issueDate: values[headers.indexOf('issuedate')],
                    returnDate: values[headers.indexOf('returndate')],
                    status: 'active',
                    timestamp: Date.now()
                };

                if (issuance.studentId && issuance.bookId) {
                    issuances.push(issuance);
                }
            }

            await this.processIssuances(issuances);
        } catch (error) {
            throw new Error('Failed to process CSV file: ' + error.message);
        }
    }

    async processBulkIssuanceExcel(data) {
        try {
            // Convert ArrayBuffer to Uint8Array for XLSX.js
            const arr = new Uint8Array(data);
            const workbook = XLSX.read(arr, { type: 'array' }); // Changed type to 'array'
            
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(worksheet);
            
            const issuances = rows.map(row => ({
                studentId: row.StudentID?.toString(),
                studentName: row.StudentName?.toString(),
                isbn: row.ISBN?.toString(),
                grade: row.Grade?.toString(),
                upi: row.UPI?.toString(),
                gender: row.Gender?.toString(),
                bookId: row.BookID?.toString(),
                bookTitle: row.BookTitle?.toString(),
                issueDate: row.IssueDate,
                returnDate: row.ReturnDate,
                status: 'active',
                timestamp: Date.now()
            })).filter(issuance => issuance.studentId && issuance.bookId);

            await this.processIssuances(issuances);
        } catch (error) {
            console.error('Excel processing error:', error);
            throw new Error('Failed to process Excel file: ' + error.message);
        }
    }

   async processIssuances(issuances) {
    try {
        const batch = [];
        const touchedBookIds = new Set();
        // Tracks copies claimed so far within this batch, so two rows
        // issuing the same book don't both pass the availability check
        // against the same stale pre-batch `available` read.
        const pendingIssuedByBook = {};
        const studentIds = new Set();
        let successCount = 0;
        let errorMessages = [];
        let newStudentsCount = 0;

        for (const issuance of issuances) {
            try {
                // Check for duplicate student IDs
                if (studentIds.has(issuance.studentId)) {
                    await Swal.fire({
                        icon: 'error',
                        title: 'Duplicate Student ID',
                        text: `Student ID ${issuance.studentId} found multiple times. Each student ID must be unique.`
                    });
                    continue;
                }
                studentIds.add(issuance.studentId);

                // Verify custom identifier format (e.g., ENG001)
                // if (!/^[A-Z]{3}[0-9]{3}$/.test(issuance.isbn)) {
                //     errorMessages.push(`Invalid book identifier format for Student ID ${issuance.studentId}. Expected format: ABC123`);
                //     continue;
                // }

                if (!/^[A-Za-z0-9-]{3,17}$/.test(issuance.isbn)) {
                    errorMessages.push(`Invalid ISBN format for Student ID ${issuance.studentId}. The ISBN must be alphanumeric with hyphens and 3-17 characters. You can adjust it based on your ISBN format requirements (e.g., ISBN-10 or ISBN-13).`);
                    continue;
                }

                // Verify book exists and is available
                const bookSnapshot = await this.db.ref(`books/${issuance.bookId}`).once('value');
                const book = bookSnapshot.val();
                
                if (!book) {
                    errorMessages.push(`Book ID ${issuance.bookId} not found`);
                    continue;
                }

                if (!book.available || book.available <= (pendingIssuedByBook[issuance.bookId] || 0)) {
                    errorMessages.push(`Book "${book.title}" is not available`);
                    continue;
                }

                // Check if student exists, if not, create new student
                const studentSnapshot = await this.db.ref(`${this.studentsPath}/${issuance.studentId}`).once('value');
                let student = studentSnapshot.val();
                
                if (!student) {
                    // Written with the real schema's field names (as used by
                    // app.js's StudentManager: "Official Student Name", "Grade", etc.)
                    student = {
                        'Official Student Name': issuance.studentName,
                        'Grade': issuance.grade,
                        'UPI': issuance.upi,
                        'Assessment No': issuance.studentId,
                        'Gender': issuance.gender,
                        createdAt: Date.now(),
                        status: 'active'
                    };

                    if (!student['Official Student Name'] || !student['Grade'] || !student['UPI'] || !student['Gender']) {
                        errorMessages.push(`Missing required student information for ID ${issuance.studentId}`);
                        continue;
                    }

                    batch.push(
                        this.db.ref(`${this.studentsPath}/${issuance.studentId}`).set(student)
                    );
                    newStudentsCount++;
                    student = normalizeStudent(student);
                } else {
                    student = normalizeStudent(student);
                    // Verify student isn't already issued this book
                    const existingIssuance = await this.db.ref('issuance')
                        .orderByChild('studentId')
                        .equalTo(issuance.studentId)
                        .once('value');
                        
                    let hasActiveIssuance = false;
                    existingIssuance.forEach(child => {
                        const issue = child.val();
                        if (issue.status === 'active' && issue.bookId === issuance.bookId) {
                            hasActiveIssuance = true;
                        }
                    });

                    if (hasActiveIssuance) {
                        errorMessages.push(`Student ${student.name} already has an active issuance for this book`);
                        continue;
                    }
                }

                // Track which books this batch touches so we can recompute
                // their available count from ground truth once everything's
                // written, instead of hand-decrementing a running total here.
                touchedBookIds.add(issuance.bookId);
                pendingIssuedByBook[issuance.bookId] = (pendingIssuedByBook[issuance.bookId] || 0) + 1;
                
                // Create issuance record with ISBN
                const verifiedIssuance = {
                    studentId: issuance.studentId,
                    studentName: student.name,
                    grade: student.grade,
                    upi: student.upi,
                    bookId: issuance.bookId,
                    bookTitle: book.title,
                    isbn: issuance.isbn, // Include ISBN
                    issueDate: issuance.issueDate || new Date().toISOString().split('T')[0],
                    returnDate: issuance.returnDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    status: 'active',
                    timestamp: Date.now()
                };
                
                batch.push(
                    this.db.ref('issuance').push(verifiedIssuance)
                );
                successCount++;
            } catch (error) {
                console.error('Error processing issuance:', error);
                await Swal.fire({
                    icon: 'error',
                    title: 'Processing Error',
                    text: `Error processing issuance for Student ID ${issuance.studentId}: ${error.message}`
                });
            }
        }

        // Process all updates if any successful issuances
        if (successCount > 0) {
            await Promise.all(batch);

            // Recompute available for every touched book from ground truth
            // (quantity - lost - active issuances) now that the issuances
            // above are written.
            await Promise.all([...touchedBookIds].map(bookId => recalculateBookAvailability(bookId)));

            // Create activity record
            await this.createActivity('bulk-issue', 
                `Bulk issued ${successCount} books${newStudentsCount > 0 ? ` and added ${newStudentsCount} new students` : ''}`
            );
        }

        // Show results with SweetAlert2
        if (successCount > 0 || newStudentsCount > 0) {
            let html = '';
            if (successCount > 0) {
                html += `<p>Successfully processed ${successCount} issuances</p>`;
            }
            if (newStudentsCount > 0) {
                html += `<p>Added ${newStudentsCount} new students</p>`;
            }

            await Swal.fire({
                icon: 'success',
                title: 'Success',
                html: html
            });
        }

        if (errorMessages.length > 0) {
            await Swal.fire({
                icon: 'warning',
                title: 'Errors Encountered',
                html: errorMessages.map(msg => `<p>${msg}</p>`).join(''),
                confirmButtonText: 'OK'
            });
        }

        if (successCount === 0) {
            throw new Error('No valid issuances were processed');
        }
    } catch (error) {
        console.error('Failed to process issuances:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Processing Failed',
            text: 'Failed to process issuances: ' + error.message,
            confirmButtonText: 'OK'
        });
    }
}

    downloadIssuanceTemplate() {
        const template = [
            ['StudentID', 'StudentName', 'Grade', 'Gender','UPI', 'BookID', 'BookTitle', 'IssueDate', 'ReturnDate'],
            ['STD001', 'AKATCH SAMUEL ODHIAMBO', 'Grade 4','Male', 'UPI123', 'BK001', 'Mathematics Book', '2025-06-03', '2025-09-17']
        ];
        
        const ws = XLSX.utils.aoa_to_sheet(template);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Issuance Template');
        XLSX.writeFile(wb, 'bulk_issuance_template.xlsx');
    }

    downloadBulkTemplate() {
        const template = [
            ['Title', 'ISBN', 'Author', 'Category', 'Subject', 'Grade', 'Quantity', 'Publisher', 'PublishYear', 'Edition'],
            ['English Textbook', 'BK001', 'KICD', 'Textbook', 'English', 'Grade 4', '45', 'Oxford', '2023', '1st'],
            ['Agriculture and Nutrition- MTP', 'BK002', 'KICD', 'Textbook', 'Science', 'Grade 4', '45', 'Cambridge', '2023', '2nd'],
            ['Creative Art', 'BK003', 'KICD', 'Textbook', 'Art', 'Grade 4', '45', 'Cambridge', '2023', '2nd']
        ];
        
        const ws = XLSX.utils.aoa_to_sheet(template);
        
        // Set column widths
        ws['!cols'] = [
            { wch: 30 }, // Title
            { wch: 15 }, // ISBN
            { wch: 20 }, // Author
            { wch: 15 }, // Category
            { wch: 15 }, // Subject
            { wch: 10 }, // Grade
            { wch: 10 }, // Quantity
            { wch: 15 }, // Publisher
            { wch: 12 }, // PublishYear
            { wch: 10 }  // Edition
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Books Template');
        XLSX.writeFile(wb, 'bulk_books_template.csv');
    }

    // Add these utility methods at the beginning of the DashboardFunctions class
    async showMessage(config) {
        return Swal.fire({
            confirmButtonText: 'OK',
            ...config
        });
    }

    async showError(title, error) {
        console.error(title, error);
        return this.showMessage({
            icon: 'error',
            title: title,
            text: error.message || 'An unexpected error occurred'
        });
    }

  async showSuccess(title, message) {
    return this.showMessage({
        icon: 'warning',
        title: title,
        text: message,
        timer: 1000,
        timerProgressBar: true,
        showConfirmButton: false
    });
}

    async showWarning(title, message) {
        return this.showMessage({
            icon: 'warning',
            title: title,
            timer: 2000,
            text: message
        });
    }

    async showConfirm(title, message) {
        return Swal.fire({
            icon: 'question',
            title: title,
            text: message,
            showCancelButton: true,
            confirmButtonText: 'Yes',
            cancelButtonText: 'No'
        });
    }

    initGlobalModal() {
        this.globalModal = new bootstrap.Modal(document.getElementById('globalModal'));
        this.modalTitle = document.querySelector('#globalModal .modal-title');
        this.modalBody = document.querySelector('#globalModal .modal-body');
        this.modalConfirm = document.getElementById('globalModalConfirm');
    }

    showGlobalModal({ title, content, onConfirm, showConfirmButton = true }) {
        this.modalTitle.textContent = title;
        this.modalBody.innerHTML = content;
        
        // Handle confirm button
        if (showConfirmButton) {
            this.modalConfirm.style.display = '';
            this.modalConfirm.onclick = () => {
                if (onConfirm) onConfirm();
                this.globalModal.hide();
            };
        } else {
            this.modalConfirm.style.display = 'none';
        }
        
        this.globalModal.show();
    }

    async populateQuickIssueSelects() {
        const studentSelect = document.getElementById('quickStudent');
        const bookSelect = document.getElementById('quickBook');
        
        // Populate students (from the synced cache — no fresh network read)
        StudentsCache.getAll().forEach((student, studentId) => {
            const option = document.createElement('option');
            option.value = studentId;
            option.textContent = `${student.name} - ${student.grade} (${student.assessmentNo || 'No ID'})`;
            studentSelect.appendChild(option);
        });
        
        // Populate books
        const booksSnapshot = await this.db.ref('books').once('value');
        booksSnapshot.forEach(childSnapshot => {
            const book = childSnapshot.val();
            if (book.available > 0) {
                const option = document.createElement('option');
                option.value = childSnapshot.key;
                option.textContent = `${book.title} (${book.available} available)`;
                bookSelect.appendChild(option);
            }
        });
    }

    async populateQuickReturnSelect() {
        const issuanceSelect = document.getElementById('quickReturnIssuance');
        
        const issuanceSnapshot = await this.db.ref('issuance')
            .orderByChild('status')
            .equalTo('active')
            .once('value');
        
        const promises = [];
        issuanceSnapshot.forEach(childSnapshot => {
            const issuance = childSnapshot.val();
            const student = StudentsCache.get(issuance.studentId);
            promises.push(
                getBookCached(issuance.bookId).then(book => {
                    if (student && book) {
                        const option = document.createElement('option');
                        option.value = childSnapshot.key;
                        option.dataset.bookId = issuance.bookId;
                        option.textContent = `${student.name} - ${book.title} (Due: ${issuance.returnDate})`;
                        issuanceSelect.appendChild(option);
                    }
                })
            );
        });

        await Promise.all(promises);
    }

    // Add this method to the DashboardFunctions class
    async markNotificationResolved(notificationId) {
        try {
            const result = await this.showConfirm(
                'Resolve Notification',
                'Are you sure you want to mark this notification as resolved?'
            );

            if (result.isConfirmed) {
                // Get the notification details
                const snapshot = await this.db.ref(`messages/${notificationId}`).once('value');
                const notification = snapshot.val();

                if (!notification) {
                    throw new Error('Notification not found');
                }

                // Update the notification status
                await this.db.ref(`messages/${notificationId}`).update({
                    status: 'resolved',
                    resolvedAt: Date.now(),
                    resolvedBy: 'librarian', // You might want to get this from user session
                    read: true
                });

                // Create activity record
                await this.createActivity('resolve', 
                    `Resolved notification regarding "${notification.bookTitle || 'Unknown Book'}"`
                );

                // Refresh notifications list
                await this.loadNotifications();

                await this.showSuccess(
                    'Success', 
                    'Notification has been marked as resolved'
                );
            }
        } catch (error) {
            await this.showError(
                'Resolution Failed',
                error
            );
        }
    }

    // Add these methods to the DashboardFunctions class
    async showNotificationDetails(notificationId) {
        try {
            const snapshot = await this.db.ref(`messages/${notificationId}`).once('value');
            const notification = snapshot.val();
            
            if (!notification) throw new Error('Notification not found');

            // Format message content
            const messageContent = notification.type === 'issue' ? 
                `${notification.description || 'No description provided'}` :
                `${notification.message || 'No message content'}`;

            const formattedContent = `
                <div class="notification-detail p-3">
                    <div class="notification-header mb-3 d-flex justify-content-between align-items-center">
                        <h5 class="mb-0">${notification.bookTitle || 'No Title'}</h5>
                        <span class="badge bg-${notification.status === 'resolved' ? 'success' : 'warning'}">
                            ${notification.status || 'pending'}
                        </span>
                    </div>
                    <div class="notification-info mb-3">
                        <p class="mb-2"><strong>From:</strong> ${notification.studentName} (${notification.studentGrade})</p>
                        <p class="mb-2"><strong>Subject:</strong> ${notification.subject || notification.type || 'No subject'}</p>
                        <p class="mb-0"><strong>Date:</strong> ${new Date(notification.timestamp).toLocaleString()}</p>
                    </div>
                    <div class="notification-message p-3 bg-light rounded">
                        <p class="mb-0">
                            <strong>Message:</strong><br>
                            ${messageContent}
                        </p>
                    </div>
                    ${notification.notes ? `
                        <div class="notification-notes mt-3">
                            <h6>Additional Notes:</h6>
                            <p class="mb-0">${notification.notes}</p>
                        </div>
                    ` : ''}
                </div>
            `;

            await this.showGlobalModal({
                title: 'Notification Details',
                content: formattedContent,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('Error showing notification details:', error);
            await this.showError('Error', 'Failed to load notification details');
        }
    }

    async reportBookLost(bookId, issuanceId = null) {
        try {
            // Get book details first
            const bookSnapshot = await this.db.ref(`books/${bookId}`).once('value');
            const book = bookSnapshot.val();
            
            if (!book) {
                throw new Error('Book not found');
            }

            let activeIssuance = null;

            if (issuanceId) {
                // Came from a specific activity/issuance entry — use exactly
                // that record instead of guessing which copy is meant.
                const issuanceSnap = await this.db.ref(`issuance/${issuanceId}`).once('value');
                activeIssuance = issuanceSnap.val();
                if (!activeIssuance || activeIssuance.status !== 'active') {
                    activeIssuance = null;
                    issuanceId = null;
                }
            }

            if (!issuanceId) {
                // No specific issuance given (older activity entry, or called
                // without one) — only auto-pick one if there's exactly one
                // active issuance of this book, so we never risk attributing
                // a loss to the wrong student when several copies are out.
                const issuanceSnapshot = await this.db.ref('issuance')
                    .orderByChild('bookId')
                    .equalTo(bookId)
                    .once('value');

                const activeMatches = [];
                issuanceSnapshot.forEach(child => {
                    const issuance = child.val();
                    if (issuance.status === 'active') {
                        activeMatches.push({ id: child.key, data: issuance });
                    }
                });

                if (activeMatches.length > 1) {
                    await this.showWarning(
                        'Multiple Copies Issued',
                        `"${book.title}" has ${activeMatches.length} copies currently issued to different students. Report the loss from the specific student's entry in the Issuance list so it's attributed correctly.`
                    );
                    return;
                }

                if (activeMatches.length === 1) {
                    issuanceId = activeMatches[0].id;
                    activeIssuance = activeMatches[0].data;
                }
            }

            const result = await Swal.fire({
                title: 'Report Book Lost',
                html: `
                    <div class="mb-3">
                        <p>Book Details:</p>
                        <ul class="list-unstyled">
                            <li><strong>Title:</strong> ${book.title}</li>
                            <li><strong>ISBN:</strong> ${book.isbn}</li>
                            ${activeIssuance ? `
                                <li><strong>Issued To:</strong> ${activeIssuance.studentName}</li>
                                <li><strong>Issue Date:</strong> ${activeIssuance.issueDate}</li>
                            ` : ''}
                        </ul>
                    </div>
                    <div class="mb-3">
                        <label class="form-label">Additional Notes (optional)</label>
                        <textarea id="lostNotes" class="form-control" rows="3"></textarea>
                    </div>
                `,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Yes, report lost',
                cancelButtonText: 'Cancel'
            });

            if (result.isConfirmed) {
                const notes = document.getElementById('lostNotes')?.value;
                const updates = {};
                const timestamp = Date.now();

                // Update book stats
                updates[`books/${bookId}`] = {
                    ...book,
                    lost: (book.lost || 0) + 1,
                    updatedAt: timestamp
                };

                // Update issuance if exists
                if (issuanceId && activeIssuance) {
                    updates[`issuance/${issuanceId}`] = {
                        ...activeIssuance,
                        status: 'lost',
                        lostDate: new Date().toISOString(),
                        updatedAt: timestamp
                    };
                }

                // Create issue record
                const issueRef = this.db.ref('messages').push();
                updates[`messages/${issueRef.key}`] = {
                    type: 'lost',
                    bookId,
                    bookTitle: book.title,
                    studentId: activeIssuance?.studentId,
                    studentName: activeIssuance?.studentName,
                    message: `Book "${book.title}" reported as lost`,
                    notes: notes || '',
                    status: 'active',
                    timestamp,
                    read: false
                };

                // Create activity record
                const activityRef = this.db.ref('activities').push();
                updates[`activities/${activityRef.key}`] = {
                    type: 'lost',
                    bookId,
                    studentId: activeIssuance?.studentId,
                    description: `Book "${book.title}" reported as lost${activeIssuance ? ` from ${activeIssuance.studentName}` : ''}`,
                    timestamp,
                    notes: notes || ''
                };

                // Perform all updates in a single transaction
                await this.db.ref().update(updates);
                // Recompute available from ground truth now that lost is up
                // and (if applicable) the issuance moved out of 'active'.
                await recalculateBookAvailability(bookId);

                await this.showSuccess(
                    'Book Reported Lost',
                    'The book has been marked as lost and notification created'
                );

                // Refresh relevant UI components
                await Promise.all([
                    this.loadNotifications(),
                    this.loadRecentActivities()
                ]);
            }
        } catch (error) {
            console.error('Error reporting book as lost:', error);
            await this.showError(
                'Report Failed',
                `Failed to report book as lost: ${error.message}`
            );
        }
    }

    // Add this method to the DashboardFunctions class
    async handleQuickReply(notificationId) {
        try {
            const snapshot = await this.db.ref(`messages/${notificationId}`).once('value');
            const notification = snapshot.val();
            
            if (!notification) throw new Error('Notification not found');

            // Get conversation history
            const replies = notification.replies || {};
            const repliesHtml = Object.entries(replies).map(([key, reply]) => `
                <div class="chat-message ${reply.sender === 'librarian' ? 'librarian' : 'student'}">
                    <div class="chat-icon">
                        <i class="bi ${reply.sender === 'librarian' ? 'bi-person-badge' : 'bi-person'}"></i>
                    </div>
                    <div class="chat-content">
                        <div class="message">${reply.message}</div>
                        <small class="timestamp">${new Date(reply.timestamp).toLocaleString()}</small>
                    </div>
                </div>
            `).join('');

            // Show modal with conversation history and reply form
            this.showGlobalModal({
                title: `Reply to Notification: ${notification.bookTitle || 'Unknown Book'}`,
                content: `
                    <div class="chat-container mb-3">
                        <div class="original-message">
                            <div class="chat-message student">
                                <div class="chat-icon">
                                    <i class="bi bi-person"></i>
                                </div>
                                <div class="chat-content">
                                    <div class="message">${notification.message}</div>
                                    <small class="timestamp">${new Date(notification.timestamp).toLocaleString()}</small>
                                </div>
                            </div>
                        </div>
                        <div class="replies-history">
                            ${repliesHtml}
                        </div>
                    </div>
                    <div class="reply-form">
                        <textarea id="replyMessage" class="form-control mb-2" rows="3" 
                                placeholder="Type your reply here..."></textarea>
                    </div>
                `,
                onConfirm: async () => {
                    const replyMessage = document.getElementById('replyMessage').value.trim();
                    if (!replyMessage) {
                        await this.showWarning('Empty Reply', 'Please enter a message to reply');
                        return;
                    }

                    await this.db.ref(`messages/${notificationId}/replies`).push({
                        message: replyMessage,
                        timestamp: Date.now(),
                        sender: 'librarian'
                    });

                    // Mark as read
                    await this.db.ref(`messages/${notificationId}`).update({
                        read: true,
                        lastRepliedAt: Date.now()
                    });

                    // Create activity
                    await this.createActivity('reply', 
                        `Replied to notification regarding "${notification.bookTitle || 'Unknown Book'}"`
                    );

                    // Refresh notifications
                    await this.loadNotifications();
                    await this.showSuccess('Success', 'Reply sent successfully');
                }
            });

            // Add chat styles
            const style = document.createElement('style');
            style.textContent = `
                .chat-container {
                    max-height: 300px;
                    overflow-y: auto;
                    padding: 10px;
                    background: #f8f9fa;
                    border-radius: 8px;
                }
                .chat-message {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 15px;
                }
                .chat-icon {
                    width: 35px;
                    height: 35px;
                    background: #e9ecef;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .chat-icon i {
                    font-size: 1.2rem;
                }
                .chat-content {
                    flex: 1;
                }
                .chat-message.librarian {
                    flex-direction: row-reverse;
                }
                .chat-message.librarian .chat-content {
                    text-align: right;
                }
                .chat-message .message {
                    padding: 8px 12px;
                    border-radius: 8px;
                    display: inline-block;
                    max-width: 80%;
                }
                .chat-message.student .message {
                    background: #e9ecef;
                }
                .chat-message.librarian .message {
                    background: #cfe2ff;
                }
                .chat-message .timestamp {
                    display: block;
                    color: #6c757d;
                    font-size: 0.8rem;
                    margin-top: 4px;
                }
                .original-message {
                    border-bottom: 1px solid #dee2e6;
                    margin-bottom: 15px;
                    padding-bottom: 15px;
                }
                .reply-form {
                    margin-top: 15px;
                    border-top: 1px solid #dee2e6;
                    padding-top: 15px;
                }
            `;
            document.head.appendChild(style);

        } catch (error) {
            await this.showError('Reply Error', error);
        }
    }

    // Add this method to the DashboardFunctions class
  async deleteNotification(notificationId) {
    try {
        // Show confirmation dialog
        const result = await Swal.fire({
            title: 'Delete Notification',
            text: 'Are you sure you want to delete this notification? This action cannot be undone.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Yes, delete it',
            cancelButtonText: 'Cancel'
        });

        if (result.isConfirmed) {
            // Get notification details for activity log
            const snapshot = await this.db.ref(`messages/${notificationId}`).once('value');
            if (!snapshot.exists()) {
                throw new Error('Notification not found');
            }
            const notification = snapshot.val();

            // Delete the notification from the messages node
            await this.db.ref(`messages/${notificationId}`).remove();

            // Remove the notification element from DOM immediately
            const notificationElement = document.querySelector(`[data-id="${notificationId}"]`);
            if (notificationElement) {
                notificationElement.remove();
            }

            // Create activity record
            await this.createActivity('delete', 
                `Deleted ${notification.type || 'issue'} notification for ${notification.studentName || 'Unknown Student'} regarding ${notification.subject || 'unknown issue'}`
            );

            // Show success message
            await this.showSuccess(
                'Success', 
                'Notification deleted successfully'
            );
        }
    } catch (error) {
        console.error('Error deleting notification:', error);
        await this.showError(
            'Delete Failed',
            `Failed to delete notification: ${error.message}`
        );
    }
}

    // Add this method to the DashboardFunctions class
    async deleteActivity(activityId) {
        try {
            const result = await Swal.fire({
                title: 'Delete Activity',
                text: 'Are you sure you want to delete this activity? This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#dc3545',
                cancelButtonColor: '#6c757d',
                confirmButtonText: 'Yes, delete it',
                cancelButtonText: 'Cancel'
            });

            if (result.isConfirmed) {
                // Get activity details for proper cleanup
                const snapshot = await this.db.ref(`activities/${activityId}`).once('value');
                const activity = snapshot.val();

                if (!activity) throw new Error('Activity not found');

                // Delete the activity
                await this.db.ref(`activities/${activityId}`).remove();

                // Remove the activity element from DOM immediately
                const activityElement = document.querySelector(`[data-activity-id="${activityId}"]`);
                if (activityElement) {
                    activityElement.remove();
                }

                // Show success message
                await this.showSuccess(
                    'Activity Deleted',
                    'The activity has been successfully deleted'
                );
            }
        } catch (error) {
            console.error('Error deleting activity:', error);
            await this.showError(
                'Delete Failed',
                'Failed to delete activity: ' + error.message
            );
        }
    }

    // One-click clear for the whole 'activities' node (Recent Activities panel).
    async clearAllActivities() {
        try {
            const result = await Swal.fire({
                title: 'Clear All Activities',
                text: 'This will permanently delete every recorded activity. This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#dc3545',
                cancelButtonColor: '#6c757d',
                confirmButtonText: 'Yes, clear all',
                cancelButtonText: 'Cancel'
            });

            if (result.isConfirmed) {
                await this.db.ref('activities').remove();
                await this.loadRecentActivities();
                await this.showSuccess('Cleared', 'All activities have been deleted');
            }
        } catch (error) {
            console.error('Error clearing activities:', error);
            await this.showError('Clear Failed', 'Failed to clear activities: ' + error.message);
        }
    }

    // One-click clear for the whole 'messages' node (Important Notifications
    // panel). Same underlying node message.js's Messages page manages, so
    // this clears the librarian inbox too, not just this dashboard widget.
    async clearAllNotifications() {
        try {
            const result = await Swal.fire({
                title: 'Clear All Notifications',
                text: 'This will permanently delete every notification/message, including any in the Messages page. This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#dc3545',
                cancelButtonColor: '#6c757d',
                confirmButtonText: 'Yes, clear all',
                cancelButtonText: 'Cancel'
            });

            if (result.isConfirmed) {
                await this.db.ref('messages').remove();
                await this.showSuccess('Cleared', 'All notifications have been deleted');
            }
        } catch (error) {
            console.error('Error clearing notifications:', error);
            await this.showError('Clear Failed', 'Failed to clear notifications: ' + error.message);
        }
    }

    getActivityIcon(type) {
        const icons = {
            'issue': 'bi-arrow-right-circle',
            'return': 'bi-arrow-left-circle',
            'lost': 'bi-exclamation-triangle',
            'found': 'bi-check-circle',
            'import': 'bi-file-earmark-arrow-up',
            'resolve': 'bi-check-square',
            'reply': 'bi-reply',
            'delete': 'bi-trash',
            'bulk-issue': 'bi-collection',
            'mark-found': 'bi-search',
            'default': 'bi-clock-history'
        };
        return icons[type] || icons.default;
    }

    // Add this method to the DashboardFunctions class
    async deleteBookCollection() {
        try {
            const result = await Swal.fire({
                title: 'Delete Book Collection',
                text: 'Are you sure you want to delete all books? This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Yes, delete all',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#dc3545'
            });

            if (result.isConfirmed) {
                // Get all active issuances first
                const issuanceSnapshot = await this.db.ref('issuance')
                    .orderByChild('status')
                    .equalTo('active')
                    .once('value');

                if (!issuanceSnapshot.exists()) {
                    // Delete all books
                    await this.db.ref('books').remove();
                    
                    // Create activity record
                    await this.createActivity('delete', 'Deleted entire book collection');
                    
                    await this.showSuccess('Success', 'Book collection has been deleted');
                } else {
                    throw new Error('Cannot delete collection while books are issued to students');
                }
            }
        } catch (error) {
            await this.showError('Delete Failed', error);
        }
    }
}

// Initialize dashboard functions
document.addEventListener('DOMContentLoaded', () => {
    window.dashboardFunctions = new DashboardFunctions();
});