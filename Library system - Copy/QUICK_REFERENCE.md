# 📖 Quick Reference Guide - New Systems

## Copy & Paste Code Examples

### ✅ Form Validation

```javascript
// In your submit handler
const errors = FormValidation.isValidStudentData({
    fullName: studentName,
    grade: grade,
    assessmentNo: assessmentNo,
    phoneNumber: phone
});

if (!FormValidation.showValidationErrors(errors)) {
    return; // Stop if errors
}

// Continue with save...
```

### 📊 Audit Logging

```javascript
// After successful operation
await auditLogger.log('CREATE', 'BOOK', bookId, {
    title: bookData.title,
    isbn: bookData.isbn,
    category: bookData.category,
    quantity: bookData.quantity
});

// View logs
const logs = await auditLogger.getUserLogs(userId, 50);
logs.forEach(log => {
    console.log(`${log.date}: ${log.action} ${log.entity}`);
});

// Export logs
const allLogs = await auditLogger.getAllLogs(1000);
await auditLogger.exportLogsToCSV(allLogs);
```

### ⏳ Loading & Notifications

```javascript
// Show loading
loadingManager.show('Saving book...');

// Do your work...

// Hide loading
loadingManager.hide();

// Success
await loadingManager.success('Book saved!', 2000);

// Error  
await loadingManager.error('Failed to save', 'ISBN already exists');

// Confirmation
const result = await loadingManager.confirm(
    'Delete this book?',
    'This action cannot be undone'
);
if (result.isConfirmed) {
    // Delete
}

// Toast (non-blocking)
toast.success('Operation complete!');
toast.error('Something went wrong');
toast.warning('Low quantity');
toast.info('Please note...');
```

### 🎛️ Advanced Filtering

```javascript
// Create filter
const filter = new AdvancedFilter();

// Add conditions
filter.addFilter('grade', 'equals', 'Grade 4')
      .addFilter('status', 'equals', 'active')
      .addFilter('quantity', 'gt', 0);

// Apply
const results = filter.applyFilters(allBooks);

// Sort
const sorted = filter.sort(results, 'title', true);

// Group
const grouped = filter.group(results, 'category');

// Statistics
const stats = filter.getStatistics(results, 'quantity');
console.log('Average:', stats.average);

// Export
filter.exportToCSV(results, 'books_report.csv');

// Pagination
const pagination = new Pagination(results, 50);
const page1 = pagination.getPage(1);
console.log(page1.data); // 50 items
console.log(page1.totalPages); // Total pages
```

### 📧 Email Notifications

```javascript
// Get overdue books
const overdueBooks = await emailNotificationService.getOverdueBooks();

// Send bulk reminders
await emailNotificationService.sendBulkOverdueReminders(
    overdueBooks.map(b => b.id)
);

// Send single reminder
await emailNotificationService.sendOverdueReminder(
    issuanceId, studentId, bookId
);

// Start auto-checking (runs every 60 minutes)
notificationScheduler.startAutomaticChecks(60);

// Stop auto-checking
notificationScheduler.stopAutomaticChecks();

// Check notifications
const history = await emailNotificationService.getNotificationHistory(studentId);
```

---

## Filter Operators Cheat Sheet

```javascript
filter.addFilter('field', 'equals', 'value');           // =
filter.addFilter('field', 'not_equals', 'value');       // !=
filter.addFilter('field', 'contains', 'text');          // LIKE %text%
filter.addFilter('field', 'not_contains', 'text');      // NOT LIKE
filter.addFilter('field', 'gt', 10);                    // > 10
filter.addFilter('field', 'gte', 10);                   // >= 10
filter.addFilter('field', 'lt', 10);                    // < 10
filter.addFilter('field', 'lte', 10);                   // <= 10
filter.addFilter('field', 'between', [5, 10]);          // BETWEEN 5 AND 10
filter.addFilter('field', 'in', ['a', 'b', 'c']);       // IN (a,b,c)
filter.addFilter('field', 'not_in', ['a', 'b']);        // NOT IN
filter.addFilter('field', 'starts_with', 'The');        // LIKE The%
filter.addFilter('field', 'ends_with', '.pdf');         // LIKE %.pdf
filter.addFilter('field', 'is_empty', null);            // IS NULL
filter.addFilter('field', 'is_not_empty', null);        // IS NOT NULL
```

---

## Validation Cheat Sheet

```javascript
// Check individual fields
FormValidation.isValidISBN('978-0-13-110362-7');           // true/false
FormValidation.isValidPhone('0712345678');                 // true/false
FormValidation.isValidEmail('user@example.com');           // true/false
FormValidation.isValidName('John Doe');                    // true/false
FormValidation.isValidTitle('Mathematics Textbook');       // true/false
FormValidation.isValidGrade('Grade 4');                    // true/false
FormValidation.isValidDate('2024-01-01');                  // true/false
FormValidation.isValidQuantity(45);                        // true/false
FormValidation.isValidAssessmentNo('STD001');              // true/false

// Check bulk data
const errors = FormValidation.isValidStudentData({
    fullName: 'John Doe',
    grade: 'Grade 4',
    assessmentNo: 'STD001',
    phoneNumber: '0712345678'
});
// Returns array of error messages

const errors = FormValidation.isValidBookData({
    title: 'Math Book',
    isbn: '978-0134685991',
    author: 'Uncle Bob',
    quantity: 50
});
// Returns array of error messages

// Show errors to user
if (errors.length > 0) {
    FormValidation.showValidationErrors(errors); // Displays popup
}
```

---

## Date Utils Cheat Sheet

```javascript
DateUtils.formatDate(new Date());                         // "2024-01-15"
DateUtils.formatDateDisplay(new Date());                 // "Jan 15, 2024"
DateUtils.isOverdue('2024-01-01');                       // true/false
DateUtils.daysUntilDue('2024-01-20');                    // 5 (days)
DateUtils.getDateRange(30);                              // {start: '...', end: '...'}
```

---

## String Utils Cheat Sheet

```javascript
StringUtils.truncate('Very long text here...', 20);      // "Very long text he..."
StringUtils.toTitleCase('john doe');                     // "John Doe"
StringUtils.capitalize('hello world');                   // "Hello world"
StringUtils.formatPhone('0712345678');                   // "(071) 234-5678"
StringUtils.generateId();                                // "abc123def456"
```

---

## Full Integration Template

```javascript
// In your async form handler
async handleStudentSubmit(e) {
    e.preventDefault();
    
    // 1. COLLECT DATA
    const studentData = {
        fullName: document.getElementById('studentName').value,
        grade: document.getElementById('grade').value,
        assessmentNo: document.getElementById('assessmentNo').value,
        phoneNumber: document.getElementById('phoneNumber').value
    };
    
    // 2. VALIDATE
    const errors = FormValidation.isValidStudentData(studentData);
    if (!FormValidation.showValidationErrors(errors)) {
        return; // Stop if validation fails
    }
    
    // 3. SHOW LOADING
    loadingManager.show('Saving student...');
    
    try {
        // 4. SAVE TO DATABASE
        const newStudentId = await db.ref('students').push().key;
        await db.ref(`students/${newStudentId}`).set(studentData);
        
        // 5. LOG THE ACTION
        await auditLogger.log('CREATE', 'STUDENT', newStudentId, studentData);
        
        // 6. HIDE LOADING
        loadingManager.hide();
        
        // 7. SHOW SUCCESS
        await loadingManager.success('Student added successfully!');
        
        // 8. SHOW TOAST
        toast.success('Student saved');
        
        // 9. CLOSE MODAL
        modal.hide();
        
        // 10. REFRESH LIST
        this.loadStudents();
        
    } catch (error) {
        // ERROR HANDLING
        loadingManager.hide();
        await loadingManager.error('Failed to save student', error.message);
        toast.error('Error: ' + error.message);
        
        // LOG THE ERROR
        await auditLogger.log('CREATE_ERROR', 'STUDENT', null, {
            error: error.message,
            data: studentData
        });
    }
}
```

---

## Integration Checklist

- [ ] Add validation to `handleStudentSubmit()`
- [ ] Add validation to `handleBookSubmit()`
- [ ] Add validation to `handleIssuanceSubmit()`
- [ ] Add audit logs to `deleteBook()`
- [ ] Add audit logs to `deleteStudent()`
- [ ] Add audit logs to `returnBook()`
- [ ] Replace `Swal.fire()` with `loadingManager` calls
- [ ] Add toast notifications for quick feedback
- [ ] Create custom report using advanced filtering
- [ ] Test email notifications in console

---

## Debugging Tips

```javascript
// Check validation
console.log(FormValidation.isValidISBN('978-1234567890'));

// Check audit logs
const logs = await auditLogger.getAllLogs(10);
console.table(logs);

// Check notifications queue
const queue = await firebase.database().ref('notifications_queue').once('value');
console.log(queue.val());

// Check filter results
const filter = new AdvancedFilter();
filter.addFilter('status', 'equals', 'active');
console.log(filter.applyFilters(allBooks).length);
```

---

## Performance Tips

1. **Pagination** - Use pagination for large datasets
   ```javascript
   const paginated = new Pagination(largeArray, 50);
   // Only load 50 at a time
   ```

2. **Debounce** - Add delays to search
   ```javascript
   // Don't search on every keystroke
   // Wait 300ms after user stops typing
   ```

3. **Caching** - Store frequently accessed data
   ```javascript
   this.cachedBooks = await db.ref('books').once('value');
   // Reuse cached data instead of fetching again
   ```

---

**Ready to go! Happy coding! 🚀**
