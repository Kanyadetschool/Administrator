import { auth, db } from './firebase-config.js';
import { 
    createUserWithEmailAndPassword,
    signInWithPopup, 
    GoogleAuthProvider,
    updateProfile 
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";
import { 
    doc, 
    setDoc 
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

const registerForm = document.getElementById('registerForm');
const googleRegisterBtn = document.getElementById('googleRegisterBtn');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');
const registerBtn = document.getElementById('registerBtn');

// Add success message styles
const style = document.createElement('style');
style.textContent = `
    .success-message {
        background: #d4edda;
        border: 1px solid #c3e6cb;
        color: #155724;
        padding: 0.875rem 1rem;
        border-radius: 8px;
        margin-bottom: 1.5rem;
        font-size: 0.9rem;
    }
`;
document.head.appendChild(style);

// Email/Password Registration
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const fullName = document.getElementById('fullName').value.trim();
    const email = document.getElementById('email').value.trim();
    const tscNumber = document.getElementById('tscNumber').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const agreeTerms = document.getElementById('agreeTerms').checked;
    
    // Validation
    if (!agreeTerms) {
        showError('You must agree to the terms and conditions');
        return;
    }
    
    if (password.length < 6) {
        showError('Password must be at least 6 characters long');
        return;
    }
    
    if (password !== confirmPassword) {
        showError('Passwords do not match');
        return;
    }
    
    // Show loading state
    registerBtn.querySelector('span').style.display = 'none';
    registerBtn.querySelector('.loading-spinner').style.display = 'block';
    registerBtn.disabled = true;
    errorMessage.style.display = 'none';
    successMessage.style.display = 'none';
    
    try {
        // Create user account
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // Update profile with display name
        await updateProfile(user, {
            displayName: fullName
        });
        
        // Create user document in Firestore
        await setDoc(doc(db, 'users', user.uid), {
            email: email,
            displayName: fullName,
            tscNumber: tscNumber || null,
            role: 'teacher',
            createdAt: new Date().toISOString()
        });
        
        showSuccess('Account created successfully! Redirecting to dashboard...');
        
        // Redirect to dashboard after 2 seconds
        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 2000);
        
    } catch (error) {
        console.error('Registration error:', error);
        showError(getErrorMessage(error.code));
        
        // Reset button
        registerBtn.querySelector('span').style.display = 'inline';
        registerBtn.querySelector('.loading-spinner').style.display = 'none';
        registerBtn.disabled = false;
    }
});

// Google Sign Up
googleRegisterBtn.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    errorMessage.style.display = 'none';
    successMessage.style.display = 'none';
    
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        
        // Create user document in Firestore
        await setDoc(doc(db, 'users', user.uid), {
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            tscNumber: null,
            role: 'teacher',
            createdAt: new Date().toISOString()
        });
        
        showSuccess('Account created successfully! Redirecting to dashboard...');
        
        // Redirect to dashboard after 1 second
        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 1000);
        
    } catch (error) {
        console.error('Google sign-up error:', error);
        showError(getErrorMessage(error.code));
    }
});

// Helper functions
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    successMessage.style.display = 'none';
    
    // Scroll to error message
    errorMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showSuccess(message) {
    successMessage.textContent = message;
    successMessage.style.display = 'block';
    errorMessage.style.display = 'none';
}

function getErrorMessage(errorCode) {
    const errorMessages = {
        'auth/email-already-in-use': 'This email is already registered. Please sign in instead.',
        'auth/invalid-email': 'Invalid email address format.',
        'auth/operation-not-allowed': 'Email/password accounts are not enabled.',
        'auth/weak-password': 'Password is too weak. Please use a stronger password.',
        'auth/network-request-failed': 'Network error. Please check your connection.',
        'auth/popup-closed-by-user': 'Sign-up popup was closed.',
        'auth/cancelled-popup-request': 'Sign-up was cancelled.'
    };
    
    return errorMessages[errorCode] || 'An error occurred during registration. Please try again.';
}
