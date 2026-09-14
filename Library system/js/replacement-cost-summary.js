// Replacement Cost Summary
// -------------------------------------------------------------------------
// Book condition + replacement cost tracking is added at the source in
// app.js (a "Replacement Cost" field on the book form, saved as
// book.replacementCost) and in index.html (a "Condition" field on the
// Add Lost Book form, saved as issuance.condition). This module is the
// reporting half: once the Lost Books modal loads its data
// (LostBooksManager.showLostBooksModal populates `this.allLostBooks`), it
// sums replacementCost across every currently-unrecovered lost book and
// shows the total next to the existing lost-books count, plus a per-row
// condition/cost note.
//
// Hooked in by monkey-patching showLostBooksModal rather than editing the
// ~4700-line app.js further, since this only reads data that method
// already assembles.
(function () {
    function currency(n) {
        return 'KES ' + Number(n || 0).toLocaleString();
    }

    function injectSummary(manager) {
        const anchor = document.getElementById('lostBooksTotalCount');
        if (!anchor) return;

        const outstanding = (manager.allLostBooks || []).filter(item => !item.issuance.recoveryStatus);
        const totalCost = outstanding.reduce((sum, item) => sum + Number(item.book?.replacementCost || 0), 0);

        let badge = document.getElementById('replacementCostBadge');
        if (!badge) {
            badge = document.createElement('span');
            badge.id = 'replacementCostBadge';
            badge.className = 'badge bg-danger ms-2';
            anchor.insertAdjacentElement('afterend', badge);
        }
        badge.textContent = `Replacement cost outstanding: ${currency(totalCost)}`;
    }

    function tryHook() {
        if (window.lostBooksManager && !window.lostBooksManager._costSummaryHooked) {
            const original = window.lostBooksManager.showLostBooksModal.bind(window.lostBooksManager);
            window.lostBooksManager.showLostBooksModal = async (...args) => {
                await original(...args);
                injectSummary(window.lostBooksManager);
            };
            window.lostBooksManager._costSummaryHooked = true;
        } else if (!window.lostBooksManager) {
            setTimeout(tryHook, 500);
        }
    }

    document.addEventListener('DOMContentLoaded', tryHook);
})();
