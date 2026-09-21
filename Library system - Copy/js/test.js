// Add at the beginning of your app.js file
document.addEventListener('DOMContentLoaded', function() {
    // Check if elements exist before initializing
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.querySelector('.sidebar');
    
    if (sidebar) {
        // Create backdrop element
        const backdrop = document.createElement('div');
        backdrop.className = 'sidebar-backdrop';
        document.body.appendChild(backdrop);

        function toggleSidebar() {
            sidebar.classList.toggle('show');
            backdrop.classList.toggle('show');
        }

        // Toggle button click handler if button exists
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', toggleSidebar);
        }

        // Backdrop click handler
        backdrop.addEventListener('click', toggleSidebar);

        // Close sidebar when clicking nav links on mobile
        const navLinks = document.querySelectorAll('.nav-links li');
        if (navLinks.length > 0) {
            navLinks.forEach(link => {
                link.addEventListener('click', () => {
                    // if (window.innerWidth < 992) {
                    if (window.innerWidth < 392) {
                        toggleSidebar();
                    }
                });
            });
        }

        // Handle window resize
        window.addEventListener('resize', () => {
            // if (window.innerWidth >= 992) {
            if (window.innerWidth >= 392) {
                sidebar.classList.remove('show');
                backdrop.classList.remove('show');
            }
        });
    }
});

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// DOM Elements
const pages = document.querySelectorAll('.page');
const navLinks = document.querySelectorAll('.nav-links li');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const logoutBtn = document.getElementById('logoutBtn');

// Modal Elements
const bookModal = document.getElementById('bookModal');
const studentModal = document.getElementById('studentModal');
const issuanceModal = document.getElementById('issuanceModal');
const addBookBtn = document.getElementById('addBookBtn');
const addStudentBtn = document.getElementById('addStudentBtn');
const newIssuanceBtn = document.getElementById('newIssuanceBtn');

// Filter Elements
const categoryFilter = document.getElementById('categoryFilter');
const availabilityFilter = document.getElementById('availabilityFilter');
const gradeFilter = document.getElementById('gradeFilter');
const statusFilter = document.getElementById('statusFilter');

// Predefined Categories
const bookCategories = [
    'Skills in English -Grd 4',
    'Reference Book',
    'Study Guide',
    'Workbook',
    'Lab Manual',
    'Research Material',
    'Academic Journal',
    'Educational Magazine'
];

// Populate Category Dropdowns
function populateCategories() {
    const categoryFilter = document.getElementById('categoryFilter');
    const bookCategorySelect = document.getElementById('bookCategory');

    if (categoryFilter || bookCategorySelect) {
        bookCategories.forEach(category => {
            // Add to filter dropdown if it exists
            if (categoryFilter) {
                const filterOption = document.createElement('option');
                filterOption.value = category;
                filterOption.textContent = category;
                categoryFilter.appendChild(filterOption);
            }

            // Add to book form dropdown if it exists
            if (bookCategorySelect) {
                const formOption = document.createElement('option');
                formOption.value = category;
                formOption.textContent = category;
                bookCategorySelect.appendChild(formOption);
            }
        });
    }
}

// Call this function after DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    populateCategories();
});

// Navigation
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        const pageId = link.getAttribute('data-page');
        showPage(pageId);
        setActiveLink(link);
    });
});

function showPage(pageId) {
    pages.forEach(page => {
        page.classList.remove('active');
        if (page.id === pageId) {
            page.classList.add('active');
        }
    });
}

function setActiveLink(activeLink) {
    navLinks.forEach(link => link.classList.remove('active'));
    activeLink.classList.add('active');
}

// Dashboard Stats Manager
class DashboardManager {
    constructor() {
        this.updateAllStats();
        this.setupRealtimeListeners();
        this.setupStatCardListeners();
    }

    setupRealtimeListeners() {
        db.ref('books').on('value', () => {
            this.updateBookStats();
        });

        db.ref('students').on('value', () => {
            this.updateStudentStats();
        });

        db.ref('issuance').on('value', () => {
            this.updateIssuanceStats();
        });
    }

    setupStatCardListeners() {
        const statCards = document.querySelectorAll('.stat-card.clickable');
        statCards.forEach(card => {
            card.addEventListener('click', () => {
                const targetPage = card.getAttribute('data-page');
                const filter = card.getAttribute('data-filter');
                
                if (targetPage) {
                    if (filter === 'lost') {
                        lostBooksManager.showLostBooksModal();
                        return;
                    }
                    
                    showPage(targetPage);
                    
                    const navLink = document.querySelector(`.nav-links li[data-page="${targetPage}"]`);
                    if (navLink) {
                        setActiveLink(navLink);
                    }

                    switch (card.querySelector('h3').textContent.trim()) {
                        case 'Pending Returns':
                            document.getElementById('statusFilter').value = 'overdue';
                            issuanceManager.applyFilters();
                            break;
                        case 'Books Issued':
                            document.getElementById('statusFilter').value = 'active';
                            issuanceManager.applyFilters();
                            break;
                    }
                }
            });
        });
    }

    async updateAllStats() {
        this.updateBookStats();
        this.updateStudentStats();
        this.updateIssuanceStats();
    }

    async updateBookStats() {
        try {
            const snapshot = await db.ref('books').once('value');
            const totalBooks = snapshot.numChildren();
            document.getElementById('totalBooks').textContent = totalBooks;
        } catch (error) {
            console.error('Error updating book stats:', error);
            document.getElementById('totalBooks').textContent = '0';
        }
    }

    async updateStudentStats() {
        try {
            const snapshot = await db.ref('students').once('value');
            const totalStudents = snapshot.numChildren();
            document.getElementById('totalStudents').textContent = totalStudents;
        } catch (error) {
            console.error('Error updating student stats:', error);
            document.getElementById('totalStudents').textContent = '0';
        }
    }

    async updateIssuanceStats() {
        try {
            const snapshot = await db.ref('issuance').once('value');
            let booksIssued = 0;
            let pendingReturns = 0;
            let booksLost = 0;
            const currentDate = new Date();

            snapshot.forEach((childSnapshot) => {
                const issuance = childSnapshot.val();
                if (issuance.status === 'active') {
                    booksIssued++;
                    const returnDate = new Date(issuance.returnDate);
                    if (returnDate < currentDate) {
                        pendingReturns++;
                    }
                } else if (issuance.status === 'lost') {
                    booksLost++;
                }
            });

            document.getElementById('booksIssued').textContent = booksIssued;
            document.getElementById('pendingReturns').textContent = pendingReturns;
            document.getElementById('booksLost').textContent = booksLost;
        } catch (error) {
            console.error('Error updating issuance stats:', error);
        }
    }
}

// Books Management
class BookManager {
    constructor() {
        this.booksRef = db.ref('books');
        this.booksList = document.getElementById('booksList');
        this.bookForm = document.getElementById('bookForm');
        this.allBooks = new Map();
        this.grades = Array.from({length: 9}, (_, i) => `Grade ${i + 1}`);
        this.setupListeners();
        this.loadBooks();
    }

    async showError(title, message) {
        alert(`${title}: ${message}`);
    }

    async showSuccess(title, message) {
        alert(`${title}: ${message}`);
    }

    setupListeners() {
        addBookBtn.addEventListener('click', () => this.showBookModal());
        this.bookForm.addEventListener('submit', (e) => this.handleBookSubmit(e));
        categoryFilter.addEventListener('change', () => this.applyFilters());
        availabilityFilter.addEventListener('change', () => this.applyFilters());
        searchInput.addEventListener('input', () => this.handleSearch());
        // Add listener for delete options button
        document.getElementById('deleteOptionsBtn').addEventListener('click', () => this.showDeleteOptionsModal());
    }

    handleSearch() {
        const activePage = document.querySelector('.page.active').id;
        if (activePage === 'books') {
            this.applyFilters();
        }
    }

    applyFilters() {
        const category = categoryFilter.value;
        const availability = availabilityFilter.value;
        const searchTerm = searchInput.value.toLowerCase();

        this.booksList.innerHTML = '';

        this.allBooks.forEach((book, bookId) => {
            let showBook = true;

            if (category && book.category !== category) {
                showBook = false;
            }

            if (availability) {
                if (availability === 'available' && book.available <= 0) {
                    showBook = false;
                } else if (availability === 'issued' && book.available >= book.quantity) {
                    showBook = false;
                }
            }

            if (searchTerm && !book.title.toLowerCase().includes(searchTerm) && 
                !book.author.toLowerCase().includes(searchTerm) && 
                !book.grade.toLowerCase().includes(searchTerm) && 
                !book.isbn.toLowerCase().includes(searchTerm)) {
                showBook = false;
            }

            if (showBook) {
                this.renderBookCard(book, bookId);
            }
        });
    }

    async showBookModal(bookId = null) {
        try {
            let bookData = null;
            if (bookId) {
                const snapshot = await this.booksRef.child(bookId).once('value');
                bookData = snapshot.val();
                bookData.id = bookId;
            }

            const modalHtml = `
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${bookId ? 'Edit' : 'Add New'} Book</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <form id="bookForm">
                                <div class="mb-3">
                                    <label class="form-label">Grade Level</label>
                                    <select class="form-select" name="grade" required>
                                        <option value="">Select Grade</option>
                                        ${this.grades.map(grade => `
                                            <option value="${grade}" ${bookData?.grade === grade ? 'selected' : ''}>
                                                ${grade}
                                            </option>
                                        `).join('')}
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Title</label>
                                    <input type="text" class="form-control" name="title" required 
                                        value="${bookData?.title || ''}">
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Author</label>
                                    <input type="text" class="form-control" name="author" required 
                                        value="${bookData?.author || ''}">
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">ISBN</label>
                                    <input type="text" class="form-control" name="isbn" required 
                                        placeholder="The International Standard Book Number (ISBN)" 
                                        value="${bookData?.isbn || ''}">
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Category</label>
                                    <select class="form-select" name="category" required>
                                        <option value="">Select Category</option>
                                        ${bookCategories.map(cat => `
                                            <option value="${cat}" ${bookData?.category === cat ? 'selected' : ''}>
                                                ${cat}
                                            </option>
                                        `).join('')}
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Subject</label>
                                    <input type="text" class="form-control" name="subject" 
                                        value="${bookData?.subject || ''}">
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Quantity</label>
                                    <input type="number" class="form-control" name="quantity" required min="1" 
                                        value="${bookData?.quantity || 1}">
                                </div>
                                ${bookId ? `<input type="hidden" name="bookId" value="${bookId}">` : ''}
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" id="saveBook">Save</button>
                        </div>
                    </div>
                </div>
            `;

            bookModal.innerHTML = modalHtml;
            const modal = new bootstrap.Modal(bookModal);
            modal.show();

            document.getElementById('saveBook').onclick = async () => {
                const form = document.getElementById('bookForm');
                await this.handleBookSubmit(form, bookId);
                modal.hide();
            };
        } catch (error) {
            console.error('Error showing book modal:', error);
            await this.showError('Error', 'Failed to load book details');
        }
    }

    async handleBookSubmit(form, bookId = null) {
        try {
            const formData = new FormData(form);
            const quantity = parseInt(formData.get('quantity'));
            const isbn = formData.get('isbn').trim();

            // Validate inputs
            if (isNaN(quantity) || quantity < 1) {
                throw new Error('Quantity must be a positive number');
            }
            if (!isbn) {
                throw new Error('ISBN is required');
            }

            // Create base book data
            const bookData = {
                title: formData.get('title'),
                author: formData.get('author'),
                isbn: isbn,
                category: formData.get('category'),
                grade: formData.get('grade'),
                subject: formData.get('subject'),
                quantity: quantity,
                updatedAt: Date.now()
            };

            if (bookId) {
                // Update existing book
                const currentSnapshot = await this.booksRef.child(bookId).once('value');
                const currentData = currentSnapshot.val();
                
                // Maintain existing values
                bookData.available = currentData.available || currentData.quantity;
                bookData.addedAt = currentData.addedAt || Date.now();
                bookData.lost = currentData.lost || 0;
                
                await this.booksRef.child(bookId).update(bookData);
            } else {
                // Create new book
                bookData.available = bookData.quantity;
                bookData.addedAt = Date.now();
                bookData.lost = 0;
                bookData.status = 'available';
                
                await this.booksRef.push(bookData);
            }

            const modal = bootstrap.Modal.getInstance(document.getElementById('bookModal')) || new bootstrap.Modal(document.getElementById('bookModal'));
            if (modal) {
                modal.hide();
            }
            
            this.loadBooks();
            await this.showSuccess('Success', `Book successfully ${bookId ? 'updated' : 'added'}`);
        } catch (error) {
            console.error('Error saving book:', error);
            await this.showError('Error', error.message || 'Failed to save book. Please try again.');
        }
    }

    loadBooks() {
        this.booksRef.on('value', (snapshot) => {
            this.allBooks.clear();
            snapshot.forEach((childSnapshot) => {
                const book = childSnapshot.val();
                const bookId = childSnapshot.key;
                this.allBooks.set(bookId, book);
            });
            this.applyFilters();
        });
    }

    renderBookCard(book, bookId) {
        const card = document.createElement('div');
        card.className = 'grid-item';
        card.innerHTML = `
            <div class="book-cover-container"></div>
            <div>
            <h2>${book.grade}</h2>
            <h3>${book.title}</h3>
            <p>Author: ${book.author}</p>
            <p>ISBN: ${book.isbn || 'Not available'}</p>
            <p>Category: ${book.category}</p>
            <p>Available: ${book.available}/${book.quantity}</p>
            <p>Lost: ${book.lost || 0}</p>
            <div class="card-actions">
                <button onclick="bookManager.showBookModal('${bookId}')">Edit</button>
                <button onclick="bookManager.deleteBook('${bookId}')">Delete</button>
                <button onclick="bookManager.reportLost('${bookId}')" class="btn-warning">Report Lost</button>
            </div>
            </div>
        `;
        
        // Add book cover
        const coverContainer = card.querySelector('.book-cover-container');
        BookCoverManager.renderBookCover(bookId, coverContainer);

        this.booksList.appendChild(card);
    }

    async reportLost(bookId) {
        if (confirm('Are you sure you want to report this book as lost?')) {
            const bookRef = db.ref(`books/${bookId}`);
            const snapshot = await bookRef.once('value');
            const book = snapshot.val();
            
            if (book.available > 0) {
                await bookRef.update({
                    available: book.available - 1,
                    lost: (book.lost || 0) + 1
                });
            } else {
                alert('No available copies to mark as lost');
            }
        }
    }

    async deleteBook(bookId) {
        if (confirm('Are you sure you want to delete this book?')) {
            try {
                await this.booksRef.child(bookId).remove();
                await this.showSuccess('Success', 'Book deleted successfully');
            } catch (error) {
                console.error('Error deleting book:', error);
                await this.showError('Error', 'Failed to delete book');
            }
        }
    }

    async deleteBookCollection(category) {
        if (confirm(`Are you sure you want to delete all books in the ${category} category? This action cannot be undone.`)) {
            try {
                const snapshot = await this.booksRef.once('value');
                const updates = {};
                
                snapshot.forEach((childSnapshot) => {
                    const book = childSnapshot.val();
                    const bookId = childSnapshot.key;
                    if (book.category === category) {
                        updates[bookId] = null;
                    }
                });

                await this.booksRef.update(updates);
                await this.showSuccess('Success', `All books in ${category} category deleted successfully`);
                this.loadBooks();
            } catch (error) {
                console.error('Error deleting collection:', error);
                await this.showError('Error', `Failed to delete ${category} collection`);
            }
        }
    }

    async showDeleteOptionsModal() {
        try {
            const snapshot = await this.booksRef.once('value');
            const books = [];
            const categories = new Set();
            snapshot.forEach((childSnapshot) => {
                const book = childSnapshot.val();
                const bookId = childSnapshot.key;
                books.push({ id: bookId, title: book.title, category: book.category });
                categories.add(book.category);
            });

            const modalHtml = `
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Delete Options</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <label class="form-label">Delete a Specific Book</label>
                                <select id="deleteBookSelect" class="form-select">
                                    <option value="">Select a Book</option>
                                    ${books.map(book => `
                                        <option value="${book.id}">${book.title} (ID: ${book.id})</option>
                                    `).join('')}
                                </select>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Delete an Entire Category</label>
                                <select id="deleteCategorySelect" class="form-select">
                                    <option value="">Select a Category</option>
                                    ${Array.from(categories).map(category => `
                                        <option value="${category}">${category}</option>
                                    `).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-danger" id="confirmDelete">Delete</button>
                        </div>
                    </div>
                </div>
            `;

            const deleteModal = document.getElementById('deleteModal') || document.createElement('div');
            deleteModal.id = 'deleteModal';
            deleteModal.className = 'modal fade';
            deleteModal.innerHTML = modalHtml;
            document.body.appendChild(deleteModal);

            const modal = new bootstrap.Modal(deleteModal);
            modal.show();

            document.getElementById('confirmDelete').onclick = async () => {
                const bookId = document.getElementById('deleteBookSelect').value;
                const category = document.getElementById('deleteCategorySelect').value;

                if (bookId && category) {
                    await this.showError('Error', 'Please select either a book or a category, not both');
                    return;
                }

                if (bookId) {
                    await this.deleteBook(bookId);
                } else if (category) {
                    await this.deleteBookCollection(category);
                } else {
                    await this.showError('Error', 'Please select a book or category to delete');
                }

                modal.hide();
            };
        } catch (error) {
            console.error('Error showing delete options modal:', error);
            await this.showError('Error', 'Failed to load delete options');
        }
    }
}

// Students Management
class StudentManager {
    constructor() {
        this.studentsRef = db.ref('students');
        this.studentsList = document.getElementById('studentsList');
        this.studentForm = document.getElementById('studentForm');
        this.allStudents = new Map();
        this.setupListeners();
        this.loadStudents();
        this.setupStatusListener();
        this.setupFilterListeners();
    }

    setupStatusListener() {
        // Listen for issuance changes to update student statuses
        db.ref('issuance').on('value', () => {
            this.updateAllStudentStatuses();
        });
    }

    async updateAllStudentStatuses() {
        const studentsSnapshot = await this.studentsRef.once('value');
        const issuanceSnapshot = await db.ref('issuance').once('value');
        
        const activeIssuances = new Map();
        
        // Count active issuances per student
        issuanceSnapshot.forEach(childSnapshot => {
            const issuance = childSnapshot.val();
            if (issuance.status === 'active') {
                const count = activeIssuances.get(issuance.studentId) || 0;
                activeIssuances.set(issuance.studentId, count + 1);
            }
        });

        // Update each student's status
        const updates = {};
        studentsSnapshot.forEach(childSnapshot => {
            const studentId = childSnapshot.key;
            const activeCount = activeIssuances.get(studentId) || 0;
            updates[`${studentId}/hasActiveBooks`] = activeCount > 0;
        });

        if (Object.keys(updates).length > 0) {
            await this.studentsRef.update(updates);
        }
    }

    async deleteAllStudents() {
        if (confirm('Are you sure you want to delete ALL students? This action cannot be undone.')) {
            try {
                await this.studentsRef.remove();
                this.studentsList.innerHTML = ''; // Clear the displayed list
                this.allStudents.clear(); // Clear the local cache
                alert('All students have been deleted successfully.');
            } catch (error) {
                console.error('Error deleting all students:', error);
                alert('Failed to delete students. Please try again.');
            }
        }
    }

    setupListeners() {
        addStudentBtn.addEventListener('click', () => this.showStudentModal());
        this.studentForm.addEventListener('submit', (e) => this.handleStudentSubmit(e));
        gradeFilter.addEventListener('change', () => this.applyFilters());
        searchInput.addEventListener('input', () => this.handleSearch());
    }

    setupFilterListeners() {
        const gradeFilter = document.getElementById('gradeFilter');
        const statusFilter = document.getElementById('studentStatusFilter');
        
        if (gradeFilter) {
            gradeFilter.addEventListener('change', () => this.applyFilters());
        }
        
        if (statusFilter) {
            statusFilter.addEventListener('change', () => this.applyFilters());
        }
    }

    handleSearch() {
        const activePage = document.querySelector('.page.active').id;
        if (activePage === 'students') {
            this.applyFilters();
        }
    }

    async applyFilters() {
        const grade = document.getElementById('gradeFilter').value;
        const status = document.getElementById('studentStatusFilter').value;
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();

        // Clear the current list
        this.studentsList.innerHTML = '';

        try {
            const snapshot = await this.studentsRef.once('value');
            const students = snapshot.val();

            for (const [studentId, student] of Object.entries(students)) {
                let showStudent = true;

                // Apply grade filter
                if (grade && student.grade !== grade) {
                    showStudent = false;
                }

                // Apply status filter
                if (status) {
                    const hasActiveBooks = await this.checkStudentHasActiveBooks(studentId);
                    const hasOverdueBooks = await this.checkStudentHasOverdueBooks(studentId);

                    switch (status) {
                        case 'hasBooks':
                            if (!hasActiveBooks) showStudent = false;
                            break;
                        case 'noBooks':
                            if (hasActiveBooks) showStudent = false;
                            break;
                        case 'overdue':
                            if (!hasOverdueBooks) showStudent = false;
                            break;
                    }
                }

                // Apply search filter
                if (searchTerm) {
                    const searchableText = `${student.name} ${student.assessmentNo} ${student.grade}`.toLowerCase();
                    if (!searchableText.includes(searchTerm)) {
                        showStudent = false;
                    }
                }

                // Render student if they match all filters
                if (showStudent) {
                    this.renderStudentCard(student, studentId);
                }
            }
        } catch (error) {
            console.error('Error applying filters:', error);
            await this.showError('Filter Error', 'Failed to apply filters');
        }
    }

    async checkStudentHasActiveBooks(studentId) {
        const snapshot = await db.ref('issuance')
            .orderByChild('studentId')
            .equalTo(studentId)
            .once('value');
        
        let hasActive = false;
        snapshot.forEach(child => {
            if (child.val().status === 'active') {
                hasActive = true;
            }
        });
        return hasActive;
    }

    async checkStudentHasOverdueBooks(studentId) {
        const snapshot = await db.ref('issuance')
            .orderByChild('studentId')
            .equalTo(studentId)
            .once('value');
        
        const currentDate = new Date().getTime();
        let hasOverdue = false;
        
        snapshot.forEach(child => {
            const issuance = child.val();
            if (issuance.status === 'active' && new Date(issuance.returnDate).getTime() < currentDate) {
                hasOverdue = true;
            }
        });
        return hasOverdue;
    }

    async showStudentModal(studentId = null) {
        const modal = document.getElementById('studentModal');
        if (studentId) {
            const snapshot = await this.studentsRef.child(studentId).once('value');
            const studentData = snapshot.val();
            if (studentData) {
                document.getElementById('studentName').value = studentData.name || '';
                document.getElementById('assessmentNo').value = studentData.assessmentNo || '';
                document.getElementById('upi').value = studentData.upi || '';
                document.getElementById('grade').value = studentData.grade || '';
                this.studentForm.setAttribute('data-edit-id', studentId);
            }
        } else {
            this.studentForm.reset();
            this.studentForm.removeAttribute('data-edit-id');
        }
        modal.classList.add('active');
    }

    async handleStudentSubmit(e) {
        e.preventDefault();
        const studentData = {
            name: document.getElementById('studentName').value,
            assessmentNo: document.getElementById('assessmentNo').value,
            upi: document.getElementById('upi').value,
            grade: document.getElementById('grade').value,
            timestamp: Date.now()
        };

        const editId = this.studentForm.getAttribute('data-edit-id');
        if (editId) {
            await this.studentsRef.child(editId).update(studentData);
        } else {
            await this.studentsRef.push(studentData);
        }

        studentModal.classList.remove('active');
        this.studentForm.reset();
    }

    async updateStudentIssuanceStatus(studentId) {
        const issuanceSnapshot = await db.ref('issuance').orderByChild('studentId').equalTo(studentId).once('value');
        let activeIssuances = 0;
        
        issuanceSnapshot.forEach(childSnapshot => {
            const issuance = childSnapshot.val();
            if (issuance.status === 'active') {
                activeIssuances++;
            }
        });

        await this.studentsRef.child(studentId).update({
            activeIssuances: activeIssuances
        });
    }

    loadStudents() {
        this.studentsRef.on('value', async (snapshot) => {
            this.allStudents.clear();
            const promises = [];
            
            snapshot.forEach((childSnapshot) => {
                const student = childSnapshot.val();
                const studentId = childSnapshot.key;
                this.allStudents.set(studentId, student);
                promises.push(this.updateStudentIssuanceStatus(studentId));
            });
            
            await Promise.all(promises);
            this.applyFilters();
        });
    }

    renderStudentCard(student, studentId) {
        const card = document.createElement('div');
        card.className = 'student-card';
        card.innerHTML = `
        <div class="student-info">
                <div class="student-image-container"></div>

            <h3>👨‍⚕️${student.name}</h3>
            <p>Assessment No: ${student.assessmentNo || 'Not assigned'}</p>
            <p>Entry no: ${student.EntryNo|| 'Not assigned'}</p>
            <p>Home contact: ${student.FathersPhoneNumber|| 'Not assigned'}</p>
            <p>UPI No: ${student.upi || 'Not assigned'}</p>
            <p>Status: <span class="badge ${student.hasActiveBooks ? 'bg-primary' : 'bg-secondary'}">
                ${student.hasActiveBooks ? 'Has Active Books' : 'No Active Books'}
            </span></p>
            <div class="card-actions">
                <button onclick="studentManager.showStudentModal('${studentId}')">Edit</button>
                <button onclick="studentManager.deleteStudent('${studentId}')">Delete</button>
            </div>
             </div>
        `;
        
          // Add student image
    // const imageContainer = card.querySelector('.student-image-container');
    // const status = student.hasActiveBooks ? 'active' : 'inactive'; // Define status based on active books
    // StudentImageManager.renderStudentImage(studentId, imageContainer, status);

     // Add student image with grade as status
        const imageContainer = card.querySelector('.student-image-container');
        const status = student.grade ? `${student.grade.toLowerCase().replace(/\s+/g, ' -')}` : 'no-grade';
        StudentImageManager.renderStudentImage(studentId, imageContainer, status);

         // Add student image with gender as status
        // const imageContainer = card.querySelector('.student-image-container');
        // const status = student.gender ? `gender-${student.gender.toLowerCase().replace(/\s+/g, '-')}` : 'no-gender';
        // StudentImageManager.renderStudentImage(studentId, imageContainer, status);

        this.studentsList.appendChild(card);
    }

    async deleteStudent(studentId) {
        if (confirm('Are you sure you want to delete this student?')) {
            await this.studentsRef.child(studentId).remove();
        }
    }
}

// Issuance Management
class IssuanceManager {
    constructor() {
        this.issuanceRef = db.ref('issuance');
        this.issuanceList = document.getElementById('issuanceList');
        this.issuanceForm = document.getElementById('issuanceForm');
        this.statusFilter = document.getElementById('issuanceStatusFilter');
        this.allIssuances = new Map();
        this.gradeSelect = document.getElementById('issuanceGrade');
        this.studentSelect = document.getElementById('issuanceStudent');
        if (this.gradeSelect) {
            this.gradeSelect.addEventListener('change', () => this.populateStudentsByGrade());
        }
        this.setupListeners();
        this.loadIssuances();
    }

    setupListeners() {
        if (this.statusFilter) {
            this.statusFilter.addEventListener('change', () => this.applyFilters());
        }
        newIssuanceBtn.addEventListener('click', () => this.showIssuanceModal());
        this.issuanceForm.addEventListener('submit', (e) => this.handleIssuanceSubmit(e));
        
        if (searchInput) {
            searchInput.addEventListener('input', () => this.handleSearch());
        }

        // Add delete all button listener
        const deleteAllIssuancesBtn = document.getElementById('deleteAllIssuancesBtn');
        if (deleteAllIssuancesBtn) {
            deleteAllIssuancesBtn.addEventListener('click', () => this.deleteAllIssuances());
        }
    }

    handleSearch() {
        const activePage = document.querySelector('.page.active').id;
        if (activePage === 'issuance') {
            this.applyFilters();
        }
    }

    async applyFilters() {
        const status = this.statusFilter.value;
        const searchTerm = searchInput.value.toLowerCase();
        const currentDate = new Date();

        this.issuanceList.innerHTML = '';

        for (const [issuanceId, issuance] of this.allIssuances) {
            let showIssuance = true;

            try {
                const studentSnapshot = await db.ref(`students/${issuance.studentId}`).once('value');
                const bookSnapshot = await db.ref(`books/${issuance.bookId}`).once('value');
                const student = studentSnapshot.val();
                const book = bookSnapshot.val();

                if (status) {
                    const returnDate = new Date(issuance.returnDate);
                    const isOverdue = returnDate < currentDate && issuance.status === 'active';

                    switch (status) {
                        case 'active':
                            showIssuance = issuance.status === 'active' && !isOverdue;
                            break;
                        case 'returned':
                            showIssuance = issuance.status === 'returned';
                            break;
                        case 'overdue':
                            showIssuance = isOverdue;
                            break;
                        case 'lost':
                            showIssuance = issuance.status === 'lost';
                            break;
                    }
                }

                if (searchTerm && showIssuance) {
                    const searchableText = `${student?.name || ''} ${student?.assessmentNo || ''} ${book?.title || ''}`.toLowerCase();
                    if (!searchableText.includes(searchTerm)) {
                        showIssuance = false;
                    }
                }

                if (showIssuance) {
                    await this.renderIssuanceCard(issuance, issuanceId);
                }

            } catch (error) {
                console.error('Error filtering issuance:', error);
            }
        }
    }

    async showIssuanceModal() {
        const modal = document.getElementById('issuanceModal');
        
        // Reset selections
        this.gradeSelect.value = '';
        await this.populateStudentSelect();
        await this.populateBookSelect();
        
        const today = new Date().toISOString().split('T')[0];
        const returnDate = new Date();
        returnDate.setDate(returnDate.getDate() + 14);
        
        document.getElementById('issueDate').value = today;
        document.getElementById('returnDate').value = returnDate.toISOString().split('T')[0];
        
        modal.classList.add('active');
    }

    async populateStudentSelect() {
        const select = document.getElementById('issuanceStudent');
        select.innerHTML = '<option value="">Select Student</option>';
        select.disabled = true;
    }

    async populateStudentsByGrade() {
        const grade = this.gradeSelect.value;
        this.studentSelect.innerHTML = '<option value="">Select Student</option>';
        
        if (!grade) {
            this.studentSelect.disabled = true;
            return;
        }

        try {
            const snapshot = await db.ref('students')
                .orderByChild('grade')
                .equalTo(grade)
                .once('value');

            if (snapshot.exists()) {
                snapshot.forEach((childSnapshot) => {
                    const student = childSnapshot.val();
                    const option = document.createElement('option');
                    option.value = childSnapshot.key;
                    option.textContent = `${student.name} (${student.assessmentNo || 'No Assessment No'})`;
                    this.studentSelect.appendChild(option);
                });
                this.studentSelect.disabled = false;
            } else {
                this.studentSelect.innerHTML = '<option value="">No students in this grade</option>';
                this.studentSelect.disabled = true;
            }
        } catch (error) {
            console.error('Error loading students:', error);
            this.studentSelect.innerHTML = '<option value="">Error loading students</option>';
            this.studentSelect.disabled = true;
        }
    }

    async populateBookSelect() {
        const select = document.getElementById('issuanceBook');
        select.innerHTML = '<option value="">Select Book</option>';
        const snapshot = await db.ref('books').once('value');
        snapshot.forEach((childSnapshot) => {
            const book = childSnapshot.val();
            if (book.available > 0) {
                const option = document.createElement('option');
                option.value = childSnapshot.key;
                option.textContent = `${book.title} (${book.available} available)`;
                select.appendChild(option);
            }
        });
    }

    async handleIssuanceSubmit(e) {
        e.preventDefault();
        try {
            const modalElement = document.getElementById('issuanceModal');
            
            const studentId = document.getElementById('issuanceStudent').value;
            const bookId = document.getElementById('issuanceBook').value;
            const issueDate = document.getElementById('issueDate').value;
            const returnDate = document.getElementById('returnDate').value;

            if (!studentId || !bookId || !issueDate || !returnDate) {
                throw new Error('Please fill in all required fields');
            }

            // Get student and book details
            const [studentSnapshot, bookSnapshot] = await Promise.all([
                db.ref(`students/${studentId}`).once('value'),
                db.ref(`books/${bookId}`).once('value')
            ]);

            const student = studentSnapshot.val();
            const book = bookSnapshot.val();

            if (!student || !book) {
                throw new Error('Invalid student or book selection');
            }

            if (book.available <= 0) {
                throw new Error('Book is not available for issuance');
            }

            // Create issuance record
            const issuanceData = {
                studentId,
                studentName: student.name,
                grade: student.grade,
                upi: student.upi,
                bookId,
                bookTitle: book.title,
                issueDate,
                returnDate,
                status: 'active',
                timestamp: Date.now()
            };

            // Create new issuance and update records
            await Promise.all([
                this.issuanceRef.push(issuanceData),
                db.ref().update({
                    [`books/${bookId}/available`]: book.available - 1,
                    [`books/${bookId}/updatedAt`]: Date.now()
                }),
                db.ref('activities').push({
                    type: 'issue',
                    bookId,
                    studentId,
                    description: `Issued "${book.title}" to ${student.name}`,
                    timestamp: Date.now()
                })
            ]);

            // Close modal and reset form
            modalElement.classList.remove('active');
            this.issuanceForm.reset();

            // Show success message
            await Swal.fire({
                icon: 'success',
                title: 'Success',
                text: 'Book issued successfully',
                timer: 1500,
                showConfirmButton: false
            });

            // Refresh UI
            await this.loadIssuances();
            if (window.dashboardManager) {
                window.dashboardManager.updateAllStats();
            }

        } catch (error) {
            console.error('Error issuing book:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: error.message || 'Failed to issue book'
            });
        }
    }

    loadIssuances() {
        this.issuanceRef.on('value', (snapshot) => {
            this.allIssuances.clear();
            snapshot.forEach((childSnapshot) => {
                const issuance = childSnapshot.val();
                const issuanceId = childSnapshot.key;
                this.allIssuances.set(issuanceId, issuance);
            });
            this.applyFilters();
        });
    }

    // async renderIssuanceCard(issuance, issuanceId) {
    //     try {
    //         const studentSnapshot = await db.ref(`students/${issuance.studentId}`).once('value');
    //         const bookSnapshot = await db.ref(`books/${issuance.bookId}`).once('value');
    //         const student = studentSnapshot.val();
    //         const book = bookSnapshot.val();

    //         if (!student || !book) return;

    //         const currentDate = new Date();
    //         const returnDate = new Date(issuance.returnDate);
    //         const isOverdue = returnDate < currentDate && issuance.status === 'active';
    //         const displayStatus = isOverdue ? 'overdue' : issuance.status;

    //         const card = document.createElement('div');
    //         card.className = 'grid-item issuance-card';
    //         card.innerHTML = `
    //             <div class="book-cover-container"></div>
    //             <div class="issuance-info">
    //                 <h3>${student.name}</h3>
    //                 <h4>${book.title}</h4>
    //                 <h4>${student.assessmentNo}</h4>
    //                 <h5>Book No: ${issuance.isbn}</h5>
    //                 <p>Grade: ${student.grade || 'Not assigned'}</p>
    //                 <p>Issue Date: ${issuance.issueDate}</p>
    //                 <p>Return Date: ${issuance.returnDate}</p>
    //                 <p class="status ${displayStatus}">Status: ${displayStatus}</p>
    //                 ${issuance.status === 'active' ? `
    //                     <div class="button-group">
    //                         <button onclick="issuanceManager.returnBook('${issuanceId}', '${issuance.bookId}')" class="primary-btn">Return Book</button>
    //                         <button onclick="issuanceManager.reportBookLost('${issuanceId}', '${issuance.bookId}')" class="btn-warning">Report Lost</button>
    //                     </div>
    //                 ` : ''}
    //              <button onclick="issuanceManager.deleteIssuance('${issuanceId}', '${issuance.bookId}')" class="btn-danger">
    //                     <i class="bi bi-trash"></i> Delete Record
    //                 </button>
    //         `;

            
    //         // Add book cover
    //         const coverContainer = card.querySelector('.book-cover-container');
    //         BookCoverManager.renderBookCover(issuance.bookId, coverContainer);

    //         this.issuanceList.appendChild(card);
    //     } catch (error) {
    //         console.error('Error rendering issuance card:', error);
    //     }
    // }
    async renderIssuanceCard(issuance, issuanceId) {
        try {
            const studentSnapshot = await db.ref(`students/${issuance.studentId}`).once('value');
            const bookSnapshot = await db.ref(`books/${issuance.bookId}`).once('value');
            const student = studentSnapshot.val();
            const book = bookSnapshot.val();

            if (!student || !book) return;

            const currentDate = new Date();
            const returnDate = new Date(issuance.returnDate);
            const isOverdue = returnDate < currentDate && issuance.status === 'active';
            const displayStatus = isOverdue ? 'overdue' : issuance.status;

            const card = document.createElement('div');
            card.className = 'grid-item issuance-card';
            card.innerHTML = `
            <div class="issuance-card-content">
                <div class="student-image-container"></div>
                <div class="book-cover-container"></div>
                </div>
                <div class="issuance-info">
                    <h3>${student.name}</h3>
                    <h4>${book.title}</h4>
                    <h4>${student.assessmentNo}</h4>
                    <h5>Book No: ${issuance.isbn}</h5>
                    <p>Grade: ${student.grade || 'Not assigned'}</p>
                    <p>Issue Date: ${issuance.issueDate}</p>
                    <p>Return Date: ${issuance.returnDate}</p>
                    <p class="status ${displayStatus}">Status: ${displayStatus}</p>
                    ${issuance.status === 'active' ? `
                        <div class="button-group">
                            <button onclick="issuanceManager.returnBook('${issuanceId}', '${issuance.bookId}')" class="primary-btn">Return Book</button>
                            <button onclick="issuanceManager.reportBookLost('${issuanceId}', '${issuance.bookId}')" class="btn-warning">Report Lost</button>
                        </div>
                    ` : ''}
                    <button onclick="issuanceManager.deleteIssuance('${issuanceId}', '${issuance.bookId}')" class="btn-danger">
                        <i class="bi bi-trash"></i> Delete Record
                    </button>
                </div>
            `;

            // Add student image
            const imageContainer = card.querySelector('.student-image-container');
            StudentImageManager.renderStudentImage(issuance.studentId, imageContainer, displayStatus);

            // Add book cover
            const coverContainer = card.querySelector('.book-cover-container');
            BookCoverManager.renderBookCover(issuance.bookId, coverContainer, displayStatus);

            this.issuanceList.appendChild(card);
        } catch (error) {
            console.error('Error rendering issuance card:', error);
        }
    }
    
    async deleteIssuance(issuanceId, bookId) {
        try {
            const result = await Swal.fire({
                title: 'Delete Issuance Record',
                text: 'Are you sure you want to permanently delete this issuance record? This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete it!',
                cancelButtonText: 'Cancel'
            });

            if (result.isConfirmed) {
                // Get the issuance record first
                const issuanceSnapshot = await this.issuanceRef.child(issuanceId).once('value');
                const issuance = issuanceSnapshot.val();

                if (!issuance) {
                    throw new Error('Issuance record not found');
                }

                // Delete the issuance record
                await this.issuanceRef.child(issuanceId).remove();

                // If the status was 'active', update the book availability
                if (issuance.status === 'active') {
                    const bookRef = db.ref(`books/${bookId}`);
                    const bookSnapshot = await bookRef.once('value');
                    const book = bookSnapshot.val();

                    if (book) {
                        await bookRef.update({
                            available: book.available + 1,
                            updatedAt: Date.now()
                        });
                    }
                }

                await Swal.fire({
                    icon: 'warning',
                    title: 'Deleted!',
                    text: 'The issuance record has been deleted.',
                    timer: 1000,
                    showConfirmButton: false
                });

                // Refresh the issuance list
                this.loadIssuances();
            }
        } catch (error) {
            console.error('Error deleting issuance:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to delete issuance record. Please try again.',
                timer: 1000,
                showConfirmButton: false
            });
        }
    }

    async reportBookLost(issuanceId, bookId) {
        if (confirm('Are you sure you want to report this book as lost?')) {
            await this.issuanceRef.child(issuanceId).update({ status: 'lost' });

            const bookRef = db.ref(`books/${bookId}`);
            const bookSnapshot = await bookRef.once('value');
            const book = bookSnapshot.val();
            await bookRef.update({ 
                lost: (book.lost || 0) + 1
            });
        }
    }

    async returnBook(issuanceId, bookId) {
        if (confirm('Are you sure you want to mark this book as returned?')) {
            try {
                const issuanceRef = db.ref(`issuance/${issuanceId}`);
                const issuanceSnapshot = await issuanceRef.once('value');
                const issuance = issuanceSnapshot.val();

                if (!issuance) {
                    throw new Error('Issuance record not found');
                }

                await issuanceRef.update({
                    status: 'returned',
                    returnedDate: new Date().toISOString(),
                    updatedAt: Date.now()
                });

                const bookRef = db.ref(`books/${bookId}`);
                const bookSnapshot = await bookRef.once('value');
                const book = bookSnapshot.val();

                if (book) {
                    await bookRef.update({
                        available: book.available + 1,
                        updatedAt: Date.now()
                    });
                }

                if (issuance.studentId) {
                    await studentManager.updateStudentIssuanceStatus(issuance.studentId);
                }

                alert('Book returned successfully!');
                this.loadIssuances();
            } catch (error) {
                console.error('Error returning book:', error);
                alert('Error returning book. Please try again.');
            }
        }
    }

    async renderLostBookCard(issuance, issuanceId) {
        try {
            const studentSnapshot = await db.ref(`students/${issuance.studentId}`).once('value');
            const bookSnapshot = await db.ref(`books/${issuance.bookId}`).once('value');
            const student = studentSnapshot.val();
            const book = bookSnapshot.val();

            if (!student || !book) return;

            const card = document.createElement('div');
            card.className = 'grid-item lost-book-card';
            card.innerHTML = `
                <h3>Student: ${student.name} (${student.grade})</h3>
                <h4>Book: ${book.title}</h4>
                <p>Issue Date: ${issuance.issueDate}</p>
                <p>Reported Lost: ${new Date(issuance.lostDate || issuance.timestamp).toLocaleDateString()}</p>
                <p class="recovery-status ${issuance.recoveryStatus ? 'recovered' : 'pending'}">
                    ${issuance.recoveryStatus ? 'Recovered' : 'Recovery Pending'}
                </p>
                ${!issuance.recoveryStatus ? `
                    <div class="button-group">
                        <button onclick="issuanceManager.showRecoveryModal('${issuanceId}')" class="primary-btn">
                            Record Recovery
                        </button>
                    </div>
                ` : ''}
            `;
            this.issuanceList.appendChild(card);
        } catch (error) {
            console.error('Error rendering lost book card:', error);
        }
    }

    async showRecoveryModal(issuanceId) {
        const issuance = this.allIssuances.get(issuanceId);
        if (!issuance) return;

        const student = (await db.ref(`students/${issuance.studentId}`).once('value')).val();
        const book = (await db.ref(`books/${issuance.bookId}`).once('value')).val();

        document.getElementById('lostBookStudent').textContent = student.name;
        document.getElementById('lostBookTitle').textContent = book.title;
        document.getElementById('lostBookIssueDate').textContent = issuance.issueDate;

        const modal = document.getElementById('lostBookModal');
        const form = document.getElementById('lostBookForm');

        form.onsubmit = async (e) => {
            e.preventDefault();
            const recoveryMethod = document.getElementById('recoveryMethod').value;
            const recoveryNotes = document.getElementById('recoveryNotes').value;

            await this.handleBookRecovery(issuanceId, recoveryMethod, recoveryNotes);
            modal.classList.remove('active');
            form.reset();
        };

        modal.classList.add('active');
    }

    async handleBookRecovery(issuanceId, recoveryMethod, notes) {
        const issuance = this.allIssuances.get(issuanceId);
        if (!issuance) return;

        const updates = {
            recoveryStatus: true,
            recoveryMethod,
            recoveryNotes: notes,
            recoveryDate: new Date().toISOString()
        };

        await this.issuanceRef.child(issuanceId).update(updates);

        if (recoveryMethod === 'found' || recoveryMethod === 'replaced') {
            const bookRef = db.ref(`books/${issuance.bookId}`);
            const bookSnapshot = await bookRef.once('value');
            const book = bookSnapshot.val();
            await bookRef.update({
                available: book.available + 1,
                lost: book.lost - 1
            });
        }
    }

    async deleteAllIssuances() {
        try {
            const result = await Swal.fire({
                title: 'Delete All Issuance Records',
                text: 'Are you sure you want to delete ALL issuance records? This action cannot be undone!',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonText: 'Cancel',
                confirmButtonText: 'Yes, delete all!',
                showLoaderOnConfirm: true,
                preConfirm: async () => {
                    // Get all active issuances to update book availability
                    const activeIssuances = await this.issuanceRef
                        .orderByChild('status')
                        .equalTo('active')
                        .once('value');

                    const updates = {};
                    
                    if (activeIssuances.exists()) {
                        const bookUpdates = new Map();
                        
                        // Collect all books that need updating
                        activeIssuances.forEach(snapshot => {
                            const issuance = snapshot.val();
                            const count = bookUpdates.get(issuance.bookId) || 0;
                            bookUpdates.set(issuance.bookId, count + 1);
                        });

                        // Get current book data and calculate updates
                        for (const [bookId, count] of bookUpdates) {
                            const bookSnapshot = await db.ref(`books/${bookId}`).once('value');
                            const book = bookSnapshot.val();
                            
                            if (book) {
                                updates[`books/${bookId}/available`] = book.available + count;
                                updates[`books/${bookId}/updatedAt`] = Date.now();
                            }
                        }
                    }

                    // Delete all issuance records
                    updates['issuance'] = null;

                    // Perform all updates in a single transaction
                    await db.ref().update(updates);

                    return true;
                }
            });

            if (result.isConfirmed) {
                await Swal.fire({
                    icon: 'success',
                    title: 'Deleted!',
                    text: 'All issuance records have been deleted.',
                    timer: 2000,
                    showConfirmButton: false
                });

                // Update dashboard stats
                if (window.dashboardManager) {
                    window.dashboardManager.updateAllStats();
                }

                // Clear the issuance list
                this.issuanceList.innerHTML = '';
            }
        } catch (error) {
            console.error('Error deleting all issuances:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to delete all issuance records. Please try again.',
            });
        }
    }
}

// Reports Management
class ReportManager {
    constructor() {
        this.reportType = document.getElementById('reportType');
        this.startDate = document.getElementById('startDate');
        this.endDate = document.getElementById('endDate');
        this.generateReportBtn = document.getElementById('generateReportBtn');
        this.exportReportBtn = document.getElementById('exportReportBtn');
        this.reportContent = document.getElementById('reportContent');
        this.reportStats = document.getElementById('reportStats');
        this.reportTable = document.getElementById('reportTable');
        this.setupListeners();
        this.initializeDates();
    }

    initializeDates() {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);
        
        this.endDate.value = end.toISOString().split('T')[0];
        this.startDate.value = start.toISOString().split('T')[0];
    }

    setupListeners() {
        this.generateReportBtn.addEventListener('click', () => this.generateReport());
        this.exportReportBtn.addEventListener('click', () => this.exportToCSV());
        this.reportType.addEventListener('change', () => this.generateReport());
        this.reportTable.addEventListener('input', (e) => {
            if (e.target.classList.contains('search-input')) {
                this.filterTable(e.target.value);
            }
        });
        this.reportTable.addEventListener('change', (e) => {
            if (e.target.classList.contains('sort-select')) {
                this.sortTable(e.target.value);
            } else if (e.target.classList.contains('grade-filter')) {
                this.filterByGrade(e.target.value);
                this.togglePrintSelectedGradeButton(e.target.value);
            } else if (e.target.classList.contains('status-filter')) {
                this.filterByStatus(e.target.value);
            }
        });
        // Add click listener for return buttons
        this.reportTable.addEventListener('click', (e) => {
            if (e.target.classList.contains('return-btn')) {
                const issuanceId = e.target.dataset.issuanceId;
                const bookId = e.target.dataset.bookId;
                this.handleBookReturn(issuanceId, bookId);
            }
        });
    }

    async handleBookReturn(issuanceId, bookId) {
        if (!confirm('Are you sure you want to return this book?')) return;

        try {
            // Get issuance details
            const issuanceSnapshot = await db.ref(`issuance/${issuanceId}`).once('value');
            const issuance = issuanceSnapshot.val();

            // Update issuance status
            await db.ref(`issuance/${issuanceId}`).update({
                status: 'returned',
                returnedAt: Date.now()
            });

            // Update book availability
            const bookRef = db.ref(`books/${bookId}`);
            const bookSnapshot = await bookRef.once('value');
            const book = bookSnapshot.val();
            
            await bookRef.update({
                available: book.available + 1,
                updatedAt: Date.now()
            });

            alert('Book returned successfully');
            // Refresh the current report
            await this.generateReport();
        } catch (error) {
            console.error('Error returning book:', error);
            alert('Failed to return book');
        }
    }

    togglePrintSelectedGradeButton(selectedGrade) {
        const existingPrintGradeBtn = document.getElementById('printGradeReportBtn');
        if (existingPrintGradeBtn) {
            existingPrintGradeBtn.remove();
        }

        if (selectedGrade !== 'all' && this.reportType.value !== 'bookStatus') {
            this.reportContent.insertAdjacentHTML('beforeend', 
                `<button id="printGradeReportBtn" class="print-grade-btn">Print ${selectedGrade} Report</button>`
            );
            document.getElementById('printGradeReportBtn').addEventListener('click', () => this.printReport(selectedGrade));
        }
    }

    filterTable(searchTerm) {
        const table = this.reportTable.querySelector('table');
        if (!table) return;

        const rows = table.querySelectorAll('tbody tr');
        searchTerm = searchTerm.toLowerCase();

        rows.forEach(row => {
            const text = Array.from(row.cells)
                .map(cell => cell.textContent.toLowerCase())
                .join(' ');
            const gradeFilter = this.reportTable.querySelector('.grade-filter')?.value || 'all';
            const statusFilter = this.reportTable.querySelector('.status-filter')?.value || 'all';
            const gradeColIndex = Array.from(table.querySelector('thead tr').children)
                .findIndex(th => th.textContent.trim() === 'Grade');
            const statusColIndex = Array.from(table.querySelector('thead tr').children)
                .findIndex(th => th.textContent.trim() === 'Status');
            const gradeCell = gradeColIndex !== -1 ? row.cells[gradeColIndex]?.textContent.trim() : null;
            const statusCell = statusColIndex !== -1 ? row.cells[statusColIndex]?.textContent.trim() : null;
            
            const matchesSearch = text.includes(searchTerm);
            const matchesGrade = gradeFilter === 'all' || !gradeCell || gradeCell === gradeFilter;
            const matchesStatus = statusFilter === 'all' || !statusCell || statusCell === statusFilter;
            row.style.display = matchesSearch && matchesGrade && matchesStatus ? '' : 'none';
        });
    }

    filterByGrade(grade) {
        const table = this.reportTable.querySelector('table');
        if (!table) return;

        const rows = table.querySelectorAll('tbody tr');
        const gradeColIndex = Array.from(table.querySelector('thead tr').children)
            .findIndex(th => th.textContent.trim() === 'Grade');

        if (gradeColIndex === -1) return;

        rows.forEach(row => {
            const rowGrade = row.cells[gradeColIndex].textContent.trim();
            const searchInput = this.reportTable.querySelector('.search-input')?.value.toLowerCase() || '';
            const statusFilter = this.reportTable.querySelector('.status-filter')?.value || 'all';
            const statusColIndex = Array.from(table.querySelector('thead tr').children)
                .findIndex(th => th.textContent.trim() === 'Status');
            const rowStatus = statusColIndex !== -1 ? row.cells[statusColIndex]?.textContent.trim() : null;
            const rowText = Array.from(row.cells)
                .map(cell => cell.textContent.toLowerCase())
                .join(' ');

            const matchesGrade = grade === 'all' || rowGrade === grade;
            const matchesSearch = rowText.includes(searchInput);
            const matchesStatus = statusFilter === 'all' || !rowStatus || rowStatus === statusFilter;
            row.style.display = matchesGrade && matchesSearch && matchesStatus ? '' : 'none';
        });
    }

    filterByStatus(status) {
        const table = this.reportTable.querySelector('table');
        if (!table) return;

        const rows = table.querySelectorAll('tbody tr');
        const statusColIndex = Array.from(table.querySelector('thead tr').children)
            .findIndex(th => th.textContent.trim() === 'Status');

        if (statusColIndex === -1) return;

        rows.forEach(row => {
            const rowStatus = row.cells[statusColIndex].textContent.trim();
            const searchInput = this.reportTable.querySelector('.search-input')?.value.toLowerCase() || '';
            const gradeFilter = this.reportTable.querySelector('.grade-filter')?.value || 'all';
            const gradeColIndex = Array.from(table.querySelector('thead tr').children)
                .findIndex(th => th.textContent.trim() === 'Grade');
            const rowGrade = gradeColIndex !== -1 ? row.cells[gradeColIndex]?.textContent.trim() : null;
            const rowText = Array.from(row.cells)
                .map(cell => cell.textContent.toLowerCase())
                .join(' ');

            const matchesStatus = status === 'all' || rowStatus === status;
            const matchesSearch = rowText.includes(searchInput);
            const matchesGrade = gradeFilter === 'all' || !rowGrade || rowGrade === gradeFilter;
            row.style.display = matchesStatus && matchesSearch && matchesGrade ? '' : 'none';
        });
    }

    sortTable(sortValue) {
        const table = this.reportTable.querySelector('table');
        if (!table) return;

        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const gradeColIndex = Array.from(table.querySelector('thead tr').children)
            .findIndex(th => th.textContent.trim() === 'Grade');

        if (gradeColIndex === -1) return;

        const direction = sortValue === 'grade-asc' ? 1 : -1;

        rows.sort((a, b) => {
            const aValue = a.cells[gradeColIndex].textContent.trim();
            const bValue = b.cells[gradeColIndex].textContent.trim();
            return direction * aValue.localeCompare(bValue, undefined, { numeric: true });
        });

        // Reassign sequential numbers after sorting
        rows.forEach((row, index) => {
            const numberCell = row.cells[0];
            if (numberCell && numberCell.classList.contains('number-cell')) {
                numberCell.textContent = index + 1;
            }
        });

        tbody.innerHTML = '';
        rows.forEach(row => tbody.appendChild(row));
    }

    printReport(selectedGrade = null) {
        const reportTitle = this.reportType.options[this.reportType.selectedIndex].text;
        const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        let tableContent = this.reportTable.querySelector('table').cloneNode(true);
        let statsContent = this.reportStats.innerHTML;

        if (selectedGrade && selectedGrade !== 'all') {
            const gradeColIndex = Array.from(tableContent.querySelector('thead tr').children)
                .findIndex(th => th.textContent.trim() === 'Grade');
            
            if (gradeColIndex !== -1) {
                // Filter table rows
                const tbody = tableContent.querySelector('tbody');
                const rows = Array.from(tbody.querySelectorAll('tr'));
                const filteredRows = rows.filter(row => 
                    row.cells[gradeColIndex].textContent.trim() === selectedGrade
                );

                // Reassign sequential numbers for filtered rows
                filteredRows.forEach((row, index) => {
                    const numberCell = row.cells[0];
                    if (numberCell && numberCell.classList.contains('number-cell')) {
                        numberCell.textContent = index + 1;
                    }
                });

                tbody.innerHTML = '';
                filteredRows.forEach(row => tbody.appendChild(row));

                // Recalculate totals and averages for filtered data
                const tfoot = tableContent.querySelector('tfoot');
                if (tfoot) {
                    const totalsRow = tfoot.querySelector('.totals-row');
                    const averagesRow = tfoot.querySelector('.averages-row');
                    if (this.reportType.value === 'studentActivity') {
                        let totalBooks = 0, totalActive = 0, totalReturned = 0, totalLost = 0;
                        filteredRows.forEach(row => {
                            totalBooks += parseInt(row.cells[3].textContent) || 0;
                            totalActive += parseInt(row.cells[4].textContent) || 0;
                            totalReturned += parseInt(row.cells[5].textContent) || 0;
                            totalLost += parseInt(row.cells[6].textContent) || 0;
                        });
                        const rowCount = filteredRows.length;
                        totalsRow.innerHTML = `
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>${totalBooks}</td>
                            <td>${totalActive}</td>
                            <td>${totalReturned}</td>
                            <td>${totalLost}</td>
                            <td>N/A</td>
                        `;
                        averagesRow.innerHTML = `
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>${rowCount ? (totalBooks / rowCount).toFixed(2) : 0}</td>
                            <td>${rowCount ? (totalActive / rowCount).toFixed(2) : 0}</td>
                            <td>${rowCount ? (totalReturned / rowCount).toFixed(2) : 0}</td>
                            <td>${rowCount ? (totalLost / rowCount).toFixed(2) : 0}</td>
                            <td>N/A</td>
                        `;
                    } else if (this.reportType.value === 'overdueBooks') {
                        let totalDaysOverdue = 0;
                        filteredRows.forEach(row => {
                            totalDaysOverdue += parseInt(row.cells[7].textContent) || 0;
                        });
                        const rowCount = filteredRows.length;
                        totalsRow.innerHTML = `
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>${totalDaysOverdue} days</td>
                            <td>N/A</td>
                        `;
                        averagesRow.innerHTML = `
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>${rowCount ? (totalDaysOverdue / rowCount).toFixed(2) : 0} days</td>
                            <td>N/A</td>
                        `;
                    } else if (this.reportType.value === 'issuanceHistory') {
                        const rowCount = filteredRows.length;
                        totalsRow.innerHTML = `
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>${rowCount} issuances</td>
                            <td>N/A</td>
                        `;
                        averagesRow.innerHTML = `
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                        `;
                    } else if (this.reportType.value === 'lostBooks') {
                        totalsRow.innerHTML = `
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                        `;
                        averagesRow.innerHTML = `
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                            <td>N/A</td>
                        `;
                    }
                }

                // Update stats for selected grade
                if (this.reportType.value === 'studentActivity') {
                    const totalStudents = filteredRows.length;
                    const totalIssuances = filteredRows.reduce((sum, row) => sum + (parseInt(row.cells[3].textContent) || 0), 0);
                    const totalLost = filteredRows.reduce((sum, row) => sum + (parseInt(row.cells[6].textContent) || 0), 0);
                    statsContent = `
                        <div class="stat-card">
                            <div class="stat-info">
                                <h3>Active Students</h3>
                                <p>${totalStudents}</p>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-info">
                                <h3>Total Issuances</h3>
                                <p>${totalIssuances}</p>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-info warning">
                                <h3>Total Lost</h3>
                                <p>${totalLost}</p>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-info">
                                <h3>Average Books per Student</h3>
                                <p>${totalStudents ? (totalIssuances / totalStudents).toFixed(2) : 0}</p>
                            </div>
                        </div>
                    `;
                } else if (this.reportType.value === 'overdueBooks') {
                    const totalOverdue = filteredRows.length;
                    const totalDaysOverdue = filteredRows.reduce((sum, row) => sum + (parseInt(row.cells[7].textContent) || 0), 0);
                    statsContent = `
                        <div class="stat-card">
                            <div class="stat-info">
                                <h3>Total Overdue</h3>
                                <p>${totalOverdue}</p>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-info">
                                <h3>Total Days Overdue</h3>
                                <p>${totalDaysOverdue}</p>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-info">
                                <h3>Average Days Overdue</h3>
                                <p>${totalOverdue ? (totalDaysOverdue / totalOverdue).toFixed(2) : 0}</p>
                            </div>
                        </div>
                    `;
                } else if (this.reportType.value === 'issuanceHistory') {
                    const totalIssuances = filteredRows.length;
                    const activeIssuances = filteredRows.filter(row => row.cells[7].textContent.trim() === 'active').length;
                    const returnedIssuances = filteredRows.filter(row => row.cells[7].textContent.trim() === 'returned').length;
                    const lostIssuances = filteredRows.filter(row => row.cells[7].textContent.trim() === 'lost').length;
                    statsContent = `
                        <div class="stat-card">
                            <div class="stat-info">
                                <h3>Total Issuances</h3>
                                <p>${totalIssuances}</p>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-info">
                                <h3>Active</h3>
                                <p>${activeIssuances}</p>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-info">
                                <h3>Returned</h3>
                                <p>${returnedIssuances}</p>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-info warning">
                                <h3>Lost</h3>
                                <p>${lostIssuances}</p>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-info">
                                <h3>Average Issuances per Student</h3>
                                <p>${totalIssuances ? (totalIssuances / [...new Set(filteredRows.map(row => row.cells[1].textContent.trim()))].length).toFixed(2) : 0}</p>
                            </div>
                        </div>
                    `;
                } else if (this.reportType.value === 'lostBooks') {
                    const totalLost = filteredRows.length;
                    statsContent = `
                        <div class="stat-card">
                            <div class="stat-info warning">
                                <h3>Total Lost Books</h3>
                                <p>${totalLost}</p>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-info">
                                <h3>Average Lost Books per Student</h3>
                                <p>${totalLost ? (totalLost / [...new Set(filteredRows.map(row => row.cells[1].textContent.trim()))].length).toFixed(2) : 0}</p>
                            </div>
                        </div>
                    `;
                }
            }
        }

        const printContent = `
            <div class="header">
                <img src="../images/logo.png" alt="Kanyadet Logo" class="logo">
                <h1>Kanyadet Primary and Junior Secondary</h1>
                <h2>${reportTitle}${selectedGrade && selectedGrade !== 'all' ? ` - Grade ${selectedGrade}` : ''}</h2>
                <p>Date: ${currentDate}</p>
            </div>
            <div>${statsContent}</div>
            <div>${tableContent.outerHTML}</div>
        `;
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Library Report</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; text-align: center; }
                        .header { margin-bottom: 30px; }
                        .logo { width: 100px; height: 100px; margin-bottom: 10px; }
                        h1 { font-size: 24px; margin: 10px 0; }
                        h2 { font-size: 20px; margin: 10px 0; }
                        p { font-size: 16px; margin: 5px 0; }
                        table { border-collapse: collapse; width: 100%; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #f2f2f2; }
                        .stat-card { display: inline-block; margin: 10px; padding: 10px; border: 1px solid #ddd; }
                        .warning { color: #ff4444; }
                        .search-input, .delete-btn, .sort-select, .grade-filter, .status-filter, .return-btn { display: none; }
                        tfoot td { font-weight: bold; }
                        .totals-row { background-color: #e8f4f8; }
                        .averages-row { background-color: #f0f8e8; }
                        .number-cell { text-align: center; }
                    </style>
                </head>
                <body>${printContent}</body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
    }

    async generateReport() {
        const type = this.reportType.value;
        const start = new Date(this.startDate.value);
        const end = new Date(this.endDate.value);

        // Remove existing print buttons
        const existingPrintBtn = document.getElementById('printReportBtn');
        if (existingPrintBtn) existingPrintBtn.remove();
        const existingPrintGradeBtn = document.getElementById('printGradeReportBtn');
        if (existingPrintGradeBtn) existingPrintGradeBtn.remove();

        switch(type) {
            case 'bookStatus':
                await this.generateBookStatusReport();
                break;
            case 'issuanceHistory':
                await this.generateIssuanceHistoryReport(start, end);
                break;
            case 'overdueBooks':
                await this.generateOverdueBooksReport();
                break;
            case 'studentActivity':
                await this.generateStudentActivityReport(start, end);
                break;
            case 'lostBooks':
                await this.generateLostBooksReport();
                break;
        }

        // Add print full report button
        this.reportContent.insertAdjacentHTML('beforeend', 
            '<button id="printReportBtn" class="print-btn">Print Full Report</button>'
        );
        document.getElementById('printReportBtn').addEventListener('click', () => this.printReport());

        // Add print selected grade button if applicable
        const gradeFilter = this.reportTable.querySelector('.grade-filter')?.value || 'all';
        this.togglePrintSelectedGradeButton(gradeFilter);
    }

    async generateBookStatusReport() {
        const snapshot = await db.ref('books').once('value');
        const books = snapshot.val();
        
        let totalBooks = 0;
        let availableBooks = 0;
        let issuedBooks = 0;
        let lostBooks = 0;
        let rowCount = 0;

        Object.values(books).forEach(book => {
            totalBooks += book.quantity;
            availableBooks += book.available;
            issuedBooks += (book.quantity - book.available - (book.lost || 0));
            lostBooks += (book.lost || 0);
            rowCount++;
        });

        this.reportStats.innerHTML = `
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Total Books</h3>
                    <p>${totalBooks}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Available</h3>
                    <p>${availableBooks}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Issued</h3>
                    <p>${issuedBooks}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info warning">
                    <h3>Lost</h3>
                    <p>${lostBooks}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Average Books per Title</h3>
                    <p>${rowCount ? (totalBooks / rowCount).toFixed(2) : 0}</p>
                </div>
            </div>
        `;

        const tableRows = Object.entries(books).map(([key, book]) => `
            <tr>
                <td>${book.title}</td>
                <td>${book.category}</td>
                <td>${book.quantity}</td>
                <td>${book.available}</td>
                <td>${book.quantity - book.available - (book.lost || 0)}</td>
                <td>${book.lost || 0}</td>
                <td>
                    <button onclick="deleteBook('${key}')" class="delete-btn"><i class="bi bi-trash"></i></button>
                </td>
            </tr>
        `).join('');

        const totalsRow = `
            <tr class="totals-row">
                <td><b>Total</b></td>
                <td></td>
                <td>${totalBooks}</td>
                <td>${availableBooks}</td>
                <td>${issuedBooks}</td>
                <td>${lostBooks}</td>
                <td></td>
            </tr>
        `;

        const averagesRow = `
            <tr class="averages-row">
                <td>Average</td>
                <td></td>
                <td>${rowCount ? (totalBooks / rowCount).toFixed(2) : 0}</td>
                <td>${rowCount ? (availableBooks / rowCount).toFixed(2) : 0}</td>
                <td>${rowCount ? (issuedBooks / rowCount).toFixed(2) : 0}</td>
                <td>${rowCount ? (lostBooks / rowCount).toFixed(2) : 0}</td>
                <td></td>
            </tr>
        `;

        this.reportTable.innerHTML = `
            <div class="table-wrapper">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Title <input type="text" class="search-input" placeholder="Search..."></th>
                            <th>Category</th>
                            <th>Total Books</th>
                            <th>Available</th>
                            <th>Issued</th>
                            <th>Lost</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                    <tfoot>${totalsRow}${averagesRow}</tfoot>
                </table>
            </div>
        `;

        window.deleteBook = async (bookId) => {
            if (confirm('Are you sure you want to delete this book record?')) {
                try {
                    await db.ref(`books/${bookId}`).remove();
                    alert('Book record deleted successfully');
                    this.generateBookStatusReport();
                } catch (error) {
                    console.error('Error deleting book:', error);
                    alert('Failed to delete book record');
                }
            }
        };
    }

    async generateIssuanceHistoryReport(start, end) {
        const snapshot = await db.ref('issuance').once('value');
        const issuances = snapshot.val();
        
        let filteredIssuances = Object.values(issuances).filter(issuance => {
            const issueDate = new Date(issuance.issueDate);
            return issueDate >= start && issueDate <= end;
        });

        const totalIssuances = filteredIssuances.length;
        const activeIssuances = filteredIssuances.filter(i => i.status === 'active').length;
        const returnedIssuances = filteredIssuances.filter(i => i.status === 'returned').length;
        const lostIssuances = filteredIssuances.filter(i => i.status === 'lost').length;

        this.reportStats.innerHTML = `
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Total Issuances</h3>
                    <p>${totalIssuances}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Active</h3>
                    <p>${activeIssuances}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Returned</h3>
                    <p>${returnedIssuances}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info warning">
                    <h3>Lost</h3>
                    <p>${lostIssuances}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Average Issuances per Student</h3>
                    <p>${totalIssuances ? (totalIssuances / [...new Set(filteredIssuances.map(i => i.studentId))].length).toFixed(2) : 0}</p>
                </div>
            </div>
        `;

        // Get unique grades
        const studentIds = [...new Set(filteredIssuances.map(issuance => issuance.studentId))];
        const grades = new Set();
        for (const studentId of studentIds) {
            const student = (await db.ref(`students/${studentId}`).once('value')).val();
            if (student?.grade) grades.add(student.grade);
        }
        const gradeOptions = [...grades].sort((a, b) => a.localeCompare(b, { numeric: true }));

        let tableRows = [];
        let rowNumber = 1;
        for (const [key, issuance] of Object.entries(issuances).filter(([_, iss]) => {
            const issueDate = new Date(iss.issueDate);
            return issueDate >= start && issueDate <= end;
        })) {
            const student = (await db.ref(`students/${issuance.studentId}`).once('value')).val();
            const book = (await db.ref(`books/${issuance.bookId}`).once('value')).val();
            tableRows.push(`
                <tr>
                    <td class="number-cell">${rowNumber++}</td>
                    <td>${student?.name || 'N/A'}</td>
                    <td>${student?.grade || 'N/A'}</td>
                    <td>${book?.title || 'N/A'}</td>
                    <td>${issuance.isbn || 'ENG-009'}</td>
                    <td>${issuance.issueDate}</td>
                    <td>${issuance.returnDate}</td>
                    <td class="${issuance.status === 'lost' ? 'warning' : ''}">${issuance.status}</td>
                    <td>
                        ${issuance.status === 'active' ? `
                            <button class="return-btn" data-issuance-id="${key}" data-book-id="${issuance.bookId}">Return</button>
                        ` : ''}
                        <button onclick="deleteIssuance('${key}')" class="delete-btn"><i class="bi bi-trash"></i></button>
                    </td>
                </tr>
            `);
        }

        const totalsRow = `
            <tr class="totals-row">
                <td><b>Total</b></td>
                <td><b>issuances</b></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td>${totalIssuances} issuances</td>
                <td></td>
            </tr>
        `;

        const averagesRow = `
            <tr class="averages-row">
                <td><b>Average</b></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
            </tr>
        `;

        this.reportTable.innerHTML = `
            <div class="table-wrapper">
                <div class="sort-container">
                    <label for="grade-filter">Filter by Grade: </label>
                    <select id="grade-filter" class="grade-filter">
                        <option value="all">All Grades</option>
                        ${gradeOptions.map(grade => `<option value="${grade}">${grade}</option>`).join('')}
                    </select>
                    <label for="status-filter">Filter by Status: </label>
                    <select id="status-filter" class="status-filter">
                        <option value="all">All Statuses</option>
                        <option value="active">Active</option>
                        <option value="returned">Returned</option>
                        <option value="lost">Lost</option>
                    </select>
                    <label for="sort-select">Sort by: </label>
                    <select id="sort-select" class="sort-select">
                        <option value="grade-asc">Grade (Ascending)</option>
                        <option value="grade-desc">Grade (Descending)</option>
                    </select>
                </div>
                <table class="table">
                    <thead>
                        <tr>
                            <th>No.</th>
                            <th>Student <input type="text" class="search-input" placeholder="Search..."></th>
                            <th>Grade</th>
                            <th>Book</th>
                            <th>Book No</th>
                            <th>Issue Date</th>
                            <th>Return Date</th>
                            <th>Status</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                    <tfoot>${totalsRow}${averagesRow}</tfoot>
                </table>
            </div>
        `;
        window.deleteIssuance = async (issuanceId) => {
            if (confirm('Are you sure you want to delete this issuance record?')) {
                try {
                    await db.ref(`issuance/${issuanceId}`).remove();
                    alert('Issuance record deleted successfully');
                    this.generateIssuanceHistoryReport(start, end);
                } catch (error) {
                    console.error('Error deleting issuance:', error);
                    alert('Failed to delete issuance record');
                }
            }
        };
    }

    async generateOverdueBooksReport() {
        const currentDate = new Date();
        const snapshot = await db.ref('issuance').once('value');
        const issuances = snapshot.val();
        
        let overdueIssuances = Object.values(issuances).filter(issuance => {
            const returnDate = new Date(issuance.returnDate);
            return issuance.status === 'active' && returnDate < currentDate;
        });

        const totalOverdue = overdueIssuances.length;
        let totalDaysOverdue = 0;
        overdueIssuances.forEach(issuance => {
            const daysOverdue = Math.floor((currentDate - new Date(issuance.returnDate)) / (1000 * 60 * 60 * 24));
            totalDaysOverdue += daysOverdue;
        });

        this.reportStats.innerHTML = `
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Total Overdue</h3>
                    <p>${totalOverdue}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Total Days Overdue</h3>
                    <p>${totalDaysOverdue}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Average Days Overdue</h3>
                    <p>${totalOverdue ? (totalDaysOverdue / totalOverdue).toFixed(2) : 0}</p>
                </div>
            </div>
        `;

        // Get unique grades
        const studentIds = [...new Set(overdueIssuances.map(issuance => issuance.studentId))];
        const grades = new Set();
        for (const studentId of studentIds) {
            const student = (await db.ref(`students/${studentId}`).once('value')).val();
            if (student?.grade) grades.add(student.grade);
        }
        const gradeOptions = [...grades].sort((a, b) => a.localeCompare(b, { numeric: true }));

        let tableRows = [];
        let rowNumber = 1;
        for (const [key, issuance] of Object.entries(issuances).filter(([_, iss]) => {
            const returnDate = new Date(iss.returnDate);
            return iss.status === 'active' && returnDate < currentDate;
        })) {
            const student = (await db.ref(`students/${issuance.studentId}`).once('value')).val();
            const book = (await db.ref(`books/${issuance.bookId}`).once('value')).val();
            const daysOverdue = Math.floor((currentDate - new Date(issuance.returnDate)) / (1000 * 60 * 60 * 24));
            tableRows.push(`
                <tr>
                    <td class="number-cell">${rowNumber++}</td>
                    <td>${student?.name || 'N/A'}</td>
                    <td>${student?.grade || 'N/A'}</td>
                    <td>${book?.title || 'N/A'}</td>
                    <td>${issuance.isbn || 'ENG-009'}</td>
                    <td>${issuance.issueDate}</td>
                    <td>${issuance.returnDate}</td>
                    <td>${daysOverdue} days</td>
                    <td>
                        <button class="return-btn" data-issuance-id="${key}" data-book-id="${issuance.bookId}">Return</button>
                        <button onclick="deleteOverdueIssuance('${key}')" class="delete-btn">Delete</button>
                    </td>
                </tr>
            `);
        }

        const totalsRow = `
            <tr class="totals-row">
                <td><b>Total</b></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td>${totalDaysOverdue} days</td>
                <td></td>
            </tr>
        `;

        const averagesRow = `
            <tr class="averages-row">
                <td><b>Average</b></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td>/td>
                <td></td>
                <td>${totalOverdue ? (totalDaysOverdue / totalOverdue).toFixed(2) : 0} days</td>
                <td></td>
            </tr>
        `;

        this.reportTable.innerHTML = `
            <div class="table-wrapper">
                <div class="sort-container">
                    <label for="grade-filter">Filter by Grade: </label>
                    <select id="grade-filter" class="grade-filter">
                        <option value="all">All Grades</option>
                        ${gradeOptions.map(grade => `<option value="${grade}">${grade}</option>`).join('')}
                    </select>
                    <label for="sort-select">Sort by: </label>
                    <select id="sort-select" class="sort-select">
                        <option value="grade-asc">Grade (Ascending)</option>
                        <option value="grade-desc">Grade (Descending)</option>
                    </select>
                </div>
                <table class="table">
                    <thead>
                        <tr>
                            <th>No.</th>
                            <th>Student <input type="text" class="search-input" placeholder="Search..."></th>
                            <th>Grade</th>
                            <th>Book</th>
                            <th>Book No</th>
                            <th>Issue Date</th>
                            <th>Due Date</th>
                            <th>Overdue By</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                    <tfoot>${totalsRow}${averagesRow}</tfoot>
                </table>
            </div>
        `;

        window.deleteOverdueIssuance = async (issuanceId) => {
            if (confirm('Are you sure you want to delete this overdue issuance record?')) {
                try {
                    await db.ref(`issuance/${issuanceId}`).remove();
                    alert('Overdue issuance record deleted successfully');
                    this.generateOverdueBooksReport();
                } catch (error) {
                    console.error('Error deleting overdue issuance:', error);
                    alert('Failed to delete overdue issuance record');
                }
            }
        };
    }

    async generateLostBooksReport() {
        const snapshot = await db.ref('issuance').once('value');
        const issuances = snapshot.val();
        
        let lostIssuances = Object.values(issuances).filter(issuance => 
            issuance.status === 'lost'
        );

        const totalLost = lostIssuances.length;

        this.reportStats.innerHTML = `
            <div class="stat-card">
                <div class="stat-info warning">
                    <h3>Total Lost Books</h3>
                    <p>${totalLost}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Average Lost Books per Student</h3>
                    <p>${totalLost ? (totalLost / [...new Set(lostIssuances.map(i => i.studentId))].length).toFixed(2) : 0}</p>
                </div>
            </div>
        `;

        // Get unique grades
        const studentIds = [...new Set(lostIssuances.map(issuance => issuance.studentId))];
        const grades = new Set();
        for (const studentId of studentIds) {
            const student = (await db.ref(`students/${studentId}`).once('value')).val();
            if (student?.grade) grades.add(student.grade);
        }
        const gradeOptions = [...grades].sort((a, b) => a.localeCompare(b, { numeric: true }));

        let tableRows = [];
        let rowNumber = 1;
        for (const [key, issuance] of Object.entries(issuances).filter(([_, iss]) => 
            iss.status === 'lost'
        )) {
            const student = (await db.ref(`students/${issuance.studentId}`).once('value')).val();
            const book = (await db.ref(`books/${issuance.bookId}`).once('value')).val();
            tableRows.push(`
                <tr>
                    <td class="number-cell">${rowNumber++}</td>
                    <td>${student?.name || 'N/A'}</td>
                    <td>${student?.grade || 'N/A'}</td>
                    <td>${book?.title || 'N/A'}</td>
                    <td>${issuance.isbn || 'ENG-009'}</td>
                    <td>${issuance.issueDate}</td>
                    <td>${issuance.returnDate}</td>
                    <td>
                        <button onclick="deleteLostIssuance('${key}')" class="delete-btn">Delete</button>
                    </td>
                </tr>
            `);
        }

        const totalsRow = `
            <tr class="totals-row">
               <td><b>Total</b></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
            </tr>
        `;

        const averagesRow = `
            <tr class="averages-row">
                <td><b>Average</b></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
            </tr>
        `;

        this.reportTable.innerHTML = `
            <div class="table-wrapper">
                <div class="sort-container">
                    <label for="grade-filter">Filter by Grade: </label>
                    <select id="grade-filter" class="grade-filter">
                        <option value="all">All Grades</option>
                        ${gradeOptions.map(grade => `<option value="${grade}">${grade}</option>`).join('')}
                    </select>
                    <label for="sort-select">Sort by: </label>
                    <select id="sort-select" class="sort-select">
                        <option value="grade-asc">Grade (Ascending)</option>
                        <option value="grade-desc">Grade (Descending)</option>
                    </select>
                </div>
                <table class="table">
                    <thead>
                        <tr>
                            <th>No.</th>
                            <th>Student <input type="text" class="search-input" placeholder="Search..."></th>
                            <th>Grade</th>
                            <th>Book</th>
                            <th>Book No</th>
                            <th>Issue Date</th>
                            <th>Return Date</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                    <tfoot>${totalsRow}${averagesRow}</tfoot>
                </table>
            </div>
        `;

        window.deleteLostIssuance = async (issuanceId) => {
            if (confirm('Are you sure you want to delete this lost book record?')) {
                try {
                    await db.ref(`issuance/${issuanceId}`).remove();
                    alert('Lost book record deleted successfully');
                    this.generateLostBooksReport();
                } catch (error) {
                    console.error('Error deleting lost issuance:', error);
                    alert('Failed to delete lost book record');
                }
            }
        };
    }

    async generateStudentActivityReport(start, end) {
        const issuanceSnapshot = await db.ref('issuance').once('value');
        const studentsSnapshot = await db.ref('students').once('value');
        
        const issuances = issuanceSnapshot.val();
        const students = studentsSnapshot.val();
        
        let studentActivity = {};
        
        Object.entries(issuances).forEach(([key, issuance]) => {
            const issueDate = new Date(issuance.issueDate);
            if (issueDate >= start && issueDate <= end) {
                if (!studentActivity[issuance.studentId]) {
                    studentActivity[issuance.studentId] = {
                        student: students[issuance.studentId],
                        totalBooks: 0,
                        active: 0,
                        returned: 0,
                        lost: 0,
                        issuanceIds: []
                    };
                }
                
                studentActivity[issuance.studentId].totalBooks++;
                studentActivity[issuance.studentId].issuanceIds.push(key);
                switch(issuance.status) {
                    case 'active':
                        studentActivity[issuance.studentId].active++;
                        break;
                    case 'returned':
                        studentActivity[issuance.studentId].returned++;
                        break;
                    case 'lost':
                        studentActivity[issuance.studentId].lost++;
                        break;
                }
            }
        });

        const totalStudents = Object.keys(studentActivity).length;
        const totalIssuances = Object.values(studentActivity).reduce((sum, curr) => sum + curr.totalBooks, 0);
        const totalActive = Object.values(studentActivity).reduce((sum, curr) => sum + curr.active, 0);
        const totalReturned = Object.values(studentActivity).reduce((sum, curr) => sum + curr.returned, 0);
        const totalLost = Object.values(studentActivity).reduce((sum, curr) => sum + curr.lost, 0);

        this.reportStats.innerHTML = `
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Active Students</h3>
                    <p>${totalStudents}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Total Issuances</h3>
                    <p>${totalIssuances}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info warning">
                    <h3>Total Lost</h3>
                    <p>${totalLost}</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info">
                    <h3>Average Books per Student</h3>
                    <p>${totalStudents ? (totalIssuances / totalStudents).toFixed(2) : 0}</p>
                </div>
            </div>
        `;

        // Get unique grades
        const grades = new Set(Object.values(studentActivity).map(data => data.student.grade).filter(Boolean));
        const gradeOptions = [...grades].sort((a, b) => a.localeCompare(b, { numeric: true }));

        let tableRows = [];
        let rowNumber = 1;
        for (const [studentId, data] of Object.entries(studentActivity)) {
            tableRows.push(`
                <tr>
                    <td class="number-cell">${rowNumber++}</td>
                    <td>${data.student.name}</td>
                    <td>${data.student.grade}</td>
                    <td>${data.totalBooks}</td>
                    <td>${data.active}</td>
                    <td>${data.returned}</td>
                    <td class="${data.lost > 0 ? 'warning' : ''}">${data.lost}</td>
                    <td>
                        <button onclick="deleteStudent('${studentId}')" class="delete-btn">Delete</button>
                    </td>
                </tr>
            `);
        }

        const totalsRow = `
            <tr class="totals-row">
                <td><b>Total</b></td>
                <td></td>
                <td></td>
                <td>${totalIssuances}</td>
                <td>${totalActive}</td>
                <td>${totalReturned}</td>
                <td>${totalLost}</td>
                <td></td>
            </tr>
        `;

        const averagesRow = `
            <tr class="averages-row">
                <td><b>Average</b></td>
                <td></td>
                <td></td>
                <td>${totalStudents ? (totalIssuances / totalStudents).toFixed(2) : 0}</td>
                <td>${totalStudents ? (totalActive / totalStudents).toFixed(2) : 0}</td>
                <td>${totalStudents ? (totalReturned / totalStudents).toFixed(2) : 0}</td>
                <td>${totalStudents ? (totalLost / totalStudents).toFixed(2) : 0}</td>
                <td></td>
            </tr>
        `;

        this.reportTable.innerHTML = `
            <div class="table-wrapper">
                <div class="sort-container">
                    <label for="grade-filter">Filter by Grade: </label>
                    <select id="grade-filter" class="grade-filter">
                        <option value="all">All Grades</option>
                        ${gradeOptions.map(grade => `<option value="${grade}">${grade}</option>`).join('')}
                    </select>
                    <label for="sort-select">Sort by: </label>
                    <select id="sort-select" class="sort-select">
                        <option value="grade-asc">Grade (Ascending)</option>
                        <option value="grade-desc">Grade (Descending)</option>
                    </select>
                </div>
                <table class="table">
                    <thead>
                        <tr>
                            <th>No.</th>
                            <th>Student Name <input type="text" class="search-input" placeholder="Search..."></th>
                            <th>Grade</th>
                            <th>Total Books</th>
                            <th>Active</th>
                            <th>Returned</th>
                            <th>Lost</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                    <tfoot>${totalsRow}${averagesRow}</tfoot>
                </table>
            </div>
        `;

        window.deleteStudent = async (studentId) => {
            if (confirm('Are you sure you want to delete this student and all their issuance records?')) {
                try {
                    await db.ref(`students/${studentId}`).remove();
                    const issuanceIds = studentActivity[studentId].issuanceIds;
                    for (const issuanceId of issuanceIds) {
                        await db.ref(`issuance/${issuanceId}`).remove();
                    }
                    alert('Student and related issuances deleted successfully');
                    this.generateStudentActivityReport(start, end);
                } catch (error) {
                    console.error('Error deleting student:', error);
                    alert('Failed to delete student record');
                }
            }
        };
    }

    async exportToCSV() {
        const table = this.reportTable.querySelector('table');
        if (!table) return;

        let csv = [];
        const rows = table.querySelectorAll('tr');
        
        for (const row of rows) {
            const cols = row.querySelectorAll('td,th');
            const rowData = Array.from(cols)
                .filter(col => !col.querySelector('.search-input') && !col.querySelector('.delete-btn') && !col.querySelector('.return-btn'))
                .map(col => `"${col.innerText}"`);
            csv.push(rowData.join(','));
        }

        const csvContent = csv.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', `${this.reportType.value}_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}


// Lost Books Management
class LostBooksManager {
    constructor() {
        this.lostBooksModal = document.getElementById('lostBooksOverviewModal');
        this.lostBooksTableBody = document.getElementById('lostBooksTableBody');
        this.searchInput = document.getElementById('lostBooksSearch');
        this.allLostBooks = [];
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupListeners());
        } else {
            this.setupListeners();
        }
    }

    setupListeners() {
        const lostBooksCard = document.querySelector('.warning-card[data-filter="lost"]');
        if (lostBooksCard) {
            lostBooksCard.addEventListener('click', () => this.showLostBooksModal());
        }

        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => this.filterLostBooks());
        }
    }

    filterLostBooks() {
        const searchTerm = this.searchInput.value.toLowerCase();
        const filteredBooks = this.allLostBooks.filter(item => {
            const studentName = item.student?.name?.toLowerCase() || '';
            const assessmentNo = item.student?.assessmentNo?.toLowerCase() || '';
            const grade = item.student?.grade?.toLowerCase() || '';
            const bookTitle = item.book?.title?.toLowerCase() || '';
            
            return studentName.includes(searchTerm) || 
                   assessmentNo.includes(searchTerm) ||
                   grade.includes(searchTerm) ||
                   bookTitle.includes(searchTerm);
        });

        this.renderLostBooksTable(filteredBooks);
    }

    async showLostBooksModal() {
        this.lostBooksTableBody.innerHTML = '<tr><td colspan="7" class="text-center">Loading lost books...</td></tr>';
        this.lostBooksModal.classList.add('active');
        this.searchInput.value = '';
        
        try {
            const snapshot = await db.ref('issuance')
                .orderByChild('status')
                .equalTo('lost')
                .once('value');
            
            if (!snapshot.exists()) {
                this.lostBooksTableBody.innerHTML = '<tr><td colspan="7" class="text-center">No lost books found.</td></tr>';
                return;
            }

            this.allLostBooks = [];
            const promises = [];

            snapshot.forEach(childSnapshot => {
                const issuance = childSnapshot.val();
                promises.push(
                    Promise.all([
                        db.ref(`students/${issuance.studentId}`).once('value'),
                        db.ref(`books/${issuance.bookId}`).once('value')
                    ]).then(([studentSnapshot, bookSnapshot]) => {
                        if (studentSnapshot.exists() && bookSnapshot.exists()) {
                            this.allLostBooks.push({
                                id: childSnapshot.key,
                                issuance,
                                student: studentSnapshot.val(),
                                book: bookSnapshot.val()
                            });
                        }
                    }).catch(error => {
                        console.error('Error fetching related data:', error);
                    })
                );
            });

            await Promise.all(promises);

            if (this.allLostBooks.length === 0) {
                this.lostBooksTableBody.innerHTML = '<tr><td colspan="7" class="text-center">No valid lost book records found.</td></tr>';
                return;
            }

            this.allLostBooks.sort((a, b) => b.issuance.timestamp - a.issuance.timestamp);
            this.renderLostBooksTable(this.allLostBooks);

        } catch (error) {
            console.error('Error loading lost books:', error);
            this.lostBooksTableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error loading lost books. Please try again.</td></tr>';
        }
    }

    renderLostBooksTable(books) {
        this.lostBooksTableBody.innerHTML = books.map(item => {
            const lostDate = new Date(item.issuance.lostDate || item.issuance.timestamp);
            const recoveryStatus = item.issuance.recoveryStatus;
            const recoveryMethod = item.issuance.recoveryMethod;

            return `
                <tr>
                    <td>${item.student?.grade || 'N/A'}</td>
                    <td>${item.student?.name || 'Unknown Student'}</td>
                    <td>${item.student?.assessmentNo || 'N/A'}</td>
                    <td>${item.book?.title || 'Unknown Book'}</td>
                    <td>${item.issuance.issueDate}</td>
                    <td>${lostDate.toLocaleDateString()}</td>
                    <td class="${recoveryStatus ? 'text-success' : 'text-warning'}">
                        ${recoveryStatus ? `Recovered (${recoveryMethod})` : 'Pending'}
                    </td>
                    <td>
                        <div class="btn-group">
                            ${!recoveryStatus ? `
                                <button class="btn btn-sm btn-warning" 
                                        onclick="lostBooksManager.handleRecoveryClick('${item.id}')">
                                    Record Recovery
                                </button>
                            ` : ''}
                            <button class="btn btn-sm btn-danger" 
                                    onclick="lostBooksManager.deleteLostBook('${item.id}', '${item.issuance.bookId}')">
                                <i class="bi bi-trash"></i> Delete
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    handleRecoveryClick(issuanceId) {
        this.lostBooksModal.classList.remove('active');
        setTimeout(() => {
            issuanceManager.showRecoveryModal(issuanceId);
        }, 300);
    }

    async deleteLostBook(issuanceId, bookId) {
        try {
            const result = await Swal.fire({
                title: 'Delete Lost Book Record',
                text: 'Are you sure you want to delete this lost book record? This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete it!'
            });

            if (result.isConfirmed) {
                // Get the issuance record first
                const issuanceSnapshot = await db.ref(`issuance/${issuanceId}`).once('value');
                const issuance = issuanceSnapshot.val();

                if (!issuance) {
                    throw new Error('Lost book record not found');
                }

                // Delete the issuance record
                await db.ref(`issuance/${issuanceId}`).remove();

                // Update the book's lost count
                const bookRef = db.ref(`books/${bookId}`);
                const bookSnapshot = await bookRef.once('value');
                const book = bookSnapshot.val();

                if (book) {
                    await bookRef.update({
                        lost: Math.max(0, (book.lost || 0) - 1),
                        updatedAt: Date.now()
                    });
                }

                await Swal.fire({
                    icon: 'success',
                    title: 'Deleted!',
                    text: 'The lost book record has been deleted.',
                    timer: 2000,
                    showConfirmButton: false
                });

                // Refresh the lost books table
                this.showLostBooksModal();
            }
        } catch (error) {
            console.error('Error deleting lost book:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to delete lost book record. Please try again.',
                timer: 2000,
                showConfirmButton: false
            });
        }
    }
}

// Initialize Managers
document.addEventListener('DOMContentLoaded', () => {
    window.dashboardManager = new DashboardManager();
    window.bookManager = new BookManager();
    window.studentManager = new StudentManager();
    window.issuanceManager = new IssuanceManager();
    window.reportManager = new ReportManager();
    window.lostBooksManager = new LostBooksManager();
});

// Close modals when clicking outside or on cancel button
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });
});

// Close modals on cancel button click
document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
        btn.closest('.modal').classList.remove('active');
    });
});

// Clear search when switching pages
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        searchInput.value = '';
    });
});