class BookRequestManager {
    constructor() {
        this.db = firebase.database();
        this.requestId = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadBookRequests();
    }

    setupEventListeners() {
        // Add book request button
        document.getElementById('addBookRequestBtn')?.addEventListener('click', () => this.showAddRequestModal());
        
        // Submit book request
        document.getElementById('submitBookRequestBtn')?.addEventListener('click', () => this.submitBookRequest());
        
        // Confirm request decision
        document.getElementById('confirmRequestDecisionBtn')?.addEventListener('click', () => this.confirmRequestDecision());
        
        // Status filter
        document.getElementById('requestStatusFilter')?.addEventListener('change', () => this.loadBookRequests());
    }

    showAddRequestModal() {
        const modal = new bootstrap.Modal(document.getElementById('bookRequestModal'));
        document.getElementById('bookRequestForm').reset();
        this.requestId = null;
        modal.show();
    }

    async submitBookRequest() {
        try {
            const title = document.getElementById('requestBookTitle').value.trim();
            const author = document.getElementById('requestBookAuthor').value.trim();
            const isbn = document.getElementById('requestBookISBN').value.trim();
            const category = document.getElementById('requestBookCategory').value;
            const quantity = parseInt(document.getElementById('requestQuantity').value) || 1;
            const priority = document.getElementById('requestPriority').value;
            const reason = document.getElementById('requestReason').value.trim();
            const studentId = document.getElementById('requestStudentId').value.trim();

            if (!title) {
                await Swal.fire({
                    icon: 'warning',
                    title: 'Missing Information',
                    text: 'Please enter the book title'
                });
                return;
            }

            const requestData = {
                title,
                author,
                isbn,
                category,
                quantity,
                priority,
                reason,
                studentId,
                status: 'pending',
                requestedBy: firebase.auth().currentUser?.uid || 'admin',
                requestedByName: firebase.auth().currentUser?.displayName || 'Admin',
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            if (this.requestId) {
                // Update existing request
                await this.db.ref(`bookRequests/${this.requestId}`).update(requestData);
            } else {
                // Create new request
                await this.db.ref('bookRequests').push(requestData);
            }

            // Close modal and refresh list
            bootstrap.Modal.getInstance(document.getElementById('bookRequestModal')).hide();
            await this.loadBookRequests();

            await Swal.fire({
                icon: 'success',
                title: 'Success',
                text: this.requestId ? 'Request updated successfully' : 'Request submitted successfully',
                timer: 2000,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('Error submitting book request:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to submit request: ' + error.message
            });
        }
    }

    async loadBookRequests() {
        try {
            const statusFilter = document.getElementById('requestStatusFilter')?.value || '';
            const container = document.getElementById('bookRequestsList');
            
            if (!container) return;

            container.innerHTML = '<p class="text-muted">Loading book requests…</p>';

            let query = this.db.ref('bookRequests');
            
            if (statusFilter) {
                query = query.orderByChild('status').equalTo(statusFilter);
            }

            const snapshot = await query.once('value');
            const requests = [];

            if (snapshot.exists()) {
                snapshot.forEach(child => {
                    requests.push({
                        id: child.key,
                        ...child.val()
                    });
                });
            }

            // Sort by priority and date
            const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
            requests.sort((a, b) => {
                if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
                    return priorityOrder[a.priority] - priorityOrder[b.priority];
                }
                return b.createdAt - a.createdAt;
            });

            if (requests.length === 0) {
                container.innerHTML = '<p class="text-muted">No book requests found.</p>';
                return;
            }

            container.innerHTML = requests.map(request => this.renderRequestCard(request)).join('');

            // Add event listeners for action buttons
            requests.forEach(request => {
                document.getElementById(`reviewRequest-${request.id}`)?.addEventListener('click', () => this.showReviewModal(request));
                document.getElementById(`deleteRequest-${request.id}`)?.addEventListener('click', () => this.deleteRequest(request.id));
                document.getElementById(`editRequest-${request.id}`)?.addEventListener('click', () => this.editRequest(request));
            });

        } catch (error) {
            console.error('Error loading book requests:', error);
            const container = document.getElementById('bookRequestsList');
            if (container) {
                container.innerHTML = '<p class="text-danger">Error loading requests. Please try again.</p>';
            }
        }
    }

    renderRequestCard(request) {
        const statusColors = {
            pending: 'warning',
            approved: 'success',
            rejected: 'danger',
            ordered: 'info',
            completed: 'secondary'
        };

        const priorityColors = {
            urgent: 'danger',
            high: 'warning',
            medium: 'info',
            low: 'secondary'
        };

        const createdDate = new Date(request.createdAt).toLocaleDateString();
        const updatedDate = new Date(request.updatedAt).toLocaleDateString();

        return `
            <div class="card mb-3">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <h5 class="card-title">${request.title}</h5>
                            <p class="card-text mb-1">
                                <strong>Author:</strong> ${request.author || 'Not specified'} | 
                                <strong>ISBN:</strong> ${request.isbn || 'Not specified'} |
                                <strong>Category:</strong> ${request.category || 'Not specified'}
                            </p>
                            <p class="card-text mb-1">
                                <strong>Quantity:</strong> ${request.quantity} |
                                <strong>Priority:</strong> <span class="badge bg-${priorityColors[request.priority]}">${request.priority}</span>
                            </p>
                            ${request.reason ? `<p class="card-text mb-1"><strong>Reason:</strong> ${request.reason}</p>` : ''}
                            <p class="card-text mb-1">
                                <small class="text-muted">
                                    Requested by: ${request.requestedByName || 'Unknown'} | 
                                    Created: ${createdDate} | 
                                    Updated: ${updatedDate}
                                </small>
                            </p>
                            ${request.studentId ? `<p class="card-text mb-1"><small class="text-muted">Student ID: ${request.studentId}</small></p>` : ''}
                        </div>
                        <div>
                            <span class="badge bg-${statusColors[request.status]} fs-6">${request.status}</span>
                        </div>
                    </div>
                    <div class="mt-3">
                        ${request.status === 'pending' ? `
                            <button id="reviewRequest-${request.id}" class="btn btn-sm btn-primary">
                                <i class="bi bi-check-circle"></i> Review
                            </button>
                        ` : ''}
                        <button id="editRequest-${request.id}" class="btn btn-sm btn-outline-secondary">
                            <i class="bi bi-pencil"></i> Edit
                        </button>
                        <button id="deleteRequest-${request.id}" class="btn btn-sm btn-outline-danger">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    </div>
                    ${request.adminNotes ? `<div class="mt-2 p-2 bg-light rounded"><small><strong>Admin Notes:</strong> ${request.adminNotes}</small></div>` : ''}
                </div>
            </div>
        `;
    }

    showReviewModal(request) {
        this.requestId = request.id;
        
        const detailsHtml = `
            <div class="row">
                <div class="col-md-6">
                    <p><strong>Title:</strong> ${request.title}</p>
                    <p><strong>Author:</strong> ${request.author || 'Not specified'}</p>
                    <p><strong>ISBN:</strong> ${request.isbn || 'Not specified'}</p>
                    <p><strong>Category:</strong> ${request.category || 'Not specified'}</p>
                </div>
                <div class="col-md-6">
                    <p><strong>Quantity:</strong> ${request.quantity}</p>
                    <p><strong>Priority:</strong> ${request.priority}</p>
                    <p><strong>Status:</strong> ${request.status}</p>
                    <p><strong>Requested by:</strong> ${request.requestedByName || 'Unknown'}</p>
                </div>
            </div>
            ${request.reason ? `<p><strong>Reason:</strong> ${request.reason}</p>` : ''}
            ${request.studentId ? `<p><strong>Student ID:</strong> ${request.studentId}</p>` : ''}
            <p><small class="text-muted">Created: ${new Date(request.createdAt).toLocaleDateString()}</small></p>
        `;

        document.getElementById('requestReviewDetails').innerHTML = detailsHtml;
        document.getElementById('requestDecision').value = request.status === 'pending' ? 'approved' : request.status;
        document.getElementById('requestNotes').value = request.adminNotes || '';

        const modal = new bootstrap.Modal(document.getElementById('bookRequestReviewModal'));
        modal.show();
    }

    async confirmRequestDecision() {
        try {
            const decision = document.getElementById('requestDecision').value;
            const notes = document.getElementById('requestNotes').value.trim();

            if (!this.requestId) {
                throw new Error('No request selected');
            }

            const updateData = {
                status: decision,
                adminNotes: notes,
                reviewedBy: firebase.auth().currentUser?.uid || 'admin',
                reviewedByName: firebase.auth().currentUser?.displayName || 'Admin',
                reviewedAt: Date.now(),
                updatedAt: Date.now()
            };

            await this.db.ref(`bookRequests/${this.requestId}`).update(updateData);

            // Close modal and refresh list
            bootstrap.Modal.getInstance(document.getElementById('bookRequestReviewModal')).hide();
            await this.loadBookRequests();

            await Swal.fire({
                icon: 'success',
                title: 'Success',
                text: `Request ${decision} successfully`,
                timer: 2000,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('Error updating request decision:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to update request: ' + error.message
            });
        }
    }

    editRequest(request) {
        this.requestId = request.id;
        
        // Populate form with existing data
        document.getElementById('requestBookTitle').value = request.title || '';
        document.getElementById('requestBookAuthor').value = request.author || '';
        document.getElementById('requestBookISBN').value = request.isbn || '';
        document.getElementById('requestBookCategory').value = request.category || '';
        document.getElementById('requestQuantity').value = request.quantity || 1;
        document.getElementById('requestPriority').value = request.priority || 'medium';
        document.getElementById('requestReason').value = request.reason || '';
        document.getElementById('requestStudentId').value = request.studentId || '';

        const modal = new bootstrap.Modal(document.getElementById('bookRequestModal'));
        modal.show();
    }

    async deleteRequest(requestId) {
        try {
            const result = await Swal.fire({
                title: 'Delete Request',
                text: 'Are you sure you want to delete this book request?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete it!'
            });

            if (result.isConfirmed) {
                await this.db.ref(`bookRequests/${requestId}`).remove();
                await this.loadBookRequests();

                await Swal.fire({
                    icon: 'success',
                    title: 'Deleted',
                    text: 'Request deleted successfully',
                    timer: 2000,
                    showConfirmButton: false
                });
            }
        } catch (error) {
            console.error('Error deleting request:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to delete request: ' + error.message
            });
        }
    }
}

// Initialize the book request manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.bookRequestManager = new BookRequestManager();
});