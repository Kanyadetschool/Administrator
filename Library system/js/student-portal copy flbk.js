firebase.initializeApp(firebaseConfig);
const db = firebase.database();

class StudentPortal {
    constructor() {
        this.loginPage = document.getElementById('loginPage');
        this.loginForm = document.getElementById('loginForm');
        this.dashboardContent = document.getElementById('dashboardContent');
        this.logoutBtn = document.getElementById('logoutBtn');
        this.studentData = null;
        this.bookListeners = [];
        this.messageListener = null;

        if (!this.loginPage || !this.loginForm || !this.dashboardContent || !this.logoutBtn) {
            console.error('Required elements not found');
            return;
        }

        this.loginPage.classList.remove('d-none');
        this.dashboardContent.classList.add('d-none');

        this.currentView = 'dashboard';
        this.views = ['dashboard', 'activeBooks', 'messages', 'history'];
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        this.logoutBtn.addEventListener('click', () => this.handleLogout());

        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                const view = e.currentTarget.dataset.view;
                this.switchView(view);
            });
        });
    }

    setupMessageListener() {
        if (this.messageListener) {
            db.ref('messages').off('value', this.messageListener);
        }

        if (this.studentData?.id) {
            this.messageListener = db.ref('messages')
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

        const issuanceListener = db.ref('issuance')
            .orderByChild('studentId')
            .equalTo(this.studentData.id)
            .on('value', (snapshot) => {
                this.loadStudentData();
            });

        const booksListener = db.ref('books').on('value', (snapshot) => {
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
                db.ref(ref).off('value', listener);
            });
            this.bookListeners = [];
        }
        if (this.messageListener) {
            db.ref('messages').off('value', this.messageListener);
            this.messageListener = null;
        }
    }

    updateStudentInfo() {
        if (!this.studentData) return;

        const elements = {
            studentName: document.getElementById('studentName'),
            studentGrade: document.getElementById('studentGrade'),
            infoName: document.getElementById('infoName'),
            infoGrade: document.getElementById('infoGrade'),
            infoAssessmentNo: document.getElementById('infoAssessmentNo'),
            infoUpiNo: document.getElementById('infoUpiNo')
        };

        Object.entries(elements).forEach(([key, element]) => {
            if (element) {
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
    }

    async handleLogin(e) {
        e.preventDefault();
        const assessmentNo = document.getElementById('assessmentNo').value;
        const grade = document.getElementById('grade').value;

        try {
            this.removeRealtimeListeners();
            
            const snapshot = await db.ref('students')
                .orderByChild('assessmentNo')
                .equalTo(assessmentNo)
                .once('value');

            if (snapshot.exists()) {
                const studentData = Object.values(snapshot.val())[0];
                const studentId = Object.keys(snapshot.val())[0];
                if (studentData.grade === grade) {
                    this.studentData = { ...studentData, id: studentId };
                    this.setupMessageListener();
                    this.setupRealtimeListeners();
                    this.showDashboard();
                } else {
                    alert('Invalid grade for this assessment number');
                }
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
            const issuanceSnapshot = await db.ref('issuance')
                .orderByChild('studentId')
                .equalTo(this.studentData.id)
                .once('value');

            let stats = {
                total: 0,
                active: 0,
                overdue: 0,
                lost: 0,
                returned: 0,
                totalDays: 0,
                onTimeReturns: 0
            };

            const currentDate = new Date();
            const bookPromises = [];

            issuanceSnapshot.forEach(childSnapshot => {
                const issuance = childSnapshot.val();
                stats.total++;

                if (issuance.status === 'active') {
                    stats.active++;
                    const returnDate = new Date(issuance.returnDate);
                    if (returnDate < currentDate) {
                        stats.overdue++;
                    }
                } else if (issuance.status === 'lost') {
                    stats.lost++;
                } else if (issuance.status === 'returned') {
                    stats.returned++;
                    const returnDate = new Date(issuance.returnDate);
                    const actualReturn = new Date(issuance.actualReturnDate);
                    if (actualReturn <= returnDate) {
                        stats.onTimeReturns++;
                    }
                    const issueDate = new Date(issuance.issueDate);
                    stats.totalDays += Math.ceil((actualReturn - issueDate) / (1000 * 60 * 60 * 24));
                }

                bookPromises.push(this.loadBookDetails(issuance, childSnapshot.key));
            });

            this.updateStatistics(stats);

            const bookCards = await Promise.all(bookPromises);
            document.getElementById('booksContainer').innerHTML = bookCards.join('');

        } catch (error) {
            console.error('Error loading student data:', error);
        }
    }

    updateStatistics(stats) {
        document.getElementById('totalBooks').textContent = stats.total;
        document.getElementById('activeBooks').textContent = stats.active;
        document.getElementById('overdueBooks').textContent = stats.overdue;
        document.getElementById('lostBooks').textContent = stats.lost;
        
        const avgBorrowDays = stats.returned ? Math.round(stats.totalDays / stats.returned) : 0;
        const returnRate = stats.returned ? Math.round((stats.onTimeReturns / stats.returned) * 100) : 0;

        document.getElementById('borrowingStats').innerHTML = `
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

    async loadBookDetails(issuance, issuanceId) {
        try {
            if (!issuance || !issuanceId) {
                console.error('Invalid issuance data:', { issuance, issuanceId });
                return '';
            }

            const bookSnapshot = await db.ref(`books/${issuance.bookId}`).once('value');
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

            return `
                <div class="col-md-6 col-lg-4 mb-4">
                    <div class="card book-card h-100 border-0 shadow-sm">
                        <div class="book-cover-container">
                            <img src="${coverUrl}" class="card-img-top book-cover" alt="${book.title}"
                                 onerror="this.onerror=null; this.src='covers/default-book.png';">
                            <span class="badge ${statusBadges[status] || 'bg-secondary'} status-badge">${status.toUpperCase()}</span>
                        </div>
                        <div class="card-body">
                            <h5 class="card-title mb-3">${book.title}</h5>
                            <div class="row mb-3">
                                <div class="col-6">
                                    <small class="text-muted">Author</small>
                                    <p class="mb-0">${book.author}</p>
                                </div>
                                <div class="col-6">
                                    <small class="text-muted">ISBN</small>
                                    <p class="mb-0">${book.isbn || 'N/A'}</p>
                                </div>
                            </div>
                            <div class="row mb-3">
                                <div class="col-6">
                                    <small class="text-muted">Category</small>
                                    <p class="mb-0">${book.category}</p>
                                </div>
                                <div class="col-6">
                                    <small class="text-muted">Subject</small>
                                    <p class="mb-0">${book.subject || 'General'}</p>
                                </div>
                            </div>
                            <div class="row mb-3">
                                <div class="col-6">
                                    <small class="text-muted">Issue Date</small>
                                    <p class="mb-0">${new Date(issuance.issueDate).toLocaleDateString('en-US', {
                                        day: 'numeric',
                                        month: 'short',
                                        year: 'numeric'
                                    })}</p>
                                </div>
                                <div class="col-6">
                                    <small class="text-muted">Return Date</small>
                                    <p class="mb-0">${new Date(issuance.returnDate).toLocaleDateString('en-US', {
                                        day: 'numeric',
                                        month: 'short',
                                        year: 'numeric'
                                    })}</p>
                                </div>
                            </div>
                            ${status === 'active' ? `
                                <div class="progress mb-3" style="height: 5px;">
                                    <div class="progress-bar ${daysUntilDue < 5 ? 'bg-warning' : 'bg-success'}" 
                                         role="progressbar" 
                                         style="width: ${Math.max(0, Math.min(100, (daysUntilDue / 30) * 100))}%">
                                    </div>
                                </div>
                                <small class="text-muted">${daysDisplay}</small>
                            ` : ''}
                            ${issuance.recoveryStatus ? `
                                <div class="alert alert-info mt-3 mb-0 py-2">
                                    <small>
                                        <i class="bi bi-info-circle me-1"></i>
                                        Recovery: ${issuance.recoveryMethod} 
                                        (${new Date(issuance.recoveryDate).toLocaleDateString()})
                                    </small>
                                </div>
                            ` : ''}
                            ${status === 'active' ? `
                                <div class="mt-3">
                                    <button class="btn btn-sm btn-outline-primary" 
                                            onclick="studentPortal.reportIssue('${issuanceId}', '${book.title.replace(/'/g, "\\'")}')">
                                        <i class="bi bi-flag me-1"></i>Report Issue
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading book details:', error);
            return `
                <div class="col-md-6 col-lg-4 mb-4">
                    <div class="card book-card h-100 border-0 shadow-sm border-danger">
                        <div class="card-body text-center text-danger">
                            <i class="bi bi-exclamation-triangle fs-1 mb-3"></i>
                            <h6>Error Loading Book Details</h6>
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
            await db.ref('messages').push({
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

    async loadMessages() {
        try {
            const messagesRef = db.ref('messages').orderByChild('studentId').equalTo(this.studentData.id);
            const snapshot = await messagesRef.once('value');
            
            const messagesContainer = document.getElementById('messagesContainer');
            const unreadCount = document.getElementById('unreadMessagesCount');
            let unreadMessages = 0;

            if (!snapshot.exists()) {
                messagesContainer.innerHTML = '<div class="text-center text-muted">No messages</div>';
                unreadCount.style.display = 'none';
                return;
            }

            messagesContainer.innerHTML = '';
            const messages = [];
            
            snapshot.forEach(child => {
                messages.push({
                    id: child.key,
                    ...child.val()
                });
            });

            messages.sort((a, b) => b.timestamp - a.timestamp);

            for (const message of messages) {
                const threadSnapshot = await db.ref(`message_threads/${message.id}`).once('value');
                const threadMessages = threadSnapshot.val() || {};
                const lastMessage = Object.values(threadMessages).sort((a, b) => b.timestamp - a.timestamp)[0];

                if (!message.readByStudent) {
                    unreadMessages++;
                }

                const div = document.createElement('div');
                div.className = `message-item ${!message.readByStudent ? 'unread' : ''}`;
                div.innerHTML = `
                    <div class="message-header">
                        <h6 class="mb-0">${message.type === 'issue' ? 'Issue' : 'Message'}: ${message.subject}</h6>
                        <span class="badge ${message.status === 'pending' ? 'bg-warning' : 'bg-success'}">
                            ${message.status}
                        </span>
                    </div>
                    <div class="message-content">
                        <p class="mb-1"><strong>Type:</strong> ${message.type}</p>
                        ${message.description || message.message ? `<p class="mb-1">${message.description || message.message}</p>` : ''}
                        ${message.attachments ? `
                            <div class="attachments mt-2">
                                ${Object.values(message.attachments).map(attachment => `
                                    <a href="${attachment.url}" target="_blank" class="attachment-link">
                                        <i class="bi bi-paperclip me-1"></i>${attachment.name}
                                    </a>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                    <div class="message-footer">
                        <span>${message.type === 'issue' ? 'Reported' : 'Sent'}: ${new Date(message.timestamp).toLocaleString()}</span>
                        ${lastMessage ? `
                            <span class="text-primary">
                                Last reply: ${new Date(lastMessage.timestamp).toLocaleString()}
                            </span>
                        ` : ''}
                    </div>
                    ${threadSnapshot.exists() ? `
                        <div class="chat-thread">
                            ${Object.values(threadMessages).map(msg => `
                                <div class="chat-message ${msg.sender === 'admin' ? 'librarian' : 'student'}">
                                    <div class="chat-content">${msg.content}</div>
                                    <small class="text-muted">
                                        ${msg.sender === 'admin' ? 'Librarian' : 'You'} • 
                                        ${new Date(msg.timestamp).toLocaleString()}
                                    </small>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                `;

                div.addEventListener('click', () => this.markMessageAsRead(message.id));
                messagesContainer.appendChild(div);
            }

            if (unreadMessages > 0) {
                unreadCount.textContent = unreadMessages;
                unreadCount.style.display = 'inline-block';
            } else {
                unreadCount.style.display = 'none';
            }

        } catch (error) {
            console.error('Error loading messages:', error);
            document.getElementById('messagesContainer').innerHTML = 
                '<div class="text-center text-danger">Error loading messages</div>';
        }
    }

    async markMessageAsRead(messageId) {
        try {
            await db.ref(`messages/${messageId}`).update({
                readByStudent: true
            });
            this.loadMessages();
        } catch (error) {
            console.error('Error marking message as read:', error);
        }
    }

 // Fixed switchView method
switchView(viewName) {
    if (!this.views.includes(viewName)) return;

    // Update navigation active state
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.view === viewName);
    });

    // Hide all view containers
    this.views.forEach(view => {
        const container = document.querySelector(`#${view}View`);
        if (container) {
            container.classList.remove('active');
            container.style.display = 'none';
        }
    });

    // Show the selected view
    const activeContainer = document.querySelector(`#${viewName}View`);
    if (activeContainer) {
        activeContainer.classList.add('active');
        activeContainer.style.display = 'block';
    }

    this.currentView = viewName;

    // Load appropriate content based on view
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
        case 'dashboard':
        default:
            this.loadStudentData(); // Use existing method that loads dashboard content
    }
}
  // Fixed loadActiveBooks method
  
async loadActiveBooks() {
    try {
        const issuanceSnapshot = await db.ref('issuance')
            .orderByChild('studentId')
            .equalTo(this.studentData.id)
            .once('value');

        // Fix: Get the correct container element
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
    } catch (error) {
        console.error('Error loading active books:', error);
        const activeBooksContainer = document.querySelector('#activeBooksView .row') || 
                                   document.querySelector('#activeBooksView');
        if (activeBooksContainer) {
            activeBooksContainer.innerHTML = '<div class="col-12 text-center text-danger">Error loading active books</div>';
        }
    }
}

 // Fixed loadHistory method for consistency
async loadHistory() {
    try {
        const issuanceSnapshot = await db.ref('issuance')
            .orderByChild('studentId')
            .equalTo(this.studentData.id)
            .once('value');

        // Fix: Get the correct container element
        const historyContainer = document.querySelector('#historyView .row') || 
                               document.querySelector('#historyView') ||
                               document.createElement('div');

        if (!historyContainer) {
            console.error('History container not found');
            return;
        }

        const history = [];
        issuanceSnapshot.forEach(child => {
            const issuance = child.val();
            if (issuance.status === 'returned') {
                history.push(this.loadBookDetails(issuance, child.key));
            }
        });

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

    async handleFileUpload(file) {
        try {
            const storage = firebase.storage();
            const storageRef = storage.ref(`message-attachments/${Date.now()}_${file.name}`);
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
                    alert(error.message);
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
                alert('Please fill in all required fields');
                return;
            }

            try {
                const submitBtn = document.getElementById('submitMessage');
                const originalText = submitBtn.innerHTML;
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
                            alert(`Failed to upload ${files[i].name}. ${error.message}`);
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = originalText;
                            return;
                        }
                    }
                }

                await db.ref('messages').push({
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
                alert('Message sent successfully');
                this.loadMessages();
            } catch (error) {
                console.error('Error sending message:', error);
                alert('Error sending message. Please try again.');
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