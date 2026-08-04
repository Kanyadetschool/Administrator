//Updated teachers.js with Notification System
import { auth, db } from './firebase-config.js';
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";
import { 
    collection, 
    addDoc, 
    query, 
    where, 
    getDocs, 
    orderBy,
    doc,
    getDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    limit,
    arrayUnion,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

let currentUser = null;
let allUserRequests = [];
let allNotifications = [];

// Pagination Variables
let currentPage = 1;
let itemsPerPage = 5;
let totalPages = 1;

// Active filter state
let activeStatusFilter = 'all';

// Real-time listeners
let unsubscribeRequests = null;
let unsubscribeNotifications = null;

// Check authentication
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'index.html';
        return;
    }
    
    currentUser = user;
    
    // Load user data
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
       const userData = userDoc.data();
document.getElementById('userName').textContent = userData.displayName || user.email.split('@')[0];
document.getElementById('userEmail').textContent = user.email;

// NEW: Sync currentUser with Firestore data (fixes senderName bug)
currentUser.displayName = userData.displayName || user.email.split('@')[0];  // Use Firestore name
currentUser.photoURL = userData.photoURL || user.photoURL;  // Prefer Firestore photo, fallback to Auth

// Display user photo (unchanged)
if (userData.photoURL) {
    document.getElementById('userPhoto').src = userData.photoURL;
    document.getElementById('userPhoto').style.display = 'block';
    document.getElementById('avatarPlaceholder').style.display = 'none';
} else {
    // Show initial letter
    const initial = (userData.displayName || user.email).charAt(0).toUpperCase();
    document.getElementById('avatarPlaceholder').textContent = initial;
}
        
        // Redirect admin to admin dashboard
        if (userData.role === 'admin') {
            window.location.href = 'admin-dashboard.html';
            return;
        }
    }
    
    // Load dashboard data with real-time listeners
    loadRequests();
    loadNotifications(); // NEW: Load notifications
    loadMessageThreads()
    checkRecentUpdates();
});

// ============================================
// NOTIFICATION SYSTEM - NEW
// ============================================

// Load notifications with real-time listener
function loadNotifications() {
    if (!currentUser) return;
    
    try {
        // Unsubscribe from previous listener if it exists
        if (unsubscribeNotifications) {
            unsubscribeNotifications();
        }
        
        const q = query(
            collection(db, 'notifications'),
            where('recipientEmail', '==', currentUser.email),
            orderBy('createdAt', 'desc'),
            limit(50) // Limit to last 50 notifications
        );
        
        // Set up real-time listener
        unsubscribeNotifications = onSnapshot(q, (querySnapshot) => {
            allNotifications = [];
            
            querySnapshot.forEach((docSnap) => {
                allNotifications.push({ id: docSnap.id, ...docSnap.data() });
            });
            
            // Update notification UI
            updateNotificationBadge();
            
        }, (error) => {
            console.error('Error loading notifications:', error);
        });
        
    } catch (error) {
        console.error('Error setting up notifications listener:', error);
    }
}

// Update notification badge
function updateNotificationBadge() {
    const unreadCount = allNotifications.filter(n => !n.read).length;
    const badge = document.getElementById('notificationBadge');
    
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

// Toggle notification panel
window.toggleNotificationPanel = function() {
    const panel = document.getElementById('notificationPanel');
    
    if (!panel) {
        console.error('Notification panel not found');
        return;
    }
    
    const isActive = panel.classList.contains('active');
    
    if (isActive) {
        panel.classList.remove('active');
        panel.style.display = 'none';
    } else {
        panel.style.display = 'block';
        panel.classList.add('active');
        renderNotifications();
    }
};

// Render notifications in panel
function renderNotifications() {
    const container = document.getElementById('notificationList');
    
    if (!container) {
        console.error('Notification list container not found');
        return;
    }
    
    if (allNotifications.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem 1rem; color: #999;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">📭</div>
                <p style="margin: 0; font-size: 1.1rem;">No notifications yet</p>
                <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem;">You'll be notified when admins send you messages</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = allNotifications.map(notification => {
        const isUnread = !notification.read;
        const priorityColor = notification.priority === 'urgent' ? '#dc3545' :
                             notification.priority === 'high' ? '#ff9800' :
                             '#2196F3';
        
        const priorityIcon = notification.priority === 'urgent' ? '🔴' :
                            notification.priority === 'high' ? '🟠' :
                            '🔵';
        
        const timeAgo = getTimeAgo(notification.createdAt);
        
        return `
            <div class="notification-item ${isUnread ? 'unread' : ''}" onclick="markNotificationAsRead('${notification.id}')" style="padding: 1rem; border-bottom: 1px solid #e0e0e0; cursor: pointer; transition: all 0.3s; ${isUnread ? 'background: #f0f7ff;' : 'background: white;'}" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='${isUnread ? '#f0f7ff' : 'white'}'">
                <div style="display: flex; gap: 1rem; align-items: start;">
                    <!-- Priority Indicator -->
                    <div style="font-size: 1.5rem; line-height: 1;">${priorityIcon}</div>
                    
                    <!-- Notification Content -->
                    <div style="flex: 1; min-width: 0;">
                        <div style="display: flex; justify-content: space-between; align-items: start; gap: 0.5rem; margin-bottom: 0.5rem;">
                            <h4 style="margin: 0; font-size: 1rem; color: #333; ${isUnread ? 'font-weight: 700;' : 'font-weight: 500;'}">
                                ${notification.title}
                            </h4>
                            ${isUnread ? '<span style="width: 8px; height: 8px; background: #2196F3; border-radius: 50%; flex-shrink: 0; margin-top: 0.4rem;"></span>' : ''}
                        </div>
                        
                        <p style="margin: 0 0 0.75rem 0; color: #555; font-size: 0.95rem; line-height: 1.5; word-break: break-word;">
                            ${notification.message}
                        </p>
                        
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                            <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
                                <small style="color: #666; font-size: 0.85rem;">
                                    📅 ${timeAgo}
                                </small>
                                <small style="color: #666; font-size: 0.85rem;">
                                    👤 From: ${notification.senderName || notification.senderEmail}
                                </small>
                            </div>
                            ${notification.priority !== 'normal' ? `
                            <span style="background: ${priorityColor}; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">
                                ${notification.priority}
                            </span>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Mark notification as read
window.markNotificationAsRead = async function(notificationId) {
    try {
        const notification = allNotifications.find(n => n.id === notificationId);
        
        if (!notification || notification.read) {
            return; // Already read or not found
        }
        
        const docRef = doc(db, 'notifications', notificationId);
        await updateDoc(docRef, {
            read: true,
            readAt: new Date().toISOString()
        });
        
        // UI will update automatically via real-time listener
        
    } catch (error) {
        console.error('Error marking notification as read:', error);
    }
};

// Mark all notifications as read
window.markAllNotificationsAsRead = async function() {
    try {
        const unreadNotifications = allNotifications.filter(n => !n.read);
        
        if (unreadNotifications.length === 0) {
            return;
        }
        
        const promises = unreadNotifications.map(notification => {
            const docRef = doc(db, 'notifications', notification.id);
            return updateDoc(docRef, {
                read: true,
                readAt: new Date().toISOString()
            });
        });
        
        await Promise.all(promises);
        
        showNotification('All notifications marked as read', 'success');
        
    } catch (error) {
        console.error('Error marking all as read:', error);
        showNotification('Error marking notifications as read', 'error');
    }
};

// Delete notification
window.deleteNotification = async function(notificationId, event) {
    if (event) event.stopPropagation();
    showConfirm('Delete this notification?', async () => {
        try {
            await deleteDoc(doc(db, 'notifications', notificationId));
        } catch (error) {
            console.error('Error deleting notification:', error);
            showNotification('❌ Error deleting notification.', 'error');
        }
    });
};

// Clear all notifications
window.clearAllNotifications = async function() {
    if (allNotifications.length === 0) {
        showNotification('No notifications to clear', 'warning');
        return;
    }
    
    showConfirm(`Delete all ${allNotifications.length} notification(s)?\n\nThis action cannot be undone.`, async () => {
        try {
            const promises = allNotifications.map(notification => deleteDoc(doc(db, 'notifications', notification.id)));
            await Promise.all(promises);
            showNotification('All notifications cleared', 'success');
            toggleNotificationPanel();
        } catch (error) {
            console.error('Error clearing notifications:', error);
            showNotification('❌ Error clearing notifications.', 'error');
        }
    });
};
// Helper: Get time ago string
function getTimeAgo(timestamp) {
    if (!timestamp) return 'Just now'; // or '—'

    // Handle Firebase Timestamp object (most common case from Firestore)
    let date;
    if (timestamp?.toDate && typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();           // Convert Firestore Timestamp → JS Date
    } else if (timestamp?.seconds) {
        // Raw seconds + nanoseconds format (rare but possible)
        date = new Date(timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1000000);
    } else {
        // Fallback: assume it's already a string, number, or Date
        date = new Date(timestamp);
    }

    if (isNaN(date.getTime())) return 'Invalid date';

    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

    return date.toLocaleDateString('en-KE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}
// ============================================
// END NOTIFICATION SYSTEM
// ============================================

// Check for recent updates to requests
async function checkRecentUpdates() {
    if (!currentUser) return;
    
    try {
        const q = query(
            collection(db, 'requests'),
            where('userId', '==', currentUser.uid),
            where('status', 'in', ['approved', 'rejected', 'deleted'])
        );
        
        const querySnapshot = await getDocs(q);
        const recentlyReviewed = [];
        
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.reviewedAt && new Date(data.reviewedAt) > oneDayAgo) {
                recentlyReviewed.push(data);
            }
            // Also check for recently deleted
            if (data.deletedAt && new Date(data.deletedAt) > oneDayAgo) {
                recentlyReviewed.push(data);
            }
        });
        
        if (recentlyReviewed.length > 0) {
            const approved = recentlyReviewed.filter(r => r.status === 'approved').length;
            const rejected = recentlyReviewed.filter(r => r.status === 'rejected').length;
            const deleted = recentlyReviewed.filter(r => r.status === 'deleted').length;
            
            let message = '';
            if (deleted > 0) {
                message = `🗑️ ${deleted} of your request(s) ${deleted === 1 ? 'has' : 'have'} been deleted by an admin.`;
            } else if (approved > 0 && rejected > 0) {
                message = `🔔 You have ${approved} approved and ${rejected} rejected request(s) in the last 24 hours.`;
            } else if (approved > 0) {
                message = `✅ Great news! ${approved} of your request(s) ${approved === 1 ? 'has' : 'have'} been approved!`;
            } else {
                message = `⚠️ ${rejected} of your request(s) ${rejected === 1 ? 'has' : 'have'} been reviewed.`;
            }
            
            showNotification(message, deleted > 0 ? 'error' : (approved > 0 ? 'success' : 'warning'));
        }
    } catch (error) {
        console.error('Error checking updates:', error);
    }
}

// ============================================
// CUSTOM CONFIRM MODAL (replaces native confirm())
// ============================================
window.showConfirm = function(message, onConfirm, onCancel) {
    let existing = document.getElementById('customConfirmModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'customConfirmModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;';
    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:2rem;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <h3 style="margin:0 0 1rem;color:#333;font-size:1.1rem;">Confirm Action</h3>
            <p style="margin:0 0 1.5rem;color:#555;line-height:1.6;white-space:pre-line;">${message}</p>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
                <button id="confirmCancel" style="padding:0.6rem 1.25rem;background:#f5f5f5;color:#555;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:0.95rem;">Cancel</button>
                <button id="confirmOk" style="padding:0.6rem 1.25rem;background:#8B1538;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.95rem;font-weight:500;">Confirm</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('confirmOk').onclick = () => { modal.remove(); if (onConfirm) onConfirm(); };
    document.getElementById('confirmCancel').onclick = () => { modal.remove(); if (onCancel) onCancel(); };
    modal.onclick = (e) => { if (e.target === modal) { modal.remove(); if (onCancel) onCancel(); } };
};

// Show notification banner
window.showNotification = function(message, type = 'success') {
    const banner = document.getElementById('notificationBanner');
    const text = document.getElementById('notificationText');
    
    text.textContent = message;
    banner.className = 'notification-banner';
    if (type === 'warning') banner.classList.add('warning');
    if (type === 'error') banner.classList.add('error');
    
    banner.style.display = 'flex';
};

// Close notification banner
window.closeNotification = function() {
    document.getElementById('notificationBanner').style.display = 'none';
};

// Logout functionality with audit trail
document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
        if (currentUser) {
            // Log logout event
            await addDoc(collection(db, 'audit_logs'), {
                userId: currentUser.uid,
                email: currentUser.email,
                role: 'teacher',
                action: 'logout',
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent
            });
        }

        // Cleanup listeners
      // Cleanup listeners
if (unsubscribeRequests) unsubscribeRequests();
if (unsubscribeNotifications) unsubscribeNotifications();
if (unsubscribeThreads) unsubscribeThreads();  // NEW: Clean messaging threads
if (unsubscribeMessages) unsubscribeMessages();  // NEW: Clean active chat
        
        await signOut(auth);
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Logout error:', error);
        showNotification('❌ Error logging out. Please try again.', 'error');
    }
});

// Pagination Functions
window.goToPage = function(pageNumber) {
    if (pageNumber >= 1 && pageNumber <= totalPages) {
        currentPage = pageNumber;
        displayRequests(allUserRequests);
    }
};

window.previousPage = function() {
    if (currentPage > 1) {
        currentPage--;
        displayRequests(allUserRequests);
    }
};

window.nextPage = function() {
    if (currentPage < totalPages) {
        currentPage++;
        displayRequests(allUserRequests);
    }
};

window.changeItemsPerPage = function(newItemsPerPage) {
    itemsPerPage = parseInt(newItemsPerPage);
    currentPage = 1;
    displayRequests(allUserRequests);
};

function updatePaginationControls() {
    const paginationContainer = document.getElementById('paginationContainer');
    if (!paginationContainer) return;
    
    let paginationHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; padding: 1.5rem; background: #f5f5f5; border-radius: 6px;">
            <div style="font-size: 0.9rem; color: #666;">
                Showing <strong>${(currentPage - 1) * itemsPerPage + 1}</strong> to <strong>${Math.min(currentPage * itemsPerPage, allUserRequests.length)}</strong> of <strong>${allUserRequests.length}</strong> requests
            </div>
            
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <button onclick="previousPage()" ${currentPage === 1 ? 'disabled' : ''} style="padding: 0.5rem 1rem; background: ${currentPage === 1 ? '#ccc' : '#8B1538'}; color: white; border: none; border-radius: 4px; cursor: ${currentPage === 1 ? 'not-allowed' : 'pointer'}; font-weight: 500; transition: all 0.3s;">
                    ← Previous
                </button>
    `;
    
    // Page buttons
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, currentPage + 2);
    
    if (startPage > 1) {
        paginationHTML += `<button onclick="goToPage(1)" style="padding: 0.5rem 1rem; background: white; color: #8B1538; border: 1px solid #8B1538; border-radius: 4px; cursor: pointer; font-weight: 500;">1</button>`;
        if (startPage > 2) {
            paginationHTML += `<span style="padding: 0.5rem 0.5rem; color: #666;">...</span>`;
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        paginationHTML += `
            <button onclick="goToPage(${i})" style="padding: 0.5rem 1rem; background: ${i === currentPage ? '#8B1538' : 'white'}; color: ${i === currentPage ? 'white' : '#8B1538'}; border: 1px solid #8B1538; border-radius: 4px; cursor: pointer; font-weight: 500; transition: all 0.3s;">
                ${i}
            </button>
        `;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            paginationHTML += `<span style="padding: 0.5rem 0.5rem; color: #666;">...</span>`;
        }
        paginationHTML += `<button onclick="goToPage(${totalPages})" style="padding: 0.5rem 1rem; background: white; color: #8B1538; border: 1px solid #8B1538; border-radius: 4px; cursor: pointer; font-weight: 500;">${totalPages}</button>`;
    }
    
    paginationHTML += `
                <button onclick="nextPage()" ${currentPage === totalPages ? 'disabled' : ''} style="padding: 0.5rem 1rem; background: ${currentPage === totalPages ? '#ccc' : '#8B1538'}; color: white; border: none; border-radius: 4px; cursor: ${currentPage === totalPages ? 'not-allowed' : 'pointer'}; font-weight: 500; transition: all 0.3s;">
                    Next →
                </button>
            </div>
            
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <label for="itemsPerPageSelect" style="color: #666; font-size: 0.9rem;">Items per page:</label>
                <select id="itemsPerPageSelect" onchange="changeItemsPerPage(this.value)" style="padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; cursor: pointer;">
                    <option value="5" ${itemsPerPage === 5 ? 'selected' : ''}>5</option>
                    <option value="10" ${itemsPerPage === 10 ? 'selected' : ''}>10</option>
                    <option value="25" ${itemsPerPage === 25 ? 'selected' : ''}>25</option>
                    <option value="50" ${itemsPerPage === 50 ? 'selected' : ''}>50</option>
                </select>
            </div>
        </div>
    `;
    
    paginationContainer.innerHTML = paginationHTML;
}

window.withdrawRequest = async function(requestId) {
    try {
        const docRef = doc(db, 'requests', requestId);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
            showNotification('❌ Request not found.', 'error');
            return;
        }
        
        const request = docSnap.data();
        
        if (request.userId !== currentUser.uid) {
            showNotification('❌ You can only withdraw your own requests.', 'error');
            return;
        }
        
        if (request.status !== 'pending') {
            showNotification(`❌ Only pending requests can be withdrawn. This request has already been ${request.status}.`, 'error');
            return;
        }
        
        const confirmMessage = `Are you sure you want to withdraw this request?\n\nType: ${getTypeName(request.type, request.requestType)}\nDate: ${request.date || request.startDate}\n\n⚠️ This action cannot be undone. The request will be permanently deleted.`;
        
        showConfirm(confirmMessage, async () => {
            try {
                await deleteDoc(docRef);
                showNotification('✅ Request withdrawn and permanently deleted.', 'success');
            } catch (error) {
                console.error('Error withdrawing request:', error);
                showNotification('❌ Error withdrawing request. Please try again.', 'error');
            }
        });
        
    } catch (error) {
        console.error('Error withdrawing request:', error);
        showNotification('❌ Error withdrawing request. Please try again.', 'error');
    }
};

// Modal functions
window.openModal = function(type) {
    const modalId = type === 'permission' ? 'permissionModal' :
                   type === 'sick-leave' ? 'sickLeaveModal' :
                   type === 'court-summon' ? 'courtSummonModal' :
                   type === 'profile' ? 'profileModal' :
                   type === 'leave-balance' ? 'leaveBalanceModal' :
                   type === 'calendar' ? 'calendarModal' :
                   type === 'upload' ? 'uploadModal' :
                   'otherModal';
    
    // Show the modal first so DOM elements inside are accessible
    document.getElementById(modalId).classList.add('active');

    // Then run data-loading functions that update modal content
    if (type === 'profile') {
        loadProfileData();
    } else if (type === 'leave-balance') {
        showLeaveBalance();
    } else if (type === 'calendar') {
        const yearSpan = document.getElementById('calendarYear');
        if (yearSpan) yearSpan.textContent = currentCalendarDate.getFullYear();
        renderCalendar();
    } else if (['permission', 'sick-leave', 'court-summon', 'other'].includes(type)) {
        setTimeout(() => restoreDraft(type), 50);
    }
};

// ============================================
// DRAFT AUTO-SAVE SYSTEM
// ============================================

function saveDraft(type) {
    const drafts = {
        'permission': () => ({
            date: document.getElementById('permissionDate')?.value,
            time: document.getElementById('permissionTime')?.value,
            reason: document.getElementById('permissionReason')?.value
        }),
        'sick-leave': () => ({
            startDate: document.getElementById('sickLeaveStartDate')?.value,
            endDate: document.getElementById('sickLeaveEndDate')?.value,
            diagnosis: document.getElementById('sickLeaveDiagnosis')?.value,
            doctorName: document.getElementById('sickLeaveDoctorName')?.value,
            documentNumber: document.getElementById('sickLeaveDocumentNumber')?.value,
            delegate: document.getElementById('sickLeaveDelegate')?.value
        }),
        'court-summon': () => ({
            courtDate: document.getElementById('courtDate')?.value,
            courtName: document.getElementById('courtName')?.value,
            caseNumber: document.getElementById('caseNumber')?.value,
            courtReason: document.getElementById('courtReason')?.value,
            summonDocument: document.getElementById('summonDocument')?.value
        }),
        'other': () => ({
            otherType: document.getElementById('otherType')?.value,
            startDate: document.getElementById('otherStartDate')?.value,
            endDate: document.getElementById('otherEndDate')?.value,
            reason: document.getElementById('otherReason')?.value,
            documents: document.getElementById('otherDocuments')?.value
        })
    };
    if (drafts[type]) {
        const data = drafts[type]();
        const hasContent = Object.values(data).some(v => v && v.trim && v.trim() !== '');
        if (hasContent) {
            localStorage.setItem(`draft_${type}`, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
        }
    }
}

function restoreDraft(type) {
    const raw = localStorage.getItem(`draft_${type}`);
    if (!raw) return;
    try {
        const d = JSON.parse(raw);
        const savedAt = new Date(d.savedAt).toLocaleString('en-KE');
        const banner = document.createElement('div');
        banner.id = 'draftRestoreBanner';
        banner.style.cssText = 'background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:0.75rem 1rem;margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;gap:0.5rem;font-size:0.9rem;';
        banner.innerHTML = `<span>📝 Draft saved ${savedAt} — restore it?</span><div style="display:flex;gap:0.5rem;"><button id="draftYes" style="padding:0.3rem 0.8rem;background:#8B1538;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.85rem;">Restore</button><button id="draftNo" style="padding:0.3rem 0.8rem;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;cursor:pointer;font-size:0.85rem;">Discard</button></div>`;

        const fills = {
            'permission': () => {
                document.getElementById('permissionDate').value = d.date || '';
                document.getElementById('permissionTime').value = d.time || '';
                document.getElementById('permissionReason').value = d.reason || '';
            },
            'sick-leave': () => {
                document.getElementById('sickLeaveStartDate').value = d.startDate || '';
                document.getElementById('sickLeaveEndDate').value = d.endDate || '';
                document.getElementById('sickLeaveDiagnosis').value = d.diagnosis || '';
                document.getElementById('sickLeaveDoctorName').value = d.doctorName || '';
                document.getElementById('sickLeaveDocumentNumber').value = d.documentNumber || '';
                document.getElementById('sickLeaveDelegate').value = d.delegate || '';
            },
            'court-summon': () => {
                document.getElementById('courtDate').value = d.courtDate || '';
                document.getElementById('courtName').value = d.courtName || '';
                document.getElementById('caseNumber').value = d.caseNumber || '';
                document.getElementById('courtReason').value = d.courtReason || '';
                document.getElementById('summonDocument').value = d.summonDocument || '';
            },
            'other': () => {
                document.getElementById('otherType').value = d.otherType || '';
                document.getElementById('otherStartDate').value = d.startDate || '';
                document.getElementById('otherEndDate').value = d.endDate || '';
                document.getElementById('otherReason').value = d.reason || '';
                document.getElementById('otherDocuments').value = d.documents || '';
            }
        };

        const formId = type === 'permission' ? 'permissionForm' : type === 'sick-leave' ? 'sickLeaveForm' : type === 'court-summon' ? 'courtSummonForm' : 'otherForm';
        const form = document.getElementById(formId);
        if (form) {
            form.insertBefore(banner, form.firstChild);
            document.getElementById('draftYes').onclick = () => { fills[type]?.(); banner.remove(); };
            document.getElementById('draftNo').onclick = () => { localStorage.removeItem(`draft_${type}`); banner.remove(); };
        }
    } catch(e) { localStorage.removeItem(`draft_${type}`); }
}

window.closeModal = function(type) {
    // Save draft before closing
    saveDraft(type);

    const modalId = type === 'permission' ? 'permissionModal' :
                   type === 'sick-leave' ? 'sickLeaveModal' :
                   type === 'court-summon' ? 'courtSummonModal' :
                   type === 'profile' ? 'profileModal' :
                   type === 'leave-balance' ? 'leaveBalanceModal' :
                   type === 'calendar' ? 'calendarModal' :
                   type === 'upload' ? 'uploadModal' :
                   'otherModal';
    
    document.getElementById(modalId).classList.remove('active');
    
    const formId = type === 'permission' ? 'permissionForm' :
                  type === 'sick-leave' ? 'sickLeaveForm' :
                  type === 'court-summon' ? 'courtSummonForm' :
                  type === 'profile' ? 'profileForm' :
                  'otherForm';
    
    if (document.getElementById(formId)) {
        document.getElementById(formId).reset();
        const banner = document.getElementById('draftRestoreBanner');
        if (banner) banner.remove();
    }
};

window.closeDetailsModal = function() {
    const modal = document.getElementById('requestDetailsModal');
    if (modal) {
        modal.classList.remove('active');
    }
};

// Load profile data
async function loadProfileData() {
    if (!currentUser) return;
    
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            document.getElementById('profileName').value = userData.displayName || '';
            document.getElementById('profileTSC').value = userData.tscNumber || '';
            document.getElementById('profileEmail').value = currentUser.email;
        }
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

// Update profile
window.updateProfile = async function() {
    if (!currentUser) return;
    
    const displayName = document.getElementById('profileName').value.trim();
    const tscNumber = document.getElementById('profileTSC').value.trim();
    const emailNotifications = document.getElementById('emailNotifications').checked;
    
    if (!displayName) {
        showNotification('⚠️ Display name is required.', 'warning');
        return;
    }
    
    try {
        await updateDoc(doc(db, 'users', currentUser.uid), {
            displayName: displayName,
            tscNumber: tscNumber || null,
            emailNotifications: emailNotifications
        });
        
        document.getElementById('userName').textContent = displayName;
        
        if (!currentUser.photoURL) {
            document.getElementById('avatarPlaceholder').textContent = displayName.charAt(0).toUpperCase();
        }
        
        closeModal('profile');
        showNotification('Profile updated successfully!', 'success');
        
    } catch (error) {
        console.error('Error updating profile:', error);
        showNotification('❌ Error updating profile. Please try again.', 'error');
    }
};

// Calendar functionality
let currentCalendarDate = new Date();

window.changeCalendarMonth = function(direction) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + direction);
    renderCalendar();
};

async function renderCalendar() {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    
    document.getElementById('calendarMonthYear').textContent = 
        new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const leaveDates = await getLeaveCalendarData(year, month);
    
    let calendarHTML = '';
    
    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.forEach(day => {
        calendarHTML += `<div class="calendar-day-header">${day}</div>`;
    });
    
    for (let i = 0; i < firstDay; i++) {
        calendarHTML += `<div class="calendar-day empty"></div>`;
    }
    
    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = year === today.getFullYear() && 
                       month === today.getMonth() && 
                       day === today.getDate();
        
        let dayClass = 'calendar-day';
        if (isToday) dayClass += ' today';
        
        if (leaveDates[dateStr]) {
            if (leaveDates[dateStr].status === 'approved') {
                dayClass += ' has-leave';
            } else if (leaveDates[dateStr].status === 'pending') {
                dayClass += ' has-pending';
            } else if (leaveDates[dateStr].status === 'deleted') {
                dayClass += ' has-deleted';
            } else {
                dayClass += ' has-rejected';
            }
        }
        
        const title = leaveDates[dateStr] ? 
            `${leaveDates[dateStr].type} - ${leaveDates[dateStr].status}` : '';
        const requestId = leaveDates[dateStr]?.requestId || '';
        const clickAttr = requestId ? `onclick="viewRequest('${requestId}')" style="cursor:pointer;"` : `onclick="showCalendarDayOption('${dateStr}')" style="cursor:pointer;"`;

        calendarHTML += `
            <div class="${dayClass}" title="${title}" ${clickAttr}>
                ${day}
                ${leaveDates[dateStr] ? `<span style="display:block;font-size:0.55rem;margin-top:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${leaveDates[dateStr].status}</span>` : ''}
            </div>
        `;
    }
    
    document.getElementById('calendarGrid').innerHTML = calendarHTML;
}

async function getLeaveCalendarData(year, month) {
    if (!currentUser) return {};
    
    const leaveDates = {};
    
    allUserRequests.forEach(request => {
        let startDate, endDate;
        
        if (request.type === 'sick-leave' || request.type === 'other') {
            if (request.startDate && request.endDate) {
                startDate = new Date(request.startDate);
                endDate = new Date(request.endDate);
            }
        } else if (request.type === 'permission') {
            startDate = new Date(request.date);
            endDate = new Date(request.date);
        }
        
        if (startDate && endDate) {
            let currentDate = new Date(startDate);
            while (currentDate <= endDate) {
                if (currentDate.getFullYear() === year && currentDate.getMonth() === month) {
                    const dateStr = currentDate.toISOString().split('T')[0];
                    leaveDates[dateStr] = {
                        type: request.type,
                        status: request.status,
                        requestId: request.id
                    };
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }
        }
    });
    
    return leaveDates;
}

window.showCalendarDayOption = function(dateStr) {
    const formatted = new Date(dateStr).toLocaleDateString('en-KE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    showConfirm(`No leave on ${formatted}.\n\nWould you like to submit a new request for this date?`, () => {
        closeModal('calendar');
        openModal('permission');
        setTimeout(() => {
            const dateField = document.getElementById('permissionDate');
            if (dateField) dateField.value = dateStr;
        }, 100);
    });
};

// Leave balance modal with TSC Kenya policies
window.showLeaveBalance = async function() {
    if (!currentUser) return;
    
    const currentYear = new Date().getFullYear();
    
    const sickLeaveRequests = allUserRequests.filter(r => 
        r.type === 'sick-leave' && 
        r.status === 'approved' &&
        new Date(r.startDate).getFullYear() === currentYear
    );
    
    const annualLeaveRequests = allUserRequests.filter(r => 
        r.type === 'other' && 
        r.requestType === 'annual' &&
        r.status === 'approved' &&
        new Date(r.startDate).getFullYear() === currentYear
    );
    
    const maternityRequests = allUserRequests.filter(r => 
        r.type === 'other' && 
        r.requestType === 'maternity' &&
        r.status === 'approved' &&
        new Date(r.startDate).getFullYear() === currentYear
    );
    
    const paternityRequests = allUserRequests.filter(r => 
        r.type === 'other' && 
        r.requestType === 'paternity' &&
        r.status === 'approved' &&
        new Date(r.startDate).getFullYear() === currentYear
    );
    
    const studyLeaveRequests = allUserRequests.filter(r => 
        r.type === 'other' && 
        r.requestType === 'study' &&
        r.status === 'approved' &&
        new Date(r.startDate).getFullYear() === currentYear
    );
    
    const compassionateRequests = allUserRequests.filter(r => 
        r.type === 'other' && 
        r.requestType === 'compassionate' &&
        r.status === 'approved' &&
        new Date(r.startDate).getFullYear() === currentYear
    );
    
    const adoptionRequests = allUserRequests.filter(r => 
        r.type === 'other' && 
        r.requestType === 'adoption' &&
        r.status === 'approved' &&
        new Date(r.startDate).getFullYear() === currentYear
    );
    
    let sickDays = 0;
    sickLeaveRequests.forEach(r => {
        const days = calculateDays(r.startDate, r.endDate);
        sickDays += days;
    });
    
    let annualDays = 0;
    annualLeaveRequests.forEach(r => {
        if (r.endDate) {
            const days = calculateDays(r.startDate, r.endDate);
            annualDays += days;
        }
    });
    
    let maternityDays = 0;
    maternityRequests.forEach(r => {
        if (r.endDate) {
            const days = calculateDays(r.startDate, r.endDate);
            maternityDays += days;
        }
    });
    
    let paternityDays = 0;
    paternityRequests.forEach(r => {
        if (r.endDate) {
            const days = calculateDays(r.startDate, r.endDate);
            paternityDays += days;
        }
    });
    
    let studyDays = 0;
    studyLeaveRequests.forEach(r => {
        if (r.endDate) {
            const days = calculateDays(r.startDate, r.endDate);
            studyDays += days;
        }
    });
    
    let compassionateDays = 0;
    compassionateRequests.forEach(r => {
        if (r.endDate) {
            const days = calculateDays(r.startDate, r.endDate);
            compassionateDays += days;
        }
    });
    
    let adoptionDays = 0;
    adoptionRequests.forEach(r => {
        if (r.endDate) {
            const days = calculateDays(r.startDate, r.endDate);
            adoptionDays += days;
        }
    });
    
    const ANNUAL_LEAVE_DAYS = 42;
    const SICK_LEAVE_DAYS = 30;
    const MATERNITY_LEAVE_DAYS = 120;
    const PATERNITY_LEAVE_DAYS = 21;
    const ADOPTION_LEAVE_DAYS = 45;
    const COMPASSIONATE_LEAVE_DAYS = 14;
    
    const html = `
        <div class="leave-balance-grid">
            <div class="balance-item">
                <span class="balance-label">📚 Annual Leave (42 days per year)</span>
                <div class="balance-bar">
                    <div class="balance-fill annual" style="width: ${(annualDays / ANNUAL_LEAVE_DAYS) * 100}%"></div>
                </div>
                <span class="balance-text">${annualDays} / ${ANNUAL_LEAVE_DAYS} days used | ${ANNUAL_LEAVE_DAYS - annualDays} days remaining</span>
                <small style="color: ${annualDays > 35 ? '#f44336' : '#666'}; margin-top: 0.25rem; display: block;">
                    ${annualDays > 35 ? '⚠️ Running low on annual leave!' : annualDays > 30 ? '⚠️ Consider planning usage' : '✓ Good balance'}
                    <br><strong>Note:</strong> Must be taken during school holidays. Cannot be carried forward.
                </small>
            </div>
            
            <div class="balance-item">
                <span class="balance-label">🏥 Sick Leave (30 working days per year)</span>
                <div class="balance-bar">
                    <div class="balance-fill" style="width: ${(sickDays / SICK_LEAVE_DAYS) * 100}%"></div>
                </div>
                <span class="balance-text">${sickDays} / ${SICK_LEAVE_DAYS} days used | ${SICK_LEAVE_DAYS - sickDays} days remaining</span>
                <small style="color: ${sickDays > 25 ? '#f44336' : '#666'}; margin-top: 0.25rem; display: block;">
                    ${sickDays > 25 ? '⚠️ High sick leave usage!' : sickDays > 20 ? '⚠️ Monitor usage' : '✓ Good health record'}
                    <br><strong>Required:</strong> Medical certificate from registered doctor/midwife
                </small>
            </div>
            
            <div class="balance-item">
                <span class="balance-label">🤰 Maternity Leave (120 calendar days)</span>
                <div class="balance-bar">
                    <div class="balance-fill maternity" style="width: ${(maternityDays / MATERNITY_LEAVE_DAYS) * 100}%"></div>
                </div>
                <span class="balance-text">${maternityDays} / ${MATERNITY_LEAVE_DAYS} days used | ${MATERNITY_LEAVE_DAYS - maternityDays} days remaining</span>
            </div>
            
            <div class="balance-item">
                <span class="balance-label">👨‍👶 Paternity Leave (21 calendar days)</span>
                <div class="balance-bar">
                    <div class="balance-fill" style="background: linear-gradient(90deg, #009688 0%, #00796B 100%); width: ${(paternityDays / PATERNITY_LEAVE_DAYS) * 100}%"></div>
                </div>
                <span class="balance-text">${paternityDays} / ${PATERNITY_LEAVE_DAYS} days used | ${PATERNITY_LEAVE_DAYS - paternityDays} days remaining</span>
            </div>
            
            <div class="balance-item">
                <span class="balance-label">👶 Pre-Adoptive Leave (45 calendar days)</span>
                <div class="balance-bar">
                    <div class="balance-fill" style="background: linear-gradient(90deg, #FF5722 0%, #E64A19 100%); width: ${(adoptionDays / ADOPTION_LEAVE_DAYS) * 100}%"></div>
                </div>
                <span class="balance-text">${adoptionDays} / ${ADOPTION_LEAVE_DAYS} days used | ${ADOPTION_LEAVE_DAYS - adoptionDays} days remaining</span>
            </div>
            
            <div class="balance-item">
                <span class="balance-label">💐 Compassionate Leave (7-14 days)</span>
                <div class="balance-bar">
                    <div class="balance-fill" style="background: linear-gradient(90deg, #607D8B 0%, #455A64 100%); width: ${(compassionateDays / COMPASSIONATE_LEAVE_DAYS) * 100}%"></div>
                </div>
                <span class="balance-text">${compassionateDays} / ${COMPASSIONATE_LEAVE_DAYS} days used | ${COMPASSIONATE_LEAVE_DAYS - compassionateDays} days remaining</span>
            </div>
            
            ${studyDays > 0 ? `
            <div class="balance-item">
                <span class="balance-label">📖 Study Leave (Variable)</span>
                <div class="balance-bar">
                    <div class="balance-fill" style="background: linear-gradient(90deg, #3F51B5 0%, #303F9F 100%); width: 100%"></div>
                </div>
                <span class="balance-text">${studyDays} days taken this year</span>
            </div>
            ` : ''}
        </div>
        
        <div style="margin-top: 2rem; padding: 1.5rem; background: #e3f2fd; border-radius: 8px; border-left: 4px solid #2196F3;">
            <h5 style="color: #1976D2; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
                📌 TSC Leave Policy Highlights (2021-2025 CBA)
            </h5>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem;">
                <div>
                    <strong style="color: #1565C0;">Annual Leave:</strong>
                    <ul style="margin: 0.5rem 0 0 1.5rem; color: #555; line-height: 1.8; font-size: 0.9rem;">
                        <li>42 days (6 weeks) per year</li>
                        <li>Must be during school holidays</li>
                        <li>Cannot be carried forward</li>
                        <li>Approved by head teacher</li>
                    </ul>
                </div>
                <div>
                    <strong style="color: #1565C0;">Maternity/Paternity:</strong>
                    <ul style="margin: 0.5rem 0 0 1.5rem; color: #555; line-height: 1.8; font-size: 0.9rem;">
                        <li>Maternity: 120 days (4 months)</li>
                        <li>Paternity: 21 days (3 weeks)</li>
                        <li>Both with full pay & benefits</li>
                        <li>Adoption: 45 days</li>
                    </ul>
                </div>
                <div>
                    <strong style="color: #1565C0;">Special Provisions:</strong>
                    <ul style="margin: 0.5rem 0 0 1.5rem; color: #555; line-height: 1.8; font-size: 0.9rem;">
                        <li>Sick leave needs medical cert</li>
                        <li>Study leave: paid/unpaid options</li>
                        <li>Compassionate: 7-14 days</li>
                        <li>All online applications only</li>
                    </ul>
                </div>
            </div>
        </div>
        
        <div style="margin-top: 1.5rem;">
            <h5 style="margin-bottom: 1rem; color: var(--tsc-maroon);">Recent Leave History (${currentYear})</h5>
            ${generateLeaveHistory(sickLeaveRequests, annualLeaveRequests, maternityRequests, paternityRequests, adoptionRequests, compassionateRequests, studyLeaveRequests)}
        </div>
        
        <div style="margin-top: 1.5rem; padding: 1rem; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
            <strong style="color: #856404;">⚠️ Important Reminders:</strong>
            <ul style="margin: 0.5rem 0 0 1.5rem; color: #856404; line-height: 1.8; font-size: 0.9rem;">
                <li>Apply at least 1 week before intended leave date</li>
                <li>Attach all required supporting documents</li>
                <li>Teachers cannot spend leave outside Kenya without TSC permission</li>
                <li>Leave granted for one purpose cannot be used for another</li>
                <li>All applications are now fully online via HRMIS portal</li>
            </ul>
        </div>
    `;
    
    document.getElementById('leaveBalanceContent').innerHTML = html;
};

function generateLeaveHistory(...leaveArrays) {
    const allLeave = [];
    leaveArrays.forEach(arr => allLeave.push(...arr));
    
    const sorted = allLeave
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
        .slice(0, 10);
    
    if (sorted.length === 0) {
        return '<p style="color: #999; text-align: center; padding: 1rem;">No leave history found for this year.</p>';
    }
    
    return sorted.map(leave => {
        const typeNames = {
            'sick-leave': '🏥 Sick Leave',
            'other': getOtherLeaveIcon(leave.requestType)
        };
        const days = leave.endDate ? calculateDays(leave.startDate, leave.endDate) : 1;
        
        return `
            <div style="background: #f9f9f9; padding: 1rem; border-radius: 6px; margin-bottom: 0.75rem; border-left: 3px solid ${getLeaveColor(leave.requestType || leave.type)};">
                <div style="display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 0.5rem;">
                    <div style="flex: 1;">
                        <strong style="font-size: 1rem;">${typeNames[leave.type]}</strong>
                        <span style="background: #e0e0e0; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.8rem; margin-left: 0.5rem;">
                            ${days} day${days !== 1 ? 's' : ''}
                        </span>
                        <br>
                        <small style="color: #666;">${formatDate(leave.startDate)}${leave.endDate ? ' to ' + formatDate(leave.endDate) : ''}</small>
                    </div>
                    <span class="status-badge ${leave.status === 'approved' ? 'status-approved' : leave.status === 'pending' ? 'status-pending' : leave.status === 'deleted' ? 'status-deleted' : 'status-rejected'}">
                        ${leave.status}
                    </span>
                </div>
                ${leave.adminNotes ? `<p style="margin: 0.5rem 0 0 0; font-size: 0.85rem; color: #555; font-style: italic;">Note: ${leave.adminNotes}</p>` : ''}
            </div>
        `;
    }).join('');
}

function getOtherLeaveIcon(type) {
    const icons = {
        'annual': '📚 Annual Leave',
        'maternity': '🤰 Maternity Leave',
        'paternity': '👨‍👶 Paternity Leave',
        'study': '📖 Study Leave',
        'compassionate': '💐 Compassionate Leave',
        'adoption': '👶 Pre-Adoptive Leave',
        'unpaid': '📋 Unpaid Leave',
        'transfer': '🔄 Transfer Request'
    };
    return icons[type] || '📄 Other Request';
}

function getLeaveColor(type) {
    const colors = {
        'sick-leave': '#8B1538',
        'annual': '#2196F3',
        'maternity': '#9C27B0',
        'paternity': '#009688',
        'study': '#3F51B5',
        'compassionate': '#607D8B',
        'adoption': '#FF5722',
        'unpaid': '#757575'
    };
    return colors[type] || '#8B1538';
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-KE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

window.exportLeaveReport = function() {
    const currentYear = new Date().getFullYear();
    
    const reportData = allUserRequests
        .filter(r => r.status === 'approved' && new Date(r.submittedAt).getFullYear() === currentYear)
        .map(r => {
            const days = r.endDate ? calculateDays(r.startDate, r.endDate) : 1;
            return [
                r.type,
                r.startDate,
                r.endDate || r.date || '',
                days,
                r.status
            ];
        });
    
    const headers = ['Type', 'Start Date', 'End Date', 'Days', 'Status'];
    let csv = headers.join(',') + '\n';
    csv += reportData.map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leave-report-${currentYear}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
};

window.uploadDocument = function() {
    const title = document.getElementById('documentTitle').value.trim();
    const file = document.getElementById('documentFile').files[0];
    
    if (!title || !file) {
        showNotification('⚠️ Please provide both a title and a file.', 'warning');
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        showNotification('⚠️ File size must be less than 5MB.', 'warning');
        return;
    }
    
    document.getElementById('uploadProgress').style.display = 'block';
    document.getElementById('uploadStatus').textContent = 'Uploading...';
    
    let progress = 0;
    const interval = setInterval(() => {
        progress += 10;
        document.getElementById('uploadProgressBar').style.width = progress + '%';
        
        if (progress >= 100) {
            clearInterval(interval);
            document.getElementById('uploadStatus').textContent = 'Upload complete!';
            setTimeout(() => {
                closeModal('upload');
                document.getElementById('uploadProgress').style.display = 'none';
                document.getElementById('uploadProgressBar').style.width = '0%';
                showNotification('Document uploaded successfully! (Note: Full implementation requires Firebase Storage)', 'success');
            }, 1000);
        }
    }, 200);
};

function calculateDays(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
}

window.loadTemplate = function() {
    const templates = [
        { name: 'Annual Leave - School Holiday', type: 'other', reason: 'Annual leave as per TSC policy during school holidays' },
        { name: 'Medical Appointment', type: 'permission', reason: 'Medical appointment at hospital' },
        { name: 'Family Emergency', type: 'compassionate', reason: 'Family emergency requiring immediate attention' }
    ];

    let modal = document.getElementById('templatePickerModal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'templatePickerModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;';
    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:2rem;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <h3 style="margin:0 0 1.25rem;color:#8B1538;">📋 Choose a Template</h3>
            ${templates.map((t, i) => `
                <div onclick="applyTemplate(${i}); document.getElementById('templatePickerModal').remove();" 
                     style="padding:0.9rem 1rem;border:1px solid #e0e0e0;border-radius:8px;cursor:pointer;margin-bottom:0.75rem;transition:background 0.15s;" 
                     onmouseover="this.style.background='#f9f0f3'" onmouseout="this.style.background='#fff'">
                    <strong style="color:#333;">${t.name}</strong>
                    <p style="margin:0.25rem 0 0;font-size:0.85rem;color:#666;">${t.reason}</p>
                </div>
            `).join('')}
            <button onclick="document.getElementById('templatePickerModal').remove()" style="margin-top:0.5rem;padding:0.6rem 1.25rem;background:#f5f5f5;color:#555;border:1px solid #ddd;border-radius:6px;cursor:pointer;width:100%;">Cancel</button>
        </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
};

window.applyTemplate = function(index) {
    const templates = [
        {
            name: 'Annual Leave - School Holiday',
            type: 'other',
            reason: 'Annual leave as per TSC policy during school holidays',
            requestType: 'annual'
        },
        {
            name: 'Medical Appointment',
            type: 'permission',
            reason: 'Medical appointment at hospital',
            timePeriod: 'morning'
        },
        {
            name: 'Family Emergency',
            type: 'other',
            reason: 'Family emergency requiring immediate attention',
            requestType: 'compassionate'
        }
    ];
    
    const template = templates[index];
    if (template.type === 'permission') {
        openModal('permission');
        setTimeout(() => {
            document.getElementById('permissionReason').value = template.reason;
        }, 100);
    } else {
        openModal('other');
        setTimeout(() => {
            document.getElementById('otherType').value = template.requestType || '';
            document.getElementById('otherReason').value = template.reason;
        }, 100);
    }
};

window.repeatLastRequest = async function() {
    if (allUserRequests.length === 0) {
        showNotification('ℹ️ No previous requests found.', 'warning');
        return;
    }
    
    const lastRequest = allUserRequests[0];
    
    showConfirm(`Repeat your last request?\n\nType: ${getTypeName(lastRequest.type, lastRequest.requestType)}\nDate: ${new Date(lastRequest.submittedAt).toLocaleDateString()}`, () => {
        if (lastRequest.type === 'permission') {
            openModal('permission');
            setTimeout(() => { document.getElementById('permissionReason').value = lastRequest.reason || ''; }, 100);
        } else if (lastRequest.type === 'sick-leave') {
            openModal('sick-leave');
            setTimeout(() => { document.getElementById('sickLeaveDiagnosis').value = lastRequest.diagnosis || ''; }, 100);
        } else if (lastRequest.type === 'court-summon') {
            openModal('court-summon');
            setTimeout(() => {
                document.getElementById('courtName').value = lastRequest.courtName || '';
                document.getElementById('courtReason').value = lastRequest.caseNature || '';
            }, 100);
        } else {
            openModal('other');
            setTimeout(() => {
                document.getElementById('otherType').value = lastRequest.requestType || '';
                document.getElementById('otherReason').value = lastRequest.reason || '';
            }, 100);
        }
    });
};

// Submit request function
window.submitRequest = async function(type) {
    if (!currentUser) {
        showNotification('❌ You must be logged in to submit a request.', 'error');
        return;
    }
    
    let requestData = {
        userId: currentUser.uid,
        userEmail: currentUser.email,
        type: type,
        status: 'pending',
        submittedAt: new Date().toISOString()
    };
    
    if (type === 'permission') {
        const date = document.getElementById('permissionDate').value;
        const time = document.getElementById('permissionTime').value;
        const reason = document.getElementById('permissionReason').value;
        
        if (!date || !time || !reason) {
            showNotification('⚠️ Please fill in all required fields.', 'warning');
            return;
        }
        
        // Save draft cleared on success
        localStorage.removeItem('draft_permission');

        requestData = { ...requestData, date, timePeriod: time, reason };

    } else if (type === 'sick-leave') {
        const startDate = document.getElementById('sickLeaveStartDate').value;
        const endDate = document.getElementById('sickLeaveEndDate').value;
        const diagnosis = document.getElementById('sickLeaveDiagnosis').value;
        const doctorName = document.getElementById('sickLeaveDoctorName').value;
        const documentNumber = document.getElementById('sickLeaveDocumentNumber').value;
        const delegate = document.getElementById('sickLeaveDelegate').value.trim();
        const notifyDelegate = document.getElementById('sickLeaveNotifyDelegate').checked;
        
        if (!startDate || !endDate || !diagnosis || !doctorName || !documentNumber) {
            showNotification('⚠️ Please fill in all required fields.', 'warning');
            return;
        }
        
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (end < start) {
            showNotification('⚠️ End date cannot be before start date.', 'warning');
            return;
        }
        
        const days = calculateDays(startDate, endDate);
        const doSubmitSick = () => {
            localStorage.removeItem('draft_sick-leave');
            requestData = { ...requestData, startDate, endDate, duration: days, diagnosis, doctorName, medicalCertNumber: documentNumber, delegateTeacher: delegate || null, notifyDelegate: notifyDelegate && delegate };
            _doSubmit(requestData, type);
        };

        if (days > 30) {
            showConfirm(`Warning: You are requesting ${days} days of sick leave.\nTSC allows 30 working days per year.\nDo you want to continue?`, doSubmitSick);
        } else {
            doSubmitSick();
        }
        return;

    } else if (type === 'court-summon') {
        const courtDate = document.getElementById('courtDate').value;
        const courtName = document.getElementById('courtName').value;
        const caseNumber = document.getElementById('caseNumber').value;
        const courtReason = document.getElementById('courtReason').value;
        const summonDocument = document.getElementById('summonDocument').value;
        
        if (!courtDate || !courtName || !caseNumber || !courtReason || !summonDocument) {
            showNotification('⚠️ Please fill in all required fields.', 'warning');
            return;
        }
        
        localStorage.removeItem('draft_court-summon');
        requestData = { ...requestData, courtDate, courtName, caseNumber, caseNature: courtReason, summonDocNumber: summonDocument };

    } else if (type === 'other') {
        const otherType = document.getElementById('otherType').value;
        const startDate = document.getElementById('otherStartDate').value;
        const endDate = document.getElementById('otherEndDate').value;
        const reason = document.getElementById('otherReason').value;
        const documents = document.getElementById('otherDocuments').value;
        
        if (!otherType || !startDate || !reason) {
            showNotification('⚠️ Please fill in all required fields.', 'warning');
            return;
        }
        
        if (endDate && endDate < startDate) {
            showNotification('⚠️ End date cannot be before start date.', 'warning');
            return;
        }
        
        const days = endDate ? calculateDays(startDate, endDate) : 1;
        const validations = {
            'annual': { max: 42, warning: 'TSC allows 42 days of annual leave per year. Must be taken during school holidays.' },
            'maternity': { min: 1, max: 120, warning: 'TSC maternity leave is 120 calendar days (4 months) from date of delivery.' },
            'paternity': { min: 1, max: 21, warning: 'TSC paternity leave is 21 calendar days (3 weeks) during spouse\'s maternity period.' },
            'adoption': { min: 1, max: 45, warning: 'TSC pre-adoptive leave is 45 calendar days from date of adoption.' },
            'compassionate': { min: 1, max: 14, warning: 'Compassionate leave is typically 7-14 days for bereavement or family emergency.' },
            'special': { max: 30, warning: 'Special leave must be during school holidays unless TSC-nominated event.' }
        };

        const doSubmitOther = () => {
            localStorage.removeItem('draft_other');
            const rd = { ...requestData, requestType: otherType, startDate, endDate: endDate || null, duration: days, reason, supportingDocuments: documents || 'None', policyCompliant: true };
            _doSubmit(rd, type);
        };

        if (endDate && validations[otherType]) {
            const policy = validations[otherType];
            if (policy.min && days < policy.min) {
                showNotification(`⚠️ Minimum ${policy.min} day(s) required for ${otherType} leave.`, 'warning');
                return;
            }
            if (policy.max && days > policy.max) {
                showConfirm(`Warning: You are requesting ${days} days.\n\n${policy.warning}\n\nDo you want to continue?`, () => {
                    if (otherType === 'annual') {
                        const month = new Date(startDate).getMonth();
                        if (![3, 7, 11].includes(month)) {
                            showConfirm('Warning: Annual leave should be taken during school holidays (April, August, December).\n\nDo you want to continue?', doSubmitOther);
                            return;
                        }
                    }
                    doSubmitOther();
                });
                return;
            }
            if (otherType === 'annual') {
                const month = new Date(startDate).getMonth();
                if (![3, 7, 11].includes(month)) {
                    showConfirm('Warning: Annual leave should be taken during school holidays (April, August, December).\n\nDo you want to continue?', doSubmitOther);
                    return;
                }
            }
        }
        doSubmitOther();
        return;
    }
    
    await _doSubmit(requestData, type);
};

async function _doSubmit(requestData, type) {
    try {
        await addDoc(collection(db, 'requests'), requestData);
        closeModal(type);
        showNotification('✅ Request submitted successfully! You will be notified when it is reviewed.', 'success');
    } catch (error) {
        console.error('Error submitting request:', error);
        showNotification('❌ Error submitting request. Please try again.', 'error');
    }
}

function updateStatsFromRequests() {
    if (!currentUser || !allUserRequests) return;
    
    try {
        const total = allUserRequests.length;
        const pending = allUserRequests.filter(r => r.status === 'pending').length;
        const approved = allUserRequests.filter(r => r.status === 'approved').length;
        const deleted = allUserRequests.filter(r => r.status === 'deleted').length;
        
        const currentYear = new Date().getFullYear();
        const sickLeaveRequests = allUserRequests.filter(r => 
            r.type === 'sick-leave' && 
            r.status === 'approved' &&
            new Date(r.startDate).getFullYear() === currentYear
        );
        
        let totalSickDays = 0;
        sickLeaveRequests.forEach(r => {
            const start = new Date(r.startDate);
            const end = new Date(r.endDate);
            const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
            totalSickDays += days;
        });
        
        const remainingSickDays = 30 - totalSickDays;
        
        document.getElementById('totalRequests').textContent = total;
        document.getElementById('pendingRequests').textContent = pending;
        document.getElementById('approvedRequests').textContent = approved;
        document.getElementById('sickLeaveDays').textContent = remainingSickDays;
        
        if (deleted > 0) {
            const deleteWarning = document.getElementById('deleteWarning');
            if (deleteWarning) {
                deleteWarning.style.display = 'block';
                deleteWarning.innerHTML = `<strong>⚠️ Alert:</strong> ${deleted} of your request(s) ${deleted === 1 ? 'has' : 'have'} been deleted by an administrator. Check your request history for details.`;
            }
        } else {
            const deleteWarning = document.getElementById('deleteWarning');
            if (deleteWarning) {
                deleteWarning.style.display = 'none';
            }
        }
        
    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

async function loadDashboardStats() {
    if (!currentUser) return;
}

// ============================================
// UPCOMING LEAVE REMINDERS
// ============================================
function checkUpcomingLeave() {
    const now = new Date();
    const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const upcoming = allUserRequests.filter(r => {
        if (r.status !== 'approved') return false;
        const startDate = new Date(r.startDate || r.date || r.courtDate);
        return startDate >= now && startDate <= sevenDaysAhead;
    });

    const container = document.getElementById('upcomingRemindersContainer');
    if (!container) return;

    if (upcoming.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = `
        <div style="background:linear-gradient(135deg,#e8f5e9,#f1f8e9);border:1px solid #a5d6a7;border-radius:10px;padding:1rem 1.25rem;margin-bottom:1.5rem;">
            <h4 style="margin:0 0 0.75rem;color:#2e7d32;display:flex;align-items:center;gap:0.5rem;">
                🗓️ Upcoming Approved Leave
            </h4>
            ${upcoming.map(r => {
                const start = new Date(r.startDate || r.date || r.courtDate);
                const diffDays = Math.ceil((start - now) / (1000 * 60 * 60 * 24));
                const label = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : `In ${diffDays} days`;
                return `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid #c8e6c9;flex-wrap:wrap;gap:0.5rem;">
                        <span style="color:#1b5e20;font-weight:500;">${getTypeIcon(r.type,r.requestType)} ${getTypeName(r.type,r.requestType)}</span>
                        <span style="background:#4caf50;color:#fff;padding:0.2rem 0.7rem;border-radius:12px;font-size:0.82rem;font-weight:600;">${label} — ${start.toLocaleDateString('en-KE',{month:'short',day:'numeric'})}</span>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function loadRequests() {
    if (!currentUser) return;
    
    try {
        if (unsubscribeRequests) {
            unsubscribeRequests();
        }
        
        const q = query(
            collection(db, 'requests'),
            where('userId', '==', currentUser.uid)
        );
        
        unsubscribeRequests = onSnapshot(q, (querySnapshot) => {
            allUserRequests = [];
            querySnapshot.forEach((doc) => {
                allUserRequests.push({ id: doc.id, ...doc.data() });
            });
            
            allUserRequests.sort((a, b) => {
                const dateA = new Date(a.submittedAt);
                const dateB = new Date(b.submittedAt);
                return dateB - dateA;
            });
            
            currentPage = 1;
            totalPages = Math.ceil(allUserRequests.length / itemsPerPage);
            
            displayRequests(allUserRequests);
            updateStatsFromRequests();
            checkUpcomingLeave();
            
        }, (error) => {
            console.error('Error loading requests:', error);
        });
        
    } catch (error) {
        console.error('Error setting up listener:', error);
    }
}

function displayRequests(requests) {
    const tbody = document.getElementById('requestsTableBody');
    
    if (requests.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 2rem; color: #999;">
                    No requests found.
                </td>
            </tr>
        `;
        document.getElementById('paginationContainer').innerHTML = '';
        return;
    }
    
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, requests.length);
    const paginatedRequests = requests.slice(startIndex, endIndex);
    
    tbody.innerHTML = paginatedRequests.map((request, index) => {
        const rowNumber = startIndex + index + 1;
        const date = new Date(request.submittedAt).toLocaleDateString('en-KE', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
        
        const typeNames = {
            'permission': 'Permission',
            'sick-leave': 'Sick Leave',
            'court-summon': 'Court Summon',
            'other': request.requestType || 'Other'
        };
        
        const statusClass = request.status === 'pending' ? 'status-pending' :
                          request.status === 'approved' ? 'status-approved' :
                          request.status === 'deleted' ? 'status-deleted' :
                          'status-rejected';
        
        const statusText = request.status.charAt(0).toUpperCase() + request.status.slice(1);
        
        const reason = request.reason || request.caseNature || request.diagnosis || 'N/A';
        const shortReason = reason.length > 50 ? reason.substring(0, 50) + '...' : reason;
        
        const deleteNotice = request.status === 'deleted' ? 
            `<div style="color: #dc3545; font-size: 0.85rem; margin-top: 0.25rem;">🗑️ Deleted by admin on ${new Date(request.deletedAt).toLocaleDateString()}</div>` : '';
        
        const withdrawButton = request.status === 'pending' ? 
            `<button class="btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.85rem; background: #dc3545; margin-right: 0.5rem;" onclick="withdrawRequest('${request.id}')" title="Permanently delete this request">
                🗑️ Withdraw
            </button>` : '';
        
        return `
            <tr>
                <td style="font-weight: 600; color: #8B1538; text-align: center; width: 50px;">${rowNumber}</td>
                <td>
                    ${date}
                    ${deleteNotice}
                </td>
                <td>${typeNames[request.type]}</td>
                <td>${shortReason}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>
                    ${withdrawButton}
                    <button class="btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.85rem;" onclick="viewRequest('${request.id}')">
                        View Details
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    updatePaginationControls();
}

// ============================================
// UNIFIED FILTER + SEARCH
// ============================================

function getFilteredRequests() {
    const searchTerm = (document.getElementById('searchRequests')?.value || '').toLowerCase();
    const statusFilter = activeStatusFilter;

    return allUserRequests.filter(request => {
        const typeNames = {
            'permission': 'Permission',
            'sick-leave': 'Sick Leave',
            'court-summon': 'Court Summon',
            'other': request.requestType || 'Other'
        };
        const type = (typeNames[request.type] || '').toLowerCase();
        const status = (request.status || '').toLowerCase();
        const reason = (request.reason || request.caseNature || request.diagnosis || '').toLowerCase();
        const date = new Date(request.submittedAt).toLocaleDateString('en-KE').toLowerCase();

        const matchesSearch = !searchTerm || type.includes(searchTerm) || status.includes(searchTerm) || reason.includes(searchTerm) || date.includes(searchTerm);
        const matchesStatus = statusFilter === 'all' || status === statusFilter;
        return matchesSearch && matchesStatus;
    });
}

function applyFilters() {
    const filtered = getFilteredRequests();
    currentPage = 1;
    totalPages = Math.ceil(filtered.length / itemsPerPage);
    displayRequests(filtered);
}

document.getElementById('searchRequests')?.addEventListener('input', applyFilters);

window.setStatusFilter = function(value) {
    activeStatusFilter = value;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active-filter', btn.dataset.filter === value);
    });
    applyFilters();
};

window.exportToCSV = function() {
    if (allUserRequests.length === 0) {
        showNotification('ℹ️ No requests to export.', 'warning');
        return;
    }
    
    const headers = ['Date', 'Type', 'Status', 'Details'];
    const rows = allUserRequests.map(request => {
        const date = new Date(request.submittedAt).toLocaleDateString('en-KE');
        const typeNames = {
            'permission': 'Permission',
            'sick-leave': 'Sick Leave',
            'court-summon': 'Court Summon',
            'other': request.requestType || 'Other'
        };
        const type = typeNames[request.type];
        const status = request.status;
        const details = request.reason || request.caseNature || request.diagnosis || 'N/A';
        
        return [date, type, status, `"${details}"`];
    });
    
    let csv = headers.join(',') + '\n';
    csv += rows.map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tsc-requests-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
};

window.viewRequest = async function(requestId) {
    try {
        const docRef = doc(db, 'requests', requestId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const request = { id: requestId, ...docSnap.data() };
            
            let detailsHTML = `
                <div style="background: linear-gradient(135deg, #8B1538 0%, #5a0f26 100%); padding: 2rem; border-radius: 12px 12px 0 0; color: white;">
                    <div style="display: flex; justify-content: space-between; align-items: start; gap: 1rem;">
                        <div>
                            <h2 style="margin: 0 0 0.5rem 0; font-size: 1.8rem;">Request Details</h2>
                            <p style="margin: 0; color: rgba(255,255,255,0.8);">Submitted on ${new Date(request.submittedAt).toLocaleDateString('en-KE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                        </div>
                        <span class="status-badge ${request.status === 'pending' ? 'status-pending' : request.status === 'approved' ? 'status-approved' : request.status === 'deleted' ? 'status-deleted' : 'status-rejected'}" style="padding: 0.75rem 1.5rem; font-size: 1rem;">
                            ${request.status.toUpperCase()}
                        </span>
                    </div>
                </div>
                
                <div style="padding: 2rem;">
                    <div style="background: #f8f9fa; padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; border-left: 4px solid #8B1538;">
                        <h3 style="color: #8B1538; margin-top: 0; display: flex; align-items: center; gap: 0.5rem;">
                            📋 Request Information
                        </h3>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem;">
                            <div>
                                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Type</label>
                                <p style="margin: 0.5rem 0 0 0; font-size: 1.1rem; color: #333; font-weight: 500;">
                                    ${getTypeIcon(request.type, request.requestType)} ${getTypeName(request.type, request.requestType)}
                                </p>
                            </div>
                            <div>
                                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Status</label>
                                <p style="margin: 0.5rem 0 0 0; font-size: 1.1rem; color: #333; font-weight: 500;">
                                    ${request.status === 'approved' ? '✅ Approved' : request.status === 'pending' ? '⏳ Pending Review' : request.status === 'deleted' ? '🗑️ Deleted' : '❌ Rejected'}
                                </p>
                            </div>
                            <div>
                                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Submitted Date</label>
                                <p style="margin: 0.5rem 0 0 0; font-size: 1.1rem; color: #333; font-weight: 500;">
                                    ${new Date(request.submittedAt).toLocaleString('en-KE')}
                                </p>
                            </div>
                        </div>
                    </div>
                    
                    <div style="background: #f0f7ff; padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; border-left: 4px solid #2196F3;">
                        <h3 style="color: #1976D2; margin-top: 0; display: flex; align-items: center; gap: 0.5rem;">
                            🔍 Request Details
                        </h3>
                        ${getRequestTypeDetails(request)}
                    </div>

                    <!-- STATUS TIMELINE -->
                    <div style="background:#fafafa;padding:1.5rem;border-radius:8px;margin-bottom:2rem;border:1px solid #e0e0e0;">
                        <h3 style="color:#333;margin-top:0;font-size:1rem;">📍 Request Timeline</h3>
                        <div style="display:flex;align-items:center;gap:0;flex-wrap:wrap;">
                            ${generateStatusTimeline(request)}
                        </div>
                    </div>
                    
                    ${request.reviewedAt ? `
                    <div style="background: #f5f5f5; padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; border-left: 4px solid #4CAF50;">
                        <h3 style="color: #388E3C; margin-top: 0; display: flex; align-items: center; gap: 0.5rem;">
                            👤 Review Information
                        </h3>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem;">
                            <div>
                                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Reviewed By</label>
                                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.reviewerEmail || 'TSC Administrator'}</p>
                            </div>
                            <div>
                                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Review Date</label>
                                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${new Date(request.reviewedAt).toLocaleString('en-KE')}</p>
                            </div>
                        </div>
                        ${request.adminNotes ? `
                        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #ddd;">
                            <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Admin Notes</label>
                            <p style="margin: 0.5rem 0 0 0; color: #555; line-height: 1.6;">${request.adminNotes}</p>
                        </div>
                        ` : ''}
                    </div>
                    ` : ''}
                    
                    ${request.status === 'deleted' && request.deletedAt ? `
                    <div style="background: #ffebee; padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; border-left: 4px solid #dc3545;">
                        <h3 style="color: #c62828; margin-top: 0; display: flex; align-items: center; gap: 0.5rem;">
                            🗑️ Deletion Notice
                        </h3>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem;">
                            <div>
                                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Deleted By</label>
                                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.deletedByEmail || 'Administrator'}</p>
                            </div>
                            <div>
                                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Deletion Date</label>
                                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${new Date(request.deletedAt).toLocaleString('en-KE')}</p>
                            </div>
                        </div>
                        <div style="margin-top: 1rem; padding: 1rem; background: rgba(220, 53, 69, 0.1); border-radius: 6px;">
                            <strong style="color: #dc3545;">⚠️ Important:</strong>
                            <p style="margin: 0.5rem 0 0 0; color: #555;">This request has been deleted by an administrator. It will not affect your leave balance calculations, but the deletion has been logged in the audit trail.</p>
                        </div>
                    </div>
                    ` : ''}
                    
                    ${request.auditLog && request.auditLog.length > 0 ? `
                    <div style="background: #fafafa; padding: 1.5rem; border-radius: 8px; border: 1px solid #e0e0e0;">
                        <h3 style="color: #333; margin-top: 0; display: flex; align-items: center; gap: 0.5rem;">
                            📋 Audit Trail
                            <span style="font-size: 0.8rem; background: #8B1538; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-weight: normal;">${request.auditLog.length} ${request.auditLog.length === 1 ? 'entry' : 'entries'}</span>
                        </h3>
                        <div style="max-height: 400px; overflow-y: auto;">
                            ${generateAuditTrail(request.auditLog)}
                        </div>
                    </div>
                    ` : ''}
                </div>
                
                <div style="padding: 1.5rem; background: #f5f5f5; border-top: 1px solid #e0e0e0; display: flex; gap: 1rem; justify-content: flex-end; border-radius: 0 0 12px 12px;">
                    <button onclick="printRequest('${requestId}')" style="padding: 0.75rem 1.5rem; background: #2196F3; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.3s;">
                        📄 Print
                    </button>
                    <button onclick="closeDetailsModal()" style="padding: 0.75rem 1.5rem; background: #757575; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.3s;">
                        Close
                    </button>
                </div>
            `;
            
            const modal = document.getElementById('requestDetailsModal');
            if (modal) {
                const modalContent = modal.querySelector('.modal-content');
                if (modalContent) {
                    modalContent.innerHTML = detailsHTML;
                    modal.classList.add('active');
                }
            }
        }
    } catch (error) {
        console.error('Error viewing request:', error);
        showNotification('❌ Error loading request details.', 'error');
    }
};

function getTypeIcon(type, requestType) {
    const icons = {
        'permission': '🚪',
        'sick-leave': '🏥',
        'court-summon': '⚖️',
        'other': {
            'annual': '📚',
            'maternity': '🤰',
            'paternity': '👨‍👶',
            'study': '📖',
            'compassionate': '💐',
            'adoption': '👶',
            'unpaid': '📋'
        }
    };
    
    if (type === 'other' && icons[type][requestType]) {
        return icons[type][requestType];
    }
    return icons[type] || '📄';
}

function getTypeName(type, requestType) {
    const typeNames = {
        'permission': 'Permission Request',
        'sick-leave': 'Sick Leave',
        'court-summon': 'Court Summon',
        'other': {
            'annual': 'Annual Leave',
            'maternity': 'Maternity Leave',
            'paternity': 'Paternity Leave',
            'study': 'Study Leave',
            'compassionate': 'Compassionate Leave',
            'adoption': 'Pre-Adoptive Leave',
            'unpaid': 'Unpaid Leave'
        }
    };
    
    if (type === 'other' && typeNames[type][requestType]) {
        return typeNames[type][requestType];
    }
    return typeNames[type] || 'Other Request';
}

function getRequestTypeDetails(request) {
    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem;">';
    
    if (request.type === 'permission') {
        html += `
            <div>
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Date</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.date}</p>
            </div>
            <div>
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Time Period</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.timePeriod}</p>
            </div>
            <div style="grid-column: 1/-1;">
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Reason</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333; line-height: 1.6;">${request.reason}</p>
            </div>
        `;
    } else if (request.type === 'sick-leave') {
        html += `
            <div>
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Start Date</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.startDate}</p>
            </div>
            <div>
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">End Date</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.endDate}</p>
            </div>
            <div>
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Duration</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${calculateDays(request.startDate, request.endDate)} days</p>
            </div>
            <div style="grid-column: 1/-1;">
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Diagnosis</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.diagnosis}</p>
            </div>
            <div>
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Doctor Name</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.doctorName}</p>
            </div>
            <div>
                <label style="color: #666; font-size: 0.85rem;text-transform: uppercase; font-weight: 600;">Medical Certificate #</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.medicalCertNumber}</p>
            </div>
        `;
    } else if (request.type === 'court-summon') {
        html += `
            <div>
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Court Date</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.courtDate}</p>
            </div>
            <div>
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Court Name</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.courtName}</p>
            </div>
            <div>
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Case Number</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.caseNumber}</p>
            </div>
            <div style="grid-column: 1/-1;">
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Case Nature</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.caseNature}</p>
            </div>
            <div>
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Summon Document #</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.summonDocNumber}</p>
            </div>
        `;
    } else {
        html += `
            <div>
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Request Type</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${getTypeName('other', request.requestType)}</p>
            </div>
            <div>
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Start Date</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.startDate}</p>
            </div>
            ${request.endDate ? `
            <div>
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">End Date</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.endDate}</p>
            </div>
            ` : ''}
            <div style="grid-column: 1/-1;">
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Reason</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333; line-height: 1.6;">${request.reason}</p>
            </div>
            ${request.supportingDocuments ? `
            <div style="grid-column: 1/-1;">
                <label style="color: #666; font-size: 0.85rem; text-transform: uppercase; font-weight: 600;">Supporting Documents</label>
                <p style="margin: 0.5rem 0 0 0; font-size: 1rem; color: #333;">${request.supportingDocuments}</p>
            </div>
            ` : ''}
        `;
    }
    
    html += '</div>';
    return html;
}

function generateAuditTrail(auditLog) {
    const sortedLog = [...auditLog].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
    );
    
    return sortedLog.map((entry, index) => {
        const actionColor = entry.action === 'approved' ? '#28a745' : 
                          entry.action === 'rejected' ? '#dc3545' :
                          entry.action === 'deleted' ? '#721c24' : '#6c757d';
        
        return `
            <div style="background: white; padding: 1rem; margin-bottom: 0.75rem; border-radius: 6px; border-left: 4px solid ${actionColor};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                    <strong style="color: ${actionColor}; text-transform: uppercase; font-size: 0.9rem;">${entry.action}</strong>
                    <small style="color: #999;">${new Date(entry.timestamp).toLocaleString('en-KE')}</small>
                </div>
                <p style="margin: 0.5rem 0; font-size: 0.95rem; color: #555;">
                    <strong>By:</strong> ${entry.adminEmail}
                </p>
                <p style="margin: 0.5rem 0; font-size: 0.95rem; color: #555;">
                    <strong>Status Change:</strong> 
                    <span style="background: #f0f0f0; padding: 0.2rem 0.6rem; border-radius: 4px;">
                        ${entry.previousStatus} → ${entry.newStatus}
                    </span>
                </p>
                ${entry.notes ? `
                <p style="margin: 0.5rem 0; font-size: 0.9rem; color: #666; font-style: italic; padding-top: 0.5rem; border-top: 1px solid #eee;">
                    💬 <strong>Note:</strong> ${entry.notes}
                </p>
                ` : ''}
            </div>
        `;
    }).join('');
}

function generateStatusTimeline(request) {
    const steps = [
        { key: 'submitted', label: 'Submitted', icon: '📤', date: request.submittedAt, always: true },
        { key: 'review', label: 'Under Review', icon: '👀', date: null, always: true },
        { key: 'decision', label: request.status === 'approved' ? 'Approved' : request.status === 'rejected' ? 'Rejected' : request.status === 'deleted' ? 'Deleted' : 'Pending', icon: request.status === 'approved' ? '✅' : request.status === 'rejected' ? '❌' : request.status === 'deleted' ? '🗑️' : '⏳', date: request.reviewedAt || request.deletedAt, always: true }
    ];

    const isComplete = ['approved', 'rejected', 'deleted'].includes(request.status);
    const decisionColor = request.status === 'approved' ? '#4caf50' : request.status === 'rejected' ? '#f44336' : request.status === 'deleted' ? '#ff9800' : '#9e9e9e';

    return steps.map((step, i) => {
        const isActive = i === 0 || (i === 1 && request.status === 'pending') || (i === 2 && isComplete);
        const color = i === 2 ? decisionColor : isActive ? '#8B1538' : '#ccc';
        const connector = i < steps.length - 1 ? `<div style="flex:1;height:2px;background:${isActive ? '#8B1538' : '#ddd'};min-width:24px;"></div>` : '';
        return `
            <div style="display:flex;align-items:center;flex:1;min-width:0;">
                <div style="text-align:center;flex-shrink:0;">
                    <div style="width:38px;height:38px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:1rem;margin:0 auto 4px;">${step.icon}</div>
                    <p style="margin:0;font-size:0.75rem;font-weight:600;color:${color};">${step.label}</p>
                    ${step.date ? `<p style="margin:0;font-size:0.7rem;color:#888;">${new Date(step.date).toLocaleDateString('en-KE',{month:'short',day:'numeric'})}</p>` : ''}
                </div>
                ${connector}
            </div>
        `;
    }).join('');
}

window.printRequest = function(requestId) {
    const request = allUserRequests.find(r => r.id === requestId);
    if (!request) { showNotification('❌ Request not found.', 'error'); return; }

    const win = window.open('', '_blank', 'width=700,height=900');
    const teacherName = currentUser.displayName || currentUser.email;
    const typeName = getTypeName(request.type, request.requestType);
    const details = getRequestTypeDetails(request);

    win.document.write(`
        <!DOCTYPE html><html><head>
        <title>Request - ${typeName}</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 2rem; color: #333; }
            .header { background: #8B1538; color: white; padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; }
            .header h1 { margin: 0 0 0.25rem; font-size: 1.4rem; }
            .header p { margin: 0; opacity: 0.85; font-size: 0.9rem; }
            .section { border: 1px solid #ddd; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; }
            .section h2 { margin: 0 0 1rem; font-size: 1rem; color: #8B1538; border-bottom: 1px solid #eee; padding-bottom: 0.5rem; }
            label { font-size: 0.75rem; color: #888; text-transform: uppercase; font-weight: 600; }
            p { margin: 0.25rem 0 1rem; }
            .status { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; font-weight: 600; background: ${request.status === 'approved' ? '#e8f5e9' : request.status === 'pending' ? '#fff3e0' : '#ffebee'}; color: ${request.status === 'approved' ? '#2e7d32' : request.status === 'pending' ? '#e65100' : '#c62828'}; }
            .footer { margin-top: 2rem; text-align: center; font-size: 0.8rem; color: #aaa; border-top: 1px solid #eee; padding-top: 1rem; }
            @media print { body { padding: 0; } }
        </style></head><body>
        <div class="header">
            <h1>TSC Kenya Teachers Portal — ${typeName}</h1>
            <p>Teacher: ${teacherName} &nbsp;|&nbsp; Email: ${currentUser.email} &nbsp;|&nbsp; Printed: ${new Date().toLocaleString('en-KE')}</p>
        </div>
        <div class="section">
            <h2>Request Status</h2>
            <label>Status</label><p><span class="status">${request.status.toUpperCase()}</span></p>
            <label>Submitted</label><p>${new Date(request.submittedAt).toLocaleString('en-KE')}</p>
            ${request.reviewedAt ? `<label>Reviewed</label><p>${new Date(request.reviewedAt).toLocaleString('en-KE')}</p>` : ''}
            ${request.adminNotes ? `<label>Admin Notes</label><p>${request.adminNotes}</p>` : ''}
        </div>
        <div class="section">
            <h2>Request Details</h2>
            ${details.replace(/<label style="[^"]*">/g,'<label>').replace(/<p style="[^"]*">/g,'<p>').replace(/<div[^>]*>/g,'<div>').replace(/<\/(div)>/g,'</div>')}
        </div>
        <div class="footer">This document was generated from TSC Kenya Teachers Portal. Reference ID: ${requestId}</div>
        <script>window.onload = function() { window.print(); }<\/script>
        </body></html>
    `);
    win.document.close();
};

// Close modals when clicking outside
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});
// Cleanup listener when page is closed
window.addEventListener('beforeunload', () => {
    if (unsubscribeRequests) {
        unsubscribeRequests();
    }
    if (unsubscribeNotifications) {
        unsubscribeNotifications();
    }
});























// New globals
let allThreads = [];
let currentThreadId = null;
let unsubscribeThreads = null;
let unsubscribeMessages = null;

// Load teacher's message threads
function loadMessageThreads() {
  if (!currentUser) return;
  if (unsubscribeThreads) unsubscribeThreads();

  const threadsQuery = query(
    collection(db, 'message_threads'),
    where('participants', 'array-contains', currentUser.uid),
    orderBy('lastMessageAt', 'desc'),
    limit(20)
  );

  unsubscribeThreads = onSnapshot(threadsQuery, (snap) => {
    allThreads = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderThreadList();  // you need to implement this
    updateMessageBadge(); // optional - show total unread
  }, err => console.error("Threads error:", err));
}

// Example: Render list of conversations (call this in UI)
function renderThreadList() {
  const container = document.getElementById('threadsList'); // add this element in HTML
  if (!container) return;

  if (allThreads.length === 0) {
    container.innerHTML = `<p>No messages yet. Admins will contact you here.</p>`;
    return;
  }

  container.innerHTML = allThreads.map(thread => {
    const otherParticipant = thread.participants.find(uid => uid !== currentUser.uid);
    const unread = thread.unreadCount?.[currentUser.uid] || 0;
    return `
      <div class="thread-item ${unread > 0 ? 'unread' : ''}" 
           onclick="openThread('${thread.id}')">
        <strong>${thread.participantNames?.find(n => n !== (currentUser.displayName || currentUser.email.split('@')[0])) || 'Admin'}</strong>
        <p>${thread.lastMessagePreview || 'New conversation'}</p>
        <small>${getTimeAgo(thread.lastMessageAt)}</small>
        ${unread > 0 ? `<span class="badge">${unread}</span>` : ''}
      </div>
    `;
  }).join('');
}



// Open messages modal
window.openMessagesModal = function() {
  const modal = document.getElementById('messagesModal');
  if (modal) {
    modal.classList.add('active');
    // Load threads if not already loaded
    if (!allThreads.length) {
      loadMessageThreads();
    }
  }
};

// Close messages modal
window.closeMessagesModal = function() {
  const modal = document.getElementById('messagesModal');
  if (modal) {
    modal.classList.remove('active');
    // Optional: close any open thread when modal closes
    closeThread();
  }
};

// Connect trigger button
document.getElementById('openMessagesBtn')?.addEventListener('click', openMessagesModal);

// Open a specific thread and load messages
window.openThread = function(threadId) {
  currentThreadId = threadId;
  document.getElementById('threadView').style.display = 'block';
  document.getElementById('threadsList').style.display = 'none';

  const container = document.getElementById('messagesContainer');
  if (container) {
    container.innerHTML = '<p style="text-align:center; padding:2rem; color:#999;">Loading messages...</p>';
  }

  if (unsubscribeMessages) unsubscribeMessages();

  const messagesQuery = query(
    collection(db, 'message_threads', threadId, 'messages'),
    orderBy('createdAt', 'asc')
  );

  unsubscribeMessages = onSnapshot(messagesQuery, (snap) => {
    const messages = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderMessages(messages);
    markThreadAsRead(threadId);
  });
};
// Render messages in chat window
function renderMessages(messages) {
  const container = document.getElementById('messagesContainer');
  if (!container) return;

  // Remember scroll position
  const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;

  if (messages.length === 0) {
    container.innerHTML = '<p style="text-align:center;padding:2rem;color:#999;">No messages yet. Say hi!</p>';
    return;
  }

  container.innerHTML = messages.map(msg => {
    const isMine = msg.senderId === currentUser.uid;
    const deleted = msg.deletedBy?.includes(currentUser.uid);
    if (deleted) {
      return `<div class="message deleted">Message deleted</div>`;
    }

    // Use sender's photoURL if available, fallback to placeholder
const senderDisplay = msg.senderName || (isMine ? 'You' : 'Sender');
const avatarUrl = msg.photoURL || 
  `https://ui-avatars.com/api/?name=${encodeURIComponent(senderDisplay)}&background=8B1538&color=fff&size=128`;

    return `
      <div class="message ${isMine ? 'sent' : 'received'}">
        <div class="message-avatar">
          <img src="${avatarUrl}" alt="${msg.senderName || 'User'}" 
               onerror="this.src='https://ui-avatars.com/api/?name=User&background=ccc&color=fff'" />
        </div>
        <div class="message-content">
          <strong>${msg.senderName || (isMine ? 'You' : 'Sender')}</strong>
          <p>${msg.text}</p>
          <small>${getTimeAgo(msg.createdAt)}</small>
          ${isMine ? `<button onclick="deleteMyMessage('${currentThreadId}', '${msg.id}')">Delete</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Auto-scroll if user was at bottom
  if (wasAtBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

// Send reply
window.sendMessage = async function() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text || !currentThreadId) return;

  try {
    const messagesRef = collection(db, 'message_threads', currentThreadId, 'messages');
    
    await addDoc(messagesRef, {
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Teacher',
      senderEmail: currentUser.email,
      photoURL: currentUser.photoURL || null,
      text,
      createdAt: serverTimestamp(),
      readBy: [currentUser.uid],
      deletedBy: []
    });

    // Get the thread to find admin ID
    const threadRef = doc(db, 'message_threads', currentThreadId);
    const threadSnap = await getDoc(threadRef);
    
    if (threadSnap.exists()) {
      const thread = threadSnap.data();
      const adminId = thread.participants.find(uid => uid !== currentUser.uid);
      
      // UPDATE THREAD - increment ADMIN's unread count
      await updateDoc(threadRef, {
        lastMessagePreview: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
        lastMessageAt: serverTimestamp(),
        lastMessageSenderId: currentUser.uid,
        [`unreadCount.${currentUser.uid}`]: 0,  // Teacher has read
        [`unreadCount.${adminId}`]: (thread.unreadCount?.[adminId] || 0) + 1,  // ✅ INCREMENT ADMIN
        updatedAt: serverTimestamp()
      });
    }

    input.value = '';
  } catch (err) {
    console.error("Send failed:", err);
    showNotification("❌ Could not send message. Please try again.", "error");
  }
};

// Soft delete own message
window.deleteMyMessage = async function(threadId, messageId) {
    showConfirm('Delete this message?', async () => {
        try {
            const msgRef = doc(db, 'message_threads', threadId, 'messages', messageId);
            await updateDoc(msgRef, { deletedBy: arrayUnion(currentUser.uid) });
        } catch (err) {
            console.error('Delete failed:', err);
            showNotification('❌ Could not delete message.', 'error');
        }
    });
};

// Mark thread as read (call when opening thread)
async function markThreadAsRead(threadId) {
  await updateDoc(doc(db, 'message_threads', threadId), {
    [`unreadCount.${currentUser.uid}`]: 0
  });
}

window.closeThread = function() {
  currentThreadId = null;
  if (unsubscribeMessages) unsubscribeMessages();
  document.getElementById('threadView').style.display = 'none';
  document.getElementById('threadsList').style.display = 'block';
};

// Calculate total unread messages across all threads and update badge
function updateMessageBadge() {
  if (!currentUser) return;

  let totalUnread = 0;

  allThreads.forEach(thread => {
    const unread = thread.unreadCount?.[currentUser.uid] || 0;
    totalUnread += unread;
  });

  const badge = document.getElementById('messagesBadge');  // ← you need this element in HTML

  if (badge) {
    if (totalUnread > 0) {
      badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
}











// Add this once — preferably near the bottom of your teachers.js file
// or in a separate utilities.js file that you import

function setupOutsideClickClose() {
    document.addEventListener('click', function handleOutsideClick(event) {
        // ──────────────────────────────────────────────────────────────
        // 1. Notification panel
        // ──────────────────────────────────────────────────────────────
        const notificationPanel = document.getElementById('notificationPanel');
        const notificationTrigger = document.querySelector('[onclick="toggleNotificationPanel()"]') 
                                 || document.getElementById('notificationBell');

        if (notificationPanel?.classList.contains('active')) {
            const clickedInsidePanel = notificationPanel.contains(event.target);
            const clickedTrigger     = notificationTrigger?.contains(event.target);

            if (!clickedInsidePanel && !clickedTrigger) {
                notificationPanel.classList.remove('active');
                notificationPanel.style.display = 'none';
            }
        }

        // ──────────────────────────────────────────────────────────────
        // 2. Request details modal
        // ──────────────────────────────────────────────────────────────
        const detailsModal = document.getElementById('requestDetailsModal');
        if (detailsModal?.classList.contains('active')) {
            // Only close if click is directly on the backdrop (the modal itself, not its children)
            if (event.target === detailsModal) {
                detailsModal.classList.remove('active');
            }
        }

        // ──────────────────────────────────────────────────────────────
        // 3. All other .modal elements — only close on backdrop click
        // ──────────────────────────────────────────────────────────────
        document.querySelectorAll('.modal.active').forEach(modal => {
            if (modal.id === 'requestDetailsModal') return;
            if (modal.id === 'messagesModal') return;

            // Only close when the click lands directly on the modal backdrop,
            // not on any child element inside the modal content.
            if (event.target === modal) {
                modal.classList.remove('active');
                const form = modal.querySelector('form');
                if (form) form.reset();
            }
        });

        // ──────────────────────────────────────────────────────────────
        // 4. Messages modal
        // ──────────────────────────────────────────────────────────────
        const messagesModal = document.getElementById('messagesModal');
        if (messagesModal?.classList.contains('active')) {
            const threadView  = document.getElementById('threadView');

            if (event.target === messagesModal) {
                messagesModal.classList.remove('active');
                closeThread?.();
                return;
            }

            if (threadView?.style.display === 'block' && 
                !threadView.contains(event.target) && 
                !event.target.closest('[onclick*="openThread"]')) {
                closeThread?.();
            }
        }
    }, false);
}

// ────────────────────────────────────────────────────────────────────────
// Run once DOM is ready
// ────────────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupOutsideClickClose);
} else {
    setupOutsideClickClose();
}