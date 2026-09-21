// Firebase Auth Guard with User Info Popup - JavaScript Only
// Add this script to your HTML page after Firebase SDK imports

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Your Firebase config - REPLACE WITH YOUR ACTUAL CONFIG
const firebaseConfig = {
    apiKey: "AIzaSyA_41WpdMjHJOU5s3gQ9aieIayZRvUoRLE",
    authDomain: "kanyadet-school-admin.firebaseapp.com",
    projectId: "kanyadet-school-admin",
    storageBucket: "kanyadet-school-admin.appspot.com",
    messagingSenderId: "409708360032",
    appId: "1:409708360032:web:a21d63e8cb5fa1ecabee05",
    measurementId: "G-Y4C0ZRRL52",
    databaseURL: "https://kanyadet-school-admin-default-rtdb.firebaseio.com"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Create and inject all necessary HTML elements
function createAuthUI() {
    // Create loading screen
    const loadingScreen = document.createElement('div');
    loadingScreen.id = 'authLoadingScreen';
    loadingScreen.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(102, 126, 234, 0.9); z-index: 9999; color: white; font-family: Arial, sans-serif;">
            <div style="text-align: center;">
                <div style="border: 3px solid rgba(255,255,255,0.3); border-radius: 50%; border-top: 3px solid white; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 0 auto 15px;"></div>
                <div style="font-size: 18px;">Checking authentication...</div>
            </div>
        </div>
        <style>
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    `;
    document.body.appendChild(loadingScreen);

    // Create user info button
    const userInfoBtn = document.createElement('button');
    userInfoBtn.id = 'authUserInfoBtn';
    userInfoBtn.innerHTML = '👤 User Info';
    userInfoBtn.style.cssText = `
        position: fixed; top: 20px; right: 20px; background: #4285f4; color: white; 
        border: none; padding: 10px 20px; border-radius: 25px; cursor: pointer; 
        font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); 
        transition: all 0.3s ease; display: none; z-index: 1000;
    `;
    userInfoBtn.addEventListener('mouseenter', () => {
        userInfoBtn.style.background = '#3367d6';
        userInfoBtn.style.transform = 'translateY(-2px)';
    });
    userInfoBtn.addEventListener('mouseleave', () => {
        userInfoBtn.style.background = '#4285f4';
        userInfoBtn.style.transform = 'translateY(0)';
    });
    document.body.appendChild(userInfoBtn);

    // Create logout button
    const logoutBtn = document.createElement('button');
    logoutBtn.id = 'authLogoutBtn';
    logoutBtn.innerHTML = '🚪 Logout';
    logoutBtn.style.cssText = `
        position: fixed; top: 20px; left: 20px; background: #dc3545; color: white; 
        border: none; padding: 10px 20px; border-radius: 25px; cursor: pointer; 
        font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); 
        transition: all 0.3s ease; display: none; z-index: 1000;
    `;
    logoutBtn.addEventListener('mouseenter', () => {
        logoutBtn.style.background = '#c82333';
        logoutBtn.style.transform = 'translateY(-2px)';
    });
    logoutBtn.addEventListener('mouseleave', () => {
        logoutBtn.style.background = '#dc3545';
        logoutBtn.style.transform = 'translateY(0)';
    });
    document.body.appendChild(logoutBtn);

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'authUserModal';
    modal.style.cssText = `
        display: none; position: fixed; z-index: 2000; left: 0; top: 0; 
        width: 100%; height: 100%; background-color: rgba(0,0,0,0.5);
    `;
    
    modal.innerHTML = `
        <div style="
            background-color: white; margin: 5% auto; padding: 0; border-radius: 15px; 
            width: 90%; max-width: 400px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); 
            overflow: hidden; animation: slideIn 0.3s ease;
        ">
            <div style="
                background: linear-gradient(135deg, #4285f4, #34a853); color: white; 
                padding: 20px; text-align: center; position: relative;
            ">
                <span id="authCloseModal" style="
                    color: rgba(255,255,255,0.8); float: right; font-size: 28px; 
                    font-weight: bold; position: absolute; top: 15px; right: 20px; 
                    cursor: pointer; transition: color 0.3s;
                ">&times;</span>
                <h2 style="margin: 0; font-size: 24px;">User Information</h2>
            </div>
            <div style="padding: 30px 20px; text-align: center;">
                <img id="authUserAvatar" style="
                    width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 20px; 
                    border: 4px solid #f0f0f0; box-shadow: 0 4px 15px rgba(0,0,0,0.1); 
                    display: block;
                " src="" alt="User Avatar">
                <div id="authUserName" style="
                    font-size: 24px; font-weight: 600; margin-bottom: 10px; color: #333;
                "></div>
                <div id="authUserEmail" style="
                    font-size: 16px; color: #666; margin-bottom: 20px;
                "></div>
                
                <div style="
                    background: #f8f9fa; padding: 15px; border-radius: 10px; 
                    margin-bottom: 20px; text-align: left;
                ">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 10px; padding: 5px 0; border-bottom: 1px solid #e9ecef;">
                        <span style="font-weight: 600; color: #495057;">Provider:</span>
                        <span id="authUserProvider" style="color: #6c757d; text-align: right;"></span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 10px; padding: 5px 0; border-bottom: 1px solid #e9ecef;">
                        <span style="font-weight: 600; color: #495057;">Email Verified:</span>
                        <span id="authEmailVerified" style="color: #6c757d; text-align: right;"></span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 10px; padding: 5px 0; border-bottom: 1px solid #e9ecef;">
                        <span style="font-weight: 600; color: #495057;">User ID:</span>
                        <span id="authUserId" style="color: #6c757d; text-align: right; max-width: 60%; word-break: break-all; font-size: 12px;"></span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 10px; padding: 5px 0; border-bottom: 1px solid #e9ecef;">
                        <span style="font-weight: 600; color: #495057;">Account Created:</span>
                        <span id="authCreationTime" style="color: #6c757d; text-align: right; font-size: 12px;"></span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0; padding: 5px 0;">
                        <span style="font-weight: 600; color: #495057;">Last Sign In:</span>
                        <span id="authLastSignIn" style="color: #6c757d; text-align: right; font-size: 12px;"></span>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Add animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateY(-50px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    return {
        loadingScreen,
        userInfoBtn,
        logoutBtn,
        modal
    };
}

// Initialize UI elements
const authUI = createAuthUI();

// User info popup functionality
authUI.userInfoBtn.addEventListener('click', () => {
    if (window.currentUser) {
        populateUserModal(window.currentUser);
        authUI.modal.style.display = 'block';
    }
});

// Close modal functionality
document.getElementById('authCloseModal').addEventListener('click', () => {
    authUI.modal.style.display = 'none';
});

// Close modal when clicking outside
window.addEventListener('click', (event) => {
    if (event.target === authUI.modal) {
        authUI.modal.style.display = 'none';
    }
});

// Logout functionality
authUI.logoutBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to logout?')) {
        try {
            await signOut(auth);
            console.log('User signed out successfully');
        } catch (error) {
            console.error('Error signing out:', error);
            alert('Error signing out. Please try again.');
        }
    }
});

// Populate user modal with user information
function populateUserModal(user) {
    // Basic info
    document.getElementById('authUserName').textContent = user.displayName || 'No display name';
    document.getElementById('authUserEmail').textContent = user.email || 'No email';
    document.getElementById('authUserId').textContent = user.uid;

    // Avatar
    const avatar = document.getElementById('authUserAvatar');
    if (user.photoURL) {
        avatar.src = user.photoURL;
    } else {
        // Default avatar with user's initials or generic icon
        avatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.email || 'User')}&background=4285f4&color=fff&size=160`;
    }

    // Provider info
    const providerData = user.providerData[0];
    let providerName = 'Unknown';
    if (providerData) {
        switch (providerData.providerId) {
            case 'google.com':
                providerName = 'Google';
                break;
            case 'facebook.com':
                providerName = 'Facebook';
                break;
            case 'password':
                providerName = 'Email/Password';
                break;
            default:
                providerName = providerData.providerId;
        }
    }
    document.getElementById('authUserProvider').innerHTML = `<span style="display: inline-block; background: #28a745; color: white; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 500;">${providerName}</span>`;

    // Email verification status
    const emailVerifiedElement = document.getElementById('authEmailVerified');
    const isVerified = user.emailVerified;
    const verifiedClass = isVerified ? 'background: #d4edda; color: #155724;' : 'background: #f8d7da; color: #721c24;';
    emailVerifiedElement.innerHTML = `<span style="display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; ${verifiedClass}">${isVerified ? 'Verified' : 'Not Verified'}</span>`;

    // Timestamps
    const creationTime = new Date(user.metadata.creationTime).toLocaleString();
    const lastSignIn = new Date(user.metadata.lastSignInTime).toLocaleString();
    
    document.getElementById('authCreationTime').textContent = creationTime;
    document.getElementById('authLastSignIn').textContent = lastSignIn;
}

// Handle authentication errors
onAuthStateChanged(auth, () => {}, (error) => {
    console.error('Auth state change error:', error);
    authUI.loadingScreen.style.display = 'none';
    alert('Authentication error. Please refresh the page.');
});

// Show notification when user info is available
function showWelcomeNotification(user) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed; top: 80px; right: 20px; background: #28a745; color: white; 
        padding: 15px 20px; border-radius: 10px; z-index: 1001; 
        box-shadow: 0 4px 15px rgba(0,0,0,0.2); animation: slideInRight 0.3s ease;
        max-width: 300px; font-family: Arial, sans-serif;
    `;
    notification.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 5px;">Welcome back!</div>
        <div style="font-size: 14px; opacity: 0.9;">${user.displayName || user.email}</div>
    `;
    
    document.body.appendChild(notification);
    
    // Add slide in animation
    const slideInStyle = document.createElement('style');
    slideInStyle.textContent = `
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(slideInStyle);
    
    // Remove notification after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Auth state observer
onAuthStateChanged(auth, (user) => {
    authUI.loadingScreen.style.display = 'none';

    if (user) {
        console.log('User is authenticated:', user);
        
        authUI.userInfoBtn.style.display = 'block';
        authUI.logoutBtn.style.display = 'block';
        window.currentUser = user;
        
        // Show main content
        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.style.display = 'block';
        }
        
        // Show welcome notification
        showWelcomeNotification(user);
        
    } else {
        console.log('User is not authenticated, redirecting...');
        window.location.href = 'https://kanyadet-school-admin.web.app/login.html';
    }
});