/**
 * ISBN Service — Google Books & Open Library auto-fetch
 * =====================================================
 * Queries external APIs to auto-populate book metadata from an ISBN.
 *
 * Usage:
 *   const result = await IsbnService.lookup('9780198390212');
 *   if (result) { /* result.title, result.authors, result.coverUrl … *\/ }
 */
class IsbnService {

    // ── Category mapping for Kenyan CBC curriculum ──────────────────────
    static CBC_CATEGORY_MAP = {
        'mathematics':   'Mathematics',
        'math':          'Mathematics',
        'arithmetic':    'Mathematics',
        'algebra':       'Mathematics',
        'geometry':      'Mathematics',
        'english':       'English',
        'language arts': 'English',
        'literacy':      'English',
        'kiswahili':     'Kiswahili',
        'swahili':       'Kiswahili',
        'science':       'Science & Technology',
        'technology':    'Science & Technology',
        'physics':       'Science & Technology',
        'chemistry':     'Science & Technology',
        'biology':       'Science & Technology',
        'integrated science': 'Science & Technology',
        'social studies':'Social Studies',
        'history':       'Social Studies',
        'geography':     'Social Studies',
        'civics':        'Social Studies',
        'cre':           'CRE',
        'christian':     'CRE',
        'religious':     'CRE',
        'religion':      'CRE',
        'ire':           'IRE',
        'islamic':       'IRE',
        'agriculture':   'Agriculture',
        'farming':       'Agriculture',
        'creative':      'Creative Arts',
        'art':           'Creative Arts',
        'music':         'Creative Arts',
        'home science':  'Home Science',
        'health':        'Health Education',
        'physical education': 'Health Education',
        'business':      'Business Studies',
        'pre-technical': 'Pre-Technical Studies',
        'computer':      'Computer Science',
        'ict':           'Computer Science',
        'fiction':       'Fiction',
        'novel':         'Fiction',
        'literature':    'Literature',
        'poetry':        'Literature'
    };

    /**
     * Clean an ISBN string (remove hyphens, spaces, prefix labels).
     * Returns the raw 10- or 13-digit string, or null if invalid.
     */
    static cleanIsbn(raw) {
        if (!raw) return null;
        const cleaned = raw.replace(/[^0-9Xx]/g, '');
        if (cleaned.length === 10 || cleaned.length === 13) return cleaned;
        return null;
    }

    /**
     * Main lookup — tries Google Books first, then Open Library.
     * Resolves to a metadata object or null.
     */
    static async lookup(rawIsbn) {
        const isbn = IsbnService.cleanIsbn(rawIsbn);
        if (!isbn) {
            console.warn('[IsbnService] Invalid ISBN:', rawIsbn);
            return null;
        }

        // Try Google Books first
        let result = await IsbnService._googleBooks(isbn);
        if (result) return result;

        // Fallback to Open Library
        result = await IsbnService._openLibrary(isbn);
        return result;
    }

    // ── Google Books API ─────────────────────────────────────────────────
    static async _googleBooks(isbn) {
        try {
            const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`;
            const resp = await fetch(url);
            if (!resp.ok) return null;

            const data = await resp.json();
            if (data.error || !data.items || data.items.length === 0) return null;

            const vol = data.items[0].volumeInfo;

            // Build high-res HTTPS cover URL
            let coverUrl = null;
            if (vol.imageLinks) {
                coverUrl = (vol.imageLinks.thumbnail || vol.imageLinks.smallThumbnail || '')
                    .replace(/^http:/, 'https:')
                    .replace(/&edge=curl/g, '')
                    .replace(/zoom=\d/, 'zoom=2');   // request higher resolution
            }

            return {
                title:       vol.title + (vol.subtitle ? ` — ${vol.subtitle}` : ''),
                authors:     (vol.authors || []).join(', '),
                publisher:   vol.publisher || '',
                publishedDate: vol.publishedDate || '',
                description: (vol.description || '').substring(0, 500),
                pageCount:   vol.pageCount || 0,
                categories:  vol.categories || [],
                coverUrl:    coverUrl,
                isbn:        isbn,
                subject:     IsbnService._mapCategory(vol.categories),
                source:      'google'
            };
        } catch (err) {
            console.error('[IsbnService] Google Books error:', err);
            return null;
        }
    }

    // ── Open Library API ─────────────────────────────────────────────────
    static async _openLibrary(isbn) {
        try {
            const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
            const resp = await fetch(url);
            if (!resp.ok) return null;

            const data = await resp.json();
            const key = `ISBN:${isbn}`;
            if (!data[key]) return null;

            const book = data[key];

            let coverUrl = null;
            if (book.cover) {
                coverUrl = (book.cover.large || book.cover.medium || book.cover.small || '')
                    .replace(/^http:/, 'https:');
            }

            const categories = (book.subjects || []).map(s => s.name || s);

            return {
                title:       book.title || '',
                authors:     (book.authors || []).map(a => a.name).join(', '),
                publisher:   (book.publishers || []).map(p => p.name).join(', '),
                publishedDate: book.publish_date || '',
                description: (book.notes || book.excerpts?.[0]?.text || '').substring(0, 500),
                pageCount:   book.number_of_pages || 0,
                categories:  categories,
                coverUrl:    coverUrl,
                isbn:        isbn,
                subject:     IsbnService._mapCategory(categories),
                source:      'openlibrary'
            };
        } catch (err) {
            console.error('[IsbnService] Open Library error:', err);
            return null;
        }
    }

    // ── Category → Kenyan CBC subject mapping ────────────────────────────
    static _mapCategory(categories) {
        if (!categories || categories.length === 0) return '';
        for (const cat of categories) {
            const lower = cat.toLowerCase();
            for (const [keyword, subject] of Object.entries(IsbnService.CBC_CATEGORY_MAP)) {
                if (lower.includes(keyword)) return subject;
            }
        }
        return categories[0]; // fallback: first category as-is
    }
}

// Export globally
window.IsbnService = IsbnService;
