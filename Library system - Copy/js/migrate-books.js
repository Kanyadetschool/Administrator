// Run migration when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Starting book ID migration...');
    await migrateBooks();
});

async function migrateBooks() {
    try {
        const booksRef = firebase.database().ref('books');
        const snapshot = await booksRef.once('value');
        const books = snapshot.val();

        if (!books) {
            console.log('No books to migrate');
            return;
        }

        const updates = {};
        let counter = 1;

        // Create mapping of old IDs to new IDs
        const idMapping = {};

        // First pass - generate new IDs and create mapping
        for (const [oldId, book] of Object.entries(books)) {
            if (!oldId.startsWith('BK')) {
                const newId = `BK${String(counter).padStart(3, '0')}`;
                idMapping[oldId] = newId;
                counter++;
            }
        }

        // Second pass - update book references
        for (const [oldId, book] of Object.entries(books)) {
            if (!oldId.startsWith('BK')) {
                const newId = idMapping[oldId];
                updates[`books/${newId}`] = book;
                updates[`books/${oldId}`] = null; // Mark for deletion
            }
        }

        // Update issuance records
        const issuanceRef = firebase.database().ref('issuance');
        const issuanceSnapshot = await issuanceRef.once('value');
        const issuances = issuanceSnapshot.val();

        if (issuances) {
            for (const [issuanceId, issuance] of Object.entries(issuances)) {
                if (issuance.bookId && idMapping[issuance.bookId]) {
                    updates[`issuance/${issuanceId}/bookId`] = idMapping[issuance.bookId];
                }
            }
        }

        // Perform all updates in a single transaction
        if (Object.keys(updates).length > 0) {
            await firebase.database().ref().update(updates);
            console.log('Book ID migration completed successfully');
        } else {
            console.log('No books need migration');
        }

    } catch (error) {
        console.error('Error during book ID migration:', error);
    }
}
