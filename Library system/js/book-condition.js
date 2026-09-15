class BookConditionManager {
    constructor() {
        this.db = firebase.database();
        this.bookId = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadBookConditions();
        this.updateConditionStatistics();
        this.populateCategoryFilter();
    }

    setupEventListeners() {
        // Bulk condition update button
        document.getElementById('bulkConditionUpdateBtn')?.addEventListener('click', () => this.showBulkConditionModal());
        
        // Condition report button
        document.getElementById('conditionReportBtn')?.addEventListener('click', () => this.generateConditionReport());
        
        // Confirm condition update
        document.getElementById('confirmConditionUpdateBtn')?.addEventListener('click', () => this.confirmConditionUpdate());
        
        // Confirm bulk condition update
        document.getElementById('confirmBulkConditionBtn')?.addEventListener('click', () => this.confirmBulkConditionUpdate());
        
        // Filters
        document.getElementById('conditionFilter')?.addEventListener('change', () => this.loadBookConditions());
        document.getElementById('conditionCategoryFilter')?.addEventListener('change', () => this.loadBookConditions());
        
        // Bulk filter type change
        document.getElementById('bulkConditionFilter')?.addEventListener('change', () => this.handleBulkFilterChange());
        
        // Preview bulk update
        document.getElementById('bulkNewCondition')?.addEventListener('change', () => this.previewBulkUpdate());
        document.getElementById('bulkConditionFilter')?.addEventListener('change', () => this.previewBulkUpdate());
        document.getElementById('bulkFilterValue')?.addEventListener('change', () => this.previewBulkUpdate());
    }

    async populateCategoryFilter() {
        try {
            const categorySelect = document.getElementById('conditionCategoryFilter');
            if (!categorySelect) return;

            const booksSnapshot = await this.db.ref('books').once('value');
            const categories = new Set();

            if (booksSnapshot.exists()) {
                booksSnapshot.forEach(child => {
                    const book = child.val();
                    if (book.category) {
                        categories.add(book.category);
                    }
                });
            }

            // Clear existing options except first
            while (categorySelect.options.length > 1) {
                categorySelect.remove(1);
            }

            // Add categories
            Array.from(categories).sort().forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                categorySelect.appendChild(option);
            });
        } catch (error) {
            console.error('Error populating category filter:', error);
        }
    }

    async loadBookConditions() {
        try {
            const conditionFilter = document.getElementById('conditionFilter')?.value || '';
            const categoryFilter = document.getElementById('conditionCategoryFilter')?.value || '';
            const container = document.getElementById('bookConditionList');
            
            if (!container) return;

            container.innerHTML = '<p class="text-muted">Loading book conditions…</p>';

            const booksSnapshot = await this.db.ref('books').once('value');
            const books = [];

            if (booksSnapshot.exists()) {
                booksSnapshot.forEach(child => {
                    const book = child.val();
                    book.id = child.key;
                    books.push(book);
                });
            }

            // Apply filters
            let filteredBooks = books;
            if (conditionFilter) {
                filteredBooks = books.filter(book => (book.condition || 'good') === conditionFilter);
            }
            if (categoryFilter) {
                filteredBooks = filteredBooks.filter(book => book.category === categoryFilter);
            }

            // Sort by condition priority (worse conditions first)
            const conditionPriority = { lost: 0, damaged: 1, retired: 2, fair: 3, good: 4, new: 5 };
            filteredBooks.sort((a, b) => {
                const aPriority = conditionPriority[a.condition || 'good'] || 3;
                const bPriority = conditionPriority[b.condition || 'good'] || 3;
                return aPriority - bPriority;
            });

            if (filteredBooks.length === 0) {
                container.innerHTML = '<p class="text-muted">No books found matching the criteria.</p>';
                return;
            }

            container.innerHTML = filteredBooks.map(book => this.renderConditionCard(book)).join('');

            // Add event listeners
            filteredBooks.forEach(book => {
                document.getElementById(`updateCondition-${book.id}`)?.addEventListener('click', () => this.showUpdateConditionModal(book));
                document.getElementById(`viewConditionHistory-${book.id}`)?.addEventListener('click', () => this.viewConditionHistory(book));
            });

        } catch (error) {
            console.error('Error loading book conditions:', error);
            const container = document.getElementById('bookConditionList');
            if (container) {
                container.innerHTML = '<p class="text-danger">Error loading book conditions. Please try again.</p>';
            }
        }
    }

    renderConditionCard(book) {
        const condition = book.condition || 'good';
        const conditionColors = {
            new: 'success',
            good: 'primary',
            fair: 'info',
            damaged: 'warning',
            lost: 'danger',
            retired: 'secondary'
        };

        const conditionLabels = {
            new: 'New',
            good: 'Good',
            fair: 'Fair (worn)',
            damaged: 'Damaged',
            lost: 'Lost',
            retired: 'Retired'
        };

        const needsAttention = ['damaged', 'lost', 'fair'].includes(condition);
        const lastUpdated = book.conditionUpdatedAt ? new Date(book.conditionUpdatedAt).toLocaleDateString() : 'Not recorded';

        return `
            <div class="card mb-3 ${needsAttention ? 'border-warning' : ''}">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start  ">
                        <div>
                            <h5 class="card-title">${book.title}</h5>
                            <p class="card-text mb-1">
                                <strong>Author:</strong> ${book.author || 'Not specified'} | 
                                <strong>ISBN:</strong> ${book.isbn || 'Not specified'} |
                                <strong>Category:</strong> ${book.category || 'Not specified'}
                            </p>
                            <p class="card-text mb-1">
                                <strong>Condition:</strong> <span class="badge bg-${conditionColors[condition]}">${conditionLabels[condition]}</span> |
                                <strong>Quantity:</strong> ${book.quantity || 0} |
                                <strong>Available:</strong> ${book.available || 0}
                            </p>
                            ${book.conditionNotes ? `<p class="card-text mb-1"><strong>Notes:</strong> ${book.conditionNotes}</p>` : ''}
                            <p class="card-text mb-1">
                                <small class="text-muted">
                                    Last Updated: ${lastUpdated} |
                                    ${needsAttention ? '<span class="text-warning">⚠️ Needs Attention</span>' : ''}
                                </small>
                            </p>
                        </div>
                    </div>
                    <div class="mt-3">
                        <button id="updateCondition-${book.id}" class="btn btn-sm btn-primary">
                            <i class="bi bi-pencil"></i> Update Condition
                        </button>
                        <button id="viewConditionHistory-${book.id}" class="btn btn-sm btn-outline-info">
                            <i class="bi bi-clock-history"></i> History
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    async updateConditionStatistics() {
        try {
            const booksSnapshot = await this.db.ref('books').once('value');
            let newCount = 0;
            let goodCount = 0;
            let needsAttentionCount = 0;
            let retiredLostCount = 0;

            if (booksSnapshot.exists()) {
                booksSnapshot.forEach(child => {
                    const book = child.val();
                    const condition = book.condition || 'good';
                    
                    switch (condition) {
                        case 'new':
                            newCount++;
                            break;
                        case 'good':
                            goodCount++;
                            break;
                        case 'fair':
                        case 'damaged':
                            needsAttentionCount++;
                            break;
                        case 'lost':
                        case 'retired':
                            retiredLostCount++;
                            break;
                    }
                });
            }

            document.getElementById('newBooksCount').textContent = newCount;
            document.getElementById('goodConditionCount').textContent = goodCount;
            document.getElementById('needsAttentionCount').textContent = needsAttentionCount;
            document.getElementById('retiredLostCount').textContent = retiredLostCount;

        } catch (error) {
            console.error('Error updating condition statistics:', error);
        }
    }

    showUpdateConditionModal(book) {
        this.bookId = book.id;
        
        const detailsHtml = `
            <div class="row">
                <div class="col-md-6">
                    <p><strong>Title:</strong> ${book.title}</p>
                    <p><strong>Author:</strong> ${book.author || 'Not specified'}</p>
                    <p><strong>ISBN:</strong> ${book.isbn || 'Not specified'}</p>
                </div>
                <div class="col-md-6">
                    <p><strong>Current Condition:</strong> ${book.condition || 'good'}</p>
                    <p><strong>Quantity:</strong> ${book.quantity || 0}</p>
                    <p><strong>Available:</strong> ${book.available || 0}</p>
                </div>
            </div>
            ${book.conditionNotes ? `<p><strong>Current Notes:</strong> ${book.conditionNotes}</p>` : ''}
        `;

        document.getElementById('conditionBookDetails').innerHTML = detailsHtml;
        document.getElementById('newCondition').value = book.condition || 'good';
        document.getElementById('conditionNotes').value = '';
        document.getElementById('conditionAction').value = '';

        const modal = new bootstrap.Modal(document.getElementById('updateConditionModal'));
        modal.show();
    }

    async confirmConditionUpdate() {
        try {
            const newCondition = document.getElementById('newCondition').value;
            const notes = document.getElementById('conditionNotes').value.trim();
            const action = document.getElementById('conditionAction').value;

            if (!newCondition) {
                await Swal.fire({
                    icon: 'warning',
                    title: 'Missing Information',
                    text: 'Please select a new condition'
                });
                return;
            }

            if (!this.bookId) {
                throw new Error('No book selected');
            }

            // Get current book data
            const bookSnapshot = await this.db.ref(`books/${this.bookId}`).once('value');
            const book = bookSnapshot.val();

            if (!book) {
                throw new Error('Book not found');
            }

            // Create condition history entry
            const historyId = this.db.ref(`books/${this.bookId}/conditionHistory`).push().key;
            const historyEntry = {
                fromCondition: book.condition || 'good',
                toCondition: newCondition,
                notes,
                action,
                updatedBy: firebase.auth().currentUser?.uid || 'admin',
                updatedByName: firebase.auth().currentUser?.displayName || 'Admin',
                updatedAt: Date.now()
            };

            // Update book
            const updateData = {
                condition: newCondition,
                conditionNotes: notes,
                conditionAction: action,
                conditionUpdatedAt: Date.now(),
                [`conditionHistory/${historyId}`]: historyEntry
            };

            // Handle special actions
            if (action === 'remove' || action === 'retire') {
                updateData.available = 0;
            } else if (action === 'replace') {
                // Could trigger replacement workflow
                updateData.needsReplacement = true;
            }

            await this.db.ref(`books/${this.bookId}`).update(updateData);

            bootstrap.Modal.getInstance(document.getElementById('updateConditionModal')).hide();
            await this.loadBookConditions();
            await this.updateConditionStatistics();

            await Swal.fire({
                icon: 'success',
                title: 'Condition Updated',
                text: `Book condition updated to ${newCondition}`,
                timer: 2000,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('Error updating condition:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to update condition: ' + error.message
            });
        }
    }

    async showBulkConditionModal() {
        try {
            const modal = new bootstrap.Modal(document.getElementById('bulkConditionModal'));
            document.getElementById('bulkConditionFilter').value = 'all';
            document.getElementById('bulkNewCondition').value = '';
            document.getElementById('bulkConditionNotes').value = '';
            document.getElementById('bulkFilterOptions').style.display = 'none';
            document.getElementById('bulkUpdatePreview').textContent = '0 books will be updated';

            // Populate filter options based on selection
            await this.populateBulkFilterOptions();

            modal.show();
        } catch (error) {
            console.error('Error showing bulk condition modal:', error);
        }
    }

    async populateBulkFilterOptions() {
        try {
            const filterType = document.getElementById('bulkConditionFilter').value;
            const filterOptions = document.getElementById('bulkFilterOptions');
            const filterLabel = document.getElementById('bulkFilterLabel');
            const filterValue = document.getElementById('bulkFilterValue');

            filterOptions.style.display = 'none';
            filterValue.innerHTML = '';

            if (filterType === 'all') {
                return;
            }

            filterOptions.style.display = 'block';

            switch (filterType) {
                case 'category':
                    filterLabel.textContent = 'Select Category';
                    const categories = new Set();
                    const booksSnapshot = await this.db.ref('books').once('value');
                    if (booksSnapshot.exists()) {
                        booksSnapshot.forEach(child => {
                            const book = child.val();
                            if (book.category) categories.add(book.category);
                        });
                    }
                    Array.from(categories).sort().forEach(cat => {
                        const option = document.createElement('option');
                        option.value = cat;
                        option.textContent = cat;
                        filterValue.appendChild(option);
                    });
                    break;

                case 'current_condition':
                    filterLabel.textContent = 'Select Current Condition';
                    const conditions = ['new', 'good', 'fair', 'damaged', 'lost', 'retired'];
                    conditions.forEach(cond => {
                        const option = document.createElement('option');
                        option.value = cond;
                        option.textContent = cond.charAt(0).toUpperCase() + cond.slice(1);
                        filterValue.appendChild(option);
                    });
                    break;

                case 'age':
                    filterLabel.textContent = 'Older Than (Days)';
                    filterValue.innerHTML = `
                        <option value="30">30 days</option>
                        <option value="90">90 days</option>
                        <option value="180">180 days</option>
                        <option value="365">1 year</option>
                        <option value="730">2 years</option>
                    `;
                    break;
            }
        } catch (error) {
            console.error('Error populating bulk filter options:', error);
        }
    }

    handleBulkFilterChange() {
        this.populateBulkFilterOptions();
    }

    async previewBulkUpdate() {
        try {
            const filterType = document.getElementById('bulkConditionFilter').value;
            const filterValue = document.getElementById('bulkFilterValue').value;
            const newCondition = document.getElementById('bulkNewCondition').value;

            if (!newCondition) {
                document.getElementById('bulkUpdatePreview').textContent = 'Please select a new condition';
                return;
            }

            const booksSnapshot = await this.db.ref('books').once('value');
            let count = 0;

            if (booksSnapshot.exists()) {
                booksSnapshot.forEach(child => {
                    const book = child.val();
                    let include = true;

                    switch (filterType) {
                        case 'category':
                            include = book.category === filterValue;
                            break;
                        case 'current_condition':
                            include = (book.condition || 'good') === filterValue;
                            break;
                        case 'age':
                            if (book.createdAt) {
                                const age = (Date.now() - book.createdAt) / (1000 * 60 * 60 * 24);
                                include = age > parseInt(filterValue);
                            } else {
                                include = false;
                            }
                            break;
                    }

                    if (include) {
                        count++;
                    }
                });
            }

            document.getElementById('bulkUpdatePreview').textContent = `${count} books will be updated to ${newCondition}`;

        } catch (error) {
            console.error('Error previewing bulk update:', error);
        }
    }

    async confirmBulkConditionUpdate() {
        try {
            const filterType = document.getElementById('bulkConditionFilter').value;
            const filterValue = document.getElementById('bulkFilterValue').value;
            const newCondition = document.getElementById('bulkNewCondition').value;
            const notes = document.getElementById('bulkConditionNotes').value.trim();

            if (!newCondition) {
                await Swal.fire({
                    icon: 'warning',
                    title: 'Missing Information',
                    text: 'Please select a new condition'
                });
                return;
            }

            const result = await Swal.fire({
                title: 'Confirm Bulk Update',
                text: 'This will update the condition of multiple books. Continue?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#3085d6',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Yes, Update All'
            });

            if (!result.isConfirmed) return;

            const booksSnapshot = await this.db.ref('books').once('value');
            let updatedCount = 0;

            if (booksSnapshot.exists()) {
                const updates = [];

                booksSnapshot.forEach(child => {
                    const book = child.val();
                    let include = true;

                    switch (filterType) {
                        case 'category':
                            include = book.category === filterValue;
                            break;
                        case 'current_condition':
                            include = (book.condition || 'good') === filterValue;
                            break;
                        case 'age':
                            if (book.createdAt) {
                                const age = (Date.now() - book.createdAt) / (1000 * 60 * 60 * 24);
                                include = age > parseInt(filterValue);
                            } else {
                                include = false;
                            }
                            break;
                    }

                    if (include) {
                        const historyId = this.db.ref(`books/${child.key}/conditionHistory`).push().key;
                        const historyEntry = {
                            fromCondition: book.condition || 'good',
                            toCondition: newCondition,
                            notes: notes || 'Bulk update',
                            action: 'bulk_update',
                            updatedBy: firebase.auth().currentUser?.uid || 'admin',
                            updatedByName: firebase.auth().currentUser?.displayName || 'Admin',
                            updatedAt: Date.now()
                        };

                        const updateData = {
                            condition: newCondition,
                            conditionNotes: notes || 'Bulk update',
                            conditionUpdatedAt: Date.now(),
                            [`conditionHistory/${historyId}`]: historyEntry
                        };

                        updates.push(
                            this.db.ref(`books/${child.key}`).update(updateData)
                        );
                        updatedCount++;
                    }
                });

                await Promise.all(updates);
            }

            bootstrap.Modal.getInstance(document.getElementById('bulkConditionModal')).hide();
            await this.loadBookConditions();
            await this.updateConditionStatistics();

            await Swal.fire({
                icon: 'success',
                title: 'Bulk Update Complete',
                text: `Updated ${updatedCount} books to ${newCondition}`,
                timer: 3000,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('Error performing bulk condition update:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to perform bulk update: ' + error.message
            });
        }
    }

    async viewConditionHistory(book) {
        try {
            const historySnapshot = await this.db.ref(`books/${book.id}/conditionHistory`).once('value');
            const history = [];

            if (historySnapshot.exists()) {
                historySnapshot.forEach(child => {
                    history.push({
                        id: child.key,
                        ...child.val()
                    });
                });
            }

            // Sort by date (newest first)
            history.sort((a, b) => b.updatedAt - a.updatedAt);

            const historyHtml = history.length > 0 ? history.map(entry => `
                <tr>
                    <td>${new Date(entry.updatedAt).toLocaleString()}</td>
                    <td><span class="badge bg-secondary">${entry.fromCondition}</span></td>
                    <td><span class="badge bg-primary">${entry.toCondition}</span></td>
                    <td>${entry.updatedByName || 'Unknown'}</td>
                    <td>${entry.action || 'N/A'}</td>
                    <td>${entry.notes || 'No notes'}</td>
                </tr>
            `).join('') : '<tr><td colspan="6" class="text-center">No condition history available</td></tr>';

            const detailsHtml = `
                <div class="row mb-3">
                    <div class="col-md-6">
                        <h6>Book Information</h6>
                        <p><strong>Title:</strong> ${book.title}</p>
                        <p><strong>Author:</strong> ${book.author || 'Not specified'}</p>
                        <p><strong>Current Condition:</strong> ${book.condition || 'good'}</p>
                    </div>
                    <div class="col-md-6">
                        <h6>Statistics</h6>
                        <p><strong>Total Updates:</strong> ${history.length}</p>
                        <p><strong>Last Updated:</strong> ${book.conditionUpdatedAt ? new Date(book.conditionUpdatedAt).toLocaleString() : 'Not recorded'}</p>
                    </div>
                </div>
                <h6>Condition History</h6>
                <div class="table-responsive">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>From</th>
                                <th>To</th>
                                <th>Updated By</th>
                                <th>Action</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${historyHtml}
                        </tbody>
                    </table>
                </div>
            `;

            Swal.fire({
                title: 'Condition History',
                html: detailsHtml,
                width: '900px',
                showConfirmButton: true,
                confirmButtonText: 'Close'
            });

        } catch (error) {
            console.error('Error viewing condition history:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to load condition history: ' + error.message
            });
        }
    }

    async generateConditionReport() {
        try {
            const booksSnapshot = await this.db.ref('books').once('value');
            const books = [];

            if (booksSnapshot.exists()) {
                booksSnapshot.forEach(child => {
                    const book = child.val();
                    book.id = child.key;
                    books.push(book);
                });
            }

            // Calculate statistics
            const conditionStats = {
                new: 0,
                good: 0,
                fair: 0,
                damaged: 0,
                lost: 0,
                retired: 0
            };

            books.forEach(book => {
                const condition = book.condition || 'good';
                conditionStats[condition] = (conditionStats[condition] || 0) + 1;
            });

            const reportData = {
                headers: ['Title', 'Author', 'ISBN', 'Category', 'Current Condition', 'Quantity', 'Available', 'Last Updated'],
                body: books.map(book => [
                    book.title,
                    book.author || 'Not specified',
                    book.isbn || 'Not specified',
                    book.category || 'Not specified',
                    book.condition || 'good',
                    book.quantity || 0,
                    book.available || 0,
                    book.conditionUpdatedAt ? new Date(book.conditionUpdatedAt).toLocaleDateString() : 'Not recorded'
                ]),
                statsInfo: {
                    'Total Books': books.length,
                    'New Condition': conditionStats.new,
                    'Good Condition': conditionStats.good,
                    'Fair Condition': conditionStats.fair,
                    'Damaged': conditionStats.damaged,
                    'Lost': conditionStats.lost,
                    'Retired': conditionStats.retired,
                    'Needs Attention': conditionStats.fair + conditionStats.damaged
                }
            };

            await exportToPdfEnhanced(reportData, 'Book Condition Report');

            await Swal.fire({
                icon: 'success',
                title: 'Report Generated',
                text: 'Book condition report has been generated',
                timer: 2000,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('Error generating condition report:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to generate report: ' + error.message
            });
        }
    }
}

// Initialize the book condition manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.bookConditionManager = new BookConditionManager();
});