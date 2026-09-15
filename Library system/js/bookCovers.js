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
    static getBookCover(bookKey) {
        return bookCovers[bookKey] || defaultCover;
    }

    static renderBookCover(bookKey, element, status = 'available') {
        const coverContainer = document.createElement('div');
        coverContainer.className = 'book-cover-container';
        
        const img = document.createElement('img');
        img.src = this.getBookCover(bookKey);
        img.alt = 'Book Cover';
        img.className = 'book-cover';
        img.onerror = () => {
            img.src = defaultCover;
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
