/**
 * Form Validation & Utility Functions
 * Centralized validation logic for the library management system
 */

const FormValidation = {
    // ISBN validation (10 or 13 digits)
    isValidISBN: function(isbn) {
        if (!isbn) return false;
        const cleanISBN = isbn.replace(/[-\s]/g, '');
        return /^(?:\d{9}[\dX]|\d{13})$/.test(cleanISBN);
    },

    // Phone number validation (10+ digits)
    isValidPhone: function(phone) {
        if (!phone) return true; // Optional field
        const cleanPhone = phone.replace(/[\s\-().]/g, '');
        return /^\d{10,}$/.test(cleanPhone);
    },

    // Email validation
    isValidEmail: function(email) {
        if (!email) return true; // Optional field
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    },

    // Assessment number validation (alphanumeric)
    isValidAssessmentNo: function(assessmentNo) {
        if (!assessmentNo) return false;
        return /^[A-Z0-9]{3,}$/i.test(assessmentNo.trim());
    },

    // Book title validation (minimum 3 characters)
    isValidTitle: function(title) {
        if (!title) return false;
        return title.trim().length >= 3;
    },

    // Grade validation
    isValidGrade: function(grade) {
        const validGrades = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9'];
        return validGrades.includes(grade);
    },

    // Date validation (not future date)
    isValidDate: function(date) {
        if (!date) return false;
        const selectedDate = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return selectedDate <= today;
    },

    // Check if return date is after issue date
    isValidDateRange: function(issueDate, returnDate) {
        if (!issueDate || !returnDate) return false;
        const issue = new Date(issueDate);
        const returnD = new Date(returnDate);
        return returnD > issue;
    },

    // Quantity validation (positive number)
    isValidQuantity: function(quantity) {
        const num = parseInt(quantity);
        return num > 0 && num < 10000;
    },

    // Name validation (2+ characters, letters and spaces only)
    isValidName: function(name) {
        if (!name) return false;
        return /^[a-zA-Z\s]{2,}$/.test(name.trim());
    },

    // School-specific validations
    isValidStudentData: function(studentData) {
        const errors = [];

        if (!studentData.fullName || !this.isValidName(studentData.fullName)) {
            errors.push('Full name must be at least 2 characters and contain only letters');
        }

        if (!studentData.grade || !this.isValidGrade(studentData.grade)) {
            errors.push('Please select a valid grade');
        }

        if (studentData.assessmentNo && !this.isValidAssessmentNo(studentData.assessmentNo)) {
            errors.push('Assessment number must be alphanumeric (min 3 characters)');
        }

        if (studentData.phoneNumber && !this.isValidPhone(studentData.phoneNumber)) {
            errors.push('Phone number must have at least 10 digits');
        }

        if (studentData.birthCertNo && studentData.birthCertNo.trim().length < 5) {
            errors.push('Birth Certificate number is too short');
        }

        return errors;
    },

    isValidBookData: function(bookData) {
        const errors = [];

        if (!bookData.title || !this.isValidTitle(bookData.title)) {
            errors.push('Book title must be at least 3 characters');
        }

        if (!bookData.isbn || !this.isValidISBN(bookData.isbn)) {
            errors.push('Please enter a valid ISBN (10 or 13 digits)');
        }

        if (!bookData.author || bookData.author.trim().length < 2) {
            errors.push('Author name is required');
        }

        if (!bookData.quantity || !this.isValidQuantity(bookData.quantity)) {
            errors.push('Quantity must be a positive number');
        }

        return errors;
    },

    isValidIssuanceData: function(issuanceData) {
        const errors = [];

        if (!issuanceData.studentId) {
            errors.push('Please select a student');
        }

        if (!issuanceData.bookId) {
            errors.push('Please select a book');
        }

        if (!issuanceData.issueDate || !this.isValidDate(issuanceData.issueDate)) {
            errors.push('Issue date must be today or earlier');
        }

        if (issuanceData.returnDate && !this.isValidDateRange(issuanceData.issueDate, issuanceData.returnDate)) {
            errors.push('Return date must be after issue date');
        }

        return errors;
    },

    // Show validation errors to user
    showValidationErrors: function(errors) {
        if (errors.length === 0) return true;

        const errorList = errors.map(e => `• ${e}`).join('\n');
        Swal.fire({
            icon: 'error',
            title: 'Validation Error',
            text: errorList,
            confirmButtonText: 'OK'
        });

        return false;
    }
};

/**
 * Date & Time Utilities
 */
const DateUtils = {
    // Format date as YYYY-MM-DD
    formatDate: function(date) {
        if (!date) return '';
        const d = new Date(date);
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${month}-${day}`;
    },

    // Format date for display
    formatDateDisplay: function(date) {
        if (!date) return 'N/A';
        return new Date(date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    },

    // Check if date is overdue
    isOverdue: function(dueDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const due = new Date(dueDate);
        due.setHours(0, 0, 0, 0);
        return due < today;
    },

    // Days until due
    daysUntilDue: function(dueDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const due = new Date(dueDate);
        due.setHours(0, 0, 0, 0);
        const diff = due - today;
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    },

    // Get date range for reports (last N days)
    getDateRange: function(days = 30) {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - days);
        return {
            start: this.formatDate(start),
            end: this.formatDate(end)
        };
    }
};

/**
 * String & Format Utilities
 */
const StringUtils = {
    // Truncate string with ellipsis
    truncate: function(str, length = 50) {
        if (!str) return '';
        return str.length > length ? str.substring(0, length) + '...' : str;
    },

    // Convert to title case
    toTitleCase: function(str) {
        if (!str) return '';
        return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    },

    // Generate random ID
    generateId: function() {
        return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    },

    // Capitalize first letter
    capitalize: function(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    },

    // Format phone number
    formatPhone: function(phone) {
        if (!phone) return '';
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length === 10) {
            return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
        }
        return phone;
    }
};

/**
 * Array Utilities
 */
const ArrayUtils = {
    // Remove duplicates
    unique: function(arr, key = null) {
        if (!key) return [...new Set(arr)];
        return arr.reduce((acc, obj) => {
            if (!acc.find(item => item[key] === obj[key])) {
                acc.push(obj);
            }
            return acc;
        }, []);
    },

    // Group array by key
    groupBy: function(arr, key) {
        return arr.reduce((groups, item) => {
            const groupKey = item[key];
            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(item);
            return groups;
        }, {});
    },

    // Sort by property
    sortBy: function(arr, key, ascending = true) {
        return [...arr].sort((a, b) => {
            if (a[key] < b[key]) return ascending ? -1 : 1;
            if (a[key] > b[key]) return ascending ? 1 : -1;
            return 0;
        });
    },

    // Paginate array
    paginate: function(arr, pageSize, pageNumber = 1) {
        const start = (pageNumber - 1) * pageSize;
        return {
            data: arr.slice(start, start + pageSize),
            total: arr.length,
            pages: Math.ceil(arr.length / pageSize),
            currentPage: pageNumber
        };
    }
};

/**
 * Export all utilities
 */
window.FormValidation = FormValidation;
window.DateUtils = DateUtils;
window.StringUtils = StringUtils;
window.ArrayUtils = ArrayUtils;
