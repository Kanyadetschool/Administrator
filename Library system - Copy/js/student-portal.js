firebase.initializeApp(firebaseConfig);
const db = firebase.database();

class StudentPortal {
    constructor() {
        // Initialize Firebase services as class properties
        this.db = firebase.database();

        this.loginPage = document.getElementById('loginPage');
        this.loginForm = document.getElementById('loginForm');
        this.dashboardContent = document.getElementById('dashboardContent');
        this.logoutBtn = document.getElementById('logoutBtn');
        this.studentData = null;
        this.bookListeners = [];
        this.messageListener = null;

        if (!this.loginPage || !this.loginForm || !this.dashboardContent || !this.logoutBtn) {
            console.error('Required elements not found');
            document.body.innerHTML = '<div class="alert alert-danger">Error: Required page elements are missing. Please contact support.</div>';
            return;
        }

        this.loginPage.classList.remove('d-none');
        this.dashboardContent.classList.add('d-none');

        this.currentView = 'dashboard';
        this.views = ['dashboard', 'activeBooks', 'messages', 'history', 'browse'];
        
        this.setupEventListeners();
        this.setupSearchListener();
        this.setupDashboardStatsHandlers();
    }

    // Add this method to handle search functionality
    setupSearchListener() {
        document.addEventListener('DOMContentLoaded', () => {
            const searchInput = document.querySelector('#activeBooksView input[type="text"]');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    this.filterActiveBooks(e.target.value);
                });
            }
        });
    }

    // Add this method to filter active books
    filterActiveBooks(searchTerm) {
        const container = document.querySelector('#activeBooksView .row');
        if (!container) return;

        const bookCards = container.querySelectorAll('.book-result');
        const normalizedSearch = searchTerm.toLowerCase().trim();

        bookCards.forEach(card => {
            const title = card.querySelector('.card-title')?.textContent.toLowerCase() || '';
            const rest = card.textContent.toLowerCase();

            const isMatch = title.includes(normalizedSearch) ||
                           rest.includes(normalizedSearch);

            card.style.display = isMatch ? 'block' : 'none';
        });

        const existingNoResults = container.querySelector('.no-results-message');
        if (existingNoResults) {
            existingNoResults.remove();
        }

        const visibleCards = container.querySelectorAll('.book-result[style*="block"], .book-result:not([style*="none"])');
        if (visibleCards.length === 0 && normalizedSearch) {
            const noResultsDiv = document.createElement('div');
            noResultsDiv.className = 'col-12 text-center text-muted no-results-message';
            noResultsDiv.innerHTML = `<p>No books found matching "${searchTerm}"</p>`;
            container.appendChild(noResultsDiv);
        }
    }

    // Add this method to setup dashboard stats click handlers
    setupDashboardStatsHandlers() {
        document.addEventListener('DOMContentLoaded', () => {
            const statsElements = {
                totalBooks: 'all',
                activeBooks: 'active',
                overdueBooks: 'overdue',
                lostBooks: 'lost'
            };

            Object.entries(statsElements).forEach(([elementId, filter]) => {
                const element = document.getElementById(elementId);
                if (element) {
                    element.style.cursor = 'pointer';
                    element.addEventListener('click', () => {
                        this.showFilteredBooks(filter);
                    });
                }
            });
        });
    }

    // Add this method to show filtered books
    async showFilteredBooks(filter) {
        try {
            this.switchView('activeBooks');

            const issuanceSnapshot = await this.db.ref('issuance')
                .orderByChild('studentId')
                .equalTo(this.studentData.id)
                .once('value');

            const container = document.querySelector('#activeBooksView .row');
            if (!container) return;

            const filteredBooks = [];
            const currentDate = new Date();

            issuanceSnapshot.forEach(child => {
                const issuance = child.val();
                let shouldInclude = false;

                switch(filter) {
                    case 'all':
                        shouldInclude = true;
                        break;
                    case 'active':
                        shouldInclude = issuance.status === 'active';
                        break;
                    case 'overdue':
                        shouldInclude = issuance.status === 'active' && 
                                      new Date(issuance.returnDate) < currentDate;
                        break;
                    case 'lost':
                        shouldInclude = issuance.status === 'lost';
                        break;
                }

                if (shouldInclude) {
                    filteredBooks.push(this.loadBookDetails(issuance, child.key));
                }
            });

            if (filteredBooks.length === 0) {
                container.innerHTML = `<div class="col-12 text-center text-muted">No ${filter} books found</div>`;
                return;
            }

            const bookCards = await Promise.all(filteredBooks);
            container.innerHTML = bookCards.join('');

            const titleElement = document.querySelector('#activeBooksView h4');
            if (titleElement) {
                const filterNames = {
                    'all': 'All Books',
                    'active': 'Active Books',
                    'overdue': 'Overdue Books',
                    'lost': 'Lost Books'
                };
                titleElement.textContent = filterNames[filter] || 'Active Books';
            }
        } catch (error) {
            console.error('Error loading filtered books:', error);
        }
    }

    setupEventListeners() {
        this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        this.logoutBtn.addEventListener('click', () => this.handleLogout());

        document.querySelectorAll('.nav-link:not(.logout-link)').forEach(link => {
            link.addEventListener('click', (e) => {
                const view = e.currentTarget.dataset.view;
                this.switchView(view);
            });
        });

        const printBtn = document.getElementById('printRecordBtn');
        if (printBtn) {
            printBtn.addEventListener('click', () => this.printRecord());
        }
    }

    setupMessageListener() {
        if (this.messageListener) {
            this.db.ref('messages').off('value', this.messageListener);
        }

        if (this.studentData?.id) {
            this.messageListener = this.db.ref('messages')
                .orderByChild('studentId')
                .equalTo(this.studentData.id)
                .on('value', () => {
                    this.loadMessages();
                });
        }
    }

    setupRealtimeListeners() {
        this.removeRealtimeListeners();

        if (!this.studentData?.id) return;

        const issuanceListener = this.db.ref('issuance')
            .orderByChild('studentId')
            .equalTo(this.studentData.id)
            .on('value', (snapshot) => {
                this.loadStudentData();
            });

        const booksListener = this.db.ref('books').on('value', (snapshot) => {
            if (this.currentView === 'dashboard' || this.currentView === 'activeBooks') {
                this.loadStudentData();
            }
        });

        this.bookListeners = [
            { ref: 'issuance', listener: issuanceListener },
            { ref: 'books', listener: booksListener }
        ];
    }

    removeRealtimeListeners() {
        if (this.bookListeners) {
            this.bookListeners.forEach(({ ref, listener }) => {
                this.db.ref(ref).off('value', listener);
            });
            this.bookListeners = [];
        }
        if (this.messageListener) {
            this.db.ref('messages').off('value', this.messageListener);
            this.messageListener = null;
        }
    }

    updateStudentInfo() {
        if (!this.studentData) {
            console.error('No student data available for updateStudentInfo');
            return;
        }

        const elements = {
            studentName: document.getElementById('studentName'),
            studentGrade: document.getElementById('studentGrade'),
            infoName: document.getElementById('infoName'),
            infoGrade: document.getElementById('infoGrade'),
            infoAssessmentNo: document.getElementById('infoAssessmentNo'),
            infoUpiNo: document.getElementById('infoUpiNo'),
            studentAvatar: document.querySelector('.student-avatar')
        };

        console.log('Elements found:', {
            studentName: !!elements.studentName,
            studentGrade: !!elements.studentGrade,
            infoName: !!elements.infoName,
            infoGrade: !!elements.infoGrade,
            infoAssessmentNo: !!elements.infoAssessmentNo,
            infoUpiNo: !!elements.infoUpiNo,
            studentAvatar: !!elements.studentAvatar
        });
        const studentName = this.studentData.name || this.studentData.fullName || this.studentData['Official Student Name'] || '';
        const studentGrade = this.studentData.grade || this.studentData['Grade'] || '';
        console.log('Student data:', this.studentData);

        if (elements.studentAvatar) {
            elements.studentAvatar.innerHTML = '';
            StudentImageManager.renderStudentImage(studentName, studentGrade, elements.studentAvatar);

            const hoverCard = document.createElement('div');
            hoverCard.className = 'student-hover-card';

            const studentInfo = Object.entries(this.studentData)
                .filter(([key]) => key !== 'id')
                .map(([key, value]) => {
                    const formattedKey = key
                        .replace(/([A-Z])/g, ' $1')
                        .replace(/^./, str => str.toUpperCase());
                    return `<p>${formattedKey}: ${value || 'Not assigned'}</p>`;
                })
                .join('');

            hoverCard.innerHTML = `
                <div class="hover-card-content">
                    <img src="images/default-student.png"
                         alt="${studentName || 'Student'}"
                         class="hover-card-image"
                         onerror="this.src='images/default-student.png'">
                    <div class="hover-card-info">
                        <h5>${studentName || 'Unknown'}</h5>
                        ${studentInfo}
                    </div>
                </div>
            `;
            elements.studentAvatar.appendChild(hoverCard);

            StudentImageManager.loadStudentPhoto(studentName, studentGrade).then(src => {
                const hoverImg = hoverCard.querySelector('.hover-card-image');
                if (hoverImg && src) hoverImg.src = src;
            });

            console.log('Hover card appended to DOM:', !!elements.studentAvatar.querySelector('.student-hover-card'));
            console.log('Hover card styles on creation:', {
                display: hoverCard.style.display,
                opacity: hoverCard.style.opacity,
                transform: hoverCard.style.transform,
                zIndex: window.getComputedStyle(hoverCard).zIndex
            });

            elements.studentAvatar.removeEventListener('mouseenter', elements.studentAvatar._mouseenterHandler);
            elements.studentAvatar.removeEventListener('mouseleave', elements.studentAvatar._mouseleaveHandler);

            elements.studentAvatar._mouseenterHandler = () => {
                console.log('Hover card shown for student:', this.studentData.id);
                hoverCard.style.display = 'block';
                hoverCard.style.opacity = '1';
                hoverCard.style.transform = 'translateX(-50%) translateY(0)';
                console.log('Hover card styles on hover:', {
                    display: window.getComputedStyle(hoverCard).display,
                    opacity: window.getComputedStyle(hoverCard).opacity,
                    transform: window.getComputedStyle(hoverCard).transform,
                    zIndex: window.getComputedStyle(hoverCard).zIndex
                });
            };
            elements.studentAvatar._mouseleaveHandler = () => {
                console.log('Hover card hidden for student:', this.studentData.id);
                hoverCard.style.display = 'none';
                hoverCard.style.opacity = '0';
                hoverCard.style.transform = 'translateX(-50%) translateY(-10px)';
            };

            elements.studentAvatar.addEventListener('mouseenter', elements.studentAvatar._mouseenterHandler);
            elements.studentAvatar.addEventListener('mouseleave', elements.studentAvatar._mouseleaveHandler);
        } else {
            console.error('Student avatar element not found');
        }

        Object.entries(elements).forEach(([key, element]) => {
            if (element && key !== 'studentAvatar') {
                switch(key) {
                    case 'studentName':
                    case 'infoName':
                        element.textContent = this.studentData.name;
                        break;
                    case 'studentGrade':
                    case 'infoGrade':
                        element.textContent = this.studentData.grade;
                        break;
                    case 'infoAssessmentNo':
                        element.textContent = this.studentData.assessmentNo;
                        break;
                    case 'infoUpiNo':
                        element.textContent = this.studentData.upiNo || 'Not assigned';
                        break;
                }
            }
        });

        const firstNameEl = document.getElementById('studentFirstName');
        if (firstNameEl && this.studentData.name) {
            firstNameEl.textContent = this.studentData.name.split(' ')[0];
        }
    }

async handleLogin(e) {
    e.preventDefault();
    const assessmentNo = document.getElementById('assessmentNo').value;

    try {
        this.removeRealtimeListeners();
        
        const snapshot = await this.db.ref('students')
            .orderByChild('assessmentNo')
            .equalTo(assessmentNo)
            .once('value');

        if (snapshot.exists()) {
            const studentData = Object.values(snapshot.val())[0];
            const studentId = Object.keys(snapshot.val())[0];
            
            this.studentData = { ...studentData, id: studentId };
            this.setupMessageListener();
            this.setupRealtimeListeners();
            this.showDashboard();
        } else {
            alert('Student not found');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Error during login');
    }
}

    handleLogout() {
        this.studentData = null;
        this.loginPage.classList.remove('d-none');
        this.dashboardContent.classList.add('d-none');
        this.loginForm.reset();
        this.removeRealtimeListeners();
    }

    showDashboard() {
        this.loginPage.classList.add('d-none');
        this.dashboardContent.classList.remove('d-none');
        
        this.updateStudentInfo();
        this.loadStudentData();
        this.loadMessages();
    }

    async loadStudentData() {
        try {
            const issuanceSnapshot = await this.db.ref('issuance')
                .orderByChild('studentId')
                .equalTo(this.studentData.id)
                .once('value');

            let stats = {
                total: 0,
                active: 0,
                overdue: 0,
                lost: 0,
                returned: 0,
                validReturns: 0,
                totalDays: 0,
                onTimeReturns: 0
            };

            const currentDate = new Date();
            const bookPromises = [];
            const urgentIssuances = [];
            const bookIds = new Set();

            issuanceSnapshot.forEach(childSnapshot => {
                const issuance = childSnapshot.val();
                stats.total++;
                if (issuance.bookId) bookIds.add(issuance.bookId);

                if (issuance.status === 'active') {
                    stats.active++;
                    const returnDate = new Date(issuance.returnDate);
                    if (returnDate < currentDate) {
                        stats.overdue++;
                    }
                    if (!isNaN(returnDate.getTime())) {
                        const daysUntilDue = Math.ceil((returnDate - currentDate) / (1000 * 60 * 60 * 24));
                        if (daysUntilDue <= 3) {
                            urgentIssuances.push({ bookId: issuance.bookId, daysUntilDue });
                        }
                    }
                } else if (issuance.status === 'lost') {
                    stats.lost++;
                } else if (issuance.status === 'returned') {
                    stats.returned++;
                    const returnDate = new Date(issuance.returnDate);
                    const actualReturn = new Date(issuance.actualReturnDate);
                    const issueDate = new Date(issuance.issueDate);

                    if (isNaN(actualReturn.getTime()) || isNaN(issueDate.getTime())) {
                        console.warn('Skipping returned issuance with missing/invalid date(s):', childSnapshot.key, issuance);
                    } else {
                        stats.validReturns++;
                        if (!isNaN(returnDate.getTime()) && actualReturn <= returnDate) {
                            stats.onTimeReturns++;
                        }
                        stats.totalDays += Math.ceil((actualReturn - issueDate) / (1000 * 60 * 60 * 24));
                    }
                }

                bookPromises.push(this.loadBookDetails(issuance, childSnapshot.key));
            });

            this.updateStatistics(stats);
            this.renderDueSoonBanner(urgentIssuances);
            this.renderAchievements(stats, bookIds);

            const bookCards = await Promise.all(bookPromises);
            document.getElementById('booksContainer').innerHTML = bookCards.join('');
        } catch (error) {
            console.error('Error loading student data:', error);
        }
    }

    async renderDueSoonBanner(urgentIssuances) {
        const banner = document.getElementById('dueSoonBanner');
        if (!banner) return;

        if (!urgentIssuances.length) {
            banner.innerHTML = '';
            return;
        }

        const titled = await Promise.all(urgentIssuances.map(async (u) => {
            try {
                const snap = await this.db.ref(`books/${u.bookId}`).once('value');
                const book = snap.val();
                return { title: book?.title || 'Unknown book', daysUntilDue: u.daysUntilDue };
            } catch {
                return { title: 'Unknown book', daysUntilDue: u.daysUntilDue };
            }
        }));

        const overdue = titled.filter(t => t.daysUntilDue < 0);
        const dueSoon = titled.filter(t => t.daysUntilDue >= 0);

        const lines = [];
        if (overdue.length) {
            lines.push(`
                <div class="due-banner-line due-banner-overdue">
                    <i class="bi bi-exclamation-octagon"></i>
                    <span><strong>${overdue.length} overdue:</strong> ${overdue.map(o => `${this.escapeHtml(o.title)} (${Math.abs(o.daysUntilDue)}d overdue)`).join(', ')}</span>
                </div>
            `);
        }
        if (dueSoon.length) {
            lines.push(`
                <div class="due-banner-line due-banner-soon">
                    <i class="bi bi-clock-history"></i>
                    <span><strong>${dueSoon.length} due soon:</strong> ${dueSoon.map(d => `${this.escapeHtml(d.title)} (${d.daysUntilDue === 0 ? 'due today' : `due in ${d.daysUntilDue}d`})`).join(', ')}</span>
                </div>
            `);
        }

        banner.innerHTML = `<div class="due-banner">${lines.join('')}</div>`;
    }

    async renderAchievements(stats, bookIds) {
        const el = document.getElementById('achievementsRow');
        if (!el) return;

        const categories = new Set();
        await Promise.all(Array.from(bookIds).map(async (bookId) => {
            try {
                const snap = await this.db.ref(`books/${bookId}`).once('value');
                const book = snap.val();
                if (book?.category) categories.add(book.category);
            } catch {
                /* ignore individual lookup failures */
            }
        }));

        const returnRate = stats.validReturns ? (stats.onTimeReturns / stats.validReturns) * 100 : 0;

        const badges = [
            { icon: 'bi-book', label: 'First Read', earned: stats.total >= 1 },
            { icon: 'bi-collection', label: 'Bookworm', earned: stats.total >= 5 },
            { icon: 'bi-award', label: 'Avid Reader', earned: stats.total >= 15 },
            { icon: 'bi-clock-history', label: 'On-Time Reader', earned: stats.validReturns >= 3 && returnRate >= 80 },
            { icon: 'bi-shield-check', label: 'Nothing Overdue', earned: stats.active > 0 && stats.overdue === 0 },
            { icon: 'bi-palette', label: 'Well-Rounded', earned: categories.size >= 3 }
        ];

        el.innerHTML = `
            <div class="achievements-card mb-4">
                <div class="achievements-title">Achievements</div>
                <div class="achievements-row">
                    ${badges.map(b => `
                        <div class="achievement-badge ${b.earned ? 'earned' : 'locked'}" title="${b.earned ? 'Earned' : 'Not yet earned'}">
                            <i class="bi ${b.icon}"></i>
                            <span>${b.label}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    async printRecord() {
        try {
            const issuanceSnapshot = await this.db.ref('issuance')
                .orderByChild('studentId')
                .equalTo(this.studentData.id)
                .once('value');

            const records = [];
            const lookups = [];

            issuanceSnapshot.forEach(child => {
                const issuance = child.val();
                lookups.push((async () => {
                    let title = 'Unknown book';
                    try {
                        const bookSnap = await this.db.ref(`books/${issuance.bookId}`).once('value');
                        title = bookSnap.val()?.title || title;
                    } catch {
                        /* keep fallback title */
                    }
                    records.push({
                        title,
                        issueDate: issuance.issueDate,
                        returnDate: issuance.returnDate,
                        actualReturnDate: issuance.actualReturnDate,
                        status: issuance.status
                    });
                })());
            });

            await Promise.all(lookups);
            records.sort((a, b) => b.issueDate - a.issueDate);

            const printArea = document.getElementById('printRecordArea');
            if (!printArea) return;

            if (records.length === 0) {
                this.showToast('warning', 'No borrowing record to print yet');
                return;
            }

            printArea.innerHTML = `
                <h2>Kanyadet Student Library Portal — Borrowing Record</h2>
                <p><strong>${this.escapeHtml(this.studentData.name)}</strong> · ${this.escapeHtml(this.studentData.grade)} · Assessment No. ${this.escapeHtml(this.studentData.assessmentNo)}</p>
                <p>Generated: ${new Date().toLocaleString()}</p>
                <table>
                    <thead>
                        <tr><th>Book Title</th><th>Issued</th><th>Due / Returned</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                        ${records.map(r => `
                            <tr>
                                <td>${this.escapeHtml(r.title)}</td>
                                <td>${new Date(r.issueDate).toLocaleDateString()}</td>
                                <td>${new Date(r.status === 'returned' && r.actualReturnDate ? r.actualReturnDate : r.returnDate).toLocaleDateString()}</td>
                                <td>${r.status.toUpperCase()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;

            window.print();
        } catch (error) {
            console.error('Error preparing printable record:', error);
            this.showToast('error', 'Could not prepare printable record');
        }
    }

    updateStatistics(stats) {
        this.showStatsLoading();
        
        setTimeout(() => {
            const totalBooksEl = document.getElementById('totalBooks');
            const activeBooksEl = document.getElementById('activeBooks');
            const overdueBooksEl = document.getElementById('overdueBooks');
            const lostBooksEl = document.getElementById('lostBooks');
            
            if (totalBooksEl) {
                totalBooksEl.textContent = stats.total;
                this.makeStatClickable(totalBooksEl, 'all');
            }
            
            if (activeBooksEl) {
                activeBooksEl.textContent = stats.active;
                this.makeStatClickable(activeBooksEl, 'active');
            }
            
            if (overdueBooksEl) {
                overdueBooksEl.textContent = stats.overdue;
                this.makeStatClickable(overdueBooksEl, 'overdue');
            }
            
            if (lostBooksEl) {
                lostBooksEl.textContent = stats.lost;
                this.makeStatClickable(lostBooksEl, 'lost');
            }
            
            const avgBorrowDays = stats.validReturns ? Math.round(stats.totalDays / stats.validReturns) : 0;
            const returnRate = stats.validReturns ? Math.round((stats.onTimeReturns / stats.validReturns) * 100) : 0;

            const borrowingStatsEl = document.getElementById('borrowingStats');
            if (borrowingStatsEl) {
                borrowingStatsEl.innerHTML = `
                    <div class="text-center mb-2">
                        <small class="text-muted">Average Borrowing Duration</small>
                        <h4>${avgBorrowDays} days</h4>
                    </div>
                    <div class="text-center">
                        <small class="text-muted">On-time Return Rate</small>
                        <h4>${returnRate}%</h4>
                    </div>
                `;
            }
            
            this.hideStatsLoading();
        }, 500);
    }

    showStatsLoading() {
        const statElements = [
            'totalBooks',
            'activeBooks', 
            'overdueBooks',
            'lostBooks'
        ];
        
        statElements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                element.innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div>';
            }
        });
        
        const borrowingStatsEl = document.getElementById('borrowingStats');
        if (borrowingStatsEl) {
            borrowingStatsEl.innerHTML = `
                <div class="text-center mb-2">
                    <small class="text-muted">Average Borrowing Duration</small>
                    <div class="spinner-border spinner-border-sm" role="status"></div>
                </div>
                <div class="text-center">
                    <small class="text-muted">On-time Return Rate</small>
                    <div class="spinner-border spinner-border-sm" role="status"></div>
                </div>
            `;
        }
    }

    hideStatsLoading() {
        console.log('Stats loading completed');
    }

    showStatsLoadingSkeleton() {
        const statClasses = [
            '.total-books',
            '.active-books', 
            '.overdue-books',
            '.card-body',
            '.lost-books'
        ];
        
        statClasses.forEach(className => {
            const elements = document.querySelectorAll(className);
            elements.forEach(element => {
                element.innerHTML = '<div class="skeleton-text" style="width: 40px; height: 20px; background: #e9ecef; border-radius: 4px; animation: pulse 1.5s ease-in-out infinite;"></div>';
            });
        });
        
        const borrowingStatsEl = document.querySelector('.borrowing-stats');
        if (borrowingStatsEl) {
            borrowingStatsEl.innerHTML = `
                <div class="text-center mb-2">
                    <small class="text-muted">Average Borrowing Duration</small>
                    <div class="skeleton-text" style="width: 60px; height: 24px; background: #e9ecef; border-radius: 4px; animation: pulse 1.5s ease-in-out infinite; margin: 0 auto;"></div>
                </div>
                <div class="text-center">
                    <small class="text-muted">On-time Return Rate</small>
                    <div class="skeleton-text" style="width: 40px; height: 24px; background: #e9ecef; border-radius: 4px; animation: pulse 1.5s ease-in-out infinite; margin: 0 auto;"></div>
                </div>
            `;
        }
    }

    makeStatClickable(element, filter) {
        if (!element) return;
        
        let clickableParent = element.closest('.card') || 
                            element.closest('.stat-item') || 
                            element.parentElement;
        
        if (clickableParent) {
            clickableParent.style.cursor = 'pointer';
            clickableParent.style.transition = 'all 0.2s ease';
            clickableParent.classList.add('stats-clickable');
            
            clickableParent.removeEventListener('click', clickableParent._clickHandler);
            
            clickableParent._clickHandler = () => {
                this.showFilteredBooks(filter);
            };
            
            clickableParent.addEventListener('click', clickableParent._clickHandler);
            
            clickableParent.addEventListener('mouseenter', () => {
                clickableParent.style.transform = 'translateY(-2px)';
                clickableParent.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
                clickableParent.style.backgroundColor = 'rgba(0,123,255,0.05)';
            });
            
            clickableParent.addEventListener('mouseleave', () => {
                clickableParent.style.transform = 'translateY(0)';
                clickableParent.style.boxShadow = '';
                clickableParent.style.backgroundColor = '';
            });
        }
    }

    async loadBookDetails(issuance, issuanceId) {
        try {
            if (!issuance || !issuanceId) {
                console.error('Invalid issuance data:', { issuance, issuanceId });
                return '';
            }

            const bookSnapshot = await this.db.ref(`books/${issuance.bookId}`).once('value');
            const book = bookSnapshot.val() || {
                title: 'Unknown Book',
                author: 'Unknown',
                isbn: 'N/A',
                category: 'Unknown',
                subject: 'Unknown'
            };

            const currentDate = new Date();
            const returnDate = new Date(issuance.returnDate);
            const isOverdue = returnDate < currentDate && issuance.status === 'active';
            let status = issuance.status;
            if (isOverdue) status = 'overdue';

            const statusBadges = {
                active: 'bg-success',
                overdue: 'bg-danger',
                lost: 'bg-warning text-dark',
                returned: 'bg-secondary'
            };

            const daysUntilDue = Math.ceil((returnDate - currentDate) / (1000 * 60 * 60 * 24));
            const daysDisplay = daysUntilDue > 0 ? `${daysUntilDue} days remaining` : `${Math.abs(daysUntilDue)} days overdue`;

            const coverUrl = BookCoverManager.getBookCover(issuance.bookId);
            const issueDateShort = new Date(issuance.issueDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
            const returnDateShort = new Date(issuance.returnDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
            const safeTitle = book.title.replace(/'/g, "\\'");

            return `
                <div class="book-result mb-3" title="ISBN: ${book.isbn || 'N/A'}" onclick="studentPortal.showBookDetailModal('${issuanceId}')">
                    <div class="book-result-row">
                        <div class="book-result-cover">
                            <img src="${coverUrl}" class="book-cover" alt="${book.title}"
                                 onerror="this.onerror=null; this.src='covers/default-book.png';">
                        </div>
                        <div class="book-result-info">
                            <h5 class="card-title">${book.title}</h5>
                            <div class="book-result-sub">${book.author} · ${book.category} · ${book.subject || 'General'}</div>
                        </div>
                        <div class="book-result-dates">
                            <div>
                                <small>Issued</small>
                                <p>${issueDateShort}</p>
                            </div>
                            <i class="bi bi-arrow-right book-result-arrow"></i>
                            <div>
                                <small>Due</small>
                                <p>${returnDateShort}</p>
                            </div>
                        </div>
                        <div class="book-result-status">
                            <span class="badge ${statusBadges[status] || 'bg-secondary'} status-badge">${status.toUpperCase()}</span>
                            ${status === 'active' ? `<small>${daysDisplay}</small>` : ''}
                        </div>
                        <div class="book-result-action" onclick="event.stopPropagation();">
                            ${status === 'active' ? `
                                <button class="btn btn-sm btn-outline-primary"
                                        onclick="studentPortal.requestRenewal('${issuanceId}', '${safeTitle}', '${issuance.returnDate}')">
                                    <i class="bi bi-arrow-repeat me-1"></i>Renew
                                </button>
                                <button class="btn btn-sm btn-outline-primary"
                                        onclick="studentPortal.reportIssue('${issuanceId}', '${safeTitle}')">
                                    <i class="bi bi-flag me-1"></i>Report
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    ${status === 'active' || issuance.recoveryStatus ? `
                        <div class="book-result-extra">
                            ${status === 'active' ? `
                                <div class="progress mb-1">
                                    <div class="progress-bar ${daysUntilDue < 5 ? 'bg-warning' : 'bg-success'}"
                                         role="progressbar"
                                         style="width: ${Math.max(0, Math.min(100, (daysUntilDue / 30) * 100))}%">
                                    </div>
                                </div>
                            ` : ''}
                            ${issuance.recoveryStatus ? `
                                <div class="alert alert-info mt-2 mb-0 py-2">
                                    <small>
                                        <i class="bi bi-info-circle me-1"></i>
                                        Recovery: ${issuance.recoveryMethod}
                                        (${new Date(issuance.recoveryDate).toLocaleDateString()})
                                    </small>
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}
                </div>
            `;
        } catch (error) {
            console.error('Error loading book details:', error);
            return `
                <div class="book-result mb-3 border-danger">
                    <div class="book-result-row text-center text-danger" style="width:100%;justify-content:center;">
                        <i class="bi bi-exclamation-triangle fs-1 mb-2"></i>
                        <div style="width:100%;">
                            <h6 class="mb-0">Error Loading Book Details</h6>
                            <small>Please try refreshing the page</small>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    async reportIssue(issuanceId, bookTitle) {
        const { issueType, description } = await this.showIssueDialog(bookTitle);
        if (!issueType) return;

        try {
            await this.db.ref('messages').push({
                issuanceId,
                studentId: this.studentData.id,
                bookTitle: bookTitle,
                type: 'issue',
                subject: issueType,
                description: description || '',
                status: 'pending',
                timestamp: Date.now(),
                studentName: this.studentData.name,
                studentGrade: this.studentData.grade,
                readByStudent: true,
                readByLibrarian: false
            });

            alert('Issue reported successfully. The librarian will review it.');
        } catch (error) {
            console.error('Error reporting issue:', error);
            alert('Error reporting issue. Please try again.');
        }
    }

    showIssueDialog(bookTitle) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.innerHTML = `
                <div class="modal fade" id="issueModal" tabindex="-1">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Report Issue: ${bookTitle}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <div class="form-group">
                                    <label class="form-label">Issue Type</label>
                                    <select class="form-select" id="issueType">
                                        <option value="">Select Issue Type</option>
                                        <option value="damaged">Book is Damaged</option>
                                        <option value="missing-pages">Missing Pages</option>
                                        <option value="wrong-book">Wrong Book Issued</option>
                                        <option value="other">Other Issue</option>
                                    </select>
                                </div>
                                <div class="form-group mt-3">
                                    <label class="form-label">Description</label>
                                    <textarea class="form-control" id="issueDescription" rows="3"></textarea>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                                <button type="button" class="btn btn-primary" id="submitIssue">Submit</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            const modalElement = new bootstrap.Modal(document.getElementById('issueModal'));
            modalElement.show();

            document.getElementById('submitIssue').onclick = () => {
                const issueType = document.getElementById('issueType').value;
                const description = document.getElementById('issueDescription').value.trim();
                if (!issueType) {
                    alert('Please select an issue type');
                    return;
                }
                modalElement.hide();
                document.getElementById('issueModal').remove();
                resolve({ issueType, description });
            };

            document.getElementById('issueModal').addEventListener('hidden.bs.modal', () => {
                document.getElementById('issueModal').remove();
                resolve(null);
            });
        });
    }

    async requestRenewal(issuanceId, bookTitle, currentDueDate) {
        const dueDateLabel = new Date(currentDueDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

        const { value: note, isConfirmed } = await Swal.fire({
            title: 'Request Renewal',
            html: `<div style="text-align:left;font-size:13px;color:var(--text2);margin-bottom:6px;">
                       <strong>${this.escapeHtml(bookTitle)}</strong><br>Current due date: ${dueDateLabel}
                   </div>`,
            input: 'textarea',
            inputPlaceholder: 'Optional note to the librarian (e.g. still reading, need 1 more week)…',
            showCancelButton: true,
            confirmButtonText: 'Send Request',
            confirmButtonColor: '#d7a33e'
        });

        if (!isConfirmed) return;

        try {
            await this.db.ref('messages').push({
                issuanceId,
                studentId: this.studentData.id,
                bookTitle,
                type: 'renewal',
                subject: `Renewal Request: ${bookTitle}`,
                description: note || `Requesting a renewal. Current due date: ${dueDateLabel}.`,
                status: 'pending',
                timestamp: Date.now(),
                studentName: this.studentData.name,
                studentGrade: this.studentData.grade,
                readByStudent: true,
                readByLibrarian: false
            });

            this.showToast('success', 'Renewal request sent to the librarian');
        } catch (error) {
            console.error('Error requesting renewal:', error);
            this.showToast('error', 'Could not send renewal request');
        }
    }

    async showBookDetailModal(issuanceId) {
        try {
            const issuanceSnap = await this.db.ref(`issuance/${issuanceId}`).once('value');
            const issuance = issuanceSnap.val();
            if (!issuance) return;

            const bookSnap = await this.db.ref(`books/${issuance.bookId}`).once('value');
            const book = bookSnap.val();
            if (!book) return;

            const status = issuance.status;
            const statusBadges = { active: 'bg-success', returned: 'bg-secondary', lost: 'bg-danger' };
            const coverUrl = BookCoverManager.getBookCover(issuance.bookId);
            const safeTitle = book.title.replace(/'/g, "\\'");

            const modal = document.createElement('div');
            modal.innerHTML = `
                <div class="modal fade" id="bookDetailModal" tabindex="-1">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">Book Details</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <div class="d-flex gap-3 mb-3">
                                    <div class="book-detail-cover">
                                        <img src="${coverUrl}" alt="${this.escapeHtml(book.title)}"
                                             onerror="this.onerror=null; this.src='covers/default-book.png';">
                                    </div>
                                    <div>
                                        <h5 class="mb-1">${this.escapeHtml(book.title)}</h5>
                                        <div class="text-muted mb-2">${this.escapeHtml(book.author)}</div>
                                        <span class="badge ${statusBadges[status] || 'bg-secondary'} status-badge">${status.toUpperCase()}</span>
                                    </div>
                                </div>
                                <div class="id-row"><span>ISBN</span><span>${this.escapeHtml(book.isbn || 'N/A')}</span></div>
                                <div class="id-row"><span>Category</span><span>${this.escapeHtml(book.category)}</span></div>
                                <div class="id-row"><span>Subject</span><span>${this.escapeHtml(book.subject || 'General')}</span></div>
                                <div class="id-row"><span>Issue Date</span><span>${new Date(issuance.issueDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
                                <div class="id-row"><span>${status === 'returned' ? 'Returned' : 'Due'} Date</span><span>${new Date(status === 'returned' && issuance.actualReturnDate ? issuance.actualReturnDate : issuance.returnDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
                                ${issuance.recoveryStatus ? `<div class="id-row"><span>Recovery</span><span>${this.escapeHtml(issuance.recoveryMethod)}</span></div>` : ''}
                            </div>
                            <div class="modal-footer">
                                ${status === 'active' ? `
                                    <button type="button" class="btn btn-outline-primary btn-sm" data-bs-dismiss="modal"
                                            onclick="studentPortal.requestRenewal('${issuanceId}', '${safeTitle}', '${issuance.returnDate}')">
                                        <i class="bi bi-arrow-repeat me-1"></i>Renew
                                    </button>
                                    <button type="button" class="btn btn-outline-primary btn-sm" data-bs-dismiss="modal"
                                            onclick="studentPortal.reportIssue('${issuanceId}', '${safeTitle}')">
                                        <i class="bi bi-flag me-1"></i>Report Issue
                                    </button>
                                ` : ''}
                                <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            const modalElement = new bootstrap.Modal(document.getElementById('bookDetailModal'));
            modalElement.show();
            document.getElementById('bookDetailModal').addEventListener('hidden.bs.modal', () => {
                document.getElementById('bookDetailModal').remove();
            });
        } catch (error) {
            console.error('Error showing book detail modal:', error);
        }
    }

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    showToast(icon, title) {
        if (typeof Swal === 'undefined') {
            if (icon === 'error') alert(title); 
            return;
        }
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon,
            title,
            showConfirmButton: false,
            timer: 2500,
            timerProgressBar: true
        });
    }

    statusBadgeClass(status) {
        if (status === 'resolved') return 'bg-success';
        if (status === 'pending' || status === 'active' || !status) return 'bg-warning';
        return 'bg-secondary';
    }

    async loadMessages() {
        const messagesContainer = document.getElementById('messagesContainer');
        const unreadCountBadges = [
            document.getElementById('unreadMessagesCount'),
            document.getElementById('unreadCount')
        ].filter(Boolean);

        if (messagesContainer && !messagesContainer.dataset.wired) {
            messagesContainer.dataset.wired = 'true';
            messagesContainer.addEventListener('click', (e) => this.handleMessagesContainerClick(e));
        }

        if (messagesContainer) {
            messagesContainer.innerHTML = `
                <div class="messages-state">
                    <div class="spinner-border" role="status"></div>
                    <div class="mt-2">Loading messages…</div>
                </div>
            `;
        }

        try {
            const messagesRef = this.db.ref('messages').orderByChild('studentId').equalTo(this.studentData.id);
            const [snapshot, threadsSnapshot] = await Promise.all([
                messagesRef.once('value'),
                // message.js (the librarian's Messages page) reads/writes
                // replies at this SEPARATE top-level node — replies used to
                // live nested at messages/{id}/replies here instead, which
                // meant a student's reply and the librarian's reply were
                // invisible to each other. Reading both (merged below) keeps
                // any already-existing nested replies visible; new replies
                // go to message_threads going forward so both sides share
                // one thread.
                this.db.ref('message_threads').once('value')
            ]);
            const allThreads = threadsSnapshot.val() || {};

            let unreadMessages = 0;

            if (!snapshot.exists()) {
                if (messagesContainer) {
                    messagesContainer.innerHTML = `
                        <div class="messages-state">
                            <i class="bi bi-chat-square-text"></i>
                            No messages yet<br>
                            <small>Start a conversation with the librarian using "New Message" above.</small>
                        </div>
                    `;
                }
                unreadCountBadges.forEach(el => el.style.display = 'none');
                return;
            }

            const messages = [];
            snapshot.forEach(child => {
                messages.push({ id: child.key, ...child.val() });
            });
            messages.sort((a, b) => b.timestamp - a.timestamp);

            const cards = messages.map(message => {
                const threadMessages = [
                    ...Object.values(message.replies || {}),
                    ...Object.values(allThreads[message.id] || {})
                ].sort((a, b) => a.timestamp - b.timestamp);
                const lastMessage = threadMessages[threadMessages.length - 1];

                if (!message.readByStudent) unreadMessages++;

                const status = message.status || 'pending';
                const typeIcon = message.type === 'issue' || message.type === 'lost'
                    ? 'bi-exclamation-triangle'
                    : 'bi-chat-dots';

                return `
                    <div class="message-item ${!message.readByStudent ? 'unread' : ''}" data-message-id="${message.id}">
                        <div class="message-header">
                            <div class="message-title-row">
                                <span class="message-type-icon"><i class="bi ${typeIcon}"></i></span>
                                <h6 class="mb-0">${this.escapeHtml(message.subject || (message.type === 'issue' ? 'Issue' : 'Message'))}</h6>
                            </div>
                            <span class="badge ${this.statusBadgeClass(status)}">${this.escapeHtml(status)}</span>
                        </div>
                        <div class="message-content">
                            ${message.description || message.message ? `<p class="mb-1">${this.escapeHtml(message.description || message.message)}</p>` : ''}
                            ${message.attachments ? `
                                <div class="attachments mt-2">
                                    ${Object.values(message.attachments).map(attachment => `
                                        <a href="${attachment.url}" target="_blank" rel="noopener" class="attachment-link">
                                            <i class="bi bi-paperclip me-1"></i>${this.escapeHtml(attachment.name)}
                                        </a>
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                        <div class="message-footer">
                            <span>${message.type === 'issue' ? 'Reported' : 'Sent'}: ${new Date(message.timestamp).toLocaleString()}</span>
                            ${lastMessage ? `<span class="text-primary">Last reply: ${new Date(lastMessage.timestamp).toLocaleString()}</span>` : ''}
                        </div>
                        ${threadMessages.length ? `
                            <div class="chat-thread">
                                ${threadMessages.map(msg => `
                                    <div class="chat-message ${(msg.sender === 'librarian' || msg.sender === 'admin') ? 'librarian' : 'student'}">
                                        <div class="chat-content">${this.escapeHtml(msg.content || msg.message)}</div>
                                        <small>${(msg.sender === 'librarian' || msg.sender === 'admin') ? 'Librarian' : 'You'} • ${new Date(msg.timestamp).toLocaleString()}</small>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                        <div class="reply-box">
                            <textarea class="form-control reply-input" rows="1" placeholder="Type a reply…"></textarea>
                            <button type="button" class="btn btn-primary reply-send-btn" title="Send reply">
                                <i class="bi bi-send"></i>
                            </button>
                        </div>
                    </div>
                `;
            });

            if (messagesContainer) messagesContainer.innerHTML = cards.join('');

            unreadCountBadges.forEach(el => {
                if (unreadMessages > 0) {
                    el.textContent = unreadMessages;
                    el.style.display = 'inline-block';
                } else {
                    el.style.display = 'none';
                }
            });
        } catch (error) {
            console.error('Error loading messages:', error);
            if (messagesContainer) {
                messagesContainer.innerHTML = `
                    <div class="messages-state messages-error">
                        <i class="bi bi-exclamation-circle"></i>
                        Couldn't load messages<br>
                        <small>Please check your connection and try again.</small>
                    </div>
                `;
            }
        }
    }

    handleMessagesContainerClick(e) {
        const sendBtn = e.target.closest('.reply-send-btn');
        const item = e.target.closest('.message-item');
        if (!item) return;
        const messageId = item.dataset.messageId;

        if (sendBtn) {
            const textarea = item.querySelector('.reply-input');
            this.sendMessageReply(messageId, textarea, sendBtn);
            return;
        }

        if (e.target.closest('.reply-box') || e.target.closest('.attachment-link')) return;

        this.markMessageAsRead(messageId);
    }

    async sendMessageReply(messageId, textarea, sendBtn) {
        const content = textarea.value.trim();
        if (!content) {
            textarea.focus();
            return;
        }

        const originalIcon = sendBtn.innerHTML;
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

        try {
            await this.db.ref(`messages/${messageId}/replies`).push({
                message: content,
                timestamp: Date.now(),
                sender: 'student'
            });

            await this.db.ref(`messages/${messageId}`).update({
                read: false,
                lastRepliedAt: Date.now()
            });

            this.showToast('success', 'Reply sent');
            await this.loadMessages();
        } catch (error) {
            console.error('Error sending reply:', error);
            this.showToast('error', 'Could not send reply');
            sendBtn.disabled = false;
            sendBtn.innerHTML = originalIcon;
        }
    }

    async markMessageAsRead(messageId) {
        try {
            await this.db.ref(`messages/${messageId}`).update({
                readByStudent: true
            });
            this.loadMessages();
        } catch (error) {
            console.error('Error marking message as read:', error);
        }
    }

    switchView(viewName) {
        if (!this.views.includes(viewName)) return;

        document.querySelectorAll('.nav-link:not(.logout-link)').forEach(link => {
            link.classList.toggle('active', link.dataset.view === viewName);
        });

        this.views.forEach(view => {
            const container = document.querySelector(`#${view}View`);
            if (container) {
                container.classList.remove('active');
                container.style.display = 'none';
            }
        });

        const activeContainer = document.querySelector(`#${viewName}View`);
        if (activeContainer) {
            activeContainer.classList.add('active');
            activeContainer.style.display = 'block';
        }

        this.currentView = viewName;

        switch(viewName) {
            case 'activeBooks':
                this.loadActiveBooks();
                break;
            case 'messages':
                this.loadMessages();
                break;
            case 'history':
                this.loadHistory();
                break;
            case 'browse':
                this.loadBrowseView();
                break;
            case 'dashboard':
            default:
                this.loadStudentData();
        }
    }

    async loadActiveBooks() {
        try {
            const issuanceSnapshot = await this.db.ref('issuance')
                .orderByChild('studentId')
                .equalTo(this.studentData.id)
                .once('value');

            const activeBooksContainer = document.querySelector('#activeBooksView .row') || 
                                       document.querySelector('#activeBooksView') ||
                                       document.createElement('div');

            if (!activeBooksContainer) {
                console.error('Active books container not found');
                return;
            }

            const activeBooks = [];
            issuanceSnapshot.forEach(child => {
                const issuance = child.val();
                if (issuance.status === 'active') {
                    activeBooks.push(this.loadBookDetails(issuance, child.key));
                }
            });

            if (activeBooks.length === 0) {
                activeBooksContainer.innerHTML = '<div class="col-12 text-center text-muted">No active books found</div>';
                return;
            }

            const bookCards = await Promise.all(activeBooks);
            activeBooksContainer.innerHTML = bookCards.join('');

            const searchInput = document.querySelector('#activeBooksView input[type="text"]');
            if (searchInput) {
                searchInput.removeEventListener('input', this.filterActiveBooks);
                searchInput.addEventListener('input', (e) => {
                    this.filterActiveBooks(e.target.value);
                });
            }
        } catch (error) {
            console.error('Error loading active books:', error);
            const activeBooksContainer = document.querySelector('#activeBooksView .row') || 
                                       document.querySelector('#activeBooksView');
            if (activeBooksContainer) {
                activeBooksContainer.innerHTML = '<div class="col-12 text-center text-danger">Error loading active books</div>';
            }
        }
    }

    async loadHistory() {
        try {
            const issuanceSnapshot = await this.db.ref('issuance')
                .orderByChild('studentId')
                .equalTo(this.studentData.id)
                .once('value');

            const historyContainer = document.querySelector('#historyView .row') || 
                                   document.querySelector('#historyView') ||
                                   document.createElement('div');

            if (!historyContainer) {
                console.error('History container not found');
                return;
            }

            const history = [];
            const allIssuances = [];
            issuanceSnapshot.forEach(child => {
                const issuance = child.val();
                allIssuances.push(issuance);
                if (issuance.status === 'returned') {
                    history.push(this.loadBookDetails(issuance, child.key));
                }
            });

            this.renderBorrowingActivityChart(allIssuances);

            const searchInput = document.querySelector('#historyView input[type="text"]');
            if (searchInput) {
                searchInput.removeEventListener('input', this.filterHistory);
                searchInput.addEventListener('input', (e) => {
                    this.filterHistory(e.target.value);
                });
            }

            if (history.length === 0) {
                historyContainer.innerHTML = '<div class="col-12 text-center text-muted">No returned books found</div>';
                return;
            }

            const bookCards = await Promise.all(history);
            historyContainer.innerHTML = bookCards.join('');
        } catch (error) {
            console.error('Error loading history:', error);
            const historyContainer = document.querySelector('#historyView .row') || 
                                   document.querySelector('#historyView');
            if (historyContainer) {
                historyContainer.innerHTML = '<div class="col-12 text-center text-danger">Error loading history</div>';
            }
        }
    }

    filterHistory(searchTerm) {
        const container = document.querySelector('#historyView .row');
        if (!container) return;

        const bookCards = container.querySelectorAll('.book-result');
        const normalizedSearch = searchTerm.toLowerCase().trim();

        bookCards.forEach(card => {
            const title = card.querySelector('.card-title')?.textContent.toLowerCase() || '';
            const rest = card.textContent.toLowerCase();
            const isMatch = title.includes(normalizedSearch) || rest.includes(normalizedSearch);
            card.style.display = isMatch ? 'block' : 'none';
        });

        const existingNoResults = container.querySelector('.no-results-message');
        if (existingNoResults) existingNoResults.remove();

        const visibleCards = container.querySelectorAll('.book-result[style*="block"], .book-result:not([style*="none"])');
        if (visibleCards.length === 0 && normalizedSearch) {
            const noResultsDiv = document.createElement('div');
            noResultsDiv.className = 'col-12 text-center text-muted no-results-message';
            noResultsDiv.innerHTML = `<p>No history found matching "${searchTerm}"</p>`;
            container.appendChild(noResultsDiv);
        }
    }

    renderBorrowingActivityChart(issuances) {
        const chartEl = document.getElementById('historyChartContainer');
        if (!chartEl) return;

        // Build the last 6 months (oldest → newest), counting books issued in each.
        const months = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-US', { month: 'short' }), count: 0 });
        }
        const byKey = Object.fromEntries(months.map(m => [m.key, m]));

        issuances.forEach(issuance => {
            const issueDate = new Date(issuance.issueDate);
            if (isNaN(issueDate.getTime())) return;
            const key = `${issueDate.getFullYear()}-${issueDate.getMonth()}`;
            if (byKey[key]) byKey[key].count++;
        });

        const max = Math.max(1, ...months.map(m => m.count));
        const barWidth = 34;
        const gap = 22;
        const chartHeight = 90;
        const width = months.length * (barWidth + gap);

        const bars = months.map((m, i) => {
            const x = i * (barWidth + gap);
            const h = Math.round((m.count / max) * chartHeight);
            const y = chartHeight - h;
            return `
                <g>
                    <rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(h, 2)}" rx="6" fill="${m.count ? 'var(--gold)' : 'var(--border)'}"></rect>
                    <text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" class="chart-count">${m.count || ''}</text>
                    <text x="${x + barWidth / 2}" y="${chartHeight + 18}" text-anchor="middle" class="chart-label">${m.label}</text>
                </g>
            `;
        }).join('');

        chartEl.innerHTML = `
            <div class="activity-chart-card mb-4">
                <div class="activity-chart-title">Borrowing activity <span class="text-muted">· last 6 months</span></div>
                <svg viewBox="0 0 ${width} ${chartHeight + 30}" class="activity-chart-svg">${bars}</svg>
            </div>
        `;
    }

    async loadBrowseView() {
        try {
            const [booksSnap, wishlistSnap, reservationsSnap] = await Promise.all([
                this.db.ref('books').once('value'),
                this.db.ref(`wishlists/${this.studentData.id}`).once('value'),
                this.db.ref(`reservationsByStudent/${this.studentData.id}`).once('value')
            ]);

            const books = [];
            booksSnap.forEach(child => {
                books.push({ id: child.key, ...child.val() });
            });
            books.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

            this._browseBooks = books;
            this._browseWishlist = wishlistSnap.val() || {};
            this._browseReservations = reservationsSnap.val() || {};

            const categoryFilter = document.getElementById('browseCategoryFilter');
            if (categoryFilter && categoryFilter.dataset.populated !== 'true') {
                const categories = Array.from(new Set(books.map(b => b.category).filter(Boolean))).sort();
                categoryFilter.innerHTML = '<option value="">All Categories</option>' +
                    categories.map(c => `<option value="${this.escapeHtml(c)}">${this.escapeHtml(c)}</option>`).join('');
                categoryFilter.dataset.populated = 'true';
                categoryFilter.addEventListener('change', () => this.applyBrowseFilters());
            }

            const searchInput = document.getElementById('browseSearchInput');
            if (searchInput && searchInput.dataset.wired !== 'true') {
                searchInput.dataset.wired = 'true';
                searchInput.addEventListener('input', () => this.applyBrowseFilters());
            }

            this.renderWishlistPanel();
            this.renderReservationsPanel();
            this.applyBrowseFilters();
        } catch (error) {
            console.error('Error loading library catalog:', error);
            const container = document.getElementById('browseResults');
            if (container) container.innerHTML = '<div class="col-12 text-center text-danger">Error loading library catalog</div>';
        }
    }

    applyBrowseFilters() {
        const category = document.getElementById('browseCategoryFilter')?.value || '';
        const search = (document.getElementById('browseSearchInput')?.value || '').toLowerCase().trim();

        const books = (this._browseBooks || []).filter(book => {
            const matchesCategory = !category || book.category === category;
            const matchesSearch = !search ||
                (book.title || '').toLowerCase().includes(search) ||
                (book.author || '').toLowerCase().includes(search);
            return matchesCategory && matchesSearch;
        });

        this.renderBrowseResults(books);
    }

    renderBrowseResults(books) {
        const container = document.getElementById('browseResults');
        if (!container) return;

        if (books.length === 0) {
            container.innerHTML = '<div class="col-12 text-center text-muted">No books found</div>';
            return;
        }

        const wishlist = this._browseWishlist || {};
        const reservations = this._browseReservations || {};

        container.innerHTML = books.map(book => {
            const inWishlist = !!wishlist[book.id];
            const isReserved = !!reservations[book.id];
            const isOutOfStock = Number(book.available) <= 0;
            const coverUrl = BookCoverManager.getBookCover(book.id);
            const safeTitle = (book.title || '').replace(/'/g, "\\'");
            const safeAuthor = (book.author || '').replace(/'/g, "\\'");
            return `
                <div class="book-result mb-3" title="ISBN: ${this.escapeHtml(book.isbn || 'N/A')}">
                    <div class="book-result-row">
                        <div class="book-result-cover">
                            <img src="${coverUrl}" class="book-cover" alt="${this.escapeHtml(book.title || '')}"
                                 onerror="this.onerror=null; this.src='covers/default-book.png';">
                        </div>
                        <div class="book-result-info">
                            <h5 class="card-title">${this.escapeHtml(book.title || 'Untitled')}</h5>
                            <div class="book-result-sub">${this.escapeHtml(book.author || 'Unknown')} · ${this.escapeHtml(book.category || 'Uncategorized')} · ${this.escapeHtml(book.subject || 'General')}</div>
                            ${isOutOfStock ? `<div class="book-result-sub text-danger">All copies currently out</div>` : ''}
                        </div>
                        <div class="book-result-action d-flex flex-column gap-1">
                            <button class="btn btn-sm ${inWishlist ? 'btn-primary' : 'btn-outline-primary'}"
                                    onclick="studentPortal.toggleWishlist('${book.id}', '${safeTitle}', '${safeAuthor}')">
                                <i class="bi ${inWishlist ? 'bi-heart-fill' : 'bi-heart'} me-1"></i>${inWishlist ? 'Wishlisted' : 'Wishlist'}
                            </button>
                            ${isOutOfStock ? `
                                <button class="btn btn-sm ${isReserved ? 'btn-secondary' : 'btn-outline-warning'}"
                                        onclick="studentPortal.${isReserved ? 'cancelMyReservation' : 'reserveBook'}('${book.id}', '${safeTitle}')">
                                    <i class="bi ${isReserved ? 'bi-bookmark-check-fill' : 'bi-bookmark-plus'} me-1"></i>${isReserved ? 'Queued — cancel' : 'Reserve'}
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderWishlistPanel() {
        const panel = document.getElementById('wishlistPanel');
        if (!panel) return;

        const wishlist = this._browseWishlist || {};
        const items = Object.entries(wishlist);

        if (items.length === 0) {
            panel.innerHTML = '';
            return;
        }

        panel.innerHTML = `
            <div class="wishlist-card">
                <div class="wishlist-title"><i class="bi bi-heart-fill me-1"></i>My Wishlist</div>
                <div class="wishlist-chips">
                    ${items.map(([bookId, item]) => `
                        <span class="wishlist-chip">
                            ${this.escapeHtml(item.title)}
                            <button type="button" onclick="studentPortal.toggleWishlist('${bookId}', '${(item.title || '').replace(/'/g, "\\'")}', '${(item.author || '').replace(/'/g, "\\'")}')" title="Remove from wishlist">
                                <i class="bi bi-x"></i>
                            </button>
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // "My Reservations" — gives the student the same visibility into their
    // hold-queue standing that the librarian's Reservations tab has, instead
    // of that state only being readable one book at a time as a button label
    // in the Browse results. Position is computed by re-reading each
    // reservations/{bookId} queue and finding this student's place in it
    // (push keys sort chronologically, so array index === queue position).
    async renderReservationsPanel() {
        const panel = document.getElementById('reservationsPanel');
        if (!panel) return;

        const reservations = this._browseReservations || {};
        const bookIds = Object.keys(reservations);

        if (bookIds.length === 0) {
            panel.innerHTML = '';
            return;
        }

        const bookById = new Map((this._browseBooks || []).map(b => [b.id, b]));

        let rows;
        try {
            rows = await Promise.all(bookIds.map(async (bookId) => {
                const book = bookById.get(bookId);
                const title = book?.title || 'Unknown title';
                let position = null;
                try {
                    const queueSnap = await this.db.ref(`reservations/${bookId}`).once('value');
                    let idx = 0;
                    let found = -1;
                    queueSnap.forEach(child => {
                        if (child.val().studentId === this.studentData.id) found = idx;
                        idx++;
                    });
                    if (found >= 0) position = found + 1;
                } catch (e) {
                    // Leave position unknown rather than fail the whole panel.
                }
                return { bookId, title, position };
            }));
        } catch (error) {
            console.error('Error loading reservation queue positions:', error);
            return;
        }

        panel.innerHTML = `
            <div class="wishlist-card reservations-card">
                <div class="wishlist-title"><i class="bi bi-bookmark-star-fill me-1"></i>My Reservations</div>
                <div class="wishlist-chips">
                    ${rows.map(r => `
                        <span class="wishlist-chip">
                            ${this.escapeHtml(r.title)}${r.position ? ` <small class="text-muted">(#${r.position} in line)</small>` : ''}
                            <button type="button" onclick="studentPortal.cancelMyReservation('${r.bookId}', '${(r.title || '').replace(/'/g, "\\'")}')" title="Cancel reservation">
                                <i class="bi bi-x"></i>
                            </button>
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    }

    async toggleWishlist(bookId, title, author) {
        try {
            const ref = this.db.ref(`wishlists/${this.studentData.id}/${bookId}`);
            this._browseWishlist = this._browseWishlist || {};
            const isWishlisted = !!this._browseWishlist[bookId];

            if (isWishlisted) {
                await ref.remove();
                delete this._browseWishlist[bookId];
                this.showToast('success', `Removed "${title}" from wishlist`);
            } else {
                const item = { title, author, addedAt: Date.now() };
                await ref.set(item);
                this._browseWishlist[bookId] = item;
                this.showToast('success', `Added "${title}" to wishlist`);
            }

            this.renderWishlistPanel();
            this.applyBrowseFilters();
        } catch (error) {
            console.error('Error updating wishlist:', error);
            this.showToast('error', 'Could not update wishlist');
        }
    }

    // Writes to the SAME `reservations/{bookId}` queue the librarian's
    // Reservations tab manages (push order = queue order), plus a
    // `reservationsByStudent/{studentId}/{bookId}` index so this page
    // doesn't need to scan every book's queue to know what's already
    // reserved. When a copy comes back in, the librarian dashboard's
    // reservations.js notifies whoever is first in that book's queue via
    // a `messages` entry and removes them from both places — so a
    // reservation disappearing from here usually means it was fulfilled;
    // check Messages for the pickup notice.
    async reserveBook(bookId, title) {
        try {
            this._browseReservations = this._browseReservations || {};
            if (this._browseReservations[bookId]) return; // already queued

            const existing = await this.db.ref(`reservations/${bookId}`).once('value');
            let alreadyQueued = false;
            existing.forEach(child => {
                if (child.val().studentId === this.studentData.id) alreadyQueued = true;
            });
            if (alreadyQueued) {
                this.showToast('info', `You're already queued for "${title}"`);
                return;
            }

            const newRef = this.db.ref(`reservations/${bookId}`).push();
            await newRef.set({
                studentId: this.studentData.id,
                studentName: this.studentData.name,
                grade: this.studentData.grade,
                requestedAt: Date.now(),
                status: 'waiting'
            });
            await this.db.ref(`reservationsByStudent/${this.studentData.id}/${bookId}`).set(newRef.key);

            this._browseReservations[bookId] = newRef.key;
            this.showToast('success', `You're in the queue for "${title}" — we'll message you when it's back`);
            this.renderReservationsPanel();
            this.applyBrowseFilters();
        } catch (error) {
            console.error('Error reserving book:', error);
            this.showToast('error', 'Could not reserve that book');
        }
    }

    async cancelMyReservation(bookId, title) {
        try {
            const reservationId = (this._browseReservations || {})[bookId];
            if (!reservationId) return;

            await this.db.ref(`reservations/${bookId}/${reservationId}`).remove();
            await this.db.ref(`reservationsByStudent/${this.studentData.id}/${bookId}`).remove();

            delete this._browseReservations[bookId];
            this.showToast('success', `Removed your reservation for "${title}"`);
            this.renderReservationsPanel();
            this.applyBrowseFilters();
        } catch (error) {
            console.error('Error cancelling reservation:', error);
            this.showToast('error', 'Could not cancel that reservation');
        }
    }

    async handleFileUpload(file) {
        try {
            const storageRef = this.storage.ref(`message-attachments/${Date.now()}_${file.name}`);
            const snapshot = await storageRef.put(file);
            const url = await snapshot.ref.getDownloadURL();
            return {
                name: file.name,
                type: file.type,
                url,
                path: snapshot.ref.fullPath
            };
        } catch (error) {
            console.error('File upload error:', error);
            throw new Error(`Failed to upload ${file.name}`);
        }
    }

    validateFile(file) {
        const maxSize = 5 * 1024 * 1024;
        const allowedTypes = [
            'image/jpeg',
            'image/png',
            'image/gif',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];

        if (file.size > maxSize) {
            throw new Error(`${file.name} is too large. Maximum size is 5MB`);
        }

        if (!allowedTypes.includes(file.type)) {
            throw new Error(`${file.name} has an unsupported file type`);
        }

        return true;
    }

    showNewMessageDialog() {
        const modal = document.createElement('div');
        modal.innerHTML = `
            <div class="modal fade" id="newMessageModal" tabindex="-1">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">New Message</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <form id="newMessageForm">
                                <div class="mb-3">
                                    <label class="form-label">Subject</label>
                                    <input type="text" class="form-control" id="messageSubject" required>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Message Type</label>
                                    <select class="form-select" id="messageType" required>
                                        <option value="">Select Type</option>
                                        <option value="query">General Query</option>
                                        <option value="request">Book Request</option>
                                        <option value="feedback">Feedback</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Message</label>
                                    <textarea class="form-control" id="messageContent" rows="4" required></textarea>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Attachments (optional)</label>
                                    <input type="file" class="form-control" id="messageAttachments" multiple>
                                    <div id="attachmentsPreview" class="d-flex flex-wrap gap-2 mt-2"></div>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" id="submitMessage">Send Message</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        const modalElement = new bootstrap.Modal(document.getElementById('newMessageModal'));
        
        const attachmentsInput = document.getElementById('messageAttachments');
        const previewContainer = document.getElementById('attachmentsPreview');
        
        attachmentsInput.addEventListener('change', (e) => {
            previewContainer.innerHTML = '';
            const files = Array.from(e.target.files);
            
            files.forEach(file => {
                try {
                    this.validateFile(file);
                    const preview = document.createElement('div');
                    preview.className = 'attachment-preview';
                    preview.innerHTML = `
                        <div class="file-preview">
                            ${file.type.startsWith('image/') 
                                ? `<img src="${URL.createObjectURL(file)}" class="img-thumbnail" style="height: 40px;">` 
                                : `<i class="bi bi-paperclip"></i>`
                            }
                            <span>${file.name}</span>
                            <small class="text-muted">(${(file.size / 1024).toFixed(1)} KB)</small>
                        </div>
                    `;
                    previewContainer.appendChild(preview);
                } catch (error) {
                    this.showToast('error', error.message);
                    e.target.value = '';
                    return;
                }
            });
        });

        document.getElementById('submitMessage').onclick = async () => {
            const subject = document.getElementById('messageSubject').value;
            const type = document.getElementById('messageType').value;
            const content = document.getElementById('messageContent').value;
            const files = document.getElementById('messageAttachments').files;

            if (!subject || !type || !content) {
                this.showToast('warning', 'Please fill in all required fields');
                return;
            }

            const submitBtn = document.getElementById('submitMessage');
            const originalText = submitBtn.innerHTML;

            try {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Sending...';

                const attachments = {};
                if (files.length > 0) {
                    for (let i = 0; i < files.length; i++) {
                        try {
                            this.validateFile(files[i]);
                            const fileData = await this.handleFileUpload(files[i]);
                            attachments[fileData.path] = fileData;
                        } catch (error) {
                            console.error('Upload error:', error);
                            this.showToast('error', `Failed to upload ${files[i].name}: ${error.message}`);
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = originalText;
                            return;
                        }
                    }
                }

                await this.db.ref('messages').push({
                    studentId: this.studentData.id,
                    studentName: this.studentData.name,
                    studentGrade: this.studentData.grade,
                    subject,
                    type,
                    message: content,
                    attachments,
                    status: 'pending',
                    timestamp: Date.now(),
                    readByStudent: true,
                    readByLibrarian: false
                });

                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('newMessageModal'));
                modalInstance.hide();
                document.getElementById('newMessageModal').remove();
                this.showToast('success', 'Message sent successfully');
                this.loadMessages();
            } catch (error) {
                console.error('Error sending message:', error);
                this.showToast('error', 'Error sending message. Please try again.');
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        };

        modalElement.show();

        document.getElementById('newMessageModal').addEventListener('hidden.bs.modal', () => {
            document.getElementById('newMessageModal').remove();
        });
    }

    async loadDashboard() {
        try {
            if (!this.studentData) return;

            const stats = await this.loadStudentStats();
            document.getElementById('totalBooks').textContent = stats.total || 0;
            document.getElementById('activeBooks').textContent = stats.active || 0;
            document.getElementById('overdueBooks').textContent = stats.overdue || 0;
            document.getElementById('lostBooks').textContent = stats.lost || 0;

            const booksContainer = document.getElementById('booksContainer');
            booksContainer.innerHTML = '';

            const issuanceRef = firebase.database().ref('issuance');
            const snapshot = await issuanceRef
                .orderByChild('studentId')
                .equalTo(this.studentData.id)
                .once('value');

            if (snapshot.exists()) {
                const books = [];
                snapshot.forEach(child => {
                    const issuance = child.val();
                    if (issuance.status === 'active') {
                        books.push({ id: child.key, ...issuance });
                    }
                });

                books.forEach(book => {
                    const dueDate = new Date(book.returnDate);
                    const isOverdue = dueDate < new Date();
                    
                    const bookCard = document.createElement('div');
                    bookCard.className = 'col-md-6 col-lg-4 mb-3';
                    bookCard.innerHTML = `
                        <div class="card h-100 ${isOverdue ? 'border-danger' : ''}">
                            <div class="card-body">
                                <h5 class="card-title">${book.bookTitle}</h5>
                                <p class="card-text">
                                    <small class="text-muted">Due: ${new Date(book.returnDate).toLocaleDateString()}</small>
                                    ${isOverdue ? '<span class="badge bg-danger ms-2">Overdue</span>' : ''}
                                </p>
                            </div>
                        </div>
                    `;
                    booksContainer.appendChild(bookCard);
                });
            }

            const borrowingStats = document.getElementById('borrowingStats');
            borrowingStats.innerHTML = `
                <h6 class="mb-3">Borrowing Statistics</h6>
                <div class="d-flex justify-content-between mb-2">
                    <span>Total Borrowed:</span>
                    <span>${stats.total || 0}</span>
                </div>
                <div class="d-flex justify-content-between mb-2">
                    <span>Currently Active:</span>
                    <span>${stats.active || 0}</span>
                </div>
                <div class="d-flex justify-content-between mb-2">
                    <span>Overdue:</span>
                    <span class="text-danger">${stats.overdue || 0}</span>
                </div>
                <div class="d-flex justify-content-between">
                    <span>Lost Books:</span>
                    <span class="text-danger">${stats.lost || 0}</span>
                </div>
            `;
        } catch (error) {
            console.error('Error loading dashboard:', error);
        }
    }

    async loadStudentStats() {
        try {
            const issuanceRef = firebase.database().ref('issuance');
            const snapshot = await issuanceRef
                .orderByChild('studentId')
                .equalTo(this.studentData.id)
                .once('value');

            const stats = {
                total: 0,
                active: 0,
                overdue: 0,
                lost: 0
            };

            if (snapshot.exists()) {
                snapshot.forEach(child => {
                    const issuance = child.val();
                    stats.total++;

                    if (issuance.status === 'active') {
                        stats.active++;
                        if (new Date(issuance.returnDate) < new Date()) {
                            stats.overdue++;
                        }
                    } else if (issuance.status === 'lost') {
                        stats.lost++;
                    }
                });
            }

            return stats;
        } catch (error) {
            console.error('Error loading student stats:', error);
            return {
                total: 0,
                active: 0,
                overdue: 0,
                lost: 0
            };
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.studentPortal = new StudentPortal();
});