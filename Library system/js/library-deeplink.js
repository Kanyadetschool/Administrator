// Library deep-link router
// -------------------------------------------------------------------------
// library.html switches pages purely by click: app.js's navLinks handler
// reads data-page off the clicked <li> and calls showPage() + setActiveLink().
// Nothing reads the URL, so an external link like
//   .../library.html#fines
// lands on the Dashboard regardless — the target <div id="fines" class="page">
// exists but never gets .active.
//
// This adds the missing entry point, without touching app.js: on load (and on
// any later hash change) it finds the nav item whose data-page matches the
// hash and clicks it, so the app's own handlers do the actual switching. That
// keeps every side effect app.js attaches to navigation — e.g. showPage()'s
// studentManager.ensureLoaded() on the Students page — instead of duplicating
// them here and drifting.
//
// Install: add this line to library.html's script list, AFTER ./js/app.js:
//     <script src="./js/library-deeplink.js"></script>
//
// Valid hashes are the data-page values already in the sidebar:
//   dashboard, books, students, issuance, reports, classLibrary,
//   reservations, bookRequests, fines, bookCondition, advancedAnalytics,
//   studentPortal, messages
(function () {
    function pageFromHash() {
        const raw = (location.hash || '').replace(/^#/, '').trim();
        if (!raw) return null;
        // Tolerate a query-ish tail (#issuance?filter=lost) so links can be
        // extended later without breaking this.
        return raw.split(/[?&]/)[0];
    }

    function openFromHash() {
        const page = pageFromHash();
        if (!page) return;

        const link = document.querySelector(`.nav-links li[data-page="${CSS.escape(page)}"]`);
        if (link) {
            // Let app.js's own click handler do the work.
            link.click();
            return;
        }

        // The sidebar entry may be hidden for this role (library.html gates a
        // few items). Fall back to switching the page directly if the target
        // section exists at all.
        const target = document.getElementById(page);
        if (target && target.classList.contains('page') && typeof showPage === 'function') {
            showPage(page);
        }
    }

    // app.js wires its nav handlers at parse time and DashboardManager starts
    // on DOMContentLoaded, so run just after that to be sure the links exist.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(openFromHash, 0));
    } else {
        setTimeout(openFromHash, 0);
    }

    window.addEventListener('hashchange', openFromHash);
})();