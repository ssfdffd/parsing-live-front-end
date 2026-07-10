// --- CONFIGURATION ---
const WORKER_URL = "https://parsing-live-backend.YOUR_SUBDOMAIN.workers.dev"; // REPLACE
const PAYSTACK_PUBLIC_KEY = "pk_live_YOUR_PAYSTACK_PUBLIC_KEY"; // REPLACE

document.getElementById('premium-checkout-form').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const name = document.getElementById('checkout-name').value.trim();
    const email = document.getElementById('checkout-email').value.trim();

    if (!name || !email) return alert("Please fill in all fields.");

    // Trigger Paystack
    const handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: email,
        amount: 29900, // R299.00 in cents
        currency: 'ZAR',
        ref: 'PARSING_PREM_' + Date.now(),
        metadata: { custom_fields: [{ display_name: "Plan", variable_name: "plan", value: "Premium Monthly" }] },
        callback: function(response) {
            activatePremium(response.reference, email, name);
        },
        onClose: function() { alert('Payment window closed.'); }
    });
    handler.openIframe();
});

async function activatePremium(reference, email, name) {
    alert("Payment successful! Activating your Premium account...");
    
    try {
        const res = await fetch(`${WORKER_URL}/activate-premium`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference, userEmail: email, userName: name, companyName: name })
        });
        const data = await res.json();
        
        if (data.success) {
            // Save the secure portal token to the browser
            localStorage.setItem('parsing_portal_token', data.token);
            alert("Welcome to Parsing™ Live Premium! Redirecting to your Portal...");
            window.location.href = 'portal.html';
        } else {
            alert("Activation failed. Please contact support.");
        }
    } catch (error) {
        alert("Could not connect to server. Please contact support with your Paystack receipt.");
    }
}
