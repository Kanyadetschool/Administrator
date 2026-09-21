class FinesManager {
    constructor() {
        this.db = firebase.database();
        this.fineId = null;
        this.fineSettings = {
            dailyFineRate: 5,
            maxFineAmount: 100,
            gracePeriodDays: 3,
            lostBookFine: 300,
            damagedBookFine: 100
        };
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadFineSettings();
        this.loadFines();
        this.updateFineStatistics();
    }

    setupEventListeners() {
        // Add fine button
        document.getElementById('addFineBtn')?.addEventListener('click', () => this.showAddFineModal());
        
        // Calculate overdue fines button
        document.getElementById('bulkCalculateFinesBtn')?.addEventListener('click', () => this.calculateOverdueFines());
        
        // Fine settings button
        document.getElementById('fineSettingsBtn')?.addEventListener('click', () => this.showFineSettingsModal());
        
        // Submit fine
        document.getElementById('submitFineBtn')?.addEventListener('click', () => this.submitFine());
        
        // Confirm payment
        document.getElementById('confirmPaymentBtn')?.addEventListener('click', () => this.confirmPayment());
        
        // Confirm waive
        document.getElementById('confirmWaiveBtn')?.addEventListener('click', () => this.confirmWaive());
        
        // Save fine settings
        document.getElementById('saveFineSettingsBtn')?.addEventListener('click', () => this.saveFineSettings());
        
        // Filters
        document.getElementById('fineStatusFilter')?.addEventListener('change', () => this.loadFines());
        document.getElementById('fineGradeFilter')?.addEventListener('change', () => this.loadFines());
        
        // Student selection in fine modal
        document.getElementById('fineStudent')?.addEventListener('change', () => this.loadStudentIssuances());
    }

    async loadFineSettings() {
        try {
            const snapshot = await this.db.ref('fineSettings').once('value');
            if (snapshot.exists()) {
                this.fineSettings = { ...this.fineSettings, ...snapshot.val() };
            }
        } catch (error) {
            console.error('Error loading fine settings:', error);
        }
    }

    showFineSettingsModal() {
        // Populate form with current settings
        document.getElementById('dailyFineRate').value = this.fineSettings.dailyFineRate || 5;
        document.getElementById('maxFineAmount').value = this.fineSettings.maxFineAmount || 100;
        document.getElementById('gracePeriodDays').value = this.fineSettings.gracePeriodDays || 3;
        document.getElementById('lostBookFine').value = this.fineSettings.lostBookFine || 300;
        document.getElementById('damagedBookFine').value = this.fineSettings.damagedBookFine || 100;

        const modal = new bootstrap.Modal(document.getElementById('fineSettingsModal'));
        modal.show();
    }

    async saveFineSettings() {
        try {
            this.fineSettings = {
                dailyFineRate: parseFloat(document.getElementById('dailyFineRate').value) || 5,
                maxFineAmount: parseFloat(document.getElementById('maxFineAmount').value) || 100,
                gracePeriodDays: parseInt(document.getElementById('gracePeriodDays').value) || 3,
                lostBookFine: parseFloat(document.getElementById('lostBookFine').value) || 300,
                damagedBookFine: parseFloat(document.getElementById('damagedBookFine').value) || 100
            };

            await this.db.ref('fineSettings').set(this.fineSettings);

            bootstrap.Modal.getInstance(document.getElementById('fineSettingsModal')).hide();

            await Swal.fire({
                icon: 'success',
                title: 'Settings Saved',
                text: 'Fine settings have been updated',
                timer: 2000,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('Error saving fine settings:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to save settings: ' + error.message
            });
        }
    }

    async showAddFineModal() {
        try {
            const modal = new bootstrap.Modal(document.getElementById('addFineModal'));
            document.getElementById('addFineForm').reset();
            this.fineId = null;

            // Set default due date to 30 days from now
            const defaultDueDate = new Date();
            defaultDueDate.setDate(defaultDueDate.getDate() + 30);
            document.getElementById('fineDueDate').value = defaultDueDate.toISOString().split('T')[0];

            // Populate student dropdown
            const studentSelect = document.getElementById('fineStudent');
            studentSelect.innerHTML = '<option value="">Select Student</option>';
            
            if (typeof StudentsCache !== 'undefined') {
                StudentsCache.getAll().forEach((student, id) => {
                    const option = document.createElement('option');
                    option.value = id;
                    option.textContent = `${student.name} (${student.grade || 'No Grade'})`;
                    studentSelect.appendChild(option);
                });
            }

            modal.show();
        } catch (error) {
            console.error('Error showing add fine modal:', error);
        }
    }

    async loadStudentIssuances() {
        try {
            const studentId = document.getElementById('fineStudent').value;
            const issuanceSelect = document.getElementById('fineIssuance');
            
            issuanceSelect.innerHTML = '<option value="">Select Issuance (Optional)</option>';
            
            if (!studentId) return;

            const issuanceSnapshot = await this.db.ref('issuance')
                .orderByChild('studentId')
                .equalTo(studentId)
                .once('value');

            if (issuanceSnapshot.exists()) {
                issuanceSnapshot.forEach(child => {
                    const issuance = child.val();
                    // Only 'active' is ever actually stored (see note in
                    // calculateOverdueFines) — an overdue loan is still
                    // status 'active' until returned or written off.
                    if (issuance.status === 'active') {
                        const option = document.createElement('option');
                        option.value = child.key;
                        option.textContent = `${issuance.bookTitle} (Due: ${issuance.returnDate})`;
                        issuanceSelect.appendChild(option);
                    }
                });
            }
        } catch (error) {
            console.error('Error loading student issuances:', error);
        }
    }

    async submitFine() {
        try {
            const studentId = document.getElementById('fineStudent').value;
            const issuanceId = document.getElementById('fineIssuance').value;
            const amount = parseFloat(document.getElementById('fineAmount').value);
            const reason = document.getElementById('fineReason').value;
            const description = document.getElementById('fineDescription').value.trim();
            const dueDate = document.getElementById('fineDueDate').value;

            if (!studentId || !amount || !reason) {
                await Swal.fire({
                    icon: 'warning',
                    title: 'Missing Information',
                    text: 'Please fill in all required fields'
                });
                return;
            }

            // Get student details
            const student = (typeof StudentsCache !== 'undefined') ? StudentsCache.get(studentId) : null;
            
            const fineData = {
                studentId,
                studentName: student?.name || 'Unknown',
                studentGrade: student?.grade || '',
                studentAssessmentNo: student?.assessmentNo || '',
                issuanceId: issuanceId || null,
                amount,
                amountPaid: 0,
                amountOutstanding: amount,
                reason,
                description,
                status: 'pending',
                dueDate: dueDate || null,
                createdBy: firebase.auth().currentUser?.uid || 'admin',
                createdByName: firebase.auth().currentUser?.displayName || 'Admin',
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            if (this.fineId) {
                await this.db.ref(`fines/${this.fineId}`).update(fineData);
            } else {
                await this.db.ref('fines').push(fineData);
            }

            bootstrap.Modal.getInstance(document.getElementById('addFineModal')).hide();
            await this.loadFines();
            await this.updateFineStatistics();

            await Swal.fire({
                icon: 'success',
                title: 'Success',
                text: this.fineId ? 'Fine updated successfully' : 'Fine added successfully',
                timer: 2000,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('Error submitting fine:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to add fine: ' + error.message
            });
        }
    }

    async calculateOverdueFines() {
        try {
            const result = await Swal.fire({
                title: 'Calculate Overdue Fines',
                text: 'This will calculate fines for all overdue books based on current settings. Continue?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#3085d6',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Yes, Calculate'
            });

            if (!result.isConfirmed) return;

            const today = new Date();
            const gracePeriod = this.fineSettings.gracePeriodDays || 3;
            const dailyRate = this.fineSettings.dailyFineRate || 5;
            const maxFine = this.fineSettings.maxFineAmount || 100;

            // NOTE: 'overdue' is never actually written to issuance.status in
            // this database — app.js only computes it on the fly for display
            // (`isOverdue ? 'overdue' : issuance.status`). The real stored
            // values are 'active' / 'returned' / 'lost'. Querying for the
            // literal string 'overdue' here always returned zero records, so
            // this button silently calculated nothing. Fetch 'active'
            // issuances instead and let the existing days-overdue/grace-
            // period check below do the actual overdue filtering.
            const issuanceSnapshot = await this.db.ref('issuance')
                .orderByChild('status')
                .equalTo('active')
                .once('value');

            let calculatedCount = 0;
            let skippedCount = 0;

            if (issuanceSnapshot.exists()) {
                const promises = [];
                
                issuanceSnapshot.forEach(child => {
                    const issuance = child.val();
                    const returnDate = new Date(issuance.returnDate);
                    const daysOverdue = Math.floor((today - returnDate) / (1000 * 60 * 60 * 24));

                    // Skip if within grace period
                    if (daysOverdue <= gracePeriod) {
                        skippedCount++;
                        return;
                    }

                    // Calculate fine
                    const billableDays = daysOverdue - gracePeriod;
                    const calculatedFine = Math.min(billableDays * dailyRate, maxFine);

                    // Check if fine already exists for this issuance
                    const finePromise = this.db.ref('fines')
                        .orderByChild('issuanceId')
                        .equalTo(child.key)
                        .once('value')
                        .then(fineSnapshot => {
                            if (fineSnapshot.exists()) {
                                // Update existing fine
                                fineSnapshot.forEach(fineChild => {
                                    const existingFine = fineChild.val();
                                    if (existingFine.status === 'pending') {
                                        this.db.ref(`fines/${fineChild.key}`).update({
                                            amount: calculatedFine,
                                            amountOutstanding: calculatedFine - (existingFine.amountPaid || 0),
                                            updatedAt: Date.now()
                                        });
                                        calculatedCount++;
                                    }
                                });
                            } else {
                                // Create new fine
                                const student = (typeof StudentsCache !== 'undefined') ? StudentsCache.get(issuance.studentId) : null;
                                const fineData = {
                                    studentId: issuance.studentId,
                                    studentName: issuance.studentName || student?.name || 'Unknown',
                                    studentGrade: issuance.grade || student?.grade || '',
                                    studentAssessmentNo: student?.assessmentNo || '',
                                    issuanceId: child.key,
                                    amount: calculatedFine,
                                    amountPaid: 0,
                                    amountOutstanding: calculatedFine,
                                    reason: 'overdue',
                                    description: `Overdue fine for "${issuance.bookTitle}" - ${daysOverdue} days overdue`,
                                    status: 'pending',
                                    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                                    autoCalculated: true,
                                    createdBy: firebase.auth().currentUser?.uid || 'admin',
                                    createdByName: firebase.auth().currentUser?.displayName || 'System',
                                    createdAt: Date.now(),
                                    updatedAt: Date.now()
                                };
                                this.db.ref('fines').push(fineData);
                                calculatedCount++;
                            }
                        });

                    promises.push(finePromise);
                });

                await Promise.all(promises);
            }

            await this.loadFines();
            await this.updateFineStatistics();

            await Swal.fire({
                icon: 'success',
                title: 'Calculation Complete',
                text: `Calculated ${calculatedCount} fines. Skipped ${skippedCount} within grace period.`,
                timer: 3000,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('Error calculating overdue fines:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to calculate fines: ' + error.message
            });
        }
    }

    async loadFines() {
        try {
            const statusFilter = document.getElementById('fineStatusFilter')?.value || '';
            const gradeFilter = document.getElementById('fineGradeFilter')?.value || '';
            const container = document.getElementById('finesList');
            
            if (!container) return;

            container.innerHTML = '<p class="text-muted">Loading fines…</p>';

            let query = this.db.ref('fines');
            
            if (statusFilter) {
                query = query.orderByChild('status').equalTo(statusFilter);
            }

            const snapshot = await query.once('value');
            const fines = [];

            if (snapshot.exists()) {
                snapshot.forEach(child => {
                    fines.push({
                        id: child.key,
                        ...child.val()
                    });
                });
            }

            // Apply grade filter
            let filteredFines = fines;
            if (gradeFilter) {
                filteredFines = fines.filter(fine => fine.studentGrade === gradeFilter);
            }

            // Sort by date (newest first)
            filteredFines.sort((a, b) => b.createdAt - a.createdAt);

            if (filteredFines.length === 0) {
                container.innerHTML = '<p class="text-muted">No fines found.</p>';
                return;
            }

            container.innerHTML = filteredFines.map(fine => this.renderFineCard(fine)).join('');

            // Add event listeners
            filteredFines.forEach(fine => {
                document.getElementById(`payFine-${fine.id}`)?.addEventListener('click', () => this.showPaymentModal(fine));
                document.getElementById(`waiveFine-${fine.id}`)?.addEventListener('click', () => this.showWaiveModal(fine));
                document.getElementById(`deleteFine-${fine.id}`)?.addEventListener('click', () => this.deleteFine(fine.id));
                document.getElementById(`viewFine-${fine.id}`)?.addEventListener('click', () => this.viewFineDetails(fine));
                this.renderFineImages(fine);
            });

        } catch (error) {
            console.error('Error loading fines:', error);
            const container = document.getElementById('finesList');
            if (container) {
                container.innerHTML = '<p class="text-danger">Error loading fines. Please try again.</p>';
            }
        }
    }

    renderFineCard(fine) {
        const statusColors = {
            pending: 'warning',
            partial: 'info',
            paid: 'success',
            waived: 'secondary'
        };

        const createdDate = new Date(fine.createdAt).toLocaleDateString();
        const dueDate = fine.dueDate ? new Date(fine.dueDate).toLocaleDateString() : 'Not set';
        const isOverdue = fine.dueDate && new Date(fine.dueDate) < new Date();

        // Book cover only makes sense when the fine is actually tied to a
        // book (either directly via fine.bookId — e.g. fines-lost-book-sync.js
        // — or indirectly via fine.issuanceId, resolved in renderFineImages()).
        // A manual/administrative fine with neither just gets the student
        // photo, same as elsewhere in this app (see app.js's issuance-card
        // and student-card rendering, which this mirrors).
        const showBookCover = !!(fine.bookId || fine.issuanceId);

        return `
            <div class="card mb-3 ${isOverdue && fine.status === 'pending' ? 'border-danger' : ''}" id="fineCard-${fine.id}">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start">
                        <div class="d-flex align-items-start gap-2">
                            <div class="student-image-container fine-student-image"></div>
                            ${showBookCover ? '<div class="book-cover-container fine-book-cover"></div>' : ''}
                            <div>
                            <h5 class="card-title">${fine.studentName} (${fine.studentGrade})</h5>
                            <p class="card-text mb-1">
                                <strong>Amount:</strong> Ksh ${fine.amount.toFixed(2)} | 
                                <strong>Paid:</strong> Ksh ${fine.amountPaid.toFixed(2)} | 
                                <strong>Outstanding:</strong> Ksh ${fine.amountOutstanding.toFixed(2)}
                            </p>
                            <p class="card-text mb-1">
                                <strong>Reason:</strong> ${fine.reason} | 
                                <strong>Status:</strong> <span class="badge bg-${statusColors[fine.status]}">${fine.status}</span>
                            </p>
                            ${fine.description ? `<p class="card-text mb-1"><strong>Description:</strong> ${fine.description}</p>` : ''}
                            <p class="card-text mb-1">
                                <small class="text-muted">
                                    Assessment No: ${fine.studentAssessmentNo || 'Not specified'} | 
                                    Created: ${createdDate} | 
                                    Due: ${dueDate}
                                    ${isOverdue && fine.status === 'pending' ? ' <span class="text-danger">(Overdue)</span>' : ''}
                                </small>
                            </p>
                            ${fine.issuanceId ? `<p class="card-text mb-1"><small class="text-muted">Related to issuance: ${fine.issuanceId}</small></p>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="mt-3">
                        ${fine.status === 'pending' || fine.status === 'partial' ? `
                            <button id="payFine-${fine.id}" class="btn btn-sm btn-success">
                                <i class="bi bi-cash"></i> Record Payment
                            </button>
                            <button id="waiveFine-${fine.id}" class="btn btn-sm btn-warning">
                                <i class="bi bi-slash-circle"></i> Waive
                            </button>
                        ` : ''}
                        <button id="viewFine-${fine.id}" class="btn btn-sm btn-outline-info">
                            <i class="bi bi-eye"></i> View Details
                        </button>
                        <button id="deleteFine-${fine.id}" class="btn btn-sm btn-outline-danger">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    </div>
                    ${fine.payments ? `<div class="mt-2"><small class="text-muted">Payment History: ${Object.keys(fine.payments).length} payment(s)</small></div>` : ''}
                </div>
            </div>
        `;
    }

    // Fills in the student photo (always) and book cover (when this fine
    // is tied to a book) placeholders left by renderFineCard(). Done as a
    // separate pass after the innerHTML join, the same two-step pattern
    // app.js already uses for issuance/student cards (build the HTML with
    // an empty *-container div, then StudentImageManager/BookCoverManager
    // fill it in per-card) — those managers render into a live element,
    // not a string, so this can't happen inside renderFineCard() itself.
    async renderFineImages(fine) {
        try {
            const card = document.getElementById(`fineCard-${fine.id}`);
            if (!card) return;

            const imageContainer = card.querySelector('.student-image-container');
            if (imageContainer && typeof StudentImageManager !== 'undefined') {
                StudentImageManager.renderStudentImage(fine.studentName, fine.studentGrade, imageContainer, fine.status);
            }

            const coverContainer = card.querySelector('.book-cover-container');
            if (coverContainer && typeof BookCoverManager !== 'undefined') {
                const bookId = await this.resolveBookIdForFine(fine);
                if (bookId) {
                    BookCoverManager.renderBookCover(bookId, coverContainer);
                } else {
                    coverContainer.remove(); // no book to show a cover for after all
                }
            }
        } catch (error) {
            console.error('Error rendering fine images:', error);
        }
    }

    // fine.bookId is only ever set by fines-lost-book-sync.js (lost-book
    // fines) — a fine created any other way (manual Add Fine, or the
    // built-in calculateOverdueFines()) only ever stores issuanceId, so
    // the book has to be looked up through it.
    async resolveBookIdForFine(fine) {
        if (fine.bookId) return fine.bookId;
        if (!fine.issuanceId) return null;
        try {
            const snap = await this.db.ref(`issuance/${fine.issuanceId}/bookId`).once('value');
            return snap.exists() ? snap.val() : null;
        } catch (error) {
            console.error('Error resolving bookId for fine', fine.id, error);
            return null;
        }
    }

    async updateFineStatistics() {
        try {
            const snapshot = await this.db.ref('fines').once('value');
            let totalOutstanding = 0;
            let totalCollected = 0;
            let pendingCount = 0;
            let overdueCount = 0;
            const today = new Date();

            if (snapshot.exists()) {
                snapshot.forEach(child => {
                    const fine = child.val();
                    totalOutstanding += fine.amountOutstanding || 0;
                    totalCollected += fine.amountPaid || 0;
                    
                    if (fine.status === 'pending' || fine.status === 'partial') {
                        pendingCount++;
                        if (fine.dueDate && new Date(fine.dueDate) < today) {
                            overdueCount++;
                        }
                    }
                });
            }

            document.getElementById('totalOutstandingFines').textContent = `Ksh ${totalOutstanding.toFixed(2)}`;
            document.getElementById('totalCollectedFines').textContent = `Ksh ${totalCollected.toFixed(2)}`;
            document.getElementById('pendingFinesCount').textContent = pendingCount;
            document.getElementById('overdueFinesCount').textContent = overdueCount;

        } catch (error) {
            console.error('Error updating fine statistics:', error);
        }
    }

    showPaymentModal(fine) {
        this.fineId = fine.id;
        
        const detailsHtml = `
            <div class="d-flex align-items-start gap-2 mb-2">
                <div class="student-image-container" id="paymentModalStudentImage" style="width:56px;height:56px;flex-shrink:0;"></div>
            <div class="row flex-grow-1">
                <div class="col-md-6">
                    <p><strong>Student:</strong> ${fine.studentName}</p>
                    <p><strong>Grade:</strong> ${fine.studentGrade}</p>
                    <p><strong>Total Fine:</strong> Ksh ${fine.amount.toFixed(2)}</p>
                </div>
                <div class="col-md-6">
                    <p><strong>Amount Paid:</strong> Ksh ${fine.amountPaid.toFixed(2)}</p>
                    <p><strong>Outstanding:</strong> Ksh ${fine.amountOutstanding.toFixed(2)}</p>
                    <p><strong>Reason:</strong> ${fine.reason}</p>
                </div>
            </div>
            </div>
            ${fine.description ? `<p><strong>Description:</strong> ${fine.description}</p>` : ''}
        `;

        document.getElementById('paymentDetails').innerHTML = detailsHtml;
        // Same StudentImageManager the fine list and the rest of this app
        // already use — this modal's markup is set via innerHTML above so
        // the container only exists in the DOM from this line onward.
        if (typeof StudentImageManager !== 'undefined') {
            const img = document.getElementById('paymentModalStudentImage');
            if (img) StudentImageManager.renderStudentImage(fine.studentName, fine.studentGrade, img, fine.status);
        }
        document.getElementById('paymentAmount').value = fine.amountOutstanding.toFixed(2);
        document.getElementById('paymentMethod').value = '';
        document.getElementById('paymentReference').value = '';
        document.getElementById('paymentNotes').value = '';

        const modal = new bootstrap.Modal(document.getElementById('paymentModal'));
        modal.show();
    }

    async confirmPayment() {
        try {
            const amount = parseFloat(document.getElementById('paymentAmount').value);
            const method = document.getElementById('paymentMethod').value;
            const reference = document.getElementById('paymentReference').value.trim();
            const notes = document.getElementById('paymentNotes').value.trim();

            if (!amount || !method) {
                await Swal.fire({
                    icon: 'warning',
                    title: 'Missing Information',
                    text: 'Please enter payment amount and method'
                });
                return;
            }

            if (!this.fineId) {
                throw new Error('No fine selected');
            }

            // Get current fine data
            const fineSnapshot = await this.db.ref(`fines/${this.fineId}`).once('value');
            const fine = fineSnapshot.val();

            if (!fine) {
                throw new Error('Fine not found');
            }

            const newAmountPaid = fine.amountPaid + amount;
            const newAmountOutstanding = Math.max(0, fine.amountOutstanding - amount);
            const newStatus = newAmountOutstanding <= 0 ? 'paid' : 'partial';

            // Create payment record
            const paymentId = this.db.ref(`fines/${this.fineId}/payments`).push().key;
            const paymentData = {
                amount,
                method,
                reference,
                notes,
                processedBy: firebase.auth().currentUser?.uid || 'admin',
                processedByName: firebase.auth().currentUser?.displayName || 'Admin',
                processedAt: Date.now()
            };

            // Update fine
            const updateData = {
                amountPaid: newAmountPaid,
                amountOutstanding: newAmountOutstanding,
                status: newStatus,
                updatedAt: Date.now()
            };

            updateData[`payments/${paymentId}`] = paymentData;

            await this.db.ref(`fines/${this.fineId}`).update(updateData);

            bootstrap.Modal.getInstance(document.getElementById('paymentModal')).hide();
            await this.loadFines();
            await this.updateFineStatistics();

            await Swal.fire({
                icon: 'success',
                title: 'Payment Recorded',
                text: `Payment of Ksh ${amount.toFixed(2)} recorded successfully`,
                timer: 2000,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('Error recording payment:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to record payment: ' + error.message
            });
        }
    }

    showWaiveModal(fine) {
        this.fineId = fine.id;
        
        const detailsHtml = `
            <div class="alert alert-warning">
                <strong>Warning:</strong> You are about to waive a fine of Ksh ${fine.amount.toFixed(2)} for ${fine.studentName}.
            </div>
            <div class="d-flex align-items-start gap-2 mb-2">
                <div class="student-image-container" id="waiveModalStudentImage" style="width:56px;height:56px;flex-shrink:0;"></div>
            <div class="row flex-grow-1">
                <div class="col-md-6">
                    <p><strong>Student:</strong> ${fine.studentName}</p>
                    <p><strong>Grade:</strong> ${fine.studentGrade}</p>
                </div>
                <div class="col-md-6">
                    <p><strong>Fine Amount:</strong> Ksh ${fine.amount.toFixed(2)}</p>
                    <p><strong>Reason:</strong> ${fine.reason}</p>
                </div>
            </div>
            </div>
            ${fine.description ? `<p><strong>Description:</strong> ${fine.description}</p>` : ''}
        `;

        document.getElementById('waiveFineDetails').innerHTML = detailsHtml;
        if (typeof StudentImageManager !== 'undefined') {
            const img = document.getElementById('waiveModalStudentImage');
            if (img) StudentImageManager.renderStudentImage(fine.studentName, fine.studentGrade, img, fine.status);
        }
        document.getElementById('waiveReason').value = '';
        document.getElementById('waiveAuthorizedBy').value = firebase.auth().currentUser?.displayName || '';

        const modal = new bootstrap.Modal(document.getElementById('waiveFineModal'));
        modal.show();
    }

    async confirmWaive() {
        try {
            const reason = document.getElementById('waiveReason').value.trim();
            const authorizedBy = document.getElementById('waiveAuthorizedBy').value.trim();

            if (!reason) {
                await Swal.fire({
                    icon: 'warning',
                    title: 'Missing Information',
                    text: 'Please provide a reason for waiving this fine'
                });
                return;
            }

            if (!this.fineId) {
                throw new Error('No fine selected');
            }

            const updateData = {
                status: 'waived',
                amountOutstanding: 0,
                waiveReason: reason,
                waiveAuthorizedBy: authorizedBy,
                waiveDate: Date.now(),
                updatedAt: Date.now()
            };

            await this.db.ref(`fines/${this.fineId}`).update(updateData);

            bootstrap.Modal.getInstance(document.getElementById('waiveFineModal')).hide();
            await this.loadFines();
            await this.updateFineStatistics();

            await Swal.fire({
                icon: 'success',
                title: 'Fine Waived',
                text: 'Fine has been waived successfully',
                timer: 2000,
                showConfirmButton: false
            });

        } catch (error) {
            console.error('Error waiving fine:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to waive fine: ' + error.message
            });
        }
    }

    async deleteFine(fineId) {
        try {
            const result = await Swal.fire({
                title: 'Delete Fine',
                text: 'Are you sure you want to delete this fine? This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete it!'
            });

            if (result.isConfirmed) {
                await this.db.ref(`fines/${fineId}`).remove();
                await this.loadFines();
                await this.updateFineStatistics();

                await Swal.fire({
                    icon: 'success',
                    title: 'Deleted',
                    text: 'Fine deleted successfully',
                    timer: 2000,
                    showConfirmButton: false
                });
            }
        } catch (error) {
            console.error('Error deleting fine:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to delete fine: ' + error.message
            });
        }
    }

    viewFineDetails(fine) {
        const paymentHistory = fine.payments ? Object.entries(fine.payments).map(([id, payment]) => `
            <tr>
                <td>${new Date(payment.processedAt).toLocaleDateString()}</td>
                <td>Ksh ${payment.amount.toFixed(2)}</td>
                <td>${payment.method}</td>
                <td>${payment.reference || 'N/A'}</td>
                <td>${payment.processedByName || 'Unknown'}</td>
            </tr>
        `).join('') : '<tr><td colspan="5" class="text-center">No payments recorded</td></tr>';

        const showBookCover = !!(fine.bookId || fine.issuanceId);
        const detailsHtml = `
            <div class="d-flex align-items-start gap-2 mb-2">
                <div class="student-image-container" id="viewFineStudentImage" style="width:64px;height:64px;flex-shrink:0;"></div>
                ${showBookCover ? '<div class="book-cover-container" id="viewFineBookCover" style="width:48px;flex-shrink:0;"></div>' : ''}
            </div>
            <div class="row">
                <div class="col-md-6">
                    <h6>Student Information</h6>
                    <p><strong>Name:</strong> ${fine.studentName}</p>
                    <p><strong>Grade:</strong> ${fine.studentGrade}</p>
                    <p><strong>Assessment No:</strong> ${fine.studentAssessmentNo || 'Not specified'}</p>
                </div>
                <div class="col-md-6">
                    <h6>Fine Information</h6>
                    <p><strong>Total Amount:</strong> Ksh ${fine.amount.toFixed(2)}</p>
                    <p><strong>Amount Paid:</strong> Ksh ${fine.amountPaid.toFixed(2)}</p>
                    <p><strong>Outstanding:</strong> Ksh ${fine.amountOutstanding.toFixed(2)}</p>
                    <p><strong>Status:</strong> ${fine.status}</p>
                </div>
            </div>
            <div class="row mt-3">
                <div class="col-md-6">
                    <h6>Fine Details</h6>
                    <p><strong>Reason:</strong> ${fine.reason}</p>
                    <p><strong>Description:</strong> ${fine.description || 'Not specified'}</p>
                    <p><strong>Created:</strong> ${new Date(fine.createdAt).toLocaleString()}</p>
                    <p><strong>Due Date:</strong> ${fine.dueDate ? new Date(fine.dueDate).toLocaleDateString() : 'Not set'}</p>
                </div>
                <div class="col-md-6">
                    <h6>Additional Information</h6>
                    <p><strong>Created By:</strong> ${fine.createdByName || 'Unknown'}</p>
                    ${fine.waiveReason ? `<p><strong>Waive Reason:</strong> ${fine.waiveReason}</p>` : ''}
                    ${fine.waiveAuthorizedBy ? `<p><strong>Waived By:</strong> ${fine.waiveAuthorizedBy}</p>` : ''}
                </div>
            </div>
            <div class="mt-3">
                <h6>Payment History</h6>
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Amount</th>
                            <th>Method</th>
                            <th>Reference</th>
                            <th>Processed By</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${paymentHistory}
                    </tbody>
                </table>
            </div>
        `;

        Swal.fire({
            title: 'Fine Details',
            html: detailsHtml,
            width: '800px',
            showConfirmButton: true,
            confirmButtonText: 'Close',
            // Swal builds `html` into the DOM only once the popup actually
            // opens, so the image containers above don't exist yet at the
            // point this function returns — same reason the fine list
            // needs the separate renderFineImages() pass after its own
            // innerHTML join.
            didOpen: async () => {
                if (typeof StudentImageManager !== 'undefined') {
                    const img = document.getElementById('viewFineStudentImage');
                    if (img) StudentImageManager.renderStudentImage(fine.studentName, fine.studentGrade, img, fine.status);
                }
                const coverEl = document.getElementById('viewFineBookCover');
                if (coverEl && typeof BookCoverManager !== 'undefined') {
                    const bookId = await this.resolveBookIdForFine(fine);
                    if (bookId) BookCoverManager.renderBookCover(bookId, coverEl);
                    else coverEl.remove();
                }
            }
        });
    }
}

// Initialize the fines manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.finesManager = new FinesManager();
});