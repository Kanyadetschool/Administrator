// Barcode / QR Scanner
// -------------------------------------------------------------------------
// Replaces the old `scanBarcode()` mock in functions.js (a plain
// `prompt()`) with a real camera-based scanner, using the html5-qrcode
// library (CDN tag added in index.html). It attaches a small camera-icon
// button next to any book <select> element and, once the person picks a
// code, matches it against each book's isbn (falling back to the book's
// key/ID) and selects the matching <option>.
//
// This only targets the THREE book-select dropdowns that already exist as
// static markup: #issuanceBook (new-issuance modal), #quickBook (quick
// issue modal), and #lostBookBookSelect (add-lost-book modal). If another
// book select gets added later, call
// BarcodeScanner.attachTo('newSelectId') once for it.
class BarcodeScanner {
    static _libraryLoaded = null;

    static ensureLibrary() {
        if (window.Html5Qrcode) return Promise.resolve();
        if (BarcodeScanner._libraryLoaded) return BarcodeScanner._libraryLoaded;
        BarcodeScanner._libraryLoaded = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
            script.onload = resolve;
            script.onerror = () => {
                BarcodeScanner._libraryLoaded = null; // allow retry on next open()
                reject(new Error('Could not load the barcode scanner library'));
            };
            document.head.appendChild(script);
        });
        return BarcodeScanner._libraryLoaded;
    }

    static ensureModal() {
        if (document.getElementById('barcodeScannerModal')) return;
        const div = document.createElement('div');
        div.innerHTML = `
        <div class="modal fade" id="barcodeScannerModal" tabindex="-1">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title"><i class="bi bi-upc-scan"></i> Scan Book Barcode / ISBN</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div id="barcodeScannerViewport" style="width:100%; min-height:280px;"></div>
                        <p class="text-muted small mt-2 mb-0">Point the camera at the book's barcode. No camera? Use "Enter manually" below.</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" id="barcodeManualEntryBtn">Enter manually</button>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.appendChild(div.firstElementChild);
    }

    /**
     * Opens the scanner and resolves with the decoded text, or null if
     * cancelled. Handles starting/stopping the camera stream itself.
     */
    static async open() {
        BarcodeScanner.ensureModal();
        try {
            await BarcodeScanner.ensureLibrary();
        } catch (err) {
            console.error(err);
            const manual = await Swal.fire({
                title: 'Camera scanner unavailable',
                input: 'text',
                inputLabel: 'Type the ISBN / book code instead',
                showCancelButton: true
            });
            return manual.isConfirmed ? (manual.value || '').trim() : null;
        }

        return new Promise((resolve) => {
            const modalEl = document.getElementById('barcodeScannerModal');
            const modal = new bootstrap.Modal(modalEl);
            const html5Qrcode = new Html5Qrcode('barcodeScannerViewport');
            let settled = false;

            const finish = (value) => {
                if (settled) return;
                settled = true;
                html5Qrcode.stop().catch(() => {}).finally(() => {
                    modal.hide();
                    resolve(value);
                });
            };

            document.getElementById('barcodeManualEntryBtn').onclick = async () => {
                const manual = await Swal.fire({
                    title: 'Enter code manually',
                    input: 'text',
                    showCancelButton: true
                });
                if (manual.isConfirmed && manual.value) finish(manual.value.trim());
            };

            modalEl.addEventListener('hidden.bs.modal', function onHide() {
                modalEl.removeEventListener('hidden.bs.modal', onHide);
                if (!settled) {
                    settled = true;
                    html5Qrcode.stop().catch(() => {});
                    resolve(null);
                }
            }, { once: true });

            modal.show();

            html5Qrcode.start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 250, height: 150 } },
                (decodedText) => finish(decodedText),
                () => { /* per-frame decode failure — ignore, keep scanning */ }
            ).catch((err) => {
                console.error('Could not start camera:', err);
                Swal.fire('Camera error', 'Could not access the camera. Use "Enter manually" instead.', 'warning');
            });
        });
    }

    /**
     * Attaches a scan button next to the given <select id="..."> of book
     * options. On scan, matches the code against each option's ISBN
     * (read from the books node once) or the option's value (bookId),
     * and selects the matching option.
     */
    static attachTo(selectId) {
        const select = document.getElementById(selectId);
        if (!select || select.dataset.scannerAttached) return;
        select.dataset.scannerAttached = '1';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-outline-secondary';
        btn.title = 'Scan barcode / ISBN';
        btn.innerHTML = '<i class="bi bi-upc-scan"></i>';
        btn.style.marginLeft = '6px';

        // Wrap select+button so layout doesn't break out of its column.
        const wrapper = document.createElement('div');
        wrapper.className = 'd-flex align-items-center gap-1';
        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);
        wrapper.appendChild(btn);

        btn.addEventListener('click', async () => {
            const code = await BarcodeScanner.open();
            if (!code) return;
            await BarcodeScanner.selectMatchingOption(select, code);
        });
    }

    static async selectMatchingOption(select, code) {
        const normalized = code.trim().toLowerCase();
        // First try matching directly against the <option> values (bookId)
        // in case the select is already populated with that book.
        for (const opt of select.options) {
            if (opt.value && opt.value.toLowerCase() === normalized) {
                select.value = opt.value;
                select.dispatchEvent(new Event('change'));
                return;
            }
        }

        // Fall back to a full lookup against the books node by ISBN or key,
        // in case the option isn't in the (already-filtered) select yet.
        try {
            const snapshot = await db.ref('books').once('value');
            let matchId = null;
            snapshot.forEach((child) => {
                const book = child.val();
                if (child.key === code || (book.isbn && book.isbn.toLowerCase() === normalized)) {
                    matchId = child.key;
                }
            });

            if (!matchId) {
                await Swal.fire('No match', `No book found for code "${code}".`, 'warning');
                return;
            }

            const alreadyThere = [...select.options].some(o => o.value === matchId);
            if (!alreadyThere) {
                await Swal.fire('Book not selectable', 'That book was found but is not currently available for issuance (0 copies left, or a grade/student needs to be picked first).', 'info');
                return;
            }

            select.value = matchId;
            select.dispatchEvent(new Event('change'));
        } catch (error) {
            console.error('Error matching scanned code:', error);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // These selects are static markup, so attach immediately. If a modal's
    // select gets rebuilt/replaced later, attachTo() is safe to call again
    // (it no-ops once dataset.scannerAttached is set on the same element).
    ['issuanceBook', 'quickBook', 'lostBookBookSelect'].forEach(id => BarcodeScanner.attachTo(id));
});

window.BarcodeScanner = BarcodeScanner;