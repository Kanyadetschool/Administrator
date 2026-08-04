import { auth, db } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    signInWithPopup, 
    GoogleAuthProvider,
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";
import { 
    doc, 
    getDoc, 
    setDoc,
    addDoc,
    collection
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// Check if user is already logged in
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Check if user is admin
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.role === 'admin') {
                window.location.href = 'admin-dashboard.html';
            } else {
                window.location.href = 'dashboard.html';
            }
        } else {
            window.location.href = 'dashboard.html';
        }
    }
});

const loginForm = document.getElementById('loginForm');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const errorMessage = document.getElementById('errorMessage');
const loginBtn = document.getElementById('loginBtn');

// Email/Password Sign In
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    // Show loading state
    loginBtn.querySelector('span').style.display = 'none';
    loginBtn.querySelector('.loading-spinner').style.display = 'block';
    loginBtn.disabled = true;
    errorMessage.style.display = 'none';
    
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // Check if user document exists, if not create it
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
            // Create new user document
            await setDoc(userDocRef, {
                email: user.email,
                role: 'teacher',
                displayName: user.displayName || email.split('@')[0],
                createdAt: new Date().toISOString()
            });
        }

        // Log audit trail for login
        await addDoc(collection(db, 'audit_logs'), {
            userId: user.uid,
            email: user.email,
            role: userDoc.exists() ? userDoc.data().role : 'teacher',
            action: 'login',
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent
        });
        
        // Redirect based on role
        const userData = userDoc.exists() ? userDoc.data() : { role: 'teacher' };
        if (userData.role === 'admin') {
            window.location.href = 'admin-dashboard.html';
        } else {
            window.location.href = 'dashboard.html';
        }
        
    } catch (error) {
        console.error('Login error:', error);
        errorMessage.textContent = getErrorMessage(error.code);
        errorMessage.style.display = 'block';
        
        // Reset button
        loginBtn.querySelector('span').style.display = 'inline';
        loginBtn.querySelector('.loading-spinner').style.display = 'none';
        loginBtn.disabled = false;
    }
});

// Google Sign In
googleSignInBtn.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    errorMessage.style.display = 'none';
    
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        
        // Check if user document exists
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
            // Create new user document
            await setDoc(userDocRef, {
                email: user.email,
                role: 'teacher',
                displayName: user.displayName,
                photoURL: user.photoURL,
                createdAt: new Date().toISOString()
            });
        }
        
        // Log audit trail for Google login
        await addDoc(collection(db, 'audit_logs'), {
            userId: user.uid,
            email: user.email,
            role: userDoc.exists() ? userDoc.data().role : 'teacher',
            action: 'login',
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent
        });

        if (!userDoc.exists()) {
            window.location.href = 'dashboard.html';
        } else {
            // Redirect based on role
            const userData = userDoc.data();
            if (userData.role === 'admin') {
                window.location.href = 'admin-dashboard.html';
            } else {
                window.location.href = 'dashboard.html';
            }
        }
        
    } catch (error) {
        console.error('Google sign-in error:', error);
        errorMessage.textContent = getErrorMessage(error.code);
        errorMessage.style.display = 'block';
    }
});

// Error message helper
function getErrorMessage(errorCode) {
    const errorMessages = {
        'auth/invalid-email': 'Invalid email address format.',
        'auth/user-disabled': 'This account has been disabled.',
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/invalid-credential': 'Invalid email or password.',
        'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
        'auth/network-request-failed': 'Network error. Please check your connection.',
        'auth/popup-closed-by-user': 'Sign-in popup was closed.',
        'auth/cancelled-popup-request': 'Sign-in was cancelled.'
    };
    
    return errorMessages[errorCode] || 'An error occurred during sign-in. Please try again.';
}