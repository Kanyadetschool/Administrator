// adminjs
import { auth, db } from './firebase-config.js';
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";
import { 
    collection, 
    query, 
    getDocs, 
    doc,
    getDoc,
    updateDoc,
    where,
    orderBy,
    limit,
    addDoc,
    onSnapshot,
    serverTimestamp, arrayUnion, increment, setDoc
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// Add this to your existing imports at the top
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-storage.js";

// Initialize storage (add after your other Firebase initializations)
const storage = getStorage();

let currentAdmin = null;
let allRequests = [];
let allTeachers = [];
let currentFilter = 'all';
let currentRequestId = null;
let displayedRequests = [];

// ADD THESE:
let unsubscribeRequests = null;
let unsubscribeStats = null;
let unsubscribeTeachers = null;

// Pagination Variables
let currentPage = 1;
const itemsPerPage = 5;
let totalPages = 1;

// Check authentication
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'index.html';
        return;
    }
    
    currentAdmin = user;
    
    // Check if user is admin
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists() || userDoc.data().role !== 'admin') {
        // Not an admin, redirect to teacher dashboard
        window.location.href = 'dashboard.html';
        return;
    }
    
    const userData = userDoc.data();
    document.getElementById('adminName').textContent = userData.displayName || user.email.split('@')[0];
    document.getElementById('adminEmail').textContent = user.email;
    
    // Display admin photo
    if (user.photoURL) {
        document.getElementById('adminPhoto').src = user.photoURL;
        document.getElementById('adminPhoto').style.display = 'block';
        document.getElementById('adminAvatarPlaceholder').style.display = 'none';
    } else {
        // Show initial letter
        const initial = (userData.displayName || user.email).charAt(0).toUpperCase();
        document.getElementById('adminAvatarPlaceholder').textContent = initial;
    }
    
    // Load dashboard data
    loadDashboardStats();
    loadAllRequests();
    loadAllTeachers();
    loadAllUsers(); // Load users for role management
    loadAdminMessageThreads();
    
    // Add click handler to total teachers stat
    const totalTeachersElement = document.getElementById('totalTeachers');
    if (totalTeachersElement && totalTeachersElement.parentElement) {
        totalTeachersElement.parentElement.style.cursor = 'pointer';
        totalTeachersElement.parentElement.addEventListener('click', openTeachersModal);
    }
});










// ==============================================
// FILE ATTACHMENT FUNCTIONS
// ==============================================

// Global variable to store selected file

// Trigger file input click
window.triggerFileSelect = function() {
    const fileInput = document.getElementById('messageFileInput');
    if (fileInput) {
        fileInput.click();
    }
};

// Add event listener for file input after DOM loads
document.addEventListener('DOMContentLoaded', function() {
    // Wait a bit for modal to be added to DOM
    setTimeout(() => {
        const fileInput = document.getElementById('messageFileInput');
        if (fileInput) {
            fileInput.addEventListener('change', handleFileSelect);
        }
    }, 1000);
});

// Handle file selection
function handleFileSelect(event) {
    const file = event.target.files[0];
    
    if (!file) return;
    
    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
        alert('Only images (JPG, PNG, GIF, WEBP) and PDFs are allowed');
        event.target.value = '';
        return;
    }
    
    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxSize) {
        alert('File size must be less than 5MB');
        event.target.value = '';
        return;
    }
    
    // Store file and show preview
    selectedFile = file;
    showFilePreview(file);
}

// Show file preview
function showFilePreview(file) {
    const previewArea = document.getElementById('filePreviewArea');
    const previewIcon = document.getElementById('filePreviewIcon');
    const previewName = document.getElementById('filePreviewName');
    const previewSize = document.getElementById('filePreviewSize');
    
    if (!previewArea || !previewIcon || !previewName || !previewSize) {
        console.error('File preview elements not found');
        return;
    }
    
    // Set icon based on file type
    if (file.type.startsWith('image/')) {
        previewIcon.textContent = '🖼️';
    } else if (file.type === 'application/pdf') {
        previewIcon.textContent = '📄';
    } else {
        previewIcon.textContent = '📎';
    }
    
    // Format file size
    const sizeInKB = (file.size / 1024).toFixed(2);
    const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
    const sizeText = file.size > 1024 * 1024 ? `${sizeInMB} MB` : `${sizeInKB} KB`;
    
    previewName.textContent = file.name;
    previewSize.textContent = `(${sizeText})`;
    previewArea.style.display = 'block';
}

// Clear file attachment
window.clearFileAttachment = function() {
    selectedFile = null;
    const fileInput = document.getElementById('messageFileInput');
    if (fileInput) {
        fileInput.value = '';
    }
    const previewArea = document.getElementById('filePreviewArea');
    if (previewArea) {
        previewArea.style.display = 'none';
    }
};

// Upload file to Firebase Storage
async function uploadMessageFile(file, threadId) {
    try {
        // Create unique filename
        const timestamp = Date.now();
        const fileName = `${timestamp}_${file.name}`;
        const filePath = `message_attachments/${threadId}/${fileName}`;
        
        // Create storage reference
        const storageRef = ref(storage, filePath);
        
        // Upload file
        const snapshot = await uploadBytes(storageRef, file);
        
        // Get download URL
        const downloadURL = await getDownloadURL(snapshot.ref);
        
        return {
            url: downloadURL,
            name: file.name,
            type: file.type,
            size: file.size,
            path: filePath
        };
    } catch (error) {
        console.error('Error uploading file:', error);
        throw error;
    }
}






// Admin Logout with Audit Logging
document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
        if (currentAdmin) {
            // Log logout event
            await addDoc(collection(db, 'audit_logs'), {
                userId: currentAdmin.uid,
                email: currentAdmin.email,
                role: 'admin',
                action: 'logout',
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent
            });
        }

        // Cleanup listeners
        if (unsubscribeRequests) unsubscribeRequests();
        if (unsubscribeStats) unsubscribeStats();
        if (unsubscribeTeachers) unsubscribeTeachers();
        
        await signOut(auth);
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Logout error:', error);
        alert('Error logging out. Please try again.');
    }
});

// ============================================
// NOTIFICATION FUNCTIONS
// ============================================

// Open notification modal
window.openNotificationModal = function() {
    const modal = document.getElementById('notificationModal');
    const specificTeacherSelect = document.getElementById('specificTeacher');
    
    // Clear form
    document.getElementById('notificationTitle').value = '';
    document.getElementById('notificationMessage').value = '';
    document.getElementById('notificationRecipient').value = 'all';
    document.getElementById('notificationPriority').value = 'normal';
    document.getElementById('specificTeacherGroup').style.display = 'none';
    
    // Populate teacher dropdown
    specificTeacherSelect.innerHTML = '<option value="">-- Select a teacher --</option>';
    allTeachers.forEach(teacher => {
        const option = document.createElement('option');
        option.value = teacher.email;
        option.textContent = `${teacher.displayName || teacher.email} (${teacher.email})`;
        specificTeacherSelect.appendChild(option);
    });
    
    modal.classList.add('active');
};

// Close notification modal
window.closeNotificationModal = function() {
    document.getElementById('notificationModal').classList.remove('active');
};

// Handle recipient change
document.getElementById('notificationRecipient')?.addEventListener('change', function() {
    const specificGroup = document.getElementById('specificTeacherGroup');
    if (this.value === 'specific') {
        specificGroup.style.display = 'block';
    } else {
        specificGroup.style.display = 'none';
    }
});

// Send notification
window.sendNotification = async function() {
    const recipient = document.getElementById('notificationRecipient').value;
    const specificTeacher = document.getElementById('specificTeacher').value;
    const title = document.getElementById('notificationTitle').value.trim();
    const message = document.getElementById('notificationMessage').value.trim();
    const priority = document.getElementById('notificationPriority').value;
    
    // Validation
    if (!title) {
        alert('Please enter a subject/title for the notification');
        return;
    }
    
    if (!message) {
        alert('Please enter a message');
        return;
    }
    
    if (recipient === 'specific' && !specificTeacher) {
        alert('Please select a teacher');
        return;
    }
    
    try {
        // Determine recipients
        let recipients = [];
        if (recipient === 'all') {
            recipients = allTeachers.map(t => ({ email: t.email, userId: t.id }));
        } else {
            const teacher = allTeachers.find(t => t.email === specificTeacher);
            if (teacher) {
                recipients = [{ email: teacher.email, userId: teacher.id }];
            }
        }
        
        if (recipients.length === 0) {
            alert('No recipients found');
            return;
        }
        
        // Confirm sending
        const confirmMessage = `Send notification to ${recipients.length} teacher${recipients.length > 1 ? 's' : ''}?`;
        if (!confirm(confirmMessage)) {
            return;
        }
        
        // Create notifications for each recipient
        const promises = recipients.map(recipient => {
            return addDoc(collection(db, 'notifications'), {
                recipientEmail: recipient.email,
                recipientId: recipient.userId,
                senderEmail: currentAdmin.email,
                senderId: currentAdmin.uid,
                senderName: document.getElementById('adminName').textContent,
                title: title,
                message: message,
                priority: priority,
                read: false,
                createdAt: new Date().toISOString(),
                type: 'admin_notification'
            });
        });
        
        await Promise.all(promises);
        
        // Log notification send in audit logs
        await addDoc(collection(db, 'audit_logs'), {
            userId: currentAdmin.uid,
            email: currentAdmin.email,
            role: 'admin',
            action: 'notification_sent',
            recipientCount: recipients.length,
            notificationTitle: title,
            priority: priority,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent
        });
        
        alert(`Notification sent successfully to ${recipients.length} teacher${recipients.length > 1 ? 's' : ''}!`);
        closeNotificationModal();
        
    } catch (error) {
        console.error('Error sending notification:', error);
        alert('Error sending notification. Please try again.');
    }
};

// ============================================
// ROLE MANAGEMENT FUNCTIONS
// ============================================

let allUsers = [];

// Load all users for role management
function loadAllUsers() {
    try {
        const usersQuery = query(collection(db, 'users'));
        
        // Set up real-time listener for all users
        const unsubscribeUsers = onSnapshot(usersQuery, (querySnapshot) => {
            allUsers = [];
            
            querySnapshot.forEach((docSnap) => {
                allUsers.push({ id: docSnap.id, ...docSnap.data() });
            });
            
            // Sort users by display name
            allUsers.sort((a, b) => {
                const nameA = (a.displayName || a.email).toLowerCase();
                const nameB = (b.displayName || b.email).toLowerCase();
                return nameA.localeCompare(nameB);
            });
            
        }, (error) => {
            console.error('Error loading users:', error);
        });
        
    } catch (error) {
        console.error('Error setting up users listener:', error);
    }
}

// Open role management modal
window.openRoleManagement = function() {
    const roleContainer = document.getElementById('roleManagementContainer');
    
    if (!roleContainer) {
        console.error('Role management container not found');
        return;
    }
    
    if (allUsers.length === 0) {
        roleContainer.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #999; width: 100%;">
                <p>No users found in the database.</p>
            </div>
        `;
    } else {
        roleContainer.innerHTML = allUsers.map(user => createUserRoleCard(user)).join('');
    }
    
    // Open the modal
    const roleModal = document.getElementById('roleManagementModal');
    if (roleModal) {
        roleModal.classList.add('active');
    }
};

// Create individual user role card
function createUserRoleCard(user) {
    const initial = (user.displayName || user.email).charAt(0).toUpperCase();
    const isCurrentUser = user.id === currentAdmin.uid;
    const isAdmin = user.role === 'admin';
    
    return `
        <div style="background: white; border: 1px solid #e0e0e0; border-radius: 12px; padding: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.08); transition: all 0.3s ease;" onmouseover="this.style.boxShadow='0 4px 16px rgba(139,21,56,0.15)'" onmouseout="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.08)'">
            <div style="display: flex; flex-direction: column; align-items: center; text-align: center;">
                <!-- Profile Photo or Avatar -->
                <div style="position: relative; margin-bottom: 1rem;">
                    ${user.photoURL ? `
                        <img src="${user.photoURL}" alt="${user.displayName}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 3px solid ${isAdmin ? '#8B1538' : '#2196F3'};">
                    ` : `
                        <div style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, ${isAdmin ? '#8B1538' : '#2196F3'} 0%, ${isAdmin ? '#c82333' : '#64b5f6'} 100%); display: flex; align-items: center; justify-content: center; color: white; font-size: 2rem; font-weight: bold; border: 3px solid ${isAdmin ? '#8B1538' : '#2196F3'};">
                            ${initial}
                        </div>
                    `}
                    ${isAdmin ? `
                        <div style="position: absolute; bottom: 0; right: 0; background: #8B1538; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: bold; border: 2px solid white;">
                            👑
                        </div>
                    ` : ''}
                </div>
                
                <!-- User Name -->
                <h3 style="margin: 0.5rem 0; color: #8B1538; font-size: 1.1rem; word-break: break-word;">
                    ${user.displayName || 'Unnamed User'}
                </h3>
                
                <!-- Email -->
                <p style="margin: 0.25rem 0; color: #666; font-size: 0.9rem; word-break: break-all;">
                    ${user.email}
                </p>
                
                <!-- Current Role Badge -->
                <div style="margin: 0.75rem 0;">
                    <span style="background: ${isAdmin ? '#8B1538' : '#2196F3'}; color: white; padding: 0.5rem 1rem; border-radius: 20px; font-size: 0.9rem; font-weight: 600;">
                        ${isAdmin ? '👑 Admin' : '👨‍🏫 Teacher'}
                    </span>
                </div>
                
                <!-- Department/Subject -->
                ${user.department ? `
                    <p style="margin: 0.5rem 0; color: #8B1538; font-size: 0.85rem; font-weight: 600;">
                        📚 ${user.department}
                    </p>
                ` : ''}
                
                <!-- Phone Number (if available) -->
                ${user.phoneNumber ? `
                    <p style="margin: 0.25rem 0; color: #666; font-size: 0.9rem;">
                        📱 ${user.phoneNumber}
                    </p>
                ` : ''}
                
                <!-- Join Date -->
                <p style="margin: 0.5rem 0; color: #999; font-size: 0.85rem;">
                    Joined: ${new Date(user.createdAt || user.joinedAt || Date.now()).toLocaleDateString('en-KE', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    })}
                </p>
                
                <!-- Role Action Buttons -->
                <div style="margin-top: 1rem; width: 100%; padding-top: 1rem; border-top: 1px solid #e0e0e0;">
                    ${isCurrentUser ? `
                        <div style="padding: 0.75rem; background: #f5f5f5; border-radius: 6px; text-align: center; color: #666; font-size: 0.9rem;">
                            ℹ️ This is your account
                        </div>
                    ` : isAdmin ? `
                        <button onclick="changeUserRole('${user.id}', '${user.email}', 'teacher')" style="width: 100%; padding: 0.75rem; background: #ff9800; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;" onmouseover="this.style.background='#f57c00'" onmouseout="this.style.background='#ff9800'">
                            ⬇️ Demote to Teacher
                        </button>
                    ` : `
                        <button onclick="changeUserRole('${user.id}', '${user.email}', 'admin')" style="width: 100%; padding: 0.75rem; background: #4caf50; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.3s ease;" onmouseover="this.style.background='#45a049'" onmouseout="this.style.background='#4caf50'">
                            ⬆️ Promote to Admin
                        </button>
                    `}
                </div>
            </div>
        </div>
    `;
}

// Change user role (promote/demote)
window.changeUserRole = async function(userId, userEmail, newRole) {
    const oldUser = allUsers.find(u => u.id === userId);
    const oldRole = oldUser.role;
    
    const action = newRole === 'admin' ? 'promote to Admin' : 'demote to Teacher';
    const confirmMessage = `Are you sure you want to ${action}?\n\nUser: ${userEmail}\nCurrent Role: ${oldRole}\nNew Role: ${newRole}\n\nThis action will be logged in the audit trail.`;
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    try {
        const userDocRef = doc(db, 'users', userId);
        
        // Update the user's role
        const updateData = {
            role: newRole,
            roleChangedAt: new Date().toISOString(),
            roleChangedBy: currentAdmin.uid,
            roleChangedByEmail: currentAdmin.email,
            previousRole: oldRole
        };
        
        await updateDoc(userDocRef, updateData);
        
        // Also update authorized_users collection if promoting to admin
        if (newRole === 'admin') {
            const authorizedUserRef = doc(db, 'authorized_users', userEmail);
            await updateDoc(authorizedUserRef, { role: 'admin' }).catch(() => {
                // If document doesn't exist, create it
                return addDoc(collection(db, 'authorized_users'), {
                    email: userEmail,
                    role: 'admin',
                    approvedAt: new Date().toISOString()
                });
            });
        }
        
        // Log the role change in audit logs
        await addDoc(collection(db, 'audit_logs'), {
            userId: currentAdmin.uid,
            email: currentAdmin.email,
            role: 'admin',
            action: 'role_change',
            targetUserId: userId,
            targetUserEmail: userEmail,
            previousRole: oldRole,
            newRole: newRole,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent
        });
        
        alert(`Successfully changed ${userEmail} role from ${oldRole} to ${newRole}!`);
        
        // Reload users and refresh the modal
        loadAllUsers();
        setTimeout(() => {
            openRoleManagement();
        }, 500);
        
    } catch (error) {
        console.error('Error changing user role:', error);
        alert('Error changing user role. Please try again.');
    }
};

// Close role management modal
window.closeRoleManagement = function() {
    const roleModal = document.getElementById('roleManagementModal');
    if (roleModal) {
        roleModal.classList.remove('active');
    }
};

// ============================================
// AUDIT LOGS FUNCTIONS (existing)
// ============================================

window.openAuditLogs = async function() {
    document.getElementById('auditLogsModal').classList.add('active');
    
    const tbody = document.getElementById('auditLogsTableBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem;">Loading logs...</td></tr>';
    
    try {
        const q = query(
            collection(db, 'audit_logs'),
            orderBy('timestamp', 'desc'),
            limit(100) // Limit to last 100 entries for performance
        );
        
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem;">No logs found.</td></tr>';
            return;
        }
        
        const logs = [];
        querySnapshot.forEach((doc) => {
            logs.push({ id: doc.id, ...doc.data() });
        });
        
        tbody.innerHTML = logs.map(log => {
            const date = new Date(log.timestamp).toLocaleString('en-KE', {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            
            let actionColor = log.action === 'login' ? '#28a745' : 
                            log.action === 'logout' ? '#6c757d' :
                            log.action === 'role_change' ? '#ff9800' : 
                            log.action === 'notification_sent' ? '#2196F3' : '#007bff';
            
            let actionText = log.action;
            if (log.action === 'role_change') {
                actionText = `role_change (${log.previousRole} → ${log.newRole})`;
            } else if (log.action === 'notification_sent') {
                actionText = `notification_sent (${log.recipientCount} recipients)`;
            }
            
            const roleBadge = log.role === 'admin' ? 
                '<span style="background:#8B1538; color:white; padding:2px 6px; border-radius:4px; font-size:0.75rem;">Admin</span>' : 
                '<span style="background:#2196F3; color:white; padding:2px 6px; border-radius:4px; font-size:0.75rem;">Teacher</span>';
            
            // Parse simplistic browser info from userAgent
            let device = 'Unknown';
            if (log.userAgent) {
                if (log.userAgent.includes('Mobile')) device = '📱 Mobile';
                else device = '💻 Desktop';
                
                if (log.userAgent.includes('Chrome')) device += ' (Chrome)';
                else if (log.userAgent.includes('Firefox')) device += ' (Firefox)';
                else if (log.userAgent.includes('Safari')) device += ' (Safari)';
                else if (log.userAgent.includes('Edge')) device += ' (Edge)';
            }
            
            return `
                <tr>
                    <td style="white-space:nowrap; font-size:0.9rem;">${date}</td>
                    <td>${log.email}</td>
                    <td>${roleBadge}</td>
                    <td><strong style="color:${actionColor}; text-transform:uppercase; font-size:0.85rem;">${actionText}</strong></td>
                    <td style="font-size:0.85rem; color:#666;">${device}</td>
                </tr>
            `;
        }).join('');
        
    } catch (error) {
        console.error("Error loading audit logs:", error);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #dc3545;">Error loading logs.</td></tr>';
    }
};

window.closeAuditLogs = function() {
    document.getElementById('auditLogsModal').classList.remove('active');
};


// Load all teachers with real-time listener
function loadAllTeachers() {
    try {
        // Unsubscribe from previous listener if it exists
        if (unsubscribeTeachers) {
            unsubscribeTeachers();
        }
        
        const usersQuery = query(collection(db, 'users'), where('role', '==', 'teacher'));
        
        // Set up real-time listener for teachers
        unsubscribeTeachers = onSnapshot(usersQuery, (querySnapshot) => {
            allTeachers = [];
            
            querySnapshot.forEach((docSnap) => {
                allTeachers.push({ id: docSnap.id, ...docSnap.data() });
            });
            
            // Sort teachers by display name
            allTeachers.sort((a, b) => {
                const nameA = (a.displayName || a.email).toLowerCase();
                const nameB = (b.displayName || b.email).toLowerCase();
                return nameA.localeCompare(nameB);
            });
            
        }, (error) => {
            console.error('Error loading teachers:', error);
        });
        
    } catch (error) {
        console.error('Error setting up teachers listener:', error);
    }
}

// Open teachers modal with all teachers
window.openTeachersModal = async function() {
    try {
        const teachersContainer = document.getElementById('teachersContainer');
        
        if (!teachersContainer) {
            console.error('Teachers container not found');
            return;
        }
        
        if (allTeachers.length === 0) {
            teachersContainer.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #999;">
                    <p>No teachers found in the database.</p>
                </div>
            `;
        } else {
            teachersContainer.innerHTML = `
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1.5rem; padding: 1rem;">
                    ${allTeachers.map(teacher => createTeacherCard(teacher)).join('')}

                </div>
            `;
        }
        
        // Open the modal
        const teachersModal = document.getElementById('teachersModal');
        if (teachersModal) {
            teachersModal.classList.add('active');
        }
        
    } catch (error) {
        console.error('Error opening teachers modal:', error);
        alert('Error loading teachers. Please try again.');
    }
};

// Create individual teacher card
function createTeacherCard(teacher) {
    const initial = (teacher.displayName || teacher.email).charAt(0).toUpperCase();
    const requestCount = allRequests.filter(r => r.userEmail === teacher.email).length;
    const approvedCount = allRequests.filter(r => r.userEmail === teacher.email && r.status === 'approved').length;
    const pendingCount = allRequests.filter(r => r.userEmail === teacher.email && r.status === 'pending').length;
    
    return `
        <div style="background: white; border: 1px solid #e0e0e0; border-radius: 12px; padding: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.08); transition: all 0.3s ease; cursor: pointer;" onmouseover="this.style.boxShadow='0 4px 16px rgba(139,21,56,0.15)'" onmouseout="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.08)'">
            <div style="display: flex; flex-direction: column; align-items: center; text-align: center;">
                <!-- Profile Photo or Avatar -->
                <div style="position: relative; margin-bottom: 1rem;">
                    ${teacher.photoURL ? `
                        <img src="${teacher.photoURL}" alt="${teacher.displayName}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 3px solid #8B1538;">
                    ` : `
                        <div style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, #8B1538 0%, #c82333 100%); display: flex; align-items: center; justify-content: center; color: white; font-size: 2rem; font-weight: bold; border: 3px solid #8B1538;">
                            ${initial}
                        </div>
                    `}
                </div>
                
                <!-- Teacher Name -->
                <h3 style="margin: 0.5rem 0; color: #8B1538; font-size: 1.1rem; word-break: break-word;">
                    ${teacher.displayName || 'Unnamed Teacher'}
                </h3>
                
                <!-- Email -->
                <p style="margin: 0.25rem 0; color: #666; font-size: 0.9rem; word-break: break-all;">
                    ${teacher.email}
                </p>
                
                <!-- Department/Subject -->
                ${teacher.department ? `
                    <p style="margin: 0.5rem 0; color: #8B1538; font-size: 0.85rem; font-weight: 600;">
                        📚 ${teacher.department}
                    </p>
                ` : ''}
                
                <!-- phoneNumber (if available) -->
                ${teacher.phoneNumber ? `
                    <p style="margin: 0.25rem 0; color: #666; font-size: 0.9rem;">
                        📱 ${teacher.phoneNumber}
                    </p>
                ` : ''}
                
                <!-- Join Date -->
                <p style="margin: 0.5rem 0; color: #999; font-size: 0.85rem;">
                    Joined: ${new Date(teacher.createdAt || teacher.joinedAt || Date.now()).toLocaleDateString('en-KE', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    })}
                </p>
                
                <!-- Request Stats -->
                <div style="margin-top: 1rem; width: 100%; padding-top: 1rem; border-top: 1px solid #e0e0e0;">
                    <div style="display: flex; justify-content: space-around; text-align: center; margin-bottom: 0.75rem;">
                        <div>
                            <div style="font-weight: 600; color: #8B1538; font-size: 1.2rem;">${requestCount}</div>
                            <div style="font-size: 0.75rem; color: #666;">Total Requests</div>
                        </div>
                        <div>
                            <div style="font-weight: 600; color: #28a745; font-size: 1.2rem;">${approvedCount}</div>
                            <div style="font-size: 0.75rem; color: #666;">Approved</div>
                        </div>
                        <div>
                            <div style="font-weight: 600; color: #ff9800; font-size: 1.2rem;">${pendingCount}</div>
                            <div style="font-size: 0.75rem; color: #666;">Pending</div>
                        </div>
                    </div>
                    
                    <!-- View Requests Button -->
                    <button onclick="viewTeacherRequests('${teacher.email}')" style="width: 100%; padding: 0.75rem; background: #8B1538; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.3s ease; margin-top: 0.75rem;" onmouseover="this.style.background='#c82333'" onmouseout="this.style.background='#8B1538'">
                        View Requests
                    </button>

<button onclick="sendPrivateMessage('${teacher.email}', '${teacher.id}', '${teacher.displayName || teacher.email}')" 
        style="width: 100%; padding: 0.75rem; background: #2196F3; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; margin-top: 0.5rem;">
    ✉️ Send Message
</button>
                </div>
            </div>
        </div>
    `;
}

// Close teachers modal
window.closeTeachersModal = function() {
    const teachersModal = document.getElementById('teachersModal');
    if (teachersModal) {
        teachersModal.classList.remove('active');
    }
};








// View teacher's requests
window.viewTeacherRequests = function(teacherEmail) {
    closeTeachersModal();
    
    // Filter requests for this teacher
    const teacherRequests = allRequests.filter(r => r.userEmail === teacherEmail);
    
    // Show filtered view
    currentFilter = 'all';
    displayedRequests = teacherRequests;
    currentPage = 1;
    totalPages = Math.ceil(displayedRequests.length / itemsPerPage);
    
    // Update page title or display message
    const pageTitle = document.querySelector('h1') || document.querySelector('.page-title');
    if (pageTitle) {
        pageTitle.textContent = `${pageTitle.textContent.split(' - ')[0]} - Requests from ${teacherEmail}`;
    }
    
    displayRequests();
};

// Pagination Functions
window.goToPage = function(pageNumber) {
    if (pageNumber >= 1 && pageNumber <= totalPages) {
        currentPage = pageNumber;
        displayRequests();
    }
};

window.previousPage = function() {
    if (currentPage > 1) {
        currentPage--;
        displayRequests();
    }
};

window.nextPage = function() {
    if (currentPage < totalPages) {
        currentPage++;
        displayRequests();
    }
};

window.changeItemsPerPage = function(newItemsPerPage) {
    itemsPerPage = parseInt(newItemsPerPage);
    currentPage = 1;
    displayRequests();
};

function updateAdminPaginationControls() {
    const paginationContainer = document.getElementById('paginationContainer');
    if (!paginationContainer) return;
    
    let paginationHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; padding: 1.5rem; background: #f5f5f5; border-radius: 6px;">
            <div style="font-size: 0.9rem; color: #666;">
                Showing <strong>${(currentPage - 1) * itemsPerPage + 1}</strong> to <strong>${Math.min(currentPage * itemsPerPage, displayedRequests.length)}</strong> of <strong>${displayedRequests.length}</strong> requests
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

// Load dashboard statistics with real-time listener
async function loadDashboardStats() {
    try {
        // Unsubscribe from previous listener if it exists
        if (unsubscribeStats) {
            unsubscribeStats();
        }
        
        const usersQuery = query(collection(db, 'users'), where('role', '==', 'teacher'));
        
        // Set up real-time listener for users
        unsubscribeStats = onSnapshot(usersQuery, (usersSnapshot) => {
            const totalTeachers = usersSnapshot.size;
            document.getElementById('totalTeachers').textContent = totalTeachers;
        }, (error) => {
            console.error('Error loading stats:', error);
        });
        
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load all requests with real-time listener
function loadAllRequests() {
    try {
        // Unsubscribe from previous listener if it exists
        if (unsubscribeRequests) {
            unsubscribeRequests();
        }
        
        const q = query(collection(db, 'requests'));
        
        // Set up real-time listener
        unsubscribeRequests = onSnapshot(q, (querySnapshot) => {
            allRequests = [];
            
            querySnapshot.forEach((docSnap) => {
                allRequests.push({ id: docSnap.id, ...docSnap.data() });
            });
            
            // Sort requests by submittedAt (newest first)
            allRequests.sort((a, b) => {
                const dateA = new Date(a.submittedAt);
                const dateB = new Date(b.submittedAt);
                return dateB - dateA;
            });
            
            // Reset pagination
            currentPage = 1;
            
            displayRequests();
            
            // Also update stats in real-time
            updateStatsFromRequests();
        }, (error) => {
            console.error('Error loading requests:', error);
            document.getElementById('requestsTableBody').innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 2rem; color: #c33;">
                        Error loading requests. Please refresh the page.
                    </td>
                </tr>
            `;
        });
        
    } catch (error) {
        console.error('Error setting up listener:', error);
    }
}

// Update stats from current requests array
function updateStatsFromRequests() {
    const total = allRequests.length;
    const pending = allRequests.filter(r => r.status === 'pending').length;
    
    // Approved today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const approvedToday = allRequests.filter(r => {
        if (r.status !== 'approved' || !r.reviewedAt) return false;
        const reviewDate = new Date(r.reviewedAt);
        return reviewDate >= today;
    }).length;
    
    // Update UI
    document.getElementById('totalRequests').textContent = total;
    document.getElementById('pendingRequests').textContent = pending;
    document.getElementById('approvedToday').textContent = approvedToday;
}

// Display requests based on current filter with pagination
function displayRequests() {
    let filteredRequests = allRequests;
    
    if (currentFilter === 'pending' || currentFilter === 'approved' || currentFilter === 'rejected') {
        filteredRequests = allRequests.filter(r => r.status === currentFilter);
    } else if (currentFilter !== 'all') {
        filteredRequests = allRequests.filter(r => r.type === currentFilter);
    }
    
    displayedRequests = filteredRequests;
    
    // Calculate total pages
    totalPages = Math.ceil(displayedRequests.length / itemsPerPage);
    
    // Ensure current page is valid
    if (currentPage > totalPages && totalPages > 0) {
        currentPage = totalPages;
    }
    
    const tbody = document.getElementById('requestsTableBody');
    
    if (displayedRequests.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 2rem; color: #999;">
                    No requests found for this filter.
                </td>
            </tr>
        `;
        document.getElementById('paginationContainer').innerHTML = '';
        return;
    }
    
    // Paginate results
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, displayedRequests.length);
    const paginatedRequests = displayedRequests.slice(startIndex, endIndex);
    
    tbody.innerHTML = paginatedRequests.map((request, index) => {
        const rowNumber = startIndex + index + 1;
        const date = new Date(request.submittedAt).toLocaleDateString('en-KE', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
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
        
        // Get summary details
        let details = '';
        if (request.type === 'permission') {
            details = `${request.date} - ${request.timePeriod}`;
        } else if (request.type === 'sick-leave') {
            details = `${request.startDate} to ${request.endDate}`;
        } else if (request.type === 'court-summon') {
            details = `${request.courtDate} - ${request.courtName}`;
        } else {
            details = `${request.startDate}${request.endDate ? ' to ' + request.endDate : ''}`;
        }
        
        return `
            <tr>
                <td style="font-weight: 600; color: #8B1538; text-align: center; width: 50px;">${rowNumber}</td>
                <td>${request.userEmail}</td>
                <td><strong>${typeNames[request.type]}</strong></td>
                <td>${date}</td>
                <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${details}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>
                    <button class="btn-submit" style="padding: 0.5rem 1rem; font-size: 0.85rem;" onclick="openReviewModal('${request.id}')">
                        ${request.status === 'pending' ? 'Review' : 'View'}
                    </button>
                     <button class="btn-delete" style="padding: 0.5rem 1rem; font-size: 0.85rem; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;" onclick="deleteRequest('${request.id}', '${request.userEmail}')">
                       🗑️ Delete
                    </button>
                </td>
                
            </tr>
        `;
    }).join('');
    
    // Update pagination controls
    updateAdminPaginationControls();
}

// Delete request function
window.deleteRequest = async function(requestId, userEmail) {
    const confirmDelete = confirm(`Are you sure you want to delete this request from ${userEmail}? This action will be logged in the audit trail.`);
    
    if (!confirmDelete) {
        return;
    }
    
    try {
        const docRef = doc(db, 'requests', requestId);
        const currentDoc = await getDoc(docRef);
        
        if (!currentDoc.exists()) {
            alert('Request not found');
            return;
        }
        
        const currentData = currentDoc.data();
        
        // Create audit log entry for deletion
        const auditEntry = {
            timestamp: new Date().toISOString(),
            adminId: currentAdmin.uid,
            adminEmail: currentAdmin.email,
            action: 'deleted',
            previousStatus: currentData.status,
            newStatus: 'deleted',
            notes: 'Request deleted by admin',
            deletedAt: new Date().toISOString()
        };
        
        // Get existing audit log or create new one
        const auditLog = currentData.auditLog || [];
        auditLog.push(auditEntry);
        
        // Update the request instead of deleting to keep audit trail
        const updateData = {
            status: 'deleted',
            deletedAt: new Date().toISOString(),
            deletedBy: currentAdmin.uid,
            deletedByEmail: currentAdmin.email,
            auditLog: auditLog,
            lastModifiedAt: new Date().toISOString(),
            lastModifiedBy: currentAdmin.email,
            adminNotes: 'Request deleted by admin'
        };
        
        await updateDoc(docRef, updateData);
        
        alert('Request deleted successfully and logged in audit trail!');
        
        // Reload data
        loadDashboardStats();
        loadAllRequests();
        
    } catch (error) {
        console.error('Error deleting request:', error);
        alert('Error deleting request. Please try again.');
    }
};

// Search requests
document.getElementById('searchRequests')?.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    
    let baseRequests = allRequests;
    if (currentFilter === 'pending' || currentFilter === 'approved' || currentFilter === 'rejected') {
        baseRequests = allRequests.filter(r => r.status === currentFilter);
    } else if (currentFilter !== 'all') {
        baseRequests = allRequests.filter(r => r.type === currentFilter);
    }
    
    if (!searchTerm) {
        displayedRequests = baseRequests;
        currentPage = 1;
        totalPages = Math.ceil(displayedRequests.length / itemsPerPage);
        displayFilteredRequests(displayedRequests);
        return;
    }
    
    const filtered = baseRequests.filter(request => {
        const typeNames = {
            'permission': 'Permission',
            'sick-leave': 'Sick Leave',
            'court-summon': 'Court Summon',
            'other': request.requestType || 'Other'
        };
        
        const type = typeNames[request.type].toLowerCase();
        const email = request.userEmail.toLowerCase();
        const status = request.status.toLowerCase();
        
        return type.includes(searchTerm) || 
               email.includes(searchTerm) || 
               status.includes(searchTerm);
    });
    
    displayedRequests = filtered;
    currentPage = 1;
    totalPages = Math.ceil(displayedRequests.length / itemsPerPage);
    displayFilteredRequests(filtered);
});

function displayFilteredRequests(requests) {
    const tbody = document.getElementById('requestsTableBody');
    
    if (requests.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 2rem; color: #999;">
                    No requests found.
                </td>
            </tr>
        `;
        document.getElementById('paginationContainer').innerHTML = '';
        return;
    }
    
    // Paginate results
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, requests.length);
    const paginatedRequests = requests.slice(startIndex, endIndex);
    
    tbody.innerHTML = paginatedRequests.map((request, index) => {
        const rowNumber = startIndex + index + 1;
        const date = new Date(request.submittedAt).toLocaleDateString('en-KE', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
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
        
        let details = '';
        if (request.type === 'permission') {
            details = `${request.date} - ${request.timePeriod}`;
        } else if (request.type === 'sick-leave') {
            details = `${request.startDate} to ${request.endDate}`;
        } else if (request.type === 'court-summon') {
            details = `${request.courtDate} - ${request.courtName}`;
        } else {
            details = `${request.startDate}${request.endDate ? ' to ' + request.endDate : ''}`;
        }
        
        return `
            <tr>
                <td style="font-weight: 600; color: #8B1538; text-align: center; width: 50px;">${rowNumber}</td>
                <td>${request.userEmail}</td>
                <td><strong>${typeNames[request.type]}</strong></td>
                <td>${date}</td>
                <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${details}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>
                    <button class="btn-submit" style="padding: 0.5rem 1rem; font-size: 0.85rem;" onclick="openReviewModal('${request.id}')">
                        ${request.status === 'pending' ? 'Review' : 'View'}
                    </button>
                </td>
                <td>
                    <button class="btn-delete" style="padding: 0.5rem 1rem; font-size: 0.85rem; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;" onclick="deleteRequest('${request.id}', '${request.userEmail}')">
                        Delete
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    // Update pagination controls
    updateAdminPaginationControls();
}

// Export admin CSV
window.exportAdminCSV = function() {
    if (allRequests.length === 0) {
        alert('No requests to export');
        return;
    }
    
    const headers = ['Teacher Email', 'Type', 'Submitted', 'Status', 'Details'];
    const rows = allRequests.map(request => {
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
        
        return [request.userEmail, type, date, status, `"${details}"`];
    });
    
    let csv = headers.join(',') + '\n';
    csv += rows.map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tsc-admin-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
};

// Bulk approve
window.showBulkApprove = function() {
    const pendingRequests = allRequests.filter(r => r.status === 'pending');
    
    if (pendingRequests.length === 0) {
        alert('No pending requests to approve');
        return;
    }
    
    const listContainer = document.getElementById('bulkRequestsList');
    listContainer.innerHTML = pendingRequests.map(request => {
        const typeNames = {
            'permission': 'Permission',
            'sick-leave': 'Sick Leave',
            'court-summon': 'Court Summon',
            'other': request.requestType || 'Other'
        };
        
        return `
            <label style="display: flex; align-items: center; padding: 0.75rem; border: 1px solid #e0e0e0; border-radius: 6px; margin-bottom: 0.5rem; cursor: pointer; transition: all 0.3s ease;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='white'">
                <input type="checkbox" class="bulk-checkbox" value="${request.id}" style="margin-right: 1rem; width: 18px; height: 18px; cursor: pointer;">
                <div style="flex: 1;">
                    <strong>${request.userEmail}</strong> - ${typeNames[request.type]}
                    <br>
                    <small style="color: #666;">${new Date(request.submittedAt).toLocaleDateString('en-KE')}</small>
                </div>
            </label>
        `;
    }).join('');
    
    document.getElementById('bulkApproveModal').classList.add('active');
};

window.closeBulkModal = function() {
    document.getElementById('bulkApproveModal').classList.remove('active');
};

window.bulkApproveRequests = async function() {
    const checkboxes = document.querySelectorAll('.bulk-checkbox:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedIds.length === 0) {
        alert('Please select at least one request');
        return;
    }
    
    if (!confirm(`Approve ${selectedIds.length} request(s)?`)) {
        return;
    }
    
    try {
        const promises = selectedIds.map(async (id) => {
            // Get current request data
            const docRef = doc(db, 'requests', id);
            const currentDoc = await getDoc(docRef);
            const currentData = currentDoc.data();
            
            // Create audit log entry for bulk approval
            const auditEntry = {
                timestamp: new Date().toISOString(),
                adminId: currentAdmin.uid,
                adminEmail: currentAdmin.email,
                action: 'approved',
                previousStatus: currentData.status,
                newStatus: 'approved',
                notes: 'Bulk approved',
                bulkOperation: true
            };
            
            // Get existing audit log or create new one
            const auditLog = currentData.auditLog || [];
            auditLog.push(auditEntry);
            
            const updateData = {
                status: 'approved',
                reviewedAt: new Date().toISOString(),
                reviewedBy: currentAdmin.uid,
                reviewerEmail: currentAdmin.email,
                auditLog: auditLog,
                lastModifiedAt: new Date().toISOString(),
                lastModifiedBy: currentAdmin.email,
                adminNotes: 'Bulk approved'
            };
            
            // Check if status is being changed (not from pending)
            if (currentData.status !== 'pending') {
                updateData.statusChanged = true;
                updateData.statusChangeReason = 'Bulk approval operation';
            }
            
            return updateDoc(docRef, updateData);
        });
        
        await Promise.all(promises);
        
        alert(`${selectedIds.length} request(s) approved successfully!`);
        
        closeBulkModal();
        loadDashboardStats();
        loadAllRequests();
        
    } catch (error) {
        console.error('Error bulk approving:', error);
        alert('Error approving requests. Please try again.');
    }
};

// Filter requests
window.filterRequests = function(filter) {
    currentFilter = filter;
    currentPage = 1;
    
    // Update button states
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.filter === filter) {
            btn.classList.add('active');
        }
    });
    
    displayRequests();
};

// Open review modal
window.openReviewModal = async function(requestId) {
    currentRequestId = requestId;
    
    try {
        const docRef = doc(db, 'requests', requestId);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
            alert('Request not found');
            return;
        }
        
        const request = docSnap.data();
        
        let detailsHTML = `
            <div style="background: #f5f5f5; padding: 1.5rem; border-radius: 8px; margin-bottom: 1rem;">
                <h4 style="color: #8B1538; margin-bottom: 1rem;">Request Information</h4>
                <p><strong>Teacher:</strong> ${request.userEmail}</p>
                <p><strong>Request Type:</strong> ${getTypeName(request.type, request.requestType)}</p>
                <p><strong>Status:</strong> <span class="status-badge ${getStatusClass(request.status)}">${request.status.toUpperCase()}</span></p>
                <p><strong>Submitted:</strong> ${new Date(request.submittedAt).toLocaleString()}</p>
        `;
        
        if (request.type === 'permission') {
            detailsHTML += `
                <p><strong>Date:</strong> ${request.date}</p>
                <p><strong>Time Period:</strong> ${request.timePeriod}</p>
                <p><strong>Reason:</strong> ${request.reason}</p>
            `;
        } else if (request.type === 'sick-leave') {
            detailsHTML += `
                <p><strong>Start Date:</strong> ${request.startDate}</p>
                <p><strong>End Date:</strong> ${request.endDate}</p>
                <p><strong>Duration:</strong> ${calculateDays(request.startDate, request.endDate)} days</p>
                <p><strong>Diagnosis:</strong> ${request.diagnosis}</p>
                <p><strong>Doctor Name:</strong> ${request.doctorName}</p>
                <p><strong>Medical Certificate:</strong> ${request.medicalCertNumber}</p>
            `;
        } else if (request.type === 'court-summon') {
            detailsHTML += `
                <p><strong>Court Date:</strong> ${request.courtDate}</p>
                <p><strong>Court Name:</strong> ${request.courtName}</p>
                <p><strong>Case Number:</strong> ${request.caseNumber}</p>
                <p><strong>Case Nature:</strong> ${request.caseNature}</p>
                <p><strong>Summon Document:</strong> ${request.summonDocNumber}</p>
            `;
        } else {
            detailsHTML += `
                <p><strong>Request Type:</strong> ${request.requestType}</p>
                <p><strong>Start Date:</strong> ${request.startDate}</p>
                ${request.endDate ? `<p><strong>End Date:</strong> ${request.endDate}</p>` : ''}
                <p><strong>Reason:</strong> ${request.reason}</p>
                <p><strong>Supporting Documents:</strong> ${request.supportingDocuments}</p>
            `;
        }
        
        if (request.reviewedAt) {
            detailsHTML += `
                <hr style="margin: 1rem 0; border: none; border-top: 1px solid #ddd;">
                <p><strong>Reviewed At:</strong> ${new Date(request.reviewedAt).toLocaleString()}</p>
                <p><strong>Reviewed By:</strong> ${request.reviewerEmail || 'Unknown'}</p>
            `;
        }
        
        if (request.adminNotes) {
            detailsHTML += `<p><strong>Admin Notes:</strong> ${request.adminNotes}</p>`;
        }
        
        if (request.statusChanged) {
            detailsHTML += `
                <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 0.75rem; margin-top: 1rem; border-radius: 4px;">
                    <strong>⚠️ Status Changed:</strong> This request's status was modified after initial review.
                    ${request.statusChangeReason ? `<br><strong>Reason:</strong> ${request.statusChangeReason}` : ''}
                </div>
            `;
        }
        
        detailsHTML += `</div>`;
        
        // Add audit log section
        if (request.auditLog && request.auditLog.length > 0) {
            detailsHTML += `
                <div style="background: #f9f9f9; padding: 1.5rem; border-radius: 8px; margin-top: 1rem; border: 1px solid #e0e0e0;">
                    <h4 style="color: #8B1538; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
                        📋 Audit Trail
                        <span style="font-size: 0.8rem; background: #8B1538; color: white; padding: 0.25rem 0.5rem; border-radius: 12px; font-weight: normal;">${request.auditLog.length} ${request.auditLog.length === 1 ? 'entry' : 'entries'}</span>
                    </h4>
                    <div style="max-height: 250px; overflow-y: auto;">
            `;
            
            // Sort audit log by timestamp (newest first)
            const sortedLog = [...request.auditLog].sort((a, b) => 
                new Date(b.timestamp) - new Date(a.timestamp)
            );
            
            sortedLog.forEach((entry, index) => {
                const actionColor = entry.action === 'approved' ? '#28a745' : 
                                  entry.action === 'rejected' ? '#dc3545' : 
                                  entry.action === 'deleted' ? '#721c24' : '#6c757d';
                const statusChangeIndicator = entry.previousStatus !== 'pending' && 
                                             entry.previousStatus !== entry.newStatus 
                    ? '<span style="color: #ff6b6b; font-weight: bold;">⚠️ STATUS CHANGED</span>' 
                    : '';
                
                detailsHTML += `
                    <div style="background: white; padding: 1rem; margin-bottom: 0.75rem; border-radius: 6px; border-left: 3px solid ${actionColor};">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                            <strong style="color: ${actionColor}; text-transform: uppercase;">${entry.action}</strong>
                            <small style="color: #666;">${new Date(entry.timestamp).toLocaleString('en-KE')}</small>
                        </div>
                        <p style="margin: 0.25rem 0; font-size: 0.9rem;">
                            <strong>Admin:</strong> ${entry.adminEmail}
                        </p>
                        <p style="margin: 0.25rem 0; font-size: 0.9rem;">
                            <strong>Status:</strong> 
                            <span style="color: #666;">${entry.previousStatus}</span> 
                            → 
                            <span style="color: ${actionColor}; font-weight: bold;">${entry.newStatus}</span>
                            ${statusChangeIndicator}
                        </p>
                        ${entry.notes ? `<p style="margin: 0.5rem 0 0 0; font-size: 0.9rem; font-style: italic; color: #555;">Note: ${entry.notes}</p>` : ''}
                    </div>
                `;
            });
            
            detailsHTML += `
                    </div>
                </div>
            `;
        }
        
        document.getElementById('requestDetailsContainer').innerHTML = detailsHTML;
        document.getElementById('adminNotes').value = '';
        
        document.getElementById('reviewModal').classList.add('active');
        
    } catch (error) {
        console.error('Error loading request details:', error);
        alert('Error loading request details');
    }
};

// Close review modal
window.closeReviewModal = function() {
    document.getElementById('reviewModal').classList.remove('active');
    currentRequestId = null;
};

// Review request (approve or reject)
window.reviewRequest = async function(decision) {
    if (!currentRequestId) {
        alert('No request selected');
        return;
    }
    
    const adminNotes = document.getElementById('adminNotes').value.trim();
    
    const confirmMessage = decision === 'approved' 
        ? 'Are you sure you want to approve this request?'
        : 'Are you sure you want to reject this request?';
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    try {
        const docRef = doc(db, 'requests', currentRequestId);
        const currentDoc = await getDoc(docRef);
        const currentData = currentDoc.data();
        
        // Create audit log entry
        const auditEntry = {
            timestamp: new Date().toISOString(),
            adminId: currentAdmin.uid,
            adminEmail: currentAdmin.email,
            action: decision,
            previousStatus: currentData.status,
            newStatus: decision,
            notes: adminNotes || null
        };
        
        // Get existing audit log or create new one
        const auditLog = currentData.auditLog || [];
        auditLog.push(auditEntry);
        
        const updateData = {
            status: decision,
            reviewedAt: new Date().toISOString(),
            reviewedBy: currentAdmin.uid,
            reviewerEmail: currentAdmin.email,
            auditLog: auditLog,
            lastModifiedAt: new Date().toISOString(),
            lastModifiedBy: currentAdmin.email
        };
        
        if (adminNotes) {
            updateData.adminNotes = adminNotes;
        }
        
        // Check if status is being changed from a previous decision
        if (currentData.status !== 'pending' && currentData.status !== decision) {
            const warning = `⚠️ WARNING: This request was previously ${currentData.status}. You are changing it to ${decision}. This action will be logged in the audit trail.`;
            if (!confirm(warning)) {
                return;
            }
            updateData.statusChanged = true;
            updateData.statusChangeReason = adminNotes || 'No reason provided';
        }
        
        await updateDoc(docRef, updateData);
        
        alert(`Request ${decision} successfully!`);
        
        closeReviewModal();
        
        // Reload data
        loadDashboardStats();
        loadAllRequests();
        
    } catch (error) {
        console.error('Error reviewing request:', error);
        alert('Error processing request. Please try again.');
    }
};

// Helper functions
function getTypeName(type, requestType) {
    const typeNames = {
        'permission': 'Permission Request',
        'sick-leave': 'Sick Leave',
        'court-summon': 'Court Summon',
        'other': requestType || 'Other Request'
    };
    return typeNames[type] || type;
}

function getStatusClass(status) {
    return status === 'pending' ? 'status-pending' :
           status === 'approved' ? 'status-approved' :
           status === 'deleted' ? 'status-deleted' :
           'status-rejected';
}

function calculateDays(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
}

// Close modals when clicking outside
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

// Add CSS for active filter button
const style = document.createElement('style');
style.textContent = `
    .filter-btn.active {
        background: var(--tsc-maroon) !important;
        color: var(--tsc-white) !important;
        border-color: var(--tsc-maroon) !important;
    }
    
    .status-deleted {
        background-color: #f8d7da;
        color: #721c24;
        border: 1px solid #f5c6cb;
    }
    
    .btn-delete:hover {
        background: #c82333 !important;
        transition: all 0.3s ease;
    }
`;
document.head.appendChild(style);

// Analytics functions
window.openAnalytics = function() {
    document.getElementById('analyticsSection').style.display = 'block';
    generateAnalytics();
};

window.closeAnalytics = function() {
    document.getElementById('analyticsSection').style.display = 'none';
};

function generateAnalytics() {
    // Calculate statistics
    const typeCount = {};
    const statusCount = { pending: 0, approved: 0, rejected: 0, deleted: 0 };
    const monthlyCount = {};
    const teacherCount = {};
    const responseTimes = [];
    
    allRequests.forEach(request => {
        // Type count
        typeCount[request.type] = (typeCount[request.type] || 0) + 1;
        
        // Status count
        statusCount[request.status] = (statusCount[request.status] || 0) + 1;
        
        // Monthly count
        const month = new Date(request.submittedAt).toLocaleDateString('en-US', { month: 'short' });
        monthlyCount[month] = (monthlyCount[month] || 0) + 1;
        
        // Teacher count
        teacherCount[request.userEmail] = (teacherCount[request.userEmail] || 0) + 1;
        
        // Response time
        if (request.reviewedAt) {
            const submitted = new Date(request.submittedAt);
            const reviewed = new Date(request.reviewedAt);
            const hours = (reviewed - submitted) / (1000 * 60 * 60);
            responseTimes.push(hours);
        }
    });
    
    // Display response time stats
    if (responseTimes.length > 0) {
        const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        const fastest = Math.min(...responseTimes);
        const slowest = Math.max(...responseTimes);
        
        document.getElementById('avgResponseTime').textContent = `${Math.round(avg)} hours`;
        document.getElementById('fastestResponse').textContent = `${Math.round(fastest)} hours`;
        document.getElementById('slowestResponse').textContent = `${Math.round(slowest)} hours`;
    }
    
    // Top teachers
    const topTeachersHTML = Object.entries(teacherCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ email, count ], index) => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: ${index % 2 === 0 ? '#f9f9f9' : 'white'}; border-radius: 4px; margin-bottom: 0.5rem;">
                <div>
                    <strong>${index + 1}.</strong> ${email}
                </div>
                <div style="background: var(--tsc-maroon); color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-weight: 600;">
                    ${count} requests
                </div>
            </div>
        `).join('');
    
    document.getElementById('topTeachers').innerHTML = topTeachersHTML || '<p style="text-align: center; color: #999;">No data available</p>';
    
    // Simple text-based charts (since we don't have Chart.js loaded)
    displaySimpleChart('typeChart', typeCount, 'Requests by Type');
    displaySimpleChart('approvalChart', statusCount, 'Status Distribution');
}

function displaySimpleChart(canvasId, data, title) {
    const canvas = document.getElementById(canvasId);
    const parent = canvas.parentElement;
    
    // Replace canvas with simple bar chart
    const total = Object.values(data).reduce((a, b) => a + b, 0);
    
    let html = `<div style="padding: 1rem;">`;
    
    Object.entries(data).forEach(([key, value]) => {
        const percentage = total > 0 ? (value / total * 100) : 0;
        const color = key === 'approved' || key === 'permission' ? '#4caf50' :
                     key === 'rejected' ? '#f44336' :
                     key === 'deleted' ? '#dc3545' :
                     key === 'pending' || key === 'sick-leave' ? '#ff9800' :
                     '#2196F3';
        
        html += `
            <div style="margin-bottom: 1rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
                    <span style="font-weight: 500; text-transform: capitalize;">${key.replace('-', ' ')}</span>
                    <span style="font-weight: 600;">${value}</span>
                </div>
                <div style="background: #e0e0e0; height: 24px; border-radius: 12px; overflow: hidden;">
                    <div style="background: ${color}; height: 100%; width: ${percentage}%; transition: width 0.6s ease; display: flex; align-items: center; justify-content: flex-end; padding-right: 0.5rem; color: white; font-size: 0.8rem; font-weight: 600;">
                        ${Math.round(percentage)}%
                    </div>
                </div>
            </div>
        `;
    });
    
    html += `</div>`;
    
    parent.innerHTML = `<h4>${title}</h4>` + html;
}

// Cleanup listeners when page is closed
window.addEventListener('beforeunload', () => {
    if (unsubscribeRequests) unsubscribeRequests();
    if (unsubscribeStats) unsubscribeStats();
    if (unsubscribeTeachers) unsubscribeTeachers();
});





















let currentThreadId = null;
let unsubscribeMessages = null;
let allAdminThreads = [];
let unsubscribeAdminThreads = null;

// Send private message to a single teacher (creates thread if needed)
window.sendPrivateMessage = async function(teacherEmail, teacherId, teacherName) {
    const messageText = prompt(`Send private message to ${teacherName || teacherEmail}:\n\nType your message:`);
    if (!messageText || !messageText.trim()) return;

    const text = messageText.trim();

    try {
        const participants = [teacherId, currentAdmin.uid];
        participants.sort();
        const threadId = `thread_${participants[0]}_${participants[1]}`;

        const threadRef = doc(db, 'message_threads', threadId);
        const threadSnap = await getDoc(threadRef);

        if (!threadSnap.exists()) {
            await setDoc(threadRef, {
                participants: [teacherId, currentAdmin.uid],
                participantNames: [teacherName || teacherEmail, currentAdmin.displayName || currentAdmin.email],
                participantEmails: [teacherEmail, currentAdmin.email],
                lastMessagePreview: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
                lastMessageAt: serverTimestamp(),
                lastMessageSenderId: currentAdmin.uid,
                unreadCount: {
                    [teacherId]: 1,
                    [currentAdmin.uid]: 0
                },
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        } else {
            await updateDoc(threadRef, {
                lastMessagePreview: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
                lastMessageAt: serverTimestamp(),
                lastMessageSenderId: currentAdmin.uid,
                [`unreadCount.${teacherId}`]: increment(1),
                updatedAt: serverTimestamp()
            });
        }

        const messagesRef = collection(threadRef, 'messages');
        await addDoc(messagesRef, {
            senderId: currentAdmin.uid,
            senderName: currentAdmin.displayName || 'Admin',
            senderEmail: currentAdmin.email,
            photoURL: currentAdmin.photoURL || null,
            text: text,
            createdAt: serverTimestamp(),
            readBy: [currentAdmin.uid],
            deletedBy: []
        });

        openMessageModal(threadId, teacherName || teacherEmail);

        await addDoc(collection(db, 'audit_logs'), {
            userId: currentAdmin.uid,
            email: currentAdmin.email,
            role: 'admin',
            action: 'private_message_sent',
            targetUserId: teacherId,
            targetUserEmail: teacherEmail,
            messagePreview: text.substring(0, 50),
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error("Send private message failed:", err);
        alert("Failed to send message. Check console for details.");
    }
};
function loadAdminMessageThreads() {
    if (unsubscribeAdminThreads) unsubscribeAdminThreads();

    const q = query(
        collection(db, 'message_threads'),
        where('participants', 'array-contains', currentAdmin.uid),
        orderBy('lastMessageAt', 'desc')
    );

    unsubscribeAdminThreads = onSnapshot(q, snap => {
        allAdminThreads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        console.log("Admin threads loaded:", allAdminThreads.length); // Debug
        allAdminThreads.forEach(t => {
            console.log("Thread unread count:", t.unreadCount);  // Debug
        });

        renderAdminThreads();
        updateAdminMessagesBadge();
        
    }, err => {
        console.error("Admin threads error:", err);
    });
}

function renderAdminThreads() {
    const container = document.getElementById('adminThreadsList');
    if (!container) {
        console.warn("Admin threads container not found. Add <div id='adminThreadsList'></div> in HTML.");
        return;
    }

    if (allAdminThreads.length === 0) {
        container.innerHTML = `
            <p style="text-align:center; padding:2rem; color:#999;">
                No conversations yet. Send a message to start one.
            </p>
        `;
        return;
    }

    container.innerHTML = allAdminThreads.map(thread => {
        // Find the other participant's name (not current admin)
        const otherName = thread.participantNames?.find(n => 
            n !== (currentAdmin.displayName || currentAdmin.email.split('@')[0])
        ) || 'Unknown';

        const unread = thread.unreadCount?.[currentAdmin.uid] || 0;

        return `
            <div class="thread-item ${unread > 0 ? 'unread' : ''}" 
                 onclick="openAdminThread('${thread.id}', '${otherName}')">
                <div class="thread-avatar">
                    <!-- Optional: add avatar here later -->
                    <span>${otherName.charAt(0).toUpperCase()}</span>
                </div>
                <div class="thread-info">
                    <strong>${otherName}</strong>
                    <p>${thread.lastMessagePreview || 'New conversation'}</p>
                    <small>${getTimeAgo(thread.lastMessageAt)}</small>
                </div>
                ${unread > 0 ? `<span class="badge">${unread}</span>` : ''}
            </div>
        `;
    }).join('');
}





function markThreadAsRead(threadId) {
    if (!currentAdmin) return;
    const threadRef = doc(db, 'message_threads', threadId);
    updateDoc(threadRef, {
        [`unreadCount.${currentAdmin.uid}`]: 0
    }).then(() => {
        // ✅ ADD THIS LINE
        updateAdminMessagesBadge();
    }).catch(err => console.warn("Could not mark as read:", err));
}
// 4. Update renderMessages
function renderMessages(messages) {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    const currentUid = currentAdmin?.uid || null;

    if (messages.length === 0) {
        container.innerHTML = '<p style="text-align:center;padding:2rem;color:#999;">No messages yet. Say hi!</p>';
        return;
    }

    container.innerHTML = messages.map(msg => {
        const isMine = currentUid && msg.senderId === currentUid;
        const deleted = msg.deletedBy?.includes(currentUid);
        
        if (deleted) {
            return '<div style="padding:10px;color:#999;font-style:italic;">Message deleted</div>';
        }

        const senderName = msg.senderName || 'User';
        const initial = senderName.charAt(0).toUpperCase();
        
        // Check if message has attachment
        const hasAttachment = msg.attachment && msg.attachment.url;
        const isImage = hasAttachment && msg.attachment.type.startsWith('image/');
        const isPDF = hasAttachment && msg.attachment.type === 'application/pdf';

        return `
            <div style="display: flex; margin-bottom: 15px; ${isMine ? 'flex-direction: row-reverse;' : ''}">
                <div style="width: 40px; height: 40px; border-radius: 50%; background: ${isMine ? '#8B1538' : '#2196F3'}; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin: 0 10px; flex-shrink: 0;">
                    ${msg.photoURL ? `<img src="${msg.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'">` : initial}
                </div>
                <div style="background: ${isMine ? '#8B1538' : 'white'}; color: ${isMine ? 'white' : '#333'}; padding: 10px 15px; border-radius: 12px; max-width: 70%; border: 1px solid ${isMine ? '#8B1538' : '#e0e0e0'};">
                    <strong style="display: block; margin-bottom: 5px; font-size: 0.85rem; opacity: 0.8;">${senderName}</strong>
                    
                    ${msg.text ? `<p style="margin: 5px 0;">${msg.text}</p>` : ''}
                    
                    ${hasAttachment ? `
                        <div style="margin-top: 8px; padding: 8px; background: ${isMine ? 'rgba(255,255,255,0.1)' : '#f5f5f5'}; border-radius: 6px;">
                            ${isImage ? `
                                <a href="${msg.attachment.url}" target="_blank">
                                    <img src="${msg.attachment.url}" style="max-width: 100%; max-height: 200px; border-radius: 4px; display: block; cursor: pointer;" alt="${msg.attachment.name}">
                                </a>
                            ` : isPDF ? `
                                <a href="${msg.attachment.url}" target="_blank" style="display: flex; align-items: center; gap: 8px; color: inherit; text-decoration: none;">
                                    <span style="font-size: 2rem;">📄</span>
                                    <div>
                                        <div style="font-weight: 600; font-size: 0.9rem;">${msg.attachment.name}</div>
                                        <div style="font-size: 0.75rem; opacity: 0.7;">${formatFileSize(msg.attachment.size)}</div>
                                    </div>
                                </a>
                            ` : ''}
                        </div>
                    ` : ''}
                    
                    <small style="font-size: 0.75rem; opacity: 0.7; display: block; margin-top: 5px;">${getTimeAgo(msg.createdAt)}</small>
                    ${isMine ? `<button onclick="deleteMyMessage('${currentThreadId}', '${msg.id}')" style="background:none;border:none;color:inherit;text-decoration:underline;cursor:pointer;font-size:0.75rem;margin-top:5px;opacity:0.7;">Delete</button>` : ''}
                </div>
            </div>
        `;
    }).join('');

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

// Helper function to format file size
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

window.sendAdminReply = async function() {
    const input = document.getElementById('adminMessageInput');
    const text = input.value.trim();
    
    // Check if there's either text or a file
    if (!text && !selectedFile) {
        alert('Please type a message or attach a file');
        return;
    }
    
    if (!currentThreadId) {
        alert('No conversation selected');
        return;
    }
    
    try {
        // Disable send button to prevent double-sending
        const sendButton = event?.target;
        if (sendButton) {
            sendButton.disabled = true;
            sendButton.textContent = 'Sending...';
        }
        
        let fileData = null;
        
        // Upload file if attached
        if (selectedFile) {
            try {
                fileData = await uploadMessageFile(selectedFile, currentThreadId);
            } catch (error) {
                alert('Failed to upload file. Please try again.');
                if (sendButton) {
                    sendButton.disabled = false;
                    sendButton.textContent = 'Send';
                }
                return;
            }
        }
        
        // Create message object
        const messageData = {
            senderId: currentAdmin.uid,
            senderName: currentAdmin.displayName || 'Admin',
            senderEmail: currentAdmin.email,
            photoURL: currentAdmin.photoURL || null,
            text: text || (fileData ? '' : 'File attachment'),
            createdAt: serverTimestamp(),
            readBy: [currentAdmin.uid],
            deletedBy: []
        };
        
        // Add file data if exists
        if (fileData) {
            messageData.attachment = {
                url: fileData.url,
                name: fileData.name,
                type: fileData.type,
                size: fileData.size
            };
        }
        
        // Add message to Firestore
        const messagesRef = collection(db, 'message_threads', currentThreadId, 'messages');
        await addDoc(messagesRef, messageData);
        
        // Update thread metadata
        const threadRef = doc(db, 'message_threads', currentThreadId);
        const participantIds = currentThreadId.split('_').slice(1);
        const otherParticipantId = participantIds.find(id => id !== currentAdmin.uid);
        
        const previewText = text || `📎 ${fileData.name}`;
        
        await updateDoc(threadRef, {
            lastMessagePreview: previewText.substring(0, 80) + (previewText.length > 80 ? '...' : ''),
            lastMessageAt: serverTimestamp(),
            lastMessageSenderId: currentAdmin.uid,
            [`unreadCount.${otherParticipantId}`]: increment(1),
            updatedAt: serverTimestamp()
        });
        
        // Clear input and file
        input.value = '';
        clearFileAttachment();
        
        // ✅ ADD THIS LINE
updateAdminMessagesBadge();
        // Re-enable send button
        if (sendButton) {
            sendButton.disabled = false;
            sendButton.textContent = 'Send';
        }
        
    } catch (err) {
        console.error("Admin reply failed:", err);
        alert("Failed to send message. Please try again.");
        
        // Re-enable send button on error
        const sendButton = event?.target;
        if (sendButton) {
            sendButton.disabled = false;
            sendButton.textContent = 'Send';
        }
    }
};





window.deleteMyMessage = async function(threadId, messageId) {
    if (!confirm('Delete this message?')) return;
    
    try {
        const messageRef = doc(db, 'message_threads', threadId, 'messages', messageId);
        await updateDoc(messageRef, {
            deletedBy: arrayUnion(currentAdmin.uid)
        });
    } catch (err) {
        console.error("Delete message failed:", err);
        alert("Failed to delete message");
    }
};

function updateAdminMessagesBadge() {
    const unreadCount = allAdminThreads.reduce((sum, thread) => {
        return sum + (thread.unreadCount?.[currentAdmin.uid] || 0);
    }, 0);
    
    const badge = document.getElementById('messagesBadge');
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount;
            // Remove inline display:none and set to flex
            badge.style.display = 'flex';
            badge.style.alignItems = 'center';
            badge.style.justifyContent = 'center';
        } else {
            badge.style.display = 'none';
            badge.textContent = '';
        }
        
        console.log('Badge updated:', unreadCount); // Debug log
    }
}

// Close admin thread
window.closeAdminThread = function() {
    if (unsubscribeMessages) unsubscribeMessages();  // ← MOVE HERE
    document.getElementById('adminThreadView').style.display = 'none';
    document.getElementById('adminThreadsList').style.display = 'block';
};

// Open admin thread
// Replace the existing openAdminThread function with this:
// 3. Update openAdminThread
window.openAdminThread = function(threadId, partnerName) {
    currentThreadId = threadId;
    
    // Hide thread list, show thread view
    const threadsList = document.getElementById('adminThreadsList');
    const threadView = document.getElementById('adminThreadView');
    
    if (threadsList) threadsList.style.display = 'none';
    if (threadView) threadView.style.display = 'block';
    
    // Update header
    const nameElement = document.getElementById('chatPartnerName');
    if (nameElement) {
        nameElement.textContent = partnerName;
    }
    
    const messagesQuery = query(
        collection(db, 'message_threads', threadId, 'messages'),
        orderBy('createdAt', 'asc')
    );

    if (unsubscribeMessages) unsubscribeMessages();
    
    unsubscribeMessages = onSnapshot(messagesQuery, snap => {
        const messages = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderMessages(messages);
        markThreadAsRead(threadId);
    }, err => {
        console.error("Messages error:", err);
    });
};


function getTimeAgo(timestamp) {
    if (!timestamp) return 'just now';
    
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    
    return date.toLocaleDateString();
}

// 1. Update openMessageModal
window.openMessageModal = function(threadId = null, partnerName = 'Messages') {
    const backdrop = document.getElementById('messageModalBackdrop');
    const nameElement = document.getElementById('chatPartnerName');
    
    if (!backdrop) {
        console.error('Message modal backdrop not found');
        return;
    }
    
    nameElement.textContent = partnerName;
    backdrop.style.display = 'flex';
    backdrop.style.alignItems = 'center';
    backdrop.style.justifyContent = 'center';
    
    setTimeout(() => {
        const input = document.getElementById('adminMessageInput');
        if (input) {
            input.focus();
            // Add Enter key handler
            input.onkeypress = function(e) {
                if (e.key === 'Enter') {
                    sendAdminReply();
                }
            };
        }
    }, 100);
    
    if (threadId) {
        setTimeout(() => {
            openAdminThread(threadId, partnerName);
        }, 100);
    }
};


// Close message modal with animation
// 2. Update closeMessageModal
window.closeMessageModal = function() {
    const backdrop = document.getElementById('messageModalBackdrop');
    if (backdrop) {
        backdrop.style.display = 'none';
    }
    
    // Reset views
    const threadsList = document.getElementById('adminThreadsList');
    const threadView = document.getElementById('adminThreadView');
    
    if (threadsList) threadsList.style.display = 'block';
    if (threadView) threadView.style.display = 'none';
    
    // Cleanup listener
    if (unsubscribeMessages) {
        unsubscribeMessages();
        unsubscribeMessages = null;
    }
};

// Close on backdrop click
document.getElementById('messageModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'messageModalBackdrop') {
        closeMessageModal();
    }
});

// Escape key to close
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeMessageModal();
    }
})







// Global variable to store selected file
let selectedFile = null;

// Handle file selection
window.handleFileSelect = function(event) {
    const file = event.target.files[0];
    
    if (!file) return;
    
    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
        alert('Only images (JPG, PNG, GIF, WEBP) and PDFs are allowed');
        event.target.value = '';
        return;
    }
    
    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxSize) {
        alert('File size must be less than 5MB');
        event.target.value = '';
        return;
    }
    
    // Store file and show preview
    selectedFile = file;
    showFilePreview(file);
};



// Clear file attachment
window.clearFileAttachment = function() {
    selectedFile = null;
    document.getElementById('messageFileInput').value = '';
    document.getElementById('filePreviewArea').style.display = 'none';
};

