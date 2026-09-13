// Import the already initialized firebase instance
const database = firebase.database();
const studentsRef = database.ref('students');

// Cache for frequently accessed data
let studentsCache = {};
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Utility function to show minimal loading state
function showLoading(message = 'Loading...') {
    const loader = document.createElement('div');
    loader.id = 'globalLoader';
    loader.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%;   background: rgba(117, 138, 138, 0.4)!important;
    /* background: rgba(117, 138, 138, 0.4); */
    backdrop-filter: blur(5px); 
                    background: rgba(0,0,0,0.5); display: flex; justify-content: center; 
                    align-items: center; z-index: 9999;">
            <div style="background: white; padding: 20px; border-radius: 8px; min-width: 200px; text-align: center; height: 100px; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                <div id="loaderMessage">${message}</div>
            </div>
        </div>
    `;
    document.body.appendChild(loader);
}

// Function to hide loading
function hideLoading() {
    const loader = document.getElementById('globalLoader');
    if (loader) {
        loader.remove();
    }
}

// Optimized batch processing with minimal delay
async function processBatch(updates, batchSize = 100) {
    const batchUpdates = {};
    let updateCount = 0;
    for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        batch.forEach(([key, value]) => {
            batchUpdates[key] = value;
            updateCount++;
        });
        await studentsRef.update(batchUpdates);
        // Minimal delay to prevent Firebase rate limiting
        if (i + batchSize < updates.length) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
    return updateCount;
}

// Optimized student data upload with explicit UPI update
async function uploadStudentData() {
    let loadingShown = false;
    try {
       // showLoading('👨‍⚕️Processing student data...');
        loadingShown = true;

        // Fetch and process data concurrently
        const [response, snapshot] = await Promise.all([
            fetch('./json/students.json'),
            studentsRef.limitToLast(10000).once('value')
        ]);

        if (!response.ok) throw new Error(`Failed to fetch students.json: ${response.status}`);
        const data = await response.json();
        const currentData = snapshot.val() || {};

        // Format JSON data and handle duplicates
        const formattedData = {};
        const duplicates = new Set();
        const seenAssessmentNos = new Set();

        for (const grade in data) {
            if (Array.isArray(data[grade])) {
                for (const student of data[grade]) {
                    if (student.assessmentNo) {
                        if (seenAssessmentNos.has(student.assessmentNo)) {
                            duplicates.add(student.assessmentNo);
                            console.warn(`Duplicate assessmentNo found: ${student.assessmentNo} for student ${student.name}`);
                            continue;
                        }
                        seenAssessmentNos.add(student.assessmentNo);
                        formattedData[student.assessmentNo] = {
                            ...student,
                            grade,
                            timestamp: Date.now()
                        };
                    }
                }
            }
        }

        // Track new and updated students
        const updates = [];
        let newStudentCount = 0;
        let updatedStudentCount = 0;

        // Compare with existing data
        for (const assessmentNo in formattedData) {
            const newStudent = formattedData[assessmentNo];
            const existingStudent = Object.values(currentData).find(s => s.assessmentNo === assessmentNo);

            if (!existingStudent) {
                // New student
                updates.push([assessmentNo, newStudent]);
                newStudentCount++;
                console.log(`Adding new student: ${newStudent.name} (${assessmentNo})`);
            } else {
                // Explicitly check for differences in key fields
                const fieldsChanged = (
                    existingStudent.name !== newStudent.name ||
                    existingStudent.upi !== newStudent.upi ||
                    existingStudent.image !== newStudent.image ||
                    existingStudent.grade !== newStudent.grade
                );

                if (fieldsChanged) {
                    updates.push([assessmentNo, newStudent]);
                    updatedStudentCount++;
                    console.log(`Updating student: ${newStudent.name} (${assessmentNo}) - Changes detected: ` +
                        `name: ${existingStudent.name} -> ${newStudent.name}, ` +
                        `upi: ${existingStudent.upi} -> ${newStudent.upi}, ` +
                        `image: ${existingStudent.image} -> ${newStudent.image}, ` +
                        `grade: ${existingStudent.grade} -> ${newStudent.grade}`);
                } else {
                    console.log(`No changes for student: ${newStudent.name} (${assessmentNo})`);
                }
            }
        }

        let message = '';
        if (updates.length > 0) {
            // Process updates in large batches
            const totalUpdates = await processBatch(updates, 100);

            // Update cache
            studentsCache = { ...currentData, ...Object.fromEntries(updates) };
            cacheTimestamp = Date.now();

            message = `Added ${newStudentCount} new students and updated ${updatedStudentCount} existing students`;
            if (duplicates.size > 0) {
                message += `\nSkipped ${duplicates.size} duplicate assessment numbers`;
            }
        } else {
            message = 'No changes detected - all student data is up to date';
            if (duplicates.size > 0) {
                message += `\nSkipped ${duplicates.size} duplicate assessment numbers`;
            }
        }

        hideLoading();
        loadingShown = false;

        await Swal.fire({
            icon: updates.length > 0 ? 'info' : 'info',
            title: updates.length > 0 ? 'Student Records Processed' : 'No Changes',
            text: message,
            timer: 2000,
            showConfirmButton: false
        });
    } catch (error) {
        console.error('Error processing student data:', error);
        if (loadingShown) hideLoading();

        await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: `Failed to process student data: ${error.message}`,
            timer: 2000
        });
    }
}

// Optimized student dropdown with caching
const updateStudentDropdown = async function() {
    const gradeSelect = document.getElementById('class');
    const studentSelect = document.getElementById('studentSelect');
    const selectedGrade = gradeSelect?.value;

    studentSelect.innerHTML = '<option value="">Select Student</option>';

    if (!selectedGrade) return;

    try {
        const now = Date.now();
        if (studentsCache && (now - cacheTimestamp < CACHE_DURATION)) {
            populateDropdownFromCache(selectedGrade, studentSelect);
            return;
        }

        const snapshot = await studentsRef
            .orderByChild('grade')
            .equalTo(selectedGrade)
            .limitToFirst(100)
            .once('value');

        const students = snapshot.val();
        if (students) {
            const sortedStudents = Object.values(students)
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            sortedStudents.forEach(student => {
                const option = document.createElement('option');
                option.value = student.name;
                option.textContent = student.name;
                option.dataset.upi = student.upi || '';
                option.dataset.assessmentNo = student.assessmentNo || '';
                studentSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error updating student dropdown:', error);
        studentSelect.innerHTML = '<option value="">Error loading students</option>';
    }
};

function populateDropdownFromCache(selectedGrade, studentSelect) {
    const students = Object.values(studentsCache)
        .filter(student => student.grade === selectedGrade)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    students.forEach(student => {
        const option = document.createElement('option');
        option.value = student.name;
        option.textContent = student.name;
        option.dataset.upi = student.upi || '';
        option.dataset.assessmentNo = student.assessmentNo || '';
        studentSelect.appendChild(option);
    });
}

// Function to auto-populate student details
function populateStudentDetails() {
    try {
        const studentSelect = document.getElementById('studentSelect');
        const selectedOption = studentSelect.options[studentSelect.selectedIndex];

        if (selectedOption && selectedOption.value) {
            document.getElementById('studentName').value = selectedOption.value;
            document.getElementById('studentUPI').value = selectedOption.dataset.upi || '';
            document.getElementById('assessmentNo').value = selectedOption.dataset.assessmentNo || '';
        } else {
            document.getElementById('studentName').value = '';
            document.getElementById('studentUPI').value = '';
            document.getElementById('assessmentNo').value = '';
        }
    } catch (error) {
        console.error('Error populating student details:', error);
    }
}

// Optimized initialization
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Starting student data processing...');
    try {
        await uploadStudentData();
        console.log('Student data processing completed successfully');
    } catch (error) {
        console.error('Error during student data processing:', error);
    }
    console.log('Student data processing sequence finished');
});