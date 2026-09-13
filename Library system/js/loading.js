document.getElementById('confirmBulkIssuance').addEventListener('click', function() {
    const button = this;
    // Store original content
    const originalContent = button.innerHTML;
    
    // Define duration
    const duration = 18000; // 18 seconds
    
    // Add loading state with spinner and percentage
    button.innerHTML = `
        <span style="display: inline-block; width: 16px; height: 16px; border: 3px solid #ffff; border-top: 3px solid transparent; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px;" role="status" aria-hidden="true"></span>
        Importing Please wait... <span id="progressPercentage">0%</span>
    `;
    button.disabled = true;
    
    // Simulate async operation with percentage updates over 18 seconds
    let progress = 0;
    const increment = 1; // 1% increments
    const intervalTime = duration / (100 / increment); // 180ms per 1% (100 increments over 18s)
    const interval = setInterval(() => {
        progress += increment;
        document.getElementById('progressPercentage').textContent = `${progress}%`;
        
        if (progress >= 100) {
            clearInterval(interval);
            // Restore original content
            button.innerHTML = originalContent;
            button.disabled = false;
        }
    }, intervalTime);
});