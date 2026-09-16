/**
 * Email Notification System
 * Sends automated emails for important events (overdue books, etc)
 * 
 * NOTE: This requires Firebase Cloud Functions backend
 * See email-functions.js for the Cloud Function implementation
 */

class EmailNotificationService {
    constructor() {
        this.db = firebase.database();
        this.isEnabled = true;
    }

    /**
     * Test Firebase permissions and auth state
     */
    static async testPermissions() {
        try {
            const user = firebase.auth().currentUser;
            console.log('🔍 Auth Status:', user ? `✅ ${user.email}` : '❌ Not authenticated');
            
            // Try to write a test entry
            const testId = 'test-' + Date.now();
            await firebase.database().ref(`notifications_queue/${testId}`).set({
                studentId: 'test',
                message: 'Permission test',
                type: 'test',
                timestamp: new Date().toISOString()
            });
            console.log('✅ Write permission OK - notifications_queue is accessible');
            
            // Clean up
            await firebase.database().ref(`notifications_queue/${testId}`).remove();
            return true;
        } catch (error) {
            console.error('❌ Permission test failed:', error.code, error.message);
            return false;
        }
    }

    /**
     * Send overdue book reminder to student/parent
     */
    async sendOverdueReminder(issuanceId, studentId, bookId) {
        try {
            loadingManager.show('Sending notification...');

            // Get student, book, and issuance details
            const [studentSnap, bookSnap, issuanceSnap] = await Promise.all([
                this.db.ref(`students/${studentId}`).once('value'),
                this.db.ref(`books/${bookId}`).once('value'),
                this.db.ref(`issuance/${issuanceId}`).once('value')
            ]);

            const student = studentSnap.val();
            const book = bookSnap.val();
            const issuance = issuanceSnap.val();

            if (!student || !book || !issuance) {
                throw new Error('Missing data for notification');
            }

            // Calculate days overdue
            const dueDate = new Date(issuance.returnDate);
            const today = new Date();
            const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

            // Prepare notification data
            const notificationData = {
                type: 'OVERDUE_BOOK',
                studentName: student.fullName || student.name,
                studentEmail: student.email || '',
                phoneNumber: student.phoneNumber || '',
                bookTitle: book.title,
                isbn: book.isbn,
                issueDate: issuance.issueDate,
                dueDate: issuance.returnDate,
                daysOverdue: daysOverdue,
                timestamp: new Date().getTime(),
                issuanceId: issuanceId
            };

            // Save to database for Cloud Function to process
            const notificationId = this.db.ref('notifications_queue').push().key;
            await this.db.ref(`notifications_queue/${notificationId}`).set(notificationData);

            // Record that notification was sent
            await this.db.ref(`issuance/${issuanceId}/lastOverdueNotification`).set(new Date().getTime());

            loadingManager.hide();
            await toast.success('Overdue reminder sent successfully');

            return true;
        } catch (error) {
            console.error('Error sending overdue reminder:', error);
            loadingManager.hide();
            
            // Handle permission denied - likely auth not ready yet
            if (error.code === 'PERMISSION_DENIED') {
                console.warn('⚠️ Permission denied for notifications_queue. Ensure user is authenticated and Firebase rules are deployed.');
                return false;
            }
            
            await toast.error('Failed to send notification: ' + error.message);
            return false;
        }
    }

    /**
     * Send bulk overdue reminders
     */
    async sendBulkOverdueReminders(issuanceIds) {
        try {
            loadingManager.progress('Sending reminders...', 0, issuanceIds.length);

            for (let i = 0; i < issuanceIds.length; i++) {
                const issuanceId = issuanceIds[i];
                const issuanceSnap = await this.db.ref(`issuance/${issuanceId}`).once('value');
                const issuance = issuanceSnap.val();

                if (issuance && issuance.status === 'active') {
                    await this.sendOverdueReminder(issuanceId, issuance.studentId, issuance.bookId);
                }

                loadingManager.progress('Sending reminders...', i + 1, issuanceIds.length);
            }

            loadingManager.hide();
            await toast.success(`Sent ${issuanceIds.length} reminder notifications`);

            return true;
        } catch (error) {
            console.error('Error in bulk send:', error);
            loadingManager.hide();
            await toast.error('Error sending reminders: ' + error.message);
            return false;
        }
    }

    /**
     * Get all overdue books
     */
    async getOverdueBooks() {
        try {
            const snapshot = await this.db.ref('issuance')
                .orderByChild('status')
                .equalTo('active')
                .once('value');

            if (!snapshot.exists()) return [];

            const overdueBooks = [];
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            snapshot.forEach(childSnapshot => {
                const issuance = childSnapshot.val();
                const dueDate = new Date(issuance.returnDate);
                dueDate.setHours(0, 0, 0, 0);

                if (dueDate < today) {
                    overdueBooks.push({
                        id: childSnapshot.key,
                        ...issuance
                    });
                }
            });

            return overdueBooks;
        } catch (error) {
            console.error('Error fetching overdue books:', error);
            return [];
        }
    }

    /**
     * Send book return reminder (days before due date)
     */
    async sendReturnReminder(issuanceId, studentId, daysBeforeDue = 1) {
        try {
            loadingManager.show('Sending return reminder...');

            const [studentSnap, issuanceSnap] = await Promise.all([
                this.db.ref(`students/${studentId}`).once('value'),
                this.db.ref(`issuance/${issuanceId}`).once('value')
            ]);

            const student = studentSnap.val();
            const issuance = issuanceSnap.val();

            const notificationData = {
                type: 'RETURN_REMINDER',
                studentName: student.fullName || student.name,
                studentEmail: student.email || '',
                bookTitle: issuance.bookTitle || 'Unknown Book',
                returnDate: issuance.returnDate,
                daysUntilDue: daysBeforeDue,
                timestamp: new Date().getTime()
            };

            const notificationId = this.db.ref('notifications_queue').push().key;
            await this.db.ref(`notifications_queue/${notificationId}`).set(notificationData);

            loadingManager.hide();
            return true;
        } catch (error) {
            console.error('Error sending return reminder:', error);
            loadingManager.hide();
            return false;
        }
    }

    /**
     * Send lost book notification
     */
    async sendLostBookNotification(issuanceId, studentId) {
        try {
            const [studentSnap, issuanceSnap] = await Promise.all([
                this.db.ref(`students/${studentId}`).once('value'),
                this.db.ref(`issuance/${issuanceId}`).once('value')
            ]);

            const student = studentSnap.val();
            const issuance = issuanceSnap.val();

            const notificationData = {
                type: 'LOST_BOOK',
                studentName: student.fullName || student.name,
                studentEmail: student.email || '',
                parentEmail: student.parentEmail || '',
                bookTitle: issuance.bookTitle,
                isbn: issuance.isbn,
                timestamp: new Date().getTime()
            };

            const notificationId = this.db.ref('notifications_queue').push().key;
            await this.db.ref(`notifications_queue/${notificationId}`).set(notificationData);

            return true;
        } catch (error) {
            console.error('Error sending lost book notification:', error);
            return false;
        }
    }

    /**
     * Disable/enable notifications
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
    }

    /**
     * Get notification history
     */
    async getNotificationHistory(studentId, limit = 50) {
        try {
            const snapshot = await this.db.ref('notifications_queue')
                .once('value');

            if (!snapshot.exists()) return [];

            const notifications = [];
            snapshot.forEach(child => {
                const notif = child.val();
                if (notif.studentEmail && notifications.length < limit) {
                    notifications.push({
                        id: child.key,
                        ...notif
                    });
                }
            });

            return notifications;
        } catch (error) {
            console.error('Error fetching notification history:', error);
            return [];
        }
    }
}

/**
 * Automatic Notification Scheduler
 */
class NotificationScheduler {
    constructor() {
        this.db = firebase.database();
        this.emailService = new EmailNotificationService();
        this.checkInterval = null;
    }

    /**
     * Start automatic checks for overdue books
     */
    startAutomaticChecks(intervalMinutes = 60) {
        if (this.checkInterval) return; // Already running

        console.log(`Starting automatic overdue checks every ${intervalMinutes} minutes`);

        // Run immediately
        this.checkOverdueBooks();

        // Then run at intervals
        this.checkInterval = setInterval(() => {
            this.checkOverdueBooks();
        }, intervalMinutes * 60 * 1000);
    }

    /**
     * Stop automatic checks
     */
    stopAutomaticChecks() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            console.log('Automatic checks stopped');
        }
    }

    /**
     * Check for overdue books and send reminders
     */
    async checkOverdueBooks() {
        try {
            console.log('Checking for overdue books...');

            const overdueBooks = await this.emailService.getOverdueBooks();

            if (overdueBooks.length === 0) {
                console.log('No overdue books found');
                return;
            }

            console.log(`Found ${overdueBooks.length} overdue books`);

            // Send reminders for books that haven't been reminded recently
            const remindersToSend = [];
            const oneDay = 24 * 60 * 60 * 1000;
            const now = new Date().getTime();

            for (const book of overdueBooks) {
                const lastNotification = book.lastOverdueNotification || 0;
                const timeSinceLastNotification = now - lastNotification;

                // Send reminder if it's been more than 24 hours since last notification
                if (timeSinceLastNotification > oneDay) {
                    remindersToSend.push(book.id);
                }
            }

            if (remindersToSend.length > 0) {
                console.log(`Sending ${remindersToSend.length} overdue reminders`);
                await this.emailService.sendBulkOverdueReminders(remindersToSend);
            }

        } catch (error) {
            console.error('Error checking overdue books:', error);
        }
    }
}

// Create global instances
const emailNotificationService = new EmailNotificationService();
const notificationScheduler = new NotificationScheduler();

// Make global
window.EmailNotificationService = EmailNotificationService;
window.NotificationScheduler = NotificationScheduler;
window.emailNotificationService = emailNotificationService;
window.notificationScheduler = notificationScheduler;

// Wait for auth to be ready before starting automatic checks
firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        console.log('✅ User authenticated:', user.email);
        // Auto-checks DISABLED - Manual Firebase rule configuration needed
        // After you manually set rules in Firebase Console, uncomment line below:
        // notificationScheduler.startAutomaticChecks(60);
        console.log('⏸️ Email notifications ready. Configure Firebase rules and run: notificationScheduler.startAutomaticChecks(60)');
    } else {
        console.log('⚠️ User not authenticated. Email notifications waiting for login.');
    }
});
