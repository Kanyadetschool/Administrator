# Implementation Plan - Phase 1: Smart Cataloging & Barcode Spine Labels

Add automated ISBN cataloging metadata retrieval via Google Books API and a professional Batch Barcode & QR Spine Label printing engine for the Kanyadet School Library System.

---

## User Review Required

> [!IMPORTANT]
> - **External CDN Additions**: We will add `JsBarcode` (v3.11.6) and `qrcodejs` (v1.0.0) from CDN for client-side barcode/QR generation.
> - **Metadata Storage**: New fields (`coverUrl`, `publisher`, `description`, `pageCount`) will be saved in Firebase Realtime Database under `books/{bookId}`. Existing books will continue to display normally using existing covers/defaults.
> - **Printer Alignment**: The label printing tool supports standard 3-column (Avery 5160, 30 per sheet) and 2-column (spine tag, 14 per sheet) formats with dedicated print styles.

---

## Proposed Changes

### 1. ISBN Auto-Fetch & Cover Management

#### [NEW] [isbn-service.js](file:///c:/Users/mr%20oduor/Desktop/Github/Administrator/Library%20system/js/isbn-service.js)
- Standalone service `IsbnService` that queries the Google Books API (`https://www.googleapis.com/books/v1/volumes?q=isbn:{cleanIsbn}`).
- Extracts and normalizes:
  - Title & Subtitle
  - Authors
  - Publisher & Publication Year
  - Categories / Subjects (intelligently mapped to Kanyadet School categories like Mathematics, Science, English, Kiswahili, Social Studies, CRE, etc.)
  - High-resolution cover image URL (upgraded to HTTPS)
  - Description & Page Count
- Fallback to Open Library API (`https://openlibrary.org/api/books`) if Google Books yields no result.
- Provides clean error feedback if an ISBN is invalid or not indexed.

#### [MODIFY] [bookCovers.js](file:///c:/Users/mr%20oduor/Desktop/Github/Administrator/Library%20system/js/bookCovers.js)
- Upgrade `BookCoverManager.getBookCover()` and `renderBookCover()`:
  - Check if the book object has a `coverUrl` property.
  - If yes, use the remote `coverUrl`.
  - Otherwise, fallback to the hardcoded `bookCovers[bookId]` mapping.
  - If neither exists, fallback to `defaultCover`.
  - Add fallback `onerror` so broken links gracefully revert to default cover.

#### [MODIFY] [app.js](file:///c:/Users/mr%20oduor/Desktop/Github/Administrator/Library%20system/js/app.js)
- Update `showBookModal(bookId)`:
  - Add an "Auto-Fetch Metadata" button `<button id="fetchIsbnBtn">` and camera scanner button next to the ISBN input field.
  - Add a live book preview card inside the modal showing fetched cover image, page count, and publisher info.
  - Add an optional "Cover URL" field allowing custom covers.
- Update `handleBookSubmit()`:
  - Save `coverUrl`, `publisher`, `description`, and `pageCount` into the book record in Firebase.
  - Pass the full book object or `coverUrl` when calling `BookCoverManager.renderBookCover()`.

---

### 2. Batch Barcode & QR Spine Label Printing Engine

#### [NEW] [spine-labels.js](file:///c:/Users/mr%20oduor/Desktop/Github/Administrator/Library%20system/js/spine-labels.js)
- A dedicated `SpineLabelManager` class:
  - Renders a Print Spine Labels modal with book selection and configuration.
  - **Filtering**: By Grade (Grade 1–9), Category, or Search text.
  - **Selection**: "Select All", individual checkboxes, or multi-select.
  - **Copies**: Option to print 1 label per title or 1 label per copy in stock (`book.quantity`).
  - **Label Styles**:
    - Standard 3-Column (30 labels / letter sheet, Avery 5160 compatible).
    - Large Spine 2-Column (14 labels / sheet, ideal for book spines).
    - Compact Barcode Roll (continuous thermal or single strip).
  - **Label Content**:
    - School Header ("KANYADET SCHOOL LIBRARY")
    - Book Title (cleanly truncated to 2 lines)
    - Grade & Subject
    - Scannable Code 128 Barcode or QR Code
    - ISBN / Accession ID
  - **Print & PDF**:
    - Generates barcodes via `JsBarcode` onto canvas/SVG.
    - Generates QR codes via `QRCode`.
    - One-click print trigger with scoped `@media print` CSS ensuring exact dimensions and no margins/headers bleeding onto labels.
    - Export to printable PDF via `jspdf`.

#### [MODIFY] [index.html](file:///c:/Users/mr%20oduor/Desktop/Github/Administrator/Library%20system/index.html)
- Add CDN scripts for `JsBarcode` and `qrcodejs`:
  ```html
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  ```
- Add the new script imports:
  ```html
  <script src="./js/isbn-service.js"></script>
  <script src="./js/spine-labels.js"></script>
  ```
- In the `#books` page action bar, add a `<button id="printSpineLabelsBtn" class="btn btn-outline-primary">` with `<i class="bi bi-printer me-1"></i>Spine Labels`.
- Add label printing modal container and print styling.

---

## Verification Plan

### Automated / Browser Verification
1. **ISBN Auto-Fetch**:
   - Open Add Book modal.
   - Enter standard ISBN (e.g., `9780198390212` or `9780141439518`) and click "Auto-Fill Details".
   - Verify fields auto-fill (Title, Author, Publisher, etc.) and cover preview appears.
   - Save book and verify record in Firebase Realtime Database retains `coverUrl` and metadata.
   - Verify book card renders with the fetched cover image.
2. **Spine Label Printing**:
   - Click "Spine Labels" button.
   - Filter by Grade 4, select books, choose "Avery 5160 (3-column)" and "Code 128 Barcode".
   - Verify barcodes and QR codes render crisply without overlapping.
   - Test print preview (`Ctrl+P` / Print button) to ensure page grid fits 30 labels per sheet with zero overflow.
