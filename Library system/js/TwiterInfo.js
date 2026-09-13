// Import Firebase SDKs (same as app.js)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Firebase configuration (same as app.js)
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

// Initialize Firebase (only if not already initialized by app.js)
let app, database;
if (!firebase.apps.length) {
    app = initializeApp(firebaseConfig);
    database = getDatabase(app);
} else {
    app = firebase.apps[0];
    database = getDatabase(app);
}

// Function to create and show student details popup
function showStudentDetails(studentData, container) {
    const existingPopup = document.querySelector('.student-details-popup');
    if (existingPopup) existingPopup.remove();

    const popup = document.createElement('div');
    popup.className = 'student-details-popup';
    popup.style.position = 'absolute';
    popup.style.background = '#fff';
    popup.style.border = '1px solid #ccc';
    popup.style.borderRadius = '8px';
    popup.style.padding = '15px';
    popup.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    popup.style.zIndex = '1000';
    popup.style.maxWidth = '300px';

    const rect = container.getBoundingClientRect();
    popup.style.top = `${rect.bottom + window.scrollY}px`;
    popup.style.left = `${rect.left + window.scrollX}px`;

    // Include hasActiveBooks status from StudentManager
    const hasActiveBooks = studentData.hasActiveBooks ? 'Has Active Books' : 'No Active Books';
    popup.innerHTML = `
        <h3>${studentData.name || 'Unknown'}</h3>
        <p><strong>Student ID:</strong> ${studentData.id || 'N/A'}</p>
        <p><strong>Assessment No:</strong> ${studentData.assessmentNo || 'N/A'}</p>
        <p><strong>Grade:</strong> ${studentData.grade || 'N/A'}</p>
        <p><strong>UPI:</strong> ${studentData.upi || 'N/A'}</p>
        <p><strong>Status:</strong> ${hasActiveBooks}</p>
        <p><strong>Environmental Activities:</strong> ${studentData['Environmental Activities_grade'] || 'N/A'} (${studentData['Environmental Activities_points'] || 'N/A'} points)</p>
        <p><strong>Kiswahili:</strong> ${studentData.Kiswahili_grade || 'N/A'} (${studentData.Kiswahili_points || 'N/A'} points)</p>
        <p><strong>Mathematics:</strong> ${studentData.Mathematics_grade || 'N/A'} (${studentData.Mathematics_points || 'N/A'} points)</p>
        <p><strong>Religious Education:</strong> ${studentData['Religious Education_grade'] || 'N/A'} (${studentData['Religious Education_points'] || 'N/A'} points)</p>
        <p><strong>Indigenous Language:</strong> ${studentData['Indigenous Language_grade'] || 'N/A'} (${studentData['Indigenous Language_points'] || 'N/A'} points)</p>
        <button class="close-popup">Close</button>
    `;

    document.body.appendChild(popup);
    console.log("Popup displayed for student:", studentData);

    popup.querySelector('.close-popup').addEventListener('click', () => {
        popup.remove();
        console.log("Popup closed");
    });

    document.addEventListener('click', function closePopup(e) {
        if (!popup.contains(e.target) && e.target !== container) {
            popup.remove();
            document.removeEventListener('click', closePopup);
            console.log("Popup closed by clicking outside");
        }
    });
}

// Function to add event listeners to student containers
function setupStudentImageListeners() {
    const containers = document.querySelectorAll('.student-image-container');
    console.log("Found student image containers:", containers.length);
    if (containers.length === 0) {
        console.error("No elements with class 'student-image-container' found in the DOM");
        return;
    }

    containers.forEach(container => {
        // Remove existing listener to prevent duplicates
        container.removeEventListener('click', container._clickHandler);
        container._clickHandler = async () => {
            const studentId = container.dataset.studentId; // e.g., "student123"
            console.log("Clicked container with student ID:", studentId);
            if (!studentId) {
                console.error('No student ID found for this container. Ensure data-student-id is set.');
                alert('No student ID found. Please contact support.');
                return;
            }

            try {
                // Look up assessmentNo using the id
                const mappingRef = ref(database, `idToAssessmentNo/${studentId}`);
                const mappingSnapshot = await get(mappingRef);
                if (mappingSnapshot.exists()) {
                    const assessmentNo = mappingSnapshot.val(); // e.g., "B006437471"
                    const studentRef = ref(database, `students/${assessmentNo}`);
                    const studentSnapshot = await get(studentRef);
                    if (studentSnapshot.exists()) {
                        const studentData = studentSnapshot.val();
                        console.log("Fetched student data:", studentData);
                        showStudentDetails(studentData, container);
                    } else {
                        console.error('No student data found for assessmentNo:', assessmentNo);
                        alert(`No student data found for ID: ${studentId}`);
                    }
                } else {
                    console.error('No assessmentNo found for ID:', studentId);
                    alert(`No student data found for ID: ${studentId}`);
                }
            } catch (error) {
                console.error('Error fetching student data:', error);
                alert('Error fetching student data. Please try again later.');
            }
        };
        container.addEventListener('click', container._clickHandler);
    });
}

// Integrate with app.js initialization
document.addEventListener('DOMContentLoaded', () => {
    // Ensure app.js managers are initialized first
    if (window.studentManager) {
        console.log("StudentManager found, setting up student image listeners");
        setupStudentImageListeners();
    } else {
        console.warn("StudentManager not found, retrying after delay");
        setTimeout(setupStudentImageListeners, 1000); // Retry after 1 second
    }

    // Test Firebase connection
    async function testFirebase() {
        try {
            const testRef = ref(database, 'students');
            const snapshot = await get(testRef);
            console.log("Test query result:", snapshot.val());
        } catch (error) {
            console.error("Test query failed:", error);
        }
    }
    testFirebase();
});