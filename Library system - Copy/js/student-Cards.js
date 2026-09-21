// Relative path from this dashboard page to the student-facing portal.
// Adjust this if student-portal.html lives in a different folder relative
// to wherever this script is loaded from.
const STUDENT_PORTAL_URL = 'student-portal.html';

class StudentPortalManager {
    constructor() {
        this.db = firebase.database();
        this.currentStudentId = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.populateStudentSelect();
    }

    setupEventListeners() {
        document.getElementById('portalStudentSelect')?.addEventListener('change', () => this.loadStudentData());
        document.getElementById('viewStudentCardBtn')?.addEventListener('click', () => this.viewLibraryCard());
        document.getElementById('setReadingGoalBtn')?.addEventListener('click', () => this.setReadingGoal());

        // StudentsCache loads asynchronously (IndexedDB read + Firebase
        // listeners) — at construction time it's usually still empty, so
        // populateStudentSelect() below renders with nothing in it. Rebuild
        // the list whenever the cache actually gets data, same pattern used
        // everywhere else in app.js that reads from this cache.
        if (typeof StudentsCache !== 'undefined') {
            StudentsCache.onChange(() => this.populateStudentSelect());
        }
    }

    async populateStudentSelect() {
        try {
            const studentSelect = document.getElementById('portalStudentSelect');
            if (!studentSelect) return;

            // Preserve the current selection across rebuilds — this can now
            // fire more than once as the cache streams in.
            const previousValue = studentSelect.value;

            studentSelect.innerHTML = '<option value="">Select Student</option>';

            if (typeof StudentsCache !== 'undefined') {
                StudentsCache.getAll().forEach((student, id) => {
                    const option = document.createElement('option');
                    option.value = id;
                    option.textContent = `${student.name} (${student.grade || 'No Grade'})`;
                    studentSelect.appendChild(option);
                });
            }

            if (previousValue && studentSelect.querySelector(`option[value="${previousValue}"]`)) {
                studentSelect.value = previousValue;
            }
        } catch (error) {
            console.error('Error populating student select:', error);
        }
    }

    async loadStudentData() {
        try {
            this.currentStudentId = document.getElementById('portalStudentSelect').value;
            
            if (!this.currentStudentId) {
                this.hideStudentSections();
                return;
            }

            const student = (typeof StudentsCache !== 'undefined') ? StudentsCache.get(this.currentStudentId) : null;
            if (!student) {
                await Swal.fire({
                    icon: 'error',
                    title: 'Student Not Found',
                    text: 'The selected student could not be found.'
                });
                return;
            }

            // Show student sections
            document.getElementById('studentOverview').style.display = 'block';
            document.getElementById('readingHistoryCard').style.display = 'block';
            document.getElementById('recommendationsCard').style.display = 'block';
            document.getElementById('readingGoalsCard').style.display = 'block';
            document.getElementById('achievementsCard').style.display = 'block';

            // Update student overview
            document.getElementById('portalStudentName').textContent = student.name;
            document.getElementById('portalStudentGrade').textContent = student.grade || 'Not specified';
            this.renderPortalPhoto(student);

            // Load student data
            await Promise.all([
                this.loadReadingHistory(),
                this.loadRecommendations(),
                this.loadReadingGoals(),
                this.loadAchievements(),
                this.updateStudentStatistics()
            ]);

        } catch (error) {
            console.error('Error loading student data:', error);
        }
    }

    // Creates (once) or reuses a small avatar container right before the
    // student's name in the overview card, then hands it to
    // StudentImageManager — same loader/lightbox used by the library-card
    // photo and reservations, so all three stay visually consistent.
    ensurePortalPhotoContainer() {
        let el = document.getElementById('portalStudentPhoto');
        if (el) return el;

        const nameEl = document.getElementById('portalStudentName');
        if (!nameEl || !nameEl.parentElement) return null;

        el = document.createElement('div');
        el.id = 'portalStudentPhoto';
        el.className = 'student-photo-container';
        el.style.cssText = 'width:88px;height:88px;border-radius:50%;overflow:hidden;margin:0 auto 10px;background:#eee;';
        nameEl.parentElement.insertBefore(el, nameEl);

        if (!document.getElementById('portalPhotoStyles')) {
            const style = document.createElement('style');
            style.id = 'portalPhotoStyles';
            style.textContent = `
                #portalStudentPhoto img.student-image { width:100%; height:100%; object-fit:cover; display:block; }
            `;
            document.head.appendChild(style);
        }

        return el;
    }

    renderPortalPhoto(student) {
        if (typeof StudentImageManager === 'undefined') return;
        const photoEl = this.ensurePortalPhotoContainer();
        if (photoEl) StudentImageManager.renderStudentImage(student.name, student.grade, photoEl);
    }

    hideStudentSections() {
        document.getElementById('studentOverview').style.display = 'none';
        document.getElementById('readingHistoryCard').style.display = 'none';
        document.getElementById('recommendationsCard').style.display = 'none';
        document.getElementById('readingGoalsCard').style.display = 'none';
        document.getElementById('achievementsCard').style.display = 'none';
    }

    async loadReadingHistory() {
        try {
            const container = document.getElementById('readingHistoryList');
            if (!container) return;

            container.innerHTML = '<p class="text-muted">Loading reading history…</p>';

            const issuanceSnapshot = await this.db.ref('issuance')
                .orderByChild('studentId')
                .equalTo(this.currentStudentId)
                .once('value');

            const history = [];
            if (issuanceSnapshot.exists()) {
                issuanceSnapshot.forEach(child => {
                    const issuance = child.val();
                    issuance.id = child.key;
                    history.push(issuance);
                });
            }

            // Sort by date (newest first)
            history.sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate));

            if (history.length === 0) {
                container.innerHTML = '<p class="text-muted">No reading history available.</p>';
                return;
            }

            container.innerHTML = `
                <div class="table-responsive">
                    <table class="table table-striped">
                        <thead>
                            <tr>
                                <th>Book Title</th>
                                <th>Author</th>
                                <th>Issue Date</th>
                                <th>Return Date</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${history.map(issuance => `
                                <tr>
                                    <td>${issuance.bookTitle || 'Unknown'}</td>
                                    <td>${issuance.author || 'Not specified'}</td>
                                    <td>${new Date(issuance.issueDate).toLocaleDateString()}</td>
                                    <td>${issuance.returnedAt ? new Date(issuance.returnedAt).toLocaleDateString() : 'Not returned'}</td>
                                    <td>
                                        <span class="badge bg-${issuance.status === 'returned' ? 'success' : issuance.status === 'overdue' ? 'danger' : 'warning'}">
                                            ${issuance.status}
                                        </span>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;

        } catch (error) {
            console.error('Error loading reading history:', error);
        }
    }

    async loadRecommendations() {
        try {
            const container = document.getElementById('recommendationsList');
            if (!container) return;

            container.innerHTML = '<p class="text-muted">Generating recommendations…</p>';

            // Get student's reading history
            const issuanceSnapshot = await this.db.ref('issuance')
                .orderByChild('studentId')
                .equalTo(this.currentStudentId)
                .once('value');

            const categories = new Set();
            const booksRead = new Set();

            if (issuanceSnapshot.exists()) {
                issuanceSnapshot.forEach(child => {
                    const issuance = child.val();
                    booksRead.add(issuance.bookId);
                    // Get book category
                    this.db.ref(`books/${issuance.bookId}`).once('value').then(bookSnapshot => {
                        const book = bookSnapshot.val();
                        if (book && book.category) {
                            categories.add(book.category);
                        }
                    });
                });
            }

            // Wait for category data
            await new Promise(resolve => setTimeout(resolve, 500));

            // Get available books in similar categories
            const booksSnapshot = await this.db.ref('books').once('value');
            const recommendations = [];

            if (booksSnapshot.exists()) {
                booksSnapshot.forEach(child => {
                    const book = child.val();
                    book.id = child.key;
                    
                    // Exclude already read books
                    if (booksRead.has(book.id)) return;
                    
                    // Include if category matches or if no categories (show all)
                    if (categories.size === 0 || categories.has(book.category)) {
                        if (book.available > 0) {
                            recommendations.push(book);
                        }
                    }
                });
            }

            // Limit to top 10 recommendations
            recommendations.sort((a, b) => b.available - a.available);
            const topRecommendations = recommendations.slice(0, 10);

            if (topRecommendations.length === 0) {
                container.innerHTML = '<p class="text-muted">No recommendations available at this time.</p>';
                return;
            }

            container.innerHTML = `
                <div class="row">
                    ${topRecommendations.map(book => {
                        const coverUrl = (typeof BookCoverManager !== 'undefined')
                            ? BookCoverManager.getBookCover(book.id, book)
                            : 'covers/default-book.png';
                        // Deep-links into the student portal's Browse Library view,
                        // scrolled to and highlighting this exact book (see
                        // handleDeepLinkedBook/highlightBrowseBook in student-portal.js).
                        const portalLink = `${STUDENT_PORTAL_URL}?book=${encodeURIComponent(book.id)}`;
                        return `
                        <div class="col-md-6 mb-3">
                            <div class="card h-100">
                                <div class="card-body d-flex" style="gap:12px;">
                                    <img src="${coverUrl}" alt="${book.title}" class="book-cover"
                                         style="width:56px;height:80px;object-fit:cover;border-radius:4px;flex-shrink:0;background:#eee;"
                                         onerror="this.onerror=null; this.src='covers/default-book.png';">
                                    <div class="flex-grow-1">
                                        <h6 class="card-title mb-1">${book.title}</h6>
                                        <p class="card-text mb-1">
                                            <small class="text-muted">
                                                ${book.author || 'Unknown author'} |
                                                ${book.category || 'Unknown category'}
                                            </small>
                                        </p>
                                        <p class="card-text mb-2">
                                            <span class="badge bg-success">${book.available} available</span>
                                        </p>
                                        <a href="${portalLink}" target="_blank" rel="noopener"
                                           class="btn btn-sm btn-outline-primary">
                                            <i class="bi bi-box-arrow-up-right me-1"></i>View in Student Portal
                                        </a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                    }).join('')}
                </div>
            `;

        } catch (error) {
            console.error('Error loading recommendations:', error);
        }
    }

    async loadReadingGoals() {
        try {
            const container = document.getElementById('readingGoalsList');
            if (!container) return;

            container.innerHTML = '<p class="text-muted">Loading reading goals…</p>';

            const goalsSnapshot = await this.db.ref(`studentGoals/${this.currentStudentId}`).once('value');
            const goals = [];

            if (goalsSnapshot.exists()) {
                goalsSnapshot.forEach(child => {
                    const goal = child.val();
                    goal.id = child.key;
                    goals.push(goal);
                });
            }

            // Sort by date (newest first)
            goals.sort((a, b) => b.createdAt - a.createdAt);

            if (goals.length === 0) {
                container.innerHTML = '<p class="text-muted">No reading goals set. Click "Set Goal" to create one!</p>';
                return;
            }

            container.innerHTML = goals.map(goal => {
                const progress = Math.min((goal.booksRead / goal.targetBooks) * 100, 100);
                const isCompleted = goal.booksRead >= goal.targetBooks;
                
                return `
                    <div class="card mb-3">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <h6 class="card-title mb-0">${goal.title || 'Reading Goal'}</h6>
                                <span class="badge bg-${isCompleted ? 'success' : 'primary'}">
                                    ${isCompleted ? 'Completed' : 'In Progress'}
                                </span>
                            </div>
                            <p class="card-text mb-2">
                                <small class="text-muted">${goal.description || 'No description'}</small>
                            </p>
                            <div class="progress mb-2">
                                <div class="progress-bar ${isCompleted ? 'bg-success' : 'bg-primary'}" 
                                     role="progressbar" 
                                     style="width: ${progress}%"
                                     aria-valuenow="${goal.booksRead}" 
                                     aria-valuemin="0" 
                                     aria-valuemax="${goal.targetBooks}">
                                    ${goal.booksRead}/${goal.targetBooks} books (${progress.toFixed(0)}%)
                                </div>
                            </div>
                            <p class="card-text mb-0">
                                <small class="text-muted">
                                    Target: ${goal.targetBooks} books | 
                                    Deadline: ${goal.deadline ? new Date(goal.deadline).toLocaleDateString() : 'No deadline'}
                                </small>
                            </p>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (error) {
            console.error('Error loading reading goals:', error);
        }
    }

    async setReadingGoal() {
        try {
            const { value: formValues } = await Swal.fire({
                title: 'Set Reading Goal',
                html: `
                    <input id="goalTitle" class="swal2-input" placeholder="Goal Title (e.g., Summer Reading)">
                    <input id="goalTarget" type="number" class="swal2-input" placeholder="Target number of books" min="1">
                    <input id="goalDeadline" type="date" class="swal2-input">
                    <textarea id="goalDescription" class="swal2-input" placeholder="Description (optional)"></textarea>
                `,
                focusConfirm: false,
                showCancelButton: true,
                preConfirm: () => {
                    return {
                        title: document.getElementById('goalTitle').value,
                        target: parseInt(document.getElementById('goalTarget').value),
                        deadline: document.getElementById('goalDeadline').value,
                        description: document.getElementById('goalDescription').value
                    };
                }
            });

            if (formValues) {
                if (!formValues.title || !formValues.target) {
                    await Swal.fire({
                        icon: 'warning',
                        title: 'Missing Information',
                        text: 'Please provide a title and target number of books'
                    });
                    return;
                }

                const goalData = {
                    title: formValues.title,
                    targetBooks: formValues.target,
                    deadline: formValues.deadline || null,
                    description: formValues.description || '',
                    booksRead: 0,
                    status: 'active',
                    createdBy: firebase.auth().currentUser?.uid || 'admin',
                    createdByName: firebase.auth().currentUser?.displayName || 'Admin',
                    createdAt: Date.now()
                };

                await this.db.ref(`studentGoals/${this.currentStudentId}`).push(goalData);

                await this.loadReadingGoals();
                await this.updateStudentStatistics();

                await Swal.fire({
                    icon: 'success',
                    title: 'Goal Set',
                    text: 'Reading goal has been created',
                    timer: 2000,
                    showConfirmButton: false
                });
            }

        } catch (error) {
            console.error('Error setting reading goal:', error);
        }
    }

    async loadAchievements() {
        try {
            const container = document.getElementById('achievementsList');
            if (!container) return;

            container.innerHTML = '<p class="text-muted">Loading achievements…</p>';

            const achievementsSnapshot = await this.db.ref(`studentAchievements/${this.currentStudentId}`).once('value');
            const achievements = [];

            if (achievementsSnapshot.exists()) {
                achievementsSnapshot.forEach(child => {
                    const achievement = child.val();
                    achievement.id = child.key;
                    achievements.push(achievement);
                });
            }

            // Sort by date (newest first)
            achievements.sort((a, b) => b.earnedAt - a.earnedAt);

            if (achievements.length === 0) {
                container.innerHTML = '<p class="text-muted">No achievements earned yet. Keep reading to earn badges!</p>';
                return;
            }

            container.innerHTML = `
                <div class="row">
                    ${achievements.map(achievement => `
                        <div class="col-md-4 mb-3">
                            <div class="card text-center">
                                <div class="card-body">
                                    <div class="achievement-icon mb-2">
                                        <i class="bi bi-trophy-fill text-warning" style="font-size: 2rem;"></i>
                                    </div>
                                    <h6 class="card-title">${achievement.title}</h6>
                                    <p class="card-text">
                                        <small class="text-muted">${achievement.description}</small>
                                    </p>
                                    <p class="card-text mb-0">
                                        <small class="text-muted">
                                            Earned: ${new Date(achievement.earnedAt).toLocaleDateString()}
                                        </small>
                                    </p>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;

        } catch (error) {
            console.error('Error loading achievements:', error);
        }
    }

    async updateStudentStatistics() {
        try {
            // Get total books read
            const issuanceSnapshot = await this.db.ref('issuance')
                .orderByChild('studentId')
                .equalTo(this.currentStudentId)
                .once('value');

            let booksRead = 0;
            let currentLoans = 0;

            if (issuanceSnapshot.exists()) {
                issuanceSnapshot.forEach(child => {
                    const issuance = child.val();
                    if (issuance.status === 'returned') {
                        booksRead++;
                    } else if (issuance.status === 'active' || issuance.status === 'overdue') {
                        currentLoans++;
                    }
                });
            }

            // Get reading goals progress
            const goalsSnapshot = await this.db.ref(`studentGoals/${this.currentStudentId}`).once('value');
            let goalProgress = { current: 0, target: 0 };
            
            if (goalsSnapshot.exists()) {
                goalsSnapshot.forEach(child => {
                    const goal = child.val();
                    if (goal.status === 'active') {
                        goalProgress.current += goal.booksRead;
                        goalProgress.target += goal.targetBooks;
                    }
                });
            }

            // Get achievements count
            const achievementsSnapshot = await this.db.ref(`studentAchievements/${this.currentStudentId}`).once('value');
            const achievementsCount = achievementsSnapshot.exists() ? Object.keys(achievementsSnapshot.val()).length : 0;

            // Update UI
            document.getElementById('portalBooksRead').textContent = booksRead;
            document.getElementById('portalCurrentLoans').textContent = currentLoans;
            document.getElementById('portalReadingGoal').textContent = goalProgress.target > 0 
                ? `${goalProgress.current}/${goalProgress.target}` 
                : 'No goal set';
            document.getElementById('portalAchievements').textContent = achievementsCount;

        } catch (error) {
            console.error('Error updating student statistics:', error);
        }
    }

    async viewLibraryCard() {
        try {
            if (!this.currentStudentId) {
                await Swal.fire({
                    icon: 'warning',
                    title: 'No Student Selected',
                    text: 'Please select a student first'
                });
                return;
            }

            const student = (typeof StudentsCache !== 'undefined') ? StudentsCache.get(this.currentStudentId) : null;
            if (!student) {
                await Swal.fire({
                    icon: 'error',
                    title: 'Student Not Found',
                    text: 'The selected student could not be found.'
                });
                return;
            }

            // Get current loans
            const issuanceSnapshot = await this.db.ref('issuance')
                .orderByChild('studentId')
                .equalTo(this.currentStudentId)
                .once('value');

            let currentLoans = 0;
            const loanDetails = [];

            if (issuanceSnapshot.exists()) {
                issuanceSnapshot.forEach(child => {
                    const issuance = child.val();
                    if (issuance.status === 'active' || issuance.status === 'overdue') {
                        currentLoans++;
                        loanDetails.push({
                            title: issuance.bookTitle,
                            dueDate: issuance.returnDate,
                            status: issuance.status
                        });
                    }
                });
            }

            const cardHtml = `
                <div class="library-card">
                    <div class="library-card-header d-flex align-items-center" style="gap:14px;">
                        <div id="libraryCardPhoto" style="width:64px;height:64px;border-radius:50%;overflow:hidden;flex-shrink:0;background:rgba(255,255,255,0.25);"></div>
                        <h4 class="mb-0">📚 Library Card</h4>
                    </div>
                    <div class="library-card-body">
                        <div class="row">
                            <div class="col-md-6">
                                <p><strong>Name:</strong> ${student.name}</p>
                                <p><strong>Grade:</strong> ${student.grade || 'Not specified'}</p>
                                <p><strong>Assessment No:</strong> ${student.assessmentNo || 'Not specified'}</p>
                            </div>
                            <div class="col-md-6">
                                <p><strong>Card Number:</strong> ${this.generateCardNumber(student.id)}</p>
                                <p><strong>Current Loans:</strong> ${currentLoans}</p>
                                <p><strong>Status:</strong> <span class="badge bg-success">Active</span></p>
                            </div>
                        </div>
                        ${loanDetails.length > 0 ? `
                            <div class="mt-3">
                                <h6>Current Loans:</h6>
                                <ul class="list-unstyled">
                                    ${loanDetails.map(loan => `
                                        <li>
                                            ${loan.title} - Due: ${loan.dueDate} 
                                            <span class="badge bg-${loan.status === 'overdue' ? 'danger' : 'warning'}">${loan.status}</span>
                                        </li>
                                    `).join('')}
                                </ul>
                            </div>
                        ` : ''}
                    </div>
                </div>
                <style>
                    .library-card {
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        border-radius: 15px;
                        padding: 20px;
                        font-family: 'Georgia', serif;
                    }
                    .library-card-header {
                        border-bottom: 1px solid rgba(255,255,255,0.3);
                        padding-bottom: 10px;
                        margin-bottom: 15px;
                    }
                    .library-card-body p {
                        margin-bottom: 5px;
                    }
                    #libraryCardPhoto img.student-image {
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                        display: block;
                    }
                </style>
            `;

            Swal.fire({
                title: 'Student Library Card',
                html: cardHtml,
                width: '600px',
                showConfirmButton: true,
                confirmButtonText: 'Close',
                didOpen: () => {
                    const photoEl = document.getElementById('libraryCardPhoto');
                    if (photoEl && typeof StudentImageManager !== 'undefined') {
                        StudentImageManager.renderStudentImage(student.name, student.grade, photoEl);
                    }
                }
            });

        } catch (error) {
            console.error('Error viewing library card:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to load library card: ' + error.message
            });
        }
    }

    generateCardNumber(studentId) {
        // Generate a simple card number based on student ID
        const hash = studentId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return `LIB-${hash.toString().padStart(8, '0')}`;
    }
}

// Initialize the student portal manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.studentPortalManager = new StudentPortalManager();
});