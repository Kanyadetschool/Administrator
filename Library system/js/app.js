const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const sanitizedAppId = appId.replace(/\./g, '_');

// Real DB records store fields like "Official Student Name", "Grade",
// "Assessment No", "UPI", "Home phone" (see actual students/{id} sample).
// This maps them onto the lowerCamelCase fields the UI code reads,
// without dropping the original raw fields.
function normalizeStudent(raw) {
    if (!raw) return raw;
    return {
        ...raw,
        name: raw.name || raw.fullName || raw['Official Student Name'] || 'Unknown',
        fullName: raw.fullName || raw['Official Student Name'] || raw.name || 'Unknown',
        assessmentNo: (raw.assessmentNo || raw['Assessment No'] || '').toString().trim(),
        grade: raw.grade || raw['Grade'] || '',
        upi: raw.upi || raw.upiNo || raw['UPI'] || '',
        phoneNumber: raw.phoneNumber || raw['Home phone'] || ''
    };
}

const STUDENTS_PATH = `artifacts/${sanitizedAppId}/students`;
// A small denormalized counter, kept in sync via transactions whenever a
// student is added/removed. Reading this one value is a single tiny fetch —
// far cheaper than downloading every student record just to get its count.
const STUDENT_COUNT_PATH = `artifacts/${sanitizedAppId}/counters/studentCount`;

// Shared students cache: paints instantly from an IndexedDB-backed local
// mirror on load (IndexedDB, unlike localStorage, has no ~5MB ceiling, so it
// doesn't hit QuotaExceededError as the roster grows), then stays in sync via
// child_added/child_changed/child_removed listeners so a page reload never
// re-downloads the whole roster — only what actually changed on the server
// gets fetched, like Gmail's incremental sync.
// Any part of the app (this file or functions.js) can read StudentsCache.getAll()
// instead of doing its own studentsRef.once('value') / .on('value') read.
const StudentsCache = (() => {
    const DB_NAME = 'kanyadet_library_cache';
    const DB_VERSION = 1;
    const STORE_NAME = 'kv';
    const CACHE_KEY = 'students_cache_v1';
    const listeners = new Set();
    const store = new Map(); // studentId -> normalized student
    let initialized = false;
    let persistTimer = null;

    function openDb() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(STORE_NAME)) {
                    req.result.createObjectStore(STORE_NAME);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function loadFromLocalCache() {
        try {
            const db = await openDb();
            const cached = await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const req = tx.objectStore(STORE_NAME).get(CACHE_KEY);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            if (cached && cached.students) {
                Object.entries(cached.students).forEach(([id, student]) => {
                    store.set(id, student);
                });
            }
        } catch (e) {
            console.warn('StudentsCache: failed to read local cache', e);
        }
    }

    // Debounced: a full initial sync fires one child_added per student
    // (348 of them on this roster) — without debouncing that's 348 separate
    // IndexedDB writes instead of one.
    function schedulePersist() {
        if (persistTimer) return;
        persistTimer = setTimeout(async () => {
            persistTimer = null;
            try {
                const students = {};
                store.forEach((value, key) => { students[key] = value; });
                const db = await openDb();
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(STORE_NAME, 'readwrite');
                    tx.objectStore(STORE_NAME).put({ students, updatedAt: Date.now() }, CACHE_KEY);
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error);
                });
            } catch (e) {
                console.warn('StudentsCache: failed to persist local cache', e);
            }
        }, 500);
    }

    function notify(type, id) {
        listeners.forEach(cb => {
            try { cb(type, id, store); } catch (e) { console.error('StudentsCache listener error', e); }
        });
    }

    function init(ref) {
        if (initialized) return;
        initialized = true;

        // 1. Paint immediately from whatever we had cached locally.
        loadFromLocalCache().then(() => notify('ready-from-cache', null));

        // 2. Sync deltas only — Firebase's child_* events only fire for the
        // record(s) that actually changed, not the entire node every time.
        ref.on('child_added', snap => {
            store.set(snap.key, normalizeStudent(snap.val()));
            schedulePersist();
            notify('added', snap.key);
        });
        ref.on('child_changed', snap => {
            store.set(snap.key, normalizeStudent(snap.val()));
            schedulePersist();
            notify('changed', snap.key);
        });
        ref.on('child_removed', snap => {
            store.delete(snap.key);
            schedulePersist();
            notify('removed', snap.key);
        });
    }

    // The whole point of this: don't fetch any student records at all until
    // something actually asks for them. `db`/STUDENTS_PATH are read here
    // (not at module-definition time) since this only ever runs after
    // firebase.initializeApp() further down the file.
    function ensureStarted() {
        if (!initialized) init(db.ref(STUDENTS_PATH));
    }

    return {
        init,
        getAll: () => { ensureStarted(); return store; },
        get: (id) => { ensureStarted(); return store.get(id); },
        // Fires once immediately with whatever's cached ('ready-from-cache'),
        // then again for every subsequent 'added' | 'changed' | 'removed'.
        onChange: (cb) => { ensureStarted(); listeners.add(cb); return () => listeners.delete(cb); }
    };
})();

// Fast, single-student lookup: check the already-synced cache first (an
// in-memory Map read — no network round trip) instead of the ~13 places in
// this file that were doing their own `db.ref('students/{id}').once('value')`
// per lookup. That pattern was also using the wrong un-scoped 'students/'
// path instead of STUDENTS_PATH, so those reads may not even have been
// hitting the record they thought they were. Falls back to a correctly-
// scoped direct fetch only when the cache genuinely hasn't seen this student
// yet (e.g. the very first lookup of a session, before the initial sync).
async function getStudentCached(studentId) {
    if (!studentId) return null;
    const cached = StudentsCache.get(studentId);
    if (cached) return cached;
    const snapshot = await db.ref(`${STUDENTS_PATH}/${studentId}`).once('value');
    return normalizeStudent(snapshot.val());
}
window.getStudentCached = getStudentCached;

// Same idea, for books: a small always-synced mirror of the 'books' node so
// read-only lookups (rendering a title in a card, a report row, a dropdown
// label) don't each cost a network round trip. Unlike StudentsCache this is
// NOT used for anything that gates a write (checking `available` before
// issuing, decrementing `lost`, etc.) — those still read `books/{id}`
// directly, since a cached value could be a moment stale and let two people
// over-issue the same last copy. This is purely for display.
const BooksCache = (() => {
    const DB_NAME = 'kanyadet_library_cache';
    const DB_VERSION = 1;
    const STORE_NAME = 'kv';
    const CACHE_KEY = 'books_cache_v1';
    const listeners = new Set();
    const store = new Map(); // bookId -> book
    let initialized = false;
    let persistTimer = null;

    function openDb() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(STORE_NAME)) {
                    req.result.createObjectStore(STORE_NAME);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function loadFromLocalCache() {
        try {
            const idb = await openDb();
            const cached = await new Promise((resolve, reject) => {
                const tx = idb.transaction(STORE_NAME, 'readonly');
                const req = tx.objectStore(STORE_NAME).get(CACHE_KEY);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            if (cached && cached.books) {
                Object.entries(cached.books).forEach(([id, book]) => store.set(id, book));
            }
        } catch (e) {
            console.warn('BooksCache: failed to read local cache', e);
        }
    }

    function schedulePersist() {
        if (persistTimer) return;
        persistTimer = setTimeout(async () => {
            persistTimer = null;
            try {
                const books = {};
                store.forEach((value, key) => { books[key] = value; });
                const idb = await openDb();
                await new Promise((resolve, reject) => {
                    const tx = idb.transaction(STORE_NAME, 'readwrite');
                    tx.objectStore(STORE_NAME).put({ books, updatedAt: Date.now() }, CACHE_KEY);
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error);
                });
            } catch (e) {
                console.warn('BooksCache: failed to persist local cache', e);
            }
        }, 500);
    }

    function notify(type, id) {
        listeners.forEach(cb => {
            try { cb(type, id, store); } catch (e) { console.error('BooksCache listener error', e); }
        });
    }

    function init(ref) {
        if (initialized) return;
        initialized = true;
        loadFromLocalCache().then(() => notify('ready-from-cache', null));
        ref.on('child_added', snap => { store.set(snap.key, snap.val()); schedulePersist(); notify('added', snap.key); });
        ref.on('child_changed', snap => { store.set(snap.key, snap.val()); schedulePersist(); notify('changed', snap.key); });
        ref.on('child_removed', snap => { store.delete(snap.key); schedulePersist(); notify('removed', snap.key); });
    }

    function ensureStarted() {
        if (!initialized) init(db.ref('books'));
    }

    return {
        init,
        getAll: () => { ensureStarted(); return store; },
        get: (id) => { ensureStarted(); return store.get(id); },
        onChange: (cb) => { ensureStarted(); listeners.add(cb); return () => listeners.delete(cb); }
    };
})();
window.BooksCache = BooksCache;

// Cache-first book lookup for display purposes — see BooksCache note above
// about why this is never used ahead of a write.
async function getBookCached(bookId) {
    if (!bookId) return null;
    const cached = BooksCache.get(bookId);
    if (cached) return cached;
    const snapshot = await db.ref(`books/${bookId}`).once('value');
    return snapshot.val();
}
window.getBookCached = getBookCached;


document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.querySelector('#searchInput');

    searchInput.addEventListener('click', function(event) {
        if (this.value.length > 0) {
            this.select();
        }
    });
});
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
                    if (window.innerWidth < 992) {
                        toggleSidebar();
                    }
                });
            });
        }




        // Handle window resize
        window.addEventListener('resize', () => {
            if (window.innerWidth >= 992) {
                sidebar.classList.remove('show');
                backdrop.classList.remove('show');
            }
        });
    }
});

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Single source of truth for books/{id}.available. Every issue/return/lost/
// recovery/quantity-edit code path used to hand-adjust `available` with its
// own +1/-1, and those adjustments disagreed with each other about whether a
// copy that's actively issued was already excluded from `available` — that
// drift is what let records like "46 available / 46 total / 1 lost" happen
// (a recovered book adding back a copy that a different lost-report path had
// never actually subtracted). Recompute from ground truth instead:
//   available = quantity - lost - (books currently out on active/overdue issuance)
// Call this after ANY change to a book's quantity/lost value or to an
// issuance's status, instead of writing to `available` directly.
async function recalculateBookAvailability(bookId) {
    const [bookSnap, issuanceSnap] = await Promise.all([
        db.ref(`books/${bookId}`).once('value'),
        db.ref('issuance').orderByChild('bookId').equalTo(bookId).once('value')
    ]);
    const book = bookSnap.val();
    if (!book) return null;

    let activeCount = 0;
    issuanceSnap.forEach(child => {
        const status = child.val().status;
        if (status === 'active' || status === 'overdue') activeCount++;
    });

    const quantity = Number(book.quantity) || 0;
    const lost = Number(book.lost) || 0;
    const available = Math.max(0, quantity - lost - activeCount);

    await db.ref(`books/${bookId}`).update({ available, updatedAt: Date.now() });
    return available;
}
window.recalculateBookAvailability = recalculateBookAvailability;

// One-time/repeatable repair pass: recomputes `available` for every book in
// the collection. Run this once (e.g. from the console:
// dashboardFunctions.repairAllBookCounts(), or wire it to a button) to fix
// any book whose available/lost/quantity have already drifted out of sync.
async function recalculateAllBookAvailability() {
    const booksSnap = await db.ref('books').once('value');
    const bookIds = [];
    booksSnap.forEach(child => bookIds.push(child.key));
    const results = {};
    for (const bookId of bookIds) {
        results[bookId] = await recalculateBookAvailability(bookId);
    }
    return results;
}
window.recalculateAllBookAvailability = recalculateAllBookAvailability;

// Deliberately NOT starting StudentsCache here. It now starts itself lazily
// (see ensureStarted() above) the first time something actually asks for
// student data — the Students page, the issuance "new issuance" dropdown,
// a report, or the lost-book modal — instead of downloading the whole
// roster on every page load even when nobody visits those features.

// DOM Elements
const pages = document.querySelectorAll('.page');
const navLinks = document.querySelectorAll('.nav-links li');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        firebase.auth().signOut().then(() => {
            window.location.href = 'https://kanyadet-school-admin.web.app/login.html';
        }).catch((error) => {
            console.error('Logout error:', error);
        });
    });
}

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
    'Grade 4 Textbooks',
    'Grade 5 Textbooks',
    'Grade 6 Textbooks',
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
    // Only pull the full student roster once the Students page is actually
    // opened, instead of on every page load regardless of which page the
    // user lands on.
    if (pageId === 'students' && window.studentManager) {
        window.studentManager.ensureLoaded();
    }
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

        // The student count now lives in its own tiny counter node, so the
        // dashboard only ever fetches/listens to that one value instead of
        // the whole roster.
        db.ref(STUDENT_COUNT_PATH).on('value', () => {
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
                            document.getElementById('issuanceStatusFilter').value = 'overdue';
                            issuanceManager.applyFilters();
                            break;
                        case 'Books Issued':
                            document.getElementById('issuanceStatusFilter').value = 'active';
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
            const snapshot = await db.ref(STUDENT_COUNT_PATH).once('value');
            let totalStudents = snapshot.val();
            if (totalStudents === null) {
                // First run after this change — the counter doesn't exist
                // yet. Seed it once from the current roster; every add/
                // delete after this keeps it accurate without ever
                // re-reading the full students node again.
                totalStudents = StudentsCache.getAll().size;
                await db.ref(STUDENT_COUNT_PATH).set(totalStudents);
            }
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
        this.issuanceRef = db.ref('issuance'); // Reference to issuance node
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
        document.getElementById('addBookBtn').addEventListener('click', () => this.showBookModal());
        this.bookForm.addEventListener('submit', (e) => this.handleBookSubmit(e));
        document.getElementById('categoryFilter').addEventListener('change', () => this.applyFilters());
        document.getElementById('availabilityFilter').addEventListener('change', () => this.applyFilters());
        document.getElementById('searchInput').addEventListener('input', () => this.handleSearch());
        document.getElementById('deleteOptionsBtn').addEventListener('click', () => this.showDeleteOptionsModal());
    }

    handleSearch() {
        const activePage = document.querySelector('.page.active').id;
        if (activePage === 'books') {
            this.applyFilters();
        }
    }

    applyFilters() {
        const category = document.getElementById('categoryFilter').value;
        const availability = document.getElementById('availabilityFilter').value;
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();

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
                                <div class="mb-3">
                                    <label class="form-label">Replacement Cost (KES)</label>
                                    <input type="number" class="form-control" name="replacementCost" min="0" step="1"
                                        placeholder="Cost to replace one copy"
                                        value="${bookData?.replacementCost || ''}">
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

            document.getElementById('bookModal').innerHTML = modalHtml;
            const modal = new bootstrap.Modal(document.getElementById('bookModal'));
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

            if (isNaN(quantity) || quantity < 1) {
                throw new Error('Quantity must be a positive number');
            }
            if (!isbn) {
                throw new Error('ISBN is required');
            }

            const bookData = {
                title: formData.get('title'),
                author: formData.get('author'),
                isbn: isbn,
                category: formData.get('category'),
                grade: formData.get('grade'),
                subject: formData.get('subject'),
                quantity: quantity,
                replacementCost: parseFloat(formData.get('replacementCost')) || 0,
                updatedAt: Date.now()
            };

            if (bookId) {
                const currentSnapshot = await this.booksRef.child(bookId).once('value');
                const currentData = currentSnapshot.val();

                bookData.addedAt = currentData.addedAt || Date.now();
                bookData.lost = currentData.lost || 0;

                await this.booksRef.child(bookId).update(bookData);
                // Recompute available from ground truth (quantity - lost - active
                // issuances) now that quantity may have changed, instead of
                // carrying forward a possibly-already-drifted available number.
                await recalculateBookAvailability(bookId);
            } else {
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
        card.className = 'grid-item book-card';

        const quantity = Number(book.quantity) || 0;
        // Clamp defensively: available should never exceed quantity. This only
        // guards display for records saved before the edit-quantity fix; the
        // underlying record should be corrected by re-saving the book.
        const available = Math.min(Number(book.available) || 0, quantity || Number(book.available) || 0);
        const lost = Number(book.lost) || 0;
        const ratio = quantity > 0 ? available / quantity : 0;

        let statusClass = 'status-available';
        let statusLabel = 'Available';
        if (available <= 0) {
            statusClass = 'status-lost';
            statusLabel = 'Out of Stock';
        } else if (ratio <= 0.25) {
            statusClass = 'status-borrowed';
            statusLabel = 'Low Stock';
        }

        card.innerHTML = `
            <div class="book-card-header">
                <div class="book-cover-container"></div>
                <div class="book-card-badges">
                    <span class="grade-badge">${book.grade || 'N/A'}</span>
                    <span class="book-status-pill ${statusClass}"><i class="status-dot"></i>${statusLabel}</span>
                </div>
            </div>
            <div class="book-info">
                <h3 class="book-title">${book.title}</h3>
                <div class="book-meta">
                    <span><i class="bi bi-person"></i>${book.author || 'Unknown author'}</span>
                    <span><i class="bi bi-upc-scan"></i>${book.isbn || 'No ISBN'}</span>
                    <span><i class="bi bi-tag"></i>${book.category}</span>
                </div>
                <div class="book-stats">
                    <div class="book-stat">
                        <strong>${available}</strong>
                        <span>Available</span>
                    </div>
                    <div class="book-stat">
                        <strong>${quantity}</strong>
                        <span>Total</span>
                    </div>
                    <div class="book-stat book-stat-lost">
                        <strong>${lost}</strong>
                        <span>Lost</span>
                    </div>
                </div>
                <div class="book-cost">Replacement &middot; KES ${Number(book.replacementCost || 0).toLocaleString()}</div>
            </div>
            <div class="card-actions">
                <button onclick="bookManager.showBookModal('${bookId}')" class="btn-ghost">Edit</button>
                <button onclick="bookManager.deleteBook('${bookId}')" class="btn-ghost btn-ghost-danger">Delete</button>
            </div>
        `;
        
        const coverContainer = card.querySelector('.book-cover-container');
        BookCoverManager.renderBookCover(bookId, coverContainer);

        this.booksList.appendChild(card);
    }

    async checkBookIssuance(bookId) {
        const snapshot = await this.issuanceRef.orderByChild('bookId').equalTo(bookId).once('value');
        return snapshot.exists();
    }

    async deleteBook(bookId) {
        try {
            const isIssued = await this.checkBookIssuance(bookId);
            if (isIssued) {
                await this.showError('Error', 'Cannot delete this book because it has been issued.');
                return;
            }

            if (confirm('Are you sure you want to delete this book?')) {
                await this.booksRef.child(bookId).remove();
                await this.showSuccess('Success', 'Book deleted successfully');
            }
        } catch (error) {
            console.error('Error deleting book:', error);
            await this.showError('Error', 'Failed to delete book');
        }
    }

    async deleteBookCollection(category) {
    try {
        const snapshot = await this.booksRef.once('value');
        const books = snapshot.val();
        const booksToDelete = [];
        let hasIssuedBooks = false;

        // Check if books node exists and is an object
        if (!books || typeof books !== 'object') {
            await this.showError('Error', `No books found in the database.`);
            return;
        }

        // Iterate over books using Object.entries
        for (const [bookId, book] of Object.entries(books)) {
            if (book.category === category) {
                const isIssued = await this.checkBookIssuance(bookId);
                if (isIssued) {
                    hasIssuedBooks = true;
                    break;
                }
                booksToDelete.push(bookId);
            }
        }

        if (hasIssuedBooks) {
            await this.showError('Error', `Cannot delete category ${category} because some books are currently issued.`);
            return;
        }

        if (booksToDelete.length === 0) {
            await this.showError('Error', `No books found in category ${category}.`);
            return;
        }

        if (confirm(`Are you sure you want to delete all books in the ${category} category? This action cannot be undone.`)) {
            const updates = {};
            booksToDelete.forEach(bookId => {
                updates[bookId] = null;
            });

            await this.booksRef.update(updates);
            await this.showSuccess('Success', `All books in ${category} category deleted successfully`);
            this.loadBooks();
        }
    } catch (error) {
        console.error('Error deleting collection:', error);
        await this.showError('Error', `Failed to delete ${category} collection`);
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
        this.studentsRef = db.ref(STUDENTS_PATH);
        this.studentsList = document.getElementById('studentsList');
        this.studentForm = document.getElementById('studentForm');
        this.pageSize = 30;
        this.renderedCount = 0;
        this.currentFilteredList = [];
        this.cacheStarted = false;
        this.setupLoadMoreButton();
        this.setupListeners();
        this.setupFilterListeners();
        // NOTE: no data is fetched here. The full roster (via StudentsCache)
        // is only pulled once ensureLoaded() runs — see below — which fires
        // when the Students page is actually opened (see showPage()), not
        // on every page load regardless of which page the user lands on.
        const studentsPageEl = document.getElementById('students');
        if (studentsPageEl && studentsPageEl.classList.contains('active')) {
            this.ensureLoaded();
        }
    }

    // Starts the (expensive, full-roster) cache sync the first time it's
    // actually needed. Safe to call repeatedly — no-ops after the first call.
    ensureLoaded() {
        if (this.cacheStarted) return;
        this.cacheStarted = true;
        this.setupStatusListener();
        this.applyFilters();
        StudentsCache.onChange(() => this.applyFilters());
    }

    // Kept for compatibility with any code that expects a Map of
    // studentId -> student; now backed by the shared cache instead of a
    // private copy of the data.
    get allStudents() {
        return StudentsCache.getAll();
    }

    setupLoadMoreButton() {
        // Created here rather than relying on markup in index.html, so this
        // works regardless of what's already in the page.
        this.loadMoreBtn = document.getElementById('studentsLoadMoreBtn');
        if (!this.loadMoreBtn && this.studentsList) {
            this.loadMoreBtn = document.createElement('button');
            this.loadMoreBtn.id = 'studentsLoadMoreBtn';
            this.loadMoreBtn.type = 'button';
            this.loadMoreBtn.className = 'btn btn-outline-secondary w-100 mt-3';
            this.loadMoreBtn.textContent = 'Load more students';
            this.studentsList.insertAdjacentElement('afterend', this.loadMoreBtn);
        }
        if (this.loadMoreBtn) {
            this.loadMoreBtn.style.display = 'none';
            this.loadMoreBtn.addEventListener('click', () => this.renderNextPage());
        }
    }

    setupStatusListener() {
        // Listen for issuance changes to update student statuses
        db.ref('issuance').on('value', () => {
            this.updateAllStudentStatuses();
        });
    }

    async updateAllStudentStatuses() {
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

        // Update each student's status (student IDs come from the cache —
        // no need to re-read the whole students node just for the key list)
        const updates = {};
        StudentsCache.getAll().forEach((student, studentId) => {
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
                await db.ref(STUDENT_COUNT_PATH).set(0);
                this.studentsList.innerHTML = ''; // Clear the displayed list
                // No need to clear a local cache by hand — the child_removed
                // events from this remove() will drain StudentsCache and its
                // onChange listener will re-render automatically.
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

    // One batched read of the whole issuance node, used to build per-student
    // active/overdue flags in memory — replaces what used to be two separate
    // Firebase queries PER STUDENT (up to 696 round trips for 348 students).
    async loadIssuanceStatusMaps() {
        const activeMap = new Map();
        const overdueMap = new Map();
        const snapshot = await db.ref('issuance').once('value');
        const currentDate = Date.now();

        snapshot.forEach(child => {
            const issuance = child.val();
            if (issuance.status !== 'active') return;
            activeMap.set(issuance.studentId, true);
            if (new Date(issuance.returnDate).getTime() < currentDate) {
                overdueMap.set(issuance.studentId, true);
            }
        });

        return { activeMap, overdueMap };
    }

    async applyFilters() {
        const grade = document.getElementById('gradeFilter').value;
        const status = document.getElementById('studentStatusFilter').value;
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();

        // Clear the current list and reset pagination — this is a fresh filter pass.
        this.studentsList.innerHTML = '';
        this.renderedCount = 0;
        this.currentFilteredList = [];

        try {
            const students = StudentsCache.getAll();

            // Only pay for the issuance read when a status filter is actually applied.
            const { activeMap, overdueMap } = status
                ? await this.loadIssuanceStatusMaps()
                : { activeMap: null, overdueMap: null };

            for (const [studentId, student] of students.entries()) {
                let showStudent = true;

                // Apply grade filter
                if (grade && student.grade !== grade) {
                    showStudent = false;
                }

                // Apply status filter (from the batched maps — no per-student query)
                if (showStudent && status) {
                    const hasActiveBooks = activeMap.has(studentId);
                    const hasOverdueBooks = overdueMap.has(studentId);

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
                if (showStudent && searchTerm) {
                    const searchableText = `${student.name} ${student.assessmentNo} ${student.grade}`.toLowerCase();
                    if (!searchableText.includes(searchTerm)) {
                        showStudent = false;
                    }
                }

                if (showStudent) {
                    this.currentFilteredList.push([studentId, student]);
                }
            }

            // Render only the first page — the rest render on "Load more"
            // click, so a search across 348 students doesn't mean painting
            // 348 DOM cards (with an image lookup each) in one go.
            this.renderNextPage();
        } catch (error) {
            console.error('Error applying filters:', error);
            await this.showError('Filter Error', 'Failed to apply filters');
        }
    }

    renderNextPage() {
        const nextBatch = this.currentFilteredList.slice(this.renderedCount, this.renderedCount + this.pageSize);
        nextBatch.forEach(([studentId, student]) => this.renderStudentCard(student, studentId));
        this.renderedCount += nextBatch.length;

        if (this.loadMoreBtn) {
            const remaining = this.currentFilteredList.length - this.renderedCount;
            this.loadMoreBtn.style.display = remaining > 0 ? '' : 'none';
            this.loadMoreBtn.textContent = remaining > 0
                ? `Load more students (${remaining} remaining)`
                : 'Load more students';
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
            // Prefer the cache (instant, no network round-trip); fall back
            // to a live read only if this student somehow isn't cached yet.
            let studentData = StudentsCache.get(studentId);
            if (!studentData) {
                const snapshot = await this.studentsRef.child(studentId).once('value');
                studentData = normalizeStudent(snapshot.val());
            }
            if (studentData) {
                document.getElementById('studentName').value = studentData.fullName || studentData.name || '';
                document.getElementById('Assessment No').value = studentData.assessmentNo || '';
                document.getElementById('upi').value = studentData.upi || '';
                document.getElementById('phoneNumber').value = studentData.phoneNumber || '';
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
            fullName: document.getElementById('studentName').value,
            name: document.getElementById('studentName').value,
            assessmentNo: document.getElementById('Assessment No').value,
            upi: document.getElementById('upi').value,
            phoneNumber: document.getElementById('phoneNumber').value,
            grade: document.getElementById('grade').value,
            timestamp: Date.now()
        };

        const editId = this.studentForm.getAttribute('data-edit-id');
        if (editId) {
            await this.studentsRef.child(editId).update(studentData);
        } else {
            await this.studentsRef.push(studentData);
            await db.ref(STUDENT_COUNT_PATH).transaction(current => (current || 0) + 1);
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

    renderStudentCard(student, studentId) {
        const card = document.createElement('div');
        card.className = 'student-card';
        card.innerHTML = `
        <div class="student-info">
            <div class="student-profile-head">
                <div class="student-image-container"></div>
                <div class="student-identity">
                    <span class="student-eyebrow">${student.grade || 'Student record'}</span>
                    <h3>${student.fullName || student.name || 'Unknown'}</h3>
                    <span class="student-id">${student.assessmentNo || 'No assessment number'}</span>
                </div>
            </div>
            <div class="student-meta">
                <p><span>Entry number</span><strong>${student.EntryNo || 'Not assigned'}</strong></p>
                <p><span>Phone</span><strong>${student.phoneNumber || student.FathersPhoneNumber || 'Not assigned'}</strong></p>
                <p><span>Home contact</span><strong>${student.FathersPhoneNumber || 'Not assigned'}</strong></p>
                <p><span>UPI number</span><strong>${student.upi || 'Not assigned'}</strong></p>
            </div>
            <div class="student-status-row">
                <span>Book status</span>
                <span class="badge ${student.hasActiveBooks ? 'bg-primary' : 'bg-secondary'}">
                    ${student.hasActiveBooks ? 'Has Active Books' : 'No Active Books'}
                </span>
            </div>
            <div class="card-actions">
                <button onclick="studentManager.showStudentModal('${studentId}')"><i class="bi bi-pencil-square"></i> Edit</button>
                <button onclick="studentManager.deleteStudent('${studentId}')"><i class="bi bi-trash3"></i> Delete</button>
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
            await db.ref(STUDENT_COUNT_PATH).transaction(current => Math.max(0, (current || 0) - 1));
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
        this.classFilter = document.getElementById('issuanceGradeFilter');
        this.allIssuances = new Map();
        this.gradeSelect = document.getElementById('issuanceGrade');
        this.studentSelect = document.getElementById('issuanceStudent');
        if (this.gradeSelect) {
            this.gradeSelect.addEventListener('change', () => this.populateStudentsByGrade());
        }
        this.setupListeners();
        this.loadIssuances();

        // Re-apply filters whenever the student or book caches change, so
        // filtering never has to wait on a fresh network round-trip per card.
        StudentsCache.onChange(() => this.applyFilters());
        db.ref('books').on('value', () => this.applyFilters());
    }

    setupListeners() {
        if (this.statusFilter) {
            this.statusFilter.addEventListener('change', () => this.applyFilters());
        }
        if (this.classFilter) {
            this.classFilter.addEventListener('change', () => this.applyFilters());
        }
        document.getElementById('newIssuanceBtn').addEventListener('click', () => this.showIssuanceModal());
        this.issuanceForm.addEventListener('submit', (e) => this.handleIssuanceSubmit(e));
        
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', () => this.handleSearch());
        }

        const deleteIssuanceOptionsBtn = document.getElementById('deleteIssuanceOptionsBtn');
        if (deleteIssuanceOptionsBtn) {
            deleteIssuanceOptionsBtn.addEventListener('click', () => this.showDeleteIssuanceOptionsModal());
        }
    }

    handleSearch() {
        const activePage = document.querySelector('.page.active').id;
        if (activePage === 'issuance') {
            this.applyFilters();
        }
    }

    applyFilters() {
        // NOTE: this used to look up the student/book for every issuance with
        // an `await db.ref(...).once('value')` inside this loop. Because
        // applyFilters() can be re-triggered (dropdown change, a return/loss
        // action, or the realtime `issuance` listener firing again) before an
        // earlier, still-in-flight run had finished awaiting all its network
        // calls, two overlapping runs could interleave: the newer (correctly
        // filtered) run would render first, and the older run — still
        // working through its awaits with a stale/empty filter value — would
        // land its unfiltered cards on top afterwards. That's what caused
        // "Overdue" (or any filter) to appear to do nothing.
        //
        // Fixed by reading student/book data from the in-memory caches that
        // already exist elsewhere in the app (StudentsCache, bookManager's
        // allBooks map) instead of hitting the database per card. That makes
        // this whole function synchronous, so there is no window in which a
        // second call can start before the first one finishes.
        const status = this.statusFilter.value;
        const grade = this.classFilter ? this.classFilter.value : '';
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        const currentDate = new Date();

        this.issuanceList.innerHTML = '';

        for (const [issuanceId, issuance] of this.allIssuances) {
            let showIssuance = true;

            const student = StudentsCache.get(issuance.studentId);
            const book = window.bookManager ? window.bookManager.allBooks.get(issuance.bookId) : undefined;

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

            if (grade && showIssuance) {
                showIssuance = student?.grade === grade;
            }

            if (searchTerm && showIssuance) {
                const searchableText = `${student?.name || ''} ${student?.assessmentNo || ''} ${book?.title || ''}`.toLowerCase();
                if (!searchableText.includes(searchTerm)) {
                    showIssuance = false;
                }
            }

            if (showIssuance) {
                this.renderIssuanceCard(issuance, issuanceId, student, book);
            }
        }
    }

    async showIssuanceModal() {
        const modal = document.getElementById('issuanceModal');
        
        this.gradeSelect.value = '';
        await this.populateStudentSelect();
        await this.populateBookSelect();
        
        const today = new Date().toISOString().split('T')[0];
        const returnDate = new Date();
        returnDate.setDate(returnDate.getDate() + 14);
        
        document.getElementById('issueDate').value = today;
        document.getElementById('returnDate').value = returnDate.toISOString().split('T')[0];
        
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
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
            // Filter the already-synced cache instead of issuing a fresh
            // Firebase query every time this dropdown is opened.
            const matches = [];
            StudentsCache.getAll().forEach((student, studentId) => {
                if (student.grade === grade) {
                    matches.push([studentId, student]);
                }
            });

            if (matches.length > 0) {
                matches.forEach(([studentId, student]) => {
                    const option = document.createElement('option');
                    option.value = studentId;
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

            const [student, bookSnapshot] = await Promise.all([
                getStudentCached(studentId),
                db.ref(`books/${bookId}`).once('value')
            ]);

            const book = bookSnapshot.val();

            if (!student || !book) {
                throw new Error('Invalid student or book selection');
            }

            if (book.available <= 0) {
                throw new Error('Book is not available for issuance');
            }

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

            // Grab the issuance's key up front (push() assigns it synchronously)
            // so the activity log entry can point at this exact issuance,
            // not just this book title — needed so "Report Lost" from the
            // activity feed marks the right student's copy when the same
            // book has several copies out at once.
            const newIssuanceRef = this.issuanceRef.push();
            await Promise.all([
                newIssuanceRef.set(issuanceData),
                db.ref('activities').push({
                    type: 'issue',
                    bookId,
                    studentId,
                    issuanceId: newIssuanceRef.key,
                    description: `Issued "${book.title}" to ${student.name}`,
                    timestamp: Date.now()
                })
            ]);
            await recalculateBookAvailability(bookId);

            const bsModal = bootstrap.Modal.getInstance(modalElement);
            bsModal.hide();
            this.issuanceForm.reset();

            await Swal.fire({
                icon: 'warning',
                title: 'Success',
                text: 'Book issued successfully',
                timer: 1500,
                showConfirmButton: false
            });

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

    renderIssuanceCard(issuance, issuanceId, student, book) {
        try {
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
                    <h5>Book No: ${issuance.isbn || 'N/A'}</h5>
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
            // const imageContainer = card.querySelector('.student-image-container');
            // StudentImageManager.renderStudentImage(issuance.studentId, imageContainer, displayStatus);

 // Add student Gender below image
        const imageContainer = card.querySelector('.student-image-container');
        const status = student.Gender ? `${student.Gender.toLowerCase().replace(/\s+/g, ' -')}` : 'no-gender';
        StudentImageManager.renderStudentImage(issuance.studentId, imageContainer, status);

            const coverContainer = card.querySelector('.book-cover-container');
            BookCoverManager.renderBookCover(issuance.bookId, coverContainer);

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
                const issuanceSnapshot = await this.issuanceRef.child(issuanceId).once('value');
                const issuance = issuanceSnapshot.val();

                if (!issuance) {
                    throw new Error('Issuance record not found');
                }

                await this.issuanceRef.child(issuanceId).remove();

                if (issuance.status === 'active' || issuance.status === 'overdue') {
                    await recalculateBookAvailability(bookId);
                }

                await Swal.fire({
                    icon: 'success',
                    title: 'Deleted!',
                    text: 'The issuance record has been deleted.',
                    timer: 1000,
                    showConfirmButton: false
                });

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
        try {
            const result = await Swal.fire({
                title: 'Report Book Lost',
                text: 'Are you sure you want to report this book as lost?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, report lost',
                cancelButtonText: 'Cancel'
            });

            if (result.isConfirmed) {
                await this.issuanceRef.child(issuanceId).update({ 
                    status: 'lost',
                    updatedAt: Date.now()
                });

                const bookRef = db.ref(`books/${bookId}`);
                const bookSnapshot = await bookRef.once('value');
                const book = bookSnapshot.val();
                await bookRef.update({ 
                    lost: (book.lost || 0) + 1,
                    updatedAt: Date.now()
                });
                // Issuance just moved from active -> lost, and lost went up by
                // one, so this nets out to the same available count — but
                // recompute from ground truth rather than assume that math
                // holds if available had already drifted.
                await recalculateBookAvailability(bookId);

                await Swal.fire({
                    icon: 'success',
                    title: 'Reported',
                    text: 'Book reported as lost.',
                    timer: 1000,
                    showConfirmButton: false
                });
            }
        } catch (error) {
            console.error('Error reporting book lost:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to report book as lost.',
                timer: 1000,
                showConfirmButton: false
            });
        }
    }

    async returnBook(issuanceId, bookId) {
        try {
            const result = await Swal.fire({
                title: 'Return Book',
                text: 'Are you sure you want to mark this book as returned?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#3085d6',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Yes, return it',
                cancelButtonText: 'Cancel'
            });

            if (result.isConfirmed) {
                const issuanceRef = db.ref(`issuance/${issuanceId}`);
                const issuanceSnapshot = await issuanceRef.once('value');
                const issuance = issuanceSnapshot.val();

                if (!issuance) {
                    throw new Error('Issuance record not found');
                }

                await issuanceRef.update({
                    status: 'returned',
                    returnedDate: new Date().toISOString(),
                    actualReturnDate: new Date().toISOString(),
                    updatedAt: Date.now()
                });

                await recalculateBookAvailability(bookId);

                if (issuance.studentId) {
                    await studentManager.updateStudentIssuanceStatus(issuance.studentId);
                }

                await Swal.fire({
                    icon: 'success',
                    title: 'Success',
                    text: 'Book returned successfully!',
                    timer: 1000,
                    showConfirmButton: false
                });
                this.loadIssuances();
            }
        } catch (error) {
            console.error('Error returning book:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Error returning book. Please try again.',
                timer: 1000,
                showConfirmButton: false
            });
        }
    }

    async renderLostBookCard(issuance, issuanceId) {
        try {
            const [student, book] = await Promise.all([
                getStudentCached(issuance.studentId),
                getBookCached(issuance.bookId)
            ]);

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
        try {
            const issuance = this.allIssuances.get(issuanceId);
            if (!issuance) return;

            const student = await getStudentCached(issuance.studentId);
            const book = await getBookCached(issuance.bookId);

            if (!student || !book) return;

            document.getElementById('lostBookStudent').textContent = student.name;
            document.getElementById('lostBookTitle').textContent = book.title;
            document.getElementById('lostBookIssueDate').textContent = issuance.issueDate;
            document.getElementById('lostBookIsbn').textContent = issuance.isbn || 'N/A';

            document.getElementById('lostBookReturnDate').textContent = issuance.returnDate;
            document.getElementById('lostBookReportedDate').textContent = new Date(issuance.lostDate || issuance.timestamp).toLocaleDateString();
    

            const modal = document.getElementById('lostBookModal');
            const form = document.getElementById('lostBookForm');

            form.onsubmit = async (e) => {
                e.preventDefault();
                const recoveryMethod = document.getElementById('recoveryMethod').value;
                const recoveryNotes = document.getElementById('recoveryNotes').value;

                await this.handleBookRecovery(issuanceId, recoveryMethod, recoveryNotes);
                const bsModal = bootstrap.Modal.getInstance(modal);
                bsModal.hide();
                form.reset();
            };

            const bsModal = new bootstrap.Modal(modal);
            bsModal.show();
        } catch (error) {
            console.error('Error showing recovery modal:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to load recovery modal.',
                timer: 1000,
                showConfirmButton: false
            });
        }
    }

    async handleBookRecovery(issuanceId, recoveryMethod, notes) {
        try {
            const issuance = this.allIssuances.get(issuanceId);
            if (!issuance) return;

            const updates = {
                recoveryStatus: true,
                recoveryMethod,
                recoveryNotes: notes,
                recoveryDate: new Date().toISOString(),
                updatedAt: Date.now()
            };

            await this.issuanceRef.child(issuanceId).update(updates);

            if (recoveryMethod === 'found' || recoveryMethod === 'replaced') {
                const bookRef = db.ref(`books/${issuance.bookId}`);
                const bookSnapshot = await bookRef.once('value');
                const book = bookSnapshot.val();
                await bookRef.update({
                    lost: Math.max(0, (book.lost || 0) - 1),
                    updatedAt: Date.now()
                });
                // Recompute available instead of assuming +1 is correct — it
                // isn't when this copy's lost-report never actually subtracted
                // it from available in the first place (e.g. a book reported
                // lost while still on active issuance).
                await recalculateBookAvailability(issuance.bookId);
            }

            await Swal.fire({
                icon: 'success',
                title: 'Success',
                text: 'Book recovery recorded successfully.',
                timer: 1000,
                showConfirmButton: false
            });
        } catch (error) {
            console.error('Error handling book recovery:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to record book recovery.',
                timer: 1000,
                showConfirmButton: false
            });
        }
    }

    async deleteIssuancesByBook(bookId) {
        try {
            console.log(`Attempting to delete issuances for book ID: ${bookId}`);
            const bookSnapshot = await db.ref(`books/${bookId}`).once('value');
            const book = bookSnapshot.val();
            if (!book) {
                throw new Error('Book not found.');
            }

            const result = await Swal.fire({
                title: 'Delete Issuances for Book',
                text: `Are you sure you want to delete all issuance records for "${book.title}" (ID: ${bookId})? This action cannot be undone.`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete them!',
                cancelButtonText: 'Cancel',
                showLoaderOnConfirm: true,
                preConfirm: async () => {
                    const snapshot = await this.issuanceRef.orderByChild('bookId').equalTo(bookId).once('value');
                    if (!snapshot.exists()) {
                        throw new Error(`No issuance records found for book ID: ${bookId}.`);
                    }

                    const updates = {};
                    let activeCount = 0;

                    snapshot.forEach(childSnapshot => {
                        const issuance = childSnapshot.val();
                        const issuanceId = childSnapshot.key;
                        updates[`issuance/${issuanceId}`] = null;
                        if (issuance.status === 'active') {
                            activeCount++;
                        }
                    });

                    console.log(`Found ${Object.keys(updates).length} issuances to delete, ${activeCount} active.`);

                    await db.ref().update(updates);
                    if (activeCount > 0) {
                        // All issuances for this book are gone, so recompute
                        // from ground truth rather than guess the delta.
                        await recalculateBookAvailability(bookId);
                    }
                    console.log(`Successfully deleted issuances for book ID: ${bookId}`);
                    return true;
                }
            });

            if (result.isConfirmed) {
                await Swal.fire({
                    icon: 'success',
                    title: 'Deleted!',
                    text: `All issuance records for "${book.title}" have been deleted.`,
                    timer: 1000,
                    showConfirmButton: false
                });

                this.loadIssuances();
                if (window.dashboardManager) {
                    window.dashboardManager.updateAllStats();
                }
            }
        } catch (error) {
            console.error('Error deleting issuances for book:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: error.message || 'Failed to delete issuance records for the selected book.',
                timer: 1000,
                showConfirmButton: false
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
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete all!',
                cancelButtonText: 'Cancel',
                showLoaderOnConfirm: true,
                preConfirm: async () => {
                    const activeIssuances = await this.issuanceRef
                        .orderByChild('status')
                        .equalTo('active')
                        .once('value');

                    const updates = {};
                    const bookUpdates = new Map();

                    if (activeIssuances.exists()) {
                        activeIssuances.forEach(snapshot => {
                            const issuance = snapshot.val();
                            bookUpdates.set(issuance.bookId, true);
                        });
                    }

                    updates['issuance'] = null;
                    await db.ref().update(updates);
                    // All issuances are gone now, so recompute each affected
                    // book's available from ground truth (quantity - lost).
                    for (const bookId of bookUpdates.keys()) {
                        await recalculateBookAvailability(bookId);
                    }
                    console.log('Successfully deleted all issuances');
                    return true;
                }
            });

            if (result.isConfirmed) {
                await Swal.fire({
                    icon: 'success',
                    title: 'Deleted!',
                    text: 'All issuance records have been deleted.',
                    timer: 1000,
                    showConfirmButton: false
                });

                this.issuanceList.innerHTML = '';
                if (window.dashboardManager) {
                    window.dashboardManager.updateAllStats();
                }
            }
        } catch (error) {
            console.error('Error deleting all issuances:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to delete all issuance records. Please try again.',
                timer: 1000,
                showConfirmButton: false
            });
        }
    }

    async showDeleteIssuanceOptionsModal() {
        try {
            const bookSnapshot = await db.ref('books').once('value');
            const books = [];

            bookSnapshot.forEach((childSnapshot) => {
                const book = childSnapshot.val();
                const bookId = childSnapshot.key;
                books.push({ id: bookId, title: book.title });
            });

            const modalHtml = `
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Delete Issuance Options</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <label for="deleteIssuanceBookSelect" class="form-label">Delete Issuances for a Specific Book</label>
                                <select id="deleteIssuanceBookSelect" class="form-select">
                                    <option value="">Select a Book</option>
                                    ${books.map(book => `
                                        <option value="${book.id}">${book.title} (ID: ${book.id})</option>
                                    `).join('')}
                                </select>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Delete All Issuance Records</label>
                                <div class="alert alert-warning mt-2">
                                    <strong>Warning:</strong> This will permanently delete ALL issuance records for all books.
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                        <button type="button" class="btn btn-primary" id="confirmIssuanceDelete">Delete Selected Book Issuances</button>
                        <button type="button" class="btn btn-danger" id="deleteAllIssuancesOption">Delete All Issuances</button>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        </div>
                    </div>
                </div>
            `;

            const deleteModal = document.getElementById('deleteIssuanceModal') || document.createElement('div');
            deleteModal.id = 'deleteIssuanceModal';
            deleteModal.className = 'modal fade';
            deleteModal.innerHTML = modalHtml;
            document.body.appendChild(deleteModal);

            const modal = new bootstrap.Modal(deleteModal);
            modal.show();

            document.getElementById('deleteAllIssuancesOption').onclick = async () => {
                await this.deleteAllIssuances();
                modal.hide();
            };

            document.getElementById('confirmIssuanceDelete').onclick = async () => {
                const bookId = document.getElementById('deleteIssuanceBookSelect').value;
                console.log(`Delete button clicked with book ID: ${bookId}`);

                if (bookId) {
                    await this.deleteIssuancesByBook(bookId);
                    modal.hide();
                } else {
                    await Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Please select a book to delete its issuance records.',
                        timer: 1000,
                        showConfirmButton: false
                    });
                }
            };
        } catch (error) {
            console.error('Error showing delete issuance options modal:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to load delete issuance options.',
                timer: 1000,
                showConfirmButton: false
            });
        }
    }
}

// =============================================================================
// ENHANCED EXPORT FUNCTIONALITY - PDF, WORD, EXCEL
// =============================================================================
// Required libraries:
// - jsPDF: https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
// - jsPDF-AutoTable: https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js
// - SheetJS (XLSX): https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js

// =============================================================================
// ENHANCED EXPORT TO PDF WITH PREMIUM STYLING
// =============================================================================

// Helper function to determine optimal column widths
const getColumnStyles = (headers) => {
    // Return empty object to let autoTable distribute columns evenly across full width
    return {};
};

const exportToPdfEnhanced = async (reportData, reportTitle) => {
    if (!window.jspdf) {
        Swal.fire('Error', 'PDF library not loaded. Please refresh the page.', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape');

    const title = reportTitle || 'Library Report';
    const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    
    // Extract headers and body from reportData
    const headers = reportData.headers || [];
    const body = reportData.body || [];
    
    // Premium Header Function
    const addHeader = (data) => {
        const pageWidth = doc.internal.pageSize.width;
        const pageHeight = doc.internal.pageSize.height;
        
        // Header background
        doc.setFillColor(41, 128, 185);
        doc.rect(0, 0, pageWidth, 20, 'F');
        
        // School name
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont(undefined, 'bold');
        doc.text('KANYADET PRI & JUNIOR SCHOOL', 14, 10);
        
        // Report title
        doc.setFontSize(12);
        doc.text(title, 14, 16);
        
        // Date and info (right aligned)
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        const dateText = `Date: ${currentDate}`;
        doc.text(dateText, pageWidth - 14, 8, { align: 'right' });
        doc.text(`Total Records: ${body.length}`, pageWidth - 14, 13, { align: 'right' });
        
        // Decorative line
        doc.setDrawColor(41, 128, 185);
        doc.setLineWidth(0.5);
        doc.line(0, 20, pageWidth, 20);
    };

    // Premium Footer Function
    const addFooter = (data, totalPages) => {
        const pageWidth = doc.internal.pageSize.width;
        const pageHeight = doc.internal.pageSize.height;
        const footerY = pageHeight - 15;
        
        // Footer background
        doc.setFillColor(245, 245, 245);
        doc.rect(0, footerY - 5, pageWidth, 20, 'F');
        
        // Top border
        doc.setDrawColor(41, 128, 185);
        doc.setLineWidth(0.3);
        doc.line(0, footerY - 5, pageWidth, footerY - 5);
        
        doc.setTextColor(60, 60, 60);
        doc.setFontSize(8);
        
        // Left section
        doc.setFont(undefined, 'bold');
        doc.text('Prepared by:', 14, footerY);
        doc.setFont(undefined, 'normal');
        doc.text('_________________', 14, footerY + 4);
        doc.setFontSize(7);
        doc.text('Signature & Date', 14, footerY + 8);
        
        // Center - Page number
        doc.setFontSize(9);
        const pageText = `Page ${data.pageNumber} of ${totalPages}`;
        doc.text(pageText, pageWidth / 2, footerY + 2, { align: 'center' });
        
        // Right section
        doc.setFontSize(8);
        doc.setFont(undefined, 'bold');
        doc.text('Verified by:', pageWidth - 14, footerY, { align: 'right' });
        doc.setFont(undefined, 'normal');
        doc.text('_________________', pageWidth - 14, footerY + 4, { align: 'right' });
        doc.setFontSize(7);
        doc.text('Signature & Stamp', pageWidth - 14, footerY + 8, { align: 'right' });
    };

    // Generate table
    doc.autoTable({
        head: [headers],
        body: body,
        startY: 25,
        styles: { 
            fontSize: 9,
            cellPadding: 3,
            overflow: 'linebreak',
            font: 'helvetica'
        },
        columnStyles: getColumnStyles(headers),
        headStyles: { 
            fillColor: [41, 128, 185], 
            textColor: [255, 255, 255],
            fontStyle: 'bold'
        },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        margin: { top: 25, right: 5, bottom: 20, left: 5 },
        tableWidth: 'auto',
        didDrawPage: function(data) {
            addHeader(data);
        }
    });

    // Add footers with correct page count
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        addFooter({ pageNumber: i }, totalPages);
    }

    const filename = `${reportTitle.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
};

// =============================================================================
// EXPORT TO EXCEL WITH PREMIUM STYLING
// =============================================================================
const exportToExcelEnhanced = async (reportData, reportTitle) => {
    const XLSX = window.XLSX;
    if (!XLSX) {
        Swal.fire('Error', 'Excel export library not loaded. Please refresh the page.', 'error');
        return;
    }

    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // Extract headers and body from reportData
    const headers = reportData.headers || [];
    const body = reportData.body || [];
    const statsInfo = reportData.statsInfo || {};

    // Create header rows
    const headerData = [
        ['KANYADET PRI & JUNIOR SCHOOL'],
        [reportTitle],
        [`Date: ${new Date().toLocaleDateString()}`, '', '', `Total Records: ${body.length}`],
        []
    ];

    // Add statistics if available
    if (Object.keys(statsInfo).length > 0) {
        const statsRow = [];
        for (const [key, value] of Object.entries(statsInfo)) {
            statsRow.push(`${key}: ${value}`);
        }
        headerData.push(statsRow);
        headerData.push([]);
    }

    // Add column headers
    headerData.push(headers);

    // Combine all data
    const wsData = [...headerData, ...body];

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    ws['!cols'] = headers.map(() => ({ wch: 18 }));

    // Merge cells for headers
    const merges = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } }
    ];
    ws['!merges'] = merges;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Report');

    // Save file
    const filename = `${reportTitle.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
};

// =============================================================================
// EXPORT TO WORD WITH PREMIUM STYLING
// =============================================================================
const exportToWordEnhanced = async (reportData, reportTitle) => {
    // Extract headers and body from reportData
    const headers = reportData.headers || [];
    const body = reportData.body || [];
    const statsInfo = reportData.statsInfo || {};

    // Create table rows HTML
    let tableRowsHtml = '';
    body.forEach(row => {
        tableRowsHtml += '<tr>' + 
            row.map(cell => `<td>${cell || '-'}</td>`).join('') + 
            '</tr>';
    });

    // Create stats section if available
    let statsHtml = '';
    if (Object.keys(statsInfo).length > 0) {
        statsHtml = '<div style="margin: 20px 0; padding: 15px; background: #f5f5f5; border-left: 4px solid #2980B9;">';
        for (const [key, value] of Object.entries(statsInfo)) {
            statsHtml += `<div style="margin: 5px 0;"><strong>${key}:</strong> ${value}</div>`;
        }
        statsHtml += '</div>';
    }

    // Create HTML content with premium styling
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        @page {
            size: A4 landscape;
            margin: 0.5in;
        }
        body {
            font-family: 'Calibri', Arial, sans-serif;
            margin: 0;
            padding: 20px;
        }
        .header {
            background: linear-gradient(135deg, #2980B9 0%, #3498DB 100%);
            color: white;
            padding: 20px;
            margin: -20px -20px 20px -20px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: bold;
        }
        .header h2 {
            margin: 10px 0 0 0;
            font-size: 18px;
            font-weight: normal;
        }
        .header-info {
            font-size: 12px;
            margin-top: 10px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th {
            background-color: #2980B9;
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: bold;
            border: 1px solid #2471A3;
        }
        td {
            padding: 10px;
            border: 1px solid #ddd;
        }
        tr:nth-child(even) {
            background-color: #f5f5f5;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid #2980B9;
            display: flex;
            justify-content: space-between;
        }
        .footer-section {
            flex: 1;
        }
        .signature-line {
            border-top: 1px solid #333;
            margin-top: 40px;
            padding-top: 5px;
            font-size: 11px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>KANYADET PRI & JUNIOR SCHOOL</h1>
        <h2>${reportTitle}</h2>
        <div class="header-info">
            <div>Date: ${new Date().toLocaleDateString()}</div>
            <div>Total Records: ${body.length}</div>
        </div>
    </div>
    
    ${statsHtml}
    
    <table>
        <thead>
            <tr>
                ${headers.map(h => `<th>${h}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
            ${tableRowsHtml}
        </tbody>
    </table>
    
    <div class="footer">
        <div class="footer-section">
            <strong>Prepared by:</strong>
            <div class="signature-line">Signature & Date</div>
        </div>
        <div class="footer-section" style="text-align: right;">
            <strong>Verified by:</strong>
            <div class="signature-line">Signature & Date</div>
        </div>
    </div>
</body>
</html>
    `;

    // Convert HTML to blob and download
    const blob = new Blob(['\ufeff', htmlContent], {
        type: 'application/msword'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reportTitle.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

// =============================================================================
// UNIFIED EXPORT FUNCTION
// =============================================================================
const handleExportEnhanced = async (reportData, reportTitle) => {
    const exportOptions = [
        { label: 'Export to PDF (Premium Format)', value: 'pdf', icon: '📄' },
        { label: 'Export to Excel (Premium Format)', value: 'excel', icon: '📊' },
        { label: 'Export to Word (Premium Format)', value: 'word', icon: '📝' },
        { label: 'Export as CSV', value: 'csv', icon: '📋' }
    ];

    // Create HTML with onclick handlers that call executeExport
    let optionsHtml = '<div style="display: grid; gap: 10px;">';
    exportOptions.forEach(option => {
        optionsHtml += `
            <button class="export-option-btn" onclick="window.executeExport('${option.value}')" 
                    style="padding: 14px 16px; text-align: left; background:transparent; 
                           border: 2px solid #ddd; border-radius: 8px; cursor: pointer; font-size: 14px; color: #333; 
                           font-weight: 500; display: flex; align-items: center; gap: 5px;">
                <span style="font-size: 24px;">${option.icon}</span>
                <span>${option.label}</span>
            </button>
        `;
    });
    optionsHtml += '</div>';

    try {
        await Swal.fire({
            title: 'Export Report',
            html: optionsHtml,
            showConfirmButton: false,
            showCancelButton: true,
            cancelButtonText: 'Cancel',
            allowOutsideClick: true,
            didOpen: (modal) => {
                // Add hover effects to buttons
                const buttons = modal.querySelectorAll('.export-option-btn');
                buttons.forEach(btn => {
                    btn.addEventListener('mouseenter', function() {
                        this.style.background = 'linear-gradient(135deg, #e8f4f8 0%, #f0f8ff 100%)';
                        this.style.borderColor = '#2980B9';
                        this.style.transform = 'translateX(4px)';
                        this.style.boxShadow = '0 4px 12px rgba(41, 128, 185, 0.2)';
                    });
                    btn.addEventListener('mouseleave', function() {
                        this.style.background = 'linear-gradient(135deg, #f5f5f5 0%, #ffffff 100%)';
                        this.style.borderColor = '#ddd';
                        this.style.transform = 'translateX(0)';
                        this.style.boxShadow = 'none';
                    });
                });
            }
        });
    } catch (error) {
        console.error('Modal error:', error);
    }
};

// Global export execution function
window.executeExport = async function(exportType) {
    // Close the modal
    Swal.close();
    
    // Get the report data from the current ReportManager instance
    if (!window.reportManager) {
        Swal.fire('Error', 'Report manager not initialized', 'error');
        return;
    }

    // Get table and stats
    const table = window.reportManager.reportTable.querySelector('table');
    if (!table) {
        Swal.fire('Error', 'No report data available', 'error');
        return;
    }

    // Extract headers
    const thead = table.querySelector('thead tr');
    const headers = Array.from(thead.cells).map(cell => cell.textContent.trim()).filter(h => h && h !== 'Action');

    // Extract body rows
    let tbody = table.querySelector('tbody');
    let rows = Array.from(tbody.querySelectorAll('tr')).filter(row => !row.classList.contains('totals-row') && !row.classList.contains('averages-row'));

    // Extract body data
    const body = rows.map(row => 
        Array.from(row.cells).map(cell => cell.textContent.trim()).filter((_, idx) => idx < headers.length)
    );

    // Extract stats
    const statsCards = window.reportManager.reportStats.querySelectorAll('.stat-card');
    const statsInfo = {};
    statsCards.forEach(card => {
        const title = card.querySelector('h3')?.textContent.trim();
        const value = card.querySelector('p')?.textContent.trim();
        if (title && value) {
            statsInfo[title] = value;
        }
    });

    // Get report title
    const reportTitle = window.reportManager.reportType.options[window.reportManager.reportType.selectedIndex].text;

    const reportData = {
        headers: headers,
        body: body,
        statsInfo: statsInfo
    };

    try {
        switch(exportType) {
            case 'pdf':
                Swal.fire({
                    title: 'Exporting to PDF...',
                    html: 'Please wait while your PDF is being generated.',
                    icon: 'info',
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    didOpen: async () => {
                        Swal.showLoading();
                        await exportToPdfEnhanced(reportData, reportTitle);
                        Swal.fire('Success!', 'PDF exported successfully!', 'success');
                    }
                });
                break;
            case 'excel':
                Swal.fire({
                    title: 'Exporting to Excel...',
                    html: 'Please wait while your Excel file is being generated.',
                    icon: 'info',
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    didOpen: async () => {
                        Swal.showLoading();
                        await exportToExcelEnhanced(reportData, reportTitle);
                        Swal.fire('Success!', 'Excel file exported successfully!', 'success');
                    }
                });
                break;
            case 'word':
                Swal.fire({
                    title: 'Exporting to Word...',
                    html: 'Please wait while your Word document is being generated.',
                    icon: 'info',
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    didOpen: async () => {
                        Swal.showLoading();
                        await exportToWordEnhanced(reportData, reportTitle);
                        Swal.fire('Success!', 'Word document exported successfully!', 'success');
                    }
                });
                break;
            case 'csv':
                // Use existing CSV export method from ReportManager
                window.reportManager.exportToCSV();
                Swal.fire('Success!', 'CSV exported successfully!', 'success');
                break;
            default:
                Swal.fire('Error', 'Unknown export type', 'error');
        }
    } catch (error) {
        console.error('Export error:', error);
        Swal.fire('Error', 'Failed to export data. Please try again. ' + error.message, 'error');
    }
};

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
        this.generateReport(); // Show the default report (Lost Books) immediately, no click needed
    }



    //FALLBACK WITH DATE RANGE
    // initializeDates() {
    //     const end = new Date();
    //     const start = new Date();
    //     start.setDate(start.getDate() - 31); // test date range that must be in import files aper report date headers in html 
        
    //     this.endDate.value = end.toISOString().split('T')[0];
    //     this.startDate.value = start.toISOString().split('T')[0];
    // }



initializeDates() {
    const end = new Date();
    this.endDate.value = end.toISOString().split('T')[0]; // Set end date to today

    // Placeholder for database call to get start date
    const dbStartDate = this.getStartDateFromDatabase(); // Replace with actual database query

    let start;
    if (dbStartDate) {
        start = new Date(dbStartDate); // Parse database date
        if (isNaN(start)) {
            // Fallback if database date is invalid
            start = new Date();
            start.setDate(start.getDate() - 30);
        }
    } else {
        // Fallback if no date from database
        start = new Date();
        start.setDate(start.getDate() - 30);
    }

    this.startDate.value = start.toISOString().split('T')[0]; // Set start date
}

// Placeholder method for database query
getStartDateFromDatabase() {
    // Example: Replace with actual database logic (e.g., fetch, AJAX, or API call)
    // This should return a date string (e.g., '2025-05-27') or null/undefined if not found
    // For demo, returning a sample date
    return '2025-05-01'; // Replace with real database query
}




    

    setupListeners() {
        this.generateReportBtn.addEventListener('click', () => this.generateReport());
        this.exportReportBtn.addEventListener('click', () => this.printReport());
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
                returnedAt: Date.now(),
                actualReturnDate: new Date().toISOString()
            });

            // Update book availability
            await recalculateBookAvailability(bookId);

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
        const table = this.reportTable.querySelector('table');
        
        if (!table) {
            Swal.fire('Error', 'No report data to print', 'error');
            return;
        }

        // Call the enhanced export handler - it will extract data from reportManager
        handleExportEnhanced(null, reportTitle + (selectedGrade && selectedGrade !== 'all' ? ` - ${selectedGrade}` : ''));
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
            const student = await getStudentCached(studentId);
            if (student?.grade) grades.add(student.grade);
        }
        const gradeOptions = [...grades].sort((a, b) => a.localeCompare(b, { numeric: true }));

        let tableRows = [];
        let rowNumber = 1;
        for (const [key, issuance] of Object.entries(issuances).filter(([_, iss]) => {
            const issueDate = new Date(iss.issueDate);
            return issueDate >= start && issueDate <= end;
        })) {
            const student = await getStudentCached(issuance.studentId);
            const book = await getBookCached(issuance.bookId);
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
            const student = await getStudentCached(studentId);
            if (student?.grade) grades.add(student.grade);
        }
        const gradeOptions = [...grades].sort((a, b) => a.localeCompare(b, { numeric: true }));

        let tableRows = [];
        let rowNumber = 1;
        for (const [key, issuance] of Object.entries(issuances).filter(([_, iss]) => {
            const returnDate = new Date(iss.returnDate);
            return iss.status === 'active' && returnDate < currentDate;
        })) {
            const student = await getStudentCached(issuance.studentId);
            const book = await getBookCached(issuance.bookId);
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
            const student = await getStudentCached(studentId);
            if (student?.grade) grades.add(student.grade);
        }
        const gradeOptions = [...grades].sort((a, b) => a.localeCompare(b, { numeric: true }));

        let tableRows = [];
        let rowNumber = 1;
        for (const [key, issuance] of Object.entries(issuances).filter(([_, iss]) => 
            iss.status === 'lost'
        )) {
            const student = await getStudentCached(issuance.studentId);
            const book = await getBookCached(issuance.bookId);
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
        const students = StudentsCache.getAll();
        
        const issuances = issuanceSnapshot.val();
        
        let studentActivity = {};
        
        Object.entries(issuances).forEach(([key, issuance]) => {
            const issueDate = new Date(issuance.issueDate);
            if (issueDate >= start && issueDate <= end) {
                if (!studentActivity[issuance.studentId]) {
                    studentActivity[issuance.studentId] = {
                        student: students.get(issuance.studentId),
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
                    // Was deleting from the un-scoped 'students/{id}' path,
                    // which isn't where the real record lives (STUDENTS_PATH
                    // is 'artifacts/{appId}/students') — so this silently
                    // never actually removed the student. Also keep the
                    // denormalized student counter in sync, same as
                    // StudentManager.deleteStudent does.
                    await db.ref(`${STUDENTS_PATH}/${studentId}`).remove();
                    await db.ref(STUDENT_COUNT_PATH).transaction(current => Math.max(0, (current || 0) - 1));
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
// Lost Books Management
class LostBooksManager {
    constructor() {
        this.lostBooksModal = document.getElementById('lostBooksOverviewModal');
        this.lostBooksTableBody = document.getElementById('lostBooksTableBody');
        this.searchInput = document.getElementById('lostBooksSearch');
        this.filterSelect = document.getElementById('lostBooksFilter');
        this.totalCountElement = document.getElementById('lostBooksTotalCount');
        this.allLostBooks = [];
        this.filteredBooks = [];
        
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
            this.searchInput.addEventListener('input', () => this.applyFilters());
        }

        if (this.filterSelect) {
            this.filterSelect.addEventListener('change', () => this.applyFilters());
        }
    }

    applyFilters() {
        const searchTerm = this.searchInput.value.toLowerCase();
        const filterValue = this.filterSelect.value;

        let filteredBooks = [...this.allLostBooks];

        // Apply search filter
        if (searchTerm) {
            filteredBooks = filteredBooks.filter(item => {
                const studentName = item.student?.name?.toLowerCase() || '';
                const assessmentNo = item.student?.assessmentNo?.toLowerCase() || '';
                const grade = item.student?.grade?.toLowerCase() || '';
                const bookTitle = item.book?.title?.toLowerCase() || '';
                
                return studentName.includes(searchTerm) || 
                       assessmentNo.includes(searchTerm) ||
                       grade.includes(searchTerm) ||
                       bookTitle.includes(searchTerm);
            });
        }

        // Apply dropdown filter
        if (filterValue && filterValue !== 'all') {
            switch (filterValue) {
                case 'grade':
                    filteredBooks = filteredBooks.sort((a, b) => {
                        const gradeA = a.student?.grade || '';
                        const gradeB = b.student?.grade || '';
                        return gradeA.localeCompare(gradeB);
                    });
                    break;
                case 'student':
                    filteredBooks = filteredBooks.sort((a, b) => {
                        const nameA = a.student?.name || '';
                        const nameB = b.student?.name || '';
                        return nameA.localeCompare(nameB);
                    });
                    break;
                case 'book':
                    filteredBooks = filteredBooks.sort((a, b) => {
                        const titleA = a.book?.title || '';
                        const titleB = b.book?.title || '';
                        return titleA.localeCompare(titleB);
                    });
                    break;
                case 'issueDate':
                    filteredBooks = filteredBooks.sort((a, b) => {
                        const dateA = new Date(a.issuance.issueDate);
                        const dateB = new Date(b.issuance.issueDate);
                        return dateB - dateA; // Most recent first
                    });
                    break;
                case 'lostDate':
                    filteredBooks = filteredBooks.sort((a, b) => {
                        const dateA = new Date(a.issuance.lostDate || a.issuance.timestamp);
                        const dateB = new Date(b.issuance.lostDate || b.issuance.timestamp);
                        return dateB - dateA; // Most recent first
                    });
                    break;
                case 'recovered':
                    filteredBooks = filteredBooks.filter(item => item.issuance.recoveryStatus);
                    break;
                case 'pending':
                    filteredBooks = filteredBooks.filter(item => !item.issuance.recoveryStatus);
                    break;
                default:
                    // Default sort by timestamp (newest first)
                    filteredBooks = filteredBooks.sort((a, b) => b.issuance.timestamp - a.issuance.timestamp);
            }
        }

        this.filteredBooks = filteredBooks;
        this.updateTotalCount();
        this.renderLostBooksTable(filteredBooks);
    }

    updateTotalCount() {
        if (this.totalCountElement) {
            const total = this.filteredBooks.length;
            const totalAll = this.allLostBooks.length;
            
            if (total === totalAll) {
                this.totalCountElement.textContent = `Total: ${total} lost books`;
            } else {
                this.totalCountElement.textContent = `Showing: ${total} of ${totalAll} lost books`;
            }
        }
    }

    async showLostBooksModal() {
        this.lostBooksTableBody.innerHTML = '<tr><td colspan="8" class="text-center">Loading lost books...</td></tr>';
        this.lostBooksModal.classList.add('active');
        this.searchInput.value = '';
        if (this.filterSelect) this.filterSelect.value = 'all';
        
        try {
            const snapshot = await db.ref('issuance')
                .orderByChild('status')
                .equalTo('lost')
                .once('value');
            
            if (!snapshot.exists()) {
                this.lostBooksTableBody.innerHTML = '<tr><td colspan="8" class="text-center">No lost books found.</td></tr>';
                this.updateTotalCount();
                this.addLostBooksModalButtons();
                return;
            }

            this.allLostBooks = [];
            const promises = [];

            snapshot.forEach(childSnapshot => {
                const issuance = childSnapshot.val();
                promises.push(
                    Promise.all([
                        getStudentCached(issuance.studentId),
                        getBookCached(issuance.bookId)
                    ]).then(([student, book]) => {
                        if (student && book) {
                            this.allLostBooks.push({
                                id: childSnapshot.key,
                                issuance,
                                student,
                                book
                            });
                        }
                    }).catch(error => {
                        console.error('Error fetching related data:', error);
                    })
                );
            });

            await Promise.all(promises);

            if (this.allLostBooks.length === 0) {
                this.lostBooksTableBody.innerHTML = '<tr><td colspan="8" class="text-center">No valid lost book records found.</td></tr>';
                this.updateTotalCount();
                this.addLostBooksModalButtons();
                return;
            }

            this.allLostBooks.sort((a, b) => b.issuance.timestamp - a.issuance.timestamp);
            this.filteredBooks = [...this.allLostBooks];
            this.updateTotalCount();
            this.renderLostBooksTable(this.filteredBooks);
            
            // Add buttons AFTER data is loaded
            this.addLostBooksModalButtons();

        } catch (error) {
            console.error('Error loading lost books:', error);
            this.lostBooksTableBody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Error loading lost books. Please try again.</td></tr>';
            this.updateTotalCount();
            this.addLostBooksModalButtons();
        }
    }

    renderLostBooksTable(books) {
        if (books.length === 0) {
            this.lostBooksTableBody.innerHTML = '<tr><td colspan="8" class="text-center">No books match the current filter.</td></tr>';
            return;
        }

        this.lostBooksTableBody.innerHTML = books.map((item, index) => {
            const lostDate = new Date(item.issuance.lostDate || item.issuance.timestamp);
            const recoveryStatus = item.issuance.recoveryStatus;
            const recoveryMethod = item.issuance.recoveryMethod;

            return `
                <tr class="clickable-row" 
                    data-item-id="${item.id}" 
                    style="cursor: pointer;"
                    onclick="lostBooksManager.showRecoveryNotes('${item.id}')"
                    title="Click to view recovery notes">
                    <td><strong>${index + 1}</strong></td>
                    <td>${item.student?.grade || 'N/A'}</td>
                    <td>${item.student?.name || 'Unknown Student'}</td>
                    <td>${item.student?.assessmentNo || 'N/A'}</td>
                    <td>${item.book?.title || 'Unknown Book'}</td>
                    <td>${item.issuance.isbn || 'N/A'}</td>
                    <td>${item.issuance.issueDate}</td>
                    <td>${lostDate.toLocaleDateString()}</td>
                    <td class="${recoveryStatus ? 'text-success' : 'text-warning'}">
                        ${recoveryStatus ? `Recovered (${recoveryMethod})` : 'Pending'}
                    </td>
                    <td onclick="event.stopPropagation();">
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

        // Add hover effects for better UX
        this.addRowHoverEffects();
    }

    addRowHoverEffects() {
        const rows = this.lostBooksTableBody.querySelectorAll('.clickable-row');
        rows.forEach(row => {
            row.addEventListener('mouseenter', function() {
                this.style.backgroundColor = '#f8f9fa';
            });
            
            row.addEventListener('mouseleave', function() {
                this.style.backgroundColor = '';
            });
        });
    }

    addLostBooksModalButtons() {
        const modalHeader = this.lostBooksModal.querySelector('.modal-header');
        if (!modalHeader) return;

        // Remove existing action buttons if any
        const existingButtonGroup = modalHeader.querySelector('.lost-books-actions');
        if (existingButtonGroup) existingButtonGroup.remove();

        // Create button group
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'lost-books-actions d-flex gap-2';
        buttonGroup.innerHTML = `
            <button id="printLostBooksBtn" class="btn btn-primary btn-sm">
                <i class="bi bi-printer"></i> Print
            </button>
            <button id="exportLostBooksBtn" class="btn btn-info btn-sm">
                <i class="bi bi-download"></i> Export
            </button>
            <button id="addLostBookBtn" class="btn btn-success btn-sm">
                <i class="bi bi-plus-circle"></i> Add Lost Book
            </button>
        `;
        modalHeader.appendChild(buttonGroup);

        // Add event listeners
        document.getElementById('printLostBooksBtn').addEventListener('click', () => this.printLostBooks());
        document.getElementById('exportLostBooksBtn').addEventListener('click', () => this.handleLostBooksExport());
        document.getElementById('addLostBookBtn').addEventListener('click', () => this.showAddLostBookModal());
    }

    async printLostBooks() {
        const reportData = {
            headers: ['No.', 'Grade', 'Student Name', 'Assessment No.', 'Book Title', 'ISBN', 'Issue Date', 'Lost Date', 'Status'],
            body: this.filteredBooks.map((item, index) => [
                index + 1,
                item.student?.grade || 'N/A',
                item.student?.name || 'Unknown',
                item.student?.assessmentNo || 'N/A',
                item.book?.title || 'Unknown',
                item.issuance.isbn || 'N/A',
                item.issuance.issueDate || 'N/A',
                new Date(item.issuance.lostDate || item.issuance.timestamp).toLocaleDateString(),
                item.issuance.recoveryStatus ? `Recovered (${item.issuance.recoveryMethod})` : 'Pending'
            ]),
            statsInfo: {
                'Total Lost Books': this.filteredBooks.length,
                'Recovered': this.filteredBooks.filter(b => b.issuance.recoveryStatus).length,
                'Pending Recovery': this.filteredBooks.filter(b => !b.issuance.recoveryStatus).length
            }
        };

        await exportToPdfEnhanced(reportData, 'Lost Books Report');
    }

    async handleLostBooksExport() {
        const exportOptions = [
            { label: 'Export to PDF (Premium Format)', value: 'pdf', icon: '📄' },
            { label: 'Export to Excel (Premium Format)', value: 'excel', icon: '📊' },
            { label: 'Export to Word (Premium Format)', value: 'word', icon: '📝' },
            { label: 'Export as CSV', value: 'csv', icon: '📋' }
        ];

        let optionsHtml = '<div style="display: grid; gap: 10px;">';
        exportOptions.forEach(option => {
            optionsHtml += `
                <button class="export-btn" data-export-type="${option.value}" 
                        style="padding: 10px; border: 1px solid #ddd; border-radius: 5px; cursor: pointer; transition: all 0.3s;" 
                        onmouseover="this.style.backgroundColor='#e9ecef'; this.style.transform='translateX(5px)';" 
                        onmouseout="this.style.backgroundColor=''; this.style.transform='translateX(0)'">
                    ${option.icon} ${option.label}
                </button>
            `;
        });
        optionsHtml += '</div>';

        try {
            await Swal.fire({
                title: 'Export Lost Books',
                html: optionsHtml,
                icon: 'info',
                showConfirmButton: false,
                showCancelButton: true,
                cancelButtonText: 'Close',
                didOpen: () => {
                    // Add click handlers to buttons after they're created
                    const buttons = document.querySelectorAll('.export-btn');
                    buttons.forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            const exportType = e.target.closest('.export-btn').getAttribute('data-export-type');
                            this.executeLostBooksExport(exportType);
                        });
                    });
                }
            });
        } catch (error) {
            console.error('Export modal error:', error);
        }
    }

    async executeLostBooksExport(exportType) {
        try {
            // Debug: Check if filteredBooks has data
            console.log('FilteredBooks length:', this.filteredBooks.length);
            console.log('FilteredBooks data:', this.filteredBooks);

            // Build the report data BEFORE closing modal
            const reportData = {
                headers: ['No.', 'Grade', 'Student Name', 'Assessment No.', 'Book Title', 'ISBN', 'Issue Date', 'Lost Date', 'Status'],
                body: this.filteredBooks.map((item, index) => [
                    String(index + 1),
                    item.student?.grade || 'N/A',
                    item.student?.name || 'Unknown',
                    item.student?.assessmentNo || 'N/A',
                    item.book?.title || 'Unknown',
                    item.issuance.isbn || 'N/A',
                    item.issuance.issueDate || 'N/A',
                    new Date(item.issuance.lostDate || item.issuance.timestamp).toLocaleDateString(),
                    item.issuance.recoveryStatus ? `Recovered (${item.issuance.recoveryMethod})` : 'Pending'
                ]),
                statsInfo: {
                    'Total Lost Books': this.filteredBooks.length,
                    'Recovered': this.filteredBooks.filter(b => b.issuance.recoveryStatus).length,
                    'Pending Recovery': this.filteredBooks.filter(b => !b.issuance.recoveryStatus).length
                }
            };

            console.log('Report Data Body:', reportData.body);
            console.log('Report Data Body Length:', reportData.body.length);

            // Now close the modal
            Swal.close();

            // Execute the appropriate export
            switch(exportType) {
                case 'pdf':
                    await exportToPdfEnhanced(reportData, 'Lost Books Report');
                    break;
                case 'excel':
                    await exportToExcelEnhanced(reportData, 'Lost Books Report');
                    break;
                case 'word':
                    await exportToWordEnhanced(reportData, 'Lost Books Report');
                    break;
                case 'csv':
                    this.exportLostBooksToCSV(reportData);
                    break;
            }
            
            await Swal.fire({
                icon: 'success',
                title: 'Success',
                text: `Lost books exported to ${exportType.toUpperCase()}`,
                timer: 2000,
                showConfirmButton: false
            });
        } catch (error) {
            console.error('Export error:', error);
            console.log('Filtered Books:', this.filteredBooks);
            await Swal.fire({
                icon: 'error',
                title: 'Export Failed',
                text: 'Failed to export lost books: ' + error.message
            });
        }
    }

    exportLostBooksToCSV(reportData) {
        let csv = reportData.headers.join(',') + '\n';
        reportData.body.forEach(row => {
            csv += row.map(cell => `"${cell}"`).join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `lost_books_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async showAddLostBookModal() {
        try {
            const modal = new bootstrap.Modal(document.getElementById('addLostBookModal'));
            const form = document.getElementById('addLostBookForm');
            const studentSelect = document.getElementById('lostBookStudentSelect');
            const bookSelect = document.getElementById('lostBookBookSelect');
            const submitBtn = document.getElementById('submitLostBookBtn');

            // Clear form
            form.reset();

            // Populate students (from the synced cache — no fresh network read)
            studentSelect.innerHTML = '<option value="">Select Student</option>';
            StudentsCache.getAll().forEach((student, studentId) => {
                const studentName = student.fullName || student.name || 'Unknown';
                const grade = student.grade || 'N/A';
                const assessmentNo = student.assessmentNo || '';
                studentSelect.innerHTML += `<option value="${studentId}" data-grade="${grade}" data-assessment="${assessmentNo}">${grade} - ${studentName} (${assessmentNo})</option>`;
            });

            // Populate books
            const booksSnapshot = await db.ref('books').once('value');
            bookSelect.innerHTML = '<option value="">Select Book</option>';
            if (booksSnapshot.exists()) {
                booksSnapshot.forEach(childSnapshot => {
                    const book = childSnapshot.val();
                    const bookId = childSnapshot.key;
                    const bookTitle = book.title || 'Unknown';
                    const isbn = book.isbn || 'N/A';
                    bookSelect.innerHTML += `<option value="${bookId}" data-isbn="${isbn}">${bookTitle} (${isbn})</option>`;
                });
            }

            // Update ISBN when book is selected
            bookSelect.addEventListener('change', (e) => {
                const selectedOption = e.target.options[e.target.selectedIndex];
                const isbn = selectedOption.getAttribute('data-isbn');
                document.getElementById('lostBookISBN').value = isbn || '';
            });

            // Handle form submission
            submitBtn.onclick = async () => {
                const studentId = studentSelect.value;
                const bookId = bookSelect.value;
                const lostDate = document.getElementById('lostBookDate').value;
                const notes = document.getElementById('lostBookNotes').value;
                const conditionField = document.getElementById('lostBookCondition');
                const condition = conditionField ? conditionField.value : '';

                if (!studentId || !bookId || !lostDate) {
                    await Swal.fire('Validation Error', 'Please fill in all required fields', 'warning');
                    return;
                }

                try {
                    // Create new lost book record
                    const newIssuanceId = db.ref('issuance').push().key;
                    
                    const lostBookRecord = {
                        studentId: studentId,
                        bookId: bookId,
                        status: 'lost',
                        lostDate: lostDate,
                        notes: notes,
                        condition: condition,
                        recoveryStatus: false,
                        timestamp: new Date().getTime(),
                        issueDate: document.getElementById('lostBookIssueDate').value || new Date().toISOString().split('T')[0]
                    };

                    await db.ref(`issuance/${newIssuanceId}`).set(lostBookRecord);

                    await Swal.fire('Success', 'Lost book record created successfully', 'success');
                    modal.hide();
                    
                    // Refresh the lost books list
                    await this.showLostBooksModal();
                } catch (error) {
                    console.error('Error creating lost book record:', error);
                    await Swal.fire('Error', 'Failed to create lost book record: ' + error.message, 'error');
                }
            };

            modal.show();
        } catch (error) {
            console.error('Error showing add lost book modal:', error);
            await Swal.fire('Error', 'Failed to load add lost book form: ' + error.message, 'error');
        }
    }

    async deleteLostBook(issuanceId, bookId) {
        const confirm = await Swal.fire({
            icon: 'question',
            title: 'Delete Lost Book Record',
            text: 'Are you sure you want to delete this lost book record?',
            showCancelButton: true,
            confirmButtonText: 'Yes, Delete',
            cancelButtonText: 'Cancel'
        });

        if (!confirm.isConfirmed) return;

        try {
            await db.ref(`issuance/${issuanceId}`).remove();
            await Swal.fire('Success', 'Lost book record deleted successfully', 'success');
            await this.showLostBooksModal();
        } catch (error) {
            console.error('Error deleting lost book:', error);
            await Swal.fire('Error', 'Failed to delete lost book record: ' + error.message, 'error');
        }
    }

    async showRecoveryNotes(issuanceId) {
        try {
            // Show loading indicator
            Swal.fire({
                title: 'Loading...',
                text: 'Fetching recovery notes',
                allowOutsideClick: false,
                allowEscapeKey: false,
                showConfirmButton: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            // Fetch the issuance record directly from database
            const issuanceSnapshot = await db.ref(`issuance/${issuanceId}`).once('value');
            
            if (!issuanceSnapshot.exists()) {
                await Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Lost book record not found in database.',
                    timer: 2000,
                    showConfirmButton: false
                });
                return;
            }

            const issuance = issuanceSnapshot.val();

            // Fetch related student and book data
            const [student, book] = await Promise.all([
                getStudentCached(issuance.studentId),
                getBookCached(issuance.bookId)
            ]);

            // Prepare the content for the modal
            const lostDate = new Date(issuance.lostDate || issuance.timestamp);
            const recoveryStatus = issuance.recoveryStatus;
            const recoveryNotes = issuance.recoveryNotes || 'No recovery notes available.';
            const recoveryMethod = issuance.recoveryMethod || 'N/A';
            const recoveryDate = issuance.recoveryDate ? new Date(issuance.recoveryDate).toLocaleDateString() : 'N/A';

            // Create detailed modal content
            const modalContent = `
                <div class="recovery-notes-content">
                    <h5 class="mb-3"><i class="bi bi-book"></i> Lost Book Details</h5>
                    
                    <div class="row mb-3">
                        <div class="col-md-6">
                            <strong>Student:</strong> ${student?.name || 'Unknown Student'}<br>
                            <strong>Father's Phone Number:</strong> ${student?.FathersPhoneNumber || 'Unknown Number'}<br>
                            <strong>Grade:</strong> ${student?.grade || 'N/A'}<br>
                            <strong>Assessment No:</strong> ${student?.assessmentNo || 'N/A'}
                        </div>
                        <div class="col-md-6">
                            <strong>Book:</strong> ${book?.title || 'Unknown Book'}<br>
                            <strong>ISBN:</strong> ${issuance.isbn || 'N/A'}<br>
                            <strong>Issue Date:</strong> ${issuance.issueDate || 'N/A'}
                        </div>
                    </div>

                    <div class="row mb-3">
                        <div class="col-md-6">
                            <strong>Lost Date:</strong> ${lostDate.toLocaleDateString()}
                        </div>
                        <div class="col-md-6">
                            <strong>Status:</strong> 
                            <span class="${recoveryStatus ? 'text-success' : 'text-warning'}">
                                ${recoveryStatus ? 'Recovered' : 'Pending Recovery'}
                            </span>
                        </div>
                    </div>

                    ${recoveryStatus ? `
                        <div class="recovery-info bg-light p-3 rounded mb-3">
                            <h6><i class="bi bi-check-circle"></i> Recovery Information</h6>
                            <p><strong>Recovery Method:</strong> ${recoveryMethod}</p>
                            <p><strong>Recovery Date:</strong> ${recoveryDate}</p>
                        </div>
                    ` : ''}

                    <div class="notes-section">
                        <h6><i class="bi bi-journal-text"></i> Recovery Notes</h6>
                        <div class="notes-content bg-transparent p-10 m-[10px] w-[calc(100%-20px)] rounded" style="min-height: 100px; white-space: pre-wrap;">
                            ${recoveryNotes}
                        </div>
                    </div>

                    ${!recoveryStatus ? `
                        <div class="mt-3 text-center">
                            <button class="btn btn-warning" onclick="Swal.close(); lostBooksManager.handleRecoveryClick('${issuanceId}');">
                                <i class="bi bi-plus-circle"></i> Record Recovery
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;

            // Close loading and show the modal
            await Swal.fire({
                title: 'Recovery Notes',
                html: modalContent,
                width: '800px',
                showCloseButton: true,
                showConfirmButton: false,
                customClass: {
                    popup: 'recovery-notes-modal'
                }
            });

        } catch (error) {
            console.error('Error showing recovery notes:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to load recovery notes. Please try again.',
                timer: 2000,
                showConfirmButton: false
            });
        }
    }

    handleRecoveryClick(issuanceId) {
        this.lostBooksModal.classList.remove('active');
        setTimeout(() => {
            // Check if issuanceManager exists and has showRecoveryModal method
            if (window.issuanceManager && typeof window.issuanceManager.showRecoveryModal === 'function') {
                window.issuanceManager.showRecoveryModal(issuanceId);
            } else {
                // Fallback: show our own recovery modal
                this.showRecoveryModal(issuanceId);
            }
        }, 300);
    }

    async showRecoveryModal(issuanceId) {
        try {
            // Fetch the issuance record
            const issuanceSnapshot = await db.ref(`issuance/${issuanceId}`).once('value');
            if (!issuanceSnapshot.exists()) {
                await Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Lost book record not found.',
                    timer: 2000,
                    showConfirmButton: false
                });
                return;
            }

            const issuance = issuanceSnapshot.val();

            // Fetch related student and book data
            const [student, book] = await Promise.all([
                getStudentCached(issuance.studentId),
                getBookCached(issuance.bookId)
            ]);

            if (!student || !book) {
                await Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Student or book data not found.',
                    timer: 2000,
                    showConfirmButton: false
                });
                return;
            }

            // Create recovery modal content
            const modalContent = `
                <div class="recovery-modal-content">
                    <h5 class="mb-3"><i class="bi bi-arrow-clockwise"></i> Record Book Recovery</h5>
                    
                    <div class="book-details bg-light p-3 rounded mb-3">
                        <div class="row">
                            <div class="col-md-6">
                                <strong>Student:</strong> ${student.name}<br>
                                <strong>Grade:</strong> ${student.grade}<br>
                                <strong>Assessment No:</strong> ${student.assessmentNo}
                            </div>
                            <div class="col-md-6">
                                <strong>Book:</strong> ${book.title}<br>
                                <strong>ISBN:</strong> ${issuance.isbn || 'N/A'}<br>
                                <strong>Issue Date:</strong> ${issuance.issueDate}
                            </div>
                        </div>
                    </div>

                    <form id="recoveryForm">
                        <div class="mb-3">
                            <label for="recoveryMethod" class="form-label">Recovery Method *</label>
                            <select id="recoveryMethod" class="form-select" required>
                                <option value="">Select recovery method...</option>
                                <option value="found">Book Found</option>
                                <option value="replaced">Book Replaced</option>
                                <option value="paid">Compensation Paid</option>
                                <option value="other">Other</option>
                            </select>
                        </div>

                        <div class="mb-3">
                            <label for="recoveryNotes" class="form-label">Recovery Notes</label>
                            <textarea id="recoveryNotes" class="form-control" rows="4" 
                                placeholder="Enter details about the recovery (optional)..."></textarea>
                        </div>

                        <div class="text-end">
                            <button type="button" class="btn btn-secondary me-2" onclick="Swal.close()">Cancel</button>
                            <button type="submit" class="btn btn-success">Record Recovery</button>
                        </div>
                    </form>
                </div>
            `;

            const result = await Swal.fire({
                title: '',
                html: modalContent,
                width: '600px',
                showCloseButton: true,
                showConfirmButton: false,
                allowOutsideClick: false,
                didOpen: () => {
                    // Handle form submission
                    const form = document.getElementById('recoveryForm');
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        
                        const recoveryMethod = document.getElementById('recoveryMethod').value;
                        const recoveryNotes = document.getElementById('recoveryNotes').value;

                        if (!recoveryMethod) {
                            await Swal.fire({
                                icon: 'warning',
                                title: 'Missing Information',
                                text: 'Please select a recovery method.',
                                timer: 2000,
                                showConfirmButton: false
                            });
                            return;
                        }

                        // Close current modal and process recovery
                        Swal.close();
                        await this.handleBookRecovery(issuanceId, recoveryMethod, recoveryNotes);
                    });
                }
            });

        } catch (error) {
            console.error('Error showing recovery modal:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to load recovery modal. Please try again.',
                timer: 2000,
                showConfirmButton: false
            });
        }
    }

    async handleBookRecovery(issuanceId, recoveryMethod, notes) {
        try {
            // Show loading
            Swal.fire({
                title: 'Processing...',
                text: 'Recording book recovery',
                allowOutsideClick: false,
                allowEscapeKey: false,
                showConfirmButton: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            // Get the issuance record
            const issuanceSnapshot = await db.ref(`issuance/${issuanceId}`).once('value');
            const issuance = issuanceSnapshot.val();

            if (!issuance) {
                throw new Error('Issuance record not found');
            }

            // Update the issuance record with recovery information
            const updates = {
                recoveryStatus: true,
                recoveryMethod,
                recoveryNotes: notes || '',
                recoveryDate: new Date().toISOString(),
                updatedAt: Date.now()
            };

            await db.ref(`issuance/${issuanceId}`).update(updates);

            // If book was found or replaced, update book availability
            if (recoveryMethod === 'found' || recoveryMethod === 'replaced') {
                const bookRef = db.ref(`books/${issuance.bookId}`);
                const bookSnapshot = await bookRef.once('value');
                const book = bookSnapshot.val();
                
                if (book) {
                    await bookRef.update({
                        lost: Math.max(0, (book.lost || 0) - 1),
                        updatedAt: Date.now()
                    });
                    await recalculateBookAvailability(issuance.bookId);
                }
            }

            await Swal.fire({
                icon: 'success',
                title: 'Success!',
                text: 'Book recovery recorded successfully.',
                timer: 2000,
                showConfirmButton: false
            });

            // Refresh the lost books table to show updated status
            this.showLostBooksModal();

        } catch (error) {
            console.error('Error handling book recovery:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to record book recovery. Please try again.',
                timer: 2000,
                showConfirmButton: false
            });
        }
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
                    icon: 'warning',
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

// Initialize the lost books manager
const lostBooksManager = new LostBooksManager();








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