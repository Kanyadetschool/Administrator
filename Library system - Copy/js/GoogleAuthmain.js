var mainApp = {};
(function() {
    var mainContainer = document.getElementById("main_container");
    const TOKEN_LIFETIME = 1800000; // 30 minutes in milliseconds
    // const TOKEN_LIFETIME = 240000; // 4 minutes in milliseconds
    const WARNING_BEFORE_EXPIRY = 15000; // 15 seconds before expiry
    let tokenExpiryTimer;
    let warningTimer;
    let isTabActive = document.visibilityState === 'visible';
    let lastActivity = Date.now();

    // Debounce function to limit frequent event triggers
    function debounce(func, wait) {
        let timeout;
        return function() {
            clearTimeout(timeout);
            timeout = setTimeout(func, wait);
        };
    }

    // Listen for storage events to sync logout across tabs
    window.addEventListener('storage', function(e) {
        if (e.key === 'logout-event') {
            firebase.auth().signOut().then(function() {
                window.location.replace("https://kanyadet-school-admin.web.app/login.html");
            }).catch(function(error) {
                console.error("Logout error:", error);
            });
        } else if (e.key === 'activity-update') {
            // Update last activity time from other tabs
            lastActivity = parseInt(e.newValue, 10);
            if (isTabActive) {
                setupTokenExpiration();
            }
        }
    });

    // Handle visibility change to track active tab
    document.addEventListener('visibilitychange', function() {
        isTabActive = document.visibilityState === 'visible';
        if (isTabActive) {
            // Active tab: check if session is still valid
            if (Date.now() - lastActivity < TOKEN_LIFETIME) {
                setupTokenExpiration();
            } else {
                logout();
            }
        } else {
            // Inactive tab: clear timers to prevent interference
            clearTimeout(tokenExpiryTimer);
            clearTimeout(warningTimer);
        }
    });

    var logout = function() {
        localStorage.setItem('logout-event', Date.now().toString());
        firebase.auth().signOut().then(function() {
            window.location.replace("https://kanyadet-school-admin.web.app/login.html");
        }, function(error) {
            console.error("Logout error:", error);
        });
    };

    // Show security notification
    function showSecurityNotification() {
        Swal.fire({
            title: 'Security Notice',
            text: 'Please ensure you\'re in a secure environment before proceeding.',
            icon: 'info',
            timer: 3000,
            timerProgressBar: true,
            confirmButtonText: 'Understood',
            allowOutsideClick: false,
            allowEscapeKey: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
    }

    // Show warning before token expiration
    function showExpiryWarning() {
        var countdown = Math.floor(WARNING_BEFORE_EXPIRY / 1000);
        Swal.fire({
            title: 'Session Expiring Soon',
            html: `Your session will expire in <strong id="countdown">${countdown}</strong> seconds.<br>You will need to log in again after expiration.`,
            icon: 'warning',
            timer: WARNING_BEFORE_EXPIRY,
            timerProgressBar: true,
            showCancelButton: true,
            confirmButtonText: 'Stay Logged In',
            cancelButtonText: 'Logout Now',
            allowOutsideClick: false,
            allowEscapeKey: false
        }).then((result) => {
            if (!result.isConfirmed) {
                logout();
            }
        });

        const countdownInterval = setInterval(() => {
            countdown--;
            const element = document.getElementById('countdown');
            if (element && countdown >= 0) {
                element.textContent = countdown;
            } else {
                clearInterval(countdownInterval);
            }
        }, 1000);
    }

    // Set up token expiration timer
    function setupTokenExpiration() {
        if (!isTabActive) return; // Only active tab sets timers

        clearTimeout(tokenExpiryTimer);
        clearTimeout(warningTimer);

        warningTimer = setTimeout(showExpiryWarning, TOKEN_LIFETIME - WARNING_BEFORE_EXPIRY);
        tokenExpiryTimer = setTimeout(logout, TOKEN_LIFETIME);
    }

    // Handle user activity
    const handleUserActivity = debounce(function() {
        if (!isTabActive) return; // Only active tab updates activity

        lastActivity = Date.now();
        localStorage.setItem('activity-update', lastActivity.toString());
        setupTokenExpiration();
    }, 200); // Debounce for 200ms

    // Initialize the application
    var init = function() {
        showSecurityNotification();

        firebase.auth().onAuthStateChanged(function(user) {
            if (user) {
                console.log("Authenticated user detected");
                document.body.style.display = 'block';
                mainContainer.style.display = 'block';
                if (isTabActive) {
                    setupTokenExpiration();
                }

                // Add event listeners for user activity
                window.addEventListener('mousemove', handleUserActivity);
                window.addEventListener('click', handleUserActivity);
                window.addEventListener('keypress', handleUserActivity);
                window.addEventListener('scroll', handleUserActivity);
                window.addEventListener('touchstart', handleUserActivity);
            } else {
                document.body.style.display = 'none';
                mainContainer.style.display = 'none';
                window.location.replace("./login.html");
                // window.location.replace("https://kanyadet-school-admin.web.app/login.html");
            }
        });
    };

    init();

    mainApp.logout = logout;
})();