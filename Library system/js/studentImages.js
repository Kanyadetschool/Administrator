// import { grade1Images } from './grade1Images.js';
// import { grade2Images } from './grade2Images.js';
// import { grade3Images } from './grade3Images.js';
import { grade4Images } from './grade4Images.js';
// import { grade5Images } from './grade5Images.js';
// import { grade6Images } from './grade6Images.js';
// import { grade7Images } from './grade7Images.js';
// import { grade8Images } from './grade8Images.js';
// import { grade9Images } from './grade9Images.js';

// Combine all grade images into a single studentImages object
const studentImages = {
    // ...grade1Images,
    // ...grade2Images,
    // ...grade3Images,
    ...grade4Images,
    // ...grade5Images,
    // ...grade6Images,
    // ...grade7Images,
    // ...grade8Images,
    // ...grade9Images
};

const defaultStudentImage = 'images/default-student.png';

class StudentImageManager {
    static getStudentImage(studentId) {
        return studentImages[studentId] || defaultStudentImage;
    }

    static renderStudentImage(studentId, element, status = 'active') {
        const imageContainer = document.createElement('div');
        imageContainer.className = 'student-image-container';
        
        const img = document.createElement('img');
        img.src = this.getStudentImage(studentId);
        img.alt = 'Student Photo';
        img.className = 'student-image';
        img.onerror = () => {
            img.src = defaultStudentImage;
        };
        
        const statusElement = document.createElement('div');
        statusElement.className = `student-status status-${status.toLowerCase()}`;
        statusElement.textContent = status;
        
        imageContainer.appendChild(img);
        imageContainer.appendChild(statusElement);
        element.insertBefore(imageContainer, element.firstChild);
        
        return imageContainer;
    }
}

window.StudentImageManager = StudentImageManager;