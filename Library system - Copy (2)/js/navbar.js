document.addEventListener('DOMContentLoaded', () => {
    // Add hamburger button
    const navContent = document.querySelector('.nav-content');
    const hamburger = document.createElement('button');
    hamburger.classList.add('hamburger');
    hamburger.innerHTML = `
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
    `;
    navContent.prepend(hamburger);

    // Get navigation elements
    const navLinks = document.querySelector('.nav-links');
    const navItems = document.querySelectorAll('.nav-link');

    // Toggle mobile menu
    hamburger.addEventListener('click', () => {
        navLinks.classList.toggle('active');
        hamburger.classList.toggle('active');
    });

    // Handle nav link clicks
    navItems.forEach(link => {
        link.addEventListener('click', () => {
            // Remove active class from all links
            navItems.forEach(item => item.classList.remove('active'));
            // Add active class to clicked link
            link.classList.add('active');
            // Close mobile menu
            navLinks.classList.remove('active');
            hamburger.classList.remove('active');
        });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!navContent.contains(e.target) && !hamburger.contains(e.target)) {
            navLinks.classList.remove('active');
            hamburger.classList.remove('active');
        }
    });

    // Handle window resize
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            navLinks.classList.remove('active');
            hamburger.classList.remove('active');
        }
    });
});