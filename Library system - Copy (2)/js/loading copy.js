document.getElementById('confirmBulkIssuance').addEventListener('click', function() {
    const button = this;
    // Store original content
    const originalContent = button.innerHTML;
    
    // Add loading state
    button.innerHTML = `
        <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
        Loading...
    `;
    button.disabled = true;
    
    //Simulate async operation (replace with your actual processing logic)
    setTimeout(() => {
        // Restore original content
        button.innerHTML = originalContent;
        button.disabled = false;
    }, 18000); // 18-second delay for demo; adjust as needed
});