document.addEventListener('DOMContentLoaded', () => {
  console.log('[DEBUG] image-popup-dynamic.js: Script loaded successfully');

  // Check if SweetAlert2 is loaded
  if (typeof Swal === 'undefined') {
    console.error('[DEBUG] image-popup-dynamic.js: SweetAlert2 is not loaded. Ensure <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script> is included before this script.');
    return;
  } else {
    console.log('[DEBUG] image-popup-dynamic.js: SweetAlert2 is loaded');
  }

  // Event delegation for dynamically added images
  document.body.addEventListener('click', (event) => {
    if (event.target.matches('img')) {
      console.log(`[DEBUG] image-popup-dynamic.js: Image clicked: ${event.target.src}`);
      try {
        Swal.fire({
          imageUrl: event.target.src,
          imageAlt: event.target.alt || 'Student Image',
          showCloseButton: true,
          showConfirmButton: false,
          background: '#ffffffff9d',
          backdropFilter: 'blur(5px)',
          padding: '1em',
          customClass: {
            popup: 'swal-image-popup',
            image: 'swal-image'
          }
        });
        console.log('[DEBUG] image-popup-dynamic.js: SweetAlert2 popup triggered');
      } catch (error) {
        console.error('[DEBUG] image-popup-dynamic.js: Error triggering SweetAlert2:', error);
      }
    }
  });

  // Periodically check for new images (runs every 2 seconds, stops after 30 seconds)
  let checkCount = 0;
  const maxChecks = 15; // 30 seconds / 2 seconds per check
  const imageCheckInterval = setInterval(() => {
    const images = document.querySelectorAll('img.student-image');
    console.log(`[DEBUG] image-popup-dynamic.js: Periodic check ${checkCount + 1}: Found ${images.length} images with class 'student-image'`);
    if (images.length > 0 || checkCount >= maxChecks) {
      clearInterval(imageCheckInterval);
      if (images.length > 0) {
        console.log('[DEBUG] image-popup-dynamic.js: Images found, stopping periodic check');
      } else {
        console.warn('[DEBUG] image-popup-dynamic.js: No images found after max checks. Ensure images have class "student-image".');
      }
    }
    checkCount++;
  }, 2000);

  // Initial check for images
  const initialImages = document.querySelectorAll('img.student-image');
  console.log(`[DEBUG] image-popup-dynamic.js: Initial check: Found ${initialImages.length} images with class 'student-image'`);
});

// Add CSS for better image display and debugging
const style = document.createElement('style');
style.innerHTML = `
  .swal-image-popup {
    max-width: 90vw !important;
    max-height: 90vh !important;
  }
  .swal-image {
    max-width: 100%;
    max-height: 80vh;
    object-fit: contain;
  }

`;
document.head.appendChild(style);
console.log('[DEBUG] image-popup-dynamic.js: Custom styles applied');