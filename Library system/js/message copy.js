class MessageManager {
    constructor() {
        // Add this line at the beginning of constructor
        this.db = firebase.database();
        
        // Initialize elements
        this.messagesList = document.getElementById('messagesList');
        this.messageThread = document.getElementById('messageThread');
        this.messageContent = document.getElementById('messageContent');
        this.messagePlaceholder = document.querySelector('.message-placeholder');
        this.replyForm = document.getElementById('replyForm');
        this.messageTitle = document.getElementById('messageTitle');
        this.messageStatus = document.getElementById('messageStatus');
        this.messageInfo = document.getElementById('messageInfo');
        this.unreadCount = document.getElementById('unreadCount');
        this.currentMessageId = null;
        this.allMessages = []; // Add this line
        this.messagesRef = firebase.database().ref('issues');
        this.selectedMessages = new Set();
        // Check if elements exist
        if (!this.messagesList || !this.messageThread || !this.unreadCount) {
            console.error('Required elements not found');
            return;
        }

        console.log('MessageManager initialized with elements:', {
            messagesList: this.messagesList,
            filterButtons: document.querySelectorAll('.btn-group .btn')
        });

        // Add realtime listeners
        this.setupRealtimeListeners();
        this.setupFilterButtons();
        this.setupBulkActions();
        
        // Initial load of all messages
        this.loadMessages('all');
    }

    setupRealtimeListeners() {
        // Real-time updates for messages
        this.messagesRef.on('value', (snapshot) => {
            if (!snapshot.exists()) {
                this.updateUnreadCount(0);
                return;
            }

            const messages = [];
            let pendingCount = 0;

            snapshot.forEach(child => {
                const message = child.val();
                messages.push({ id: child.key, ...message });
                if (message.status === 'pending') pendingCount++;
            });

            this.allMessages = messages;
            this.updateUnreadCount(pendingCount);
            this.loadMessages(this.currentFilter || 'all');
        });

        // Add realtime listener for message threads
        if (this.messageThread) {
            this.messagesRef.on('child_changed', (snapshot) => {
                const message = snapshot.val();
                if (message.id === this.currentMessageId) {
                    this.showMessageDetails(message.id);
                }
            });
        }

        // Realtime status updates
        this.messagesRef.on('child_changed', (snapshot) => {
            const message = snapshot.val();
            const messageId = snapshot.key;
            const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
            
            if (messageElement) {
                const statusBadge = messageElement.querySelector('.badge');
                if (statusBadge) {
                    statusBadge.className = `badge ${message.status === 'pending' ? 'bg-warning' : 'bg-success'}`;
                    statusBadge.textContent = message.status;
                }
            }
        });

        // Realtime deletion updates
        this.messagesRef.on('child_removed', (snapshot) => {
            const messageId = snapshot.key;
            const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageElement) {
                messageElement.remove();
            }
        });

        // Setup reply form listener with realtime updates
        if (this.replyForm) {
            this.replyForm.addEventListener('submit', (e) => this.handleReply(e));
        }
    }

    updateUnreadCount(count) {
        if (this.unreadCount) {
            this.unreadCount.textContent = count || '';
            this.unreadCount.style.display = count ? 'inline-block' : 'none';
        }
    }

    setupFilterButtons() {
        const filterButtons = document.querySelectorAll('.filter-btn');
        if (!filterButtons.length) {
            console.error('Filter buttons not found');
            return;
        }

        filterButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Remove active class from all buttons
                filterButtons.forEach(btn => btn.classList.remove('active'));
                
                // Add active class to clicked button
                button.classList.add('active');
                
                // Get filter value from data attribute
                const filter = button.getAttribute('data-filter');
                
                // Apply filter
                this.filterMessages(filter);
            });
        });
    }

    filterMessages(filter = 'all') {
        if (!this.messagesList) return;
        
        try {
            this.loadMessages(filter);
        } catch (error) {
            console.error('Error filtering messages:', error);
        }
    }

    async loadMessages(filter = 'all') {
        if (!this.messagesList) return;

        // Show loading state
        this.messagesList.innerHTML = '<div class="text-center p-3"><div class="spinner-border text-primary"></div></div>';
        
        try {
            // Debug log before filtering
            console.log('All messages before filtering:', this.allMessages);

            const messages = this.allMessages.filter(message => {
                switch(filter) {
                    case 'pending':
                        return message.status === 'pending';
                    case 'resolved':
                        return message.status === 'resolved';
                    case 'all':
                    default:
                        return true;
                }
            }).sort((a, b) => b.timestamp - a.timestamp);

            // Clear previous messages
            this.messagesList.innerHTML = '';

            if (messages.length === 0) {
                this.messagesList.innerHTML = `
                    <div class="text-center p-3">
                        <i class="bi bi-inbox text-muted fs-4"></i>
                        <p class="text-muted mt-2">No ${filter} messages found</p>
                    </div>`;
                return;
            }

            // Render each message
            messages.forEach(message => {
                // Debug log for each message being rendered
                console.log('Rendering message:', message);
                this.renderMessageItem(message, message.id);
            });

        } catch (error) {
            console.error('Error loading messages:', error);
            this.messagesList.innerHTML = '<div class="text-center p-3 text-danger">Error loading messages</div>';
        }
    }

    setupBulkActions() {
        const bulkActions = document.createElement('div');
        bulkActions.className = 'bulk-actions';
        bulkActions.innerHTML = `
            <div class="message-select-all">
                <input type="checkbox" class="message-checkbox" id="selectAllMessages">
                <label for="selectAllMessages">Select All</label>
            </div>
            <button class="btn btn-danger btn-sm" id="deleteSelectedMessages" disabled>
                <i class="bi bi-trash"></i> Delete Selected
            </button>
        `;

        const messagesHeader = document.querySelector('.messages-header');
        messagesHeader.after(bulkActions);

        document.getElementById('selectAllMessages').addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.message-checkbox');
            checkboxes.forEach(cb => {
                if (cb.id !== 'selectAllMessages') {
                    cb.checked = e.target.checked;
                    this.handleMessageSelection(cb);
                }
            });
        });

        document.getElementById('deleteSelectedMessages').addEventListener('click', () => {
            this.deleteSelectedMessages();
        });
    }

    renderMessageItem(message, messageId) {
        const div = document.createElement('div');
        div.className = `message-item ${message.readByLibrarian ? '' : 'unread'}`;
        div.dataset.messageId = messageId;
        
        div.innerHTML = `
            <div class="d-flex align-items-start gap-3">
                <input type="checkbox" class="message-checkbox" data-message-id="${messageId}">
                <div class="flex-grow-1 message-content" style="cursor: pointer;">
                    <div class="message-header d-flex justify-content-between align-items-start">
                        <h6 class="mb-1">${message.studentName || 'Unknown Student'} 
                            <small class="text-muted">(${message.studentGrade || 'N/A'})</small>
                        </h6>
                        <span class="badge ${message.status === 'pending' ? 'bg-warning' : 'bg-success'}">
                            ${message.status}
                        </span>
                    </div>
                    <p class="message-preview mb-1">${message.subject || message.type || 'No subject'}</p>
                    <small class="text-muted">${new Date(message.timestamp).toLocaleString()}</small>
                </div>
                <div class="message-actions">
                    <button class="delete-btn" title="Delete message">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        `;

        // Add click handler for message content
        div.querySelector('.message-content').addEventListener('click', () => {
            // Remove active class from all messages
            document.querySelectorAll('.message-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // Add active class to clicked message
            div.classList.add('active');
            
            // Show message details
            this.showMessageDetails(messageId);
        });

        div.querySelector('.message-checkbox').addEventListener('change', (e) => {
            this.handleMessageSelection(e.target);
        });

        div.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteMessage(messageId);
        });

        this.messagesList.appendChild(div);
    }

    handleMessageSelection(checkbox) {
        const messageId = checkbox.dataset.messageId;
        if (checkbox.checked) {
            this.selectedMessages.add(messageId);
        } else {
            this.selectedMessages.delete(messageId);
        }

        const deleteButton = document.getElementById('deleteSelectedMessages');
        deleteButton.disabled = this.selectedMessages.size === 0;

        // Update select all checkbox
        const selectAllCheckbox = document.getElementById('selectAllMessages');
        const allCheckboxes = document.querySelectorAll('.message-checkbox:not(#selectAllMessages)');
        selectAllCheckbox.checked = allCheckboxes.length > 0 && 
            Array.from(allCheckboxes).every(cb => cb.checked);
    }

    async deleteMessage(messageId) {
        if (confirm('Are you sure you want to permanently delete this message?')) {
            try {
                await firebase.database().ref(`issues/${messageId}`).remove();
                document.querySelector(`[data-message-id="${messageId}"]`).remove();
                alert('Message deleted successfully');
            } catch (error) {
                console.error('Error deleting message:', error);
                alert('Error deleting message');
            }
        }
    }

    async deleteSelectedMessages() {
        if (this.selectedMessages.size === 0) return;

        if (confirm(`Are you sure you want to permanently delete ${this.selectedMessages.size} message(s)?`)) {
            try {
                const promises = Array.from(this.selectedMessages).map(messageId => 
                    firebase.database().ref(`issues/${messageId}`).remove()
                );

                await Promise.all(promises);
                this.selectedMessages.clear();
                document.getElementById('selectAllMessages').checked = false;
                document.getElementById('deleteSelectedMessages').disabled = true;
                this.loadMessages(this.currentFilter); // Refresh messages list
                alert('Messages deleted successfully');
            } catch (error) {
                console.error('Error deleting messages:', error);
                alert('Error deleting messages');
            }
        }
    }

    async deleteAllMessages() {
        if (confirm('Are you sure you want to permanently delete ALL messages? This action cannot be undone.')) {
            try {
                const snapshot = await firebase.database().ref('issues').once('value');
                const promises = [];
                
                snapshot.forEach(child => {
                    promises.push(firebase.database().ref(`issues/${child.key}`).remove());
                });

                await Promise.all(promises);
                this.loadMessages(this.currentFilter);
                alert('All messages deleted successfully');
            } catch (error) {
                console.error('Error deleting all messages:', error);
                alert('Error deleting messages');
            }
        }
    }

    async showMessageDetails(messageId) {
        this.currentMessageId = messageId;
        const messageRef = this.messagesRef.child(messageId);

        // Remove previous message listener if exists
        if (this.currentMessageRef) {
            this.currentMessageRef.off();
        }

        this.currentMessageRef = messageRef;

        // Setup realtime listener for message details
        messageRef.on('value', (snapshot) => {
            const message = snapshot.val();
            if (!message) return;

            // Update UI with more detailed information
            this.messageContent.classList.remove('d-none');
            this.messagePlaceholder.classList.add('d-none');

            // Set appropriate title based on message type
            let title = '';
            if (message.type === 'issue') {
                title = `Book Issue: ${message.bookTitle || 'No Book Title'}`;
            } else if (message.type === 'message') {
                title = `Subject: ${message.subject || 'No Subject'}`;
            } else {
                title = message.bookTitle || 'No Title';
            }
            this.messageTitle.textContent = title;

            // Set status badge
            this.messageStatus.className = `badge ${message.status === 'pending' ? 'bg-warning' : 'bg-success'}`;
            this.messageStatus.textContent = message.status === 'pending' ? 'Pending' : 'Resolved';

            // Set detailed sender information
            const senderInfo = [];
            if (message.sender === 'librarian') {
                senderInfo.push('Sent by: Librarian');
            } else {
                senderInfo.push(`From: ${message.studentName || 'Unknown Student'}`);
                if (message.studentGrade) senderInfo.push(`Grade: ${message.studentGrade}`);
                if (message.assessmentNo) senderInfo.push(`Assessment No: ${message.assessmentNo}`);
            }
            senderInfo.push(`Date: ${new Date(message.timestamp).toLocaleString()}`);
            
            this.messageInfo.innerHTML = senderInfo.join(' | ');

            // Load conversation thread with enhanced message content
            this.loadMessageThread(messageId, message);

            // Mark as read if pending
            if (message.status === 'pending') {
                messageRef.update({ read: true });
            }
        });
    }

    async loadMessageThread(messageId, originalMessage) {
        const threadRef = firebase.database().ref(`message_threads/${messageId}`);
        
        if (this.currentThreadRef) {
            this.currentThreadRef.off();
        }
        
        this.currentThreadRef = threadRef;
        
        threadRef.on('value', (snapshot) => {
            this.messageThread.innerHTML = '';
            
            // Show the initial message with detailed content and user icon
            const initialMessage = document.createElement('div');
            initialMessage.className = 'chat-message student';
            initialMessage.innerHTML = `
                <div class="message-content-wrapper">
                    <div class="user-icon student-icon">
                        <i class="bi bi-person-circle"></i>
                        <span class="user-status"></span>
                    </div>
                    <div class="message-content">
                        <div class="message-bubble">
                            ${originalMessage.type === 'issue' ? `
                                <strong>Issue Report</strong><br>
                                ${originalMessage.description || 'No description provided'}
                            ` : `
                                <strong>${originalMessage.subject || 'Message'}</strong><br>
                                ${originalMessage.description || 'No content'}
                            `}
                            ${originalMessage.bookDetails ? `
                                <div class="book-details mt-2">
                                    <strong>Book Details:</strong><br>
                                    ${originalMessage.bookDetails}
                                </div>
                            ` : ''}
                        </div>
                        <div class="message-info">
                            ${originalMessage.studentName || 'Unknown'} • 
                            ${new Date(originalMessage.timestamp).toLocaleString()}
                        </div>
                    </div>
                </div>
            `;
            this.messageThread.appendChild(initialMessage);

            // Show thread messages
            if (snapshot.exists()) {
                const messages = [];
                snapshot.forEach(child => {
                    messages.push(child.val());
                });
                messages.sort((a, b) => a.timestamp - b.timestamp);

                messages.forEach(msg => {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = `chat-message ${msg.sender === 'admin' ? 'admin' : 'student'}`;
                    messageDiv.innerHTML = `
                        <div class="message-content-wrapper ${msg.sender === 'admin' ? 'admin' : ''}">
                            <div class="user-icon ${msg.sender === 'admin' ? 'admin-icon' : 'student-icon'}">
                                <i class="bi ${msg.sender === 'admin' ? 'bi-person-badge-fill' : 'bi-person-circle'}"></i>
                                <span class="user-status"></span>
                            </div>
                            <div class="message-content">
                                <div class="message-bubble">
                                    ${msg.content}
                                </div>
                                <div class="message-info">
                                    ${msg.sender === 'admin' ? 'Librarian' : originalMessage.studentName} • 
                                    ${new Date(msg.timestamp).toLocaleString()}
                                </div>
                            </div>
                        </div>
                    `;
                    this.messageThread.appendChild(messageDiv);
                });
            }

            // Add chat styles if not already added
            if (!document.getElementById('chatStyles')) {
                const style = document.createElement('style');
                style.id = 'chatStyles';
                style.textContent = `
                    .chat-message {
                        margin-bottom: 20px;
                    }
                    .message-content-wrapper {
                        display: flex;
                        gap: 12px;
                        align-items: flex-start;
                    }
                    .message-content-wrapper.admin {
                        flex-direction: row-reverse;
                    }
                    .user-icon {
                        width: 40px;
                        height: 40px;
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        position: relative;
                    }
                    .user-icon i {
                        font-size: 1.5rem;
                    }
                    .student-icon {
                        background: #e9ecef;
                        color: #6c757d;
                    }
                    .admin-icon {
                        background: #cfe2ff;
                        color: #0d6efd;
                    }
                    .user-status {
                        position: absolute;
                        bottom: 0;
                        right: 0;
                        width: 10px;
                        height: 10px;
                        border-radius: 50%;
                        border: 2px solid #fff;
                    }
                    .student-icon .user-status {
                        background: #ffc107;
                    }
                    .admin-icon .user-status {
                        background: #198754;
                    }
                    .message-content {
                        flex: 1;
                    }
                    .chat-message.admin .message-content {
                        text-align: right;
                    }
                    .message-bubble {
                        background: #f8f9fa;
                        padding: 12px;
                        border-radius: 12px;
                        display: inline-block;
                        max-width: 80%;
                    }
                    .chat-message.admin .message-bubble {
                        background: #e7f1ff;
                    }
                    .message-info {
                        font-size: 0.8rem;
                        color: #6c757d;
                        margin-top: 4px;
                    }
                `;
                document.head.appendChild(style);
            }

            // Scroll to bottom
            this.messageThread.scrollTop = this.messageThread.scrollHeight;
        });
    }

    async handleReply(e) {
        e.preventDefault();
        if (!this.currentMessageId) return;

        const replyInput = document.getElementById('replyInput');
        const content = replyInput.value.trim();
        if (!content) return;

        try {
            // Add reply to thread
            const threadRef = firebase.database().ref(`message_threads/${this.currentMessageId}`);
            await threadRef.push({
                content,
                sender: 'admin',
                timestamp: Date.now()
            });

            // Update issue status
            await this.messagesRef.child(this.currentMessageId).update({
                status: 'resolved',
                resolvedAt: Date.now()
            });

            replyInput.value = '';

        } catch (error) {
            console.error('Error sending reply:', error);
            alert('Error sending reply. Please try again.');
        }
    }

    async showBroadcastDialog() {
        try {
            const studentsWithActiveIssuance = new Map();
            const gradeGroups = new Map();

            // First get all active issuances
            const issuanceSnapshot = await this.db.ref('issuance')
                .orderByChild('status')
                .equalTo('active')
                .once('value');

            // Get student IDs with active issuances
            issuanceSnapshot.forEach(child => {
                const issuance = child.val();
                studentsWithActiveIssuance.set(issuance.studentId, issuance);
            });

            // Then get all students
            const studentsSnapshot = await this.db.ref('students')
                .orderByChild('grade')
                .once('value');

            // Group only students with active issuances by grade
            studentsSnapshot.forEach(child => {
                const student = { id: child.key, ...child.val() };
                if (studentsWithActiveIssuance.has(student.id)) {
                    if (!gradeGroups.has(student.grade)) {
                        gradeGroups.set(student.grade, []);
                    }
                    gradeGroups.get(student.grade).push(student);
                }
            });

            // Sort grades
            const sortedGrades = Array.from(gradeGroups.keys()).sort();

            // Update grade filter options to show count of students with active issuances
            gradeFilter.innerHTML = `
                <option value="">Select Grade</option>
                ${sortedGrades.map(grade => `
                    <option value="${grade}" class="grade-option">
                        ${grade} (${gradeGroups.get(grade).length} students with active books)
                    </option>
                `).join('')}
            `;

            // Function to render students list
            const renderStudents = (selectedGrade = '') => {
                studentsList.innerHTML = '';
                
                if (!selectedGrade) {
                    studentsList.innerHTML = '<div class="text-muted">Please select a grade</div>';
                    return;
                }

                const students = gradeGroups.get(selectedGrade) || [];
                if (students.length === 0) {
                    studentsList.innerHTML = `<div class="text-muted">No students with active books in ${selectedGrade}</div>`;
                    return;
                }

                studentsList.innerHTML = `
                    <div class="student-list-header mb-2">
                        ${students.length} students with active books in ${selectedGrade}
                    </div>
                    ${students.map(student => `
                        <div class="form-check student-item">
                            <input class="form-check-input student-check" 
                                type="checkbox" 
                                value="${student.id}" 
                                id="student_${student.id}"
                                data-grade="${student.grade}">
                            <label class="form-check-label d-flex justify-content-between" for="student_${student.id}">
                                <span>${student.name}</span>
                                <small class="text-muted">${student.grade}</small>
                            </label>
                        </div>
                    `).join('')}
                `;

                // Auto-check all checkboxes for the selected grade
                document.querySelectorAll('.student-item input[type="checkbox"]').forEach(cb => {
                    cb.checked = true;
                    cb.closest('.student-item')?.classList.add('active');
                });
            };

            // Initial render with empty selection
            renderStudents();

            // Update grade selection handler
            gradeFilter.onchange = (e) => {
                const selectedGrade = e.target.value;
                renderStudents(selectedGrade);
                
                // Show/hide appropriate buttons
                selectAllBtn.style.display = selectedGrade ? 'none' : 'inline-block';
                selectGradeBtn.style.display = selectedGrade ? 'none' : 'inline-block';
                gradeSelection.classList.remove('d-none');
            };

            // Update select grade button
            selectGradeBtn.onclick = () => {
                selectGradeBtn.classList.add('btn-primary');
                selectGradeBtn.classList.remove('btn-outline-primary');
                selectAllBtn.classList.add('btn-outline-primary');
                selectAllBtn.classList.remove('btn-primary');
                gradeSelection.classList.remove('d-none');
                renderStudents(''); // Reset student list
            };

            // Add these styles to the modal
            const style = document.createElement('style');
            style.textContent = `
                .student-item {
                    padding: 8px;
                    border-radius: 4px;
                    transition: background-color 0.2s;
                }
                .student-item.active {
                    background-color: #e7f1ff;
                }
                .student-item:hover {
                    background-color: #f8f9fa;
                }
                .grade-option {
                    font-weight: 500;
                }
                .student-list-header {
                    color: #6c757d;
                    font-size: 0.9rem;
                }
                #gradeFilter option:not(:first-child) {
                    font-weight: 500;
                }
                .btn.btn-primary {
                    font-weight: 500;
                }
            `;
            document.head.appendChild(style);

            // Enhanced send functionality
            sendBtn.onclick = async () => {
                const subject = document.getElementById('broadcastSubject').value.trim();
                const message = document.getElementById('broadcastMessage').value.trim();
                const selectedStudents = Array.from(
                    document.querySelectorAll('.student-check:checked')
                ).map(cb => ({
                    id: cb.value,
                    grade: cb.dataset.grade
                }));

                if (!subject || !message || selectedStudents.length === 0) {
                    await Swal.fire({
                        icon: 'warning',
                        title: 'Required Fields',
                        text: 'Please fill in all required fields and select at least one student'
                    });
                    return;
                }

                try {
                    sendBtn.disabled = true;
                    sendBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Sending...';

                    // Create broadcast messages
                    const messages = selectedStudents.map(student => ({
                        studentId: student.id,
                        type: 'broadcast',
                        subject,
                        message,
                        timestamp: Date.now(),
                        status: 'pending',
                        read: false,
                        grade: student.grade
                    }));

                    // Batch create messages
                    const batch = messages.map(msg => 
                        this.db.ref('issues').push(msg)
                    );

                    await Promise.all(batch);

                    await Swal.fire({
                        icon: 'success',
                        title: 'Messages Sent',
                        text: `Successfully sent to ${selectedStudents.length} students`
                    });

                    modal.hide();
                } catch (error) {
                    console.error('Error sending broadcast:', error);
                    await Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Failed to send messages. Please try again.'
                    });
                } finally {
                    sendBtn.disabled = false;
                    sendBtn.innerHTML = '<i class="bi bi-send me-1"></i>Send Message';
                }
            };

            modal.show();
        } catch (error) {
            console.error('Error showing broadcast dialog:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to load students. Please try again.'
            });
        }
    }

    async showNewMessageDialog() {
        try {
            const grades = Array.from({length: 9}, (_, i) => `Grade ${i + 1}`);

            const modalContent = `
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">New Message</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <form id="newMessageForm">
                                <div class="mb-3">
                                    <label class="form-label">Grade</label>
                                    <select class="form-select" id="messageGrade" required>
                                        <option value="">Select Grade</option>
                                        ${grades.map(grade => `
                                            <option value="${grade}">${grade}</option>
                                        `).join('')}
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Student</label>
                                    <select class="form-select" id="messageStudent" required disabled>
                                        <option value="">Select Student</option>
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Subject</label>
                                    <input type="text" class="form-control" id="newMessageSubject" required>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Message</label>
                                    <textarea class="form-control" id="newMessageContent" rows="4" required></textarea>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" id="sendNewMessage">Send Message</button>
                        </div>
                    </div>
                </div>`;

            const modalElement = document.getElementById('newMessageModal') || document.createElement('div');
            modalElement.id = 'newMessageModal';
            modalElement.className = 'modal fade';
            modalElement.innerHTML = modalContent;

            if (!document.getElementById('newMessageModal')) {
                document.body.appendChild(modalElement);
            }

            const modal = new bootstrap.Modal(modalElement);
            modal.show();

            // Add grade change handler
            const gradeSelect = document.getElementById('messageGrade');
            const studentSelect = document.getElementById('messageStudent');

            gradeSelect.onchange = async () => {
                studentSelect.innerHTML = '<option value="">Select Student</option>';
                studentSelect.disabled = true;

                if (gradeSelect.value) {
                    const studentsSnapshot = await this.db.ref('students')
                        .orderByChild('grade')
                        .equalTo(gradeSelect.value)
                        .once('value');

                    const students = [];
                    studentsSnapshot.forEach(child => {
                        students.push({
                            id: child.key,
                            ...child.val()
                        });
                    });

                    // Sort students by name
                    students.sort((a, b) => a.name.localeCompare(b.name));

                    // Populate student select
                    students.forEach(student => {
                        const option = document.createElement('option');
                        option.value = student.id;
                        option.setAttribute('data-grade', student.grade);
                        option.setAttribute('data-name', student.name);
                        option.textContent = `${student.name} (${student.assessmentNo || 'No ID'})`;
                        studentSelect.appendChild(option);
                    });

                    studentSelect.disabled = false;
                }
            };

            // Handle send button click
            document.getElementById('sendNewMessage').onclick = async () => {
                const studentSelect = document.getElementById('messageStudent');
                const selectedOption = studentSelect.selectedOptions[0];
                const studentId = studentSelect.value;
                const subject = document.getElementById('newMessageSubject').value.trim();
                const content = document.getElementById('newMessageContent').value.trim();

                if (!studentId || !subject || !content) {
                    alert('Please fill in all fields');
                    return;
                }

                try {
                    await this.db.ref('issues').push({
                        type: 'message',
                        title: subject,
                        subject: subject,
                        message: content,
                        timestamp: Date.now(),
                        status: 'pending',
                        read: false,
                        sender: 'librarian',
                        studentId: studentId,
                        studentName: selectedOption.getAttribute('data-name'),
                        studentGrade: selectedOption.getAttribute('data-grade')
                    });

                    modal.hide();
                    await this.showSuccess('Message sent successfully');
                } catch (error) {
                    console.error('Error sending message:', error);
                    await this.showError('Failed to send message');
                }
            };

        } catch (error) {
            console.error('Error showing new message dialog:', error);
            await this.showError('Failed to show message dialog');
        }
    }

    async showSuccess(message) {
        await Swal.fire({
            icon: 'success',
            title: 'Success',
            text: message,
            timer: 1500
        });
    }

    async showError(message) {
        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: message
        });
    }

    // Cleanup method to remove listeners when needed
    cleanup() {
        if (this.currentThreadRef) {
            this.currentThreadRef.off();
        }
        if (this.currentMessageRef) {
            this.currentMessageRef.off();
        }
        this.messagesRef.off();
    }
}

// Initialize message manager with cleanup
document.addEventListener('DOMContentLoaded', () => {
    if (window.messageManager) {
        window.messageManager.cleanup();
    }
    window.messageManager = new MessageManager();
});

