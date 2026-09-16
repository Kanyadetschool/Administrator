// Book cover mapping
const bookCovers = {
    'BK001': 'covers/BK001.png', // English grade 4
    'BK002': 'covers/Agriculture.png', // Agriculture grade 4
    'BK003': 'covers/Creative Art.png', // Creative Art grade 4
    'BK004': 'covers/BK004.png', // Math grade 4
    'BK005': 'covers/social 4.jpg', // Social Studies grade 4
    'BK006': 'covers/sci 4.jpg', // Social Studies grade 4
    'BK007': 'covers/BK007.png', // Science grade 4
    'BK008': 'covers/kisw.jpg', // Kiswahili grade 4
    'BK009': 'covers/Maths5pbk.png', // Kiswahili grade 4
    'BK010': 'covers/Agric6pbk.png', // Kiswahili grade 6
    'BK011': 'covers/longhorn science and Technology Grade 5.jpg', // Kiswahili grade 6
    'Maths5Trs': 'covers/Maths5Trs.jpg', // Kiswahili grade 4
    // Add more book covers as needed
};

// Default cover for books without assigned covers
const defaultCover = 'covers/default-book.png';

class BookCoverManager {
    /**
     * Resolve the best cover image URL for a book.
     * Priority: book.coverUrl (remote) → hardcoded bookCovers map → defaultCover.
     * @param {string} bookKey - The Firebase key of the book.
     * @param {object} [bookData] - Optional book object that may contain a coverUrl.
     */
    static getBookCover(bookKey, bookData) {
        if (bookData && bookData.coverUrl) return bookData.coverUrl;
        return bookCovers[bookKey] || defaultCover;
    }

    /**
     * Render a cover image with status badge into the given element.
     * @param {string} bookKey
     * @param {HTMLElement} element
     * @param {string} [status='available']
     * @param {object} [bookData] - Optional book object with coverUrl.
     */
    static renderBookCover(bookKey, element, status = 'available', bookData) {
        const coverContainer = document.createElement('div');
        coverContainer.className = 'book-cover-container';
        
        const img = document.createElement('img');
        img.src = this.getBookCover(bookKey, bookData);
        img.alt = 'Book Cover';
        img.className = 'book-cover';
        img.onerror = () => {
            // If remote coverUrl failed, try static map, then default
            if (bookCovers[bookKey] && img.src !== bookCovers[bookKey]) {
                img.src = bookCovers[bookKey];
            } else {
                img.src = defaultCover;
            }
        };
        
        const statusElement = document.createElement('div');
        statusElement.className = `book-status status-${status.toLowerCase()}`;
        statusElement.textContent = status;
        
        coverContainer.appendChild(img);
        coverContainer.appendChild(statusElement);
        element.insertBefore(coverContainer, element.firstChild);
        
        return coverContainer;
    }
}

// Export the manager
window.BookCoverManager = BookCoverManager;
